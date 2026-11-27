import { describe, expect, it } from "vitest";
import {
  buildKnowledgeIndex,
  excerptFor,
  type KnowledgeIndexDoc,
  layerFor,
  parseAliases,
  parseTemplate,
  routeIntent,
  searchKnowledgeIndex,
  tokenize,
} from "./tree.js";

const templateText = `# Knowledge template

## Layers

| Layer | Glob | Purpose |
| --- | --- | --- |
| product | \`product/**\` | Product intent |
| component | \`components/**\` | Code components |

## Required fields

title, type, status, created, updated, owner

## Rules

1. A component node states the contract.
`;

function doc(overrides: Partial<KnowledgeIndexDoc> = {}): KnowledgeIndexDoc {
  return {
    address: "components/billing/refunds",
    type: "spec",
    component: "components/billing",
    updated: "2026-01-01",
    title: "Refund policy",
    tags: ["billing"],
    headings: ["Refunds"],
    body: "Refunds write to the ledger first.",
    linkLabels: [],
    ...overrides,
  };
}

describe("parseTemplate", () => {
  it("reads layers, required fields, and rules", () => {
    const { template, errors } = parseTemplate(templateText);
    expect(errors).toEqual([]);
    expect(template?.layers.map((layer) => layer.name)).toEqual(["product", "component"]);
    expect(template?.requiredFields).toContain("owner");
    expect(template?.requiredFields).toContain("title");
    expect(template?.rules).toContain("contract");
  });

  it("rejects a template with no layers", () => {
    const { template, errors } = parseTemplate("# Template\n\nNo layers here.\n");
    expect(template).toBeNull();
    expect(errors[0]?.code).toBe("TEMPLATE_INVALID");
  });

  it("rejects an escaping glob", () => {
    const { template, errors } = parseTemplate(
      "## Layers\n\n| Layer | Glob |\n| --- | --- |\n| bad | ../outside/** |\n",
    );
    expect(template).toBeNull();
    expect(errors.some((issue) => issue.message.includes("invalid glob"))).toBe(true);
  });
});

describe("layers", () => {
  it("resolves the first matching glob", () => {
    const { template } = parseTemplate(templateText);
    expect(layerFor(template, "components/billing/refunds")).toBe("component");
    expect(layerFor(template, "product/refunds")).toBe("product");
    expect(layerFor(template, "notes/other")).toBeNull();
  });
});

describe("tokenize", () => {
  it("drops stop words, short tokens, and stems plurals", () => {
    expect(tokenize("Why do refunds write to the ledger?")).toEqual(["refund", "write", "ledger"]);
  });
});

describe("aliases and intent", () => {
  it("parses inline and list aliases", () => {
    const aliases = parseAliases("refund: [credit, reversal]\nbilling:\n  - invoice\n");
    expect(aliases.refund).toEqual(["credit", "reversal"]);
    expect(aliases.billing).toEqual(["invoice"]);
  });

  it("routes requirement words to specs", () => {
    expect(routeIntent("what is the refund requirement")?.types).toEqual(["spec"]);
    expect(routeIntent("why ledger first")?.types).toEqual(["decision"]);
    expect(routeIntent("refund").types).toBeNull();
  });
});

describe("searchKnowledgeIndex", () => {
  const docs = [
    doc(),
    doc({
      address: "components/billing/ledger",
      title: "Ledger ordering",
      body: "Refunds are recorded before capture. The ledger is the source.",
      updated: "2026-02-01",
    }),
    doc({
      address: "components/checkout/cart",
      title: "Cart rules",
      type: "constraint",
      component: "components/checkout",
      body: "Never charge before the cart is confirmed.",
    }),
  ];

  const built = buildKnowledgeIndex(docs, null, { templateHash: "t", aliasesHash: "a" });

  it("ranks a title match above a body match", () => {
    const result = searchKnowledgeIndex(built.data, {
      query: "ledger",
      aliases: {},
      limit: 10,
    });
    expect(result.items[0]?.address).toBe("components/billing/ledger");
    expect(result.items.map((hit) => hit.address)).toContain("components/billing/refunds");
  });

  it("reuses unchanged entries", () => {
    const second = buildKnowledgeIndex(docs, built.data, { templateHash: "t", aliasesHash: "a" });
    expect(second.parsed).toBe(0);
    expect(second.reused).toBe(3);
    expect(second.data.entries[0]?.hash).toBe(built.data.entries[0]?.hash);
  });

  it("reparses one changed entry", () => {
    const changed = [docs[0], { ...docs[1], body: "Different body about invoices." }, docs[2]];
    const second = buildKnowledgeIndex(changed as KnowledgeIndexDoc[], built.data, {
      templateHash: "t",
      aliasesHash: "a",
    });
    expect(second.parsed).toBe(1);
    expect(second.reused).toBe(2);
  });

  it("expands aliases", () => {
    const result = searchKnowledgeIndex(built.data, {
      query: "invoice",
      aliases: { invoice: ["ledger"] },
      limit: 10,
    });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("ranks the intent type first", () => {
    const result = searchKnowledgeIndex(built.data, {
      query: "rule never charge",
      aliases: {},
      limit: 10,
    });
    expect(result.filter.type).toBeNull();
    expect(result.items[0]?.type).toBe("constraint");
  });

  it("honours an explicit type filter", () => {
    const result = searchKnowledgeIndex(built.data, {
      query: "ledger",
      aliases: {},
      type: "constraint",
      limit: 10,
    });
    expect(result.filter.type).toBe("constraint");
    expect(result.items.every((hit) => hit.type === "constraint")).toBe(true);
  });

  it("returns an empty list with no match", () => {
    const result = searchKnowledgeIndex(built.data, {
      query: "quantum",
      aliases: {},
      limit: 10,
    });
    expect(result.items).toEqual([]);
    expect(typeof result.tookMs).toBe("number");
  });
});

describe("excerptFor", () => {
  it("returns the matching line and its neighbour", () => {
    expect(excerptFor("# Refunds\n\nRefunds write to the ledger.\nThen capture.", ["ledger"])).toBe(
      "Refunds write to the ledger. Then capture.",
    );
  });
});
