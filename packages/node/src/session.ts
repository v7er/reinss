import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CheckItem,
  type CheckReport,
  type CheckRequest,
  composeHarnessPack,
  computeFingerprint,
  contractVersion,
  type DiffRequest,
  defaultConfig,
  type FlowRequest,
  finalizeDiff,
  finalizeFileDiff,
  folderForType,
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
  type PackRequest,
  parseConfig,
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
} from "@reins/core";
import fg from "fast-glob";
import { readCache, writeCache } from "./cache.js";
import { diffFile } from "./diff.js";
import { GitAdapter } from "./git.js";
import { folderMismatch, loadKnowledge, noteSummary, proposeNote } from "./knowledge.js";
import { readJson, resolveWithinRoot, writeAtomic } from "./paths.js";
import { type ScanDiagnostic, scanSurfaces } from "./surfaces.js";
import { TrailAdapter } from "./trail.js";

const ADAPTER_VERSION = "0.1.0";
const SURFACE_CACHE = ".reins/.cache/surfaces.json";
const SURFACE_DETECTOR_VERSION = 2;

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

export class RepoSession implements ReinsApi {
  readonly root: string;
  readonly config: typeof defaultConfig;
  private readonly trail: TrailAdapter;
  private readonly git: GitAdapter;
  private fingerprintCache: { value: GraphRevision; at: number } | null = null;
  private surfaceCache: SurfaceCacheData | null = null;

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

  async refreshGraph(opts?: RefreshOptions): Promise<RepoStatus> {
    if (!opts?.force) {
      const current = await this.status();
      if (current.graph.state === "ready") return current;
    }
    await this.trail.build();
    this.fingerprintCache = null;
    this.surfaceCache = null;
    return this.status();
  }

  async searchSymbols(q: string, opts?: SearchOptions): Promise<SymbolHit[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 50);
    const result = await this.trail.ask(q, limit);
    return normalizeAsk(result, limit).filter(
      (hit) => !opts?.pathPrefix || hit.path.startsWith(opts.pathPrefix),
    );
  }

  private async resolveRoot(req: GraphRequest): Promise<string> {
    const root = req.root;
    if ("symbolId" in root) return root.symbolId;
    if ("surfaceId" in root) {
      const surfaceId = root.surfaceId;
      const page = await this.listSurfaces({ limit: 5000 });
      const surface = page.items.find((item) => item.id === surfaceId);
      if (!surface) {
        throw new ReinsError("SURFACE_NOT_FOUND", `Unknown surface: ${surfaceId}`);
      }
      if (!surface.symbolId) {
        throw new ReinsError("SYMBOL_NOT_FOUND", `Surface ${surface.id} has no linked symbol.`, {
          details: { surfaceId: surface.id },
        });
      }
      return surface.symbolId;
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
    return id;
  }

  async graph(req: GraphRequest): Promise<GraphSlice> {
    const symbol = await this.resolveRoot(req);
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
      return mergeSlices(a, b, maxNodes);
    }
    const result = await this.trail.callers({
      symbol,
      direction,
      depth,
      ...(req.pathPrefix ? { pathPrefix: req.pathPrefix } : {}),
    });
    return normalizeCallers(result, base);
  }

  async listSurfaces(filter?: SurfaceFilter): Promise<SurfacePage> {
    const revision = await this.revision();
    const cacheKey = `${revision.fingerprint}:d${SURFACE_DETECTOR_VERSION}`;
    const canCache = revision.gitHead !== null;
    let data = this.surfaceCache;
    if (!data) {
      const cached = canCache ? await readCache<SurfaceCacheData>(this.root, SURFACE_CACHE) : null;
      if (cached && cached.fingerprint === cacheKey) {
        data = cached.data;
      } else {
        const scan = await scanSurfaces(this.root, {
          detectors: this.config.surfaces.detectors,
          ignore: [...this.config.ignore, ...this.config.surfaces.ignore],
        });
        data = { surfaces: scan.surfaces, diagnostics: scan.diagnostics };
        if (canCache) await writeCache(this.root, SURFACE_CACHE, cacheKey, data);
      }
      this.surfaceCache = data;
    }

    let items = data.surfaces;
    if (filter?.kind) items = items.filter((item) => item.kind === filter.kind);
    if (filter?.framework) items = items.filter((item) => item.framework === filter.framework);
    if (filter?.pathPrefix)
      items = items.filter((item) => item.file.startsWith(filter.pathPrefix as string));
    if (filter?.confidence) items = items.filter((item) => item.confidence === filter.confidence);
    if (filter?.query) {
      const query = filter.query.toLowerCase();
      items = items.filter(
        (item) =>
          item.id.toLowerCase().includes(query) ||
          item.label.toLowerCase().includes(query) ||
          (item.symbolName ?? "").toLowerCase().includes(query),
      );
    }
    const offset = Math.max(filter?.offset ?? 0, 0);
    const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 1000);
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return {
      contractVersion: 1,
      items: page,
      total,
      offset,
      limit,
      truncated: offset + page.length < total,
      stale: !revision.inSync,
    };
  }

  async flow(req: FlowRequest): Promise<GraphSlice> {
    const target = req.target.trim();
    let symbolId: string | null = null;
    if (target.includes("#")) {
      symbolId = target;
    } else {
      const page = await this.listSurfaces({ limit: 5000 });
      const surface = page.items.find(
        (item) =>
          item.id === target ||
          (item.route && `${item.method ?? ""} ${item.route}`.trim() === target) ||
          item.route === target,
      );
      if (surface?.symbolId) symbolId = surface.symbolId;
      if (!surface) {
        const hits = await this.searchSymbols(target, { limit: 2 });
        if (hits.length === 1 && hits[0]?.id) symbolId = hits[0].id;
      }
    }
    if (!symbolId) {
      throw new ReinsError("SURFACE_NOT_FOUND", `No surface or symbol matched "${target}".`);
    }
    return this.graph({
      root: { symbolId },
      direction: req.direction ?? "out",
      depth: req.depth ?? 3,
      maxNodes: req.maxNodes ?? 500,
    });
  }

  async diff(req: DiffRequest): Promise<SemanticDiff> {
    const resolved = await this.git.resolveRange(req.range);
    const files = req.files
      ? resolved.changes.filter((change) => req.files?.includes(change.path))
      : resolved.changes;
    const limited = files.slice(0, 200);
    const maxOps = Math.min(Math.max(req.maxOperationsPerFile ?? 500, 1), 500);
    let operationsTruncated = false;
    const results = [];
    for (const change of limited) {
      const oldPath = change.oldPath ?? change.path;
      let oldSource: string | null = null;
      let newSource: string | null = null;
      if (change.status !== "added" && resolved.baseCommit) {
        oldSource = await this.git.readAt(resolved.baseCommit, oldPath);
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

  async readFile(file: string): Promise<{ path: string; text: string }> {
    const text = await fs.readFile(resolveWithinRoot(this.root, file), "utf8");
    return { path: file, text };
  }

  async init(): Promise<void> {
    const configPath = ".reins/config.json";
    try {
      await fs.access(resolveWithinRoot(this.root, configPath));
      throw new ReinsError("CONFIG_INVALID", "A Reins config already exists.");
    } catch (err) {
      if (err instanceof ReinsError) throw err;
    }
    await writeAtomic(this.root, configPath, `${JSON.stringify(this.config, null, 2)}\n`);
    await writeAtomic(this.root, ".reins/.gitignore", ".cache/\n");
    for (const folder of ["specs", "decisions", "constraints", "howto", "questions", "inbox"]) {
      await fs.mkdir(resolveWithinRoot(this.root, `${this.config.knowledgeDir}/${folder}`), {
        recursive: true,
      });
    }
  }
}

export async function createSession(root: string): Promise<RepoSession> {
  return RepoSession.create(root);
}
