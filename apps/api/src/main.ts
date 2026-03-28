import "reflect-metadata";
import { loadApiConfig } from "@persai/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppLoggerService } from "./modules/platform-core/infrastructure/logging/app-logger.service";
import { ApiExceptionFilter } from "./modules/platform-core/interface/http/api-exception.filter";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  process.env.LOG_LEVEL = config.LOG_LEVEL;

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLoggerService));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(config.PORT);
}

void bootstrap();
