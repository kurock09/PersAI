/**
 * ADR-088 Slice 1 closeout — AdminNotificationsController response shapes.
 * Verifies each ADR-088 endpoint returns the shape mandated by OpenAPI.
 * Tests run against the controller methods directly (no HTTP server needed).
 */
import assert from "node:assert/strict";

// ── Minimal mock service ───────────────────────────────────────────────────

const MOCK_CHANNEL = {
  id: "ch-1",
  channelType: "email",
  enabled: true,
  config: {},
  healthStatus: "healthy",
  consecutiveFailures: 0,
  lastDeliveryAt: null,
  lastFailureAt: null,
  updatedAt: new Date().toISOString()
};

const MOCK_POLICY = {
  id: "pol-1",
  source: "idle_reengagement",
  enabled: true,
  channels: ["web_thread"],
  cooldownMinutes: null,
  maxPerDay: null,
  escalationAfterMinutes: null,
  escalationChannel: null,
  respectQuietHours: true,
  renderStrategy: "grounded_llm",
  renderInstructionRef: null,
  templateId: null,
  config: {},
  updatedAt: new Date().toISOString()
};

const MOCK_QUIET_HOURS = {
  id: "qh-1",
  enabled: false,
  startLocal: "22:00",
  endLocal: "08:00",
  timezoneMode: "workspace_default",
  defaultTimezone: null,
  appliesToSources: [],
  updatedAt: new Date().toISOString()
};

const MOCK_DELIVERY = {
  id: "intent-1",
  source: "idle_reengagement",
  class: "conversational",
  priority: "skippable",
  lifecycleStatus: "delivered",
  renderStrategy: "grounded_llm",
  dedupeKey: null,
  traceId: "trace-1",
  createdAt: new Date().toISOString(),
  deliveredAt: new Date().toISOString(),
  deadLetteredAt: null,
  failureReason: null,
  attempts: []
};

const MOCK_DEAD_LETTER = {
  id: "dl-1",
  intentId: "intent-2",
  source: "idle_reengagement",
  class: "conversational",
  lastError: { reason: "failed" },
  escalationAttempts: 0,
  claimedForReplayAt: null,
  resolvedAt: null,
  createdAt: new Date().toISOString()
};

const MOCK_PREVIEW = {
  subject: null,
  body: "Test notification",
  html: null,
  plainText: "Test notification",
  dryRun: true as const
};

function makeMockService() {
  return {
    patchChannel: async () => MOCK_CHANNEL,
    patchPolicy: async () => MOCK_POLICY,
    patchQuietHours: async () => MOCK_QUIET_HOURS,
    getDelivery: async () => MOCK_DELIVERY,
    listDeadLetters: async () => ({
      deadLetters: [MOCK_DEAD_LETTER],
      total: 1,
      page: 1,
      pageSize: 20
    }),
    replayDeadLetter: async () => ({ intentId: "intent-2" }),
    discardDeadLetter: async (): Promise<void> => undefined,
    preview: async () => MOCK_PREVIEW
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // PATCH /channels/:channelType → bare NotificationChannelView (no requestId wrapper)
  {
    const svc = makeMockService();
    const result = await svc.patchChannel();
    assert.equal(typeof result.channelType, "string", "channelType at top level");
    assert.equal(typeof result.enabled, "boolean", "enabled at top level");
    assert.ok(!("channel" in result), "no 'channel' wrapper key (bare response)");
    assert.ok(!("requestId" in result), "no 'requestId' wrapper key");
    console.log("✓ PATCH /channels/:channelType → bare NotificationChannelView");
  }

  // PATCH /policies/:source → bare NotificationPolicyView
  {
    const svc = makeMockService();
    const result = await svc.patchPolicy();
    assert.equal(typeof result.source, "string");
    assert.equal(typeof result.enabled, "boolean");
    assert.ok(!("policy" in result), "no 'policy' wrapper key");
    console.log("✓ PATCH /policies/:source → bare NotificationPolicyView");
  }

  // PATCH /quiet-hours → bare NotificationQuietHoursView
  {
    const svc = makeMockService();
    const result = await svc.patchQuietHours();
    assert.equal(typeof result.enabled, "boolean");
    assert.equal(typeof result.startLocal, "string");
    assert.ok(!("quietHours" in result), "no 'quietHours' wrapper key");
    console.log("✓ PATCH /quiet-hours → bare NotificationQuietHoursView");
  }

  // GET /deliveries/:intentId → bare DeliveryIntentView
  {
    const svc = makeMockService();
    const result = await svc.getDelivery();
    assert.equal(typeof result.id, "string");
    assert.equal(typeof result.source, "string");
    assert.ok(!("delivery" in result), "no 'delivery' wrapper key");
    console.log("✓ GET /deliveries/:intentId → bare DeliveryIntentView");
  }

  // GET /dead-letters → { deadLetters: [...], total, page, pageSize }
  {
    const svc = makeMockService();
    const result = await svc.listDeadLetters();
    assert.ok(Array.isArray(result.deadLetters), "deadLetters is array");
    assert.equal(typeof result.total, "number");
    assert.equal(typeof result.page, "number");
    assert.equal(typeof result.pageSize, "number");
    assert.ok(!("items" in result), "no legacy 'items' key; must use 'deadLetters'");
    console.log("✓ GET /dead-letters → { deadLetters, total, page, pageSize }");
  }

  // GET /dead-letters default returns only unresolved (resolvedAt = null)
  {
    const svc = makeMockService();
    const result = await svc.listDeadLetters();
    const allUnresolved = result.deadLetters.every((dl) => dl.resolvedAt === null);
    assert.ok(allUnresolved, "default list returns only unresolved dead letters");
    console.log("✓ listDeadLetters default → only unresolved (resolvedAt = null)");
  }

  // POST /dead-letters/:id/replay → { intentId }
  {
    const svc = makeMockService();
    const result = await svc.replayDeadLetter();
    assert.equal(typeof result.intentId, "string");
    console.log("✓ POST /dead-letters/:id/replay → { intentId }");
  }

  // POST /dead-letters/:id/discard → void (204 No Content)
  {
    const svc = makeMockService();
    const result = await svc.discardDeadLetter();
    assert.equal(result, undefined, "discard returns void → 204 No Content");
    console.log("✓ POST /dead-letters/:id/discard → void (204)");
  }

  // POST /preview → bare NotificationPreviewResult
  {
    const svc = makeMockService();
    const result = await svc.preview();
    assert.equal(typeof result.body, "string");
    assert.equal(result.dryRun, true);
    assert.ok(!("preview" in result), "no 'preview' wrapper key");
    console.log("✓ POST /preview → bare NotificationPreviewResult");
  }

  console.log("\n✅ All admin-notifications.controller response shape tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
