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
      path: "api/v1/assistant/voice/elevenlabs/curation",
      method: RequestMethod.PATCH
    }),
    true,
    "PATCH /api/v1/assistant/voice/elevenlabs/curation must be guarded by ClerkAuthMiddleware"
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/voice/elevenlabs/refresh",
      method: RequestMethod.POST
    }),
    true,
    "POST /api/v1/assistant/voice/elevenlabs/refresh must be guarded by ClerkAuthMiddleware"
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/list",
      method: RequestMethod.GET
    }),
    true,
    "GET /api/v1/assistant/list must be guarded by ClerkAuthMiddleware"
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/switch",
      method: RequestMethod.POST
    }),
    true,
    "POST /api/v1/assistant/switch must be guarded by ClerkAuthMiddleware"
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
      path: "api/v1/assistant/integrations/telegram/groups/refresh",
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
      path: "api/v1/assistant/knowledge-sources/:sourceId/inspect",
      method: RequestMethod.GET
    }),
    true,
    "GET /api/v1/assistant/knowledge-sources/:sourceId/inspect must be guarded by ClerkAuthMiddleware"
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
      path: "api/v1/admin/knowledge-sources/retrieval-policy",
      method: RequestMethod.GET
    }),
    true,
    "GET /api/v1/admin/knowledge-sources/retrieval-policy must be guarded by ClerkAuthMiddleware"
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/knowledge-sources/retrieval-policy",
      method: RequestMethod.POST
    }),
    true,
    "POST /api/v1/admin/knowledge-sources/retrieval-policy must be guarded by ClerkAuthMiddleware"
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
  for (const route of [
    { path: "api/v1/admin/skills", method: RequestMethod.GET },
    { path: "api/v1/admin/skills", method: RequestMethod.POST },
    { path: "api/v1/admin/skills/:skillId", method: RequestMethod.GET },
    { path: "api/v1/admin/skills/:skillId", method: RequestMethod.PATCH },
    { path: "api/v1/admin/skills/:skillId", method: RequestMethod.DELETE },
    { path: "api/v1/admin/skills/:skillId/documents", method: RequestMethod.POST },
    {
      path: "api/v1/admin/skills/:skillId/documents/:documentId",
      method: RequestMethod.DELETE
    },
    {
      path: "api/v1/admin/skills/:skillId/documents/:documentId/reindex",
      method: RequestMethod.POST
    },
    // ADR-118 Slice 3 — Skill Scenario CRUD routes (5 endpoints).
    // Missing from middleware registration in Slice 3 → production caught it as
    // "Authenticated user context is missing." 401 on the admin Scenarios section.
    { path: "api/v1/admin/skills/:skillId/scenarios", method: RequestMethod.GET },
    { path: "api/v1/admin/skills/:skillId/scenarios", method: RequestMethod.POST },
    {
      path: "api/v1/admin/skills/:skillId/scenarios/:scenarioKey",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/admin/skills/:skillId/scenarios/:scenarioKey",
      method: RequestMethod.PATCH
    },
    {
      path: "api/v1/admin/skills/:skillId/scenarios/:scenarioKey",
      method: RequestMethod.DELETE
    },
    { path: "api/v1/admin/site-pages", method: RequestMethod.GET },
    { path: "api/v1/admin/site-pages/:slug", method: RequestMethod.PUT },
    { path: "api/v1/admin/site-pages/:slug/publish", method: RequestMethod.POST },
    { path: "api/v1/admin/tools/document-processing", method: RequestMethod.GET },
    { path: "api/v1/admin/tools/document-processing", method: RequestMethod.PUT },
    {
      path: "api/v1/admin/tools/document-processing/test-connection",
      method: RequestMethod.POST
    },
    { path: "api/v1/assistant/skills", method: RequestMethod.GET },
    { path: "api/v1/assistant/skills", method: RequestMethod.PUT },
    { path: "api/v1/assistant/billing/payment-intents", method: RequestMethod.POST },
    {
      path: "api/v1/assistant/billing/payment-intents/:paymentIntentId",
      method: RequestMethod.GET
    },
    { path: "api/v1/assistant/billing/packages/catalog", method: RequestMethod.GET },
    {
      path: "api/v1/assistant/billing/packages/payment-intents",
      method: RequestMethod.POST
    },
    { path: "api/v1/assistant/billing/subscription", method: RequestMethod.GET },
    {
      path: "api/v1/assistant/billing/subscription/disable-auto-renew",
      method: RequestMethod.POST
    },
    {
      path: "api/v1/assistant/billing/subscription/enable-auto-renew",
      method: RequestMethod.POST
    },
    {
      path: "api/v1/assistant/billing/subscription/change-plan",
      method: RequestMethod.POST
    },
    { path: "api/v1/admin/knowledge-indexing/jobs", method: RequestMethod.GET },
    { path: "api/v1/assistant/knowledge-indexing/jobs", method: RequestMethod.GET },
    { path: "api/v1/assistant/chat/web/stage-attachment", method: RequestMethod.POST },
    {
      path: "api/v1/assistant/chat/:chatId/message/:messageId/attachment",
      method: RequestMethod.POST
    },
    { path: "api/v1/assistant/voice/transcribe", method: RequestMethod.POST },
    {
      path: "api/v1/assistant/chats/web/:chatId/files",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/assistant/chats/web/:chatId/files/preview",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/assistant/documents/:docId/prepare-pptx",
      method: RequestMethod.POST
    },
    { path: "api/v1/support/tickets/:ticketId/read", method: RequestMethod.POST },
    { path: "api/v1/support/attachments/:attachmentId", method: RequestMethod.GET },
    { path: "api/v1/admin/support/attachments/:attachmentId", method: RequestMethod.GET },
    { path: "api/v1/workspaces/:workspaceId/video-personas", method: RequestMethod.POST },
    { path: "api/v1/workspaces/:workspaceId/video-personas", method: RequestMethod.GET },
    {
      path: "api/v1/workspaces/:workspaceId/video-personas/voice-catalog",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-personas/voice-catalog/:voiceId/preview",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-personas/:personaId",
      method: RequestMethod.PATCH
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-personas/:personaId",
      method: RequestMethod.DELETE
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-personas/:personaId/portrait",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-personas/:personaId/preview",
      method: RequestMethod.GET
    },
    { path: "api/v1/workspaces/:workspaceId/video-cloned-voices", method: RequestMethod.POST },
    { path: "api/v1/workspaces/:workspaceId/video-cloned-voices", method: RequestMethod.GET },
    {
      path: "api/v1/workspaces/:workspaceId/video-cloned-voices/:clonedVoiceId/preview",
      method: RequestMethod.GET
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-cloned-voices/:clonedVoiceId",
      method: RequestMethod.DELETE
    },
    {
      path: "api/v1/workspaces/:workspaceId/video-cloned-voices/:clonedVoiceId/default",
      method: RequestMethod.POST
    },
    { path: "api/v1/admin/plans/packages", method: RequestMethod.GET },
    { path: "api/v1/admin/plans/packages", method: RequestMethod.POST },
    { path: "api/v1/admin/plans/packages/:id", method: RequestMethod.PATCH },
    { path: "api/v1/admin/plans/packages/:id", method: RequestMethod.DELETE }
  ]) {
    assert.equal(
      hasRoute(consumer.routes, route),
      true,
      `${RequestMethod[route.method]} /${route.path} must be guarded by ClerkAuthMiddleware`
    );
  }
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
  // ADR-088 unified notification platform — all admin control-plane routes must
  // be guarded. If any is missing the UI incorrectly shows "Session expired".
  const adr088AdminRoutes: Array<{ path: string; method: RequestMethod }> = [
    { path: "api/v1/admin/notifications/channels", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/channels/:channelType", method: RequestMethod.PATCH },
    {
      path: "api/v1/admin/notifications/channels/:channelType/test-send",
      method: RequestMethod.POST
    },
    { path: "api/v1/admin/notifications/templates", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/policies", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/policies/:source", method: RequestMethod.PATCH },
    { path: "api/v1/admin/notifications/policies/:source/test", method: RequestMethod.POST },
    { path: "api/v1/admin/notifications/quiet-hours", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/quiet-hours", method: RequestMethod.PATCH },
    { path: "api/v1/admin/notifications/deliveries", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/deliveries/:intentId", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/dead-letters", method: RequestMethod.GET },
    { path: "api/v1/admin/notifications/dead-letters/:id/replay", method: RequestMethod.POST },
    { path: "api/v1/admin/notifications/dead-letters/:id/discard", method: RequestMethod.POST },
    { path: "api/v1/admin/notifications/preview", method: RequestMethod.POST }
  ];
  for (const route of adr088AdminRoutes) {
    assert.equal(
      hasRoute(consumer.routes, route),
      true,
      `${RequestMethod[route.method]} /${route.path} must be guarded by ClerkAuthMiddleware (ADR-088)`
    );
  }
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/admin/ops/users/:userId/billing-support-action",
      method: RequestMethod.POST
    }),
    true,
    "POST /api/v1/admin/ops/users/:userId/billing-support-action must be guarded by ClerkAuthMiddleware"
  );
  // ADR-115 inbound safety admin — Runtime inbound policy editor + Ops safety controls.
  const adr115SafetyAdminRoutes: Array<{ path: string; method: RequestMethod }> = [
    { path: "api/v1/admin/safety-policy/heuristic-rules", method: RequestMethod.GET },
    { path: "api/v1/admin/safety-policy/heuristic-rules", method: RequestMethod.PUT },
    { path: "api/v1/admin/safety-policy/settings", method: RequestMethod.GET },
    { path: "api/v1/admin/safety-policy/settings", method: RequestMethod.PUT },
    { path: "api/v1/admin/safety-controls/restrictions", method: RequestMethod.GET },
    { path: "api/v1/admin/safety-controls/cases", method: RequestMethod.GET },
    { path: "api/v1/admin/safety-controls/unblock", method: RequestMethod.POST },
    { path: "api/v1/admin/safety-controls/restrict", method: RequestMethod.POST }
  ];
  for (const route of adr115SafetyAdminRoutes) {
    assert.equal(
      hasRoute(consumer.routes, route),
      true,
      `${RequestMethod[route.method]} /${route.path} must be guarded by ClerkAuthMiddleware (ADR-115)`
    );
  }
  // ADR-076 Slice 4 follow-up (2026-04-25 founder report): GET avatar bytes
  // hit `apps/api` via a parameterized path — `/assistant/avatar/:hash` —
  // but the allowlist initially registered the bare `/assistant/avatar`,
  // which Nest does not match against `:hash` URLs. The middleware was
  // skipped, `req.resolvedAppUser` stayed null, and the controller returned
  // 401 in ~1ms. The browser <img> source then 404'd through the BFF and
  // the avatar never displayed. Pin both shapes so we never lose either.
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/avatar",
      method: RequestMethod.POST
    }),
    true,
    "POST /api/v1/assistant/avatar must be guarded by ClerkAuthMiddleware"
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/avatar/:hash",
      method: RequestMethod.GET
    }),
    true,
    "GET /api/v1/assistant/avatar/:hash must be guarded by ClerkAuthMiddleware"
  );
  // ADR-125 in-chat TodoWrite — both web-facing plan routes ship in
  // AssistantChatTodosController and must be guarded. Original Slice 1
  // wired the controller into WorkspaceManagementModule but forgot the
  // ClerkAuthMiddleware `forRoutes` entries, so live the GET/DELETE
  // returned 401 (`req.resolvedAppUser === undefined`) and the
  // <ChatPlanCard> never received data. Lock both shapes here.
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/chats/web/:chatId/plan",
      method: RequestMethod.GET
    }),
    true,
    "GET /api/v1/assistant/chats/web/:chatId/plan must be guarded by ClerkAuthMiddleware (ADR-125)"
  );
  assert.equal(
    hasRoute(consumer.routes, {
      path: "api/v1/assistant/chats/web/:chatId/plan",
      method: RequestMethod.DELETE
    }),
    true,
    "DELETE /api/v1/assistant/chats/web/:chatId/plan must be guarded by ClerkAuthMiddleware (ADR-125)"
  );
}

void runIdentityAccessModuleTest().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
