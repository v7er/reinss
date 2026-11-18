import { z } from "zod";
import type { LinkRel, NoteLink, NoteStatus, NoteType } from "./types.js";

export const noteTypes = ["spec", "decision", "constraint", "howto", "question"] as const;
export const noteStatuses = [
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
    note: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
    surface: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      [value.note, value.symbol, value.surface, value.commit, value.file].filter(Boolean).length ===
      1,
    { message: "A link must have exactly one target: note, symbol, surface, commit, or file." },
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

export const noteFrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  type: z.enum(noteTypes),
  status: z.enum(noteStatuses),
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
});

export type NoteFrontmatter = z.infer<typeof noteFrontmatterSchema>;

export function folderForType(type: NoteType): string {
  return type === "howto" ? "howto" : `${type}s`;
}

export function noteIdFromTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base.length >= 2 ? base : "note";
}

export function linkTarget(link: NoteLink): { kind: string; value: string } {
  if ("note" in link) return { kind: "note", value: link.note };
  if ("symbol" in link) return { kind: "symbol", value: link.symbol };
  if ("surface" in link) return { kind: "surface", value: link.surface };
  if ("commit" in link) return { kind: "commit", value: link.commit };
  return { kind: "file", value: link.file };
}

export function isNoteLink(value: unknown): value is NoteLink {
  return linkSchema.safeParse(value).success;
}

export function isNoteType(value: string): value is NoteType {
  return (noteTypes as readonly string[]).includes(value);
}

export function isNoteStatus(value: string): value is NoteStatus {
  return (noteStatuses as readonly string[]).includes(value);
}

export function isLinkRel(value: string): value is LinkRel {
  return (linkRels as readonly string[]).includes(value);
}
