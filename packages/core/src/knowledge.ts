import { z } from "zod";
import type { LinkRel, NodeLink, NodeStatus, NodeType } from "./types.js";

export const nodeTypes = ["spec", "decision", "constraint", "howto", "question"] as const;
export const nodeStatuses = [
  "proposed",
  "accepted",
  "superseded",
  "deprecated",
  "rejected",
] as const;
export const linkRels = [
  "implements",
  "refines",
  "constrains",
  "explains",
  "depends_on",
  "exposes",
  "affects",
  "relates_to",
] as const;

export const linkSchema = z
  .object({
    rel: z.enum(linkRels),
    node: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
    surface: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      [value.node, value.note, value.symbol, value.surface, value.commit, value.file].filter(
        Boolean,
      ).length === 1,
    { message: "A link must have exactly one target: node, symbol, surface, commit, or file." },
  );

export const constraintRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("forbidden-import"),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    kind: z.literal("forbidden-call"),
    caller: z.string().min(1),
    callee: z.string().min(1),
  }),
]);

const dateValue = z
  .union([z.string().min(1), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value));

export const nodeFrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  type: z.enum(nodeTypes),
  status: z.enum(nodeStatuses),
  created: dateValue,
  updated: dateValue,
  owner: z.string().optional(),
  tags: z.array(z.string().min(1).max(32)).max(12).default([]),
  links: z.array(linkSchema).max(50).default([]),
  commits: z.array(z.string().min(7)).max(50).default([]),
  supersedes: z.string().optional(),
  supersededBy: z.string().optional(),
  rule: constraintRuleSchema.optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  component: z.string().optional(),
  layer: z.string().optional(),
  boundary: z.boolean().optional(),
  code: z.string().optional(),
  source: z.enum(["reins", "openspec"]).optional(),
});

export type NodeFrontmatter = z.infer<typeof nodeFrontmatterSchema>;

export function nodeSlugFromTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base.length >= 2 ? base : "node";
}

export function linkTarget(link: NodeLink): { kind: string; value: string } {
  if ("node" in link) return { kind: "node", value: link.node };
  if ("note" in link) return { kind: "node", value: link.note };
  if ("symbol" in link) return { kind: "symbol", value: link.symbol };
  if ("surface" in link) return { kind: "surface", value: link.surface };
  if ("commit" in link) return { kind: "commit", value: link.commit };
  return { kind: "file", value: link.file };
}

export function isNodeLink(value: unknown): value is NodeLink {
  return linkSchema.safeParse(value).success;
}

export function isNodeType(value: string): value is NodeType {
  return (nodeTypes as readonly string[]).includes(value);
}

export function isNodeStatus(value: string): value is NodeStatus {
  return (nodeStatuses as readonly string[]).includes(value);
}

export function isLinkRel(value: string): value is LinkRel {
  return (linkRels as readonly string[]).includes(value);
}
