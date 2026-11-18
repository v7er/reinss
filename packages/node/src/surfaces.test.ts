import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanSurfaces } from "./surfaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../../test/fixtures/graph-basic");

describe("scanSurfaces", () => {
  it("finds an Express route and links the file", async () => {
    const result = await scanSurfaces(fixture);
    const express = result.surfaces.filter((surface) => surface.framework === "express");
    expect(express).toHaveLength(1);
    expect(express[0]).toMatchObject({
      id: "http:express:GET:/api/total",
      kind: "http",
      file: "src/server.ts",
      line: 6,
    });
  });

  it("does not emit a Hono surface for an Express import", async () => {
    const result = await scanSurfaces(fixture);
    expect(result.surfaces.some((surface) => surface.framework === "hono")).toBe(false);
  });

  it("is deterministic", async () => {
    const first = await scanSurfaces(fixture);
    const second = await scanSurfaces(fixture);
    expect(JSON.stringify(first.surfaces)).toBe(JSON.stringify(second.surfaces));
  });
});
