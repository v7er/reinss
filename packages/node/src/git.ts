import { promises as fs } from "node:fs";
import path from "node:path";
import { type DiffRange, ReinsError } from "@reins/core";
import { resolveWithinRoot } from "./paths.js";
import { runProcess } from "./process.js";

export interface GitInfo {
  head: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
}

export interface ResolvedRange {
  mode: "working" | "staged" | "range" | "base";
  baseCommit: string | null;
  headCommit: string | null;
  mergeBase: string | null;
  changes: FileChange[];
}

export class GitAdapter {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private async git(args: string[], timeoutMs = 15_000): Promise<string> {
    const result = await runProcess({
      command: "git",
      args,
      cwd: this.root,
      timeoutMs,
      env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    if (result.code !== 0) {
      throw new ReinsError(
        "GIT_FAILED",
        `git ${args[0]} failed: ${result.stderr.trim().slice(-500)}`,
        {
          retryable: true,
          details: { code: result.code },
        },
      );
    }
    return result.stdout;
  }

  async info(): Promise<GitInfo> {
    try {
      const head = (await this.git(["rev-parse", "HEAD"])).trim();
      const branch = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const status = await this.git(["status", "--porcelain"]);
      return { head, branch, dirty: status.trim().length > 0 };
    } catch {
      return { head: null, branch: null, dirty: false };
    }
  }

  async resolveRange(range: DiffRange): Promise<ResolvedRange> {
    const head = await this.tryHead();
    if (range.mode === "working") {
      const changes = await this.changesFrom(["diff", "--name-status", "HEAD"]);
      const untracked = await this.untracked();
      return {
        mode: "working",
        baseCommit: head,
        headCommit: null,
        mergeBase: null,
        changes: [...changes, ...untracked],
      };
    }
    if (range.mode === "staged") {
      return {
        mode: "staged",
        baseCommit: head,
        headCommit: null,
        mergeBase: null,
        changes: await this.changesFrom(["diff", "--cached", "--name-status"]),
      };
    }
    if (range.mode === "range") {
      const base = (await this.git(["rev-parse", range.base])).trim();
      const target = (await this.git(["rev-parse", range.head])).trim();
      return {
        mode: "range",
        baseCommit: base,
        headCommit: target,
        mergeBase: null,
        changes: await this.changesFrom(["diff", "--name-status", `${base}..${target}`]),
      };
    }
    const baseRef = range.base ?? "main";
    let mergeBase: string;
    try {
      mergeBase = (await this.git(["merge-base", baseRef, "HEAD"])).trim();
    } catch {
      throw new ReinsError("GIT_RANGE_INVALID", `Could not resolve a merge base for ${baseRef}.`);
    }
    return {
      mode: "base",
      baseCommit: mergeBase,
      headCommit: null,
      mergeBase,
      changes: await this.changesFrom(["diff", "--name-status", mergeBase]),
    };
  }

  private async tryHead(): Promise<string | null> {
    try {
      return (await this.git(["rev-parse", "HEAD"])).trim();
    } catch {
      return null;
    }
  }

  private async untracked(): Promise<FileChange[]> {
    const out = await this.git(["ls-files", "--others", "--exclude-standard"]);
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => ({ path: file, oldPath: null, status: "added" as const }));
  }

  private async changesFrom(args: string[]): Promise<FileChange[]> {
    const out = await this.git(args);
    const changes: FileChange[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      const code = parts[0] ?? "";
      if (code.startsWith("R") || code.startsWith("C")) {
        const oldPath = parts[1] ?? "";
        const newPath = parts[2] ?? oldPath;
        changes.push({
          path: newPath,
          oldPath,
          status: code.startsWith("R") ? "renamed" : "copied",
        });
      } else {
        const file = parts[1] ?? "";
        if (!file) continue;
        const status = code.startsWith("A")
          ? "added"
          : code.startsWith("D")
            ? "deleted"
            : "modified";
        changes.push({ path: file, oldPath: null, status });
      }
    }
    return changes;
  }

  async readAt(rev: string, file: string): Promise<string | null> {
    try {
      return await this.git(["show", `${rev}:${file}`], 20_000);
    } catch {
      return null;
    }
  }

  async readWorking(file: string): Promise<string | null> {
    try {
      return await fs.readFile(resolveWithinRoot(this.root, file), "utf8");
    } catch {
      return null;
    }
  }

  async readStaged(file: string): Promise<string | null> {
    try {
      return await this.git(["show", `:${file}`], 20_000);
    } catch {
      return null;
    }
  }

  async commitForPath(file: string): Promise<string | null> {
    try {
      return (await this.git(["log", "-1", "--format=%H", "--", file])).trim() || null;
    } catch {
      return null;
    }
  }

  async isTracked(file: string): Promise<boolean> {
    try {
      const out = await this.git(["ls-files", "--error-unmatch", file]);
      return out.trim().length > 0;
    } catch {
      return false;
    }
  }

  async absolute(file: string): Promise<string> {
    return path.join(this.root, file);
  }
}
