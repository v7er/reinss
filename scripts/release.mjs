#!/usr/bin/env node
/**
 * Bump and publish the public workspace packages only.
 *
 *   node scripts/release.mjs plan
 *   node scripts/release.mjs bump [patch|minor|major] [--dry-run]
 *   node scripts/release.mjs publish [--dry-run] [--tag next] [--allow-dirty] [--no-auth-check]
 *
 * Private packages (`private: true`) are skipped. No git tag, no commit, no login.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://registry.npmjs.org";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    env: process.env,
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function discover() {
  const dirs = ["packages", "apps"].flatMap((group) => {
    const base = join(root, group);
    if (!existsSync(base)) return [];
    return readdirSync(base);
  });
  const packages = [];
  for (const name of dirs.sort()) {
    const manifest = ["packages", "apps"]
      .map((group) => join(root, group, name, "package.json"))
      .find((file) => existsSync(file));
    if (!manifest) continue;
    const json = readJson(manifest);
    if (!json.name || json.private === true) continue;
    packages.push({
      name: json.name,
      version: json.version,
      dir: dirname(manifest),
      dependencies: Object.keys(json.dependencies ?? {}).filter((dep) => dep.startsWith("@reinss/")),
    });
  }
  // Topological order: a package is published after its public dependencies.
  const ordered = [];
  const visiting = new Set();
  const visit = (pkg) => {
    if (ordered.includes(pkg) || visiting.has(pkg.name)) return;
    visiting.add(pkg.name);
    for (const dep of pkg.dependencies) {
      const found = packages.find((candidate) => candidate.name === dep);
      if (found) visit(found);
    }
    visiting.delete(pkg.name);
    ordered.push(pkg);
  };
  for (const pkg of packages) visit(pkg);
  return ordered;
}

function nextVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!match) throw new Error(`Unsupported version: ${version}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else if (kind === "patch") {
    patch += 1;
  } else {
    throw new Error(`Unknown bump kind "${kind}". Use patch, minor, or major.`);
  }
  return `${major}.${minor}.${patch}`;
}

function gitClean() {
  try {
    return run("git", ["status", "--porcelain"], { capture: true }).trim() === "";
  } catch {
    return false;
  }
}

function gitHead() {
  try {
    return run("git", ["rev-parse", "--short", "HEAD"], { capture: true }).trim();
  } catch {
    return null;
  }
}

function plan() {
  const packages = discover();
  if (!packages.length) {
    console.error("No public packages found.");
    process.exit(1);
  }
  console.log("Publish plan (private packages excluded):");
  for (const pkg of packages) {
    console.log(`  ${pkg.name}@${pkg.version}  ${pkg.dir.replace(`${root}/`, "")}`);
  }
  console.log(`\nOrder: ${packages.map((pkg) => pkg.name).join(" -> ")}`);
  console.log("Registry: https://registry.npmjs.org");
}

function bump(kind, options) {
  const packages = discover();
  let changed = 0;
  for (const pkg of packages) {
    const file = join(pkg.dir, "package.json");
    const json = readJson(file);
    const next = nextVersion(json.version, kind);
    console.log(`${json.name}: ${json.version} -> ${next}`);
    if (!options.dryRun) {
      json.version = next;
      writeJson(file, json);
    }
    changed += 1;
  }
  if (!changed) {
    console.error("No public packages to bump.");
    process.exit(1);
  }
  if (options.dryRun) {
    console.log("\nDry run: no file changed.");
    return;
  }
  console.log("\nBumped. Next: review, commit, then publish:");
  console.log("  git add packages/*/package.json apps/cli/package.json");
  console.log('  git commit -m "release: v<version>"');
  console.log("  pnpm publish:all");
}

function authCheck() {
  const result = spawnSync("npm", ["whoami", `--registry=${registry}`], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) {
    console.error("Not logged in to npm. Run `npm login` first, then retry.");
    console.error((result.stderr || result.stdout || "").trim());
    process.exit(2);
  }
  console.log(`npm user: ${result.stdout.trim()}`);
}

function build(packages) {
  for (const pkg of packages) {
    const manifest = readJson(join(pkg.dir, "package.json"));
    if (!manifest.scripts?.build) continue;
    const label = pkg.name;
    process.stdout.write(`building ${label}… `);
    run("pnpm", ["--filter", label, "build"]);
    console.log("ok");
  }
}

function publish(options) {
  const packages = discover();
  if (!packages.length) {
    console.error("No public packages found.");
    process.exit(1);
  }
  if (!options.dryRun && !options.noAuthCheck) authCheck();
  if (!gitClean() && !options.allowDirty) {
    console.error("Working tree is not clean. Commit or stash first, or pass --allow-dirty.");
    process.exit(2);
  }
  if (!options.dryRun) {
    build(packages);
    for (const pkg of packages) {
      const manifest = readJson(join(pkg.dir, "package.json"));
      if (manifest.version !== pkg.version) {
        console.error(`Version changed while building: ${pkg.name}. Re-run the command.`);
        process.exit(2);
      }
    }
  }
  const tag = options.tag ?? "latest";
  for (const pkg of packages) {
    const args = ["--filter", pkg.name, "publish", "--access", "public", "--no-git-checks"];
    if (tag !== "latest") args.push("--tag", tag);
    if (options.dryRun) args.push("--dry-run");
    console.log(`\n${options.dryRun ? "dry-run " : ""}publishing ${pkg.name}@${pkg.version} (${tag})`);
    run("pnpm", args);
  }
  console.log("\nDone. Verify:");
  for (const pkg of packages) {
    console.log(`  npm view ${pkg.name}@${pkg.version} version --registry=${registry}`);
  }
  const head = gitHead();
  console.log(`\nSource: ${head ?? "unknown"}. Tag the release if you want a record.`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { dryRun: false, allowDirty: false, noAuthCheck: false, tag: "latest" };
  let kind = "patch";
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg === "--no-auth-check") options.noAuthCheck = true;
    else if (arg === "--tag") options.tag = rest[++index] ?? "latest";
    else if (!arg.startsWith("-")) kind = arg;
    else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return { command, kind, options };
}

const { command, kind, options } = parseArgs(process.argv.slice(2));
try {
  if (command === "plan") plan();
  else if (command === "bump") bump(kind, options);
  else if (command === "publish") publish(options);
  else {
    console.log(`Usage:
  node scripts/release.mjs plan
  node scripts/release.mjs bump [patch|minor|major] [--dry-run]
  node scripts/release.mjs publish [--dry-run] [--tag <tag>] [--allow-dirty] [--no-auth-check]`);
    process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
