import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import {
  nextRouteFromFile,
  normalizeRoute,
  type Surface,
  type SurfaceKind,
  sortSurfaces,
  surfaceId,
} from "@reins/core";
import fg from "fast-glob";
import { resolveWithinRoot } from "./paths.js";

export interface ScanDiagnostic {
  detector: string;
  file: string;
  severity: "error" | "warning";
  message: string;
}

export interface ScanResult {
  surfaces: Surface[];
  diagnostics: ScanDiagnostic[];
}

interface AstNode {
  type?: string;
  [key: string]: unknown;
}

const httpMethods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all"]);

function walk(
  node: unknown,
  stack: AstNode[],
  cb: (node: AstNode, stack: AstNode[]) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, stack, cb);
    return;
  }
  const current = node as AstNode;
  if (typeof current.type === "string") cb(current, stack);
  for (const [key, value] of Object.entries(current)) {
    if (key === "loc" || key === "start" || key === "end" || key === "tokens" || key === "comments")
      continue;
    if (value && typeof value === "object") walk(value, [...stack, current], cb);
  }
}

function stringValue(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as AstNode;
  if (n.type === "StringLiteral" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral") {
    const quasis = n.quasis as Array<{ value?: { cooked?: string } }> | undefined;
    if (quasis?.length === 1) return quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function memberName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as AstNode;
  if (n.type !== "MemberExpression") return null;
  const property = n.property as AstNode | undefined;
  if (property?.type === "Identifier" && typeof property.name === "string") return property.name;
  return null;
}

function calleeName(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const n = node as AstNode;
  if (n.type === "Identifier" && typeof n.name === "string") return n.name;
  if (n.type === "MemberExpression") return memberName(n);
  return null;
}

function enclosingName(stack: AstNode[]): string | null {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const node = stack[i];
    if (!node) continue;
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration" ||
        node.type === "TSInterfaceDeclaration") &&
      node.id &&
      typeof (node.id as AstNode).name === "string"
    ) {
      return (node.id as AstNode).name as string;
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id &&
      typeof (node.id as AstNode).name === "string"
    ) {
      return (node.id as AstNode).name as string;
    }
  }
  return null;
}

function handlerName(arg: unknown, stack: AstNode[]): string | null {
  if (!arg || typeof arg !== "object") return null;
  const node = arg as AstNode;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "MemberExpression") return memberName(node);
  return enclosingName(stack);
}

function makeSurface(input: {
  kind: SurfaceKind;
  framework: string;
  route: string | null;
  method: string | null;
  file: string;
  line: number;
  symbolName: string | null;
  detector: string;
  confidence?: "exact" | "inferred";
  metadata?: Record<string, string | number | boolean>;
}): Surface {
  const symbolId = input.symbolName ? `${input.file}#${input.symbolName}` : input.file;
  const symbolName = input.symbolName ?? path.basename(input.file);
  return {
    id: surfaceId({
      kind: input.kind,
      framework: input.framework,
      method: input.method,
      route: input.route,
      name: input.symbolName,
      file: input.file,
    }),
    kind: input.kind,
    framework: input.framework,
    label: input.route ?? input.symbolName ?? input.file,
    route: input.route,
    method: input.method,
    symbolId,
    symbolName,
    file: input.file,
    line: input.line,
    confidence: input.confidence ?? (symbolId ? "exact" : "inferred"),
    evidence: "ast",
    detector: input.detector,
    detectorVersion: 1,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.symbolName ? {} : { linkReason: "file-node" }),
    },
  };
}

function parseFile(file: string, source: string): AstNode | null {
  const ext = path.extname(file);
  const plugins: string[] = [];
  if (ext === ".ts" || ext === ".tsx") plugins.push("typescript");
  if (ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    plugins.push("jsx");
  }
  try {
    return parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: plugins as never[],
    }) as unknown as AstNode;
  } catch {
    return null;
  }
}

function detectHttpFrameworks(
  file: string,
  ast: AstNode,
  framework: "express" | "hono",
): Surface[] {
  const surfaces: Surface[] = [];
  walk(ast, [], (node, stack) => {
    if (node.type === "CallExpression") {
      const callee = node.callee as AstNode | undefined;
      const method = memberName(callee);
      const object =
        callee?.type === "MemberExpression" ? (callee.object as AstNode | undefined) : undefined;
      const objectName = object?.type === "Identifier" ? (object.name as string) : null;
      if (
        method &&
        httpMethods.has(method) &&
        objectName &&
        ["app", "router", "server", "api"].includes(objectName)
      ) {
        const args = (node.arguments as unknown[]) ?? [];
        const route = stringValue(args[0]);
        if (route) {
          const handler = handlerName(args[1], stack);
          surfaces.push(
            makeSurface({
              kind: "http",
              framework,
              route: normalizeRoute(route),
              method: method.toUpperCase(),
              file,
              line:
                typeof node.loc === "object" && node.loc
                  ? ((node.loc as { start?: { line?: number } }).start?.line ?? 1)
                  : 1,
              symbolName: handler,
              detector: framework,
            }),
          );
        }
      }
    }
  });
  return surfaces;
}

function detectCommander(file: string, ast: AstNode): Surface[] {
  const surfaces: Surface[] = [];
  walk(ast, [], (node, stack) => {
    if (node.type === "CallExpression") {
      const callee = node.callee as AstNode | undefined;
      const method = memberName(callee);
      if (method === "command") {
        const args = (node.arguments as unknown[]) ?? [];
        const command = stringValue(args[0]);
        if (command) {
          surfaces.push(
            makeSurface({
              kind: "cli",
              framework: "commander",
              route: command,
              method: null,
              file,
              line:
                typeof node.loc === "object" && node.loc
                  ? ((node.loc as { start?: { line?: number } }).start?.line ?? 1)
                  : 1,
              symbolName: enclosingName(stack),
              detector: "commander",
            }),
          );
        }
      }
    }
  });
  return surfaces;
}

function detectNext(file: string, ast: AstNode): Surface[] {
  const route = nextRouteFromFile(file);
  if (!route) return [];
  const surfaces: Surface[] = [];
  const isRouteHandler = /\/route\.(ts|js|tsx|jsx)$/.test(file);
  walk(ast, [], (node) => {
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration as AstNode | undefined;
      const name =
        decl?.type === "FunctionDeclaration" && decl.id
          ? ((decl.id as AstNode).name as string)
          : decl?.type === "Identifier"
            ? (decl.name as string)
            : "default";
      surfaces.push(
        makeSurface({
          kind: "page",
          framework: "next-app",
          route,
          method: null,
          file,
          line:
            typeof node.loc === "object" && node.loc
              ? ((node.loc as { start?: { line?: number } }).start?.line ?? 1)
              : 1,
          symbolName: name,
          detector: "next-app",
        }),
      );
    }
    if (isRouteHandler && node.type === "ExportNamedDeclaration") {
      const decl = node.declaration as AstNode | undefined;
      const name =
        decl?.type === "FunctionDeclaration" && decl.id
          ? ((decl.id as AstNode).name as string)
          : decl?.type === "VariableDeclaration"
            ? (((decl.declarations as AstNode[] | undefined)?.[0]?.id as AstNode | undefined)
                ?.name as string | undefined)
            : undefined;
      if (name && httpMethods.has(name.toLowerCase())) {
        surfaces.push(
          makeSurface({
            kind: "http",
            framework: "next-app",
            route,
            method: name.toUpperCase(),
            file,
            line:
              typeof node.loc === "object" && node.loc
                ? ((node.loc as { start?: { line?: number } }).start?.line ?? 1)
                : 1,
            symbolName: name,
            detector: "next-app",
          }),
        );
      }
    }
  });
  return surfaces;
}

function detectReactRouter(file: string, ast: AstNode): Surface[] {
  const surfaces: Surface[] = [];
  walk(ast, [], (node) => {
    if (node.type === "CallExpression" && calleeName(node.callee) === "createBrowserRouter") {
      const args = (node.arguments as unknown[]) ?? [];
      const routes = args[0];
      if (Array.isArray(routes)) {
        for (const route of routes) {
          const routeNode = route as AstNode;
          const props = routeNode.properties as AstNode[] | undefined;
          if (!props) continue;
          const pathProp = props.find((p) => (p.key as AstNode | undefined)?.name === "path");
          const routePath = stringValue(pathProp?.value);
          if (routePath) {
            surfaces.push(
              makeSurface({
                kind: "page",
                framework: "react-router",
                route: normalizeRoute(routePath),
                method: null,
                file,
                line:
                  typeof routeNode.loc === "object" && routeNode.loc
                    ? ((routeNode.loc as { start?: { line?: number } }).start?.line ?? 1)
                    : 1,
                symbolName: null,
                detector: "react-router",
              }),
            );
          }
        }
      }
    }
    if (node.type === "JSXElement") {
      const opening = node.openingElement as AstNode | undefined;
      const nameNode = opening?.name as AstNode | undefined;
      if (nameNode?.type === "JSXIdentifier" && nameNode.name === "Route") {
        const attrs = (opening?.attributes as AstNode[] | undefined) ?? [];
        const pathAttr = attrs.find(
          (a) => a.type === "JSXAttribute" && (a.name as AstNode | undefined)?.name === "path",
        );
        const routePath = stringValue(pathAttr?.value);
        if (routePath) {
          surfaces.push(
            makeSurface({
              kind: "page",
              framework: "react-router",
              route: normalizeRoute(routePath),
              method: null,
              file,
              line:
                typeof node.loc === "object" && node.loc
                  ? ((node.loc as { start?: { line?: number } }).start?.line ?? 1)
                  : 1,
              symbolName: null,
              detector: "react-router",
            }),
          );
        }
      }
    }
  });
  return surfaces;
}

function detectFastApi(file: string, source: string): Surface[] {
  const surfaces: Surface[] = [];
  const lines = source.split("\n");
  const pattern =
    /^\s*@(app|router)\.(get|post|put|patch|delete|options|head)\(\s*["']([^"']+)["']/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = pattern.exec(lines[i] ?? "");
    if (!match) continue;
    let name: string | null = null;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      const def = /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[j] ?? "");
      if (def) {
        name = def[1] ?? null;
        break;
      }
    }
    surfaces.push(
      makeSurface({
        kind: "http",
        framework: "fastapi",
        route: normalizeRoute(match[3] ?? "/"),
        method: (match[2] ?? "get").toUpperCase(),
        file,
        line: i + 1,
        symbolName: name,
        detector: "fastapi",
      }),
    );
  }
  return surfaces;
}

const codeGlobs = ["**/*.{ts,tsx,js,jsx,mjs,cjs,py}"];
const defaultIgnore = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/.git/**",
  "**/vendor/**",
];

export async function scanSurfaces(
  root: string,
  options: { detectors?: string[]; ignore?: string[]; maxFiles?: number } = {},
): Promise<ScanResult> {
  const enabled = new Set(
    options.detectors ?? ["express", "hono", "commander", "next-app", "react-router", "fastapi"],
  );
  const surfaces: Surface[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const ignore = [...defaultIgnore, ...(options.ignore ?? [])];
  let count = 0;
  const maxFiles = options.maxFiles ?? 20_000;

  const stream = fg.stream(codeGlobs, {
    cwd: root,
    ignore,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
  });

  for await (const entry of stream) {
    const file = String(entry);
    count += 1;
    if (count > maxFiles) break;
    if (file.includes("/node_modules/") || file.startsWith("node_modules/")) continue;
    let source: string;
    try {
      const stat = await fs.stat(resolveWithinRoot(root, file));
      if (stat.size > 1_048_576) continue;
      source = await fs.readFile(resolveWithinRoot(root, file), "utf8");
    } catch {
      continue;
    }

    const isNext = /(?:^|\/)app\/.*\/(page|route)\.(tsx|ts|jsx|js)$/.test(file);
    const isPython = file.endsWith(".py");
    const hasExpress =
      /(?:app|router|server|api)\.(get|post|put|patch|delete|options|head|all)\s*\(/.test(source);
    const isHono = /from\s+['"]hono['"]/.test(source);
    const isExpress = /from\s+['"]express['"]/.test(source);
    const hasCommander = /\.command\s*\(/.test(source);
    const hasRouter = /createBrowserRouter|<Route\b/.test(source);

    if (isPython) {
      if (enabled.has("fastapi") && /@(app|router)\.(get|post|put|patch|delete)/.test(source)) {
        surfaces.push(...detectFastApi(file, source));
      }
      continue;
    }

    if (!isNext && !hasExpress && !hasCommander && !hasRouter) continue;

    const ast = parseFile(file, source);
    if (!ast) {
      diagnostics.push({
        detector: "parser",
        file,
        severity: "warning",
        message: "Could not parse file.",
      });
      continue;
    }

    try {
      if (isNext && enabled.has("next-app")) surfaces.push(...detectNext(file, ast));
      if (hasExpress && enabled.has("express") && (isExpress || !isHono)) {
        surfaces.push(...detectHttpFrameworks(file, ast, "express"));
      }
      if (hasExpress && enabled.has("hono") && isHono) {
        surfaces.push(...detectHttpFrameworks(file, ast, "hono"));
      }
      if (hasCommander && enabled.has("commander")) surfaces.push(...detectCommander(file, ast));
      if (hasRouter && enabled.has("react-router")) surfaces.push(...detectReactRouter(file, ast));
    } catch (err) {
      diagnostics.push({
        detector: "detector",
        file,
        severity: "warning",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const seen = new Set<string>();
  const unique = sortSurfaces(surfaces).filter((surface) => {
    const key = `${surface.id}|${surface.file}|${surface.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { surfaces: unique, diagnostics };
}
