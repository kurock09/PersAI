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

  const png = Buffer.from("hello-png-bytes");
  const jpg = Buffer.from("hello-jpeg-bytes");

  const expectedPngHash = createHash("sha256").update(png).digest("hex").slice(0, 16);
  const expectedJpgHash = createHash("sha256").update(jpg).digest("hex").slice(0, 16);

  assert.equal(buildAssistantAvatarUrl(png, "image/png"), `/api/avatar/${expectedPngHash}.png`);
  assert.equal(buildAssistantAvatarUrl(jpg, "image/jpeg"), `/api/avatar/${expectedJpgHash}.jpg`);
  assert.equal(buildAssistantAvatarUrl(jpg, "image/JPEG"), `/api/avatar/${expectedJpgHash}.jpg`);
  assert.equal(
    buildAssistantAvatarUrl(png, "application/x-rogue"),
    `/api/avatar/${expectedPngHash}.bin`
  );

  assert.equal(extractAvatarHashFromUrl(null), null);
  assert.equal(extractAvatarHashFromUrl("https://legacy.example.com/avatar.png"), null);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedPngHash}.png`), expectedPngHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/${expectedPngHash}`), expectedPngHash);
  assert.equal(extractAvatarHashFromUrl(`/api/avatar/zzzzz.png`), null);
}

void run();
