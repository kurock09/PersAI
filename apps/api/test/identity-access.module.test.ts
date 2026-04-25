import assert from "node:assert/strict";
import { RequestMethod, type MiddlewareConsumer } from "@nestjs/common";
import { IdentityAccessModule } from "../src/modules/identity-access/identity-access.module";

type RecordedRoute = string | { path: string; method: RequestMethod };

class RecordingMiddlewareConsumer {
  routes: RecordedRoute[] = [];

  apply(...middleware: unknown[]): {
    forRoutes: (...routes: RecordedRoute[]) => MiddlewareConsumer;
  } {
    void middleware;
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
      typeof route !== "string" && route.path === params.path && route.method === params.method
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
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/knowledge-sources",
      method: RequestMethod.POST
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/knowledge-sources",
      method: RequestMethod.GET
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/knowledge-sources/:sourceId",
      method: RequestMethod.GET
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/knowledge-sources/:sourceId",
      method: RequestMethod.DELETE
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/knowledge-sources/:sourceId/reindex",
      method: RequestMethod.POST
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources",
      method: RequestMethod.GET
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources/observability",
      method: RequestMethod.GET
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources/connectors",
      method: RequestMethod.GET
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources/:scope",
      method: RequestMethod.POST
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources/:sourceId",
      method: RequestMethod.DELETE
    }),
    true
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources/:sourceId/reindex",
      method: RequestMethod.POST
    }),
    true
  );
  // ADR-074 Memory Center "Session expired" — real root cause: this route
  // was added to AssistantController without a matching middleware
  // registration here, so requests reached the controller with
  // `req.resolvedAppUser === undefined` and were rejected as 401 inside the
  // handler in ~1ms (no Clerk verifyToken call ever happened). The frontend
  // turned that 401 into the inline "Session expired" banner. Lock the
  // registration with a regression assertion so we never lose it again.
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/memory/items/:itemId/close-open-loop",
      method: RequestMethod.POST
    }),
    true,
    "POST /api/v1/assistant/memory/items/:itemId/close-open-loop must be guarded by ClerkAuthMiddleware"
  );
  // ADR-076 Slice 3 cold-start bootstrap — same regression class as ADR-074:
  // the new GET /api/v1/app/bootstrap route was added to AppBootstrapController
  // without a matching `forRoutes` entry, so the SSR layout fetch in
  // apps/web/app/app/layout.tsx received 401 for every authenticated user,
  // the bootstrap envelope returned all-error sections, and `useAppData`
  // skipped the client fan-out (because initialData !== null) — the sidebar
  // kept showing "Не создан" forever. Pin the route here so we never lose
  // the cold-start surface again.
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/app/bootstrap",
      method: RequestMethod.GET
    }),
    true,
    "GET /api/v1/app/bootstrap must be guarded by ClerkAuthMiddleware"
  );
}

void runIdentityAccessModuleTest().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
