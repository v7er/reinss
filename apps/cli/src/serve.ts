import readline from "node:readline";
import { isReinsError } from "@reins/core";
import { createSession, type RepoSession, realRoot } from "@reins/node";

interface Request {
  id: number;
  method: string;
  params?: unknown;
}

let session: RepoSession | null = null;

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function handle(request: Request): Promise<unknown> {
  if (request.method === "open") {
    const params = request.params as { root?: string } | undefined;
    if (!params?.root) throw new Error("open requires a root path");
    session = await createSession(await realRoot(params.root));
    return session.status();
  }
  if (request.method === "close") {
    session = null;
    return null;
  }
  if (!session) {
    throw new Error("REPO_NOT_OPEN: open a repository first");
  }
  const fn = (session as unknown as Record<string, unknown>)[request.method];
  if (typeof fn !== "function") {
    throw new Error(`Unknown method: ${request.method}`);
  }
  return (fn as (this: RepoSession, params?: unknown) => Promise<unknown>).call(
    session,
    request.params,
  );
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
