import path from "node:path";
import { parse } from "@babel/parser";
import {
  type ChangeKind,
  changeId,
  type DiffHunk,
  emptyStats,
  type FileDiff,
  finalizeFileDiff,
  type Language,
  type SemanticChange,
  type SymbolKind,
} from "@reinss/core";
import { structuredPatch } from "diff";

// shortcut: line hunks are skipped above 4000 lines, upgrade to a streaming
// diff if large-file line markers are needed.
const MAX_HUNK_LINES = 4000;

function lineHunks(oldText: string, newText: string): DiffHunk[] {
  if (oldText.split("\n").length > MAX_HUNK_LINES || newText.split("\n").length > MAX_HUNK_LINES) {
    return [];
  }
  const patch = structuredPatch("a", "b", oldText, newText, undefined, undefined, { context: 3 });
  return patch.hunks.map((hunk) => {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    const lines: DiffHunk["lines"] = [];
    for (const raw of hunk.lines) {
      if (raw.startsWith("\\")) continue;
      const kind = raw.startsWith("+") ? "added" : raw.startsWith("-") ? "removed" : "context";
      lines.push({
        kind,
        oldLine: kind === "added" ? null : oldLine,
        newLine: kind === "removed" ? null : newLine,
        text: raw.slice(1),
      });
      if (kind !== "added") oldLine += 1;
      if (kind !== "removed") newLine += 1;
    }
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines,
    };
  });
}

interface Decl {
  name: string;
  kind: SymbolKind;
  path: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  parent: string | null;
  hash: string;
  tokens: string[];
  source: string;
}

interface AstNode {
  type?: string;
  start?: number;
  end?: number;
  loc?: { start?: { line?: number }; end?: { line?: number } };
  [key: string]: unknown;
}

function languageFor(file: string): Language {
  const ext = path.extname(file);
  if (ext === ".tsx") return "tsx";
  if (ext === ".ts") return "typescript";
  if (ext === ".jsx") return "jsx";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".py") return "python";
  return "unknown";
}

function hashTokens(tokens: string[]): string {
  let hash = 2166136261;
  for (const token of tokens) {
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function nameOf(node: AstNode): string | null {
  const id = node.id as AstNode | undefined;
  if (id && typeof id.name === "string") return id.name;
  const key = node.key as AstNode | undefined;
  if (key && typeof key.name === "string") return key.name;
  if (key && typeof key.value === "string") return key.value;
  return null;
}

function kindOf(node: AstNode): SymbolKind {
  switch (node.type) {
    case "FunctionDeclaration":
      return "function";
    case "ClassDeclaration":
      return "class";
    case "ClassMethod":
    case "ObjectMethod":
      return "method";
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return "type";
    case "VariableDeclarator":
      return "constant";
    default:
      return "unknown";
  }
}

function collectDecls(
  file: string,
  source: string,
  ast: AstNode,
  tokens: Array<{ start?: number; end?: number; value?: unknown; type?: { label?: string } }>,
): Decl[] {
  const decls: Decl[] = [];
  const stack: AstNode[] = [];

  const visit = (node: unknown, parents: AstNode[]): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parents);
      return;
    }
    const current = node as AstNode;
    if (typeof current.type === "string") {
      const name = nameOf(current);
      const isDecl =
        current.type === "FunctionDeclaration" ||
        current.type === "ClassDeclaration" ||
        current.type === "ClassMethod" ||
        current.type === "ObjectMethod" ||
        current.type === "TSInterfaceDeclaration" ||
        current.type === "TSTypeAliasDeclaration" ||
        (current.type === "VariableDeclarator" && Boolean(current.init));
      if (isDecl && name && typeof current.start === "number" && typeof current.end === "number") {
        const parentName =
          parents.length > 0 ? nameOf(parents[parents.length - 1] as AstNode) : null;
        const nodeTokens = tokens
          .filter(
            (token) =>
              typeof token.start === "number" &&
              typeof token.end === "number" &&
              token.start >= (current.start as number) &&
              token.end <= (current.end as number) &&
              token.type?.label !== "CommentLine" &&
              token.type?.label !== "CommentBlock",
          )
          .map((token) => String(token.value ?? ""));
        decls.push({
          name,
          kind: kindOf(current),
          path: file,
          start: current.start,
          end: current.end,
          startLine: current.loc?.start?.line ?? 1,
          endLine: current.loc?.end?.line ?? current.loc?.start?.line ?? 1,
          parent: parentName,
          hash: hashTokens(nodeTokens),
          tokens: nodeTokens,
          source: source.slice(current.start, current.end),
        });
      }
    }
    for (const [key, value] of Object.entries(current)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "tokens" ||
        key === "comments"
      )
        continue;
      if (value && typeof value === "object") visit(value, [...parents, current]);
    }
  };

  visit(ast, stack);
  return decls;
}

function parseSource(
  file: string,
  source: string,
): {
  ast: AstNode;
  tokens: Array<{ start?: number; end?: number; value?: unknown; type?: { label?: string } }>;
} | null {
  const ext = path.extname(file);
  const plugins: string[] = [];
  if (ext === ".ts" || ext === ".tsx") plugins.push("typescript");
  if (ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".mjs" || ext === ".cjs")
    plugins.push("jsx");
  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      tokens: true,
      plugins: plugins as never[],
    }) as unknown as AstNode & {
      tokens?: Array<{ start?: number; end?: number; value?: unknown; type?: { label?: string } }>;
    };
    return { ast, tokens: ast.tokens ?? [] };
  } catch {
    return null;
  }
}

function makeChange(input: {
  kind: ChangeKind;
  name: string;
  symbolKind: SymbolKind;
  from: Decl | null;
  to: Decl | null;
  confidence?: "high" | "medium" | "low";
  flags?: Partial<SemanticChange["flags"]>;
  detail?: SemanticChange["detail"];
}): SemanticChange {
  const pathValue = input.to?.path ?? input.from?.path ?? "";
  return {
    id: changeId({
      path: pathValue,
      kind: input.kind,
      fromPath: input.from?.path,
      fromStart: input.from?.startLine,
      toPath: input.to?.path,
      toStart: input.to?.startLine,
      name: input.name,
    }),
    kind: input.kind,
    confidence: input.confidence ?? "high",
    symbol: {
      id: input.to
        ? `${input.to.path}#${input.to.name}`
        : input.from
          ? `${input.from.path}#${input.from.name}`
          : null,
      name: input.name,
      kind: input.symbolKind,
    },
    from: input.from
      ? {
          path: input.from.path,
          startLine: input.from.startLine,
          endLine: input.from.endLine,
          name: input.from.name,
        }
      : null,
    to: input.to
      ? {
          path: input.to.path,
          startLine: input.to.startLine,
          endLine: input.to.endLine,
          name: input.to.name,
        }
      : null,
    flags: {
      moved: input.flags?.moved ?? false,
      renamed: input.flags?.renamed ?? false,
      reformatOnly: input.flags?.reformatOnly ?? false,
    },
    detail: input.detail,
  };
}

function withoutName(decl: Decl): string[] {
  const index = decl.tokens.indexOf(decl.name);
  if (index < 0) return decl.tokens;
  return [...decl.tokens.slice(0, index), ...decl.tokens.slice(index + 1)];
}

function sameBody(a: Decl, b: Decl): boolean {
  const left = withoutName(a);
  const right = withoutName(b);
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of b) counts.set(token, (counts.get(token) ?? 0) + 1);
  let matched = 0;
  for (const token of a) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      matched += 1;
      counts.set(token, count - 1);
    }
  }
  return matched / Math.max(a.length, b.length);
}

export function diffFile(input: {
  path: string;
  oldPath?: string | null;
  oldSource: string | null;
  newSource: string | null;
  status: FileDiff["status"];
  maxFileBytes?: number;
}): FileDiff {
  const language = languageFor(input.path);
  const base: FileDiff = {
    path: input.path,
    oldPath: input.oldPath ?? null,
    status: input.status,
    language,
    degraded: false,
    changes: [],
    hunks: [],
    stats: emptyStats(),
  };

  const maxBytes = input.maxFileBytes ?? 1_048_576;
  if ((input.oldSource?.length ?? 0) > maxBytes || (input.newSource?.length ?? 0) > maxBytes) {
    return finalizeFileDiff({ ...base, degraded: true, degradedReason: "too-large" });
  }
  const hunks = lineHunks(input.oldSource ?? "", input.newSource ?? "");
  if (language === "unknown" || language === "python") {
    return finalizeFileDiff({
      ...base,
      hunks,
      degraded: true,
      degradedReason: "unsupported-language",
    });
  }

  const oldParsed = input.oldSource
    ? parseSource(input.oldPath ?? input.path, input.oldSource)
    : null;
  const newParsed = input.newSource ? parseSource(input.path, input.newSource) : null;
  if ((input.oldSource && !oldParsed) || (input.newSource && !newParsed)) {
    return finalizeFileDiff({ ...base, hunks, degraded: true, degradedReason: "parse-error" });
  }

  const oldDecls = oldParsed
    ? collectDecls(
        input.oldPath ?? input.path,
        input.oldSource ?? "",
        oldParsed.ast,
        oldParsed.tokens,
      )
    : [];
  const newDecls = newParsed
    ? collectDecls(input.path, input.newSource ?? "", newParsed.ast, newParsed.tokens)
    : [];

  const changes: SemanticChange[] = [];
  const matchedOld = new Set<Decl>();
  const matchedNew = new Set<Decl>();

  const byHash = new Map<string, Decl[]>();
  for (const decl of newDecls) {
    const list = byHash.get(decl.hash) ?? [];
    list.push(decl);
    byHash.set(decl.hash, list);
  }

  for (const oldDecl of oldDecls) {
    const candidates = byHash.get(oldDecl.hash) ?? [];
    const match = candidates.find((candidate) => !matchedNew.has(candidate));
    if (!match) continue;
    matchedOld.add(oldDecl);
    matchedNew.add(match);
    const moved = oldDecl.path !== match.path || oldDecl.parent !== match.parent;
    const renamed = oldDecl.name !== match.name;
    const reformatted = oldDecl.source !== match.source;
    if (!moved && !renamed && !reformatted) continue;
    changes.push(
      makeChange({
        kind: moved ? "moved" : renamed ? "renamed" : "reformatted",
        name: match.name,
        symbolKind: match.kind,
        from: oldDecl,
        to: match,
        flags: { moved, renamed, reformatOnly: !moved && !renamed && reformatted },
        detail: renamed ? { renamedFrom: oldDecl.name, renamedTo: match.name } : undefined,
      }),
    );
  }

  const unmatchedOld = oldDecls.filter((decl) => !matchedOld.has(decl));
  const unmatchedNew = newDecls.filter((decl) => !matchedNew.has(decl));

  for (const oldDecl of unmatchedOld) {
    const match = unmatchedNew.find(
      (candidate) =>
        !matchedNew.has(candidate) &&
        candidate.name === oldDecl.name &&
        candidate.kind === oldDecl.kind,
    );
    if (!match) continue;
    matchedOld.add(oldDecl);
    matchedNew.add(match);
    changes.push(
      makeChange({
        kind: "modified",
        name: match.name,
        symbolKind: match.kind,
        from: oldDecl,
        to: match,
        confidence: "high",
        detail: { tokenDelta: match.tokens.length - oldDecl.tokens.length },
      }),
    );
  }

  for (const oldDecl of oldDecls.filter((decl) => !matchedOld.has(decl))) {
    const rename = unmatchedNew.find(
      (candidate) =>
        !matchedNew.has(candidate) &&
        candidate.kind === oldDecl.kind &&
        sameBody(oldDecl, candidate) &&
        (candidate.name !== oldDecl.name ||
          candidate.path !== oldDecl.path ||
          candidate.parent !== oldDecl.parent),
    );
    if (rename) {
      matchedOld.add(oldDecl);
      matchedNew.add(rename);
      const moved = rename.path !== oldDecl.path || rename.parent !== oldDecl.parent;
      const renamed = rename.name !== oldDecl.name;
      changes.push(
        makeChange({
          kind: moved ? "moved" : "renamed",
          name: rename.name,
          symbolKind: rename.kind,
          from: oldDecl,
          to: rename,
          flags: { moved, renamed },
          detail: renamed ? { renamedFrom: oldDecl.name, renamedTo: rename.name } : undefined,
        }),
      );
      continue;
    }
    const extraction = unmatchedNew.find(
      (candidate) =>
        !matchedNew.has(candidate) &&
        candidate.kind === "function" &&
        tokenOverlap(candidate.tokens, oldDecl.tokens) >= 0.8 &&
        (input.newSource ?? "").includes(candidate.name),
    );
    if (extraction) {
      matchedNew.add(extraction);
      matchedOld.add(oldDecl);
      changes.push(
        makeChange({
          kind: "extracted",
          name: extraction.name,
          symbolKind: extraction.kind,
          from: oldDecl,
          to: extraction,
          confidence: "medium",
          detail: { extractedInto: extraction.name, reason: "token overlap >= 80%" },
        }),
      );
      continue;
    }
    changes.push(
      makeChange({
        kind: "removed",
        name: oldDecl.name,
        symbolKind: oldDecl.kind,
        from: oldDecl,
        to: null,
      }),
    );
  }

  for (const newDecl of newDecls.filter((decl) => !matchedNew.has(decl))) {
    changes.push(
      makeChange({
        kind: "added",
        name: newDecl.name,
        symbolKind: newDecl.kind,
        from: null,
        to: newDecl,
      }),
    );
  }

  return finalizeFileDiff({ ...base, changes, hunks });
}
