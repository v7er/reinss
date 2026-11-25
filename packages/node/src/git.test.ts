import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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

describe("GitAdapter branches, tags, worktrees, and graph", () => {
  it("lists local and remote branches, then creates, switches, and deletes", async () => {
    const dir = makeRepo();
    const git = new GitAdapter(dir);
    const current = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync("git branch feature", { cwd: dir, stdio: "ignore" });
    execSync("git update-ref refs/remotes/origin/main HEAD", { cwd: dir, stdio: "ignore" });

    const branches = await git.branches();
    expect(branches.current).toBe(current);
    expect(branches.local.some((branch) => branch.name === "feature")).toBe(true);
    expect(branches.remote.some((branch) => branch.name === "origin/main")).toBe(true);
    expect(branches.remote.some((branch) => branch.name === "origin")).toBe(false);

    await git.checkoutBranch("feature");
    expect((await git.status()).branch).toBe("feature");
    await git.createBranch("next", current, true);
    expect((await git.status()).branch).toBe("next");
    await git.deleteBranch("feature");
    expect((await git.branches()).local.some((branch) => branch.name === "feature")).toBe(false);
  });

  it("creates and deletes lightweight and annotated tags", async () => {
    const dir = makeRepo();
    const git = new GitAdapter(dir);
    await git.createTag({ name: "v1.0.0", message: "release" });
    await git.createTag({ name: "v1.0.1" });

    const tags = await git.tags();
    expect(tags.find((tag) => tag.name === "v1.0.0")?.annotated).toBe(true);
    expect(tags.find((tag) => tag.name === "v1.0.1")?.annotated).toBe(false);

    await git.deleteTag("v1.0.0");
    expect((await git.tags()).some((tag) => tag.name === "v1.0.0")).toBe(false);
  });

  it("adds and removes a worktree", async () => {
    const dir = makeRepo();
    const git = new GitAdapter(dir);
    const target = path.join(tmpdir(), `reins-wt-${process.pid}-${Date.now()}`);

    const added = await git.addWorktree({ path: target, branch: "wt", createBranch: true });
    const resolved = realpathSync(target);
    expect(added.some((worktree) => worktree.path === resolved && worktree.branch === "wt")).toBe(
      true,
    );

    await git.removeWorktree(target);
    expect((await git.worktrees()).some((worktree) => worktree.path === resolved)).toBe(false);
  });

  it("returns parents and refs for a merge graph", async () => {
    const dir = makeRepo();
    const current = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync("git checkout -qb feature", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add . && git commit -qm feature", { cwd: dir, stdio: "ignore" });
    execSync(`git checkout -q ${current}`, { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");
    execSync("git add . && git commit -qm main", { cwd: dir, stdio: "ignore" });
    execSync("git merge --no-ff -qm merge feature", { cwd: dir, stdio: "ignore" });

    const graph = await new GitAdapter(dir).graph(20);
    const merge = graph.find((commit) => commit.parents.length === 2);
    expect(merge).toBeTruthy();
    expect(graph.some((commit) => commit.refs.includes("feature"))).toBe(true);
  });
});
