import type { GitGraphCommit } from "@reinss/core";

export interface GitTreeRow {
  commit: GitGraphCommit;
  row: number;
  lane: number;
}

export interface GitTreeEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
}

export interface GitTreeLayout {
  rows: GitTreeRow[];
  edges: GitTreeEdge[];
  laneCount: number;
}

export function layoutGitTree(commits: GitGraphCommit[]): GitTreeLayout {
  const lanes: Array<string | null> = [];
  const rows: GitTreeRow[] = [];
  const rowByHash = new Map<string, GitTreeRow>();

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    const row = rows.length;
    const entry = { commit, row, lane };
    rows.push(entry);
    rowByHash.set(commit.hash, entry);
    lanes[lane] = null;

    const [first, ...rest] = commit.parents;
    if (first) {
      if (!lanes.includes(first)) lanes[lane] = first;
    }
    for (const parent of rest) {
      if (lanes.includes(parent)) continue;
      let slot = lanes.indexOf(null);
      if (slot === -1) {
        slot = lanes.length;
        lanes.push(null);
      }
      lanes[slot] = parent;
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  }

  const edges: GitTreeEdge[] = [];
  for (const row of rows) {
    for (const parent of row.commit.parents) {
      const target = rowByHash.get(parent);
      edges.push({
        fromRow: row.row,
        fromLane: row.lane,
        toRow: target?.row ?? rows.length,
        toLane: target?.lane ?? row.lane,
      });
    }
  }

  const laneCount = Math.max(
    1,
    ...rows.map((row) => row.lane + 1),
    ...edges.map((edge) => Math.max(edge.fromLane, edge.toLane) + 1),
  );
  return { rows, edges, laneCount };
}
