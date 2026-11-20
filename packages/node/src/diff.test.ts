import { describe, expect, it } from "vitest";
import { diffFile } from "./diff.js";

const oldSource = `export function add(a: number, b: number) {
  return a + b;
}

export function total(values: number[]) {
  return values.reduce((sum, value) => add(sum, value), 0);
}
`;

describe("diffFile", () => {
  it("detects a pure rename", () => {
    const newSource = oldSource.replace("function total", "function sum");
    const file = diffFile({
      path: "src/a.ts",
      oldSource,
      newSource,
      status: "modified",
    });
    expect(file.changes).toHaveLength(1);
    expect(file.changes[0]?.kind).toBe("renamed");
    expect(file.changes[0]?.detail?.renamedFrom).toBe("total");
    expect(file.changes[0]?.detail?.renamedTo).toBe("sum");
  });

  it("detects a reformat-only change", () => {
    const newSource = oldSource.replace(/\n {2}/g, "\n    ");
    const file = diffFile({
      path: "src/a.ts",
      oldSource,
      newSource,
      status: "modified",
    });
    expect(file.changes.every((change) => change.kind === "reformatted")).toBe(true);
  });

  it("detects a modified body", () => {
    const newSource = oldSource.replace("return a + b;", "return a + b + 1;");
    const file = diffFile({
      path: "src/a.ts",
      oldSource,
      newSource,
      status: "modified",
    });
    expect(file.changes.some((change) => change.kind === "modified")).toBe(true);
  });

  it("detects added and removed declarations", () => {
    const newSource = `export function add(a: number, b: number) {
  return a + b;
}
`;
    const file = diffFile({
      path: "src/a.ts",
      oldSource,
      newSource,
      status: "modified",
    });
    expect(file.changes.some((change) => change.kind === "removed")).toBe(true);
  });

  it("degrades an unsupported language", () => {
    const file = diffFile({
      path: "src/a.py",
      oldSource: "def a():\n  pass\n",
      newSource: "def a():\n  return 1\n",
      status: "modified",
    });
    expect(file.degraded).toBe(true);
    expect(file.degradedReason).toBe("unsupported-language");
    expect(file.hunks).toHaveLength(1);
  });

  it("marks changed lines in hunks", () => {
    const newSource = oldSource.replace("return a + b;", "return a + b + 1;");
    const file = diffFile({
      path: "src/a.ts",
      oldSource,
      newSource,
      status: "modified",
    });
    const lines = file.hunks.flatMap((hunk) => hunk.lines);
    expect(
      lines.some((line) => line.kind === "removed" && line.text.includes("return a + b;")),
    ).toBe(true);
    expect(
      lines.some((line) => line.kind === "added" && line.text.includes("return a + b + 1;")),
    ).toBe(true);
  });

  it("marks every line of an added file", () => {
    const file = diffFile({
      path: "src/new.ts",
      oldSource: null,
      newSource: "export const a = 1;\nexport const b = 2;\n",
      status: "added",
    });
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0]?.lines.every((line) => line.kind === "added")).toBe(true);
    expect(file.hunks[0]?.newLines).toBe(2);
  });
});
