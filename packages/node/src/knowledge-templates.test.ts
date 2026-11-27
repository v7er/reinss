import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { parseTemplate } from "@reinss/core";
import { describe, expect, it } from "vitest";
import {
  applyAiDrafts,
  buildKnowledgePrompt,
  parseAiDrafts,
  requestAiDrafts,
} from "./knowledge-ai.js";
import { applyKnowledgeTemplate, knowledgeTemplatePresets } from "./knowledge-templates.js";
import { loadKnowledgeTree } from "./knowledge-tree.js";

function preset(id: string) {
  const found = knowledgeTemplatePresets.find((item) => item.id === id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
}

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-templates-"));
  await fs.mkdir(path.join(root, ".reins/knowledge"), { recursive: true });
  return root;
}

describe("knowledge templates", () => {
  it("every preset parses and declares an inbox layer", () => {
    for (const preset of knowledgeTemplatePresets) {
      const { template, errors } = parseTemplate(preset.template);
      expect(errors, preset.id).toEqual([]);
      expect(
        template?.layers.some((layer) => layer.name === "inbox"),
        preset.id,
      ).toBe(true);
      expect(
        template?.layers.some((layer) => layer.glob.startsWith("components/")),
        preset.id,
      ).toBe(true);
      expect(template?.requiredFields).toContain("title");
    }
    expect(new Set(knowledgeTemplatePresets.map((preset) => preset.id)).size).toBe(
      knowledgeTemplatePresets.length,
    );
  });

  it("applies a template once and keeps an existing one", async () => {
    const root = await tempRepo();
    const first = await applyKnowledgeTemplate(root, ".reins/knowledge", preset("c4"));
    expect(first.kept).toBe(false);
    expect(first.created).toContain(".reins/knowledge/template.md");
    const second = await applyKnowledgeTemplate(root, ".reins/knowledge", preset("minimal"));
    expect(second.kept).toBe(true);
    const tree = await loadKnowledgeTree(root, ".reins/knowledge");
    expect(tree.tree.template?.layers.some((layer) => layer.name === "context")).toBe(true);
  });
});

describe("AI drafts", () => {
  const allowed = new Set(["components/billing", "components/checkout"]);

  it("parses fenced JSON and drops invalid items", () => {
    const drafts = parseAiDrafts(
      '```json\n[{"component":"components/billing","title":"Billing owns charges","type":"spec","body":"Billing owns charges and refunds. It does not own payouts.","tags":["Billing"]},{"component":"components/unknown","title":"Nope","type":"spec","body":"This should be dropped because the component is not planned at all."},{"component":"components/billing","title":"X","type":"spec","body":"short"}]\n```',
      allowed,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.title).toBe("Billing owns charges");
    expect(drafts[0]?.tags).toEqual(["billing"]);
  });

  it("rejects a response without an array", () => {
    expect(() => parseAiDrafts("no json here", allowed)).toThrow(/JSON array/);
  });

  it("builds a prompt with components and request context", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, "openspec/specs/billing"), { recursive: true });
    await fs.writeFile(
      path.join(root, "openspec/specs/billing/spec.md"),
      "# Billing\n\nRefunds write to the ledger first.\n",
    );
    const plan = {
      template: true,
      components: [
        {
          component: "components/billing",
          code: "src/billing",
          title: "billing",
          node: ".reins/knowledge/components/billing/billing.md",
          files: 3,
          entry: "src/billing/index.ts",
        },
      ],
      skipped: [],
      truncated: false,
      cap: 50,
    };
    const { prompt } = await buildKnowledgePrompt(
      root,
      plan,
      "## Layers\n\n| component | components/** |\n",
    );
    expect(prompt).toContain("components/billing");
    expect(prompt).toContain("ledger first");
    expect(prompt).toContain("Return ONLY a JSON array");
  });

  it("writes proposed nodes and skips duplicates", async () => {
    const root = await tempRepo();
    await applyKnowledgeTemplate(root, ".reins/knowledge", preset("minimal"));
    const drafts = [
      {
        component: "components/billing",
        title: "Billing owns charges",
        type: "spec" as const,
        body: "Billing owns charges and refunds. It does not own payouts.",
        tags: [],
      },
    ];
    const first = await applyAiDrafts(root, ".reins/knowledge", drafts, "test-model");
    expect(first.written).toHaveLength(1);
    const second = await applyAiDrafts(root, ".reins/knowledge", drafts, "test-model");
    expect(second.written).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    const tree = await loadKnowledgeTree(root, ".reins/knowledge");
    expect(tree.nodes[0]?.status).toBe("proposed");
  });
});

describe("AI transport", () => {
  it("posts the prompt and returns the message content", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { model: string; messages: Array<{ content: string }> };
        expect(parsed.model).toBe("test-model");
        expect(parsed.messages[1]?.content).toContain("billing");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const content = await requestAiDrafts("billing context", {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "test-model",
        apiKey: "test-key",
      });
      expect(content).toBe("[]");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
