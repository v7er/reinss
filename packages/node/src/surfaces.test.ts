import { promises as fs } from "node:fs";
import os from "node:os";
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
      componentId: "root",
    });
  });

  it("does not emit a Hono surface for an Express import", async () => {
    const result = await scanSurfaces(fixture);
    expect(result.surfaces.some((surface) => surface.framework === "hono")).toBe(false);
  });

  it("ignores reference code under legacy", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-surfaces-"));
    await fs.mkdir(path.join(root, "legacy/app"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "legacy/app/index.ts"),
      'import express from "express";\nconst app = express();\napp.get("/legacy", () => {});\n',
    );
    await fs.writeFile(
      path.join(root, "src/app.ts"),
      'import express from "express";\nconst app = express();\napp.get("/live", () => {});\n',
    );
    const result = await scanSurfaces(root);
    expect(result.surfaces.map((surface) => surface.route)).toEqual(["/live"]);
  });

  it("assigns a surface to the longest matching component", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-surfaces-components-"));
    await fs.mkdir(path.join(root, "apps/web/src"), { recursive: true });
    await fs.mkdir(path.join(root, "apps/cli/src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "apps/web/src/server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/web", () => {});\n',
    );
    await fs.writeFile(
      path.join(root, "apps/cli/src/main.ts"),
      'import express from "express";\nconst app = express();\napp.get("/cli", () => {});\n',
    );
    const components = [
      {
        id: "root",
        name: "root",
        kind: "unknown" as const,
        root: "",
        packageName: null,
        languages: [],
        surfaceCount: 0,
        changed: false,
      },
      {
        id: "apps-web",
        name: "web",
        kind: "webapp" as const,
        root: "apps/web",
        packageName: null,
        languages: [],
        surfaceCount: 0,
        changed: false,
      },
      {
        id: "apps-cli",
        name: "cli",
        kind: "cli" as const,
        root: "apps/cli",
        packageName: null,
        languages: [],
        surfaceCount: 0,
        changed: false,
      },
    ];
    const result = await scanSurfaces(root, { components });
    const byRoute = new Map(result.surfaces.map((surface) => [surface.route, surface.componentId]));
    expect(byRoute.get("/web")).toBe("apps-web");
    expect(byRoute.get("/cli")).toBe("apps-cli");
  });

  it("discovers OpenAPI JSON routes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-openapi-"));
    await fs.writeFile(
      path.join(root, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.3",
        paths: {
          "/api/users": {
            get: { operationId: "listUsers" },
            post: { operationId: "createUser" },
          },
          "/api/users/{id}": { delete: { operationId: "deleteUser" } },
        },
      }),
    );

    const result = await scanSurfaces(root);
    const openapi = result.surfaces.filter((surface) => surface.framework === "openapi");
    expect(openapi).toHaveLength(3);
    expect(openapi.find((surface) => surface.method === "GET")?.route).toBe("/api/users");
    expect(openapi.find((surface) => surface.method === "GET")?.symbolName).toBe("listUsers");
    expect(openapi.every((surface) => surface.evidence === "openapi")).toBe(true);
    expect(openapi.every((surface) => surface.confidence === "inferred")).toBe(true);
  });

  it("links OpenAPI operations to x-source-file relative to the spec folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-openapi-source-"));
    await fs.mkdir(path.join(root, "apps/web/src/admin/spaces"), { recursive: true });
    await fs.writeFile(
      path.join(root, "apps/web/openapi.json"),
      JSON.stringify({
        openapi: "3.0.3",
        paths: {
          "/admin/spaces": {
            get: {
              operationId: "listSpaces",
              "x-source-file": "src/admin/spaces/list.ts",
            },
          },
          "/admin/spaces/{id}": {
            "x-source-file": "src/admin/spaces/item.ts",
            delete: { operationId: "deleteSpace" },
          },
          "/health": { get: { operationId: "health" } },
        },
      }),
    );

    const result = await scanSurfaces(root);
    const openapi = result.surfaces.filter((surface) => surface.framework === "openapi");
    const list = openapi.find((surface) => surface.route === "/admin/spaces");
    expect(list?.file).toBe("apps/web/src/admin/spaces/list.ts");
    expect(list?.symbolId).toBe("apps/web/src/admin/spaces/list.ts#listSpaces");
    expect(list?.metadata.spec).toBe("apps/web/openapi.json");
    expect(openapi.find((surface) => surface.route === "/admin/spaces/{id}")?.file).toBe(
      "apps/web/src/admin/spaces/item.ts",
    );
    expect(openapi.find((surface) => surface.route === "/health")?.file).toBe(
      "apps/web/openapi.json",
    );
  });

  it("resolves x-source-file from the nearest ancestor that has the file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-openapi-cmdroot-"));
    await fs.mkdir(path.join(root, "apps/web/src/admin/spaces"), { recursive: true });
    await fs.mkdir(path.join(root, "apps/web/docs"), { recursive: true });
    await fs.mkdir(path.join(root, "src/shared"), { recursive: true });
    await fs.writeFile(path.join(root, "apps/web/src/admin/spaces/list.ts"), "export {};\n");
    await fs.writeFile(path.join(root, "src/shared/health.ts"), "export {};\n");
    await fs.writeFile(
      path.join(root, "apps/web/docs/openapi.json"),
      JSON.stringify({
        openapi: "3.0.3",
        paths: {
          "/admin/spaces": {
            get: { operationId: "listSpaces", "x-source-file": "src/admin/spaces/list.ts" },
          },
          "/health": { get: { operationId: "health", "x-source-file": "src/shared/health.ts" } },
        },
      }),
    );

    const result = await scanSurfaces(root);
    const openapi = result.surfaces.filter((surface) => surface.framework === "openapi");
    expect(openapi.find((surface) => surface.route === "/admin/spaces")?.file).toBe(
      "apps/web/src/admin/spaces/list.ts",
    );
    expect(openapi.find((surface) => surface.route === "/health")?.file).toBe(
      "src/shared/health.ts",
    );
  });

  it("ignores an x-source-file that escapes the repository", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-openapi-escape-"));
    await fs.writeFile(
      path.join(root, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.3",
        paths: {
          "/escape": { get: { operationId: "escape", "x-source-file": "../../etc/passwd" } },
        },
      }),
    );

    const result = await scanSurfaces(root);
    const surface = result.surfaces.find((item) => item.route === "/escape");
    expect(surface?.file).toBe("openapi.json");
    expect(surface?.metadata.sourceFile).toBeUndefined();
  });

  it("prefers a code route over the same OpenAPI route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-openapi-dedupe-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src/server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/api/users", () => {});\n',
    );
    await fs.writeFile(
      path.join(root, "openapi.json"),
      JSON.stringify({
        openapi: "3.0.3",
        paths: {
          "/api/users": { get: { operationId: "listUsers" } },
          "/api/health": { get: { operationId: "health" } },
        },
      }),
    );

    const result = await scanSurfaces(root);
    const users = result.surfaces.filter((surface) => surface.route === "/api/users");
    expect(users).toHaveLength(1);
    expect(users[0]?.framework).toBe("express");
    expect(
      result.surfaces.some(
        (surface) => surface.framework === "openapi" && surface.route === "/api/health",
      ),
    ).toBe(true);
  });

  it("is deterministic", async () => {
    const first = await scanSurfaces(fixture);
    const second = await scanSurfaces(fixture);
    expect(JSON.stringify(first.surfaces)).toBe(JSON.stringify(second.surfaces));
  });
});
