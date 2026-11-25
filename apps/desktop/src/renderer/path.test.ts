import { describe, expect, it } from "vitest";
import { tailPath } from "./path.js";

describe("tailPath", () => {
  it("keeps short paths untouched", () => {
    expect(tailPath("/Users/me/reins")).toBe("/Users/me/reins");
  });

  it("keeps the tail and drops whole leading segments", () => {
    expect(tailPath("/Users/me/projects/clients/acme/reins", 24)).toBe("…/clients/acme/reins");
  });

  it("falls back to a character slice when one segment is too long", () => {
    expect(tailPath("/a/012345678901234567890123456789", 12)).toBe("…90123456789");
  });
});
