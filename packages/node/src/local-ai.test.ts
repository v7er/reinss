import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "@reinss/core";
import { describe, expect, it } from "vitest";
import { aiSettingsView, discoverLocalAi, isLocalEndpoint, saveAiSettings } from "./local-ai.js";

async function tempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "reins-ai-"));
}

describe("local AI settings", () => {
  it("detects loopback endpoints", () => {
    expect(isLocalEndpoint("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalEndpoint("http://localhost:1234/v1")).toBe(true);
    expect(isLocalEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isLocalEndpoint(null)).toBe(false);
    expect(isLocalEndpoint("not a url")).toBe(false);
  });

  it("saves llm settings without dropping other config keys", async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, ".reins"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".reins/config.json"),
      JSON.stringify({ version: 1, graftDir: "graft", ui: { theme: "dark" } }),
    );
    const view = await saveAiSettings(root, defaultConfig, {
      enabled: true,
      provider: "Ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    expect(view.enabled).toBe(true);
    expect(view.local).toBe(true);
    const raw = JSON.parse(
      await fs.readFile(path.join(root, ".reins/config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw.graftDir).toBe("graft");
    expect(raw.ui).toEqual({ theme: "dark" });
    expect(raw.llm).toMatchObject({
      enabled: true,
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
  });

  it("reports whether an API key is present", () => {
    const previous = process.env.REINS_LLM_API_KEY;
    const previousOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.REINS_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(aiSettingsView(defaultConfig).hasApiKey).toBe(false);
    process.env.REINS_LLM_API_KEY = "test";
    expect(aiSettingsView(defaultConfig).hasApiKey).toBe(true);
    if (previous) process.env.REINS_LLM_API_KEY = previous;
    else delete process.env.REINS_LLM_API_KEY;
    if (previousOpenAi) process.env.OPENAI_API_KEY = previousOpenAi;
  });

  it("returns no providers when nothing is listening", async () => {
    const providers = await discoverLocalAi();
    expect(Array.isArray(providers)).toBe(true);
  });
});
