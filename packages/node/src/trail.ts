import { ReinsError } from "@reins/core";
import { z } from "zod";
import { runProcess } from "./process.js";

const symbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  span: z.string(),
});

const hitSchema = z.object({
  id: z.string(),
  relation: z.string(),
  depth: z.number(),
  name: z.string().optional(),
  kind: z.string().optional(),
  path: z.string().optional(),
  span: z.string().optional(),
});

const callersSchema = z.object({
  query: z.string(),
  matches: z.array(z.object({ symbol: symbolSchema, hits: z.array(hitSchema) })),
});

const askSchema = z.object({
  query: z.string(),
  hits: z.array(
    z.object({
      kind: z.string(),
      title: z.string(),
      pointer: z.string(),
      snippet: z.string(),
      score: z.number(),
    }),
  ),
});

const skeletonSchema = z.object({
  file: z.string(),
  entries: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      span: z.string(),
      signature: z.string(),
    }),
  ),
});

const statusSchema = z.object({
  codeMap: z
    .object({
      nodes: z.number().optional(),
      inSync: z.boolean().optional(),
    })
    .optional(),
});

const mapSymbolSchema = z.object({
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  span: z.string(),
  inDegree: z.number().optional(),
});

const mapSchema = z.object({
  hotspots: z.array(mapSymbolSchema).optional(),
  scopes: z
    .array(
      z.object({
        dirs: z
          .array(
            z.object({
              hubs: z.array(mapSymbolSchema).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type TrailStatus = { nodes: number; inSync: boolean };
export type TrailCallers = z.infer<typeof callersSchema>;
export type TrailAsk = z.infer<typeof askSchema>;
export type TrailSkeleton = z.infer<typeof skeletonSchema>;
export type TrailMapSymbol = z.infer<typeof mapSymbolSchema>;
export type TrailMap = { symbols: TrailMapSymbol[] };

export const MIN_TRAIL_VERSION = "0.28.0";

function parseVersion(output: string): string {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  if (!match) {
    throw new ReinsError(
      "TRAIL_VERSION_UNSUPPORTED",
      `Could not read Trail version from: ${output.trim()}`,
    );
  }
  return match[1] as string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class TrailAdapter {
  readonly root: string;
  readonly binary: string;
  private versionValue: string | null = null;

  constructor(root: string, binary = process.env.REINS_TRAIL_BIN ?? "trail") {
    this.root = root;
    this.binary = binary;
  }

  async version(): Promise<string> {
    if (this.versionValue) return this.versionValue;
    const result = await runProcess({
      command: this.binary,
      args: ["--version"],
      cwd: this.root,
      timeoutMs: 5000,
    });
    if (result.code !== 0) {
      throw new ReinsError("TRAIL_MISSING", `Trail is not available: ${result.stderr.trim()}`);
    }
    const version = parseVersion(result.stdout || result.stderr);
    if (compareVersions(version, MIN_TRAIL_VERSION) < 0) {
      throw new ReinsError(
        "TRAIL_VERSION_UNSUPPORTED",
        `Trail ${version} is older than the supported minimum ${MIN_TRAIL_VERSION}.`,
        { details: { version, minVersion: MIN_TRAIL_VERSION } },
      );
    }
    this.versionValue = version;
    return version;
  }

  async status(): Promise<TrailStatus> {
    const result = await runProcess({
      command: this.binary,
      args: ["status", this.root, "--json"],
      cwd: this.root,
      timeoutMs: 10_000,
    });
    if (result.code !== 0) {
      throw new ReinsError(
        "TRAIL_FAILED",
        `Trail status failed: ${result.stderr.trim().slice(-500)}`,
        {
          retryable: true,
          details: { code: result.code },
        },
      );
    }
    const parsed = statusSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) {
      throw new ReinsError(
        "TRAIL_FORMAT_UNSUPPORTED",
        "Trail status JSON did not match the adapter schema.",
        {
          details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
        },
      );
    }
    return {
      nodes: parsed.data.codeMap?.nodes ?? 0,
      inSync: parsed.data.codeMap?.inSync ?? false,
    };
  }

  async build(): Promise<void> {
    const result = await runProcess({
      command: this.binary,
      args: ["build", this.root],
      cwd: this.root,
      timeoutMs: 120_000,
    });
    if (result.code !== 0) {
      throw new ReinsError(
        "TRAIL_FAILED",
        `Trail build failed: ${result.stderr.trim().slice(-1000)}`,
        {
          retryable: true,
          details: { code: result.code },
        },
      );
    }
  }

  async callers(input: {
    symbol: string;
    direction: "in" | "out";
    depth: number;
    pathPrefix?: string;
  }): Promise<TrailCallers> {
    const hash = input.symbol.lastIndexOf("#");
    const file = hash >= 0 ? input.symbol.slice(0, hash) : null;
    const query = hash >= 0 ? input.symbol.slice(hash + 1) : input.symbol;
    const args = [
      "callers",
      query,
      this.root,
      "--json",
      "--direction",
      input.direction,
      "--depth",
      String(input.depth),
      "--no-refresh",
    ];
    // A bare name matches the first symbol with that name. Scope to the symbol's file
    // so two components both named Page do not resolve to the same root.
    const scope = file ?? input.pathPrefix;
    if (scope) args.push("--in", scope);
    const result = await runProcess({
      command: this.binary,
      args,
      cwd: this.root,
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      if (/no match|not found|no symbol/i.test(message)) {
        throw new ReinsError("SYMBOL_NOT_FOUND", `No symbol matched "${input.symbol}".`, {
          details: { query: input.symbol },
        });
      }
      throw new ReinsError("TRAIL_FAILED", `Trail callers failed: ${message.slice(-500)}`, {
        retryable: true,
        details: { code: result.code },
      });
    }
    const parsed = callersSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) {
      throw new ReinsError(
        "TRAIL_FORMAT_UNSUPPORTED",
        "Trail callers JSON did not match the adapter schema.",
        {
          details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
        },
      );
    }
    return parsed.data;
  }

  async ask(query: string, limit: number): Promise<TrailAsk> {
    const result = await runProcess({
      command: this.binary,
      args: ["ask", query, this.root, "--json", "--limit", String(limit), "--no-refresh"],
      cwd: this.root,
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      throw new ReinsError(
        "TRAIL_FAILED",
        `Trail ask failed: ${result.stderr.trim().slice(-500)}`,
        {
          retryable: true,
          details: { code: result.code },
        },
      );
    }
    const parsed = askSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) {
      throw new ReinsError(
        "TRAIL_FORMAT_UNSUPPORTED",
        "Trail ask JSON did not match the adapter schema.",
        {
          details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
        },
      );
    }
    return parsed.data;
  }

  async skeleton(file: string): Promise<TrailSkeleton> {
    const result = await runProcess({
      command: this.binary,
      args: ["skeleton", file, this.root, "--json", "--no-refresh"],
      cwd: this.root,
      timeoutMs: 10_000,
    });
    if (result.code !== 0) {
      throw new ReinsError(
        "TRAIL_FAILED",
        `Trail skeleton failed: ${result.stderr.trim().slice(-500)}`,
        {
          retryable: true,
          details: { code: result.code },
        },
      );
    }
    const parsed = skeletonSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) {
      throw new ReinsError(
        "TRAIL_FORMAT_UNSUPPORTED",
        "Trail skeleton JSON did not match the adapter schema.",
        {
          details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
        },
      );
    }
    return parsed.data;
  }

  async map(): Promise<TrailMap> {
    const result = await runProcess({
      command: this.binary,
      args: ["map", this.root, "--json", "--no-refresh"],
      cwd: this.root,
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      throw new ReinsError(
        "TRAIL_FAILED",
        `Trail map failed: ${result.stderr.trim().slice(-500)}`,
        {
          retryable: true,
          details: { code: result.code },
        },
      );
    }
    const parsed = mapSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) {
      throw new ReinsError(
        "TRAIL_FORMAT_UNSUPPORTED",
        "Trail map JSON did not match the adapter schema.",
        {
          details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
        },
      );
    }
    const seen = new Set<string>();
    const symbols: TrailMapSymbol[] = [];
    const hubs = (parsed.data.scopes ?? []).flatMap((scope) =>
      (scope.dirs ?? []).flatMap((dir) => dir.hubs ?? []),
    );
    for (const symbol of [...(parsed.data.hotspots ?? []), ...hubs]) {
      const key = `${symbol.path}#${symbol.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push(symbol);
    }
    return { symbols };
  }
}
