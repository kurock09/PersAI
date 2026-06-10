import "reflect-metadata";
import { createServer, type Server } from "node:http";
import { loadApiConfig } from "@persai/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppLoggerService } from "./modules/platform-core/infrastructure/logging/app-logger.service";
import { ApiExceptionFilter } from "./modules/platform-core/interface/http/api-exception.filter";
import { AssistantLiveVoiceRelayGateway } from "./modules/workspace-management/interface/ws/assistant-live-voice-relay.gateway";

const INTERNAL_PATH_PREFIX = "/api/v1/internal";

function isInternalPath(pathname: string): boolean {
  return pathname === INTERNAL_PATH_PREFIX || pathname.startsWith(`${INTERNAL_PATH_PREFIX}/`);
}

type PortRoutedRequest = {
  path: string;
  socket: { localPort?: number };
};

type PortRoutedResponse = {
  status(code: number): PortRoutedResponse;
  json(payload: unknown): void;
};

type ListenerPortRouteParams = {
  publicPort: number;
  internalPort: number;
};

function routeByListenerPort(params: ListenerPortRouteParams) {
  return (req: PortRoutedRequest, res: PortRoutedResponse, next: () => void) => {
    const localPort = req.socket.localPort;
    const internalPath = isInternalPath(req.path);

    if (localPort === params.publicPort && internalPath) {
      res.status(404).json({ statusCode: 404, message: "Not Found" });
      return;
    }

    if (localPort === params.internalPort && !internalPath) {
      res.status(404).json({ statusCode: 404, message: "Not Found" });
      return;
    }

    next();
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  process.env.LOG_LEVEL = config.LOG_LEVEL;

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(AppLoggerService));
  app.useGlobalFilters(new ApiExceptionFilter());

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(
    routeByListenerPort({ publicPort: config.PORT, internalPort: config.API_INTERNAL_PORT })
  );

  await app.init();
  // CRITICAL: drain the bootstrap log buffer started by `bufferLogs: true`. Without this,
  // every `Logger.log()`/`.warn()` from any service stays buffered forever (because we use
  // manual `app.init()` + `createServer + listen` instead of `app.listen()`, which would
  // drain it for us). See docs/SESSION-HANDOFF.md "Web stream telemetry was invisible".
  app.flushLogs();

  const publicServer = createServer(expressApp);
  // ADR-114: the live voice websocket relay must attach its `upgrade` handler
  // to the real listening server (the public port), not Nest's internal http
  // server which never listens.
  app.get(AssistantLiveVoiceRelayGateway, { strict: false }).attachTo(publicServer);
  await listen(publicServer, config.PORT);

  if (config.API_INTERNAL_PORT !== config.PORT) {
    const internalServer = createServer(expressApp);
    await listen(internalServer, config.API_INTERNAL_PORT);
  }
}

void bootstrap();
