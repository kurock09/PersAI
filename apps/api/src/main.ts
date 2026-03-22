import "reflect-metadata";
import { loadApiConfig } from "@persai/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppLoggerService } from "./modules/platform-core/infrastructure/logging/app-logger.service";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  process.env.LOG_LEVEL = config.LOG_LEVEL;

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLoggerService));
  await app.listen(config.PORT);
}

void bootstrap();
