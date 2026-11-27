import readline from "node:readline";
import {
  type CheckRequest,
  type DiffRequest,
  type FlowRequest,
  type GraphRequest,
  isReinsError,
  type KnowledgeNodeInput,
  type KnowledgeQuery,
  type NodeProposal,
  type PackRequest,
  type RefreshOptions,
  type SearchOptions,
  type SurfaceFilter,
} from "@reinss/core";
import {
  createSession,
  type RepoSession,
  type RepoWatcher,
  realRoot,
  watchRepo,
} from "@reinss/node";

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
    case "gitGraph":
      return session.gitGraph((params ?? {}) as { limit?: number });
    case "gitCommitRefs":
      return session.gitCommitRefs(params as { hash: string });
    case "gitMerge":
      return session.gitMerge(params as { source: string; target: string });
    case "gitReviews":
      return session.gitReviews();
    case "gitBranches":
      return session.gitBranches();
    case "gitCheckoutBranch":
      return session.gitCheckoutBranch(params as { name: string; remote?: boolean });
    case "gitCreateBranch":
      return session.gitCreateBranch(
        params as { name: string; startPoint?: string; checkout?: boolean },
      );
    case "gitDeleteBranch":
      return session.gitDeleteBranch(params as { name: string; force?: boolean });
    case "gitTags":
      return session.gitTags();
    case "gitCreateTag":
      return session.gitCreateTag(params as { name: string; ref?: string; message?: string });
    case "gitDeleteTag":
      return session.gitDeleteTag(params as { name: string });
    case "gitWorktrees":
      return session.gitWorktrees();
    case "gitSync":
      return session.gitSync((params ?? {}) as { tags?: boolean });
    case "gitRebase":
      return session.gitRebase(params as { branch: string; upstream?: string });
    case "gitPush":
      return session.gitPush(params as { branch: string });
    case "gitAddWorktree":
      return session.gitAddWorktree(
        params as {
          path: string;
          branch?: string;
          createBranch?: boolean;
          startPoint?: string;
          detach?: boolean;
        },
      );
    case "gitRemoveWorktree":
      return session.gitRemoveWorktree(params as { path: string; force?: boolean });
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
    case "proposeNode":
      return session.proposeNode(params as NodeProposal);
    case "initKnowledge":
      return session.initKnowledge((params as { template?: string } | undefined)?.template);
    case "aiSettings":
      return session.aiSettings();
    case "saveAiSettings":
      return session.saveAiSettings(
        params as { enabled: boolean; provider?: string; model?: string; baseUrl?: string },
      );
    case "discoverAi":
      return session.discoverAi();
    case "aiKnowledgeInit":
      return session.aiKnowledgeInit(
        params as { write?: boolean; maxComponents?: number; maxDrafts?: number } | undefined,
      );
    case "knowledgeTree":
      return session.knowledgeTree();
    case "acceptKnowledgeNode":
      return session.acceptKnowledgeNode(params as { address: string; component?: string });
    case "knowledgeNode":
      return session.knowledgeNode((params as { address: string }).address);
    case "saveKnowledgeNode":
      return session.saveKnowledgeNode(params as KnowledgeNodeInput);
    case "searchKnowledge":
      return session.searchKnowledge(params as KnowledgeQuery);
    case "knowledgeContext":
      return session.knowledgeContext((params as { path: string }).path);
    case "knowledgeCoverage":
      return session.knowledgeCoverage();
    case "bootstrapKnowledge":
      return session.bootstrapKnowledge(
        params as { maxComponents?: number; write?: boolean; dir?: string } | undefined,
      );
    case "migrateKnowledge":
      return session.migrateKnowledge(params as { write?: boolean; map?: Record<string, string> });
    case "knowledgeComments":
      return session.knowledgeComments((params as { address: string }).address);
    case "addKnowledgeComment":
      return session.addKnowledgeComment(params as { address: string; body: string });
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
