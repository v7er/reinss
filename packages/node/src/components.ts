import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type Component,
  componentIdFromRoot,
  componentKindFromPath,
  sortComponents,
} from "@reinss/core";
import fg from "fast-glob";
import { readJson, readText, resolveWithinRoot } from "./paths.js";

interface Manifest {
  root: string;
  packageName: string | null;
  languages: string[];
}

const manifestFiles: Array<{ file: string; language: string }> = [
  { file: "package.json", language: "typescript" },
  { file: "Cargo.toml", language: "rust" },
  { file: "go.mod", language: "go" },
  { file: "pyproject.toml", language: "python" },
  { file: "composer.json", language: "php" },
  { file: "Gemfile", language: "ruby" },
  { file: "pom.xml", language: "java" },
  { file: "build.gradle", language: "java" },
  { file: "build.gradle.kts", language: "java" },
];

function workspaceGlobsFromPackageJson(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const workspaces = (raw as { workspaces?: unknown }).workspaces;
  if (Array.isArray(workspaces))
    return workspaces.filter((item): item is string => typeof item === "string");
  if (workspaces && typeof workspaces === "object") {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages))
      return packages.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function workspaceGlobsFromPnpm(text: string): string[] {
  const lines = text.split("\n");
  const globs: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line);
    if (item?.[1]) {
      globs.push(item[1].trim());
      continue;
    }
    if (/^\S/.test(line)) break;
  }
  return globs;
}

function workspaceGlobsFromCargo(text: string): string[] {
  const workspace = /\[workspace\]([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (!workspace?.[1]) return [];
  const members = /members\s*=\s*\[([\s\S]*?)\]/.exec(workspace[1]);
  if (!members?.[1]) return [];
  return [...members[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "").filter(Boolean);
}

function workspaceGlobsFromGoWork(text: string): string[] {
  const globs: string[] = [];
  const block = /use\s*\(([\s\S]*?)\)/.exec(text);
  if (block?.[1]) {
    for (const line of block[1].split("\n")) {
      const item = /^\s*([^\s/][^\s]*)\s*$/.exec(line);
      if (item?.[1]) globs.push(item[1]);
    }
  }
  for (const match of text.matchAll(/^use\s+([^\s(]+)\s*$/gm)) {
    if (match[1]) globs.push(match[1]);
  }
  return globs.map((glob) => glob.replace(/^\.\//, ""));
}

async function readManifest(root: string, dir: string): Promise<Manifest | null> {
  const languages: string[] = [];
  let packageName: string | null = null;
  for (const { file, language } of manifestFiles) {
    const relative = dir ? `${dir}/${file}` : file;
    try {
      await fs.access(resolveWithinRoot(root, relative));
    } catch {
      continue;
    }
    if (!languages.includes(language)) languages.push(language);
    if (packageName) continue;
    if (file === "package.json" || file === "composer.json") {
      const json = await readJson<{ name?: string }>(root, relative);
      packageName = json?.name ?? null;
    } else if (file === "Cargo.toml" || file === "pyproject.toml") {
      const text = await readText(root, relative);
      packageName = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
    } else if (file === "go.mod") {
      const text = await readText(root, relative);
      packageName = /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
    } else if (file === "pom.xml") {
      const text = await readText(root, relative);
      packageName = /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1] ?? null;
    }
  }
  if (languages.length === 0) return null;
  return { root: dir, packageName, languages };
}

function toComponent(manifest: Manifest, fallbackName: string): Component {
  const name = manifest.packageName ?? fallbackName;
  return {
    id: componentIdFromRoot(manifest.root),
    name,
    kind: componentKindFromPath(`${manifest.root}/${name}`),
    root: manifest.root,
    packageName: manifest.packageName,
    languages: manifest.languages,
    surfaceCount: 0,
    changed: false,
  };
}

export async function discoverComponents(root: string): Promise<Component[]> {
  const globs = new Set<string>();
  const rootPackage = await readJson<unknown>(root, "package.json");
  for (const glob of workspaceGlobsFromPackageJson(rootPackage)) globs.add(glob);

  const pnpmWorkspace = await readText(root, "pnpm-workspace.yaml").catch(() => null);
  if (pnpmWorkspace) {
    for (const glob of workspaceGlobsFromPnpm(pnpmWorkspace)) globs.add(glob);
  }
  const cargo = await readText(root, "Cargo.toml").catch(() => null);
  if (cargo) {
    for (const glob of workspaceGlobsFromCargo(cargo)) globs.add(glob);
  }
  const goWork = await readText(root, "go.work").catch(() => null);
  if (goWork) {
    for (const glob of workspaceGlobsFromGoWork(goWork)) globs.add(glob);
  }

  const manifests: Manifest[] = [];
  const rootManifest = await readManifest(root, "");
  if (rootManifest) manifests.push(rootManifest);

  if (globs.size > 0) {
    const dirs = await fg([...globs], {
      cwd: root,
      onlyDirectories: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/target/**", "**/dist/**", "**/.git/**"],
    });
    for (const dir of dirs.sort()) {
      const manifest = await readManifest(root, dir);
      if (manifest) manifests.push(manifest);
    }
  }

  const byRoot = new Map<string, Manifest>();
  for (const manifest of manifests) {
    const existing = byRoot.get(manifest.root);
    if (!existing) {
      byRoot.set(manifest.root, { ...manifest, languages: [...manifest.languages] });
      continue;
    }
    existing.packageName = existing.packageName ?? manifest.packageName;
    for (const language of manifest.languages) {
      if (!existing.languages.includes(language)) existing.languages.push(language);
    }
  }

  if (!byRoot.has("")) {
    byRoot.set("", { root: "", packageName: null, languages: [] });
  }

  const components = [...byRoot.values()].map((manifest) =>
    toComponent(manifest, manifest.root ? path.basename(manifest.root) : path.basename(root)),
  );
  return sortComponents(components);
}
