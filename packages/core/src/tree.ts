import { isNodeType } from "./knowledge.js";
import type { CheckItem, NodeLink, NodeStatus, NodeType } from "./types.js";

/** Knowledge tree, index, and query rules. Pure: no filesystem, no network. */

export const BASE_REQUIRED_FIELDS = ["title", "type", "status", "created", "updated"] as const;

export const coverageStates = ["covered", "stale", "orphan", "unmapped", "invalid"] as const;
export type CoverageState = (typeof coverageStates)[number];

export const RESERVED_KNOWLEDGE_FILES = ["template.md"] as const;
export const knowledgeTemplateIds = ["default", "minimal", "c4", "domain"] as const;
export type KnowledgeTemplateId = (typeof knowledgeTemplateIds)[number];
export const GUIDANCE_PREFIX = "_";

export interface TemplateLayer {
  name: string;
  glob: string;
  purpose: string;
}

export interface KnowledgeTemplate {
  layers: TemplateLayer[];
  requiredFields: string[];
  rules: string;
  raw: string;
}

export interface TemplateIssue {
  code: string;
  message: string;
}

export interface KnowledgeTreeNode {
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
  guidance: string[];
}

export interface KnowledgeComponent {
  path: string;
  name: string;
  layer: string | null;
  nodeCount: number;
  guidance: string[];
  code: string | null;
  order: string[];
  coverage: CoverageState;
}

export interface KnowledgeTree {
  template: KnowledgeTemplate | null;
  nodes: KnowledgeTreeNode[];
  components: KnowledgeComponent[];
  guidance: { path: string; component: string }[];
  errors: CheckItem[];
  hash: string;
}

export interface CoverageItem {
  component: string;
  state: CoverageState;
  message: string;
  fix: string;
  path?: string;
  address?: string;
}

export interface KnowledgeQuery {
  query: string;
  type?: NodeType;
  component?: string;
  limit?: number;
}

export interface KnowledgeHit {
  address: string;
  title: string;
  type: NodeType;
  component: string;
  score: number;
  excerpt: string;
}

export interface KnowledgeQueryResult {
  items: KnowledgeHit[];
  total: number;
  limit: number;
  tookMs: number;
  filter: { type: NodeType | null; reason: string };
}

export interface KnowledgeContextItem {
  kind: "node" | "guidance" | "link";
  path: string;
  address: string | null;
  title: string | null;
  reason: string;
  text?: string;
}

export interface KnowledgeContextPack {
  path: string;
  component: string | null;
  items: KnowledgeContextItem[];
  estimatedTokens: number;
  unmapped: boolean;
  truncated: boolean;
}

export interface KnowledgeNode extends KnowledgeTreeNode {
  body: string;
  links: NodeLink[];
  commits: string[];
  frontmatter: Record<string, unknown>;
}

export interface KnowledgeNodeInput {
  address: string;
  title: string;
  type: NodeType;
  body: string;
  tags?: string[];
  links?: NodeLink[];
  boundary?: boolean;
  layer?: string;
  component?: string;
  status?: NodeStatus;
}

export interface AiSettings {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  local: boolean;
}

export interface LocalAiProvider {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
}

export interface KnowledgeAiDraft {
  component: string;
  title: string;
  type: NodeType;
  body: string;
  tags: string[];
}

export interface KnowledgeAiResult {
  enabled: boolean;
  model: string;
  prompt: string;
  promptChars: number;
  drafts: KnowledgeAiDraft[];
  written: string[];
  skipped: string[];
}

export interface KnowledgeAcceptInput {
  address: string;
  component?: string;
}

export interface KnowledgeSaveResult {
  address: string;
  path: string;
  diff: string;
  warnings: string[];
}

export interface KnowledgeBootstrapComponent {
  component: string;
  code: string;
  title: string;
  node: string;
  files: number;
  entry: string | null;
}

export interface KnowledgeBootstrapPlan {
  template: boolean;
  components: KnowledgeBootstrapComponent[];
  skipped: Array<{ path: string; reason: string }>;
  truncated: boolean;
  cap: number;
}

export interface KnowledgeBootstrapResult extends KnowledgeBootstrapPlan {
  written: string[];
}

export interface KnowledgeMigrationResult extends KnowledgeMigrationPlan {
  written: string[];
}

export interface KnowledgeComment {
  id: string;
  author: string;
  at: string;
  body: string;
  resolved: boolean;
}

export interface KnowledgeCommentThread {
  address: string;
  comments: KnowledgeComment[];
  refAvailable: boolean;
}

export interface KnowledgeMigrationPlan {
  moves: Array<{ from: string; to: string; address: string }>;
  unresolved: string[];
}

export interface KnowledgeIndexFieldLengths {
  title: number;
  tags: number;
  headings: number;
  body: number;
  links: number;
}

export interface KnowledgeIndexEntry {
  address: string;
  title: string;
  type: NodeType;
  component: string;
  updated: string;
  hash: string;
  titleText: string;
  lengths: KnowledgeIndexFieldLengths;
  terms: Record<string, [number, number, number, number, number]>;
}

export interface KnowledgeIndexData {
  version: 1;
  builtAt: string;
  templateHash: string;
  aliasesHash: string;
  entries: KnowledgeIndexEntry[];
}

export interface KnowledgeIndexDoc {
  address: string;
  type: NodeType;
  component: string;
  updated: string;
  title: string;
  tags: string[];
  headings: string[];
  body: string;
  linkLabels: string[];
}

export interface KnowledgeSearchHit {
  address: string;
  title: string;
  type: NodeType;
  component: string;
  score: number;
}

export interface KnowledgeSearchResult {
  items: KnowledgeSearchHit[];
  total: number;
  limit: number;
  tookMs: number;
  filter: { type: NodeType | null; reason: string };
}

const FIELD_WEIGHT = [4, 3, 2, 1, 1] as const;
const K1 = 1.2;
const B = 0.75;
const ALIAS_WEIGHT = 0.6;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "does",
  "did",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        out += ".*";
        index += 1;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if ("\\^$+?.()|{}[]".includes(char ?? "")) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

export function isGuidancePath(file: string): boolean {
  const base = file.split("/").pop() ?? file;
  return base.startsWith(GUIDANCE_PREFIX);
}

export function isReservedKnowledgeFile(file: string): boolean {
  const base = file.split("/").pop() ?? file;
  return (
    (RESERVED_KNOWLEDGE_FILES as readonly string[]).includes(base) || base.startsWith("index.")
  );
}

export function knowledgeAddress(path: string, knowledgeDir: string): string {
  const prefix = `${knowledgeDir.replace(/\/$/, "")}/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return relative.replace(/\.md$/, "");
}

export function nodePathForAddress(address: string, knowledgeDir: string): string {
  return `${knowledgeDir.replace(/\/$/, "")}/${address}.md`;
}

export function componentOf(address: string): string {
  const parts = address.split("/");
  parts.pop();
  return parts.join("/");
}

export function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 3 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || raw.length < 2) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.push(stemToken(raw));
  }
  return out;
}

function countTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function hashKnowledgeText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function parseTemplate(text: string): {
  template: KnowledgeTemplate | null;
  errors: TemplateIssue[];
} {
  const errors: TemplateIssue[] = [];
  const lines = text.split(/\r?\n/);
  let section = "";
  const layers: TemplateLayer[] = [];
  const seen = new Set<string>();
  let requiredFields: string[] = [];
  let rulesStart = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      section = heading[1].toLowerCase();
      if (section === "rules" && rulesStart < 0) rulesStart = index;
      continue;
    }
    if (section === "layers") {
      if (!line.trim().startsWith("|")) continue;
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim().replace(/^`|`$/g, ""));
      if (cells.length < 2) continue;
      const name = cells[0] ?? "";
      const glob = cells[1] ?? "";
      if (!name || /^:?-+:?$/.test(name) || name.toLowerCase() === "layer") continue;
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        errors.push({
          code: "LAYER_UNDECLARED",
          message: `Layer name "${name}" is not kebab case.`,
        });
        continue;
      }
      if (seen.has(name)) {
        errors.push({ code: "TEMPLATE_INVALID", message: `Layer "${name}" is declared twice.` });
        continue;
      }
      if (!glob || glob.startsWith("/") || glob.includes("..")) {
        errors.push({
          code: "TEMPLATE_INVALID",
          message: `Layer "${name}" has an invalid glob: ${glob || "(empty)"}.`,
        });
        continue;
      }
      seen.add(name);
      layers.push({ name, glob, purpose: cells[2] ?? "" });
    }
    if (section === "required fields" && requiredFields.length === 0 && line.trim()) {
      requiredFields = line
        .replace(/^[-*]\s*/, "")
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
    }
  }

  if (layers.length === 0) {
    errors.push({
      code: "TEMPLATE_INVALID",
      message: "template.md must declare at least one layer under '## Layers'.",
    });
  }
  for (const field of BASE_REQUIRED_FIELDS) {
    if (!requiredFields.includes(field)) requiredFields.push(field);
  }
  if (rulesStart >= 0) {
    const rules = lines.slice(rulesStart).join("\n").trim();
    return {
      template: errors.some((issue) => issue.code === "TEMPLATE_INVALID")
        ? null
        : { layers, requiredFields, rules, raw: text },
      errors,
    };
  }
  return {
    template: errors.some((issue) => issue.code === "TEMPLATE_INVALID")
      ? null
      : { layers, requiredFields, rules: "", raw: text },
    errors,
  };
}

export function layerFor(template: KnowledgeTemplate | null, address: string): string | null {
  if (!template) return null;
  for (const layer of template.layers) {
    if (globToRegExp(layer.glob).test(address)) return layer.name;
  }
  return null;
}

export function templateConflicts(template: KnowledgeTemplate, address: string): string[] {
  const matches = template.layers.filter((layer) => globToRegExp(layer.glob).test(address));
  return matches.length > 1 ? matches.map((layer) => layer.name) : [];
}

export function parseAliases(text: string): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const inline = /^\s{0,2}([A-Za-z0-9][\w-]*)\s*:\s*\[(.*)\]\s*$/.exec(line);
    if (inline?.[1]) {
      const key = inline[1].toLowerCase();
      aliases[key] = (inline[2] ?? "")
        .split(",")
        .map((value) =>
          value
            .trim()
            .replace(/^['"]|['"]$/g, "")
            .toLowerCase(),
        )
        .filter(Boolean)
        .slice(0, 32);
      current = null;
      continue;
    }
    const scalar = /^\s{0,2}([A-Za-z0-9][\w-]*)\s*:\s*$/.exec(line);
    if (scalar?.[1]) {
      current = scalar[1].toLowerCase();
      aliases[current] = aliases[current] ?? [];
      continue;
    }
    const item = /^\s{2,}-\s*(.+)$/.exec(line);
    if (item?.[1] && current) {
      const values = aliases[current] ?? [];
      const value = item[1]
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .toLowerCase();
      if (value) values.push(value);
      aliases[current] = values.slice(0, 32);
    }
  }
  return aliases;
}

const intentRules: Array<{ pattern: RegExp; types: NodeType[]; reason: string }> = [
  {
    pattern: /\b(requirement|requirements|spec|specs|shall|must|acceptance)\b/i,
    types: ["spec"],
    reason: "requirement words route to specs",
  },
  {
    pattern: /\b(why|decision|decided|chose|chosen|ruled|trade-?off)\b/i,
    types: ["decision"],
    reason: "decision words route to decisions",
  },
  {
    pattern: /\b(technical|architecture|design|how|implement|implementation)\b/i,
    types: ["howto", "decision"],
    reason: "technical words route to howto and decisions",
  },
  {
    pattern: /\b(rule|rules|never|forbid|forbidden|constraint)\b/i,
    types: ["constraint"],
    reason: "rule words route to constraints",
  },
  {
    pattern: /\b(question|open|unresolved|unknown)\b/i,
    types: ["question"],
    reason: "question words route to open questions",
  },
];

export function routeIntent(query: string): { types: NodeType[] | null; reason: string } {
  for (const rule of intentRules) {
    if (rule.pattern.test(query)) return { types: rule.types, reason: rule.reason };
  }
  return { types: null, reason: "no intent words, all types searched" };
}

function emptyLengths(): KnowledgeIndexFieldLengths {
  return { title: 0, tags: 0, headings: 0, body: 0, links: 0 };
}

export function indexDoc(doc: KnowledgeIndexDoc): KnowledgeIndexEntry {
  const fields = [
    countTerms(doc.title),
    countTerms(doc.tags.join(" ")),
    countTerms(doc.headings.join(" ")),
    countTerms(doc.body),
    countTerms(doc.linkLabels.join(" ")),
  ];
  const lengths = emptyLengths();
  lengths.title = fields[0]?.size ?? 0;
  lengths.tags = fields[1]?.size ?? 0;
  lengths.headings = fields[2]?.size ?? 0;
  lengths.body = fields[3]?.size ?? 0;
  lengths.links = fields[4]?.size ?? 0;
  const terms: Record<string, [number, number, number, number, number]> = {};
  for (let field = 0; field < fields.length; field += 1) {
    for (const [term, count] of fields[field] ?? []) {
      const slot = terms[term] ?? [0, 0, 0, 0, 0];
      slot[field] = (slot[field] ?? 0) + count;
      terms[term] = slot;
    }
  }
  const hash = hashKnowledgeText(
    [
      doc.title,
      doc.tags.join(","),
      doc.headings.join(","),
      doc.body,
      doc.linkLabels.join(","),
    ].join("\n"),
  );
  return {
    address: doc.address,
    title: doc.title,
    type: doc.type,
    component: doc.component,
    updated: doc.updated,
    hash,
    titleText: doc.title.toLowerCase(),
    lengths,
    terms,
  };
}

export function buildKnowledgeIndex(
  docs: KnowledgeIndexDoc[],
  previous: KnowledgeIndexData | null,
  hashes: { templateHash: string; aliasesHash: string },
): { data: KnowledgeIndexData; parsed: number; reused: number } {
  const old = new Map(previous?.entries.map((entry) => [entry.address, entry]) ?? []);
  const entries: KnowledgeIndexEntry[] = [];
  let parsed = 0;
  let reused = 0;
  for (const doc of docs) {
    const candidate = indexDoc(doc);
    const prior = old.get(doc.address);
    if (prior && prior.hash === candidate.hash) {
      entries.push(prior);
      reused += 1;
    } else {
      entries.push(candidate);
      parsed += 1;
    }
  }
  return {
    data: {
      version: 1,
      builtAt: new Date().toISOString(),
      templateHash: hashes.templateHash,
      aliasesHash: hashes.aliasesHash,
      entries,
    },
    parsed,
    reused,
  };
}

function fieldLength(entry: KnowledgeIndexEntry): number {
  const { lengths } = entry;
  return (
    lengths.title * FIELD_WEIGHT[0] +
    lengths.tags * FIELD_WEIGHT[1] +
    lengths.headings * FIELD_WEIGHT[2] +
    lengths.body * FIELD_WEIGHT[3] +
    lengths.links * FIELD_WEIGHT[4]
  );
}

export function searchKnowledgeIndex(
  data: KnowledgeIndexData,
  input: {
    query: string;
    aliases: Record<string, string[]>;
    type?: NodeType;
    component?: string;
    limit?: number;
  },
): KnowledgeSearchResult {
  const started = Date.now();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const intent = routeIntent(input.query);
  const hardTypes = input.type ? new Set([input.type]) : null;
  const intentTypes = new Set(intent.types ?? []);

  const entries = data.entries.filter((entry) => (hardTypes ? hardTypes.has(entry.type) : true));
  const byAddress = new Map(entries.map((entry) => [entry.address, entry]));
  const totalWeight =
    entries.reduce((sum, entry) => sum + fieldLength(entry), 0) / Math.max(entries.length, 1);

  const terms = tokenize(input.query);
  const queryTerms = new Map<string, number>();
  for (const term of terms) queryTerms.set(term, 1);
  for (const term of terms) {
    for (const alias of input.aliases[term] ?? []) {
      const token = stemToken(alias.split(/\s+/)[0] ?? alias);
      if (token && !queryTerms.has(token)) queryTerms.set(token, ALIAS_WEIGHT);
    }
  }

  const scores = new Map<string, number>();
  const df = new Map<string, number>();
  for (const [term, weight] of queryTerms) {
    const matching = entries.filter((entry) => entry.terms[term]);
    df.set(term, matching.length);
    for (const entry of matching) {
      const counts = entry.terms[term];
      if (!counts) continue;
      let weightedTf = 0;
      for (let field = 0; field < counts.length; field += 1) {
        weightedTf += (counts[field] ?? 0) * (FIELD_WEIGHT[field] ?? 1);
      }
      if (weightedTf === 0) continue;
      const length = Math.max(fieldLength(entry), 1);
      const idf = Math.log(1 + (entries.length - matching.length + 0.5) / (matching.length + 0.5));
      const norm = K1 * (1 - B + (B * length) / Math.max(totalWeight, 1));
      const score = idf * ((weightedTf * (K1 + 1)) / (weightedTf + norm));
      const intentBoost = intentTypes.has(entry.type) ? 1.25 : 0;
      scores.set(
        entry.address,
        (scores.get(entry.address) ?? 0) + score * weight + (weight === 1 ? intentBoost : 0),
      );
    }
  }

  const rawLower = input.query.trim().toLowerCase();
  for (const entry of entries) {
    const current = scores.get(entry.address);
    if (current === undefined) continue;
    let bonus = 0;
    if (entry.titleText === rawLower) bonus += 6;
    else if (entry.titleText.includes(rawLower)) bonus += 3;
    if (entry.component && rawLower.includes(entry.component.split("/").pop() ?? "")) bonus += 1;
    scores.set(entry.address, current + bonus);
  }

  const hits = [...scores.entries()]
    .map(([address, score]) => {
      const entry = byAddress.get(address);
      if (!entry) return null;
      return {
        address,
        title: entry.title,
        type: entry.type,
        component: entry.component,
        score: Number(score.toFixed(4)),
      } satisfies KnowledgeSearchHit;
    })
    .filter((hit): hit is KnowledgeSearchHit => hit !== null)
    .filter((hit) => !input.component || hit.component === input.component)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (byAddress.get(right.address)?.updated ?? "").localeCompare(
          byAddress.get(left.address)?.updated ?? "",
        ) ||
        left.address.localeCompare(right.address),
    );

  return {
    items: hits.slice(0, limit),
    total: hits.length,
    limit,
    tookMs: Date.now() - started,
    filter: {
      type: input.type ?? null,
      reason: input.type
        ? "caller supplied the type filter"
        : `${intent.reason}; matching types rank higher`,
    },
  };
}

export function excerptFor(body: string, terms: string[]): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  const wanted = terms.filter(Boolean);
  const hit = lines.find((line) => wanted.some((term) => line.toLowerCase().includes(term)));
  const start = hit ? lines.indexOf(hit) : 0;
  return lines
    .slice(start, start + 2)
    .join(" ")
    .slice(0, 240);
}

export function mergeCoverage(base: CoverageState, next: CoverageState): CoverageState {
  const order: CoverageState[] = ["invalid", "stale", "orphan", "unmapped", "covered"];
  return order.indexOf(base) <= order.indexOf(next) ? base : next;
}

export function layerIssue(
  template: KnowledgeTemplate | null,
  address: string,
  declared: string | null,
): CheckItem[] {
  if (!template) return [];
  const issues: CheckItem[] = [];
  const derived = layerFor(template, address);
  if (declared && !template.layers.some((layer) => layer.name === declared)) {
    issues.push({
      code: "LAYER_UNDECLARED",
      severity: "error",
      message: `Layer "${declared}" is not declared in template.md.`,
    });
  } else if (declared && derived && declared !== derived) {
    issues.push({
      code: "LAYER_UNDECLARED",
      severity: "warning",
      message: `Layer "${declared}" does not match the template glob result "${derived}".`,
    });
  } else if (!declared && !derived) {
    issues.push({
      code: "TEMPLATE_INVALID",
      severity: "warning",
      message: "Node path matches no template layer.",
    });
  }
  return issues;
}

export function isKnowledgeType(value: string): value is NodeType {
  return isNodeType(value);
}
