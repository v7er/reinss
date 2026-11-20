import type { Component, ComponentKind } from "./types.js";

const kindRules: Array<[RegExp, ComponentKind]> = [
  [/(^|[/_.-])(mobile|ios|android|expo|react-native|flutter|native)([/_.-]|$)/i, "mobile"],
  [
    /(^|[/_.-])(backoffice|back-office|admin|dashboard|console|internal|bo)([/_.-]|$)/i,
    "backoffice",
  ],
  [/(^|[/_.-])(cli|cmd|command|bin|terminal)([/_.-]|$)/i, "cli"],
  [/(^|[/_.-])(web|webapp|frontend|front-end|site|www|client|desktop|portal)([/_.-]|$)/i, "webapp"],
  [/(^|[/_.-])(core|lib|libs|shared|common|sdk|domain|kernel)([/_.-]|$)/i, "core"],
  [/(^|[/_.-])(api|server|service|services|backend|worker|gateway)([/_.-]|$)/i, "service"],
  [/(^|[/_.-])(package|packages|plugin|plugins|tool|tools|utils|library)([/_.-]|$)/i, "library"],
];

const kindOrder: ComponentKind[] = [
  "webapp",
  "mobile",
  "backoffice",
  "core",
  "cli",
  "service",
  "library",
  "unknown",
];

export function componentKindFromPath(value: string): ComponentKind {
  const normalized = value.replace(/\\/g, "/");
  for (const [pattern, kind] of kindRules) {
    if (pattern.test(normalized)) return kind;
  }
  return "unknown";
}

export function componentIdFromRoot(root: string): string {
  const normalized = root
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
  if (!normalized) return "root";
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assignComponent(file: string, components: Component[]): string {
  const normalized = file.replace(/\\/g, "/");
  let best: Component | null = null;
  for (const component of components) {
    if (component.root && !normalized.startsWith(`${component.root}/`)) continue;
    if (!best || component.root.length > best.root.length) best = component;
  }
  return best?.id ?? "root";
}

export function sortComponents(components: Component[]): Component[] {
  return [...components].sort(
    (a, b) =>
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
