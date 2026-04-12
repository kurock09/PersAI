import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadProviderGatewayConfig } from "@persai/config";
import { AppModule } from "./app.module";
import { AppLoggerService } from "./modules/platform-core/infrastructure/logging/app-logger.service";

const PROVIDER_GATEWAY_BODY_LIMIT = "20mb";

async function bootstrap(): Promise<void> {
  const config = loadProviderGatewayConfig(process.env);
  process.env.LOG_LEVEL = config.LOG_LEVEL;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true
  });
  app.useBodyParser("json", { limit: PROVIDER_GATEWAY_BODY_LIMIT });
  app.useBodyParser("urlencoded", {
    extended: true,
    limit: PROVIDER_GATEWAY_BODY_LIMIT
  });
  app.useLogger(app.get(AppLoggerService));
  await app.listen(config.PORT);
}

void bootstrap();
