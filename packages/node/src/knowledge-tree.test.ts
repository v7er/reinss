import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planKnowledgeBootstrap } from "./knowledge-bootstrap.js";
import { addKnowledgeComment, knowledgeComments } from "./knowledge-comments.js";
import { knowledgeCoverage } from "./knowledge-coverage.js";
import {
  acceptKnowledgeNode,
  knowledgeContext,
  queryKnowledge,
  saveKnowledgeNode,
} from "./knowledge-index.js";
import { planKnowledgeMigration } from "./knowledge-migrate.js";
import { loadKnowledgeTree } from "./knowledge-tree.js";
import { TrailAdapter } from "./trail.js";

const TEMPLATE = `# Template

## Layers

| Layer | Glob | Purpose |
| --- | --- | --- |
| product | \`product/**\` | Product |
| component | \`components/**\` | Components |

## Required fields

title, type, status, created, updated

## Rules

1. State the contract.
`;

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-tree-"));
  await fs.mkdir(path.join(root, ".reins/knowledge/components/billing"), { recursive: true });
  await fs.writeFile(path.join(root, ".reins/knowledge/template.md"), TEMPLATE);
  return root;
}

async function write(root: string, file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text);
}

function note(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

describe("loadKnowledgeTree", () => {
  it("derives addresses, components, layers, and inherited guidance", async () => {
    const root = await tempRepo();
    await write(
      root,
      ".reins/knowledge/_rules.md",
      "# Tree rules\n\nEvery node names its owner.\n",
    );
    await write(root, ".reins/knowledge/components/billing/_rules.md", "No direct ledger writes.");
    await write(
      root,
      ".reins/knowledge/components/billing/refunds.md",
      note(
        {
          title: "Refunds",
          type: "spec",
          status: "accepted",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        "Refunds write to the ledger first.",
      ),
    );
    const tree = await loadKnowledgeTree(root, ".reins/knowledge");
    const node = tree.nodes.find((item) => item.address === "components/billing/refunds");
    expect(node?.component).toBe("components/billing");
    expect(node?.layer).toBe("component");
    expect(node?.guidance).toEqual([
      ".reins/knowledge/_rules.md",
      ".reins/knowledge/components/billing/_rules.md",
    ]);
    expect(tree.tree.components.find((item) => item.path === "components/billing")?.nodeCount).toBe(
      1,
    );
  });

  it("reports a missing template", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-tree-"));
    await write(
      root,
      ".reins/knowledge/specs/refunds.md",
      note(
        {
          title: "Refunds",
          type: "spec",
          status: "accepted",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        "Body.",
      ),
    );
    const tree = await loadKnowledgeTree(root, ".reins/knowledge");
    expect(tree.tree.template).toBeNull();
    expect(tree.tree.errors.some((error) => error.code === "TEMPLATE_MISSING")).toBe(true);
  });

  it("adds OpenSpec files as virtual nodes", async () => {
    const root = await tempRepo();
    await write(root, "openspec/specs/refunds/spec.md", "# Refunds\n\nLedger first.\n");
    const tree = await loadKnowledgeTree(root, ".reins/knowledge");
    const virtual = tree.nodes.find((node) => node.source === "openspec");
    expect(virtual?.address).toBe("openspec/specs/refunds/spec");
  });
});

describe("saveKnowledgeNode", () => {
  it("writes a validated node and rejects an undeclared layer", async () => {
    const root = await tempRepo();
    const saved = await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/billing/refunds",
      title: "Refunds",
      type: "spec",
      body: "Refunds write to the ledger first.",
    });
    expect(saved.path).toBe(".reins/knowledge/components/billing/refunds.md");
    const text = await fs.readFile(path.join(root, saved.path), "utf8");
    expect(text).toContain("component: components/billing");
    await expect(
      saveKnowledgeNode(root, ".reins/knowledge", {
        address: "other/refunds",
        title: "Refunds",
        type: "spec",
        body: "Body.",
        layer: "unknown",
      }),
    ).rejects.toThrow(/layer|Layer/);
  });

  it("refuses a second boundary node", async () => {
    const root = await tempRepo();
    await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/billing/boundary",
      title: "Billing boundary",
      type: "spec",
      body: "Billing owns charges.",
      boundary: true,
    });
    await expect(
      saveKnowledgeNode(root, ".reins/knowledge", {
        address: "components/billing/other",
        title: "Other",
        type: "spec",
        body: "Body.",
        boundary: true,
      }),
    ).rejects.toThrow(/boundary/);
  });
});

describe("acceptKnowledgeNode", () => {
  it("moves an inbox proposal into a component and sets accepted", async () => {
    const root = await tempRepo();
    await write(
      root,
      ".reins/knowledge/inbox/refunds.md",
      note(
        {
          title: "Refunds",
          type: "spec",
          status: "proposed",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        "Refunds write to the ledger first.",
      ),
    );
    const result = await acceptKnowledgeNode(root, ".reins/knowledge", {
      address: "inbox/refunds",
      component: "components/billing",
    });
    expect(result.path).toBe(".reins/knowledge/components/billing/refunds.md");
    const text = await fs.readFile(path.join(root, result.path), "utf8");
    expect(text).toContain("status: accepted");
    await expect(fs.access(path.join(root, ".reins/knowledge/inbox/refunds.md"))).rejects.toThrow();
  });
});

describe("queryKnowledge", () => {
  it("ranks and returns excerpts, and rebuilds a deleted cache", async () => {
    const root = await tempRepo();
    await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/billing/refunds",
      title: "Refund policy",
      type: "spec",
      body: "Refunds write to the ledger first.",
    });
    const first = await queryKnowledge(root, ".reins/knowledge", { query: "ledger refund" });
    expect(first.items[0]?.address).toBe("components/billing/refunds");
    expect(first.items[0]?.excerpt).toContain("ledger");
    await fs.rm(path.join(root, ".reins/.cache/knowledge-index.json"));
    const second = await queryKnowledge(root, ".reins/knowledge", { query: "ledger refund" });
    expect(second.items[0]?.address).toBe(first.items[0]?.address);
  });
});

describe("knowledgeContext", () => {
  it("packs the owning node and local rules", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, "src/billing"), { recursive: true });
    await fs.writeFile(path.join(root, "src/billing/charge.ts"), "export const charge = 1;\n");
    await write(root, ".reins/knowledge/components/billing/_rules.md", "No direct ledger writes.");
    await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/billing/billing",
      title: "Billing",
      type: "spec",
      body: "Billing owns charges.",
      boundary: true,
    });
    const pack = await knowledgeContext(root, ".reins/knowledge", "src/billing");
    expect(pack.unmapped).toBe(false);
    expect(pack.component).toBe("components/billing");
    expect(pack.items.some((item) => item.kind === "guidance")).toBe(true);
    expect(pack.estimatedTokens).toBeLessThan(4000);
  });

  it("reports an unmapped path", async () => {
    const root = await tempRepo();
    const pack = await knowledgeContext(root, ".reins/knowledge", "src/nothing");
    expect(pack.unmapped).toBe(true);
  });
});

describe("coverage", () => {
  it("marks an orphan component and an unmapped code area", async () => {
    const root = await tempRepo();
    await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/ghost/ghost",
      title: "Ghost",
      type: "spec",
      body: "No code yet.",
    });
    for (const index of [1, 2, 3]) {
      await write(root, `src/ledger/file${index}.ts`, "export const value = 1;\n");
    }
    const loaded = await loadKnowledgeTree(root, ".reins/knowledge");
    const items = await knowledgeCoverage(root, loaded.tree, loaded.nodes);
    expect(
      items.some((item) => item.state === "orphan" && item.component === "components/ghost"),
    ).toBe(true);
    expect(
      items.some((item) => item.state === "unmapped" && item.message.includes("src/ledger")),
    ).toBe(true);
  });
});

describe("bootstrap and migration", () => {
  it("requires a Trail graph", async () => {
    const root = await tempRepo();
    await expect(
      planKnowledgeBootstrap(root, ".reins/knowledge", new TrailAdapter(root)),
    ).rejects.toThrow(/Trail graph/);
  });

  it("plans legacy folder moves and leaves unmapped paths unresolved", async () => {
    const root = await tempRepo();
    await write(
      root,
      ".reins/knowledge/specs/refunds.md",
      note(
        {
          title: "Refunds",
          type: "spec",
          status: "accepted",
          created: "2026-01-01",
          updated: "2026-01-01",
        },
        "Body.",
      ),
    );
    const unresolved = await planKnowledgeMigration(root, ".reins/knowledge");
    expect(unresolved.unresolved).toEqual([".reins/knowledge/specs/refunds.md"]);
    const plan = await planKnowledgeMigration(root, ".reins/knowledge", {
      specs: "components/billing",
    });
    expect(plan.moves[0]?.to).toBe(".reins/knowledge/components/billing/refunds.md");
  });
});

describe("comments", () => {
  it("stores a thread in git notes and reads it back", async () => {
    const root = await tempRepo();
    execSync("git init -q", { cwd: root });
    execSync("git config user.email a@b.c", { cwd: root });
    execSync("git config user.name tester", { cwd: root });
    await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/billing/refunds",
      title: "Refunds",
      type: "spec",
      body: "Refunds write to the ledger first.",
    });
    execSync("git add -A && git commit -qm init", { cwd: root });
    const added = await addKnowledgeComment(
      root,
      ".reins/knowledge",
      "components/billing/refunds",
      "Checked with finance.",
    );
    expect(added.comments[0]?.body).toBe("Checked with finance.");
    const read = await knowledgeComments(root, ".reins/knowledge", "components/billing/refunds");
    expect(read.comments.map((comment) => comment.body)).toContain("Checked with finance.");
    expect(read.refAvailable).toBe(true);
  });

  it("shows a comment on a node that is not committed yet", async () => {
    const root = await tempRepo();
    execSync("git init -q", { cwd: root });
    execSync("git config user.email a@b.c", { cwd: root });
    execSync("git config user.name tester", { cwd: root });
    await fs.writeFile(path.join(root, "README.md"), "# fixture\n");
    execSync("git add -A && git commit -qm init", { cwd: root });
    await saveKnowledgeNode(root, ".reins/knowledge", {
      address: "components/billing/new-node",
      title: "New node",
      type: "spec",
      body: "Fresh intent.",
    });
    await addKnowledgeComment(root, ".reins/knowledge", "components/billing/new-node", "TBD.");
    const read = await knowledgeComments(root, ".reins/knowledge", "components/billing/new-node");
    expect(read.comments).toHaveLength(1);
  });
});
