import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import {
  assignComponent,
  type BootstrapResult,
  type CheckItem,
  type CheckReport,
  type CheckRequest,
  type Component,
  composeHarnessPack,
  computeFingerprint,
  contractVersion,
  type DiffRequest,
  defaultConfig,
  type FlowRequest,
  finalizeDiff,
  finalizeFileDiff,
  folderForType,
  type GitBranches,
  type GitCommit,
  type GitCommitRefs,
  type GitCommitResult,
  type GitGraphCommit,
  type GitMergeResult,
  type GitReviews,
  type GitStatus,
  type GitSync,
  type GitTag,
  type GitWorktree,
  type GraphEdge,
  type GraphNode,
  type GraphRequest,
  type GraphRevision,
  type GraphSlice,
  type HarnessPack,
  type KnowledgeNote,
  linkTarget,
  mergeSlices,
  type NoteFilter,
  type NoteProposal,
  type NoteProposalResult,
  type NoteSummary,
  normalizeAsk,
  normalizeCallers,
  normalizeKind,
  type PackRequest,
  parseConfig,
  parseSpan,
  type RefreshOptions,
  type ReinsApi,
  ReinsError,
  type RepoStatus,
  type SearchOptions,
  type SemanticDiff,
  type Surface,
  type SurfaceFilter,
  type SurfacePage,
  type SymbolHit,
  type SymbolListRequest,
  verifySurfaceSymbols,
} from "@reinss/core";
import fg from "fast-glob";
import { readCache, writeCache } from "./cache.js";
import { discoverComponents } from "./components.js";
import { diffFile } from "./diff.js";
import { type ChangedFile, GitAdapter } from "./git.js";
import { folderMismatch, loadKnowledge, noteSummary, proposeNote } from "./knowledge.js";
import { readJson, resolveWithinRoot, writeAtomic } from "./paths.js";
import { type ScanDiagnostic, scanSurfaces } from "./surfaces.js";
import { TrailAdapter } from "./trail.js";

const ADAPTER_VERSION = "0.1.0";
const SURFACE_CACHE = ".reins/.cache/surfaces.json";
const SURFACE_DETECTOR_VERSION = 7;

interface SurfaceCacheData {
  surfaces: Surface[];
  diagnostics: ScanDiagnostic[];
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
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

function matchesGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(file);
}

function importsPath(source: string, file: string, target: string): boolean {
  const specifiers = [...source.matchAll(/(?:from\s*|require\()\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? "",
  );
  for (const specifier of specifiers) {
    if (specifier === target || specifier.startsWith(`${target}/`)) return true;
    if (specifier.startsWith(".")) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (resolved === target || resolved.startsWith(`${target}/`)) return true;
    }
  }
  return false;
}

const IMPORT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s*|require\()\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? "",
  );
}

function sharedPathSegments(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
  return count;
}

interface AstNode {
  type?: string;
  [key: string]: unknown;
}

function walkAst(node: unknown, cb: (node: AstNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, cb);
    return;
  }
  const current = node as AstNode;
  if (typeof current.type === "string") cb(current);
  for (const [key, value] of Object.entries(current)) {
    if (key === "loc" || key === "start" || key === "end" || key === "tokens" || key === "comments")
      continue;
    if (value && typeof value === "object") walkAst(value, cb);
  }
}

function typeName(node: AstNode | undefined): string | null {
  if (node?.type !== "TSTypeReference") return null;
  const name = node.typeName as AstNode | undefined;
  if (name?.type === "Identifier" && typeof name.name === "string") return name.name;
  if (name?.type === "TSQualifiedName") {
    const right = name.right as AstNode | undefined;
    if (right?.type === "Identifier" && typeof right.name === "string") return right.name;
  }
  return null;
}

function paramType(param: unknown): string | null {
  if (!param || typeof param !== "object") return null;
  const node = param as AstNode;
  if (node.type === "TSParameterProperty") return paramType(node.parameter);
  if (node.type === "AssignmentPattern") return paramType(node.left);
  const annotation = node.typeAnnotation as AstNode | undefined;
  if (annotation?.type !== "TSTypeAnnotation") return null;
  return typeName(annotation.typeAnnotation as AstNode | undefined);
}

// Constructor parameter types are the injected dependencies of a controller class.
function constructorTypes(source: string, className: string): string[] {
  let ast: AstNode;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: ["typescript", "jsx"],
    }) as unknown as AstNode;
  } catch {
    return [];
  }
  const types: string[] = [];
  walkAst(ast, (node) => {
    if (node.type !== "ClassDeclaration") return;
    const id = node.id as AstNode | undefined;
    if (id?.name !== className) return;
    const body = node.body as AstNode | undefined;
    for (const member of (body?.body as AstNode[] | undefined) ?? []) {
      if (member.type !== "ClassMethod" || member.kind !== "constructor") continue;
      for (const param of (member.params as unknown[] | undefined) ?? []) {
        const type = paramType(param);
        if (type) types.push(type);
      }
    }
  });
  return types;
}

export class RepoSession implements ReinsApi {
  readonly root: string;
  readonly config: typeof defaultConfig;
  private readonly trail: TrailAdapter;
  private readonly git: GitAdapter;
  private fingerprintCache: { value: GraphRevision; at: number } | null = null;
  private surfaceCache: { key: string; data: SurfaceCacheData } | null = null;
  private componentCache: Component[] | null = null;
  private symbolCache = new Map<string, Set<string>>();

  private constructor(root: string, config: typeof defaultConfig) {
    this.root = root;
    this.config = config;
    this.trail = new TrailAdapter(root);
    this.git = new GitAdapter(root);
  }

  static async create(root: string): Promise<RepoSession> {
    const raw = await readJson<unknown>(root, ".reins/config.json");
    const config = raw ? parseConfig(raw) : defaultConfig;
    return new RepoSession(root, config);
  }

  private async revision(): Promise<GraphRevision> {
    if (this.fingerprintCache && Date.now() - this.fingerprintCache.at < 5000) {
      return this.fingerprintCache.value;
    }
    const git = await this.git.info();
    let version = "unknown";
    let nodes = 0;
    let inSync = false;
    try {
      version = await this.trail.version();
      const status = await this.trail.status();
      nodes = status.nodes;
      inSync = status.inSync;
    } catch {
      // status() reports the precise state; revision stays usable for errors
    }
    const fingerprint = await computeFingerprint({
      trailVersion: version,
      nodes,
      inSync,
      gitHead: git.head,
      gitDirty: git.dirty,
      adapterVersion: ADAPTER_VERSION,
      contractVersion,
    });
    const value: GraphRevision = {
      fingerprint,
      trailVersion: version,
      gitHead: git.head,
      inSync,
      checkedAt: new Date().toISOString(),
    };
    this.fingerprintCache = { value, at: Date.now() };
    return value;
  }

  async status(): Promise<RepoStatus> {
    const git = await this.git.info();
    let trailVersion: string | null = null;
    let graphState: RepoStatus["graph"]["state"] = "ready";
    let inSync = false;
    let nodes: number | null = null;
    let message: string | undefined;
    let fingerprint: string | null = null;

    try {
      trailVersion = await this.trail.version();
      const status = await this.trail.status();
      nodes = status.nodes;
      inSync = status.inSync;
      if (nodes === 0) graphState = "missing-graft";
      else if (!inSync) graphState = "stale";
      fingerprint = (await this.revision()).fingerprint;
    } catch (err) {
      if (err instanceof ReinsError) {
        if (err.code === "TRAIL_MISSING") graphState = "missing-trail";
        else if (err.code === "TRAIL_VERSION_UNSUPPORTED") graphState = "unsupported-trail";
        else if (err.code === "TRAIL_MISSING_GRAFT") graphState = "missing-graft";
        else graphState = "error";
        message = err.message;
      } else {
        graphState = "error";
        message = err instanceof Error ? err.message : String(err);
      }
    }

    const knowledgeFiles = await fg([`${this.config.knowledgeDir}/**/*.md`], {
      cwd: this.root,
      onlyFiles: true,
      dot: true,
      ignore: ["**/node_modules/**"],
    });
    const proposed = knowledgeFiles.filter((file) => file.includes("/inbox/")).length;
    const cached = await readCache<SurfaceCacheData>(this.root, SURFACE_CACHE);
    const surfacesStale =
      !cached ||
      (fingerprint !== null &&
        cached.fingerprint !== `${fingerprint}:d${SURFACE_DETECTOR_VERSION}`);

    return {
      contractVersion: 1,
      repo: { name: path.basename(this.root), root: this.root },
      git,
      trail: { version: trailVersion, minVersion: "0.28.0", graftDir: this.config.graftDir },
      graph: {
        state: graphState,
        inSync,
        nodes,
        checkedAt: new Date().toISOString(),
        fingerprint,
        ...(message ? { message } : {}),
      },
      knowledge: { notes: knowledgeFiles.length, proposed, errors: 0 },
      surfaces: { count: cached?.data.surfaces.length ?? 0, stale: surfacesStale },
    };
  }

  invalidate(): void {
    this.surfaceCache = null;
    this.fingerprintCache = null;
    this.symbolCache.clear();
  }

  async refreshGraph(opts?: RefreshOptions): Promise<RepoStatus> {
    if (!opts?.force) {
      const current = await this.status();
      if (current.graph.state === "ready") return current;
    }
    await this.trail.build();
    this.fingerprintCache = null;
    this.surfaceCache = null;
    this.componentCache = null;
    this.symbolCache.clear();
    return this.status();
  }

  async gitStatus(): Promise<GitStatus> {
    return this.git.status();
  }

  async gitStage(req: { paths: string[] }): Promise<GitStatus> {
    await this.git.stage(req.paths);
    return this.git.status();
  }

  async gitUnstage(req: { paths: string[] }): Promise<GitStatus> {
    await this.git.unstage(req.paths);
    return this.git.status();
  }

  async gitDiscard(req: { paths: string[]; confirm: boolean }): Promise<GitStatus> {
    if (!req.confirm) {
      throw new ReinsError("GIT_CONFIRM_REQUIRED", "Discarding changes requires confirm: true.");
    }
    await this.git.discard(req.paths);
    return this.git.status();
  }

  async gitCommit(req: {
    message: string;
    amend?: boolean;
    signoff?: boolean;
  }): Promise<GitCommitResult> {
    const result = await this.git.commit(req);
    this.invalidate();
    return result;
  }

  async gitLog(req?: { limit?: number; path?: string }): Promise<GitCommit[]> {
    return this.git.log(req?.limit ?? 30, req?.path);
  }

  async gitGraph(req?: { limit?: number }): Promise<GitGraphCommit[]> {
    return this.git.graph(req?.limit ?? 200);
  }

  async gitCommitRefs(req: { hash: string }): Promise<GitCommitRefs> {
    return this.git.commitRefs(req.hash);
  }

  async gitMerge(req: { source: string; target: string }): Promise<GitMergeResult> {
    const result = await this.git.merge(req.source, req.target);
    this.invalidate();
    return result;
  }

  async gitReviews(): Promise<GitReviews> {
    return this.git.reviews();
  }

  async gitBranches(): Promise<GitBranches> {
    return this.git.branches();
  }

  async gitCheckoutBranch(req: { name: string; remote?: boolean }): Promise<GitStatus> {
    const status = await this.git.checkoutBranch(req.name, req.remote);
    this.invalidate();
    return status;
  }

  async gitCreateBranch(req: {
    name: string;
    startPoint?: string;
    checkout?: boolean;
  }): Promise<GitStatus> {
    const status = await this.git.createBranch(req.name, req.startPoint, req.checkout);
    this.invalidate();
    return status;
  }

  async gitDeleteBranch(req: { name: string; force?: boolean }): Promise<GitStatus> {
    const status = await this.git.deleteBranch(req.name, req.force);
    this.invalidate();
    return status;
  }

  async gitTags(): Promise<GitTag[]> {
    return this.git.tags();
  }

  async gitCreateTag(req: { name: string; ref?: string; message?: string }): Promise<GitTag[]> {
    return this.git.createTag(req);
  }

  async gitDeleteTag(req: { name: string }): Promise<GitTag[]> {
    return this.git.deleteTag(req.name);
  }

  async gitWorktrees(): Promise<GitWorktree[]> {
    return this.git.worktrees();
  }

  async gitSync(req?: { tags?: boolean }): Promise<GitSync> {
    return this.git.sync(req?.tags);
  }

  async gitRebase(req: { branch: string; upstream?: string }): Promise<GitStatus> {
    const status = await this.git.rebase(req.branch, req.upstream);
    this.invalidate();
    return status;
  }

  async gitPush(req: { branch: string }): Promise<GitStatus> {
    const status = await this.git.push(req.branch);
    this.invalidate();
    return status;
  }

  async gitAddWorktree(req: {
    path: string;
    branch?: string;
    createBranch?: boolean;
    startPoint?: string;
    detach?: boolean;
  }): Promise<GitWorktree[]> {
    const worktrees = await this.git.addWorktree(req);
    this.invalidate();
    return worktrees;
  }

  async gitRemoveWorktree(req: { path: string; force?: boolean }): Promise<GitWorktree[]> {
    const worktrees = await this.git.removeWorktree(req.path, req.force);
    this.invalidate();
    return worktrees;
  }

  async searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50);
    const result = await this.trail.ask(q, limit);
    return normalizeAsk(result, limit).filter(
      (hit) => !opts?.pathPrefix || hit.path.startsWith(opts.pathPrefix),
    );
  }

  async listSymbols(req?: SymbolListRequest): Promise<SymbolHit[]> {
    const limit = Math.min(Math.max(req?.limit ?? 20, 1), 100);
    const map = await this.trail.map();
    return map.symbols.slice(0, limit).map((symbol) => {
      const span = parseSpan(symbol.span);
      return {
        id: `${symbol.path}#${symbol.name}`,
        name: symbol.name,
        kind: normalizeKind(symbol.kind),
        path: symbol.path,
        startLine: span.startLine,
        endLine: span.endLine,
        snippet: "",
        score: symbol.inDegree ?? 0,
      };
    });
  }

  private untraceable(surface: Surface): ReinsError | null {
    if (surface.evidence !== "openapi" || surface.metadata.sourceFile) return null;
    const target = `${surface.method ?? ""} ${surface.route ?? surface.label}`.trim();
    const message = `OpenAPI surface ${target} has no x-source-file, so Reins cannot trace it to code.\nAdd "x-source-file" to the operation, path, or document in openapi.json:\n{ "get": { "operationId": "listJobs", "x-source-file": "src/jobs.ts@JobsController:listJobs" } }\nThen rescan surfaces.`;
    return new ReinsError("SURFACE_UNTRACEABLE", message, {
      details: { surfaceId: surface.id, reason: "missing-x-source-file" },
    });
  }

  private async surfaceSymbol(surface: Surface): Promise<string | null> {
    if (surface.symbolId) return surface.symbolId;
    if (surface.symbolName) {
      const hits = await this.searchSymbols(surface.symbolName, {
        limit: 2,
        pathPrefix: surface.file,
      });
      if (hits.length === 1 && hits[0]?.id) return hits[0].id;
    }
    // x-source-file without a symbol suffix: start from the file's first symbol.
    const entries = await this.skeletonEntries(surface.file);
    const entry = entries[0];
    return entry ? `${entry.file}#${entry.name}` : null;
  }

  private async resolveRoot(req: GraphRequest): Promise<{ symbol: string; surface?: Surface }> {
    const root = req.root;
    if ("symbolId" in root) return { symbol: root.symbolId };
    if ("surfaceId" in root) {
      const surfaceId = root.surfaceId;
      const page = await this.listSurfaces({ limit: 5000 });
      const surface = page.items.find((item) => item.id === surfaceId);
      if (!surface) {
        throw new ReinsError("SURFACE_NOT_FOUND", `Unknown surface: ${surfaceId}`);
      }
      const untraceable = this.untraceable(surface);
      if (untraceable) throw untraceable;
      const symbol = await this.surfaceSymbol(surface);
      if (symbol) return { symbol, surface };
      throw new ReinsError("SYMBOL_NOT_FOUND", `Surface ${surface.id} has no linked symbol.`, {
        details: {
          surfaceId: surface.id,
          reason: surface.metadata.linkReason ?? "no-symbol",
        },
      });
    }
    const query = root.query;
    const hits = await this.searchSymbols(query, { limit: 5 });
    if (hits.length === 0) {
      throw new ReinsError("SYMBOL_NOT_FOUND", `No symbol matched "${query}".`);
    }
    if (hits.length > 1) {
      throw new ReinsError("AMBIGUOUS_SYMBOL", `Multiple symbols matched "${query}".`, {
        details: { candidates: hits.map((hit) => hit.id) },
      });
    }
    const id = hits[0]?.id;
    if (!id) throw new ReinsError("SYMBOL_NOT_FOUND", `No symbol matched "${query}".`);
    return { symbol: id };
  }

  private async resolveInjected(typeName: string): Promise<GraphNode | null> {
    try {
      const hits = await this.searchSymbols(typeName, { limit: 5 });
      const hit = hits.find((item) => item.name === typeName && item.kind === "class" && item.id);
      if (!hit?.id) return null;
      return {
        id: hit.id,
        name: hit.name,
        kind: hit.kind,
        path: hit.path,
        startLine: hit.startLine ?? 1,
        endLine: hit.endLine ?? hit.startLine ?? 1,
        depth: 1,
        external: false,
      };
    } catch {
      return null;
    }
  }

  private async injectedNodes(
    root: GraphNode,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const source = await fs
      .readFile(resolveWithinRoot(this.root, root.path), "utf8")
      .catch(() => null);
    if (!source) return { nodes: [], edges: [] };
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const type of constructorTypes(source, root.name)) {
      const node = await this.resolveInjected(type);
      if (!node || nodes.some((item) => item.id === node.id)) continue;
      nodes.push(node);
      edges.push({
        source: root.id,
        target: node.id,
        relation: "references",
        depth: 1,
        line: null,
      });
    }
    return { nodes, edges };
  }

  private async withInjected(
    slice: GraphSlice,
    surface: Surface,
    maxNodes: number,
  ): Promise<GraphSlice> {
    if (
      surface.evidence !== "openapi" ||
      slice.direction === "in" ||
      !slice.root ||
      slice.root.kind !== "class"
    ) {
      return slice;
    }
    const injected = await this.injectedNodes(slice.root);
    if (injected.nodes.length === 0) return slice;
    const nodes = [...slice.nodes];
    const seen = new Set(nodes.map((node) => node.id));
    for (const node of injected.nodes) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push(node);
    }
    const edges = [
      ...slice.edges,
      ...injected.edges.filter((edge) => seen.has(edge.source) && seen.has(edge.target)),
    ];
    const truncated = nodes.length > maxNodes;
    const capped = truncated ? nodes.slice(0, maxNodes) : nodes;
    const kept = new Set(capped.map((node) => node.id));
    return {
      ...slice,
      nodes: capped,
      edges: edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
      truncated: slice.truncated || truncated,
      truncatedBy: truncated ? "nodes" : slice.truncatedBy,
      effectiveDepth: Math.max(slice.effectiveDepth, 1),
    };
  }

  async graph(req: GraphRequest): Promise<GraphSlice> {
    const resolved = await this.resolveRoot(req);
    const symbol = resolved.symbol;
    const depth = Math.min(Math.max(req.depth ?? 1, 1), 5);
    const maxNodes = Math.min(Math.max(req.maxNodes ?? 500, 1), 2000);
    const revision = await this.revision();
    const direction = req.direction ?? "in";
    const base = {
      direction,
      depth,
      maxNodes,
      revision,
      ...(req.pathPrefix ? { pathPrefix: req.pathPrefix } : {}),
    };
    if (direction === "both") {
      const [incoming, outgoing] = await Promise.all([
        this.trail.callers({
          symbol,
          direction: "in",
          depth,
          ...(req.pathPrefix ? { pathPrefix: req.pathPrefix } : {}),
        }),
        this.trail.callers({
          symbol,
          direction: "out",
          depth,
          ...(req.pathPrefix ? { pathPrefix: req.pathPrefix } : {}),
        }),
      ]);
      const a = normalizeCallers(incoming, base);
      const b = normalizeCallers(outgoing, base);
      const merged = mergeSlices(a, b, maxNodes);
      return resolved.surface ? this.withInjected(merged, resolved.surface, maxNodes) : merged;
    }
    const result = await this.trail.callers({
      symbol,
      direction,
      depth,
      ...(req.pathPrefix ? { pathPrefix: req.pathPrefix } : {}),
    });
    const slice = normalizeCallers(result, base);
    return resolved.surface ? this.withInjected(slice, resolved.surface, maxNodes) : slice;
  }

  private async existingFile(base: string): Promise<string | null> {
    const candidates = [base];
    if (base.endsWith(".js")) {
      candidates.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
    }
    for (const extension of IMPORT_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of IMPORT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
    for (const candidate of candidates) {
      try {
        await fs.access(resolveWithinRoot(this.root, candidate));
        return candidate;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }

  private async resolveImport(file: string, specifier: string): Promise<string | null> {
    if (specifier.startsWith(".")) {
      return this.existingFile(
        path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)),
      );
    }
    const alias = /^[@~#]\//.exec(specifier);
    if (!alias) return null;
    const rest = specifier.slice(alias[0].length);
    const matches = await fg([`**/${rest}.{ts,tsx,js,jsx}`, `**/${rest}/index.{ts,tsx,js,jsx}`], {
      cwd: this.root,
      ignore: [
        ...this.config.ignore,
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/coverage/**",
        "**/.turbo/**",
        "**/.cache/**",
        "**/.reins/**",
      ],
      onlyFiles: true,
      dot: false,
    });
    if (matches.length === 0) return null;
    return (
      matches.sort((a, b) => sharedPathSegments(b, file) - sharedPathSegments(a, file))[0] ?? null
    );
  }

  private async skeletonEntries(
    file: string,
  ): Promise<Array<{ file: string; name: string; kind: string; span: string }>> {
    try {
      const skeleton = await this.trail.skeleton(file);
      if (skeleton.entries.length > 0) {
        return skeleton.entries.map((entry) => ({ ...entry, file }));
      }
    } catch {
      // fall through to the re-export scan
    }
    // Barrel files re-export their symbols; follow one level so the flow shows the real code.
    try {
      const source = await fs.readFile(resolveWithinRoot(this.root, file), "utf8");
      const entries: Array<{ file: string; name: string; kind: string; span: string }> = [];
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const target = await this.existingFile(
          path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)),
        );
        if (!target) continue;
        try {
          const nested = await this.trail.skeleton(target);
          entries.push(...nested.entries.map((entry) => ({ ...entry, file: target })));
        } catch {
          // skip files Trail cannot index
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  private async importSlice(
    root: GraphNode,
    revision: GraphRevision,
    maxNodes: number,
  ): Promise<GraphSlice | null> {
    let source: string;
    try {
      source = await fs.readFile(resolveWithinRoot(this.root, root.path), "utf8");
    } catch {
      return null;
    }
    const files = new Set<string>();
    for (const specifier of importSpecifiers(source)) {
      const file = await this.resolveImport(root.path, specifier);
      if (file && file !== root.path) files.add(file);
      if (files.size >= 20) break;
    }
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (const file of files) {
      const entries = await this.skeletonEntries(file);
      if (entries.length === 0) {
        let endLine = 1;
        try {
          const text = await fs.readFile(resolveWithinRoot(this.root, file), "utf8");
          endLine = text.split("\n").length;
        } catch {
          // keep the single-line span
        }
        nodes.push({
          id: file,
          name: path.posix.basename(file),
          kind: "module",
          path: file,
          startLine: 1,
          endLine,
          depth: 1,
          external: false,
        });
        edges.push({ source: root.id, target: file, relation: "references", depth: 1, line: null });
        continue;
      }
      for (const entry of entries) {
        const span = parseSpan(entry.span);
        const id = `${entry.file}#${entry.name}`;
        nodes.push({
          id,
          name: entry.name,
          kind: normalizeKind(entry.kind),
          path: entry.file,
          startLine: span.startLine,
          endLine: span.endLine,
          depth: 1,
          external: false,
        });
        edges.push({ source: root.id, target: id, relation: "references", depth: 1, line: null });
      }
    }
    if (nodes.length === 0) return null;
    const all = [root, ...nodes];
    const truncated = all.length > maxNodes;
    const capped = truncated ? all.slice(0, maxNodes) : all;
    const kept = new Set(capped.map((node) => node.id));
    return {
      contractVersion: 1,
      root,
      direction: "out",
      requestedDepth: 1,
      effectiveDepth: 1,
      nodes: capped,
      edges: edges.filter((edge) => kept.has(edge.target)),
      truncated,
      truncatedBy: truncated ? "nodes" : null,
      revision,
    };
  }

  private async components(): Promise<Component[]> {
    if (!this.componentCache) this.componentCache = await discoverComponents(this.root);
    return this.componentCache;
  }

  private async symbolNames(
    surfaces: Surface[],
    revision: GraphRevision,
  ): Promise<Map<string, Set<string>>> {
    const names = new Map<string, Set<string>>();
    if (!revision.inSync) return names;
    const files = [
      ...new Set(
        surfaces
          .filter((surface) => surface.symbolName && surface.symbolId)
          .map((surface) => surface.file),
      ),
    ].slice(0, 200);
    for (const file of files) {
      let set = this.symbolCache.get(file);
      if (!set) {
        try {
          const skeleton = await this.trail.skeleton(file);
          set = new Set(skeleton.entries.map((entry) => entry.name));
        } catch {
          set = new Set();
        }
        this.symbolCache.set(file, set);
      }
      names.set(file, set);
    }
    return names;
  }

  async listSurfaces(filter?: SurfaceFilter): Promise<SurfacePage> {
    const revision = await this.revision();
    const components = await this.components();
    const cacheKey = `${revision.fingerprint}:d${SURFACE_DETECTOR_VERSION}`;
    const git = await this.git.info();
    const canCache = revision.gitHead !== null && !git.dirty;
    // A dirty tree has no content fingerprint, so only reuse the cache when it is safe to write one.
    let data = canCache && this.surfaceCache?.key === cacheKey ? this.surfaceCache.data : null;
    if (!data) {
      const cached = canCache ? await readCache<SurfaceCacheData>(this.root, SURFACE_CACHE) : null;
      if (cached && cached.fingerprint === cacheKey) {
        data = cached.data;
      } else {
        const scan = await scanSurfaces(this.root, {
          detectors: this.config.surfaces.detectors,
          ignore: [...this.config.ignore, ...this.config.surfaces.ignore],
          components,
        });
        const names = await this.symbolNames(scan.surfaces, revision);
        data = {
          surfaces: verifySurfaceSymbols(scan.surfaces, names),
          diagnostics: scan.diagnostics,
        };
        if (canCache) await writeCache(this.root, SURFACE_CACHE, cacheKey, data);
      }
      if (canCache) this.surfaceCache = { key: cacheKey, data };
    }

    let items = data.surfaces.map((surface) => ({
      ...surface,
      componentId: surface.componentId || assignComponent(surface.file, components),
    }));

    let changed: Map<string, ChangedFile> | null = null;
    if (filter?.range || filter?.changed) {
      try {
        changed = await this.git.changedLines(filter.range ?? { mode: "working" });
      } catch {
        changed = null;
      }
    }
    if (changed) {
      const changes = changed;
      items = items.map((surface) => {
        const file = changes.get(surface.file);
        if (!file) return { ...surface, change: null };
        const touched =
          file.status === "added" ||
          file.status === "deleted" ||
          file.ranges.some((range) => surface.line >= range.start && surface.line <= range.end);
        return { ...surface, change: { status: file.status, touched } };
      });
    }

    if (filter?.kind) items = items.filter((item) => item.kind === filter.kind);
    if (filter?.framework) items = items.filter((item) => item.framework === filter.framework);
    if (filter?.pathPrefix)
      items = items.filter((item) => item.file.startsWith(filter.pathPrefix as string));
    if (filter?.confidence) items = items.filter((item) => item.confidence === filter.confidence);
    if (filter?.evidence) items = items.filter((item) => item.evidence === filter.evidence);
    if (filter?.component) {
      const wanted = filter.component;
      const ids = new Set(
        components
          .filter((component) => component.id === wanted || component.kind === wanted)
          .map((component) => component.id),
      );
      items = items.filter((item) => ids.has(item.componentId));
    }
    if (filter?.changed) items = items.filter((item) => item.change);
    if (filter?.query) {
      const query = filter.query.toLowerCase();
      items = items.filter(
        (item) =>
          item.id.toLowerCase().includes(query) ||
          item.label.toLowerCase().includes(query) ||
          (item.symbolName ?? "").toLowerCase().includes(query),
      );
    }

    const counts = new Map<string, number>();
    const changedIds = new Set<string>();
    for (const item of items) {
      counts.set(item.componentId, (counts.get(item.componentId) ?? 0) + 1);
      if (item.change) changedIds.add(item.componentId);
    }
    const pageComponents = components.map((component) => ({
      ...component,
      surfaceCount: counts.get(component.id) ?? 0,
      changed: changedIds.has(component.id),
    }));

    const offset = Math.max(filter?.offset ?? 0, 0);
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 1000);
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return {
      contractVersion: 1,
      items: page,
      components: pageComponents,
      total,
      offset,
      limit,
      truncated: offset + page.length < total,
    };
  }

  async flow(req: FlowRequest): Promise<GraphSlice> {
    const target = req.target.trim();
    let symbolId: string | null = null;
    let surface: Surface | undefined;
    if (target.includes("#")) {
      symbolId = target;
    } else {
      const page = await this.listSurfaces({ limit: 5000 });
      surface = page.items.find(
        (item) =>
          item.id === target ||
          (item.route && `${item.method ?? ""} ${item.route}`.trim() === target) ||
          item.route === target,
      );
      if (surface) {
        const untraceable = this.untraceable(surface);
        if (untraceable) throw untraceable;
        symbolId = await this.surfaceSymbol(surface);
      }
      if (!surface) {
        const hits = await this.searchSymbols(target, { limit: 2 });
        if (hits.length === 1 && hits[0]?.id) symbolId = hits[0].id;
      }
    }
    if (!symbolId) {
      throw new ReinsError("SURFACE_NOT_FOUND", `No surface or symbol matched "${target}".`);
    }
    const maxNodes = Math.min(Math.max(req.maxNodes ?? 500, 1), 2000);
    let slice = await this.graph({
      root: { symbolId },
      direction: req.direction ?? "out",
      depth: req.depth ?? 3,
      maxNodes,
    });
    if (surface) slice = await this.withInjected(slice, surface, maxNodes);
    if (slice.nodes.length > 1 || !slice.root || slice.direction === "in") return slice;
    // Trail has no call edges for many UI components. Fall back to the imports of the
    // entry file so the flow still shows the files the entry point depends on.
    const fallback = await this.importSlice(slice.root, slice.revision, maxNodes);
    return fallback ?? slice;
  }

  async diff(req: DiffRequest): Promise<SemanticDiff> {
    const resolved = await this.git.resolveRange(req.range);
    const ignoredPrefixes = [
      "graft/",
      ".reins/.cache/",
      ".swift-cache/",
      "node_modules/",
      "dist/",
      "out/",
      ".cargo-target/",
      ".cargo-home/",
    ];
    const visible = resolved.changes.filter(
      (change) => !ignoredPrefixes.some((prefix) => change.path.startsWith(prefix)),
    );
    const files = req.files
      ? visible.filter((change) => req.files?.includes(change.path))
      : visible;
    const limited = files.slice(0, 200);
    const maxOps = Math.min(Math.max(req.maxOperationsPerFile ?? 500, 1), 500);
    let operationsTruncated = false;
    const results = [];
    for (const change of limited) {
      const oldPath = change.oldPath ?? change.path;
      let oldSource: string | null = null;
      let newSource: string | null = null;
      if (resolved.mode === "commit") {
        if (change.status !== "added" && resolved.baseCommit) {
          oldSource = await this.git.readAt(resolved.baseCommit, oldPath);
        }
        if (change.status !== "deleted" && resolved.headCommit) {
          newSource = await this.git.readAt(resolved.headCommit, change.path);
        }
      } else {
        if (change.status !== "added") {
          if (resolved.mode === "unstaged") {
            oldSource = await this.git.readStaged(oldPath);
          } else if (resolved.baseCommit) {
            oldSource = await this.git.readAt(resolved.baseCommit, oldPath);
          }
        }
        if (change.status !== "deleted") {
          if (resolved.mode === "range" && resolved.headCommit) {
            newSource = await this.git.readAt(resolved.headCommit, change.path);
          } else if (resolved.mode === "staged") {
            newSource = await this.git.readStaged(change.path);
          } else {
            newSource = await this.git.readWorking(change.path);
          }
        }
      }
      const fileDiff = diffFile({
        path: change.path,
        oldPath: change.oldPath,
        oldSource,
        newSource,
        status: change.status,
        maxFileBytes: this.config.diff.maxFileBytes,
      });
      if (fileDiff.changes.length > maxOps) {
        operationsTruncated = true;
        fileDiff.changes = fileDiff.changes.slice(0, maxOps);
        results.push(finalizeFileDiff(fileDiff));
      } else {
        results.push(fileDiff);
      }
    }
    // Cross-file moves: pair a removed declaration with an added one of the same name.
    const removed: Array<{
      file: (typeof results)[number];
      change: (typeof results)[number]["changes"][number];
    }> = [];
    const added: Array<{
      file: (typeof results)[number];
      change: (typeof results)[number]["changes"][number];
    }> = [];
    for (const file of results) {
      for (const change of file.changes) {
        if (change.kind === "removed") removed.push({ file, change });
        if (change.kind === "added") added.push({ file, change });
      }
    }
    for (const old of removed) {
      const match = added.find(
        (candidate) =>
          candidate.change.symbol.name === old.change.symbol.name &&
          candidate.change.symbol.kind === old.change.symbol.kind &&
          candidate.file.path !== old.file.path,
      );
      if (!match) continue;
      old.file.changes = old.file.changes.filter((change) => change.id !== old.change.id);
      match.file.changes = match.file.changes.filter((change) => change.id !== match.change.id);
      match.file.changes.push({
        ...match.change,
        kind: "moved",
        from: old.change.from,
        flags: { moved: true, renamed: false, reformatOnly: false },
      });
      match.file.changes = finalizeFileDiff(match.file).changes;
      old.file.changes = finalizeFileDiff(old.file).changes;
    }

    return finalizeDiff({
      contractVersion: 1,
      range: req.range,
      resolved: {
        mode: resolved.mode,
        baseCommit: resolved.baseCommit,
        headCommit: resolved.headCommit,
        mergeBase: resolved.mergeBase,
      },
      files: results,
      truncated: files.length > limited.length || operationsTruncated,
      truncatedBy:
        files.length > limited.length ? "files" : operationsTruncated ? "operations" : null,
    });
  }

  async listNotes(filter?: NoteFilter): Promise<NoteSummary[]> {
    const loaded = await loadKnowledge(this.root, this.config.knowledgeDir);
    let notes = loaded.notes;
    if (filter?.type) notes = notes.filter((note) => note.type === filter.type);
    if (filter?.status) notes = notes.filter((note) => note.status === filter.status);
    if (filter?.tag) notes = notes.filter((note) => note.tags.includes(filter.tag as string));
    if (filter?.query) {
      const query = filter.query.toLowerCase();
      notes = notes.filter(
        (note) =>
          note.title.toLowerCase().includes(query) ||
          note.body.toLowerCase().includes(query) ||
          note.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
    return notes
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(noteSummary);
  }

  async getNote(id: string): Promise<KnowledgeNote> {
    const loaded = await loadKnowledge(this.root, this.config.knowledgeDir);
    const note = loaded.byId.get(id);
    if (!note) throw new ReinsError("NOTE_INVALID", `Unknown note: ${id}`);
    return note;
  }

  async proposeNote(input: NoteProposal): Promise<NoteProposalResult> {
    const loaded = await loadKnowledge(this.root, this.config.knowledgeDir);
    return proposeNote(this.root, this.config.knowledgeDir, input, loaded);
  }

  async check(req?: CheckRequest): Promise<CheckReport> {
    const loaded = await loadKnowledge(this.root, this.config.knowledgeDir);
    const revision = await this.revision();
    const items: CheckItem[] = [...loaded.errors];
    const scope = req?.scope ?? "knowledge";

    for (const note of loaded.notes) {
      if (
        folderMismatch(note, this.config.knowledgeDir) &&
        this.config.check.folderMismatch !== "off"
      ) {
        items.push({
          code: "NOTE_FOLDER_MISMATCH",
          severity: this.config.check.folderMismatch,
          message: `Note type "${note.type}" belongs in ${this.config.knowledgeDir}/${folderForType(note.type)}/.`,
          noteId: note.id,
          path: note.path,
        });
      }
      for (const link of note.links) {
        const target = linkTarget(link);
        if (target.kind === "note" && !loaded.byId.has(target.value)) {
          items.push({
            code: "LINK_BROKEN",
            severity: "error",
            message: `Note link target does not exist: ${target.value}`,
            noteId: note.id,
            path: note.path,
          });
        }
        if (target.kind === "file") {
          try {
            await fs.access(resolveWithinRoot(this.root, target.value));
          } catch {
            items.push({
              code: "LINK_BROKEN",
              severity: "error",
              message: `File link target does not exist: ${target.value}`,
              noteId: note.id,
              path: note.path,
            });
          }
        }
      }
    }

    if (scope === "knowledge+code" && this.config.check.verifyCodeLinks) {
      const surfacePage = await this.listSurfaces({ limit: 5000 });
      const surfaceIds = new Set(surfacePage.items.map((surface) => surface.id));
      for (const note of loaded.notes) {
        for (const link of note.links) {
          const target = linkTarget(link);
          if (target.kind === "surface" && !surfaceIds.has(target.value)) {
            items.push({
              code: "SURFACE_UNKNOWN",
              severity: "warning",
              message: `Surface not found: ${target.value}`,
              noteId: note.id,
              path: note.path,
            });
          }
        }
      }
      const skeletonCache = new Map<string, Set<string>>();
      for (const note of loaded.notes) {
        for (const link of note.links) {
          const target = linkTarget(link);
          if (target.kind !== "symbol") continue;
          const [file, name] = target.value.split("#");
          if (!file || !name) {
            items.push({
              code: "SYMBOL_UNKNOWN",
              severity: "error",
              message: `Invalid symbol link: ${target.value}`,
              noteId: note.id,
              path: note.path,
            });
            continue;
          }
          let names = skeletonCache.get(file);
          if (!names) {
            try {
              const skeleton = await this.trail.skeleton(file);
              names = new Set(skeleton.entries.map((entry) => entry.name));
            } catch {
              names = new Set();
            }
            skeletonCache.set(file, names);
          }
          if (!names.has(name)) {
            items.push({
              code: "SYMBOL_UNKNOWN",
              severity: "warning",
              message: `Symbol not found in the graph: ${target.value}`,
              noteId: note.id,
              path: note.path,
            });
          }
        }
      }
    }

    if (scope === "diff") {
      const diff = await this.diff({ range: { mode: "working" } });
      for (const note of loaded.notes) {
        if (note.type !== "constraint" || note.status !== "accepted") continue;
        const rule = note.frontmatter.rule as
          | { kind: "forbidden-import"; from: string; to: string }
          | { kind: "forbidden-call"; caller: string; callee: string }
          | undefined;
        if (!rule) {
          items.push({
            code: "CONSTRAINT_SKIPPED",
            severity: "info",
            message: `Constraint ${note.id} has no machine-checkable rule.`,
            noteId: note.id,
          });
          continue;
        }
        for (const file of diff.files) {
          if (rule.kind === "forbidden-import") {
            if (!matchesGlob(file.path, rule.from)) continue;
            const added = file.changes
              .filter((change) => change.kind === "added" || change.kind === "modified")
              .map((change) => change.to?.path ?? "");
            if (added.length > 0 && rule.to) {
              const source = await this.git.readWorking(file.path);
              if (source && importsPath(source, file.path, rule.to)) {
                items.push({
                  code: "CONSTRAINT_VIOLATED",
                  severity: "error",
                  message: `Constraint ${note.id}: ${file.path} imports ${rule.to}.`,
                  noteId: note.id,
                  path: file.path,
                });
              }
            }
          }
          if (rule.kind === "forbidden-call") {
            if (!matchesGlob(file.path, rule.caller)) continue;
            const source = await this.git.readWorking(file.path);
            if (source?.includes(rule.callee)) {
              items.push({
                code: "CONSTRAINT_VIOLATED",
                severity: "error",
                message: `Constraint ${note.id}: ${file.path} calls ${rule.callee}.`,
                noteId: note.id,
                path: file.path,
              });
            }
          }
        }
      }
    }

    const summary = {
      error: items.filter((item) => item.severity === "error").length,
      warning: items.filter((item) => item.severity === "warning").length,
      info: items.filter((item) => item.severity === "info").length,
    };
    const ok = req?.strict ? summary.error === 0 && summary.warning === 0 : summary.error === 0;
    return {
      contractVersion: 1,
      ok,
      scope,
      items: items.sort((a, b) => {
        const rank = { error: 0, warning: 1, info: 2 } as const;
        return (
          rank[a.severity] - rank[b.severity] ||
          (a.path ?? "").localeCompare(b.path ?? "") ||
          (a.line ?? 0) - (b.line ?? 0)
        );
      }),
      summary,
      revision: { ...revision, knowledgeHash: loaded.hash },
    };
  }

  async harnessPack(req: PackRequest): Promise<HarnessPack> {
    const loaded = await loadKnowledge(this.root, this.config.knowledgeDir);
    const revision = await this.revision();
    const surfaces = (await this.listSurfaces({ query: req.intent, limit: 20 })).items;
    const symbols = await this.searchSymbols(req.intent, { limit: 20 });
    const commands: string[] = [];
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(this.root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      for (const [name, command] of Object.entries(pkg.scripts ?? {}).slice(0, 8)) {
        commands.push(`pnpm ${name}  # ${command}`);
      }
    } catch {
      // no package.json
    }
    return composeHarnessPack({
      repoName: path.basename(this.root),
      revision,
      knowledgeHash: loaded.hash,
      request: req,
      surfaces,
      symbols,
      notes: loaded.notes,
      commands,
      excluded: [
        `${Math.max(loaded.notes.length - 20, 0)} notes below the relevance threshold`,
        `${Math.max(symbols.length - 20, 0)} symbols below the relevance threshold`,
      ],
    });
  }

  async readFile(
    file: string,
    rev: "working" | "staged" = "working",
  ): Promise<{ path: string; text: string }> {
    if (rev === "staged") {
      const text = await this.git.readStaged(file);
      return { path: file, text: text ?? "" };
    }
    const text = await fs.readFile(resolveWithinRoot(this.root, file), "utf8");
    return { path: file, text };
  }

  private async ensureScaffold(): Promise<string[]> {
    const created: string[] = [];
    const configPath = ".reins/config.json";
    try {
      await fs.access(resolveWithinRoot(this.root, configPath));
    } catch {
      await writeAtomic(this.root, configPath, `${JSON.stringify(this.config, null, 2)}\n`);
      created.push(configPath);
    }
    try {
      await fs.access(resolveWithinRoot(this.root, ".reins/.gitignore"));
    } catch {
      await writeAtomic(this.root, ".reins/.gitignore", ".cache/\n");
      created.push(".reins/.gitignore");
    }
    for (const folder of ["specs", "decisions", "constraints", "howto", "questions", "inbox"]) {
      const relative = `${this.config.knowledgeDir}/${folder}`;
      try {
        await fs.access(resolveWithinRoot(this.root, relative));
      } catch {
        await fs.mkdir(resolveWithinRoot(this.root, relative), { recursive: true });
        created.push(relative);
      }
    }
    return created;
  }

  async init(): Promise<void> {
    try {
      await fs.access(resolveWithinRoot(this.root, ".reins/config.json"));
      throw new ReinsError("CONFIG_INVALID", "A Reins config already exists.");
    } catch (err) {
      if (err instanceof ReinsError) throw err;
    }
    await this.ensureScaffold();
  }

  async bootstrap(): Promise<BootstrapResult> {
    const created = await this.ensureScaffold();
    let graphBuilt = false;
    const before = await this.status();
    if (before.graph.state !== "ready") {
      try {
        await this.refreshGraph({ force: true });
        graphBuilt = true;
      } catch {
        // status reports the precise graph state; bootstrap still finishes the scaffold
      }
    }
    const surfaces = (await this.listSurfaces({ limit: 1 })).total;
    return {
      contractVersion: 1,
      created,
      graphBuilt,
      surfaces,
      status: await this.status(),
    };
  }
}

export async function createSession(root: string): Promise<RepoSession> {
  return RepoSession.create(root);
}
