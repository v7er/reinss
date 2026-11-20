import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GitAdapter } from "./git.js";
import { createSession } from "./session.js";

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "reins-git-"));
  const run = (command: string) => execSync(command, { cwd: dir, stdio: "ignore" });
  run("git init -q");
  run("git config user.email test@example.com");
  run("git config user.name Test");
  writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(dir, "b.ts"), "export const b = 1;\n");
  run("git add .");
  run("git commit -qm init");
  return dir;
}

describe("GitAdapter.resolveRange", () => {
  it("keeps staged and unstaged changes apart", async () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add a.ts", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");
    writeFileSync(path.join(dir, "c.ts"), "export const c = 1;\n");

    const git = new GitAdapter(dir);
    const staged = await git.resolveRange({ mode: "staged" });
    const unstaged = await git.resolveRange({ mode: "unstaged" });

    expect(staged.changes.map((change) => change.path)).toEqual(["a.ts"]);
    expect(unstaged.changes.map((change) => change.path).sort()).toEqual(["b.ts", "c.ts"]);
  });
});

describe("GitAdapter status and history", () => {
  it("reports staged, unstaged, and untracked files", async () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add a.ts", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");
    writeFileSync(path.join(dir, "c.ts"), "export const c = 1;\n");

    const status = await new GitAdapter(dir).status();
    const byPath = new Map(status.files.map((file) => [file.path, file]));
    expect(byPath.get("a.ts")?.staged).toBe(true);
    expect(byPath.get("b.ts")?.unstaged).toBe(true);
    expect(byPath.get("c.ts")?.untracked).toBe(true);
    expect(status.clean).toBe(false);
  });

  it("stages, unstages, commits, and logs", async () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    const git = new GitAdapter(dir);

    await git.stage(["a.ts"]);
    expect((await git.status()).files.find((file) => file.path === "a.ts")?.staged).toBe(true);

    await git.unstage(["a.ts"]);
    expect((await git.status()).files.find((file) => file.path === "a.ts")?.unstaged).toBe(true);

    await git.stage(["a.ts"]);
    const result = await git.commit({ message: "change a" });
    expect(result.subject).toBe("change a");
    expect(result.status.clean).toBe(true);

    const log = await git.log(5);
    expect(log[0]?.subject).toBe("change a");
    expect(log[0]?.base).toBeTruthy();
  });

  it("refuses to discard without confirmation", async () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    const session = await createSession(dir);
    await expect(session.gitDiscard({ paths: ["a.ts"], confirm: false })).rejects.toMatchObject({
      code: "GIT_CONFIRM_REQUIRED",
    });
  });
});
