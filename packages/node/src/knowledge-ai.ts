import { promises as fs } from "node:fs";
import {
  type KnowledgeAiDraft,
  type KnowledgeBootstrapPlan,
  layerFor,
  type NodeType,
  nodeSlugFromTitle,
  ReinsError,
} from "@reinss/core";
import fg from "fast-glob";
import matter from "gray-matter";
import { loadKnowledgeTree } from "./knowledge-tree.js";
import { resolveWithinRoot, writeAtomic } from "./paths.js";

const MAX_PROMPT_CHARS = 24_000;
const MAX_SPEC_CHARS = 1_500;
const MAX_DRAFTS = 30;

const TYPES: NodeType[] = ["spec", "decision", "constraint", "howto", "question"];

export interface AiProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AiInitResult {
  enabled: boolean;
  model: string;
  prompt: string;
  promptChars: number;
  drafts: KnowledgeAiDraft[];
  written: string[];
  skipped: string[];
}

async function specContext(root: string): Promise<string[]> {
  const files = await fg(
    [
      "openspec/specs/**/spec.md",
      "openspec/changes/**/proposal.md",
      "openspec/changes/**/design.md",
      "README.md",
    ],
    { cwd: root, onlyFiles: true, ignore: ["**/node_modules/**"] },
  );
  const out: string[] = [];
  let used = 0;
  for (const file of files.sort().slice(0, 16)) {
    try {
      const text = await fs.readFile(resolveWithinRoot(root, file), "utf8");
      const slice = text.slice(0, MAX_SPEC_CHARS).trim();
      if (!slice) continue;
      const block = `### ${file}\n${slice}`;
      if (used + block.length > 12_000) break;
      used += block.length;
      out.push(block);
    } catch {
      // skip unreadable context
    }
  }
  return out;
}

export async function buildKnowledgePrompt(
  root: string,
  plan: KnowledgeBootstrapPlan,
  templateRaw: string,
): Promise<{ prompt: string; promptChars: number }> {
  const components = plan.components
    .slice(0, 40)
    .map(
      (component) =>
        `- ${component.component} | code: ${component.code} | files: ${component.files}${
          component.entry ? ` | entry: ${component.entry}` : ""
        }`,
    );
  const specs = await specContext(root);
  const prompt = `You write project knowledge for a repository. Return ONLY a JSON array, no prose.

Each item:
{"component":"components/<slug>","title":"1 to 120 chars","type":"spec|decision|constraint|howto|question","body":"markdown, 1 to 3 short paragraphs","tags":["lowercase"]}

Rules:
- Write for a new engineer. State what the component owns, what it refuses to own, and the rule that follows.
- Use only the evidence below. If evidence is thin, write a short spec with a TODO, do not invent business facts.
- Prefer type "spec" for ownership and contracts, "decision" only when an alternative is visible.
- Max ${MAX_DRAFTS} items total. No duplicate component and title.
- Body must not exceed 2000 characters. No code fences. No frontmatter.

Template (structure only, do not copy):
${templateRaw.slice(0, 2_000)}

Components:
${components.join("\n")}

Context:
${specs.join("\n\n")}
`;
  return { prompt: prompt.slice(0, MAX_PROMPT_CHARS), promptChars: prompt.length };
}

export function parseAiDrafts(
  text: string,
  allowedComponents: Set<string>,
  maxDrafts = MAX_DRAFTS,
): KnowledgeAiDraft[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new ReinsError("LLM_FAILED", "The model did not return a JSON array.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new ReinsError("LLM_FAILED", "The model returned invalid JSON.", { cause: err });
  }
  if (!Array.isArray(raw)) throw new ReinsError("LLM_FAILED", "The model returned no array.");
  const seen = new Set<string>();
  const drafts: KnowledgeAiDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const component = typeof record.component === "string" ? record.component : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const type = typeof record.type === "string" ? record.type : "";
    const body = typeof record.body === "string" ? record.body.trim() : "";
    if (!allowedComponents.has(component)) continue;
    if (title.length < 3 || title.length > 120) continue;
    if (!TYPES.includes(type as NodeType)) continue;
    if (body.length < 20 || body.length > 4_000) continue;
    const key = `${component}:${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = Array.isArray(record.tags)
      ? record.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.toLowerCase().slice(0, 32))
          .slice(0, 8)
      : [];
    drafts.push({ component, title, type: type as NodeType, body, tags });
    if (drafts.length >= maxDrafts) break;
  }
  return drafts;
}

export async function requestAiDrafts(prompt: string, config: AiProviderConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 3_000,
        messages: [
          {
            role: "system",
            content: "You write concise project knowledge. Return only a JSON array.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new ReinsError(
        "LLM_FAILED",
        `The model request failed (${response.status}): ${detail}`,
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ReinsError("LLM_FAILED", "The model returned an empty response.");
    return content;
  } catch (err) {
    if (err instanceof ReinsError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ReinsError("LLM_FAILED", "The model request timed out after 60 seconds.");
    }
    throw new ReinsError("LLM_FAILED", `The model request failed: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function applyAiDrafts(
  root: string,
  knowledgeDir: string,
  drafts: KnowledgeAiDraft[],
  model: string,
): Promise<{ written: string[]; skipped: string[] }> {
  const tree = await loadKnowledgeTree(root, knowledgeDir);
  if (!tree.tree.template) {
    throw new ReinsError("TEMPLATE_MISSING", `${knowledgeDir}/template.md is required.`);
  }
  const written: string[] = [];
  const skipped: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const draft of drafts) {
    const address = `${draft.component}/${nodeSlugFromTitle(draft.title)}`;
    if (tree.nodes.some((node) => node.address === address)) {
      skipped.push(`${address} (exists)`);
      continue;
    }
    const layer = layerFor(tree.tree.template, address);
    if (!layer) {
      skipped.push(`${address} (no layer)`);
      continue;
    }
    const file = `${knowledgeDir}/${address}.md`;
    const text = matter.stringify(`\n${draft.body}\n`, {
      title: draft.title,
      type: draft.type,
      status: "proposed",
      created: today,
      updated: today,
      tags: draft.tags,
      links: [],
      component: draft.component,
      layer,
      provenance: { kind: "agent", agent: "knowledge-init", model },
    });
    await writeAtomic(root, file, text);
    written.push(file);
  }
  return { written, skipped };
}

export function aiPlanComponents(plan: KnowledgeBootstrapPlan): Set<string> {
  return new Set(plan.components.map((component) => component.component));
}
