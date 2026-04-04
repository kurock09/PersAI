import "reflect-metadata";
import { createServer, type Server } from "node:http";
import { loadApiConfig } from "@persai/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppLoggerService } from "./modules/platform-core/infrastructure/logging/app-logger.service";
import { ApiExceptionFilter } from "./modules/platform-core/interface/http/api-exception.filter";

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

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLoggerService));
  app.useGlobalFilters(new ApiExceptionFilter());

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(
    routeByListenerPort({ publicPort: config.PORT, internalPort: config.API_INTERNAL_PORT })
  );

  await app.init();

  const publicServer = createServer(expressApp);
  await listen(publicServer, config.PORT);

  if (config.API_INTERNAL_PORT !== config.PORT) {
    const internalServer = createServer(expressApp);
    await listen(internalServer, config.API_INTERNAL_PORT);
  }
}

void bootstrap();
