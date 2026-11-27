import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CheckItem,
  type CoverageItem,
  type KnowledgeComponent,
  type KnowledgeNode,
  type KnowledgeTemplate,
  type KnowledgeTree,
  type KnowledgeTreeNode,
  layerFor,
  layerIssue,
  parseAliases,
  parseTemplate,
  templateConflicts,
} from "@reinss/core";
import fg from "fast-glob";
import { type LoadedNodes, loadKnowledgeNodes } from "./knowledge.js";
import { resolveWithinRoot } from "./paths.js";

export interface LoadedTree {
  tree: KnowledgeTree;
  nodes: KnowledgeNode[];
  loaded: LoadedNodes;
  aliases: Record<string, string[]>;
  templateText: string | null;
}

function parentDirs(component: string): string[] {
  const parts = component ? component.split("/") : [];
  const dirs: string[] = [""];
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    dirs.push(current);
  }
  return dirs;
}

async function readIndexOrder(root: string, dir: string): Promise<string[]> {
  for (const file of ["index.yaml", "index.json"]) {
    try {
      const text = await fs.readFile(resolveWithinRoot(root, `${dir}/${file}`), "utf8");
      if (file.endsWith(".json")) {
        const parsed = JSON.parse(text) as { order?: unknown };
        if (Array.isArray(parsed.order))
          return parsed.order.filter((item) => typeof item === "string");
        continue;
      }
      const order: string[] = [];
      let inOrder = false;
      for (const line of text.split(/\r?\n/)) {
        if (/^order\s*:/.test(line)) {
          inOrder = true;
          continue;
        }
        if (!inOrder) continue;
        const item = /^\s*-\s*(.+)$/.exec(line);
        if (item?.[1]) order.push(item[1].trim().replace(/^['"]|['"]$/g, ""));
        else if (line.trim() && !line.startsWith(" ")) inOrder = false;
      }
      return order;
    } catch {
      // try the next index file
    }
  }
  return [];
}

export async function codeAreas(root: string): Promise<Array<{ name: string; path: string }>> {
  const areas: Array<{ name: string; path: string }> = [];
  const seen = new Set<string>();
  const add = (name: string, codePath: string) => {
    const key = `${name}:${codePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    areas.push({ name, path: codePath });
  };

  try {
    const workspace = await fs.readFile(resolveWithinRoot(root, "pnpm-workspace.yaml"), "utf8");
    const patterns = [...workspace.matchAll(/^\s*-\s*['"]?([^'"\n#]+)['"]?\s*$/gm)]
      .map((match) => match[1]?.trim() ?? "")
      .filter((pattern) => pattern && !pattern.includes(":"));
    for (const pattern of patterns) {
      const manifests = await fg(`${pattern}/package.json`, {
        cwd: root,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
      });
      for (const manifest of manifests.sort()) {
        const dir = path.posix.dirname(manifest);
        try {
          const pkg = JSON.parse(await fs.readFile(resolveWithinRoot(root, manifest), "utf8")) as {
            name?: string;
          };
          add(pkg.name?.split("/").pop() ?? path.posix.basename(dir), dir);
        } catch {
          add(path.posix.basename(dir), dir);
        }
      }
    }
  } catch {
    // no workspace file
  }

  for (const base of ["src", "app"]) {
    try {
      const entries = await fs.readdir(resolveWithinRoot(root, base), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith("."))
          add(entry.name, `${base}/${entry.name}`);
      }
    } catch {
      // no source directory
    }
  }
  return areas;
}

export async function loadKnowledgeTree(root: string, knowledgeDir: string): Promise<LoadedTree> {
  const loaded = await loadKnowledgeNodes(root, knowledgeDir);
  const errors: CheckItem[] = [...loaded.errors];
  const templateText: string | null = loaded.template;
  let template: KnowledgeTemplate | null = null;

  if (templateText) {
    const parsed = parseTemplate(templateText);
    template = parsed.template;
    errors.push(
      ...parsed.errors.map((issue) => ({
        code: "TEMPLATE_INVALID" as const,
        severity: "error" as const,
        message: issue.message,
        path: `${knowledgeDir}/template.md`,
      })),
    );
  }

  let aliases: Record<string, string[]> = {};
  try {
    aliases = parseAliases(
      await fs.readFile(resolveWithinRoot(root, `${knowledgeDir}/_aliases.yaml`), "utf8"),
    );
  } catch {
    // aliases are optional
  }

  const guidanceFiles = await fg([`${knowledgeDir}/**/_*.md`], {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**"],
  });
  const guidanceByDir = new Map<string, string[]>();
  for (const file of guidanceFiles.sort()) {
    const dir = path.posix
      .dirname(file)
      .replace(new RegExp(`^${escapeRegExp(knowledgeDir)}/?`), "");
    const list = guidanceByDir.get(dir) ?? [];
    list.push(file);
    guidanceByDir.set(dir, list);
  }

  const areas = await codeAreas(root);
  const areaByName = new Map(areas.map((area) => [area.name.toLowerCase(), area.path]));
  const nodes: KnowledgeNode[] = [];
  const componentNames = new Set<string>();
  const componentCode = new Map<string, string>();

  for (const note of loaded.nodes) {
    if (note.source === "openspec") {
      nodes.push({
        address: note.address ?? note.id,
        id: note.id,
        title: note.title,
        type: note.type,
        status: note.status,
        tags: note.tags,
        updated: note.updated,
        path: note.path,
        component: "",
        layer: null,
        boundary: false,
        code: null,
        source: "openspec",
        linkCount: note.linkCount,
        backlinkCount: note.backlinkCount,
        guidance: [],
        body: note.body,
        links: note.links,
        commits: note.commits,
        frontmatter: note.frontmatter,
      });
      continue;
    }
    const address = note.address ?? note.id;
    const derived = address.includes("/") ? address.slice(0, address.lastIndexOf("/")) : "";
    const component = derived;
    componentNames.add(component);
    const declaredComponent = note.frontmatter.component;
    if (typeof declaredComponent === "string" && declaredComponent !== component) {
      errors.push({
        code: "COMPONENT_MISMATCH",
        severity: "error",
        message: `Node declares component "${declaredComponent}" but sits in "${component}".`,
        path: note.path,
      });
    }
    const layer = note.layer ?? layerFor(template, address);
    errors.push(
      ...layerIssue(template, address, note.layer ?? null).map((issue) => ({
        ...issue,
        path: note.path,
      })),
    );
    if (template && templateConflicts(template, address).length > 1) {
      errors.push({
        code: "TEMPLATE_INVALID",
        severity: "warning",
        message: `Node matches more than one layer glob: ${templateConflicts(template, address).join(", ")}.`,
        path: note.path,
      });
    }
    const code =
      (typeof note.frontmatter.code === "string" ? note.frontmatter.code : null) ??
      areaByName.get(path.posix.basename(component).toLowerCase()) ??
      null;
    if (code) componentCode.set(component, code);
    const inherited: string[] = [];
    for (const dir of parentDirs(component)) {
      inherited.push(...(guidanceByDir.get(dir) ?? []));
    }
    nodes.push({
      address,
      id: note.id,
      title: note.title,
      type: note.type,
      status: note.status,
      tags: note.tags,
      updated: note.updated,
      path: note.path,
      component,
      layer,
      boundary: note.boundary ?? false,
      code,
      source: "reins",
      linkCount: note.linkCount,
      backlinkCount: note.backlinkCount,
      guidance: inherited,
      body: note.body,
      links: note.links,
      commits: note.commits,
      frontmatter: note.frontmatter,
    });
  }

  if (!template && nodes.some((node) => node.source === "reins")) {
    errors.push({
      code: "TEMPLATE_MISSING",
      severity: "error",
      message: `${knowledgeDir}/template.md is required once the tree has nodes.`,
      path: `${knowledgeDir}/template.md`,
    });
  }

  const boundaryByComponent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.boundary) continue;
    const list = boundaryByComponent.get(node.component) ?? [];
    list.push(node.path);
    boundaryByComponent.set(node.component, list);
  }
  for (const [component, paths] of boundaryByComponent) {
    if (paths.length > 1) {
      errors.push({
        code: "COMPONENT_MISMATCH",
        severity: "error",
        message: `Component "${component}" has more than one boundary node: ${paths.join(", ")}.`,
        path: paths[0],
      });
    }
  }

  for (const dir of guidanceByDir.keys()) componentNames.add(dir);

  const components: KnowledgeComponent[] = [];
  for (const component of [...componentNames].sort()) {
    const componentNodes = nodes.filter(
      (node) => node.source === "reins" && node.component === component,
    );
    let coverage: CoverageItem["state"] = componentNodes.length ? "covered" : "orphan";
    const code = componentCode.get(component) ?? null;
    if (!code && component) coverage = "orphan";
    const invalid = errors.some(
      (error) => error.path && componentNodes.some((node) => node.path === error.path),
    );
    if (invalid) coverage = "invalid";
    const order = await readIndexOrder(root, `${knowledgeDir}/${component}`);
    components.push({
      path: component,
      name: component ? path.posix.basename(component) : "(root)",
      layer: componentNodes[0]?.layer ?? null,
      nodeCount: componentNodes.length,
      guidance: guidanceByDir.get(component) ?? [],
      code,
      order,
      coverage,
    });
  }

  const tree: KnowledgeTree = {
    template,
    nodes: nodes.map(
      (node): KnowledgeTreeNode => ({
        address: node.address,
        id: node.id,
        title: node.title,
        type: node.type,
        status: node.status,
        tags: node.tags,
        updated: node.updated,
        path: node.path,
        component: node.component,
        layer: node.layer,
        boundary: node.boundary,
        code: node.code,
        source: node.source,
        linkCount: node.linkCount,
        backlinkCount: node.backlinkCount,
        guidance: node.guidance,
      }),
    ),
    components,
    guidance: [...guidanceByDir.entries()].flatMap(([component, paths]) =>
      paths.map((file) => ({ path: file, component })),
    ),
    errors,
    hash: `${loaded.hash}:${templateText ? templateText.length : 0}`,
  };
  return { tree, nodes, loaded: { ...loaded, errors }, aliases, templateText };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function componentForCodePath(
  tree: KnowledgeTree,
  codePath: string,
): KnowledgeComponent | null {
  const normalized = codePath.replace(/\/$/, "");
  let best: KnowledgeComponent | null = null;
  let bestLength = -1;
  for (const component of tree.components) {
    const code = component.code;
    if (!code) continue;
    if (normalized === code || normalized.startsWith(`${code}/`)) {
      if (code.length > bestLength) {
        best = component;
        bestLength = code.length;
      }
    }
  }
  return best;
}

export function guidanceFor(tree: KnowledgeTree, component: string): string[] {
  const dirs = parentDirs(component);
  return tree.guidance
    .filter((item) => dirs.includes(item.component))
    .sort((left, right) => left.path.length - right.path.length)
    .map((item) => item.path);
}

export async function readGuidanceText(root: string, paths: string[]): Promise<string[]> {
  const texts: string[] = [];
  for (const file of paths) {
    try {
      texts.push(await fs.readFile(resolveWithinRoot(root, file), "utf8"));
    } catch {
      // a removed guidance file is not fatal for a context pack
    }
  }
  return texts;
}
