import assert from "node:assert/strict";
import { TelegramBotClientService } from "../src/modules/workspace-management/application/telegram-bot.client.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

  // ADR-076 Slice 4 follow-up (2026-04-25 founder report): publish was sending
  // the avatar buffer as a raw multipart `photo` part, but Bot API 9.x expects
  // `photo` to be a JSON-encoded `InputProfilePhotoStatic` envelope and the
  // bytes attached under the `attach://<name>` reference. Telegram silently
  // returned 400 (`PHOTO_INVALID_DIMENSIONS` or `Bad Request`), the publish
  // service's outer try/catch swallowed it as a non-fatal warn, and the bot
  // avatar never updated even though `setMyName` worked. Pin the wire shape.

  const calls: Array<{ url: string; payloadEntries: Array<[string, unknown]> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body;
    const entries: Array<[string, unknown]> = [];
    if (body instanceof FormData) {
      for (const [key, value] of body.entries()) {
        entries.push([
          key,
          value instanceof Blob
            ? { kind: "Blob", size: value.size, type: value.type }
            : String(value)
        ]);
      }
    }
    calls.push({ url, payloadEntries: entries });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const service = new TelegramBotClientService(null as never);
    await service.setBotProfilePhoto({
      botToken: "bot-token-test",
      buffer: Buffer.from("avatar-bytes"),
      filename: "assistant-avatar.jpg"
    });

    assert.equal(calls.length, 1, "expected exactly one Telegram API call");
    const call = calls[0];
    if (!call) throw new Error("missing call recording");
    assert.equal(
      call.url,
      "https://api.telegram.org/botbot-token-test/setMyProfilePhoto",
      "call must hit setMyProfilePhoto endpoint"
    );

    const photoEntry = call.payloadEntries.find(([key]) => key === "photo");
    assert.ok(photoEntry, "multipart body must include `photo` field");
    const photoValue = photoEntry[1];
    assert.equal(typeof photoValue, "string", "photo field must be a string (JSON envelope)");
    const photoEnvelope = JSON.parse(photoValue as string) as { type: string; photo: string };
    assert.equal(photoEnvelope.type, "static", "envelope must declare static profile photo");
    assert.match(
      photoEnvelope.photo,
      /^attach:\/\/[a-z_][a-z0-9_]*$/i,
      "envelope must reference a multipart attachment via attach://"
    );

    const attachmentField = photoEnvelope.photo.replace(/^attach:\/\//, "");
    const attachmentEntry = call.payloadEntries.find(([key]) => key === attachmentField);
    assert.ok(
      attachmentEntry,
      `multipart body must contain the file under field "${attachmentField}"`
    );
    const attachmentValue = attachmentEntry[1] as { kind: string; size: number };
    assert.equal(attachmentValue.kind, "Blob", "attached file must be a Blob");
    assert.equal(
      attachmentValue.size,
      Buffer.from("avatar-bytes").length,
      "attached file size must match the buffer we passed"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
