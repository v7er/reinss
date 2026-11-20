import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { watchRepo } from "./watch.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reins-watch-"));
  roots.push(root);
  return root;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for a change");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("watchRepo", () => {
  it("reports a changed file", async () => {
    const root = await tempRoot();
    const seen: string[][] = [];
    const watcher = watchRepo(root, (paths) => seen.push(paths), 10);
    try {
      await writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
      await waitFor(() => seen.length > 0);
      expect(seen.flat()).toContain("a.ts");
    } finally {
      watcher.close();
    }
  });

  it("ignores dependency and cache writes", async () => {
    const root = await tempRoot();
    const seen: string[][] = [];
    const watcher = watchRepo(root, (paths) => seen.push(paths), 10);
    try {
      await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
      await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(seen.flat()).not.toContain("node_modules/pkg/index.js");
    } finally {
      watcher.close();
    }
  });
});
