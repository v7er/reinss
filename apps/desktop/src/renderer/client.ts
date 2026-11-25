import type { ReinsApi, ReinsClient, ReinsEvent, RepoStatus } from "@reinss/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

export async function startupRepository(): Promise<string | null> {
  return invoke<string | null>("startup_repository");
}

export async function startupTool(): Promise<string | null> {
  return invoke<string | null>("startup_tool");
}

export async function startupTheme(): Promise<string | null> {
  return invoke<string | null>("startup_theme");
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
        const error = new Error(response.error?.message ?? "Reins request failed.");
        (error as Error & { code?: string }).code = response.error?.code;
        throw error;
      }
      return response.data as T;
    },
    subscribe(cb: (event: ReinsEvent) => void): () => void {
      let disposed = false;
      let unlisten: (() => void) | null = null;
      void listen<{ paths?: string[] }>("reins://change", (event) => {
        cb({ type: "graph-changed", payload: event.payload });
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}
