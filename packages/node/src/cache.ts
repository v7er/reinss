import { promises as fs } from "node:fs";
import { resolveWithinRoot } from "./paths.js";

export interface CacheEnvelope<T> {
  schemaVersion: 1;
  adapterVersion: string;
  createdAt: string;
  fingerprint: string;
  data: T;
}

export async function readCache<T>(root: string, file: string): Promise<CacheEnvelope<T> | null> {
  try {
    const text = await fs.readFile(resolveWithinRoot(root, file), "utf8");
    const parsed = JSON.parse(text) as CacheEnvelope<T>;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCache<T>(
  root: string,
  file: string,
  fingerprint: string,
  data: T,
): Promise<void> {
  const target = resolveWithinRoot(root, file);
  await fs.mkdir(target.replace(/\/[^/]+$/, ""), { recursive: true });
  const envelope: CacheEnvelope<T> = {
    schemaVersion: 1,
    adapterVersion: "0.1.0",
    createdAt: new Date().toISOString(),
    fingerprint,
    data,
  };
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(envelope), "utf8");
  await fs.rename(temp, target);
}
