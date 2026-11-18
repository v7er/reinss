export type ErrorCode =
  | "REPO_NOT_FOUND"
  | "REPO_NOT_OPEN"
  | "INVALID_INPUT"
  | "EDITOR_UNAVAILABLE"
  | "PATH_ESCAPE"
  | "CONFIG_INVALID"
  | "TRAIL_MISSING"
  | "TRAIL_VERSION_UNSUPPORTED"
  | "TRAIL_MISSING_GRAFT"
  | "TRAIL_FAILED"
  | "TRAIL_FORMAT_UNSUPPORTED"
  | "TRAIL_TIMEOUT"
  | "TRAIL_OUTPUT_LIMIT"
  | "GIT_MISSING"
  | "GIT_FAILED"
  | "GIT_RANGE_INVALID"
  | "SYMBOL_NOT_FOUND"
  | "AMBIGUOUS_SYMBOL"
  | "SURFACE_NOT_FOUND"
  | "GRAPH_TRUNCATED"
  | "DIFF_PARSE_FAILED"
  | "DIFF_WORKER_FAILED"
  | "DIFF_TOO_LARGE"
  | "NOTE_INVALID"
  | "NOTE_EXISTS"
  | "KNOWLEDGE_UNAVAILABLE"
  | "BUILD_IN_PROGRESS"
  | "CANCELLED"
  | "INTERNAL";

export class ReinsError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "ReinsError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

export function isReinsError(value: unknown): value is ReinsError {
  return value instanceof ReinsError;
}

export function toReinsError(value: unknown): ReinsError {
  if (isReinsError(value)) return value;
  if (value instanceof Error) {
    return new ReinsError("INTERNAL", value.message, { cause: value });
  }
  return new ReinsError("INTERNAL", String(value));
}
