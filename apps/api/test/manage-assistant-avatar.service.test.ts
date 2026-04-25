import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildAssistantAvatarUrl,
  extractAvatarHashFromUrl
} from "../src/modules/workspace-management/application/manage-assistant-avatar.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

  // ADR-076 follow-up (2026-04-25): server normalizes every avatar to JPEG
  // before hashing, so the URL extension is always `.jpg` and the hash is
  // taken from the normalized bytes (input to `buildAssistantAvatarUrl`).
  const normalized = Buffer.from("hello-normalized-jpeg-bytes");
  const expectedHash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);

  assert.equal(buildAssistantAvatarUrl(normalized), `/api/avatar/${expectedHash}.jpg`);

  assert.equal(extractAvatarHashFromUrl(null), null);
  assert.equal(extractAvatarHashFromUrl("https://legacy.example.com/avatar.png"), null);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedHash}.jpg`), expectedHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedHash}.png`), expectedHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedHash}`), expectedHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/zzzzz.png`), null);
}

void run();
