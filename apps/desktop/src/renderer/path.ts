/** Keep the tail of a path so the repo folder stays visible when space is tight. */
export function tailPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  let tail = "";
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const next = `${sep}${parts[i]}${tail}`;
    if (next.length + 1 > max) break;
    tail = next;
  }
  return `…${tail || path.slice(-(max - 1))}`;
}
