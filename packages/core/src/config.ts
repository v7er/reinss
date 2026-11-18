import { z } from "zod";
import { ReinsError } from "./errors.js";

export const detectorIds = [
  "express",
  "hono",
  "commander",
  "next-app",
  "react-router",
  "fastapi",
  "openapi",
] as const;

export type DetectorId = (typeof detectorIds)[number];

export const configSchema = z.object({
  version: z.literal(1).default(1),
  graftDir: z.string().default("graft"),
  knowledgeDir: z.string().default(".reins/knowledge"),
  surfaces: z
    .object({
      detectors: z.array(z.enum(detectorIds)).default([...detectorIds]),
      ignore: z.array(z.string()).default([]),
    })
    .default({ detectors: [...detectorIds], ignore: [] }),
  ignore: z.array(z.string()).default([]),
  secretPatterns: z.array(z.string()).default([".env*", "*.pem", "*.key", "id_rsa", "id_ed25519"]),
  diff: z
    .object({
      maxFileBytes: z.number().int().positive().default(1_048_576),
      maxNodesPerFile: z.number().int().positive().default(20_000),
    })
    .default({ maxFileBytes: 1_048_576, maxNodesPerFile: 20_000 }),
  check: z
    .object({
      verifyCodeLinks: z.boolean().default(true),
      folderMismatch: z.enum(["error", "warning", "off"]).default("warning"),
    })
    .default({ verifyCodeLinks: true, folderMismatch: "warning" }),
  llm: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.string().nullable().default(null),
      model: z.string().nullable().default(null),
    })
    .default({ enabled: false, provider: null, model: null }),
  ui: z.object({ theme: z.enum(["light", "dark", "system"]).default("system") }).default({
    theme: "system",
  }),
});

export type ReinsConfig = z.infer<typeof configSchema>;

export const defaultConfig: ReinsConfig = configSchema.parse({});

export function parseConfig(raw: unknown): ReinsConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ReinsError("CONFIG_INVALID", "Invalid .reins/config.json", {
      details: {
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }
  return result.data;
}
