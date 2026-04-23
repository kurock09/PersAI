import pino, { Logger } from "pino";
import { RequestLogEntry } from "@persai/types";

export function createAppLogger(logLevel: string): Logger {
  return pino({
    level: logLevel,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export function logRequestCompleted(logger: Logger, entry: RequestLogEntry): void {
  logger.info(entry, "request_completed");
}

export interface NormalizedErrorLogPayload {
  msg: string;
  err?: {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  trace?: string;
}

// ADR-074 F1 (background-task hygiene): Nest's default ExceptionsHandler invokes
// `LoggerService.error(error, stack, context)` with the raw `Error` object as
// the `message` argument; pino serialises Error instances to `{}` because they
// expose no own enumerable properties. The result was the silent
// `{level:50,context:"ExceptionsHandler",msg:{}}` lines we were getting in GKE.
// This helper extracts `name`/`message`/`stack`/`cause` so the structured log
// actually carries the failure reason, while still emitting a useful `msg`
// string for human grep.
export function normalizeErrorLogPayload(
  message: unknown,
  trace?: unknown
): NormalizedErrorLogPayload {
  if (message instanceof Error) {
    const errPayload: NormalizedErrorLogPayload["err"] = {
      name: message.name,
      message: message.message,
      ...(typeof message.stack === "string" ? { stack: message.stack } : {}),
      ...("cause" in message && message.cause !== undefined
        ? { cause: serializeCause(message.cause) }
        : {})
    };
    return { msg: message.message || message.name || "error", err: errPayload };
  }
  if (typeof message === "string") {
    return {
      msg: message,
      ...(typeof trace === "string" && trace.length > 0 ? { trace } : {})
    };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(message);
  } catch {
    serialized = String(message);
  }
  return {
    msg: serialized,
    ...(typeof trace === "string" && trace.length > 0 ? { trace } : {})
  };
}

function serializeCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(typeof cause.stack === "string" ? { stack: cause.stack } : {})
    };
  }
  return cause;
}
