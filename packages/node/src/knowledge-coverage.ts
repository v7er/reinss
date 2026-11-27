import { promises as fs } from "node:fs";
import type { CoverageItem, CoverageState, KnowledgeNode, KnowledgeTree } from "@reinss/core";
import fg from "fast-glob";
import { codeAreas } from "./knowledge-tree.js";
import { resolveWithinRoot } from "./paths.js";

const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs"];

export async function knowledgeCoverage(
  root: string,
  tree: KnowledgeTree,
  nodes: KnowledgeNode[],
): Promise<CoverageItem[]> {
  const items: CoverageItem[] = [];
  const areas = await codeAreas(root);
  const claimed = new Set(tree.components.map((component) => component.code).filter(Boolean));

  for (const component of tree.components) {
    if (component.path === "" || component.path === "inbox") continue;
    if (component.coverage === "covered") continue;
    items.push({
      component: component.path,
      state: component.coverage,
      message:
        component.coverage === "invalid"
          ? `Component "${component.path}" has an invalid node.`
          : `Component "${component.path}" has no matching code directory.`,
      fix:
        component.coverage === "invalid"
          ? "Fix the node errors reported by check."
          : "Add component.code or move the node.",
      ...(component.path ? { path: `${component.path}/` } : {}),
    });
  }

  for (const node of nodes) {
    if (node.source !== "reins") continue;
    const updated = node.updated;
    for (const link of node.links) {
      const file = "file" in link ? link.file : "symbol" in link ? link.symbol.split("#")[0] : null;
      if (!file) continue;
      try {
        const stat = await fs.stat(resolveWithinRoot(root, file));
        const changed = stat.mtime.toISOString().slice(0, 10);
        if (changed > updated) {
          items.push({
            component: node.component,
            state: "stale",
            message: `"${node.title}" links ${file}, changed after the node update.`,
            fix: `Review ${file} and update the node.`,
            path: node.path,
            address: node.address,
          });
        }
      } catch {
        // missing files are reported by check as LINK_BROKEN
      }
    }
  }

  for (const area of areas) {
    if (claimed.has(area.path)) continue;
    const files = await fg(`${area.path}/**/*.{${CODE_EXTENSIONS.join(",")}}`, {
      cwd: root,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/test/**", "**/*.test.*"],
    });
    if (files.length < 3) continue;
    items.push({
      component: `components/${area.name}`,
      state: "unmapped",
      message: `Code area ${area.path} has ${files.length} source files and no component node.`,
      fix: `Run reinss knowledge init --from-code and accept ${completable(area.name)}.`,
      path: area.path,
    });
  }

  const severity: Record<CoverageState, number> = {
    invalid: 0,
    stale: 1,
    orphan: 2,
    unmapped: 3,
    covered: 4,
  };
  return items.sort(
    (left, right) =>
      severity[left.state] - severity[right.state] || left.component.localeCompare(right.component),
  );
}

function completable(name: string): string {
  return `components/${name}`;
}
