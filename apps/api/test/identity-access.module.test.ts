import assert from "node:assert/strict";
import { RequestMethod, type MiddlewareConsumer } from "@nestjs/common";
import { IdentityAccessModule } from "../src/modules/identity-access/identity-access.module";

type RecordedRoute = string | { path: string; method: RequestMethod };

class RecordingMiddlewareConsumer {
  routes: RecordedRoute[] = [];

  apply(..._middleware: unknown[]): {
    forRoutes: (...routes: RecordedRoute[]) => MiddlewareConsumer;
  } {
    return {
      forRoutes: (...routes: RecordedRoute[]) => {
        this.routes.push(...routes);
        return this as unknown as MiddlewareConsumer;
      }
    };
  }
}

function hasRoute(
  routes: RecordedRoute[],
  params: {
    path: string;
    method: RequestMethod;
  }
): boolean {
  return routes.some(
    (route) =>
      typeof route !== "string" &&
      route.path === params.path &&
      route.method === params.method
  );
}

export async function runIdentityAccessModuleTest(): Promise<void> {
  const module = new IdentityAccessModule();
  const consumer = new RecordingMiddlewareConsumer();

  module.configure(consumer as unknown as MiddlewareConsumer);

  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/voice/settings",
      method: RequestMethod.GET
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/integrations/telegram/resend-owner-message",
      method: RequestMethod.POST
    }),
    true
  );
}

void runIdentityAccessModuleTest().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
