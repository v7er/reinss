import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CheckItem,
  knowledgeAddress,
  linkTarget,
  type NodeLink,
  type NodeProposal,
  type NodeProposalResult,
  type NodeStatus,
  type NodeType,
  nodeFrontmatterSchema,
  nodeSlugFromTitle,
  ReinsError,
} from "@reinss/core";
import { createTwoFilesPatch } from "diff";
import fg from "fast-glob";
import matter from "gray-matter";
import { resolveWithinRoot, writeAtomic } from "./paths.js";

export interface ParsedNode {
  address: string;
  id: string;
  title: string;
  type: NodeType;
  status: NodeStatus;
  tags: string[];
  updated: string;
  path: string;
  component: string;
  layer: string | null;
  boundary: boolean;
  code: string | null;
  source: "reins" | "openspec";
  linkCount: number;
  backlinkCount: number;
  body: string;
  links: NodeLink[];
  commits: string[];
  mentions: string[];
  frontmatter: Record<string, unknown>;
}

export interface LoadedNodes {
  nodes: ParsedNode[];
  byId: Map<string, ParsedNode>;
  byAddress: Map<string, ParsedNode>;
  guidance: string[];
  template: string | null;
  backlinks: Map<string, string[]>;
  errors: CheckItem[];
  hash: string;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function extractMentions(body: string): string[] {
  const mentions = new Set<string>();
  for (const match of body.matchAll(/\[\[([a-z0-9][a-z0-9-]{1,63})\]\]/g)) {
    if (match[1]) mentions.add(match[1]);
  }
  return [...mentions];
}

function normalizeLinks(value: unknown): NodeLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter((link): link is NodeLink => {
    if (!link || typeof link !== "object") return false;
    const record = link as Record<string, unknown>;
    return typeof record.rel === "string";
  });
}

function parseNode(input: {
  id: string;
  address: string;
  file: string;
  text: string;
  source: "reins" | "openspec";
}): { node: ParsedNode | null; error: CheckItem | null } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(input.text);
  } catch (err) {
    return {
      node: null,
      error: {
        code: "NODE_INVALID",
        severity: "error",
        message: `Could not parse frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        path: input.file,
      },
    };
  }
  const result = nodeFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      node: null,
      error: {
        code: "NODE_INVALID",
        severity: "error",
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        path: input.file,
      },
    };
  }
  const data = result.data;
  const links = normalizeLinks(data.links);
  const folder = input.address.includes("/")
    ? input.address.slice(0, input.address.lastIndexOf("/"))
    : "";
  return {
    node: {
      address: input.address,
      id: input.id,
      title: data.title,
      type: data.type,
      status: data.status,
      tags: data.tags,
      updated: data.updated,
      path: input.file,
      component: data.component ?? folder,
      layer: data.layer ?? null,
      boundary: data.boundary ?? false,
      code: data.code ?? null,
      source: input.source,
      linkCount: links.length,
      backlinkCount: 0,
      body: parsed.content.trim(),
      links,
      commits: data.commits,
      mentions: extractMentions(parsed.content),
      frontmatter: parsed.data as Record<string, unknown>,
    },
    error: null,
  };
}

const openspecPatterns = [
  "openspec/config.yaml",
  "openspec/project.md",
  "openspec/specs/**/spec.md",
  "openspec/changes/**/{proposal,design,tasks,spec}.md",
];

async function openspecFiles(root: string): Promise<string[]> {
  const files = await fg(openspecPatterns, {
    cwd: root,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
  return files.sort();
}

export async function listOpenSpecFiles(root: string): Promise<string[]> {
  return openspecFiles(root);
}

function openspecKind(file: string): { kind: string; type: NodeType } {
  if (file === "openspec/config.yaml") return { kind: "config", type: "constraint" };
  if (file === "openspec/project.md") return { kind: "project", type: "spec" };
  if (file.endsWith("/proposal.md")) return { kind: "proposal", type: "spec" };
  if (file.endsWith("/design.md")) return { kind: "design", type: "decision" };
  if (file.endsWith("/tasks.md")) return { kind: "tasks", type: "howto" };
  return { kind: "spec", type: "spec" };
}

function slugify(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function fitId(id: string): string {
  return id.length <= 64 ? id : `${id.slice(0, 55)}-${hashText(id)}`;
}

function openspecId(file: string): string {
  if (file === "openspec/config.yaml") return "openspec-config";
  if (file === "openspec/project.md") return "openspec-project";
  const spec = /^openspec\/specs\/(.+)\/spec\.md$/.exec(file);
  if (spec?.[1]) return fitId(`openspec-spec-${slugify(spec[1])}`);
  const delta = /^openspec\/changes\/(.+)\/specs\/(.+)\/spec\.md$/.exec(file);
  if (delta?.[1] && delta[2]) {
    return fitId(`openspec-change-${slugify(delta[1])}-spec-${slugify(delta[2])}`);
  }
  const change = /^openspec\/changes\/(.+)\/(proposal|design|tasks)\.md$/.exec(file);
  if (change?.[1] && change[2]) {
    return fitId(`openspec-change-${slugify(change[1])}-${change[2]}`);
  }
  return fitId(`openspec-${slugify(file.replace(/^openspec\//, "").replace(/\.md$/, ""))}`);
}

function titleFromText(text: string, fallback: string): string {
  const match = /^#\s+(.+)$/m.exec(text);
  return (match?.[1]?.trim() ?? fallback).slice(0, 120);
}

async function openspecNodes(
  root: string,
): Promise<
  Array<{ id: string; file: string; text: string; type: NodeType; updated: string; kind: string }>
> {
  const results: Array<{
    id: string;
    file: string;
    text: string;
    type: NodeType;
    updated: string;
    kind: string;
  }> = [];
  for (const file of await openspecFiles(root)) {
    const text = await fs.readFile(resolveWithinRoot(root, file), "utf8");
    const stat = await fs.stat(resolveWithinRoot(root, file));
    const { kind, type } = openspecKind(file);
    results.push({
      id: openspecId(file),
      file,
      text,
      type,
      updated: stat.mtime.toISOString().slice(0, 10),
      kind,
    });
  }
  return results;
}

function openspecToNode(input: {
  id: string;
  file: string;
  text: string;
  type: NodeType;
  updated: string;
  kind: string;
}): ParsedNode {
  const fallback = input.kind === "config" ? "OpenSpec project config" : input.id;
  return {
    address: input.file.replace(/\.md$/, ""),
    id: input.id,
    title: titleFromText(input.text, fallback),
    type: input.type,
    status: "accepted",
    tags: ["openspec", input.kind],
    updated: input.updated,
    path: input.file,
    component: input.file.split("/").slice(0, -1).join("/"),
    layer: null,
    boundary: false,
    code: null,
    source: "openspec",
    linkCount: 0,
    backlinkCount: 0,
    body: input.text.trim(),
    links: [],
    commits: [],
    mentions: [],
    frontmatter: { source: "openspec", type: input.type, openspec: { kind: input.kind } },
  };
}

export async function loadKnowledgeNodes(root: string, knowledgeDir: string): Promise<LoadedNodes> {
  const nodes: ParsedNode[] = [];
  const errors: CheckItem[] = [];
  const byId = new Map<string, ParsedNode>();
  const byAddress = new Map<string, ParsedNode>();
  const guidance: string[] = [];
  let template: string | null = null;
  const files = await fg([`${knowledgeDir}/**/*.md`], {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**"],
  });

  for (const file of files) {
    const base = path.basename(file);
    const text = await fs.readFile(resolveWithinRoot(root, file), "utf8");
    if (base === "template.md") {
      template = text;
      continue;
    }
    if (base.startsWith("_")) {
      guidance.push(file);
      continue;
    }
    if (base.startsWith("index.")) continue;
    const id = path.basename(file, ".md");
    const address = knowledgeAddress(file, knowledgeDir);
    const parsed = parseNode({ id, address, file, text, source: "reins" });
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }
    if (!parsed.node) continue;
    if (byAddress.has(address)) {
      errors.push({
        code: "NOTE_ADDRESS_DUPLICATE",
        severity: "error",
        message: `Duplicate node address "${address}".`,
        nodeId: id,
        path: file,
      });
      continue;
    }
    byAddress.set(address, parsed.node);
    if (byId.has(id)) {
      errors.push({
        code: "NODE_DUPLICATE_ID",
        severity: "error",
        message: `Duplicate node id "${id}".`,
        nodeId: id,
        path: file,
      });
      continue;
    }
    byId.set(id, parsed.node);
    nodes.push(parsed.node);
  }

  for (const openspecNode of await openspecNodes(root)) {
    if (byId.has(openspecNode.id)) continue;
    const node = openspecToNode(openspecNode);
    byId.set(node.id, node);
    byAddress.set(node.address, node);
    nodes.push(node);
  }

  const backlinks = new Map<string, string[]>();
  for (const node of nodes) {
    for (const link of node.links) {
      const target = linkTarget(link);
      if (target.kind === "node") {
        const resolved = byId.get(target.value) ?? byAddress.get(target.value);
        const key = resolved?.id ?? target.value;
        const list = backlinks.get(key) ?? [];
        list.push(node.id);
        backlinks.set(key, list);
      }
    }
    for (const mention of node.mentions) {
      const list = backlinks.get(mention) ?? [];
      list.push(node.id);
      backlinks.set(mention, list);
    }
  }
  for (const node of nodes) {
    node.backlinkCount = backlinks.get(node.id)?.length ?? 0;
  }

  const hash = hashText(nodes.map((node) => `${node.id}:${node.updated}:${node.body}`).join("\n"));
  return { nodes, byId, byAddress, guidance, template, backlinks, errors, hash };
}

export async function proposeNode(
  root: string,
  knowledgeDir: string,
  input: NodeProposal,
  existing: LoadedNodes,
): Promise<NodeProposalResult> {
  const baseSlug = nodeSlugFromTitle(input.title);
  let slug = baseSlug;
  let suffix = 2;
  while (existing.byAddress.has(`inbox/${slug}`)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  const file = `${knowledgeDir}/inbox/${slug}.md`;
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = {
    title: input.title,
    type: input.type,
    status: "proposed",
    created: today,
    updated: today,
    tags: input.tags ?? [],
    links: input.links ?? [],
    commits: [],
    component: "inbox",
    layer: "inbox",
    provenance: input.source ?? { kind: "manual" },
  };
  const text = matter.stringify(`\n${input.body.trim()}\n`, frontmatter);
  const target = resolveWithinRoot(root, file);
  try {
    await fs.access(target);
    throw new ReinsError("NODE_EXISTS", `Node already exists: ${file}`);
  } catch (err) {
    if (err instanceof ReinsError) throw err;
  }
  await writeAtomic(root, file, text);
  const diff = createTwoFilesPatch(`a/${file}`, `b/${file}`, "", text, "new node", "proposed");
  const warnings: string[] = [];
  for (const link of input.links ?? []) {
    const targetValue = linkTarget(link);
    if (targetValue.kind === "node" && !existing.byAddress.has(targetValue.value)) {
      warnings.push(`Unknown node link: ${targetValue.value}`);
    }
  }
  return { address: `inbox/${slug}`, path: file, status: "proposed", diff, warnings };
}
