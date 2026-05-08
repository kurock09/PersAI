/**
 * ADR-088 multi-user correction — HandlePostmarkWebhookService focused tests.
 * Covers: HMAC verify via secret-store only, bounce → channel degraded,
 * token unset in dev vs prod, consecutiveFailures increment, health escalation.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { HandlePostmarkWebhookService } from "../src/modules/workspace-management/application/notifications/handle-postmark-webhook.service";

// ── Mock Prisma ────────────────────────────────────────────────────────────

type ChannelState = {
  id: string;
  channelType: string;
  consecutiveFailures: number;
  healthStatus: string;
  lastFailureAt: Date | null;
};

function makePrisma(initial?: Partial<ChannelState>) {
  const channel: ChannelState = {
    id: "ch-1",
    channelType: "email",
    consecutiveFailures: initial?.consecutiveFailures ?? 0,
    healthStatus: initial?.healthStatus ?? "healthy",
    lastFailureAt: null
  };

  return {
    notificationChannelRegistry: {
      findUnique: async (_args: unknown) => ({ ...channel }),
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

/** Mock secret store — returns null when no token configured. */
function makeSecretStore(storedToken?: string) {
  return {
    resolveSecretValueByProviderKey: async (_key: string): Promise<string | null> => {
      return storedToken ?? null;
    }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

void (async function run(): Promise<void> {
  // 1. Valid HMAC signature accepted via secret store, consecutiveFailures incremented
  {
    const token = "test-webhook-token-1";

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never, makeSecretStore(token) as never);

    const rawBody = JSON.stringify({ RecordType: "Bounce", Email: "test@example.com" });
    const signature = createHmac("sha256", token).update(rawBody).digest("hex");

    await svc.handle({ rawBody, signature });
    assert.equal(
      prisma._channel.consecutiveFailures,
      1,
      "consecutiveFailures incremented on bounce"
    );

    console.log(
      "✓ valid HMAC signature accepted via secret store, consecutiveFailures incremented"
    );
  }

  // 2. Invalid HMAC signature rejected even when store has token
  {
    const token = "test-webhook-token-2";
    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never, makeSecretStore(token) as never);
    const rawBody = JSON.stringify({ RecordType: "Bounce" });

    await assert.rejects(
      () => svc.handle({ rawBody, signature: "bad-sig" }),
      /invalid_postmark_signature/
    );

    console.log("✓ invalid HMAC signature → rejected");
  }

  // 3. No token in development → unsigned request accepted
  {
    const savedAppEnv = process.env["APP_ENV"];
    const savedNodeEnv = process.env["NODE_ENV"];
    process.env["APP_ENV"] = "development";
    process.env["NODE_ENV"] = "development";

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never, makeSecretStore() as never);
    const rawBody = JSON.stringify({ RecordType: "Bounce" });

    // Should NOT throw in development when token is unset in store
    await svc.handle({ rawBody, signature: null });

    process.env["APP_ENV"] = savedAppEnv ?? "";
    process.env["NODE_ENV"] = savedNodeEnv ?? "";
    console.log("✓ no token in development → unsigned request accepted");
  }

  // 4. No token in production → unsigned request rejected
  {
    const savedAppEnv = process.env["APP_ENV"];
    const savedNodeEnv = process.env["NODE_ENV"];
    process.env["APP_ENV"] = "production";
    process.env["NODE_ENV"] = "production";

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never, makeSecretStore() as never);
    const rawBody = JSON.stringify({ RecordType: "Bounce" });

    await assert.rejects(
      () => svc.handle({ rawBody, signature: null }),
      /invalid_postmark_signature/
    );

    process.env["APP_ENV"] = savedAppEnv ?? "";
    process.env["NODE_ENV"] = savedNodeEnv ?? "";
    console.log("✓ no token in production → unsigned request rejected");
  }

  // 5. 5 consecutive failures → health escalates to 'down'
  {
    const token = "test-webhook-token-5";

    const prisma = makePrisma({ consecutiveFailures: 4 }); // already at 4
    const svc = new HandlePostmarkWebhookService(prisma as never, makeSecretStore(token) as never);

    const rawBody = JSON.stringify({ RecordType: "Bounce" });
    const signature = createHmac("sha256", token).update(rawBody).digest("hex");
    await svc.handle({ rawBody, signature });

    assert.equal(prisma._channel.consecutiveFailures, 5);
    assert.equal(prisma._channel.healthStatus, "down", "health = down at 5 failures");

    console.log("✓ 5 consecutive failures → healthStatus = down");
  }

  // 6. SpamComplaint also triggers handleDeliveryFailure
  {
    const token = "test-webhook-token-6";

    const prisma = makePrisma();
    const svc = new HandlePostmarkWebhookService(prisma as never, makeSecretStore(token) as never);

    const rawBody = JSON.stringify({ RecordType: "SpamComplaint" });
    const signature = createHmac("sha256", token).update(rawBody).digest("hex");
    await svc.handle({ rawBody, signature });

    assert.equal(prisma._channel.consecutiveFailures, 1, "SpamComplaint increments failures");

    console.log("✓ SpamComplaint → consecutiveFailures incremented");
  }

  console.log("\n✅ All handle-postmark-webhook.service tests passed");
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
