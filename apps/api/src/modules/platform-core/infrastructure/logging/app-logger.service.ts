import { Injectable, LoggerService } from "@nestjs/common";
import { createAppLogger, logRequestCompleted } from "@persai/logger";
import { RequestLogEntry } from "@persai/types";

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger = createAppLogger(process.env.LOG_LEVEL ?? "info");

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
    logRequestCompleted(this.logger, entry);
  }
}
