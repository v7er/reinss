import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createSession } from "./session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../../test/fixtures/graph-basic");

const hasTrail = (() => {
  try {
    execSync("trail --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTrail)("RepoSession", () => {
  beforeAll(() => {
    if (!existsSync(path.join(fixture, "graft"))) {
      execSync("trail build .", { cwd: fixture, stdio: "ignore" });
    }
  });

  it("reports a ready graph", async () => {
    const session = await createSession(fixture);
    const status = await session.status();
    expect(status.graph.state).toBe("ready");
    expect(status.graph.nodes).toBeGreaterThan(0);
    expect(status.trail.version).toBeTruthy();
  });

  it("searches symbols", async () => {
    const session = await createSession(fixture);
    const hits = await session.searchSymbols("total", { limit: 5 });
    expect(hits.some((hit) => hit.id === "src/total.ts#total")).toBe(true);
  });

  it("returns callers", async () => {
    const session = await createSession(fixture);
    const slice = await session.graph({ root: { symbolId: "src/math.ts#add" }, depth: 2 });
    expect(slice.nodes.some((node) => node.id === "src/total.ts#total")).toBe(true);
    expect(slice.revision.inSync).toBe(true);
  });
});
