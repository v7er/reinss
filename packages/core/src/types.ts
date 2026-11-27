import type {
  AiSettings,
  CoverageItem,
  KnowledgeAcceptInput,
  KnowledgeAiResult,
  KnowledgeBootstrapResult,
  KnowledgeCommentThread,
  KnowledgeContextPack,
  KnowledgeMigrationResult,
  KnowledgeNode,
  KnowledgeNodeInput,
  KnowledgeQuery,
  KnowledgeQueryResult,
  KnowledgeSaveResult,
  KnowledgeTree,
  LocalAiProvider,
} from "./tree.js";

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
  knowledge: { nodes: number; proposed: number; errors: number };
  surfaces: { count: number; stale: boolean };
}

export type SurfaceKind = "http" | "cli" | "page" | "screen" | "export";

export type ComponentKind =
  | "webapp"
  | "mobile"
  | "backoffice"
  | "core"
  | "cli"
  | "service"
  | "library"
  | "unknown";

export interface Component {
  id: string;
  name: string;
  kind: ComponentKind;
  root: string;
  packageName: string | null;
  languages: string[];
  surfaceCount: number;
  changed: boolean;
}

export interface SurfaceChange {
  status: "added" | "deleted" | "modified" | "renamed";
  touched: boolean;
}

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
  componentId: string;
  change?: SurfaceChange | null;
  metadata: Record<string, string | number | boolean>;
}

export interface SurfacePage {
  contractVersion: 1;
  items: Surface[];
  components: Component[];
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
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

export interface DiffLine {
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
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
  hunks: DiffHunk[];
  stats: Record<ChangeKind, number>;
}

export type DiffRange =
  | { mode: "working" }
  | { mode: "unstaged" }
  | { mode: "staged" }
  | { mode: "range"; base: string; head: string }
  | { mode: "base"; base?: string }
  | { mode: "commit"; hash: string };

export interface SemanticDiff {
  contractVersion: 1;
  range: DiffRange;
  resolved: {
    mode: "working" | "unstaged" | "staged" | "range" | "base" | "commit";
    baseCommit: string | null;
    headCommit: string | null;
    mergeBase: string | null;
  };
  files: FileDiff[];
  truncated: boolean;
  truncatedBy: "operations" | "files" | null;
}

export type NodeType = "spec" | "decision" | "constraint" | "howto" | "question";
export type NodeStatus = "proposed" | "accepted" | "superseded" | "deprecated" | "rejected";

export type LinkRel =
  | "implements"
  | "refines"
  | "constrains"
  | "explains"
  | "depends_on"
  | "exposes"
  | "affects"
  | "relates_to";

export type NodeLink =
  | { rel: LinkRel; node: string }
  | { rel: LinkRel; note: string }
  | { rel: LinkRel; symbol: string }
  | { rel: LinkRel; surface: string }
  | { rel: LinkRel; commit: string }
  | { rel: LinkRel; file: string };

export interface NodeProposal {
  type: NodeType;
  title: string;
  body: string;
  tags?: string[];
  links?: NodeLink[];
  source?: {
    kind: "review-comment" | "agent" | "manual";
    file?: string;
    line?: number;
    diffRange?: DiffRange;
    agent?: string;
  };
}

export interface NodeProposalResult {
  address: string;
  path: string;
  status: "proposed";
  diff: string;
  warnings: string[];
}

export type CheckSeverity = "error" | "warning" | "info";

export type CheckCode =
  | "NODE_INVALID"
  | "NODE_DUPLICATE_ID"
  | "NODE_STATUS_INVALID"
  | "LINK_BROKEN"
  | "LINK_DUPLICATE"
  | "LINK_TARGET_UNKNOWN"
  | "SYMBOL_UNKNOWN"
  | "SYMBOL_MOVED"
  | "SURFACE_UNKNOWN"
  | "CONSTRAINT_VIOLATED"
  | "CONSTRAINT_SKIPPED"
  | "CONFIG_INVALID"
  | "NOTE_ADDRESS_DUPLICATE"
  | "TEMPLATE_MISSING"
  | "TEMPLATE_INVALID"
  | "LAYER_UNDECLARED"
  | "COMPONENT_MISMATCH"
  | "NODE_UNMAPPED"
  | "NODE_ORPHAN"
  | "NODE_STALE"
  | "GUIDANCE_INVALID"
  | "INDEX_INVALID";

export interface CheckItem {
  code: CheckCode;
  severity: CheckSeverity;
  message: string;
  nodeId?: string;
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

export interface SymbolListRequest {
  limit?: number;
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
  evidence?: Surface["evidence"];
  component?: string;
  changed?: boolean;
  range?: DiffRange;
  limit?: number;
  offset?: number;
}

export interface FlowRequest {
  target: string;
  direction?: "in" | "out" | "both";
  depth?: number;
  maxNodes?: number;
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

export interface GitFileStatus {
  path: string;
  oldPath: string | null;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  additions: number | null;
  deletions: number | null;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  clean: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  base: string | null;
}

export interface GitCommitResult {
  hash: string;
  subject: string;
  status: GitStatus;
}

export interface GitBranch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  head: string | null;
  subject: string | null;
}

export interface GitBranches {
  current: string | null;
  local: GitBranch[];
  remote: GitBranch[];
}

export interface GitTag {
  name: string;
  hash: string;
  shortHash: string;
  subject: string;
  date: string;
  annotated: boolean;
}

export interface GitWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  current: boolean;
  main: string | null;
  merged: boolean | null;
}

export interface GitSyncRef {
  kind: "branch" | "tag";
  name: string;
  remote: string;
  upstream: string | null;
  state: "ahead" | "behind" | "diverged" | "new" | "updated";
  ahead: number;
  behind: number;
}

export interface GitSync {
  remotes: string[];
  refs: GitSyncRef[];
  fetchedAt: string | null;
}

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface GitCommitRefs {
  branches: string[];
  tags: string[];
  worktrees: Array<{ path: string; branch: string | null; current: boolean }>;
  mergedInto: string[];
  defaultBranch: string | null;
}

export interface GitMergeResult {
  status: GitStatus;
  message: string;
}

export interface GitReview {
  revision: string;
  shortRevision: string;
  reviewRef: string | null;
  targetRef: string | null;
  requester: string;
  reviewers: string[];
  description: string;
  timestamp: string;
  resolved: boolean;
  submitted: boolean;
  needsReview: boolean;
  comments: number;
  base: string | null;
  head: string | null;
}

export interface GitReviews {
  available: boolean;
  currentUser: string | null;
  reviews: GitReview[];
}

export interface BootstrapResult {
  contractVersion: 1;
  created: string[];
  graphBuilt: boolean;
  surfaces: number;
  status: RepoStatus;
}

export interface ReinsApi {
  status(): Promise<RepoStatus>;
  bootstrap(): Promise<BootstrapResult>;
  refreshGraph(opts?: RefreshOptions): Promise<RepoStatus>;
  gitStatus(): Promise<GitStatus>;
  gitStage(req: { paths: string[] }): Promise<GitStatus>;
  gitUnstage(req: { paths: string[] }): Promise<GitStatus>;
  gitDiscard(req: { paths: string[]; confirm: boolean }): Promise<GitStatus>;
  gitCommit(req: { message: string; amend?: boolean; signoff?: boolean }): Promise<GitCommitResult>;
  gitLog(req?: { limit?: number; path?: string }): Promise<GitCommit[]>;
  gitGraph(req?: { limit?: number }): Promise<GitGraphCommit[]>;
  gitCommitRefs(req: { hash: string }): Promise<GitCommitRefs>;
  gitMerge(req: { source: string; target: string }): Promise<GitMergeResult>;
  gitReviews(): Promise<GitReviews>;
  gitBranches(): Promise<GitBranches>;
  gitCheckoutBranch(req: { name: string; remote?: boolean }): Promise<GitStatus>;
  gitCreateBranch(req: {
    name: string;
    startPoint?: string;
    checkout?: boolean;
  }): Promise<GitStatus>;
  gitDeleteBranch(req: { name: string; force?: boolean }): Promise<GitStatus>;
  gitTags(): Promise<GitTag[]>;
  gitCreateTag(req: { name: string; ref?: string; message?: string }): Promise<GitTag[]>;
  gitDeleteTag(req: { name: string }): Promise<GitTag[]>;
  gitWorktrees(): Promise<GitWorktree[]>;
  gitSync(req?: { tags?: boolean }): Promise<GitSync>;
  gitRebase(req: { branch: string; upstream?: string }): Promise<GitStatus>;
  gitPush(req: { branch: string }): Promise<GitStatus>;
  gitAddWorktree(req: {
    path: string;
    branch?: string;
    createBranch?: boolean;
    startPoint?: string;
    detach?: boolean;
  }): Promise<GitWorktree[]>;
  gitRemoveWorktree(req: { path: string; force?: boolean }): Promise<GitWorktree[]>;
  searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]>;
  listSymbols(req?: SymbolListRequest): Promise<SymbolHit[]>;
  graph(req: GraphRequest): Promise<GraphSlice>;
  listSurfaces(f?: SurfaceFilter): Promise<SurfacePage>;
  flow(req: FlowRequest): Promise<GraphSlice>;
  diff(req: DiffRequest): Promise<SemanticDiff>;
  proposeNode(input: NodeProposal): Promise<NodeProposalResult>;
  initKnowledge(template?: string): Promise<{ created: string[]; kept: boolean }>;
  aiSettings(): Promise<AiSettings>;
  saveAiSettings(input: {
    enabled: boolean;
    provider?: string | null;
    model?: string | null;
    baseUrl?: string | null;
  }): Promise<AiSettings>;
  discoverAi(): Promise<LocalAiProvider[]>;
  aiKnowledgeInit(req?: {
    write?: boolean;
    maxComponents?: number;
    maxDrafts?: number;
  }): Promise<KnowledgeAiResult>;
  knowledgeTree(): Promise<KnowledgeTree>;
  knowledgeNode(address: string): Promise<KnowledgeNode>;
  saveKnowledgeNode(input: KnowledgeNodeInput): Promise<KnowledgeSaveResult>;
  acceptKnowledgeNode(input: KnowledgeAcceptInput): Promise<KnowledgeSaveResult>;
  searchKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult>;
  knowledgeContext(codePath: string): Promise<KnowledgeContextPack>;
  knowledgeCoverage(): Promise<CoverageItem[]>;
  bootstrapKnowledge(req?: {
    maxComponents?: number;
    write?: boolean;
    dir?: string;
  }): Promise<KnowledgeBootstrapResult>;
  migrateKnowledge(req?: {
    write?: boolean;
    map?: Record<string, string>;
  }): Promise<KnowledgeMigrationResult>;
  knowledgeComments(address: string): Promise<KnowledgeCommentThread>;
  addKnowledgeComment(req: { address: string; body: string }): Promise<KnowledgeCommentThread>;
  check(req?: CheckRequest): Promise<CheckReport>;
  harnessPack(req: PackRequest): Promise<HarnessPack>;
  readFile(path: string, rev?: "working" | "staged"): Promise<{ path: string; text: string }>;
}

export interface NavigationTarget {
  type: "symbol" | "surface" | "diff" | "node";
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
