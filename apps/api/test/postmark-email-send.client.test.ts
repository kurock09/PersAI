/**
 * ADR-168 — `PostmarkEmailSendClientService` focused tests.
 * Covers the shared Postmark `/email` transport's outcome classification:
 * success, http_error (non-2xx), and network_error (thrown fetch / abort).
 */
import assert from "node:assert/strict";
import { PostmarkEmailSendClientService } from "../src/modules/workspace-management/application/postmark-email-send.client";

const sendParams = {
  url: "https://api.postmarkapp.com/email",
  serverToken: "server-token-xyz",
  payload: { From: "a@example.com", To: "b@example.com", Subject: "Hi" }
};

async function testSuccessReturnsSuccessOutcomeWithParsedBody(): Promise<void> {
  const originalFetch = global.fetch;
  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | null = null;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? null;
    return new Response(JSON.stringify({ MessageID: "pm-abc" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  const client = new PostmarkEmailSendClientService();
  let outcome;
  try {
    outcome = await client.send(sendParams);
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(outcome, { kind: "success", httpStatus: 200, body: { MessageID: "pm-abc" } });
  assert.equal(capturedUrl, sendParams.url);
  const headers = capturedInit!.headers as Record<string, string>;
  assert.equal(headers["X-Postmark-Server-Token"], "server-token-xyz");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["Accept"], "application/json");
  assert.equal(capturedInit!.method, "POST");
  assert.deepEqual(JSON.parse(capturedInit!.body as string), sendParams.payload);
  console.log("✓ success -> kind:'success' with parsed JSON body, correct request shape");
}

async function testHttpErrorReturnsHttpErrorOutcomeWithStatusAndBody(): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ ErrorCode: 300, Message: "Invalid" }), {
      status: 422,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;

  const client = new PostmarkEmailSendClientService();
  let outcome;
  try {
    outcome = await client.send(sendParams);
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(outcome, {
    kind: "http_error",
    httpStatus: 422,
    body: { ErrorCode: 300, Message: "Invalid" }
  });
  console.log("✓ non-2xx response -> kind:'http_error' carrying httpStatus + parsed body");
}

async function testNetworkErrorReturnsNetworkErrorOutcomeWithMessage(): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("The operation was aborted.");
  }) as typeof fetch;

  const client = new PostmarkEmailSendClientService();
  let outcome;
  try {
    outcome = await client.send(sendParams);
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(outcome, { kind: "network_error", message: "The operation was aborted." });
  console.log("✓ thrown fetch error (e.g. abort/timeout) -> kind:'network_error' with the message");
}

async function testMalformedJsonBodyFallsBackToEmptyObject(): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;

  const client = new PostmarkEmailSendClientService();
  let outcome;
  try {
    outcome = await client.send(sendParams);
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(outcome, { kind: "success", httpStatus: 200, body: {} });
  console.log("✓ unparseable response body -> falls back to {} rather than throwing");
}

async function run(): Promise<void> {
  await testSuccessReturnsSuccessOutcomeWithParsedBody();
  await testHttpErrorReturnsHttpErrorOutcomeWithStatusAndBody();
  await testNetworkErrorReturnsNetworkErrorOutcomeWithMessage();
  await testMalformedJsonBodyFallsBackToEmptyObject();
  console.log("\n✅ All postmark-email-send.client tests passed");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
