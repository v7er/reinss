import type { Surface, SurfaceKind } from "./types.js";

export function normalizeRoute(route: string): string {
  let value = route.trim();
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value;
}

export function nextRouteFromFile(file: string): string | null {
  const normalized = file.replace(/\\/g, "/");
  const match = /(?:^|\/)app\/(.*)\/(page|route)\.(?:tsx|ts|jsx|js)$/.exec(normalized);
  if (!match) return null;
  const segments = (match[1] ?? "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith("[") ? segment : segment));
  return normalizeRoute(`/${segments.join("/")}`);
}

export function surfaceId(input: {
  kind: SurfaceKind;
  framework: string;
  method?: string | null;
  route?: string | null;
  name?: string | null;
  file?: string;
}): string {
  const framework = input.framework.toLowerCase();
  if (input.kind === "http") {
    return `http:${framework}:${(input.method ?? "GET").toUpperCase()}:${normalizeRoute(input.route ?? "/")}`;
  }
  if (input.kind === "cli") {
    return `cli:${framework}:${(input.route ?? input.name ?? "command").replace(/^\/+/, "")}`;
  }
  if (input.kind === "page" || input.kind === "screen") {
    return `${input.kind}:${framework}:${normalizeRoute(input.route ?? input.name ?? "/")}`;
  }
  return `export:${framework}:${input.name ?? input.file ?? "unknown"}`;
}

export function sortSurfaces(surfaces: Surface[]): Surface[] {
  return [...surfaces].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.framework.localeCompare(b.framework) ||
      (a.route ?? "").localeCompare(b.route ?? "") ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

export function verifySurfaceSymbols(
  surfaces: Surface[],
  namesByFile: Map<string, Set<string>>,
): Surface[] {
  return surfaces.map((surface) => {
    if (!surface.symbolName || !surface.symbolId) return surface;
    const names = namesByFile.get(surface.file);
    if (!names) return surface;
    if (names.has(surface.symbolName)) return surface;
    return {
      ...surface,
      symbolId: null,
      confidence: "inferred",
      metadata: {
        ...surface.metadata,
        linkReason: surface.metadata.linkReason ?? "symbol-not-in-graph",
      },
    };
  });
}
