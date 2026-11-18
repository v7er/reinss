import { promises as fs } from "node:fs";
import path from "node:path";
import { ReinsError } from "@reins/core";

export function resolveWithinRoot(root: string, relative: string): string {
  if (path.isAbsolute(relative)) {
    throw new ReinsError("PATH_ESCAPE", `Absolute path is not allowed: ${relative}`);
  }
  const normalized = path.normalize(relative);
  if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
    throw new ReinsError("PATH_ESCAPE", `Path escapes the repository: ${relative}`);
  }
  const resolved = path.resolve(root, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new ReinsError("PATH_ESCAPE", `Path escapes the repository: ${relative}`);
  }
  return resolved;
}

export async function readText(root: string, relative: string): Promise<string> {
  return fs.readFile(resolveWithinRoot(root, relative), "utf8");
}

export async function writeAtomic(root: string, relative: string, text: string): Promise<void> {
  const target = resolveWithinRoot(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, text, "utf8");
  await fs.rename(temp, target);
}

export async function exists(root: string, relative: string): Promise<boolean> {
  try {
    await fs.access(resolveWithinRoot(root, relative));
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(root: string, relative: string): Promise<T | null> {
  try {
    return JSON.parse(await readText(root, relative)) as T;
  } catch {
    return null;
  }
}

export async function ensureDir(root: string, relative: string): Promise<void> {
  await fs.mkdir(resolveWithinRoot(root, relative), { recursive: true });
}

export async function realRoot(input: string): Promise<string> {
  try {
    const resolved = await fs.realpath(input);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new ReinsError("REPO_NOT_FOUND", `Not a directory: ${input}`);
    }
    return resolved;
  } catch (err) {
    if (err instanceof ReinsError) throw err;
    throw new ReinsError("REPO_NOT_FOUND", `Repository not found: ${input}`, { cause: err });
  }
}
