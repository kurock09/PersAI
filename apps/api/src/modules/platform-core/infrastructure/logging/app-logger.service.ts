import { Injectable, LoggerService } from "@nestjs/common";
import pino, { Logger } from "pino";
import { RequestLogEntry } from "./request-log-entry";

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger: Logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime
  });

  log(message: string, context?: string): void {
    this.logger.info({ context }, message);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, message);
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

  fatal(message: string, trace?: string, context?: string): void {
    this.logger.fatal({ context, trace }, message);
  }

  requestCompleted(entry: RequestLogEntry): void {
    this.logger.info(entry, "request_completed");
  }
}
