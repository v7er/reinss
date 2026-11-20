import { describe, expect, it } from "vitest";
import { verifySurfaceSymbols } from "./surfaces.js";
import type { Surface } from "./types.js";

function surface(overrides: Partial<Surface>): Surface {
  return {
    id: "http:express:GET:/api/total",
    kind: "http",
    framework: "express",
    label: "/api/total",
    route: "/api/total",
    method: "GET",
    symbolId: "src/server.ts#handler",
    symbolName: "handler",
    file: "src/server.ts",
    line: 6,
    confidence: "exact",
    evidence: "ast",
    detector: "express",
    detectorVersion: 1,
    componentId: "root",
    metadata: {},
    ...overrides,
  };
}

describe("verifySurfaceSymbols", () => {
  it("nulls a symbol that is not in the graph", () => {
    const [verified] = verifySurfaceSymbols(
      [surface({})],
      new Map([["src/server.ts", new Set(["other"])]]),
    );
    expect(verified?.symbolId).toBeNull();
    expect(verified?.confidence).toBe("inferred");
    expect(verified?.metadata.linkReason).toBe("symbol-not-in-graph");
  });

  it("keeps a symbol that is in the graph", () => {
    const [verified] = verifySurfaceSymbols(
      [surface({})],
      new Map([["src/server.ts", new Set(["handler"])]]),
    );
    expect(verified?.symbolId).toBe("src/server.ts#handler");
    expect(verified?.metadata.linkReason).toBeUndefined();
  });

  it("leaves a file node alone", () => {
    const [verified] = verifySurfaceSymbols(
      [surface({ symbolName: null, symbolId: "src/server.ts" })],
      new Map([["src/server.ts", new Set()]]),
    );
    expect(verified?.symbolId).toBe("src/server.ts");
  });

  it("leaves a surface alone when the file has no skeleton data", () => {
    const [verified] = verifySurfaceSymbols([surface({})], new Map());
    expect(verified?.symbolId).toBe("src/server.ts#handler");
  });
});
