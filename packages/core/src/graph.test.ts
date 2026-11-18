import { describe, expect, it } from "vitest";
import { computeFingerprint, normalizeAsk, normalizeCallers, parseSpan } from "./graph.js";
import type { GraphRevision } from "./types.js";

const revision: GraphRevision = {
  fingerprint: "abc",
  trailVersion: "0.28.0",
  gitHead: null,
  inSync: true,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

describe("parseSpan", () => {
  it("parses a single-line span", () => {
    expect(parseSpan("L4")).toEqual({ startLine: 4, endLine: 4 });
  });

  it("parses a range", () => {
    expect(parseSpan("L2-L9")).toEqual({ startLine: 2, endLine: 9 });
  });

  it("rejects an unknown span", () => {
    expect(() => parseSpan("2:9")).toThrow(/Unsupported Trail span/);
  });
});

describe("normalizeCallers", () => {
  it("maps Trail callers to a sorted slice", () => {
    const slice = normalizeCallers(
      {
        query: "add",
        matches: [
          {
            symbol: {
              id: "src/math.ts#add",
              name: "add",
              kind: "function",
              path: "src/math.ts",
              span: "L1-L3",
            },
            hits: [
              {
                id: "src/total.ts#total",
                name: "total",
                kind: "function",
                path: "src/total.ts",
                span: "L3-L5",
                relation: "calls",
                depth: 1,
              },
              {
                id: "src/main.ts#main",
                name: "main",
                kind: "function",
                path: "src/main.ts",
                span: "L3-L5",
                relation: "calls",
                depth: 2,
              },
            ],
          },
        ],
      },
      { direction: "in", depth: 2, maxNodes: 10, revision },
    );
    expect(slice.nodes.map((node) => node.id)).toEqual([
      "src/math.ts#add",
      "src/total.ts#total",
      "src/main.ts#main",
    ]);
    expect(slice.edges).toHaveLength(2);
    expect(slice.truncated).toBe(false);
  });

  it("caps nodes and marks truncation", () => {
    const slice = normalizeCallers(
      {
        query: "add",
        matches: [
          {
            symbol: { id: "a#add", name: "add", kind: "function", path: "a.ts", span: "L1" },
            hits: [
              {
                id: "b#b",
                name: "b",
                kind: "function",
                path: "b.ts",
                span: "L1",
                relation: "calls",
                depth: 1,
              },
              {
                id: "c#c",
                name: "c",
                kind: "function",
                path: "c.ts",
                span: "L1",
                relation: "calls",
                depth: 1,
              },
            ],
          },
        ],
      },
      { direction: "in", depth: 1, maxNodes: 2, revision },
    );
    expect(slice.nodes).toHaveLength(2);
    expect(slice.truncated).toBe(true);
    expect(slice.truncatedBy).toBe("nodes");
  });
});

describe("normalizeAsk", () => {
  it("reads the symbol kind from the Trail title", () => {
    const hits = normalizeAsk(
      {
        query: "total",
        hits: [
          {
            kind: "symbol",
            title: "total · function",
            pointer: "src/total.ts:L3-L5",
            snippet: "function total()",
            score: 1,
          },
        ],
      },
      10,
    );
    expect(hits[0]).toMatchObject({ id: "src/total.ts#total", kind: "function", startLine: 3 });
  });
});

describe("computeFingerprint", () => {
  it("is stable for the same input", async () => {
    const input = {
      trailVersion: "0.28.0",
      nodes: 7,
      inSync: true,
      gitHead: null,
      gitDirty: false,
      adapterVersion: "0.1.0",
      contractVersion: 1,
    };
    expect(await computeFingerprint(input)).toBe(await computeFingerprint(input));
  });

  it("changes when the graph changes", async () => {
    const base = {
      trailVersion: "0.28.0",
      nodes: 7,
      inSync: true,
      gitHead: null,
      gitDirty: false,
      adapterVersion: "0.1.0",
      contractVersion: 1,
    };
    expect(await computeFingerprint(base)).not.toBe(
      await computeFingerprint({ ...base, nodes: 8 }),
    );
  });
});
