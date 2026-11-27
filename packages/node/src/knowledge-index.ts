import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildKnowledgeIndex,
  estimateTokens,
  excerptFor,
  hashKnowledgeText,
  type KnowledgeAcceptInput,
  type KnowledgeContextItem,
  type KnowledgeContextPack,
  type KnowledgeHit,
  type KnowledgeIndexData,
  type KnowledgeIndexDoc,
  type KnowledgeNode,
  type KnowledgeNodeInput,
  type KnowledgeQuery,
  type KnowledgeQueryResult,
  type KnowledgeSaveResult,
  layerFor,
  type NodeLink,
  nodeFrontmatterSchema,
  ReinsError,
  searchKnowledgeIndex,
  tokenize,
} from "@reinss/core";
import { createTwoFilesPatch } from "diff";
import matter from "gray-matter";
import { readCache, writeCache } from "./cache.js";
import { type LoadedTree, loadKnowledgeTree, readGuidanceText } from "./knowledge-tree.js";
import { resolveWithinRoot, writeAtomic } from "./paths.js";

const INDEX_CACHE = ".reins/.cache/knowledge-index.json";
const PACK_TOKEN_CAP = 4000;
const PACK_MAX_RESULTS = 20;

export interface BuiltKnowledgeIndex {
  data: KnowledgeIndexData;
  parsed: number;
  reused: number;
  tookMs: number;
}

export function headingsOf(body: string): string[] {
  return [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? "");
}

function linkLabelsOf(node: KnowledgeNode): string[] {
  return node.links.flatMap((link) => Object.values(link).filter((value) => value !== link.rel));
}

function searchableNodes(tree: LoadedTree): KnowledgeNode[] {
  return tree.nodes.filter((node) => node.status === "accepted" || node.status === "proposed");
}

export async function buildTreeIndex(root: string, tree: LoadedTree): Promise<BuiltKnowledgeIndex> {
  const started = Date.now();
  const previous = await readCache<KnowledgeIndexData>(root, INDEX_CACHE);
  const docs: KnowledgeIndexDoc[] = searchableNodes(tree).map((node) => ({
    address: node.address,
    type: node.type,
    component: node.component,
    updated: node.updated,
    title: node.title,
    tags: node.tags,
    headings: headingsOf(node.body),
    body: node.body,
    linkLabels: linkLabelsOf(node),
  }));
  const aliasesHash = hashKnowledgeText(JSON.stringify(tree.aliases));
  const templateHash = hashKnowledgeText(tree.templateText ?? "");
  const built = buildKnowledgeIndex(docs, previous?.data ?? null, {
    templateHash,
    aliasesHash,
  });
  await writeCache(root, INDEX_CACHE, tree.tree.hash, built.data);
  return {
    data: built.data,
    parsed: built.parsed,
    reused: built.reused,
    tookMs: Date.now() - started,
  };
}

export async function queryKnowledge(
  root: string,
  knowledgeDir: string,
  query: KnowledgeQuery,
): Promise<KnowledgeQueryResult & { index: BuiltKnowledgeIndex }> {
  const started = Date.now();
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  const index = await buildTreeIndex(root, tree);
  const result = searchKnowledgeIndex(index.data, {
    query: query.query,
    aliases: tree.aliases,
    ...(query.type ? { type: query.type } : {}),
    ...(query.component ? { component: query.component } : {}),
    ...(query.limit ? { limit: query.limit } : {}),
  });
  const byAddress = new Map(searchableNodes(tree).map((node) => [node.address, node]));
  const terms = tokenize(query.query);
  const items: KnowledgeHit[] = result.items.map((hit) => {
    const node = byAddress.get(hit.address);
    return {
      ...hit,
      title: node?.title ?? hit.title,
      excerpt: excerptFor(node?.body ?? "", terms),
    };
  });
  return {
    ...result,
    items,
    tookMs: Date.now() - started,
    index,
  };
}

export async function knowledgeContext(
  root: string,
  knowledgeDir: string,
  codePath: string,
): Promise<KnowledgeContextPack> {
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  const normalized = codePath.replace(/^\.\//, "").replace(/\/$/, "");
  const areas = tree.tree.components.filter((component) => component.code);
  let component = areas.find(
    (item) => normalized === item.code || normalized.startsWith(`${item.code}/`),
  );
  if (!component) {
    const base = path.posix.basename(normalized).toLowerCase();
    component = areas.find((item) => item.name.toLowerCase() === base);
  }

  const items: KnowledgeContextItem[] = [];
  if (!component) {
    return {
      path: normalized,
      component: null,
      items: [],
      estimatedTokens: 0,
      unmapped: true,
      truncated: false,
    };
  }

  const componentNodes = tree.nodes.filter(
    (node) => node.source === "reins" && node.component === component.path,
  );
  const boundary = componentNodes.find((node) => node.boundary) ?? componentNodes[0];
  if (boundary) {
    items.push({
      kind: "node",
      path: boundary.path,
      address: boundary.address,
      title: boundary.title,
      reason: `owns ${component.code}`,
      text: boundary.body,
    });
  }
  for (const node of componentNodes) {
    if (node === boundary) continue;
    items.push({
      kind: "node",
      path: node.path,
      address: node.address,
      title: node.title,
      reason: `${node.type} in ${component.path}`,
      text: node.body,
    });
  }

  const guidancePaths = component.path
    ? tree.tree.guidance
        .filter(
          (entry) =>
            entry.component === component?.path ||
            entry.component === "" ||
            component?.path.startsWith(`${entry.component}/`) === true,
        )
        .map((entry) => entry.path)
    : [];
  const guidanceTexts = await readGuidanceText(root, guidancePaths.slice(-8));
  guidanceTexts.forEach((text, position) => {
    const file = guidancePaths.slice(-8)[position];
    if (!file) return;
    items.push({
      kind: "guidance",
      path: file,
      address: null,
      title: path.posix.basename(file),
      reason: "local rule for this component",
      text,
    });
  });

  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const byAddress = new Map(tree.nodes.map((node) => [node.address, node]));
  for (const node of componentNodes) {
    for (const link of node.links) {
      if (!("note" in link)) continue;
      const target = byId.get(link.note) ?? byAddress.get(link.note);
      if (!target || target.address === node.address) continue;
      items.push({
        kind: "link",
        path: target.path,
        address: target.address,
        title: target.title,
        reason: `${link.rel} by ${node.title}`,
        text: target.body,
      });
    }
  }

  const capped: KnowledgeContextItem[] = [];
  let used = 0;
  let truncated = false;
  for (const item of items) {
    const size = estimateTokens(`${item.path}\n${item.text ?? ""}`);
    if (capped.length >= PACK_MAX_RESULTS || used + size > PACK_TOKEN_CAP) {
      truncated = true;
      continue;
    }
    used += size;
    capped.push(item);
  }

  return {
    path: normalized,
    component: component.path,
    items: capped,
    estimatedTokens: used,
    unmapped: false,
    truncated,
  };
}

function baseRequiredIssues(input: KnowledgeNodeInput): string[] {
  const issues: string[] = [];
  if (!input.title.trim() || input.title.length > 120) issues.push("title must be 1 to 120 chars");
  if (!input.body.trim()) issues.push("body must not be empty");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.address.split("/").pop() ?? "")) {
    issues.push("node file name must be lowercase kebab case");
  }
  return issues;
}

export async function saveKnowledgeNode(
  root: string,
  knowledgeDir: string,
  input: KnowledgeNodeInput,
): Promise<KnowledgeSaveResult> {
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  if (!tree.tree.template) {
    throw new ReinsError("TEMPLATE_MISSING", `${knowledgeDir}/template.md is required.`);
  }
  const issues = baseRequiredIssues(input);
  if (issues.length) throw new ReinsError("INVALID_INPUT", issues.join("; "));

  const address = input.address.replace(/^\/+/, "").replace(/\.md$/, "");
  const component =
    input.component ?? (address.includes("/") ? address.slice(0, address.lastIndexOf("/")) : "");
  const layer = input.layer ?? layerFor(tree.tree.template, address);
  if (layer && !tree.tree.template.layers.some((item) => item.name === layer)) {
    throw new ReinsError("LAYER_UNDECLARED", `Layer "${layer}" is not declared in template.md.`);
  }
  if (!layer) {
    throw new ReinsError(
      "LAYER_UNDECLARED",
      `Node address "${address}" matches no layer glob in template.md.`,
    );
  }
  const target = `${knowledgeDir}/${address}.md`;
  resolveWithinRoot(root, target);

  const existing = tree.nodes.find((node) => node.address === address);
  if (
    input.boundary &&
    tree.nodes.some(
      (node) => node.component === component && node.boundary && node.address !== address,
    )
  ) {
    throw new ReinsError(
      "COMPONENT_MISMATCH",
      `Component "${component}" already has a boundary node.`,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  let previousText = "";
  let previousData: Record<string, unknown> = {};
  if (existing) {
    previousText = await fs.readFile(resolveWithinRoot(root, target), "utf8");
    previousData = { ...(existing.frontmatter ?? {}) };
  }
  const links: NodeLink[] = input.links ?? (existing?.links as NodeLink[] | undefined) ?? [];
  const data = {
    ...previousData,
    title: input.title,
    type: input.type,
    status: input.status ?? existing?.status ?? "accepted",
    created: (previousData.created as string | undefined) ?? today,
    updated: today,
    tags: input.tags ?? existing?.tags ?? [],
    links,
    component,
    layer,
    ...((input.boundary ?? existing?.boundary) ? { boundary: true } : {}),
    ...(component && tree.tree.components.find((item) => item.path === component)?.code
      ? { code: tree.tree.components.find((item) => item.path === component)?.code }
      : {}),
  };
  const parsed = nodeFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new ReinsError(
      "INVALID_INPUT",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const body = input.body.trim();
  const text = matter.stringify(`\n${body}\n`, parsed.data as Record<string, unknown>);
  const warnings: string[] = [];
  for (const link of links) {
    if (
      "note" in link &&
      !tree.nodes.some((node) => node.id === link.note || node.address === link.note)
    ) {
      warnings.push(`Unknown note link: ${link.note}`);
    }
  }
  await writeAtomic(root, target, text);
  const diff = createTwoFilesPatch(
    `a/${target}`,
    `b/${target}`,
    previousText,
    text,
    existing ? "before" : "new node",
    "after",
  );
  return { address, path: target, diff, warnings };
}

export async function requireNode(
  root: string,
  knowledgeDir: string,
  address: string,
): Promise<KnowledgeNode> {
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  const node =
    tree.nodes.find((item) => item.address === address) ??
    tree.nodes.find((item) => item.id === address);
  if (!node) throw new ReinsError("NODE_NOT_FOUND", `Unknown node: ${address}`);
  return node;
}

export async function acceptKnowledgeNode(
  root: string,
  knowledgeDir: string,
  input: KnowledgeAcceptInput,
): Promise<KnowledgeSaveResult> {
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  const node = tree.nodes.find(
    (item) => item.address === input.address || item.id === input.address,
  );
  if (!node) throw new ReinsError("NODE_NOT_FOUND", `Unknown node: ${input.address}`);
  if (node.source !== "reins")
    throw new ReinsError("INVALID_INPUT", "An OpenSpec node cannot be accepted.");
  const target = input.component ?? node.component;
  if (!target || target === "inbox") {
    throw new ReinsError("INVALID_INPUT", "An accept needs the destination component.");
  }
  const address = `${target}/${node.address.split("/").pop() ?? node.id}`;
  const layer = layerFor(tree.tree.template, address);
  if (!layer) {
    throw new ReinsError("LAYER_UNDECLARED", `Component "${target}" is under no template layer.`);
  }
  const source = resolveWithinRoot(root, node.path);
  const text = await fs.readFile(source, "utf8");
  const parsed = matter(text);
  const today = new Date().toISOString().slice(0, 10);
  parsed.data.status = "accepted";
  parsed.data.updated = today;
  parsed.data.component = target;
  parsed.data.layer = layer;
  const next = matter.stringify(parsed.content, parsed.data);
  const destination = `${knowledgeDir}/${address}.md`;
  await writeAtomic(root, destination, next);
  if (destination !== node.path) await fs.rm(source, { force: true });
  const diff = createTwoFilesPatch(
    `a/${node.path}`,
    `b/${destination}`,
    text,
    next,
    "proposed",
    "accepted",
  );
  return { address, path: destination, diff, warnings: [] };
}
