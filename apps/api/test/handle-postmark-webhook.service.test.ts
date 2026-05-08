/**
 * ADR-088 Slice 1 closeout — HandlePostmarkWebhookService focused tests.
 * Covers: HMAC verify, bounce → channel degraded, token unset in dev vs prod,
 * consecutiveFailures increment, health escalation.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { HandlePostmarkWebhookService } from "../src/modules/workspace-management/application/notifications/handle-postmark-webhook.service";

// ── Mock Prisma ────────────────────────────────────────────────────────────

type ChannelState = {
  id: string;
  workspaceId: string;
  channelType: string;
  consecutiveFailures: number;
  healthStatus: string;
  lastFailureAt: Date | null;
};

function makePrisma(initial?: Partial<ChannelState>) {
  const channel: ChannelState = {
    id: "ch-1",
    workspaceId: "ws-1",
    channelType: "email",
    consecutiveFailures: initial?.consecutiveFailures ?? 0,
    healthStatus: initial?.healthStatus ?? "healthy",
    lastFailureAt: null
  };

  return {
    notificationChannelRegistry: {
      findFirst: async () => ({ ...channel }),
      update: async ({ data }: { data: Partial<ChannelState> }) => {
        if (data.consecutiveFailures != null)
          channel.consecutiveFailures = data.consecutiveFailures;
        if (data.healthStatus != null) channel.healthStatus = data.healthStatus;
        if (data.lastFailureAt != null) channel.lastFailureAt = data.lastFailureAt;
        return { ...channel };
      }
    },
    get _channel() {
      return channel;
    }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Valid HMAC signature accepted, consecutiveFailures incremented
  {
    const token = "test-webhook-token-1";
    const saved = process.env["POSTMARK_WEBHOOK_TOKEN"];
    process.env["POSTMARK_WEBHOOK_TOKEN"] = token;

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never);

    const rawBody = JSON.stringify({ RecordType: "Bounce", Email: "test@example.com" });
    const signature = createHmac("sha256", token).update(rawBody).digest("hex");

    await svc.handle({ rawBody, signature, workspaceId: "ws-1" });
    assert.equal(
      prisma._channel.consecutiveFailures,
      1,
      "consecutiveFailures incremented on bounce"
    );

    process.env["POSTMARK_WEBHOOK_TOKEN"] = saved;
    console.log("✓ valid HMAC signature accepted, consecutiveFailures incremented");
  }

  // 2. Invalid HMAC signature rejected
  {
    const token = "test-webhook-token-2";
    const saved = process.env["POSTMARK_WEBHOOK_TOKEN"];
    process.env["POSTMARK_WEBHOOK_TOKEN"] = token;

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never);
    const rawBody = JSON.stringify({ RecordType: "Bounce" });

    await assert.rejects(
      () => svc.handle({ rawBody, signature: "bad-sig", workspaceId: "ws-1" }),
      /invalid_postmark_signature/
    );

    process.env["POSTMARK_WEBHOOK_TOKEN"] = saved;
    console.log("✓ invalid HMAC signature → rejected");
  }

  // 3. No token in development → unsigned request accepted
  {
    const savedToken = process.env["POSTMARK_WEBHOOK_TOKEN"];
    const savedAppEnv = process.env["APP_ENV"];
    const savedNodeEnv = process.env["NODE_ENV"];
    delete process.env["POSTMARK_WEBHOOK_TOKEN"];
    process.env["APP_ENV"] = "development";
    process.env["NODE_ENV"] = "development";

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never);
    const rawBody = JSON.stringify({ RecordType: "Bounce" });

    // Should NOT throw in development when token is unset
    await svc.handle({ rawBody, signature: null, workspaceId: "ws-1" });

    process.env["POSTMARK_WEBHOOK_TOKEN"] = savedToken;
    process.env["APP_ENV"] = savedAppEnv ?? "";
    process.env["NODE_ENV"] = savedNodeEnv ?? "";
    console.log("✓ no token in development → unsigned request accepted");
  }

  // 4. No token in production → unsigned request rejected
  {
    const savedToken = process.env["POSTMARK_WEBHOOK_TOKEN"];
    const savedAppEnv = process.env["APP_ENV"];
    const savedNodeEnv = process.env["NODE_ENV"];
    delete process.env["POSTMARK_WEBHOOK_TOKEN"];
    process.env["APP_ENV"] = "production";
    process.env["NODE_ENV"] = "production";

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never);
    const rawBody = JSON.stringify({ RecordType: "Bounce" });

    await assert.rejects(
      () => svc.handle({ rawBody, signature: null, workspaceId: "ws-1" }),
      /invalid_postmark_signature/
    );

    process.env["POSTMARK_WEBHOOK_TOKEN"] = savedToken;
    process.env["APP_ENV"] = savedAppEnv ?? "";
    process.env["NODE_ENV"] = savedNodeEnv ?? "";
    console.log("✓ no token in production → unsigned request rejected");
  }

  // 5. 5 consecutive failures → health escalates to 'down'
  {
    const token = "test-webhook-token-5";
    const saved = process.env["POSTMARK_WEBHOOK_TOKEN"];
    process.env["POSTMARK_WEBHOOK_TOKEN"] = token;

    const prisma = makePrisma({ consecutiveFailures: 4 }); // already at 4
    const svc = new HandlePostmarkWebhookService(prisma as never);

    const rawBody = JSON.stringify({ RecordType: "Bounce" });
    const signature = createHmac("sha256", token).update(rawBody).digest("hex");
    await svc.handle({ rawBody, signature, workspaceId: "ws-1" });

    assert.equal(prisma._channel.consecutiveFailures, 5);
    assert.equal(prisma._channel.healthStatus, "down", "health = down at 5 failures");

    process.env["POSTMARK_WEBHOOK_TOKEN"] = saved;
    console.log("✓ 5 consecutive failures → healthStatus = down");
  }

  console.log("\n✅ All handle-postmark-webhook.service tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
