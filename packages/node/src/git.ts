import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type DiffRange,
  type GitBranch,
  type GitBranches,
  type GitCommit,
  type GitCommitRefs,
  type GitCommitResult,
  type GitFileStatus,
  type GitGraphCommit,
  type GitMergeResult,
  type GitReview,
  type GitReviews,
  type GitStatus,
  type GitSync,
  type GitSyncRef,
  type GitTag,
  type GitWorktree,
  ReinsError,
} from "@reinss/core";
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

export interface ChangedFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  ranges: Array<{ start: number; end: number }>;
}

interface AppraiseRequest {
  timestamp?: string;
  reviewRef?: string;
  targetRef?: string;
  requester?: string;
  reviewers?: string[];
  description?: string;
  baseCommit?: string;
  alias?: string;
  v?: number;
}

export interface ResolvedRange {
  mode: "working" | "unstaged" | "staged" | "range" | "base" | "commit";
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
    if (range.mode === "unstaged") {
      const changes = await this.changesFrom(["diff", "--name-status"]);
      const untracked = await this.untracked();
      return {
        mode: "unstaged",
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
    if (range.mode === "commit") {
      const head = (await this.git(["rev-parse", range.hash])).trim();
      let base: string | null = null;
      try {
        base = (await this.git(["rev-parse", `${head}^`])).trim();
      } catch {
        base = null;
      }
      return {
        mode: "commit",
        baseCommit: base,
        headCommit: head,
        mergeBase: null,
        changes: await this.changesFrom(["show", "--name-status", "--format=", head]),
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

  async changedLines(range: DiffRange): Promise<Map<string, ChangedFile>> {
    const resolved = await this.resolveRange(range);
    const map = new Map<string, ChangedFile>();
    for (const change of resolved.changes) {
      const status = change.status === "copied" ? "renamed" : change.status;
      map.set(change.path, { path: change.path, status, ranges: [] });
    }
    const args = ["diff", "-U0", "--no-color", "--no-ext-diff"];
    if (range.mode === "working") args.push("HEAD");
    else if (range.mode === "staged") args.push("--cached");
    else if (range.mode === "range") {
      args.push(`${resolved.baseCommit}..${resolved.headCommit}`);
    } else if (range.mode === "base") {
      args.push(resolved.baseCommit ?? "HEAD");
    }
    const out = await this.git(args);
    let current: ChangedFile | null = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("diff --git ")) {
        current = null;
        continue;
      }
      if (line.startsWith("+++ ")) {
        const target = line.slice(4).trim();
        if (target === "/dev/null") {
          current = null;
          continue;
        }
        const file = target.replace(/^b\//, "");
        current = map.get(file) ?? { path: file, status: "modified", ranges: [] };
        map.set(file, current);
        continue;
      }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (hunk && current) {
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        if (count > 0) current.ranges.push({ start, end: start + count - 1 });
      }
    }
    for (const change of resolved.changes) {
      const entry = map.get(change.path);
      if (entry && entry.status === "added" && entry.ranges.length === 0) {
        entry.ranges.push({ start: 1, end: Number.MAX_SAFE_INTEGER });
      }
    }
    return map;
  }

  async status(): Promise<GitStatus> {
    const out = await this.git(["status", "--porcelain=v1", "-z", "--branch"]);
    const entries = out.split("\0");
    let branch: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: GitFileStatus[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      if (entry.startsWith("## ")) {
        const header = entry.slice(3);
        const match = /^(.*?)(?:\.\.\..*?)?(?: \[(.*?)\])?$/.exec(header);
        branch = match?.[1] ?? null;
        const tracking = match?.[2] ?? "";
        ahead = Number(/ahead (\d+)/.exec(tracking)?.[1] ?? 0);
        behind = Number(/behind (\d+)/.exec(tracking)?.[1] ?? 0);
        continue;
      }
      const index = entry[0] ?? " ";
      const worktree = entry[1] ?? " ";
      const path = entry.slice(3);
      let oldPath: string | null = null;
      if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
        oldPath = entries[i + 1] ?? null;
        i += 1;
      }
      const untracked = index === "?" && worktree === "?";
      const conflicted =
        index === "U" ||
        worktree === "U" ||
        (index === "A" && worktree === "A") ||
        (index === "D" && worktree === "D");
      files.push({
        path,
        oldPath,
        index,
        worktree,
        staged: !untracked && !conflicted && index !== " " && index !== "?",
        unstaged: !untracked && !conflicted && worktree !== " " && worktree !== "?",
        untracked,
        conflicted,
        additions: null,
        deletions: null,
      });
    }
    const [unstaged, staged] = await Promise.all([
      this.numstat(["diff", "--numstat"]),
      this.numstat(["diff", "--cached", "--numstat"]),
    ]);
    for (const file of files) {
      const counts = unstaged.get(file.path) ?? staged.get(file.path);
      if (counts) {
        file.additions = counts.additions;
        file.deletions = counts.deletions;
      }
    }
    return { branch, ahead, behind, files, clean: files.length === 0 };
  }

  private async numstat(
    args: string[],
  ): Promise<Map<string, { additions: number; deletions: number }>> {
    const out = await this.git(args).catch(() => "");
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [additions, deletions, ...rest] = line.split("\t");
      const file = rest.join("\t");
      if (!file) continue;
      map.set(file, {
        additions: additions === "-" ? 0 : Number(additions),
        deletions: deletions === "-" ? 0 : Number(deletions),
      });
    }
    return map;
  }

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git(["add", "--", ...paths]);
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    try {
      await this.git(["restore", "--staged", "--", ...paths]);
    } catch {
      await this.git(["rm", "--cached", "--", ...paths]);
    }
  }

  async discard(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git(["restore", "--", ...paths]);
  }

  async commit(input: {
    message: string;
    amend?: boolean;
    signoff?: boolean;
  }): Promise<GitCommitResult> {
    const message = input.message.trim();
    if (!message) {
      throw new ReinsError("GIT_COMMIT_EMPTY", "A commit message is required.");
    }
    const args = ["commit", "-m", message];
    if (input.amend) args.push("--amend");
    if (input.signoff) args.push("--signoff");
    await this.git(args);
    const hash = (await this.git(["rev-parse", "HEAD"])).trim();
    const subject = (await this.git(["log", "-1", "--format=%s"])).trim();
    return { hash, subject, status: await this.status() };
  }

  async log(limit = 30, file?: string): Promise<GitCommit[]> {
    const args = [
      "log",
      `-n${Math.min(Math.max(limit, 1), 200)}`,
      "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P",
    ];
    if (file) args.push("--", file);
    const out = await this.git(args).catch(() => "");
    const commits: GitCommit[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [hash, shortHash, author, email, date, subject, parents] = line.split("\x1f");
      if (!hash) continue;
      commits.push({
        hash,
        shortHash: shortHash ?? hash.slice(0, 7),
        author: author ?? "",
        email: email ?? "",
        date: date ?? "",
        subject: subject ?? "",
        base: parents?.split(" ")[0] || null,
      });
    }
    return commits;
  }

  async graph(limit = 200): Promise<GitGraphCommit[]> {
    const count = Math.min(Math.max(limit, 1), 1000);
    const out = await this.git([
      "log",
      "--branches",
      "--tags",
      "--remotes",
      "--topo-order",
      `-n${count}`,
      "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%D",
    ]).catch(() => "");
    const commits: GitGraphCommit[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [hash, shortHash, author, email, date, subject, parents, refs] = line.split("\x1f");
      if (!hash) continue;
      const refNames: string[] = [];
      for (const raw of (refs ?? "").split(", ")) {
        const ref = raw.trim();
        if (!ref || ref.endsWith("/HEAD")) continue;
        if (ref.startsWith("HEAD -> ")) {
          refNames.push("HEAD", ref.slice(8));
        } else {
          refNames.push(ref);
        }
      }
      commits.push({
        hash,
        shortHash: shortHash ?? hash.slice(0, 7),
        parents: (parents ?? "").split(" ").filter(Boolean),
        author: author ?? "",
        email: email ?? "",
        date: date ?? "",
        subject: subject ?? "",
        refs: refNames,
      });
    }
    return commits;
  }

  async commitRefs(hash: string): Promise<GitCommitRefs> {
    this.assertRevision(hash);
    const [branchOut, tagOut, mergedOut, worktrees, defaultBranch] = await Promise.all([
      this.git(["branch", "--points-at", hash, "--format=%(refname:short)"]),
      this.git(["tag", "--points-at", hash]),
      this.git(["branch", "--contains", hash, "--format=%(refname:short)"]),
      this.worktrees(),
      this.defaultBranch(),
    ]);
    const lines = (value: string) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    return {
      branches: lines(branchOut),
      tags: lines(tagOut),
      worktrees: worktrees
        .filter((worktree) => worktree.head === hash)
        .map((worktree) => ({
          path: worktree.path,
          branch: worktree.branch,
          current: worktree.current,
        })),
      mergedInto: lines(mergedOut),
      defaultBranch,
    };
  }

  async merge(source: string, target: string): Promise<GitMergeResult> {
    this.assertRevision(source);
    await this.assertRef(target, "branch");
    const status = await this.status();
    if (!status.clean) {
      throw new ReinsError("GIT_DIRTY", "Commit or stash changes before merging.");
    }
    if (status.branch !== target) await this.git(["checkout", target]);
    try {
      const message = await this.git(["merge", "--no-ff", "--no-edit", source]);
      return { status: await this.status(), message: message.trim() };
    } catch (error) {
      await this.git(["merge", "--abort"]).catch(() => "");
      throw error;
    }
  }

  async reviews(): Promise<GitReviews> {
    const ref = "refs/notes/devtools/reviews";
    const available = await this.git(["show-ref", "--verify", "--quiet", ref])
      .then(() => true)
      .catch(() => false);
    if (!available) return { available: false, currentUser: null, reviews: [] };

    const currentUser = (await this.git(["config", "user.email"]).catch(() => "")).trim() || null;
    const list = await this.git(["notes", "--ref", ref, "list"]).catch(() => "");
    const revisions = list
      .split("\n")
      .map((line) => line.trim().split(" ")[1])
      .filter((revision): revision is string => Boolean(revision));

    const reviews: GitReview[] = [];
    // shortcut: cap at 100 reviews, paginate when a repository exceeds that.
    for (const revision of revisions.slice(0, 100)) {
      const request = await this.latestRequest(revision);
      if (!request) continue;
      const comments = await this.reviewComments(revision);
      const targetRef = request.targetRef || null;
      const starting = request.alias || revision;
      const submitted = targetRef ? await this.isAncestor(starting, targetRef) : false;
      const head = submitted ? starting : await this.reviewHead(revision, request);
      const base = submitted
        ? (request.baseCommit ?? null)
        : targetRef && head
          ? await this.mergeBase(targetRef, head)
          : null;
      const reviewers = request.reviewers ?? [];
      const requester = request.requester ?? "";
      const needsReview =
        Boolean(targetRef) &&
        !submitted &&
        !comments.resolved &&
        requester !== currentUser &&
        (!currentUser || reviewers.length === 0 || reviewers.includes(currentUser));
      reviews.push({
        revision,
        shortRevision: revision.slice(0, 7),
        reviewRef: request.reviewRef || null,
        targetRef,
        requester,
        reviewers,
        description: request.description ?? "",
        timestamp: request.timestamp ?? "",
        resolved: comments.resolved,
        submitted,
        needsReview,
        comments: comments.count,
        base,
        head,
      });
    }
    reviews.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    return { available: true, currentUser, reviews };
  }

  private async latestRequest(revision: string): Promise<AppraiseRequest | null> {
    const out = await this.git([
      "notes",
      "--ref",
      "refs/notes/devtools/reviews",
      "show",
      revision,
    ]).catch(() => "");
    let latest: AppraiseRequest | null = null;
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as AppraiseRequest;
        if ((request.v ?? 0) !== 0) continue;
        if (!latest || Number(request.timestamp ?? 0) >= Number(latest.timestamp ?? 0)) {
          latest = request;
        }
      } catch {
        // Ignore notes that are not review requests.
      }
    }
    return latest;
  }

  private async reviewComments(revision: string): Promise<{ count: number; resolved: boolean }> {
    const out = await this.git([
      "notes",
      "--ref",
      "refs/notes/devtools/discuss",
      "show",
      revision,
    ]).catch(() => "");
    let count = 0;
    let resolved: boolean | null = null;
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      try {
        const comment = JSON.parse(line) as { resolved?: boolean; v?: number };
        if ((comment.v ?? 0) !== 0) continue;
        count += 1;
        if (typeof comment.resolved === "boolean") {
          resolved = (resolved ?? true) && comment.resolved;
        }
      } catch {
        // Ignore notes that are not review comments.
      }
    }
    return { count, resolved: resolved === true };
  }

  private async reviewHead(revision: string, request: AppraiseRequest): Promise<string | null> {
    if (request.alias) return request.alias;
    if (request.reviewRef) {
      const refHead = await this.git(["rev-parse", request.reviewRef])
        .then((value) => value.trim())
        .catch(() => null);
      if (refHead && (await this.isAncestor(revision, refHead))) return refHead;
    }
    return revision;
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    return this.git(["merge-base", "--is-ancestor", ancestor, descendant])
      .then(() => true)
      .catch(() => false);
  }

  private async mergeBase(a: string, b: string): Promise<string | null> {
    return this.git(["merge-base", a, b])
      .then((value) => value.trim())
      .catch(() => null);
  }

  async branches(): Promise<GitBranches> {
    const out = await this.git([
      "for-each-ref",
      "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(objectname:short)%1f%(subject)",
      "refs/heads",
      "refs/remotes",
    ]);
    const local: GitBranch[] = [];
    const remote: GitBranch[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [full, short, head, upstream, track, hash, subject] = line.split("\x1f");
      if (!full || !short) continue;
      if (full.startsWith("refs/remotes/") && full.endsWith("/HEAD")) continue;
      const isRemote = full.startsWith("refs/remotes/");
      const branch: GitBranch = {
        name: short,
        remote: isRemote,
        current: head === "*",
        upstream: upstream || null,
        ahead: Number(/ahead (\d+)/.exec(track ?? "")?.[1] ?? 0),
        behind: Number(/behind (\d+)/.exec(track ?? "")?.[1] ?? 0),
        head: hash || null,
        subject: subject || null,
      };
      (isRemote ? remote : local).push(branch);
    }
    local.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    remote.sort((a, b) => a.name.localeCompare(b.name));
    return { current: local.find((branch) => branch.current)?.name ?? null, local, remote };
  }

  async checkoutBranch(name: string, remote = false): Promise<GitStatus> {
    await this.assertRef(name, "branch");
    if (remote) {
      const localName = name.split("/").slice(1).join("/") || name;
      const exists = await this.git(["show-ref", "--verify", "--quiet", `refs/heads/${localName}`])
        .then(() => true)
        .catch(() => false);
      await this.git(exists ? ["checkout", localName] : ["checkout", "--track", name]);
    } else {
      await this.git(["checkout", name]);
    }
    return this.status();
  }

  async createBranch(name: string, startPoint?: string, checkout = false): Promise<GitStatus> {
    await this.assertRef(name, "branch");
    if (startPoint) this.assertRevision(startPoint);
    if (checkout) {
      await this.git(["checkout", "-b", name, ...(startPoint ? [startPoint] : [])]);
    } else {
      await this.git(["branch", name, ...(startPoint ? [startPoint] : [])]);
    }
    return this.status();
  }

  async deleteBranch(name: string, force = false): Promise<GitStatus> {
    await this.assertRef(name, "branch");
    await this.git(["branch", force ? "-D" : "-d", name]);
    return this.status();
  }

  async tags(): Promise<GitTag[]> {
    const out = await this.git([
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname:short)%1f%(objecttype)%1f%(objectname)%1f%(objectname:short)%1f%(subject)%1f%(creatordate:iso-strict)",
      "refs/tags",
    ]);
    const tags: GitTag[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [name, objectType, hash, shortHash, subject, date] = line.split("\x1f");
      if (!name || !hash) continue;
      tags.push({
        name,
        hash,
        shortHash: shortHash ?? hash.slice(0, 7),
        subject: subject ?? "",
        date: date ?? "",
        annotated: objectType === "tag",
      });
    }
    return tags;
  }

  async createTag(input: { name: string; ref?: string; message?: string }): Promise<GitTag[]> {
    await this.assertRef(input.name, "tag");
    if (input.ref) this.assertRevision(input.ref);
    const args = ["tag"];
    if (input.message?.trim()) args.push("-a", input.name, "-m", input.message.trim());
    else args.push(input.name);
    if (input.ref) args.push(input.ref);
    await this.git(args);
    return this.tags();
  }

  async deleteTag(name: string): Promise<GitTag[]> {
    await this.assertRef(name, "tag");
    await this.git(["tag", "-d", name]);
    return this.tags();
  }

  async worktrees(): Promise<GitWorktree[]> {
    const out = await this.git(["worktree", "list", "--porcelain"]);
    const currentRoot = await fs.realpath(this.root).catch(() => path.resolve(this.root));
    const main = await this.defaultBranch();
    const worktrees: GitWorktree[] = [];
    for (const block of out.split("\n\n")) {
      if (!block.trim()) continue;
      const entry: GitWorktree = {
        path: "",
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        current: false,
        main,
        merged: null,
      };
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) entry.path = line.slice(9);
        else if (line.startsWith("HEAD ")) entry.head = line.slice(5);
        else if (line.startsWith("branch ")) {
          entry.branch = line.slice(7).replace(/^refs\/heads\//, "");
        } else if (line === "bare") entry.bare = true;
        else if (line === "detached") entry.detached = true;
        else if (line.startsWith("locked")) entry.locked = true;
        else if (line.startsWith("prunable")) entry.prunable = true;
      }
      if (!entry.path) continue;
      entry.path = await fs.realpath(entry.path).catch(() => path.resolve(entry.path));
      entry.current = entry.path === currentRoot;
      if (entry.branch && main) {
        entry.merged = entry.branch === main || (await this.isAncestor(entry.branch, main));
      }
      worktrees.push(entry);
    }
    return worktrees;
  }

  async sync(fetchTags = false): Promise<GitSync> {
    const remotes = (await this.git(["remote"]))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (remotes.length === 0) return { remotes: [], refs: [], fetchedAt: null };

    let fetchedAt: string | null = null;
    try {
      const args = ["fetch", "--all", "--prune"];
      if (fetchTags) args.push("--tags");
      await this.git(args, 60_000);
      fetchedAt = new Date().toISOString();
    } catch {
      // Offline or no credentials: still report the drift we can read locally.
    }

    const branches = await this.branches();
    const remoteByName = new Map<string, GitBranch>();
    for (const remote of branches.remote) {
      const slash = remote.name.indexOf("/");
      if (slash < 0) continue;
      const name = remote.name.slice(slash + 1);
      if (!remoteByName.has(name)) remoteByName.set(name, remote);
    }
    const refs: GitSyncRef[] = [];
    for (const branch of branches.local) {
      const remoteBranch = remoteByName.get(branch.name);
      if (!remoteBranch) continue;
      const counts = await this.aheadBehind(branch.name, remoteBranch.name);
      if (counts.ahead === 0 && counts.behind === 0) continue;
      refs.push({
        kind: "branch",
        name: branch.name,
        remote: remoteBranch.name.split("/")[0] ?? "",
        upstream: remoteBranch.name,
        state:
          counts.ahead > 0 && counts.behind > 0
            ? "diverged"
            : counts.behind > 0
              ? "behind"
              : "ahead",
        ahead: counts.ahead,
        behind: counts.behind,
      });
    }

    const localTags = new Map((await this.tags()).map((tag) => [tag.name, tag.hash]));
    for (const remote of remotes) {
      const out = await this.git(["ls-remote", "--tags", remote], 30_000).catch(() => "");
      for (const line of out.split("\n")) {
        const [hash, ref] = line.split("\t");
        if (!hash || !ref || ref.endsWith("^{}")) continue;
        const name = ref.replace("refs/tags/", "");
        const local = localTags.get(name);
        if (local === hash) continue;
        refs.push({
          kind: "tag",
          name,
          remote,
          upstream: null,
          state: local ? "updated" : "new",
          ahead: 0,
          behind: 0,
        });
      }
    }
    return { remotes, refs, fetchedAt };
  }

  async rebase(branch: string, upstream?: string): Promise<GitStatus> {
    await this.assertRef(branch, "branch");
    const target = upstream?.trim() || (await this.sameNameRemote(branch));
    if (!target) {
      throw new ReinsError(
        "GIT_NO_UPSTREAM",
        `Branch ${branch} has no remote branch with the same name.`,
      );
    }
    this.assertRevision(target);
    await this.git(["rebase", target, branch], 60_000);
    return this.status();
  }

  async push(branch: string): Promise<GitStatus> {
    await this.assertRef(branch, "branch");
    const target = await this.sameNameRemote(branch);
    if (!target) {
      await this.git(["push", "-u", "origin", branch], 60_000);
      return this.status();
    }
    const slash = target.indexOf("/");
    const remote = target.slice(0, slash);
    await this.git(["push", remote, `${branch}:${branch}`], 60_000);
    return this.status();
  }

  private async aheadBehind(
    local: string,
    remote: string,
  ): Promise<{ ahead: number; behind: number }> {
    const out = await this.git([
      "rev-list",
      "--left-right",
      "--count",
      `${local}...${remote}`,
    ]).catch(() => "");
    const [ahead, behind] = out.trim().split(/\s+/).map(Number);
    return { ahead: ahead ?? 0, behind: behind ?? 0 };
  }

  private async sameNameRemote(branch: string): Promise<string | null> {
    const remotes = (await this.git(["remote"]))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const remote of remotes) {
      const ref = `${remote}/${branch}`;
      const exists = await this.git(["show-ref", "--verify", "--quiet", `refs/remotes/${ref}`])
        .then(() => true)
        .catch(() => false);
      if (exists) return ref;
    }
    return null;
  }

  private async defaultBranch(): Promise<string | null> {
    for (const name of ["main", "master"]) {
      const exists = await this.git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`])
        .then(() => true)
        .catch(() => false);
      if (exists) return name;
    }
    const head = await this.git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
      .then((value) => value.trim())
      .catch(() => "");
    return head || null;
  }

  async addWorktree(input: {
    path: string;
    branch?: string;
    createBranch?: boolean;
    startPoint?: string;
    detach?: boolean;
  }): Promise<GitWorktree[]> {
    if (!input.path.trim()) {
      throw new ReinsError("GIT_WORKTREE_PATH", "A worktree path is required.");
    }
    const target = path.resolve(input.path);
    if (input.createBranch) {
      if (!input.branch) {
        throw new ReinsError("GIT_REF_INVALID", "A branch name is required for a new worktree.");
      }
      await this.assertRef(input.branch, "branch");
    } else if (input.branch) {
      await this.assertRef(input.branch, "branch");
    }
    if (input.startPoint) this.assertRevision(input.startPoint);
    const args = ["worktree", "add"];
    if (input.createBranch) args.push("-b", input.branch ?? "");
    else if (input.detach) args.push("--detach");
    args.push(target);
    if (input.createBranch) {
      if (input.startPoint) args.push(input.startPoint);
    } else if (input.branch) {
      args.push(input.branch);
    }
    await this.git(args);
    return this.worktrees();
  }

  async removeWorktree(target: string, force = false): Promise<GitWorktree[]> {
    const resolved = path.resolve(target);
    if (resolved === path.resolve(this.root)) {
      throw new ReinsError("GIT_WORKTREE_CURRENT", "Cannot remove the current worktree.");
    }
    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(resolved);
    await this.git(args);
    return this.worktrees();
  }

  private async assertRef(name: string, kind: "branch" | "tag"): Promise<void> {
    const value = name.trim();
    if (
      !value ||
      value.startsWith("-") ||
      /[\0-\x20~^:?*[\\]/.test(value) ||
      value.includes("..") ||
      value.endsWith("/") ||
      value.endsWith(".lock") ||
      value.includes("@{")
    ) {
      throw new ReinsError("GIT_REF_INVALID", `Invalid ${kind} name: ${name}`);
    }
    const ref = kind === "branch" ? value : `refs/tags/${value}`;
    const result = await runProcess({
      command: "git",
      args: kind === "branch" ? ["check-ref-format", "--branch", ref] : ["check-ref-format", ref],
      cwd: this.root,
      timeoutMs: 5_000,
      env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    if (result.code !== 0) {
      throw new ReinsError("GIT_REF_INVALID", `Invalid ${kind} name: ${name}`);
    }
  }

  private assertRevision(value: string): void {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("-") || /[\0-\x20]/.test(trimmed)) {
      throw new ReinsError("GIT_REF_INVALID", `Invalid revision: ${value}`);
    }
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
