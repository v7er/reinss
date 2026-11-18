import type { ChangeKind, FileDiff, SemanticChange, SemanticDiff } from "./types.js";

export const changeKinds: ChangeKind[] = [
  "added",
  "removed",
  "modified",
  "moved",
  "renamed",
  "reformatted",
  "extracted",
  "inlined",
  "reordered",
];

export function emptyStats(): Record<ChangeKind, number> {
  return Object.fromEntries(changeKinds.map((kind) => [kind, 0])) as Record<ChangeKind, number>;
}

export function sortChanges(changes: SemanticChange[]): SemanticChange[] {
  return [...changes].sort((a, b) => {
    const aLine = a.from?.startLine ?? a.to?.startLine ?? 0;
    const bLine = b.from?.startLine ?? b.to?.startLine ?? 0;
    return aLine - bLine || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
  });
}

export function finalizeFileDiff(file: FileDiff): FileDiff {
  const changes = sortChanges(file.changes);
  const stats = emptyStats();
  for (const change of changes) stats[change.kind] += 1;
  return { ...file, changes, stats };
}

export function finalizeDiff(diff: SemanticDiff): SemanticDiff {
  return { ...diff, files: [...diff.files].sort((a, b) => a.path.localeCompare(b.path)) };
}

export function changeId(input: {
  path: string;
  kind: ChangeKind;
  fromPath?: string | null;
  fromStart?: number | null;
  toPath?: string | null;
  toStart?: number | null;
  name: string;
}): string {
  const text = [
    input.path,
    input.kind,
    input.fromPath ?? "",
    String(input.fromStart ?? ""),
    input.toPath ?? "",
    String(input.toStart ?? ""),
    input.name,
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
