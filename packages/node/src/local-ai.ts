import { promises as fs } from "node:fs";
import { parseConfig, type ReinsConfig } from "@reinss/core";
import { resolveWithinRoot, writeAtomic } from "./paths.js";

export interface AiSettingsView {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  local: boolean;
}

export interface LocalAiProviderView {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
}

const LOCAL_CANDIDATES = [
  { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { id: "llamacpp", label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" },
  { id: "vllm", label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1" },
  { id: "textgen", label: "text-generation-webui", baseUrl: "http://127.0.0.1:5000/v1" },
];

export function isLocalEndpoint(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

export function aiKeysFromEnv(): { apiKey: string | null } {
  const apiKey = process.env.REINS_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? null;
  return { apiKey };
}

export function aiSettingsView(config: ReinsConfig): AiSettingsView {
  const { apiKey } = aiKeysFromEnv();
  return {
    enabled: config.llm.enabled,
    provider: config.llm.provider,
    model: config.llm.model,
    baseUrl: config.llm.baseUrl,
    hasApiKey: Boolean(apiKey),
    local: isLocalEndpoint(config.llm.baseUrl),
  };
}

export async function readConfigFile(root: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.readFile(resolveWithinRoot(root, ".reins/config.json"), "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveAiSettings(
  root: string,
  current: ReinsConfig,
  input: {
    enabled: boolean;
    provider?: string | null;
    model?: string | null;
    baseUrl?: string | null;
  },
): Promise<AiSettingsView> {
  const raw = (await readConfigFile(root)) ?? { version: 1 };
  const next = {
    ...raw,
    llm: {
      enabled: input.enabled,
      provider: input.provider ?? null,
      model: input.model ?? null,
      baseUrl: input.baseUrl ?? null,
    },
  };
  // Validate before writing so a bad URL or model never lands in the repo config.
  parseConfig(next);
  await writeAtomic(root, ".reins/config.json", `${JSON.stringify(next, null, 2)}\n`);
  return aiSettingsView({ ...current, llm: { ...current.llm, ...next.llm } } as ReinsConfig);
}

async function probeModels(baseUrl: string, label: string): Promise<LocalAiProviderView | null> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(700),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (payload.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!models.length) return null;
    return { id: baseUrl, label, baseUrl, models: models.slice(0, 100) };
  } catch {
    return null;
  }
}

export async function discoverLocalAi(): Promise<LocalAiProviderView[]> {
  const results = await Promise.all(
    LOCAL_CANDIDATES.map((candidate) => probeModels(candidate.baseUrl, candidate.label)),
  );
  return results.filter((item): item is LocalAiProviderView => item !== null);
}
