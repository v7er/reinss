import type { KnowledgeNode } from "./tree.js";
import type { GraphRevision, HarnessPack, PackRequest, Surface, SymbolHit } from "./types.js";

export interface HarnessInput {
  repoName: string;
  revision: GraphRevision;
  knowledgeHash: string;
  request: PackRequest;
  surfaces: Surface[];
  symbols: SymbolHit[];
  nodes: KnowledgeNode[];
  commands: string[];
  excluded: string[];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function composeHarnessPack(input: HarnessInput): HarnessPack {
  const maxTokens = Math.min(Math.max(input.request.maxTokens ?? 4000, 1000), 12000);
  const sections: Array<{ name: string; body: string }> = [];

  sections.push({
    name: "Header",
    body: [
      "# Reins harness pack",
      "",
      `repo: ${input.repoName} @ ${input.revision.gitHead ?? "no-git"} (in sync: ${input.revision.inSync ? "yes" : "no"})`,
      `graph: fingerprint ${input.revision.fingerprint.slice(0, 12)}, Trail ${input.revision.trailVersion}`,
      `intent: ${input.request.intent.replace(/\s+/g, " ").slice(0, 500)}`,
    ].join("\n"),
  });

  if (input.request.includeSurfaces !== false && input.surfaces.length > 0) {
    sections.push({
      name: "Surfaces",
      body: [
        "## Surfaces",
        ...input.surfaces
          .slice(0, 20)
          .map((s) => `- ${s.id}  ${s.file}:${s.line}${s.symbolId ? `  (${s.symbolId})` : ""}`),
      ].join("\n"),
    });
  }

  if (input.symbols.length > 0) {
    sections.push({
      name: "Symbols",
      body: [
        "## Symbols",
        ...input.symbols
          .slice(0, 30)
          .map(
            (s) =>
              `- ${s.id ?? s.path}  ${s.path}${s.startLine ? `:${s.startLine}` : ""}  ${s.name}`,
          ),
      ].join("\n"),
    });
  }

  const constraints = input.nodes.filter((n) => n.type === "constraint" && n.status === "accepted");
  if (constraints.length > 0) {
    sections.push({
      name: "Constraints",
      body: [
        "## Constraints",
        ...constraints.slice(0, 20).map((n) => `- ${n.id} (${n.status}): ${n.title}`),
      ].join("\n"),
    });
  }

  const decisions = input.nodes.filter((n) => n.type === "decision" && n.status === "accepted");
  if (decisions.length > 0) {
    sections.push({
      name: "Decisions",
      body: [
        "## Decisions",
        ...decisions.slice(0, 20).map((n) => `- ${n.id} (${n.status}): ${n.title}`),
      ].join("\n"),
    });
  }

  const questions = input.nodes.filter((n) => n.type === "question" && n.status !== "rejected");
  if (questions.length > 0) {
    sections.push({
      name: "Open questions",
      body: [
        "## Open questions",
        ...questions.slice(0, 10).map((n) => `- ${n.id}: ${n.title}`),
      ].join("\n"),
    });
  }

  if (input.commands.length > 0) {
    sections.push({
      name: "Commands",
      body: ["## Commands", ...input.commands.map((c) => `- ${c}`)].join("\n"),
    });
  }

  sections.push({
    name: "Excluded",
    body: [
      "## Excluded",
      ...(input.excluded.length > 0 ? input.excluded.map((e) => `- ${e}`) : ["- none"]),
    ].join("\n"),
  });

  const kept: typeof sections = [];
  let truncated = false;
  for (const section of sections) {
    const candidate = [...kept, section].map((s) => s.body).join("\n\n");
    if (estimateTokens(candidate) > maxTokens && kept.length > 0) {
      truncated = true;
      continue;
    }
    kept.push(section);
  }

  const markdown = kept.map((s) => s.body).join("\n\n");
  return {
    contractVersion: 1,
    markdown,
    tokenEstimate: estimateTokens(markdown),
    truncated,
    sections: kept.map((s) => ({ name: s.name, bytes: new TextEncoder().encode(s.body).length })),
    revision: { ...input.revision, knowledgeHash: input.knowledgeHash },
  };
}
