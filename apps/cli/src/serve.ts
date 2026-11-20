import readline from "node:readline";
import {
  type CheckRequest,
  type DiffRequest,
  type FlowRequest,
  type GraphRequest,
  isReinsError,
  type NoteFilter,
  type NoteProposal,
  type PackRequest,
  type RefreshOptions,
  type SearchOptions,
  type SurfaceFilter,
} from "@reins/core";
import {
  createSession,
  type RepoSession,
  type RepoWatcher,
  realRoot,
  watchRepo,
} from "@reins/node";

interface Request {
  id: number;
  method: string;
  params?: unknown;
}

let session: RepoSession | null = null;
let watcher: RepoWatcher | null = null;

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function stopWatching(): void {
  watcher?.close();
  watcher = null;
}

function startWatching(root: string): void {
  stopWatching();
  watcher = watchRepo(root, (paths) => {
    session?.invalidate();
    write({ event: "change", data: { paths } });
  });
}

async function handle(request: Request): Promise<unknown> {
  if (request.method === "open") {
    const params = request.params as { root?: string } | undefined;
    if (!params?.root) throw new Error("open requires a root path");
    stopWatching();
    session = null;
    session = await createSession(await realRoot(params.root));
    startWatching(session.root);
    return session.status();
  }
  if (request.method === "close") {
    stopWatching();
    session = null;
    return null;
  }
  if (!session) {
    throw new Error("REPO_NOT_OPEN: open a repository first");
  }
  const params = request.params;
  switch (request.method) {
    case "status":
      return session.status();
    case "bootstrap":
      return session.bootstrap();
    case "refreshGraph":
      return session.refreshGraph((params ?? {}) as RefreshOptions);
    case "gitStatus":
      return session.gitStatus();
    case "gitStage":
      return session.gitStage(params as { paths: string[] });
    case "gitUnstage":
      return session.gitUnstage(params as { paths: string[] });
    case "gitDiscard":
      return session.gitDiscard(params as { paths: string[]; confirm: boolean });
    case "gitCommit":
      return session.gitCommit(params as { message: string; amend?: boolean; signoff?: boolean });
    case "gitLog":
      return session.gitLog((params ?? {}) as { limit?: number; path?: string });
    case "searchSymbols": {
      const input = (params ?? {}) as { query: string } & SearchOptions;
      return session.searchSymbols(input.query, {
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}),
      });
    }
    case "listSymbols":
      return session.listSymbols((params ?? {}) as { limit?: number });
    case "graph":
      return session.graph(params as GraphRequest);
    case "listSurfaces":
      return session.listSurfaces((params ?? {}) as SurfaceFilter);
    case "flow":
      return session.flow(params as FlowRequest);
    case "diff":
      return session.diff(params as DiffRequest);
    case "listNotes":
      return session.listNotes((params ?? {}) as NoteFilter);
    case "getNote":
      return session.getNote((params as { id: string }).id);
    case "proposeNote":
      return session.proposeNote(params as NoteProposal);
    case "check":
      return session.check((params ?? {}) as CheckRequest);
    case "harnessPack":
      return session.harnessPack(params as PackRequest);
    case "readFile": {
      const input = (params ?? {}) as { path: string; rev?: "working" | "staged" };
      return session.readFile(input.path, input.rev);
    }
    default:
      throw new Error(`Unknown method: ${request.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    write({ id: 0, ok: false, error: { code: "INVALID_INPUT", message: "Invalid JSON" } });
    return;
  }
  void handle(request)
    .then((data) => write({ id: request.id, ok: true, data }))
    .catch((err: unknown) => {
      write({
        id: request.id,
        ok: false,
        error: {
          code: isReinsError(err) ? err.code : "INTERNAL",
          message: err instanceof Error ? err.message : String(err),
          retryable: isReinsError(err) ? err.retryable : false,
        },
      });
    });
});

rl.on("close", stopWatching);
process.on("SIGTERM", () => {
  stopWatching();
  process.exit(0);
});
