import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadProviderGatewayConfig } from "@persai/config";
import { AppModule } from "./app.module";
import { AppLoggerService } from "./modules/platform-core/infrastructure/logging/app-logger.service";

async function bootstrap(): Promise<void> {
  const config = loadProviderGatewayConfig(process.env);
  process.env.LOG_LEVEL = config.LOG_LEVEL;

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLoggerService));
  await app.listen(config.PORT);
}

void bootstrap();
