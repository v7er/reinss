import { promises as fs } from "node:fs";
import {
  type KnowledgeBootstrapComponent,
  type KnowledgeBootstrapPlan,
  type KnowledgeBootstrapResult,
  type KnowledgeTemplate,
  knowledgeAddress,
  ReinsError,
} from "@reinss/core";
import fg from "fast-glob";
import matter from "gray-matter";
import { codeAreas } from "./knowledge-tree.js";
import { resolveWithinRoot, writeAtomic } from "./paths.js";
import type { TrailAdapter } from "./trail.js";

const SKIP_AREAS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "legacy",
  "test",
  "tests",
  "fixtures",
  "e2e",
  "docs",
  "bin",
  "scripts",
  "assets",
  "public",
]);

const SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs}";
const DEFAULT_CAP = 50;

export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/^@[^/]+\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "component"
  );
}

export function defaultKnowledgeTemplate(): string {
  return `# Knowledge template

Knowledge lives next to the code. One markdown node per intent. A directory is a component or boundary.

## Layers

| Layer | Glob | Purpose |
| --- | --- | --- |
| product | \`product/**\` | Product intent, requirements, decisions that cross components |
| component | \`components/**\` | One directory per code component, boundary node first |
| delivery | \`workflows/**\` | How work is done, reviews, releases |

## Required fields

title, type, status, created, updated

## Naming

- Node files: lowercase kebab case, 2 to 64 characters.
- Components: match the code directory they cover.
- Guidance files start with \`_\` and never appear as nodes.

## Rules

1. A component node states the contract, not the implementation.
2. A decision names what was ruled out and why.
3. Link the code you mean. A link that cannot resolve is a defect.
`;
}

export function parseTemplateLayers(template: KnowledgeTemplate | null): KnowledgeTemplate | null {
  return template;
}

async function countSources(root: string, codePath: string): Promise<number> {
  const files = await fg(`${codePath}/${SOURCE_GLOB}`, {
    cwd: root,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.d.ts", "**/*.test.*", "**/*.spec.*"],
  });
  return files.length;
}

export async function planKnowledgeBootstrap(
  root: string,
  knowledgeDir: string,
  trail: TrailAdapter,
  maxComponents = DEFAULT_CAP,
): Promise<{ plan: KnowledgeBootstrapPlan; template: KnowledgeTemplate | null }> {
  try {
    const status = await trail.status();
    if (status.nodes === 0) throw new Error("no nodes");
  } catch {
    throw new ReinsError(
      "GRAPH_MISSING",
      "A Trail graph is required. Run `trail build` before a knowledge bootstrap.",
    );
  }

  const cap = Math.min(Math.max(maxComponents, 1), 200);
  const areas = await codeAreas(root);
  const plan: KnowledgeBootstrapPlan = {
    template: true,
    components: [],
    skipped: [],
    truncated: false,
    cap,
  };

  const usedSlugs = new Set<string>();
  for (const area of areas.sort((left, right) => left.path.localeCompare(right.path))) {
    const base = area.name;
    if (SKIP_AREAS.has(base) || base.startsWith(".")) {
      plan.skipped.push({ path: area.path, reason: "generated, vendored, or not product code" });
      continue;
    }
    const count = await countSources(root, area.path);
    if (count < 2) {
      plan.skipped.push({ path: area.path, reason: `only ${count} source files` });
      continue;
    }
    if (plan.components.length >= cap) {
      plan.truncated = true;
      continue;
    }
    let component = slug(base);
    let suffix = 2;
    while (usedSlugs.has(component)) {
      component = `${slug(base)}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(component);
    const node = `${component}.md`;
    plan.components.push({
      component: `components/${component}`,
      code: area.path,
      title: base.replace(/[-_]/g, " "),
      node: `${knowledgeDir}/components/${component}/${node}`,
      files: count,
      entry: await firstEntry(root, area.path),
    });
  }

  return { plan, template: null };
}

async function firstEntry(root: string, codePath: string): Promise<string | null> {
  for (const candidate of ["src/index.ts", "index.ts", "src/main.ts", "main.ts", "src/app.tsx"]) {
    try {
      await fs.access(resolveWithinRoot(root, `${codePath}/${candidate}`));
      return `${codePath}/${candidate}`;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function applyKnowledgeBootstrap(
  root: string,
  knowledgeDir: string,
  plan: KnowledgeBootstrapPlan,
  existingTemplate: string | null,
): Promise<KnowledgeBootstrapResult> {
  if (plan.truncated) {
    throw new ReinsError(
      "KNOWLEDGE_LIMIT",
      `Bootstrap would create more than ${plan.cap} components. Raise --max-components.`,
    );
  }
  const written: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (!existingTemplate) {
    const templatePath = `${knowledgeDir}/template.md`;
    await writeAtomic(root, templatePath, defaultKnowledgeTemplate());
    written.push(templatePath);
  }
  for (const component of plan.components) {
    const dir = `${knowledgeDir}/${component.component.replace(/^components\//, "components/")}`;
    const rulesPath = `${dir}/_rules.md`;
    await writeAtomic(
      root,
      rulesPath,
      `# ${component.title} rules\n\nTODO: state the boundary, the forbidden imports, and what this component owns.\n`,
    );
    written.push(rulesPath);
    const body = `# ${component.title}\n\nObserved from the repository:\n\n- Code: \`${component.code}\`\n- Source files: ${component.files}\n${component.entry ? `- Entry: \`${component.entry}\`\n` : ""}\nTODO: state what this component owns and what it does not.\n`;
    const text = matter.stringify(`\n${body}`, {
      title: component.title,
      type: "spec",
      status: "proposed",
      created: today,
      updated: today,
      tags: [],
      component: component.component,
      layer: "component",
      code: component.code,
    });
    await writeAtomic(root, component.node, text);
    written.push(component.node);
  }
  return { ...plan, written };
}

export function bootstrapAddress(plan: KnowledgeBootstrapPlan): string[] {
  return plan.components.map((component) => knowledgeAddress(component.node, ".reins/knowledge"));
}

export type { KnowledgeBootstrapComponent };
