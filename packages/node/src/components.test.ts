import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverComponents } from "./components.js";

async function write(root: string, file: string, text: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
}

describe("discoverComponents", () => {
  it("discovers pnpm workspaces and infers C1 kinds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-components-"));
    await write(root, "package.json", JSON.stringify({ name: "acme", private: true }));
    await write(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
    await write(root, "apps/web/package.json", JSON.stringify({ name: "@acme/web" }));
    await write(root, "apps/mobile/package.json", JSON.stringify({ name: "@acme/mobile" }));
    await write(root, "apps/backoffice/package.json", JSON.stringify({ name: "@acme/backoffice" }));
    await write(root, "apps/cli/package.json", JSON.stringify({ name: "@acme/cli" }));
    await write(root, "packages/core/package.json", JSON.stringify({ name: "@acme/core" }));
    await write(root, "apps/empty/README.md", "no manifest");

    const components = await discoverComponents(root);
    const byRoot = new Map(components.map((component) => [component.root, component]));

    expect(byRoot.get("")?.name).toBe("acme");
    expect(byRoot.get("apps/web")?.kind).toBe("webapp");
    expect(byRoot.get("apps/mobile")?.kind).toBe("mobile");
    expect(byRoot.get("apps/backoffice")?.kind).toBe("backoffice");
    expect(byRoot.get("apps/cli")?.kind).toBe("cli");
    expect(byRoot.get("packages/core")?.kind).toBe("core");
    expect(byRoot.has("apps/empty")).toBe(false);
    expect(byRoot.get("apps/web")?.languages).toContain("typescript");
  });

  it("discovers a Cargo workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-cargo-"));
    await write(root, "Cargo.toml", '[workspace]\nmembers = ["crates/api", "crates/core"]\n');
    await write(root, "crates/api/Cargo.toml", '[package]\nname = "acme-api"\n');
    await write(root, "crates/core/Cargo.toml", '[package]\nname = "acme-core"\n');

    const components = await discoverComponents(root);
    const byRoot = new Map(components.map((component) => [component.root, component]));

    expect(byRoot.get("crates/api")?.kind).toBe("service");
    expect(byRoot.get("crates/api")?.languages).toContain("rust");
    expect(byRoot.get("crates/core")?.kind).toBe("core");
  });

  it("keeps a single root component when there is no workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reins-single-"));
    await write(root, "package.json", JSON.stringify({ name: "solo" }));

    const components = await discoverComponents(root);
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ id: "root", root: "", name: "solo" });
  });
});
