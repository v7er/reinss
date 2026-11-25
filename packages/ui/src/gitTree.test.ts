import type { GitGraphCommit } from "@reinss/core";
import { describe, expect, it } from "vitest";
import { layoutGitTree } from "./gitTree.js";

function commit(hash: string, parents: string[] = []): GitGraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    author: "Test",
    email: "test@example.com",
    date: "2026-01-01T00:00:00Z",
    subject: hash,
    refs: [],
  };
}

describe("layoutGitTree", () => {
  it("keeps a linear history in one lane", () => {
    const layout = layoutGitTree([commit("c", ["b"]), commit("b", ["a"]), commit("a")]);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.laneCount).toBe(1);
    expect(layout.edges).toHaveLength(2);
  });

  it("opens a second lane for a merge and closes it at the shared parent", () => {
    const layout = layoutGitTree([
      commit("a", ["b", "c"]),
      commit("b", ["d"]),
      commit("c", ["d"]),
      commit("d"),
    ]);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
    expect(layout.laneCount).toBe(2);
    expect(layout.edges).toEqual([
      { fromRow: 0, fromLane: 0, toRow: 1, toLane: 0 },
      { fromRow: 0, fromLane: 0, toRow: 2, toLane: 1 },
      { fromRow: 1, fromLane: 0, toRow: 3, toLane: 0 },
      { fromRow: 2, fromLane: 1, toRow: 3, toLane: 0 },
    ]);
  });

  it("draws a missing parent to the bottom of the visible range", () => {
    const layout = layoutGitTree([commit("a", ["missing"])]);
    expect(layout.edges[0]).toEqual({ fromRow: 0, fromLane: 0, toRow: 1, toLane: 0 });
  });
});
