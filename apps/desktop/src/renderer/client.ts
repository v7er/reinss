import type { ReinsApi, ReinsClient, RepoStatus } from "@reins/core";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ApiEnvelope<T> {
  contractVersion: 1;
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable?: boolean };
}

export async function openRepository(path?: string): Promise<ApiEnvelope<RepoStatus> | null> {
  let root = path;
  if (!root) {
    const selected = await open({ directory: true, multiple: false, title: "Open repository" });
    if (!selected || Array.isArray(selected)) return null;
    root = selected;
  }
  try {
    return await invoke<ApiEnvelope<RepoStatus>>("open_repository", { path: root });
  } catch (err) {
    return {
      contractVersion: 1,
      ok: false,
      error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function closeRepository(): Promise<void> {
  await invoke("close_repository");
}

export async function revealInEditor(path: string, line?: number): Promise<void> {
  await invoke("reveal_in_editor", { path, line: line ?? 1 });
}

export function createTauriClient(): ReinsClient {
  return {
    kind: "tauri",
    async call<T>(method: keyof ReinsApi, params?: unknown): Promise<T> {
      const response = await invoke<ApiEnvelope<T>>("reins_invoke", { method, params });
      if (!response.ok) {
        throw new Error(response.error?.message ?? "Reins request failed.");
      }
      return response.data as T;
    },
  };
}
