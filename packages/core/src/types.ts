export const contractVersion = 1 as const;

export type SymbolKind =
  | "module"
  | "function"
  | "method"
  | "class"
  | "component"
  | "endpoint"
  | "command"
  | "handler"
  | "constant"
  | "type"
  | "file"
  | "unknown";

export type Language =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "vue"
  | "unknown";

export interface GraphNode {
  id: string;
  name: string;
  kind: SymbolKind;
  path: string;
  startLine: number;
  endLine: number;
  signature?: string | null;
  language?: string | null;
  depth: number;
  external: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: "calls" | "references";
  depth: number;
  line: number | null;
}

export interface GraphRevision {
  fingerprint: string;
  trailVersion: string;
  gitHead: string | null;
  inSync: boolean;
  checkedAt: string;
}

export interface GraphSlice {
  contractVersion: 1;
  root: GraphNode | null;
  direction: "in" | "out" | "both";
  requestedDepth: number;
  effectiveDepth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  truncatedBy: "nodes" | "time" | null;
  revision: GraphRevision;
}

export interface SymbolHit {
  id: string | null;
  name: string;
  kind: SymbolKind;
  path: string;
  startLine: number | null;
  endLine: number | null;
  snippet: string;
  score: number;
}

export type GraphState =
  | "ready"
  | "stale"
  | "missing-trail"
  | "unsupported-trail"
  | "missing-graft"
  | "error";

export interface RepoStatus {
  contractVersion: 1;
  repo: { name: string; root: string | null };
  git: { head: string | null; branch: string | null; dirty: boolean };
  trail: { version: string | null; minVersion: string; graftDir: string };
  graph: {
    state: GraphState;
    inSync: boolean;
    nodes: number | null;
    checkedAt: string;
    fingerprint: string | null;
    message?: string;
  };
  knowledge: { notes: number; proposed: number; errors: number };
  surfaces: { count: number; stale: boolean };
}

export type SurfaceKind = "http" | "cli" | "page" | "screen" | "export";

export interface Surface {
  id: string;
  kind: SurfaceKind;
  framework: string;
  label: string;
  route: string | null;
  method: string | null;
  symbolId: string | null;
  symbolName: string | null;
  file: string;
  line: number;
  confidence: "exact" | "inferred";
  evidence: "ast" | "openapi" | "config";
  detector: string;
  detectorVersion: number;
  metadata: Record<string, string | number | boolean>;
}

export interface SurfacePage {
  contractVersion: 1;
  items: Surface[];
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
  stale: boolean;
}

export type ChangeKind =
  | "added"
  | "removed"
  | "modified"
  | "moved"
  | "renamed"
  | "reformatted"
  | "extracted"
  | "inlined"
  | "reordered";

export interface SourceSpan {
  path: string;
  startLine: number;
  endLine: number;
  name?: string;
}

export interface SemanticChange {
  id: string;
  kind: ChangeKind;
  confidence: "high" | "medium" | "low";
  symbol: { id: string | null; name: string; kind: SymbolKind };
  from: SourceSpan | null;
  to: SourceSpan | null;
  flags: { moved: boolean; renamed: boolean; reformatOnly: boolean };
  detail?: {
    extractedInto?: string;
    inlinedFrom?: string;
    tokenDelta?: number;
    renamedFrom?: string;
    renamedTo?: string;
    reason?: string;
  };
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
  language: Language;
  degraded: boolean;
  degradedReason?: "parse-error" | "too-large" | "unsupported-language" | "worker-failed";
  changes: SemanticChange[];
  stats: Record<ChangeKind, number>;
}

export type DiffRange =
  | { mode: "working" }
  | { mode: "staged" }
  | { mode: "range"; base: string; head: string }
  | { mode: "base"; base?: string };

export interface SemanticDiff {
  contractVersion: 1;
  range: DiffRange;
  resolved: {
    mode: "working" | "staged" | "range" | "base";
    baseCommit: string | null;
    headCommit: string | null;
    mergeBase: string | null;
  };
  files: FileDiff[];
  truncated: boolean;
  truncatedBy: "operations" | "files" | null;
}

export type NoteType = "spec" | "decision" | "constraint" | "howto" | "question";
export type NoteStatus = "proposed" | "accepted" | "superseded" | "deprecated" | "rejected";

export type LinkRel =
  | "implements"
  | "refines"
  | "constrains"
  | "explains"
  | "depends_on"
  | "exposes"
  | "affects"
  | "relates_to";

export type NoteLink =
  | { rel: LinkRel; note: string }
  | { rel: LinkRel; symbol: string }
  | { rel: LinkRel; surface: string }
  | { rel: LinkRel; commit: string }
  | { rel: LinkRel; file: string };

export interface NoteSummary {
  id: string;
  title: string;
  type: NoteType;
  status: NoteStatus;
  tags: string[];
  updated: string;
  path: string;
  linkCount: number;
  backlinkCount: number;
  source?: "reins" | "spec-kit";
}

export interface KnowledgeNote extends NoteSummary {
  body: string;
  links: NoteLink[];
  commits: string[];
  mentions: string[];
  frontmatter: Record<string, unknown>;
}

export interface NoteProposal {
  type: NoteType;
  title: string;
  body: string;
  tags?: string[];
  links?: NoteLink[];
  source?: {
    kind: "review-comment" | "agent" | "manual";
    file?: string;
    line?: number;
    diffRange?: DiffRange;
    agent?: string;
  };
}

export interface NoteProposalResult {
  id: string;
  path: string;
  status: "proposed";
  diff: string;
  warnings: string[];
}

export type CheckSeverity = "error" | "warning" | "info";

export type CheckCode =
  | "NOTE_INVALID"
  | "NOTE_DUPLICATE_ID"
  | "NOTE_FOLDER_MISMATCH"
  | "NOTE_STATUS_INVALID"
  | "LINK_BROKEN"
  | "LINK_DUPLICATE"
  | "LINK_TARGET_UNKNOWN"
  | "SYMBOL_UNKNOWN"
  | "SYMBOL_MOVED"
  | "SURFACE_UNKNOWN"
  | "CONSTRAINT_VIOLATED"
  | "CONSTRAINT_SKIPPED"
  | "CONFIG_INVALID";

export interface CheckItem {
  code: CheckCode;
  severity: CheckSeverity;
  message: string;
  noteId?: string;
  path?: string;
  line?: number;
  fix?: string;
}

export interface CheckReport {
  contractVersion: 1;
  ok: boolean;
  scope: "knowledge" | "knowledge+code" | "diff";
  items: CheckItem[];
  summary: Record<CheckSeverity, number>;
  revision: GraphRevision & { knowledgeHash: string };
}

export interface PackRequest {
  intent: string;
  paths?: string[];
  symbols?: string[];
  maxTokens?: number;
  includeSurfaces?: boolean;
}

export interface HarnessPack {
  contractVersion: 1;
  markdown: string;
  tokenEstimate: number;
  truncated: boolean;
  sections: Array<{ name: string; bytes: number }>;
  revision: GraphRevision & { knowledgeHash: string };
}

export interface SearchOptions {
  limit?: number;
  pathPrefix?: string;
}

export interface RefreshOptions {
  force?: boolean;
}

export interface GraphRequest {
  root: { symbolId: string } | { query: string } | { surfaceId: string };
  direction?: "in" | "out" | "both";
  depth?: number;
  maxNodes?: number;
  pathPrefix?: string;
}

export interface SurfaceFilter {
  kind?: SurfaceKind;
  framework?: string;
  pathPrefix?: string;
  query?: string;
  confidence?: "exact" | "inferred";
  limit?: number;
  offset?: number;
}

export interface FlowRequest {
  target: string;
  direction?: "in" | "out" | "both";
  depth?: number;
  maxNodes?: number;
}

export interface NoteFilter {
  query?: string;
  type?: NoteType;
  status?: NoteStatus;
  tag?: string;
  limit?: number;
}

export interface CheckRequest {
  scope?: "knowledge" | "knowledge+code" | "diff";
  strict?: boolean;
}

export interface DiffRequest {
  range: DiffRange;
  files?: string[];
  includeTrivia?: boolean;
  maxOperationsPerFile?: number;
}

export interface ReinsApi {
  status(): Promise<RepoStatus>;
  refreshGraph(opts?: RefreshOptions): Promise<RepoStatus>;
  searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]>;
  graph(req: GraphRequest): Promise<GraphSlice>;
  listSurfaces(f?: SurfaceFilter): Promise<SurfacePage>;
  flow(req: FlowRequest): Promise<GraphSlice>;
  diff(req: DiffRequest): Promise<SemanticDiff>;
  listNotes(f?: NoteFilter): Promise<NoteSummary[]>;
  getNote(id: string): Promise<KnowledgeNote>;
  proposeNote(input: NoteProposal): Promise<NoteProposalResult>;
  check(req?: CheckRequest): Promise<CheckReport>;
  harnessPack(req: PackRequest): Promise<HarnessPack>;
  readFile(path: string): Promise<{ path: string; text: string }>;
}

export interface NavigationTarget {
  type: "symbol" | "surface" | "diff" | "note";
  id?: string;
  file?: string;
  line?: number;
  range?: DiffRange;
  symbolId?: string;
}

export interface ReinsClient {
  readonly kind: "tauri" | "ipc" | "http" | "memory";
  call<T>(method: keyof ReinsApi, params?: unknown): Promise<T>;
  subscribe?(cb: (event: ReinsEvent) => void): () => void;
}

export interface ReinsEvent {
  type: "graph-changed" | "surfaces-changed" | "knowledge-changed" | "progress";
  payload?: unknown;
}
