import { Injectable, LoggerService } from "@nestjs/common";
import { createAppLogger, normalizeErrorLogPayload } from "@persai/logger";

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger = createAppLogger(process.env.LOG_LEVEL ?? "info");

  log(message: string, context?: string): void {
    this.logger.info({ context }, message);
  }

  // ADR-074 F1: Nest's ExceptionsHandler hands us the raw Error as `message`;
  // serialize it via the shared helper so name/message/stack survive in GKE
  // logs instead of pino emitting `msg:{}`.
  error(message: unknown, trace?: unknown, context?: string): void {
    const payload = normalizeErrorLogPayload(message, trace);
    this.logger.error({ context, ...payload }, payload.msg);
  }

  warn(message: string, context?: string): void {
    this.logger.warn({ context }, message);
  }

  debug(message: string, context?: string): void {
    this.logger.debug({ context }, message);
  }

  verbose(message: string, context?: string): void {
    this.logger.trace({ context }, message);
  }

  fatal(message: unknown, trace?: unknown, context?: string): void {
    const payload = normalizeErrorLogPayload(message, trace);
    this.logger.fatal({ context, ...payload }, payload.msg);
  }
}
