import { ReinsError } from "./errors.js";
import type {
  GraphEdge,
  GraphNode,
  GraphRevision,
  GraphSlice,
  SymbolHit,
  SymbolKind,
} from "./types.js";

export interface TrailSymbolJson {
  id: string;
  name: string;
  kind: string;
  path: string;
  span: string;
}

export interface TrailHitJson {
  id: string;
  relation: string;
  depth: number;
  name?: string;
  kind?: string;
  path?: string;
  span?: string;
}

export interface TrailMatchJson {
  symbol: TrailSymbolJson;
  hits: TrailHitJson[];
}

export interface TrailCallersJson {
  query: string;
  matches: TrailMatchJson[];
}

export interface TrailAskHitJson {
  kind: string;
  title: string;
  pointer: string;
  snippet: string;
  score: number;
}

export interface TrailAskJson {
  query: string;
  hits: TrailAskHitJson[];
}

export interface TrailStatusJson {
  codeMap?: { nodes?: number; inSync?: boolean };
}

const spanPattern = /^L(\d+)(?:-L(\d+))?$/;

export function parseSpan(span: string): { startLine: number; endLine: number } {
  const match = spanPattern.exec(span);
  if (!match) {
    throw new ReinsError("TRAIL_FORMAT_UNSUPPORTED", `Unsupported Trail span: ${span}`, {
      details: { span },
    });
  }
  const startLine = Number(match[1]);
  const endLine = match[2] ? Number(match[2]) : startLine;
  return { startLine, endLine };
}

const knownKinds = new Set<SymbolKind>([
  "module",
  "function",
  "method",
  "class",
  "component",
  "endpoint",
  "command",
  "handler",
  "constant",
  "type",
  "file",
  "unknown",
]);

export function normalizeKind(kind: string): SymbolKind {
  return knownKinds.has(kind as SymbolKind) ? (kind as SymbolKind) : "unknown";
}

function toNode(symbol: TrailSymbolJson, depth: number): GraphNode {
  const span = parseSpan(symbol.span);
  return {
    id: symbol.id,
    name: symbol.name,
    kind: normalizeKind(symbol.kind),
    path: symbol.path,
    startLine: span.startLine,
    endLine: span.endLine,
    depth,
    external: false,
  };
}

export interface NormalizeCallersOptions {
  direction: "in" | "out" | "both";
  depth: number;
  maxNodes: number;
  revision: GraphRevision;
  pathPrefix?: string;
}

export function normalizeCallers(
  json: TrailCallersJson,
  opts: NormalizeCallersOptions,
): GraphSlice {
  const match = json.matches[0];
  if (!match) {
    throw new ReinsError("SYMBOL_NOT_FOUND", `No symbol matched "${json.query}".`, {
      details: { query: json.query },
    });
  }

  const root = toNode(match.symbol, 0);
  const nodes = new Map<string, GraphNode>([[root.id, root]]);
  const edges = new Map<string, GraphEdge>();

  for (const hit of match.hits) {
    if (!hit.path || !hit.span || !hit.name) continue;
    if (opts.pathPrefix && !hit.path.startsWith(opts.pathPrefix)) continue;
    const node = toNode(hit as TrailSymbolJson, hit.depth);
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    const edge: GraphEdge =
      opts.direction === "out"
        ? { source: root.id, target: node.id, relation: "calls", depth: node.depth, line: null }
        : { source: node.id, target: root.id, relation: "calls", depth: node.depth, line: null };
    edges.set(`${edge.source}->${edge.target}`, edge);
  }

  const sortedNodes = [...nodes.values()].sort(
    (a, b) => a.depth - b.depth || a.path.localeCompare(b.path) || a.startLine - b.startLine,
  );
  const sortedEdges = [...edges.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );

  const truncated = sortedNodes.length > opts.maxNodes;
  const cappedNodes = truncated ? sortedNodes.slice(0, opts.maxNodes) : sortedNodes;
  const kept = new Set(cappedNodes.map((n) => n.id));
  const cappedEdges = sortedEdges.filter((e) => kept.has(e.source) && kept.has(e.target));

  return {
    contractVersion: 1,
    root,
    direction: opts.direction,
    requestedDepth: opts.depth,
    effectiveDepth: Math.min(opts.depth, 5),
    nodes: cappedNodes,
    edges: cappedEdges,
    truncated,
    truncatedBy: truncated ? "nodes" : null,
    revision: opts.revision,
  };
}

export function mergeSlices(a: GraphSlice, b: GraphSlice, maxNodes: number): GraphSlice {
  const nodes = new Map<string, GraphNode>();
  for (const node of [...a.nodes, ...b.nodes]) {
    const existing = nodes.get(node.id);
    if (!existing || node.depth < existing.depth) nodes.set(node.id, node);
  }
  const edges = new Map<string, GraphEdge>();
  for (const edge of [...a.edges, ...b.edges]) {
    edges.set(`${edge.source}->${edge.target}`, edge);
  }
  const sortedNodes = [...nodes.values()].sort(
    (x, y) => x.depth - y.depth || x.path.localeCompare(y.path) || x.startLine - y.startLine,
  );
  const truncated = sortedNodes.length > maxNodes;
  const capped = truncated ? sortedNodes.slice(0, maxNodes) : sortedNodes;
  const kept = new Set(capped.map((n) => n.id));
  return {
    ...a,
    nodes: capped,
    edges: [...edges.values()].filter((e) => kept.has(e.source) && kept.has(e.target)),
    truncated: a.truncated || b.truncated || truncated,
    truncatedBy: truncated ? "nodes" : (a.truncatedBy ?? b.truncatedBy),
  };
}

export function normalizeAsk(json: TrailAskJson, limit: number): SymbolHit[] {
  return json.hits.slice(0, limit).map((hit) => {
    const pointer = hit.pointer;
    const match = /^(.*?):L(\d+)(?:-L(\d+))?$/.exec(pointer);
    const path = match?.[1] ?? pointer;
    const startLine = match ? Number(match[2]) : null;
    const endLine = match?.[3] ? Number(match[3]) : startLine;
    const [name = hit.title, kindLabel] = hit.title.split(" · ");
    const kind = hit.kind === "file" ? "file" : normalizeKind(kindLabel ?? "unknown");
    return {
      id: match ? `${path}#${name}` : null,
      name,
      kind,
      path,
      startLine,
      endLine,
      snippet: hit.snippet,
      score: hit.score,
    };
  });
}

export async function computeFingerprint(input: {
  trailVersion: string;
  nodes: number;
  inSync: boolean;
  gitHead: string | null;
  gitDirty: boolean;
  adapterVersion: string;
  contractVersion: number;
}): Promise<string> {
  const text = [
    input.trailVersion,
    String(input.nodes),
    String(input.inSync),
    input.gitHead ?? "",
    String(input.gitDirty),
    input.adapterVersion,
    String(input.contractVersion),
  ].join("\n");
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
