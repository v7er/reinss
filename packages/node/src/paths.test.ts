import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWithinRoot } from "./paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../test/fixtures/graph-basic");

describe("resolveWithinRoot", () => {
  it("resolves a relative path", () => {
    expect(resolveWithinRoot(root, "src/math.ts")).toBe(path.join(root, "src/math.ts"));
  });

  it("rejects a parent escape", () => {
    expect(() => resolveWithinRoot(root, "../outside.ts")).toThrow(/escapes/);
  });

  it("rejects an absolute path", () => {
    expect(() => resolveWithinRoot(root, "/etc/passwd")).toThrow(/Absolute path/);
  });
});
