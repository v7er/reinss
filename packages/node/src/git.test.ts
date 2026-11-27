import { execFileSync, execSync } from "node:child_process";
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

describe("GitAdapter reviews", () => {
  it("detects git-appraise notes and flags reviews that need review", async () => {
    const dir = makeRepo();
    const git = new GitAdapter(dir);
    expect((await git.reviews()).available).toBe(false);

    const base = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync("git checkout -qb feature", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git commit -qam feature", { cwd: dir, stdio: "ignore" });
    const head = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    const request = {
      timestamp: "100",
      reviewRef: "refs/heads/feature",
      targetRef: `refs/heads/${base}`,
      requester: "other@example.com",
      reviewers: ["test@example.com"],
      description: "Review me",
    };
    execFileSync(
      "git",
      [
        "notes",
        "--ref",
        "refs/notes/devtools/reviews",
        "append",
        "-m",
        JSON.stringify(request),
        head,
      ],
      { cwd: dir, stdio: "ignore" },
    );

    const reviews = await git.reviews();
    expect(reviews.available).toBe(true);
    expect(reviews.currentUser).toBe("test@example.com");
    expect(reviews.reviews).toHaveLength(1);
    expect(reviews.reviews[0]).toMatchObject({
      revision: head,
      needsReview: true,
      resolved: false,
      submitted: false,
    });
    expect(reviews.reviews[0]?.base).toBeTruthy();
    expect(reviews.reviews[0]?.head).toBe(head);

    execFileSync(
      "git",
      [
        "notes",
        "--ref",
        "refs/notes/devtools/discuss",
        "append",
        "-m",
        JSON.stringify({
          timestamp: "101",
          author: "test@example.com",
          description: "LGTM",
          resolved: true,
        }),
        head,
      ],
      { cwd: dir, stdio: "ignore" },
    );
    const accepted = await git.reviews();
    expect(accepted.reviews[0]?.resolved).toBe(true);
    expect(accepted.reviews[0]?.needsReview).toBe(false);
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
    const worktree = added.find((item) => item.path === resolved);
    expect(worktree?.branch).toBe("wt");
    expect(worktree?.main).toBeTruthy();
    expect(worktree?.merged).toBe(true);

    writeFileSync(path.join(target, "c.ts"), "export const c = 1;\n");
    execSync("git add . && git commit -qm wt", { cwd: target, stdio: "ignore" });
    expect((await git.worktrees()).find((item) => item.path === resolved)?.merged).toBe(false);

    await git.removeWorktree(target);
    expect((await git.worktrees()).some((item) => item.path === resolved)).toBe(false);
  });

  it("reports branches and tags that differ from the remote", async () => {
    const dir = makeRepo();
    const remote = mkdtempSync(path.join(tmpdir(), "reins-remote-"));
    execSync("git init -q --bare", { cwd: remote });
    execSync(`git remote add origin ${remote}`, { cwd: dir });
    const branch = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync(`git push -q -u origin ${branch}`, { cwd: dir });
    execSync("git tag v1", { cwd: dir });
    execSync("git push -q origin v1", { cwd: dir });

    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add . && git commit -qm remote", { cwd: dir });
    const remoteHead = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    execSync(`git push -q origin ${branch}`, { cwd: dir });
    execSync(`git push -q -f origin ${remoteHead}:refs/tags/v1`, { cwd: dir });
    execSync("git reset -q --hard HEAD~1", { cwd: dir });

    const git = new GitAdapter(dir);
    const sync = await git.sync();
    expect(sync.remotes).toEqual(["origin"]);
    expect(sync.fetchedAt).toBeTruthy();
    expect(sync.refs).toContainEqual(
      expect.objectContaining({ kind: "branch", name: branch, state: "behind", behind: 1 }),
    );
    expect(sync.refs).toContainEqual(
      expect.objectContaining({ kind: "tag", name: "v1", state: "updated" }),
    );

    await git.rebase(branch);
    expect(execSync("git rev-parse HEAD", { cwd: dir }).toString().trim()).toBe(remoteHead);

    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");
    execSync("git add . && git commit -qm local", { cwd: dir, stdio: "ignore" });
    const localHead = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    await git.push(branch);
    expect(
      execSync(`git --git-dir=${remote} rev-parse refs/heads/${branch}`).toString().trim(),
    ).toBe(localHead);
  });

  it("compares a branch with the remote branch of the same name, not its upstream", async () => {
    const dir = makeRepo();
    const remote = mkdtempSync(path.join(tmpdir(), "reins-remote-"));
    execSync("git init -q --bare", { cwd: remote });
    execSync(`git remote add origin ${remote}`, { cwd: dir });
    const main = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync(`git push -q -u origin ${main}`, { cwd: dir });

    execSync("git checkout -qb feature", { cwd: dir, stdio: "ignore" });
    execSync("git push -q -u origin feature", { cwd: dir });
    execSync(`git branch --set-upstream-to=origin/${main} feature`, {
      cwd: dir,
      stdio: "ignore",
    });

    execSync(`git checkout -q ${main}`, { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add . && git commit -qm main", { cwd: dir, stdio: "ignore" });
    execSync(`git push -q origin ${main}`, { cwd: dir });
    execSync("git checkout -q feature", { cwd: dir, stdio: "ignore" });

    const git = new GitAdapter(dir);
    expect(
      (await git.sync()).refs.some((ref) => ref.kind === "branch" && ref.name === "feature"),
    ).toBe(false);

    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");
    execSync("git add . && git commit -qm feature", { cwd: dir, stdio: "ignore" });
    execSync("git push -q origin feature", { cwd: dir });
    execSync("git reset -q --hard HEAD~1", { cwd: dir });

    expect((await git.sync()).refs).toContainEqual(
      expect.objectContaining({
        kind: "branch",
        name: "feature",
        upstream: "origin/feature",
        state: "behind",
        behind: 1,
      }),
    );
  });

  it("does not warn about a local branch with no remote branch", async () => {
    const dir = makeRepo();
    const remote = mkdtempSync(path.join(tmpdir(), "reins-remote-"));
    execSync("git init -q --bare", { cwd: remote });
    execSync(`git remote add origin ${remote}`, { cwd: dir });
    const main = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync(`git push -q -u origin ${main}`, { cwd: dir });

    execSync("git checkout -qb solo", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add . && git commit -qm solo", { cwd: dir, stdio: "ignore" });

    const refs = (await new GitAdapter(dir).sync()).refs;
    expect(refs.some((ref) => ref.kind === "branch" && ref.name === "solo")).toBe(false);
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

  it("reports commit refs and merges a commit into a branch", async () => {
    const dir = makeRepo();
    const git = new GitAdapter(dir);
    const main = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync("git checkout -qb feature", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add . && git commit -qm feature", { cwd: dir, stdio: "ignore" });
    execSync("git tag v-feature", { cwd: dir, stdio: "ignore" });
    const featureHead = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();

    const refs = await git.commitRefs(featureHead);
    expect(refs.branches).toContain("feature");
    expect(refs.tags).toContain("v-feature");
    expect(refs.mergedInto).toContain("feature");
    expect(refs.mergedInto).not.toContain(main);
    expect(refs.defaultBranch).toBe(main);

    const result = await git.merge(featureHead, main);
    expect(result.status.branch).toBe(main);
    expect(result.status.clean).toBe(true);
    expect((await git.commitRefs(featureHead)).mergedInto).toContain(main);
  });

  it("refuses to merge with a dirty working tree", async () => {
    const dir = makeRepo();
    const git = new GitAdapter(dir);
    const main = execSync("git branch --show-current", { cwd: dir }).toString().trim();
    execSync("git checkout -qb feature", { cwd: dir, stdio: "ignore" });
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    execSync("git add . && git commit -qm feature", { cwd: dir, stdio: "ignore" });
    const featureHead = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n");

    await expect(git.merge(featureHead, main)).rejects.toMatchObject({ code: "GIT_DIRTY" });
  });
});
