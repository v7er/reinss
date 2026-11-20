import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadKnowledge } from "./knowledge.js";
import { createSession } from "./session.js";

async function tempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "reins-knowledge-"));
}

describe("loadKnowledge", () => {
  it("loads Reins notes and OpenSpec files", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, ".reins/knowledge/decisions"), { recursive: true });
    await fs.mkdir(path.join(root, "openspec/specs/refunds"), { recursive: true });
    await fs.mkdir(path.join(root, "openspec/changes/add-refunds"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".reins/knowledge/decisions/ledger-first.md"),
      `---\ntitle: Ledger first\ntype: decision\nstatus: accepted\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\nRefunds write to the ledger first.\n`,
    );
    await fs.writeFile(
      path.join(root, "openspec/config.yaml"),
      "schema: spec-driven\ncontext: |\n  Refunds write to the ledger first.\n",
    );
    await fs.writeFile(
      path.join(root, "openspec/specs/refunds/spec.md"),
      "# Refund spec\n\nLedger first.\n",
    );
    await fs.writeFile(
      path.join(root, "openspec/changes/add-refunds/proposal.md"),
      "# Add refunds\n\nWhy refunds.\n",
    );
    await fs.writeFile(
      path.join(root, "openspec/changes/add-refunds/design.md"),
      "# Refund design\n\nLedger first.\n",
    );

    const loaded = await loadKnowledge(root, ".reins/knowledge");
    expect(loaded.notes.map((note) => note.id).sort()).toEqual([
      "ledger-first",
      "openspec-change-add-refunds-design",
      "openspec-change-add-refunds-proposal",
      "openspec-config",
      "openspec-spec-refunds",
    ]);
    expect(loaded.notes.find((note) => note.id === "openspec-config")?.source).toBe("openspec");
    expect(loaded.notes.find((note) => note.id === "openspec-config")?.type).toBe("constraint");
    expect(loaded.notes.find((note) => note.id === "openspec-config")?.title).toBe(
      "OpenSpec project config",
    );
    expect(
      loaded.notes.find((note) => note.id === "openspec-change-add-refunds-design")?.type,
    ).toBe("decision");
  });

  it("reports invalid frontmatter", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, ".reins/knowledge/decisions"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".reins/knowledge/decisions/bad.md"),
      `---\ntitle: Bad\ntype: nope\nstatus: accepted\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n`,
    );
    const loaded = await loadKnowledge(root, ".reins/knowledge");
    expect(loaded.errors[0]?.code).toBe("NOTE_INVALID");
  });
});

describe("check", () => {
  it("flags a forbidden import in a diff", async () => {
    const root = await tempRepo();
    execSync("git init -q", { cwd: root });
    execSync("git config user.email a@b.c", { cwd: root });
    execSync("git config user.name test", { cwd: root });
    await fs.mkdir(path.join(root, "src/billing"), { recursive: true });
    await fs.mkdir(path.join(root, "src/gateway"), { recursive: true });
    await fs.mkdir(path.join(root, ".reins/knowledge/constraints"), { recursive: true });
    await fs.writeFile(path.join(root, ".reins/config.json"), JSON.stringify({ version: 1 }));
    await fs.writeFile(
      path.join(root, ".reins/knowledge/constraints/no-gateway.md"),
      `---
title: No gateway
type: constraint
status: accepted
created: 2026-01-01
updated: 2026-01-01
rule:
  kind: forbidden-import
  from: "src/billing/**"
  to: "src/gateway"
---
`,
    );
    await fs.writeFile(path.join(root, "src/billing/a.ts"), "export const x = 1;\n");
    await fs.writeFile(path.join(root, "src/gateway/index.ts"), "export const y = 1;\n");
    execSync("git add . && git commit -qm init", { cwd: root });
    await fs.writeFile(
      path.join(root, "src/billing/a.ts"),
      'import { y } from "../gateway";\nexport const x = y;\n',
    );
    const session = await createSession(root);
    const report = await session.check({ scope: "diff" });
    expect(report.ok).toBe(false);
    expect(report.items.some((item) => item.code === "CONSTRAINT_VIOLATED")).toBe(true);
  });

  it("reports a broken note link", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, ".reins/knowledge/decisions"), { recursive: true });
    await fs.writeFile(path.join(root, ".reins/config.json"), JSON.stringify({ version: 1 }));
    await fs.writeFile(
      path.join(root, ".reins/knowledge/decisions/ledger-first.md"),
      `---\ntitle: Ledger first\ntype: decision\nstatus: accepted\ncreated: 2026-01-01\nupdated: 2026-01-01\nlinks:\n  - rel: implements\n    note: missing-note\n---\n`,
    );
    const session = await createSession(root);
    const report = await session.check({ scope: "knowledge" });
    expect(report.ok).toBe(false);
    expect(report.items.some((item) => item.code === "LINK_BROKEN")).toBe(true);
  });
});
