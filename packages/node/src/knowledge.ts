import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type CheckItem,
  folderForType,
  type KnowledgeNote,
  linkTarget,
  type NoteLink,
  type NoteProposal,
  type NoteProposalResult,
  type NoteSummary,
  type NoteType,
  noteFrontmatterSchema,
  noteIdFromTitle,
  ReinsError,
} from "@reins/core";
import { createTwoFilesPatch } from "diff";
import fg from "fast-glob";
import matter from "gray-matter";
import { resolveWithinRoot, writeAtomic } from "./paths.js";

export interface LoadedKnowledge {
  notes: KnowledgeNote[];
  byId: Map<string, KnowledgeNote>;
  backlinks: Map<string, string[]>;
  errors: CheckItem[];
  hash: string;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function extractMentions(body: string): string[] {
  const mentions = new Set<string>();
  for (const match of body.matchAll(/\[\[([a-z0-9][a-z0-9-]{1,63})\]\]/g)) {
    if (match[1]) mentions.add(match[1]);
  }
  return [...mentions];
}

function normalizeLinks(value: unknown): NoteLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter((link): link is NoteLink => {
    if (!link || typeof link !== "object") return false;
    const record = link as Record<string, unknown>;
    return typeof record.rel === "string";
  });
}

function parseNote(input: {
  id: string;
  file: string;
  text: string;
  source: "reins" | "spec-kit";
}): { note: KnowledgeNote | null; error: CheckItem | null } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(input.text);
  } catch (err) {
    return {
      note: null,
      error: {
        code: "NOTE_INVALID",
        severity: "error",
        message: `Could not parse frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        path: input.file,
      },
    };
  }
  const result = noteFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return {
      note: null,
      error: {
        code: "NOTE_INVALID",
        severity: "error",
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        path: input.file,
      },
    };
  }
  const data = result.data;
  const links = normalizeLinks(data.links);
  const note: KnowledgeNote = {
    id: input.id,
    title: data.title,
    type: data.type,
    status: data.status,
    tags: data.tags,
    updated: data.updated,
    path: input.file,
    linkCount: links.length,
    backlinkCount: 0,
    source: input.source,
    body: parsed.content.trim(),
    links,
    commits: data.commits,
    mentions: extractMentions(parsed.content),
    frontmatter: parsed.data as Record<string, unknown>,
  };
  return { note, error: null };
}

async function specKitNotes(
  root: string,
): Promise<Array<{ id: string; file: string; text: string; type: NoteType; updated: string }>> {
  const results: Array<{
    id: string;
    file: string;
    text: string;
    type: NoteType;
    updated: string;
  }> = [];
  const constitution = ".specify/memory/constitution.md";
  try {
    const text = await fs.readFile(resolveWithinRoot(root, constitution), "utf8");
    const stat = await fs.stat(resolveWithinRoot(root, constitution));
    results.push({
      id: "spec-kit-constitution",
      file: constitution,
      text,
      type: "constraint",
      updated: stat.mtime.toISOString().slice(0, 10),
    });
  } catch {
    // no spec-kit constitution
  }
  const files = await fg(["specs/**/spec.md", "specs/**/plan.md", "specs/**/tasks.md"], {
    cwd: root,
    onlyFiles: true,
    ignore: ["**/node_modules/**"],
  });
  for (const file of files) {
    const text = await fs.readFile(resolveWithinRoot(root, file), "utf8");
    const stat = await fs.stat(resolveWithinRoot(root, file));
    const type: NoteType = file.endsWith("spec.md")
      ? "spec"
      : file.endsWith("plan.md")
        ? "decision"
        : "howto";
    const slug = file
      .replace(/^specs\//, "")
      .replace(/\.md$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();
    results.push({
      id: `spec-kit-${slug}`,
      file,
      text,
      type,
      updated: stat.mtime.toISOString().slice(0, 10),
    });
  }
  return results;
}

function specKitToNote(input: {
  id: string;
  file: string;
  text: string;
  type: NoteType;
  updated: string;
}): KnowledgeNote {
  const titleMatch = /^#\s+(.+)$/m.exec(input.text);
  const title = titleMatch?.[1]?.trim() ?? input.id;
  return {
    id: input.id,
    title: title.slice(0, 120),
    type: input.type,
    status: "accepted",
    tags: ["spec-kit"],
    updated: input.updated,
    path: input.file,
    linkCount: 0,
    backlinkCount: 0,
    source: "spec-kit",
    body: input.text.trim(),
    links: [],
    commits: [],
    mentions: [],
    frontmatter: { source: "spec-kit", type: input.type },
  };
}

export async function loadKnowledge(root: string, knowledgeDir: string): Promise<LoadedKnowledge> {
  const notes: KnowledgeNote[] = [];
  const errors: CheckItem[] = [];
  const byId = new Map<string, KnowledgeNote>();
  const files = await fg([`${knowledgeDir}/**/*.md`], {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**"],
  });

  for (const file of files) {
    const text = await fs.readFile(resolveWithinRoot(root, file), "utf8");
    const id = path.basename(file, ".md");
    const parsed = parseNote({ id, file, text, source: "reins" });
    if (parsed.error) {
      errors.push(parsed.error);
      continue;
    }
    if (!parsed.note) continue;
    if (byId.has(id)) {
      errors.push({
        code: "NOTE_DUPLICATE_ID",
        severity: "error",
        message: `Duplicate note id "${id}".`,
        noteId: id,
        path: file,
      });
      continue;
    }
    byId.set(id, parsed.note);
    notes.push(parsed.note);
  }

  for (const specNote of await specKitNotes(root)) {
    if (byId.has(specNote.id)) continue;
    const note = specKitToNote(specNote);
    byId.set(note.id, note);
    notes.push(note);
  }

  const backlinks = new Map<string, string[]>();
  for (const note of notes) {
    for (const link of note.links) {
      const target = linkTarget(link);
      if (target.kind === "note") {
        const list = backlinks.get(target.value) ?? [];
        list.push(note.id);
        backlinks.set(target.value, list);
      }
    }
    for (const mention of note.mentions) {
      const list = backlinks.get(mention) ?? [];
      list.push(note.id);
      backlinks.set(mention, list);
    }
  }
  for (const note of notes) {
    note.backlinkCount = backlinks.get(note.id)?.length ?? 0;
  }

  const hash = hashText(notes.map((note) => `${note.id}:${note.updated}:${note.body}`).join("\n"));
  return { notes, byId, backlinks, errors, hash };
}

export function noteSummary(note: KnowledgeNote): NoteSummary {
  const {
    body: _body,
    links: _links,
    commits: _commits,
    mentions: _mentions,
    frontmatter: _fm,
    ...summary
  } = note;
  return summary;
}

export async function proposeNote(
  root: string,
  knowledgeDir: string,
  input: NoteProposal,
  existing: LoadedKnowledge,
): Promise<NoteProposalResult> {
  const baseId = noteIdFromTitle(input.title);
  let id = baseId;
  let suffix = 2;
  while (existing.byId.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  const file = `${knowledgeDir}/inbox/${id}.md`;
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = {
    title: input.title,
    type: input.type,
    status: "proposed",
    created: today,
    updated: today,
    tags: input.tags ?? [],
    links: input.links ?? [],
    commits: [],
    provenance: input.source ?? { kind: "manual" },
  };
  const text = matter.stringify(`${input.body.trim()}\n`, frontmatter);
  const target = resolveWithinRoot(root, file);
  try {
    await fs.access(target);
    throw new ReinsError("NOTE_EXISTS", `Note already exists: ${file}`);
  } catch {
    // expected: file does not exist
  }
  await writeAtomic(root, file, text);
  const diff = createTwoFilesPatch(`a/${file}`, `b/${file}`, "", text, "new note", "proposed");
  const warnings: string[] = [];
  for (const link of input.links ?? []) {
    const targetValue = linkTarget(link);
    if (targetValue.kind === "note" && !existing.byId.has(targetValue.value)) {
      warnings.push(`Unknown note link: ${targetValue.value}`);
    }
  }
  return { id, path: file, status: "proposed", diff, warnings };
}

export function folderMismatch(note: KnowledgeNote, knowledgeDir: string): boolean {
  if (note.source === "spec-kit") return false;
  const expected = `${knowledgeDir}/${folderForType(note.type)}/`;
  return !note.path.startsWith(expected) && !note.path.startsWith(`${knowledgeDir}/inbox/`);
}
