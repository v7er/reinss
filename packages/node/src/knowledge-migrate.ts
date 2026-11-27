import { promises as fs } from "node:fs";
import {
  type KnowledgeMigrationPlan,
  type KnowledgeMigrationResult,
  layerFor,
  ReinsError,
} from "@reinss/core";
import matter from "gray-matter";
import { loadKnowledgeTree } from "./knowledge-tree.js";
import { resolveWithinRoot } from "./paths.js";
import { runProcess } from "./process.js";

const LEGACY_COMPONENTS = new Set([
  "specs",
  "decisions",
  "constraints",
  "howto",
  "questions",
  "inbox",
]);

export async function planKnowledgeMigration(
  root: string,
  knowledgeDir: string,
  map: Record<string, string> = {},
): Promise<KnowledgeMigrationPlan> {
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  const plan: KnowledgeMigrationPlan = { moves: [], unresolved: [] };
  for (const node of tree.nodes) {
    if (node.source !== "reins") continue;
    const legacy = node.component === "" ? "inbox" : (node.component.split("/")[0] ?? "");
    if (!LEGACY_COMPONENTS.has(legacy)) continue;
    const target = map[node.component] ?? map[legacy];
    if (!target) {
      plan.unresolved.push(node.path);
      continue;
    }
    const address = `${target.replace(/\/$/, "")}/${node.address.split("/").pop() ?? node.id}`;
    plan.moves.push({
      from: node.path,
      to: `${knowledgeDir}/${address}.md`,
      address,
    });
  }
  return plan;
}

async function gitMove(root: string, from: string, to: string): Promise<void> {
  const result = await runProcess({
    command: "git",
    args: ["mv", from, to],
    cwd: root,
    timeoutMs: 15_000,
  });
  if (result.code !== 0) {
    await fs.mkdir(resolveWithinRoot(root, to).replace(/\/[^/]+$/, ""), { recursive: true });
    await fs.rename(resolveWithinRoot(root, from), resolveWithinRoot(root, to));
  }
}

async function rewriteTarget(
  root: string,
  file: string,
  component: string,
  layer: string | null,
): Promise<void> {
  const target = resolveWithinRoot(root, file);
  const text = await fs.readFile(target, "utf8");
  const parsed = matter(text);
  parsed.data.component = component;
  if (layer) parsed.data.layer = layer;
  await fs.writeFile(target, matter.stringify(parsed.content, parsed.data), "utf8");
}

export async function migrateKnowledge(
  root: string,
  knowledgeDir: string,
  req: { write?: boolean; map?: Record<string, string> } = {},
): Promise<KnowledgeMigrationResult> {
  const plan = await planKnowledgeMigration(root, knowledgeDir, req.map ?? {});
  if (!req.write) return { ...plan, written: [] };
  if (plan.unresolved.length) {
    throw new ReinsError(
      "INVALID_INPUT",
      `Unresolved nodes, pass --map: ${plan.unresolved.join(", ")}`,
    );
  }
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  const written: string[] = [];
  for (const move of plan.moves) {
    await gitMove(root, move.from, move.to);
    const component = move.address.slice(0, move.address.lastIndexOf("/"));
    await rewriteTarget(root, move.to, component, layerFor(tree.tree.template, move.address));
    written.push(move.to);
  }
  return { ...plan, written };
}
