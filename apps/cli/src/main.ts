#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  contractVersion,
  type DiffRange,
  isReinsError,
  type NoteProposal,
  type NoteType,
} from "@reinss/core";
import { createSession, listOpenSpecFiles, realRoot, startMcpServer } from "@reinss/node";
import { Command } from "commander";

const program = new Command();

program
  .name("reinss")
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
  .command("bootstrap")
  .description("Initialize config, knowledge folders, graph, and surfaces in one step")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const session = await sessionFor(dir);
      const result = await session.bootstrap();
      if (opts.json) ok(result);
      else {
        process.stdout.write(`created   ${result.created.length} paths\n`);
        for (const item of result.created) process.stdout.write(`  ${item}\n`);
        process.stdout.write(`graph     ${result.graphBuilt ? "built" : "ready"}\n`);
        process.stdout.write(`surfaces  ${result.surfaces}\n`);
        process.stdout.write(
          `repo      ${result.status.repo.name} (${result.status.graph.state})\n`,
        );
      }
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

program
  .command("symbols")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .option("--limit <n>", "max results", "20")
  .action(async (dir: string, opts: { json?: boolean; limit: string }) => {
    try {
      const session = await sessionFor(dir);
      const hits = await session.listSymbols({ limit: Number(opts.limit) });
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
  .option("--component <id>", "component id or kind, for example webapp")
  .option("--changed", "only surfaces touched by the Git range")
  .option("--range <mode>", "working, staged, or base", "working")
  .option("--query <text>", "text filter")
  .option("--limit <n>", "max results", "100")
  .action(
    async (
      dir: string,
      opts: {
        json?: boolean;
        kind?: string;
        framework?: string;
        component?: string;
        changed?: boolean;
        range: string;
        query?: string;
        limit: string;
      },
    ) => {
      try {
        const session = await sessionFor(dir);
        const range: DiffRange =
          opts.range === "staged"
            ? { mode: "staged" }
            : opts.range === "base"
              ? { mode: "base" }
              : { mode: "working" };
        const page = await session.listSurfaces({
          ...(opts.kind ? { kind: opts.kind as never } : {}),
          ...(opts.framework ? { framework: opts.framework } : {}),
          ...(opts.component ? { component: opts.component } : {}),
          ...(opts.changed ? { changed: true } : {}),
          ...(opts.changed || opts.range !== "working" ? { range } : {}),
          ...(opts.query ? { query: opts.query } : {}),
          limit: Number(opts.limit),
        });
        if (opts.json) ok(page);
        else {
          const groups = new Map<string, typeof page.items>();
          for (const surface of page.items) {
            const list = groups.get(surface.componentId) ?? [];
            list.push(surface);
            groups.set(surface.componentId, list);
          }
          for (const [id, surfaces] of groups) {
            const component = page.components.find((item) => item.id === id);
            process.stdout.write(
              `${component?.name ?? id} (${component?.kind ?? "unknown"})${component?.changed ? " *" : ""}\n`,
            );
            for (const surface of surfaces) {
              const change = surface.change
                ? ` [${surface.change.touched ? "changed" : "file"}]`
                : "";
              process.stdout.write(
                `  ${surface.kind.padEnd(6)} ${surface.id}  ${surface.file}:${surface.line}${change}\n`,
              );
            }
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
  .option("--commit <hash>", "diff one commit against its parent")
  .action(
    async (
      dir: string,
      opts: {
        json?: boolean;
        staged?: boolean;
        base?: string;
        from?: string;
        to?: string;
        commit?: string;
      },
    ) => {
      try {
        const session = await sessionFor(dir);
        const range: DiffRange = opts.commit
          ? { mode: "commit", hash: opts.commit }
          : opts.from && opts.to
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

const git = program.command("git").description("Git status, staging, commits, and history");

git
  .command("status")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const session = await sessionFor(dir);
      const status = await session.gitStatus();
      if (opts.json) ok(status);
      else {
        const tracking = [
          status.ahead ? `ahead ${status.ahead}` : "",
          status.behind ? `behind ${status.behind}` : "",
        ]
          .filter(Boolean)
          .join(", ");
        process.stdout.write(`${status.branch ?? "detached"}${tracking ? ` (${tracking})` : ""}\n`);
        for (const file of status.files) {
          const state = file.conflicted
            ? "conflict"
            : file.untracked
              ? "untracked"
              : `${file.index}${file.worktree}`;
          const counts =
            file.additions !== null ? ` +${file.additions} -${file.deletions ?? 0}` : "";
          process.stdout.write(`${state.padEnd(10)} ${file.path}${counts}\n`);
        }
        process.stdout.write(`${status.files.length} files\n`);
      }
    } catch (err) {
      fail(err);
    }
  });

git
  .command("stage")
  .argument("<paths...>", "files to stage")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (paths: string[], opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const status = await session.gitStage({ paths });
      if (opts.json) ok(status);
      else process.stdout.write(`staged ${paths.length} files\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("unstage")
  .argument("<paths...>", "files to unstage")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (paths: string[], opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const status = await session.gitUnstage({ paths });
      if (opts.json) ok(status);
      else process.stdout.write(`unstaged ${paths.length} files\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("discard")
  .argument("<paths...>", "files to discard")
  .option("--dir <dir>", "repository root", ".")
  .option("--yes", "confirm the destructive operation")
  .option("--json", "machine-readable output")
  .action(async (paths: string[], opts: { dir: string; yes?: boolean; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const status = await session.gitDiscard({ paths, confirm: opts.yes ?? false });
      if (opts.json) ok(status);
      else process.stdout.write(`discarded ${paths.length} files\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("commit")
  .requiredOption("-m, --message <text>", "commit message")
  .option("--dir <dir>", "repository root", ".")
  .option("--amend", "amend the previous commit")
  .option("--signoff", "add a sign-off line")
  .option("--json", "machine-readable output")
  .action(
    async (opts: {
      message: string;
      dir: string;
      amend?: boolean;
      signoff?: boolean;
      json?: boolean;
    }) => {
      try {
        const session = await sessionFor(opts.dir);
        const result = await session.gitCommit({
          message: opts.message,
          ...(opts.amend ? { amend: true } : {}),
          ...(opts.signoff ? { signoff: true } : {}),
        });
        if (opts.json) ok(result);
        else process.stdout.write(`${result.hash.slice(0, 8)} ${result.subject}\n`);
      } catch (err) {
        fail(err);
      }
    },
  );

git
  .command("log")
  .option("--dir <dir>", "repository root", ".")
  .option("--limit <n>", "max commits", "30")
  .option("--path <path>", "limit to one file")
  .option("--json", "machine-readable output")
  .action(async (opts: { dir: string; limit: string; path?: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const commits = await session.gitLog({
        limit: Number(opts.limit),
        ...(opts.path ? { path: opts.path } : {}),
      });
      if (opts.json) ok(commits);
      else {
        for (const commit of commits) {
          process.stdout.write(
            `${commit.shortHash} ${commit.date.slice(0, 10)} ${commit.author} ${commit.subject}\n`,
          );
        }
      }
    } catch (err) {
      fail(err);
    }
  });

git
  .command("branches")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const branches = await session.gitBranches();
      if (opts.json) ok(branches);
      else {
        process.stdout.write(`current ${branches.current ?? "detached"}\n`);
        for (const branch of branches.local) {
          process.stdout.write(
            `${branch.current ? "*" : " "} ${branch.name}${branch.upstream ? ` -> ${branch.upstream}` : ""}\n`,
          );
        }
        for (const branch of branches.remote) {
          process.stdout.write(`  ${branch.name}\n`);
        }
      }
    } catch (err) {
      fail(err);
    }
  });

git
  .command("checkout")
  .argument("<name>", "branch name")
  .option("--remote", "check out a remote branch as a local tracking branch")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (name: string, opts: { remote?: boolean; dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const status = await session.gitCheckoutBranch({ name, remote: opts.remote ?? false });
      if (opts.json) ok(status);
      else process.stdout.write(`checked out ${status.branch ?? name}\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("create-branch")
  .argument("<name>", "branch name")
  .option("--start <ref>", "start point")
  .option("--checkout", "check out the new branch")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(
    async (
      name: string,
      opts: { start?: string; checkout?: boolean; dir: string; json?: boolean },
    ) => {
      try {
        const session = await sessionFor(opts.dir);
        const status = await session.gitCreateBranch({
          name,
          ...(opts.start ? { startPoint: opts.start } : {}),
          checkout: opts.checkout ?? false,
        });
        if (opts.json) ok(status);
        else process.stdout.write(`created ${name}\n`);
      } catch (err) {
        fail(err);
      }
    },
  );

git
  .command("delete-branch")
  .argument("<name>", "branch name")
  .option("--force", "delete even when unmerged")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (name: string, opts: { force?: boolean; dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const status = await session.gitDeleteBranch({ name, force: opts.force ?? false });
      if (opts.json) ok(status);
      else process.stdout.write(`deleted ${name}\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("tags")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const tags = await session.gitTags();
      if (opts.json) ok(tags);
      else {
        for (const tag of tags) {
          process.stdout.write(
            `${tag.name}${tag.annotated ? " (annotated)" : ""} ${tag.shortHash} ${tag.subject}\n`,
          );
        }
      }
    } catch (err) {
      fail(err);
    }
  });

git
  .command("tag")
  .argument("<name>", "tag name")
  .option("--ref <ref>", "commit or ref to tag")
  .option("--message <text>", "annotated tag message")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(
    async (name: string, opts: { ref?: string; message?: string; dir: string; json?: boolean }) => {
      try {
        const session = await sessionFor(opts.dir);
        const tags = await session.gitCreateTag({
          name,
          ...(opts.ref ? { ref: opts.ref } : {}),
          ...(opts.message ? { message: opts.message } : {}),
        });
        if (opts.json) ok(tags);
        else process.stdout.write(`created tag ${name}\n`);
      } catch (err) {
        fail(err);
      }
    },
  );

git
  .command("delete-tag")
  .argument("<name>", "tag name")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (name: string, opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const tags = await session.gitDeleteTag({ name });
      if (opts.json) ok(tags);
      else process.stdout.write(`deleted tag ${name}\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("worktrees")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const worktrees = await session.gitWorktrees();
      if (opts.json) ok(worktrees);
      else {
        for (const worktree of worktrees) {
          process.stdout.write(
            `${worktree.current ? "*" : " "} ${worktree.path} ${worktree.branch ?? "detached"}\n`,
          );
        }
      }
    } catch (err) {
      fail(err);
    }
  });

git
  .command("worktree-add")
  .argument("<path>", "worktree path")
  .option("--branch <name>", "branch to check out or create")
  .option("--create", "create the branch")
  .option("--start <ref>", "start point for a new branch")
  .option("--detach", "detach HEAD")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(
    async (
      target: string,
      opts: {
        branch?: string;
        create?: boolean;
        start?: string;
        detach?: boolean;
        dir: string;
        json?: boolean;
      },
    ) => {
      try {
        const session = await sessionFor(opts.dir);
        const worktrees = await session.gitAddWorktree({
          path: target,
          ...(opts.branch ? { branch: opts.branch } : {}),
          ...(opts.create ? { createBranch: true } : {}),
          ...(opts.start ? { startPoint: opts.start } : {}),
          ...(opts.detach ? { detach: true } : {}),
        });
        if (opts.json) ok(worktrees);
        else process.stdout.write(`added worktree ${target}\n`);
      } catch (err) {
        fail(err);
      }
    },
  );

git
  .command("worktree-remove")
  .argument("<path>", "worktree path")
  .option("--force", "remove even with local changes")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (target: string, opts: { force?: boolean; dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const worktrees = await session.gitRemoveWorktree({
        path: target,
        force: opts.force ?? false,
      });
      if (opts.json) ok(worktrees);
      else process.stdout.write(`removed worktree ${target}\n`);
    } catch (err) {
      fail(err);
    }
  });

git
  .command("graph")
  .option("--dir <dir>", "repository root", ".")
  .option("--limit <n>", "max commits", "200")
  .option("--json", "machine-readable output")
  .action(async (opts: { dir: string; limit: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const commits = await session.gitGraph({ limit: Number(opts.limit) });
      if (opts.json) ok(commits);
      else {
        for (const commit of commits) {
          process.stdout.write(`${commit.shortHash} ${commit.refs.join(", ")} ${commit.subject}\n`);
        }
      }
    } catch (err) {
      fail(err);
    }
  });

git
  .command("show")
  .argument("<hash>", "commit hash")
  .option("--dir <dir>", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (hash: string, opts: { dir: string; json?: boolean }) => {
    try {
      const session = await sessionFor(opts.dir);
      const diff = await session.diff({ range: { mode: "commit", hash } });
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
  });

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
  .description("List OpenSpec knowledge files")
  .argument("[dir]", "repository root", ".")
  .option("--json", "machine-readable output")
  .action(async (dir: string, opts: { json?: boolean }) => {
    try {
      const root = await realRoot(path.resolve(dir));
      const files = await listOpenSpecFiles(root);
      if (opts.json) ok({ files });
      else
        process.stdout.write(files.length ? `${files.join("\n")}\n` : "No OpenSpec files found.\n");
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
