import { promises as fs } from "node:fs";
import { ReinsError } from "@reinss/core";
import { resolveWithinRoot, writeAtomic } from "./paths.js";

export interface KnowledgeTemplatePreset {
  id: string;
  name: string;
  description: string;
  template: string;
  directories: string[];
}

const REQUIRED = "title, type, status, created, updated";

function doc(input: {
  title: string;
  intro: string;
  layers: Array<[string, string, string]>;
  rules: string[];
  extra?: string;
}): string {
  const rows = input.layers.map(
    ([name, glob, purpose]) => `| ${name} | \`${glob}\` | ${purpose} |`,
  );
  return `# ${input.title}

${input.intro}

## Layers

| Layer | Glob | Purpose |
| --- | --- | --- |
${rows.join("\n")}

## Required fields

${REQUIRED}

## Naming

- Node files: lowercase kebab case, 2 to 64 characters.
- Components: match the code directory they cover; set \`code\` in frontmatter when the names differ.
- Guidance files start with \`_\` and never appear as nodes.

## Rules

${input.rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}
${input.extra ? `\n${input.extra}\n` : ""}`;
}

export const knowledgeTemplatePresets: KnowledgeTemplatePreset[] = [
  {
    id: "default",
    name: "Default",
    description: "Product intent, one directory per code component, delivery workflows.",
    template: doc({
      title: "Knowledge template",
      intro:
        "Knowledge lives next to the code. One markdown node per intent. The directory that contains a node is its component or boundary.",
      layers: [
        ["product", "product/**", "Product intent and requirements"],
        ["component", "components/**", "One directory per code component, boundary node first"],
        ["delivery", "workflows/**", "How work is done, reviews, releases"],
        ["inbox", "inbox/**", "Proposals waiting for a human decision"],
      ],
      rules: [
        "A component node states the contract, not the implementation.",
        "A decision names what was ruled out and why.",
        "Link the code you mean. A link that cannot resolve is a defect.",
        "An agent proposes; a human accepts.",
      ],
    }),
    directories: ["product", "components", "workflows", "inbox"],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Components and an inbox. Nothing else to learn.",
    template: doc({
      title: "Knowledge template",
      intro: "One directory per component. Keep each node short and link the code it owns.",
      layers: [
        ["component", "components/**", "One directory per code component"],
        ["inbox", "inbox/**", "Proposals waiting for a human decision"],
      ],
      rules: [
        "A component node states what the component owns and what it does not.",
        "If a decision is not stable, keep it as a question.",
      ],
    }),
    directories: ["components", "inbox"],
  },
  {
    id: "c4",
    name: "C4 architecture",
    description: "C4 levels for architecture, plus code-ownership components.",
    template: doc({
      title: "Knowledge template: C4",
      intro:
        "Architecture is described at four C4 levels, and code ownership stays under components. Each C4 node names the level in its title, for example `Container: billing service`.",
      layers: [
        ["context", "architecture/context/**", "Level 1: the system, its users, and other systems"],
        ["container", "architecture/containers/**", "Level 2: deployable units and data stores"],
        ["component", "architecture/components/**", "Level 3: components inside a container"],
        ["code", "architecture/code/**", "Level 4: classes and modules that matter"],
        ["ownership", "components/**", "One directory per code component the team owns"],
        ["inbox", "inbox/**", "Proposals waiting for a human decision"],
      ],
      rules: [
        "Do not skip a level. A container node links to its context node.",
        "A code node exists only when the detail changes a decision; the code is the code.",
        "A component node states the contract, not the implementation.",
        "Prefer a decision that names the alternative it ruled out.",
      ],
      extra:
        "## C4 links\n\nUse `rel: depends_on` between levels and `rel: implements` from a C4 node to the ownership node.",
    }),
    directories: [
      "architecture/context",
      "architecture/containers",
      "architecture/components",
      "architecture/code",
      "components",
      "inbox",
    ],
  },
  {
    id: "domain",
    name: "Domain and bounded contexts",
    description: "Bounded contexts, aggregates, and the decisions that shape them.",
    template: doc({
      title: "Knowledge template: domain",
      intro:
        "One directory per bounded context. A context node names its language, its invariants, and what it refuses to own.",
      layers: [
        ["product", "product/**", "Product intent that crosses contexts"],
        ["context", "contexts/**", "One directory per bounded context and its nodes"],
        ["component", "components/**", "Code ownership when it differs from a context"],
        ["inbox", "inbox/**", "Proposals waiting for a human decision"],
      ],
      rules: [
        "A context node states the ubiquitous language and the invariants.",
        "A cross-context decision belongs in product, not in one context.",
        "Name the event or contract at every context boundary.",
      ],
    }),
    directories: ["product", "contexts", "components", "inbox"],
  },
];

export function getKnowledgeTemplatePreset(id: string): KnowledgeTemplatePreset {
  const preset = knowledgeTemplatePresets.find((item) => item.id === id);
  if (!preset) {
    throw new ReinsError(
      "INVALID_INPUT",
      `Unknown template "${id}". Known templates: ${knowledgeTemplatePresets.map((item) => item.id).join(", ")}.`,
    );
  }
  return preset;
}

export async function applyKnowledgeTemplate(
  root: string,
  knowledgeDir: string,
  preset: KnowledgeTemplatePreset,
): Promise<{ created: string[]; kept: boolean }> {
  const created: string[] = [];
  const templatePath = `${knowledgeDir}/template.md`;
  let kept = false;
  try {
    await fs.access(resolveWithinRoot(root, templatePath));
    kept = true;
  } catch {
    await writeAtomic(root, templatePath, preset.template);
    created.push(templatePath);
  }
  for (const directory of preset.directories) {
    const relative = `${knowledgeDir}/${directory}`;
    try {
      await fs.access(resolveWithinRoot(root, relative));
    } catch {
      await fs.mkdir(resolveWithinRoot(root, relative), { recursive: true });
      created.push(relative);
    }
  }
  return { created, kept };
}
