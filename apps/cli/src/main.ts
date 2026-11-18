#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  contractVersion,
  type DiffRange,
  isReinsError,
  type NoteProposal,
  type NoteType,
} from "@reins/core";
import { createSession, realRoot, startMcpServer } from "@reins/node";
import { Command } from "commander";

const program = new Command();

program
  .name("reins")
  .description("Local code structure, intent, and semantic review.")
  .version("0.1.0");

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function ok(data: unknown): void {
  json({ contractVersion, ok: true, data });
}

function fail(err: unknown): never {
  const code = isReinsError(err) ? err.code : "INTERNAL";
  const message = err instanceof Error ? err.message : String(err);
  const retryable = isReinsError(err) ? err.retryable : false;
  process.stderr.write(
    `${JSON.stringify({ contractVersion, ok: false, error: { code, message, retryable } })}\n`,
  );
  const exit =
    code === "TRAIL_MISSING" ||
    code === "TRAIL_VERSION_UNSUPPORTED" ||
    code === "TRAIL_FAILED" ||
    code === "TRAIL_TIMEOUT" ||
    code === "TRAIL_MISSING_GRAFT" ||
    code === "GIT_MISSING" ||
    code === "GIT_FAILED"
      ? 2
      : code === "GRAPH_TRUNCATED" || code === "TRAIL_OUTPUT_LIMIT"
        ? 3
        : code === "INTERNAL" || code === "DIFF_WORKER_FAILED"
          ? 4
          : 1;
  process.exit(exit);
}

async function sessionFor(dir: string) {
  const root = await realRoot(path.resolve(dir));
  return createSession(root);
}

function printStatus(
  status: Awaited<ReturnType<Awaited<ReturnType<typeof sessionFor>>["status"]>>,
): void {
  process.stdout.write(`repo      ${status.repo.name}\n`);
  process.stdout.write(
    `graph     ${status.graph.state} (${status.graph.nodes ?? 0} nodes, in sync: ${status.graph.inSync})\n`,
  );
  process.stdout.write(`trail     ${status.trail.version ?? "missing"}\n`);
  process.stdout.write(
    `git       ${status.git.head?.slice(0, 8) ?? "none"}${status.git.dirty ? " (dirty)" : ""}\n`,
  );
  process.stdout.write(
    `knowledge ${status.knowledge.notes} notes, ${status.knowledge.proposed} proposed\n`,
  );
  process.stdout.write(
    `surfaces  ${status.surfaces.count}${status.surfaces.stale ? " (stale)" : ""}\n`,
  );
}

program
  .command("init")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const session = await sessionFor(dir);
      await session.init();
      if (opts.json) ok({ root: session.root, config: ".reins/config.json" });
      else process.stdout.write(`Initialized ${session.root}\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("status")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const session = await sessionFor(dir);
      const status = await session.status();
      if (opts.json) ok(status);
      else printStatus(status);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("search")
  .argument("<query>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--limit <n>", "max results", "10")
  .action(async (query: string, dir: string, opts: { json?: boolean; limit: string }) => {
    try {
      const session = await sessionFor(dir);
      const hits = await session.searchSymbols(query, { limit: Number(opts.limit) });
      if (opts.json) ok(hits);
      else {
        for (const hit of hits) {
          process.stdout.write(
            `${hit.path}${hit.startLine ? `:${hit.startLine}` : ""}  ${hit.name}\n`,
          );
        }
      }
    } catch (err) {
      fail(err);
    }
  });

async function graphCommand(
  symbol: string,
  dir: string,
  opts: { json?: boolean; depth: string; direction: "in" | "out" | "both" },
): Promise<void> {
  try {
    const session = await sessionFor(dir);
    const slice = await session.graph({
      root: { symbolId: symbol },
      direction: opts.direction,
      depth: Number(opts.depth),
    });
    if (opts.json) ok(slice);
    else {
      for (const node of slice.nodes) {
        process.stdout.write(
          `${"  ".repeat(node.depth)}${node.name}  ${node.path}:${node.startLine}\n`,
        );
      }
      if (slice.truncated) process.stdout.write("(truncated)\n");
    }
  } catch (err) {
    fail(err);
  }
}

program
  .command("callers")
  .argument("<symbol>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--depth <n>", "traversal depth", "1")
  .action(async (symbol: string, dir: string, opts: { json?: boolean; depth: string }) => {
    await graphCommand(symbol, dir, { ...opts, direction: "in" });
  });

program
  .command("callees")
  .argument("<symbol>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--depth <n>", "traversal depth", "1")
  .action(async (symbol: string, dir: string, opts: { json?: boolean; depth: string }) => {
    await graphCommand(symbol, dir, { ...opts, direction: "out" });
  });

program
  .command("graph")
  .argument("<symbol>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--depth <n>", "traversal depth", "1")
  .option("--direction <dir>", "in, out, or both", "both")
  .action(
    async (
      symbol: string,
      dir: string,
      opts: { json?: boolean; depth: string; direction: string },
    ) => {
      await graphCommand(symbol, dir, {
        ...opts,
        direction: opts.direction as "in" | "out" | "both",
      });
    },
  );

program
  .command("surfaces")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--kind <kind>", "http, cli, page, screen, export")
  .option("--framework <name>", "framework filter")
  .option("--query <text>", "text filter")
  .option("--limit <n>", "max results", "100")
  .action(
    async (
      dir: string,
      opts: { json?: boolean; kind?: string; framework?: string; query?: string; limit: string },
    ) => {
      try {
        const session = await sessionFor(dir);
        const page = await session.listSurfaces({
          ...(opts.kind ? { kind: opts.kind as never } : {}),
          ...(opts.framework ? { framework: opts.framework } : {}),
          ...(opts.query ? { query: opts.query } : {}),
          limit: Number(opts.limit),
        });
        if (opts.json) ok(page);
        else {
          for (const surface of page.items) {
            process.stdout.write(
              `${surface.kind.padEnd(6)} ${surface.id}  ${surface.file}:${surface.line}\n`,
            );
          }
          process.stdout.write(`${page.total} surfaces\n`);
        }
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command("flow")
  .argument("<target>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--depth <n>", "traversal depth", "3")
  .action(async (target: string, dir: string, opts: { json?: boolean; depth: string }) => {
    try {
      const session = await sessionFor(dir);
      const slice = await session.flow({ target, depth: Number(opts.depth) });
      if (opts.json) ok(slice);
      else {
        for (const node of slice.nodes) {
          process.stdout.write(
            `${"  ".repeat(node.depth)}${node.name}  ${node.path}:${node.startLine}\n`,
          );
        }
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command("diff")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--staged", "diff the index against HEAD")
  .option("--base <ref>", "diff from a merge base")
  .option("--from <ref>", "range base")
  .option("--to <ref>", "range head")
  .action(
    async (
      dir: string,
      opts: { json?: boolean; staged?: boolean; base?: string; from?: string; to?: string },
    ) => {
      try {
        const session = await sessionFor(dir);
        const range: DiffRange =
          opts.from && opts.to
            ? { mode: "range", base: opts.from, head: opts.to }
            : opts.staged
              ? { mode: "staged" }
              : opts.base
                ? { mode: "base", base: opts.base }
                : { mode: "working" };
        const diff = await session.diff({ range });
        if (opts.json) ok(diff);
        else {
          for (const file of diff.files) {
            process.stdout.write(`${file.path} (${file.status})\n`);
            for (const change of file.changes) {
              process.stdout.write(
                `  ${change.kind.padEnd(11)} ${change.symbol.name}  ${change.to?.path ?? change.from?.path ?? ""}:${change.to?.startLine ?? change.from?.startLine ?? ""}\n`,
              );
            }
          }
        }
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command("notes")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--query <text>", "text filter")
  .option("--type <type>", "note type")
  .option("--status <status>", "note status")
  .action(
    async (
      dir: string,
      opts: { json?: boolean; query?: string; type?: string; status?: string },
    ) => {
      try {
        const session = await sessionFor(dir);
        const notes = await session.listNotes({
          ...(opts.query ? { query: opts.query } : {}),
          ...(opts.type ? { type: opts.type as never } : {}),
          ...(opts.status ? { status: opts.status as never } : {}),
        });
        if (opts.json) ok(notes);
        else {
          for (const note of notes) {
            process.stdout.write(
              `${note.id.padEnd(36)} ${note.type.padEnd(10)} ${note.status.padEnd(10)} ${note.title}\n`,
            );
          }
        }
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command("note")
  .argument("<id>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (id: string, dir: string, opts: { json?: boolean }) => {
    try {
      const session = await sessionFor(dir);
      const note = await session.getNote(id);
      if (opts.json) ok(note);
      else process.stdout.write(`${note.title}\n\n${note.body}\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("propose")
  .argument("<title>")
  .argument("[dir]", "repository root", ".")
  .option("--type <type>", "note type", "decision")
  .option("--body <text>", "note body")
  .option("--body-file <path>", "read body from a file")
  .option("--json", "machine-readable output")
  .action(
    async (
      title: string,
      dir: string,
      opts: { type: string; body?: string; bodyFile?: string; json?: boolean },
    ) => {
      try {
        const session = await sessionFor(dir);
        const body = opts.bodyFile
          ? await fs.readFile(path.resolve(opts.bodyFile), "utf8")
          : (opts.body ?? "");
        const proposal: NoteProposal = {
          type: opts.type as NoteType,
          title,
          body,
          source: { kind: "manual" },
        };
        const result = await session.proposeNote(proposal);
        if (opts.json) ok(result);
        else process.stdout.write(`${result.path}\n${result.diff}\n`);
      } catch (err) {
        fail(err);
      }
    },
  );

program
  .command("check")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--scope <scope>", "knowledge, knowledge+code, or diff", "knowledge")
  .option("--strict", "treat warnings as failures")
  .action(async (dir: string, opts: { json?: boolean; scope: string; strict?: boolean }) => {
    try {
      const session = await sessionFor(dir);
      const report = await session.check({
        scope: opts.scope as never,
        strict: opts.strict ?? false,
      });
      if (opts.json) ok(report);
      else {
        for (const item of report.items) {
          process.stdout.write(`${item.severity.padEnd(7)} ${item.code}  ${item.message}\n`);
        }
        process.stdout.write(
          `${report.ok ? "ok" : "failed"}: ${report.summary.error} errors, ${report.summary.warning} warnings\n`,
        );
      }
      if (!report.ok) process.exit(1);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("pack")
  .argument("<intent>")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--max-tokens <n>", "token budget", "4000")
  .action(async (intent: string, dir: string, opts: { json?: boolean; maxTokens: string }) => {
    try {
      const session = await sessionFor(dir);
      const pack = await session.harnessPack({ intent, maxTokens: Number(opts.maxTokens) });
      if (opts.json) ok(pack);
      else process.stdout.write(`${pack.markdown}\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("spec")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const root = await realRoot(path.resolve(dir));
      const files: string[] = [];
      for (const candidate of [".specify/memory/constitution.md"]) {
        try {
          await fs.access(path.join(root, candidate));
          files.push(candidate);
        } catch {
          // absent
        }
      }
      const specs = await fs.readdir(path.join(root, "specs")).catch(() => []);
      for (const entry of specs) {
        for (const name of ["spec.md", "plan.md", "tasks.md"]) {
          const relative = `specs/${entry}/${name}`;
          try {
            await fs.access(path.join(root, relative));
            files.push(relative);
          } catch {
            // absent
          }
        }
      }
      if (opts.json) ok({ files });
      else
        process.stdout.write(files.length ? `${files.join("\n")}\n` : "No spec-kit files found.\n");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("serve")
  .description("Run the stdio sidecar used by the Tauri shell")
  .action(async () => {
    await import("./serve.js");
  });

program
  .command("mcp")
  .argument("[dir]", "repository root", ".")
  .action(async (dir: string) => {
    try {
      const session = await sessionFor(dir);
      await startMcpServer(session);
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync(process.argv).catch((err) => fail(err));
