import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadSandboxConfig } from "@persai/config";
import { AppModule } from "./app.module";

const SANDBOX_BODY_LIMIT = "20mb";

async function bootstrap(): Promise<void> {
  const config = loadSandboxConfig(process.env);
  process.env.LOG_LEVEL = config.LOG_LEVEL;

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser("json", { limit: SANDBOX_BODY_LIMIT });
  app.useBodyParser("urlencoded", {
    extended: true,
    limit: SANDBOX_BODY_LIMIT
  });
  await app.listen(config.PORT);
}

void bootstrap();
