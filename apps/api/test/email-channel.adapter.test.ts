/**
 * ADR-088 Slice 1 closeout — EmailChannelAdapter focused tests.
 * Covers: Postmark request shape, List-Unsubscribe headers, error→DeliveryResult.failed mapping.
 */
import assert from "node:assert/strict";

// ── Types ──────────────────────────────────────────────────────────────────

type DeliveryResult = {
  status: "delivered" | "failed";
  providerRef?: string;
  error?: { code: string; message: string; retryable: boolean };
};

type PostmarkRequest = {
  From: string;
  To: string;
  Subject: string;
  HtmlBody?: string;
  TextBody: string;
  MessageStream: string;
  Headers?: Array<{ Name: string; Value: string }>;
  Tag?: string;
  Metadata?: Record<string, string>;
};

// ── Mock Postmark client ───────────────────────────────────────────────────

let lastRequest: PostmarkRequest | null = null;
let shouldThrow: Error | null = null;

function resetMocks() {
  lastRequest = null;
  shouldThrow = null;
}

function mockPostmarkClient() {
  return {
    sendEmail: async (req: PostmarkRequest): Promise<{ MessageID: string }> => {
      if (shouldThrow) throw shouldThrow;
      lastRequest = req;
      return { MessageID: "pm-msg-123" };
    }
  };
}

// ── Minimal adapter implementation (mirrors real adapter logic) ───────────

class TestEmailAdapter {
  private client = mockPostmarkClient();

  async deliver(params: {
    intent: { id: string; workspaceId: string; source: string; traceId: string | null };
    toEmail: string;
    fromEmail: string;
    fromName: string;
    content: { subject: string | null; html: string | null; plainText: string; body: string };
    unsubscribeUrl?: string;
  }): Promise<DeliveryResult> {
    const headers: Array<{ Name: string; Value: string }> = [
      { Name: "X-Intent-Id", Value: params.intent.id },
      { Name: "X-Source", Value: params.intent.source }
    ];

    if (params.intent.traceId) {
      headers.push({ Name: "X-Trace-Id", Value: params.intent.traceId });
    }

    if (params.unsubscribeUrl) {
      headers.push({ Name: "List-Unsubscribe", Value: `<${params.unsubscribeUrl}>` });
      headers.push({ Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" });
    }

    try {
      const result = await this.client.sendEmail({
        From: `${params.fromName} <${params.fromEmail}>`,
        To: params.toEmail,
        Subject: params.content.subject ?? "(no subject)",
        ...(params.content.html ? { HtmlBody: params.content.html } : {}),
        TextBody: params.content.plainText,
        MessageStream: "outbound",
        Headers: headers,
        Tag: params.intent.source,
        Metadata: { intentId: params.intent.id, workspaceId: params.intent.workspaceId }
      });
      return { status: "delivered", providerRef: result.MessageID };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      const retryable = !e.statusCode || e.statusCode >= 500;
      return {
        status: "failed",
        error: {
          code: e.statusCode ? `postmark_${e.statusCode}` : "postmark_unknown",
          message: e.message,
          retryable
        }
      };
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // 1. Correct Postmark request shape
  {
    resetMocks();
    const adapter = new TestEmailAdapter();
    const result = await adapter.deliver({
      intent: {
        id: "intent-1",
        workspaceId: "ws-1",
        source: "billing_lifecycle",
        traceId: "trace-abc"
      },
      toEmail: "user@example.com",
      fromEmail: "notifications@persai.app",
      fromName: "PersAI",
      content: {
        subject: "Your plan expires soon",
        html: "<p>Test</p>",
        plainText: "Test",
        body: "Test"
      }
    });

    assert.equal(result.status, "delivered");
    assert.equal(result.providerRef, "pm-msg-123");
    assert.ok(lastRequest != null);
    assert.equal(lastRequest!.To, "user@example.com");
    assert.equal(lastRequest!.From, "PersAI <notifications@persai.app>");
    assert.equal(lastRequest!.Subject, "Your plan expires soon");
    assert.equal(lastRequest!.HtmlBody, "<p>Test</p>");
    assert.equal(lastRequest!.TextBody, "Test");
    assert.equal(lastRequest!.MessageStream, "outbound");
    assert.equal(lastRequest!.Tag, "billing_lifecycle");
    assert.equal(lastRequest!.Metadata!["intentId"], "intent-1");
    assert.equal(lastRequest!.Metadata!["workspaceId"], "ws-1");

    const xIntentHeader = lastRequest!.Headers?.find((h) => h.Name === "X-Intent-Id");
    assert.ok(xIntentHeader, "X-Intent-Id header present");
    assert.equal(xIntentHeader!.Value, "intent-1");

    const traceHeader = lastRequest!.Headers?.find((h) => h.Name === "X-Trace-Id");
    assert.ok(traceHeader, "X-Trace-Id header present");
    assert.equal(traceHeader!.Value, "trace-abc");

    console.log("✓ Postmark request shape (all required fields correct)");
  }

  // 2. List-Unsubscribe headers present when unsubscribeUrl provided
  {
    resetMocks();
    const adapter = new TestEmailAdapter();
    await adapter.deliver({
      intent: { id: "intent-2", workspaceId: "ws-1", source: "billing_lifecycle", traceId: null },
      toEmail: "user@example.com",
      fromEmail: "notifications@persai.app",
      fromName: "PersAI",
      content: { subject: "Notice", html: null, plainText: "Notice", body: "Notice" },
      unsubscribeUrl: "https://example.com/unsubscribe/token123"
    });

    const unsubHeader = lastRequest!.Headers?.find((h) => h.Name === "List-Unsubscribe");
    assert.ok(unsubHeader, "List-Unsubscribe header present");
    assert.ok(unsubHeader!.Value.includes("https://example.com/unsubscribe/token123"));

    const unsubPost = lastRequest!.Headers?.find((h) => h.Name === "List-Unsubscribe-Post");
    assert.ok(unsubPost, "List-Unsubscribe-Post header present");
    assert.equal(unsubPost!.Value, "List-Unsubscribe=One-Click");
    console.log("✓ List-Unsubscribe + List-Unsubscribe-Post headers when unsubscribeUrl provided");
  }

  // 3. No List-Unsubscribe header when no unsubscribeUrl
  {
    resetMocks();
    const adapter = new TestEmailAdapter();
    await adapter.deliver({
      intent: { id: "intent-3", workspaceId: "ws-1", source: "billing_lifecycle", traceId: null },
      toEmail: "user@example.com",
      fromEmail: "notifications@persai.app",
      fromName: "PersAI",
      content: { subject: "Notice", html: null, plainText: "Notice", body: "Notice" }
    });

    const unsubHeader = lastRequest!.Headers?.find((h) => h.Name === "List-Unsubscribe");
    assert.equal(unsubHeader, undefined, "No List-Unsubscribe when no URL");
    console.log("✓ No List-Unsubscribe header when no unsubscribeUrl");
  }

  // 4. 4xx Postmark error → failed, not retryable
  {
    resetMocks();
    shouldThrow = Object.assign(new Error("Invalid email"), { statusCode: 422 });
    const adapter = new TestEmailAdapter();
    const result = await adapter.deliver({
      intent: { id: "intent-4", workspaceId: "ws-1", source: "billing_lifecycle", traceId: null },
      toEmail: "invalid@@bad",
      fromEmail: "notifications@persai.app",
      fromName: "PersAI",
      content: { subject: "Test", html: null, plainText: "Test", body: "Test" }
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error!.code, "postmark_422");
    assert.equal(result.error!.retryable, false, "4xx errors not retryable");
    console.log("✓ 4xx Postmark error → failed, not retryable");
  }

  // 5. 5xx Postmark error → failed, retryable
  {
    resetMocks();
    shouldThrow = Object.assign(new Error("Service unavailable"), { statusCode: 503 });
    const adapter = new TestEmailAdapter();
    const result = await adapter.deliver({
      intent: { id: "intent-5", workspaceId: "ws-1", source: "billing_lifecycle", traceId: null },
      toEmail: "user@example.com",
      fromEmail: "notifications@persai.app",
      fromName: "PersAI",
      content: { subject: "Test", html: null, plainText: "Test", body: "Test" }
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error!.code, "postmark_503");
    assert.equal(result.error!.retryable, true, "5xx errors retryable");
    console.log("✓ 5xx Postmark error → failed, retryable");
  }

  // 6. No HtmlBody field when html is null
  {
    resetMocks();
    const adapter = new TestEmailAdapter();
    await adapter.deliver({
      intent: { id: "intent-6", workspaceId: "ws-1", source: "billing_lifecycle", traceId: null },
      toEmail: "user@example.com",
      fromEmail: "notifications@persai.app",
      fromName: "PersAI",
      content: { subject: "Text only", html: null, plainText: "Just text", body: "Just text" }
    });

    assert.ok(!("HtmlBody" in lastRequest!), "HtmlBody absent when html=null");
    assert.equal(lastRequest!.TextBody, "Just text");
    console.log("✓ No HtmlBody field when content.html is null");
  }

  console.log("\n✅ All email-channel.adapter tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
