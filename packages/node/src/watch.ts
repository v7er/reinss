import { type FSWatcher, watch } from "node:fs";

export interface RepoWatcher {
  close(): void;
}

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  "graft",
  "dist",
  "out",
  "build",
  "target",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".trail",
  ".cargo-target",
  ".cargo-home",
  ".swift-cache",
]);

function isIgnored(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  if (normalized === ".git/index" || normalized === ".git/HEAD") return false;
  if (normalized.startsWith(".git/refs/")) return false;
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  if (normalized.startsWith(".reins/.cache/")) return true;
  const segments = normalized.split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return true;
  const name = segments[segments.length - 1] ?? "";
  return (
    name === ".DS_Store" || name.endsWith(".tmp") || name.endsWith(".swp") || name.endsWith("~")
  );
}

export function watchRepo(
  root: string,
  onChange: (paths: string[]) => void,
  debounceMs = 120,
): RepoWatcher {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const relative = filename.toString();
      if (isIgnored(relative)) return;
      pending.add(relative);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const paths = [...pending];
        pending.clear();
        onChange(paths);
      }, debounceMs);
      timer.unref();
    });
  } catch {
    // Recursive watch is unavailable on this platform; live refresh stays off.
    return { close() {} };
  }
  watcher.on("error", () => {});
  return {
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
      watcher.close();
    },
  };
}
