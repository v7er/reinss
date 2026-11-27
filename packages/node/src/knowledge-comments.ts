import { type KnowledgeComment, type KnowledgeCommentThread, ReinsError } from "@reinss/core";
import { requireNode } from "./knowledge-index.js";
import { runProcess } from "./process.js";

const NOTES_REF = "refs/notes/reins";

interface NotesPayload {
  version: 1;
  threads: Array<{ node: string; comments: KnowledgeComment[] }>;
}

async function git(
  root: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await runProcess({
    command: "git",
    args,
    cwd: root,
    timeoutMs: 15_000,
    maxOutputBytes: 256 * 1024,
  });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

async function readPayload(root: string, sha: string): Promise<NotesPayload | null> {
  const result = await git(root, ["notes", `--ref=${NOTES_REF}`, "show", sha]);
  if (result.code !== 0 || !result.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout) as NotesPayload;
    if (parsed.version !== 1 || !Array.isArray(parsed.threads)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function knowledgeComments(
  root: string,
  knowledgeDir: string,
  address: string,
): Promise<KnowledgeCommentThread> {
  const node = await requireNode(root, knowledgeDir, address);
  const log = await git(root, ["log", "--format=%H", "-n", "50", "--", node.path]);
  const commits = log.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // A new or just-accepted node has no commit of its own yet. Include HEAD so a
  // comment written before the next commit is still visible.
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (head.code === 0 && head.stdout.trim()) commits.unshift(head.stdout.trim());
  const unique = [...new Set(commits)];
  let refAvailable = false;
  const comments: KnowledgeComment[] = [];
  const seen = new Set<string>();
  for (const sha of unique) {
    const payload = await readPayload(root, sha);
    if (!payload) continue;
    refAvailable = true;
    for (const thread of payload.threads) {
      if (thread.node !== node.address) continue;
      for (const comment of thread.comments) {
        if (!comment.id || seen.has(comment.id)) continue;
        seen.add(comment.id);
        comments.push(comment);
      }
    }
  }
  return {
    address: node.address,
    comments: comments.sort((left, right) => left.at.localeCompare(right.at)),
    refAvailable,
  };
}

export async function addKnowledgeComment(
  root: string,
  knowledgeDir: string,
  address: string,
  body: string,
): Promise<KnowledgeCommentThread> {
  const text = body.trim();
  if (!text) throw new ReinsError("INVALID_INPUT", "A comment body is required.");
  const node = await requireNode(root, knowledgeDir, address);
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new ReinsError("GIT_FAILED", "Cannot read HEAD to attach a comment.");
  const sha = head.stdout.trim();
  const user = await git(root, ["config", "user.name"]);
  const author = user.stdout.trim() || process.env.USER || "unknown";
  const payload = (await readPayload(root, sha)) ?? { version: 1 as const, threads: [] };
  const thread = payload.threads.find((item) => item.node === node.address);
  const comment: KnowledgeComment = {
    id: `c${Date.now().toString(36)}`,
    author,
    at: new Date().toISOString(),
    body: text,
    resolved: false,
  };
  if (thread) thread.comments.push(comment);
  else payload.threads.push({ node: node.address, comments: [comment] });
  const write = await git(root, [
    "notes",
    `--ref=${NOTES_REF}`,
    "add",
    "-f",
    "-m",
    JSON.stringify(payload),
    sha,
  ]);
  if (write.code !== 0) {
    throw new ReinsError("GIT_FAILED", `Could not write the comment note: ${write.stderr.trim()}`);
  }
  return knowledgeComments(root, knowledgeDir, node.address);
}

export const notesRef = NOTES_REF;
