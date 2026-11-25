import { describe, expect, it } from "vitest";
import {
  assignComponent,
  componentIdFromRoot,
  componentKindFromPath,
  sortComponents,
} from "./components.js";
import type { Component } from "./types.js";

function component(root: string, kind: Component["kind"]): Component {
  return {
    id: componentIdFromRoot(root),
    name: root || "root",
    kind,
    root,
    packageName: null,
    languages: [],
    surfaceCount: 0,
    changed: false,
  };
}

describe("componentKindFromPath", () => {
  it("maps the five C1 kinds", () => {
    expect(componentKindFromPath("apps/web")).toBe("webapp");
    expect(componentKindFromPath("apps/mobile")).toBe("mobile");
    expect(componentKindFromPath("apps/backoffice")).toBe("backoffice");
    expect(componentKindFromPath("apps/bo")).toBe("backoffice");
    expect(componentKindFromPath("apps/portal")).toBe("webapp");
    expect(componentKindFromPath("packages/core")).toBe("core");
    expect(componentKindFromPath("apps/cli")).toBe("cli");
  });

  it("uses the package name when the path is generic", () => {
    expect(componentKindFromPath("apps/desktop @reinss/desktop")).toBe("webapp");
    expect(componentKindFromPath("services/billing")).toBe("service");
  });

  it("falls back to unknown", () => {
    expect(componentKindFromPath("reins-workspace")).toBe("unknown");
  });
});

describe("componentIdFromRoot", () => {
  it("slugs the root", () => {
    expect(componentIdFromRoot("")).toBe("root");
    expect(componentIdFromRoot("apps/web")).toBe("apps-web");
    expect(componentIdFromRoot("./packages/core/")).toBe("packages-core");
  });
});

describe("assignComponent", () => {
  const components = [
    component("", "unknown"),
    component("apps", "unknown"),
    component("apps/web", "webapp"),
    component("apps/web/admin", "backoffice"),
  ];

  it("picks the longest matching root", () => {
    expect(assignComponent("apps/web/src/page.tsx", components)).toBe("apps-web");
    expect(assignComponent("apps/web/admin/users.tsx", components)).toBe("apps-web-admin");
    expect(assignComponent("apps/cli/main.ts", components)).toBe("apps");
    expect(assignComponent("README.md", components)).toBe("root");
  });

  it("does not match a sibling prefix", () => {
    expect(assignComponent("apps/webhooks/main.ts", components)).toBe("apps");
  });
});

describe("sortComponents", () => {
  it("orders by C1 kind", () => {
    const sorted = sortComponents([
      component("apps/cli", "cli"),
      component("apps/web", "webapp"),
      component("packages/core", "core"),
    ]);
    expect(sorted.map((item) => item.kind)).toEqual(["webapp", "core", "cli"]);
  });
});
