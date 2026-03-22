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
