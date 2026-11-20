import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
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

  it("lists graph nodes without a query", async () => {
    const session = await createSession(fixture);
    const hits = await session.listSymbols({ limit: 20 });
    expect(hits.some((hit) => hit.id === "src/total.ts#total")).toBe(true);
    expect(hits.every((hit) => hit.path && hit.startLine !== null)).toBe(true);
  });

  it("returns callers", async () => {
    const session = await createSession(fixture);
    const slice = await session.graph({ root: { symbolId: "src/math.ts#add" }, depth: 2 });
    expect(slice.nodes.some((node) => node.id === "src/total.ts#total")).toBe(true);
    expect(slice.revision.inSync).toBe(true);
  });

  it("scopes a symbol id to its file when names collide", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-flow-collision-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), '{"name":"flow-collision","private":true}');
    writeFileSync(path.join(dir, "src", "a.ts"), "export function Page() {\n  return 1;\n}\n");
    writeFileSync(path.join(dir, "src", "b.ts"), "export function Page() {\n  return 2;\n}\n");
    execSync("trail build .", { cwd: dir, stdio: "ignore" });
    const session = await createSession(dir);
    const slice = await session.flow({ target: "src/b.ts#Page", depth: 1 });
    expect(slice.root?.path).toBe("src/b.ts");
  });

  it("falls back to imports when the call graph has no edges", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-flow-imports-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), '{"name":"flow-imports","private":true}');
    writeFileSync(
      path.join(dir, "src", "helper.tsx"),
      "export function Helper() {\n  return null;\n}\n",
    );
    writeFileSync(
      path.join(dir, "src", "page.tsx"),
      "import { Helper } from './helper';\n\nexport function Page() {\n  return <Helper />;\n}\n",
    );
    execSync("trail build .", { cwd: dir, stdio: "ignore" });
    const session = await createSession(dir);
    const slice = await session.flow({ target: "src/page.tsx#Page", depth: 2 });
    expect(slice.nodes.some((node) => node.path === "src/helper.tsx")).toBe(true);
  });
  it("links an OpenAPI surface to its x-source-file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-flow-openapi-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), '{"name":"flow-openapi","private":true}');
    writeFileSync(
      path.join(dir, "src", "jobs.ts"),
      "export function listJobs() {\n  return 1;\n}\n",
    );
    writeFileSync(path.join(dir, "src", "other.ts"), "export function json() {\n  return 2;\n}\n");
    writeFileSync(
      path.join(dir, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.0",
        paths: {
          "/jobs": { get: { operationId: "json", "x-source-file": "src/jobs.ts" } },
        },
      }),
    );
    execSync("trail build .", { cwd: dir, stdio: "ignore" });
    const session = await createSession(dir);
    const page = await session.listSurfaces({ evidence: "openapi" });
    const surface = page.items[0];
    expect(surface?.file).toBe("src/jobs.ts");
    const slice = await session.flow({ target: surface?.id ?? "", depth: 1 });
    expect(slice.root?.path).toBe("src/jobs.ts");
  });

  it("refuses to trace an OpenAPI surface without x-source-file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-flow-openapi-missing-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), '{"name":"flow-openapi-missing","private":true}');
    writeFileSync(
      path.join(dir, "src", "jobs.ts"),
      "export function listJobs() {\n  return 1;\n}\n",
    );
    writeFileSync(
      path.join(dir, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.0",
        paths: { "/jobs": { get: { operationId: "listJobs" } } },
      }),
    );
    execSync("trail build .", { cwd: dir, stdio: "ignore" });
    const session = await createSession(dir);
    const page = await session.listSurfaces({ evidence: "openapi" });
    const surface = page.items[0];
    expect(surface?.metadata.linkReason).toBe("missing-x-source-file");
    await expect(session.flow({ target: surface?.id ?? "" })).rejects.toMatchObject({
      code: "SURFACE_UNTRACEABLE",
    });
  });
});

describe("RepoSession surfaces", () => {
  it("groups surfaces by component", async () => {
    const session = await createSession(fixture);
    const page = await session.listSurfaces({ limit: 100 });
    expect(page.components.some((component) => component.id === "root")).toBe(true);
    expect(page.items.every((surface) => surface.componentId === "root")).toBe(true);
  });

  it("bootstraps a repository once", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-bootstrap-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"demo"}');

    const session = await createSession(dir);
    const first = await session.bootstrap();
    expect(first.created).toContain(".reins/config.json");
    expect(first.created).toContain(".reins/knowledge/specs");
    expect(existsSync(path.join(dir, ".reins/knowledge/inbox"))).toBe(true);

    const second = await session.bootstrap();
    expect(second.created).toEqual([]);
  });

  it("filters surfaces by component kind", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-surfaces-component-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"acme","private":true}');
    writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    mkdirSync(path.join(dir, "apps/web/src"), { recursive: true });
    mkdirSync(path.join(dir, "apps/cli/src"), { recursive: true });
    writeFileSync(path.join(dir, "apps/web/package.json"), '{"name":"@acme/web"}');
    writeFileSync(path.join(dir, "apps/cli/package.json"), '{"name":"@acme/cli"}');
    writeFileSync(
      path.join(dir, "apps/web/src/server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/web", () => {});\n',
    );
    writeFileSync(
      path.join(dir, "apps/cli/src/main.ts"),
      'import express from "express";\nconst app = express();\napp.get("/cli", () => {});\n',
    );

    const session = await createSession(dir);
    const page = await session.listSurfaces({ component: "webapp" });
    expect(page.items.map((surface) => surface.route)).toEqual(["/web"]);
    expect(page.components.find((component) => component.id === "apps-web")?.surfaceCount).toBe(1);
  });

  it("filters surfaces by evidence", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-surfaces-evidence-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"acme","private":true}');
    writeFileSync(
      path.join(dir, "server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/code", () => {});\n',
    );
    writeFileSync(
      path.join(dir, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.0",
        paths: { "/spec": { get: { operationId: "getSpec" } } },
      }),
    );

    const session = await createSession(dir);
    const all = await session.listSurfaces({ limit: 100 });
    expect(all.items.some((surface) => surface.evidence === "ast")).toBe(true);
    const spec = await session.listSurfaces({ evidence: "openapi", limit: 100 });
    expect(spec.items.map((surface) => surface.route)).toEqual(["/spec"]);
    expect(spec.items.every((surface) => surface.evidence === "openapi")).toBe(true);
  });

  it("diffs a commit against its parent", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-commit-diff-"));
    const run = (command: string) => execSync(command, { cwd: dir, stdio: "ignore" });
    run("git init -q");
    run("git config user.email test@example.com");
    run("git config user.name Test");
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    run("git add .");
    run("git commit -qm init");
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    run("git add .");
    run("git commit -qm change");

    const session = await createSession(dir);
    const log = await session.gitLog({ limit: 1 });
    const diff = await session.diff({ range: { mode: "commit", hash: log[0]?.hash ?? "HEAD" } });
    expect(diff.resolved.mode).toBe("commit");
    expect(diff.files.some((file) => file.path === "a.ts")).toBe(true);
  });

  it("rescans surfaces after a file change in a dirty tree", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-surfaces-dirty-"));
    const run = (command: string) => execSync(command, { cwd: dir, stdio: "ignore" });
    run("git init -q");
    run("git config user.email test@example.com");
    run("git config user.name Test");
    writeFileSync(
      path.join(dir, "server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/api/one", () => 1);\n',
    );
    run("git add .");
    run("git commit -qm init");

    const session = await createSession(dir);
    const first = await session.listSurfaces({ limit: 100 });
    expect(first.items.map((item) => item.route)).toEqual(["/api/one"]);

    writeFileSync(
      path.join(dir, "server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/api/two", () => 2);\n',
    );
    const second = await session.listSurfaces({ limit: 100 });
    expect(second.items.map((item) => item.route)).toEqual(["/api/two"]);
  });

  it("marks a surface touched by the working diff", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reins-surfaces-diff-"));
    const run = (command: string) => execSync(command, { cwd: dir, stdio: "ignore" });
    run("git init -q");
    run("git config user.email test@example.com");
    run("git config user.name Test");
    writeFileSync(
      path.join(dir, "server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/api/total", () => 1);\n',
    );
    run("git add .");
    run("git commit -qm init");
    writeFileSync(
      path.join(dir, "server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/api/total", () => 2);\n',
    );

    const session = await createSession(dir);
    const page = await session.listSurfaces({ range: { mode: "working" } });
    const surface = page.items.find((item) => item.route === "/api/total");
    expect(surface?.change).toEqual({ status: "modified", touched: true });

    const changed = await session.listSurfaces({ changed: true });
    expect(changed.items.map((item) => item.route)).toEqual(["/api/total"]);
  });
});
