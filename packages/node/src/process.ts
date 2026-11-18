import { spawn } from "node:child_process";
import { ReinsError } from "@reins/core";

export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;

export function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...spec.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const max = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    };

    const onAbort = () => {
      kill();
      finish(() =>
        reject(new ReinsError("CANCELLED", `${spec.command} was cancelled.`, { retryable: true })),
      );
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, spec.timeoutMs);
    timer.unref();

    spec.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length + stderr.length > max) {
        kill();
        finish(() =>
          reject(
            new ReinsError("TRAIL_OUTPUT_LIMIT", `${spec.command} produced too much output.`, {
              details: { limit: max },
            }),
          ),
        );
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > max) {
        kill();
        finish(() =>
          reject(
            new ReinsError("TRAIL_OUTPUT_LIMIT", `${spec.command} produced too much output.`, {
              details: { limit: max },
            }),
          ),
        );
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() => {
        if (err.code === "ENOENT") {
          reject(
            new ReinsError(
              spec.command === "git" ? "GIT_MISSING" : "TRAIL_MISSING",
              `${spec.command} was not found on PATH.`,
              { details: { command: spec.command } },
            ),
          );
          return;
        }
        reject(new ReinsError("INTERNAL", err.message, { cause: err }));
      });
    });

    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(
            new ReinsError(
              "TRAIL_TIMEOUT",
              `${spec.command} timed out after ${spec.timeoutMs} ms.`,
              {
                retryable: true,
                details: { timeoutMs: spec.timeoutMs },
              },
            ),
          );
          return;
        }
        resolve({
          stdout,
          stderr,
          code: code ?? 1,
          durationMs: Date.now() - started,
        });
      });
    });
  });
}
