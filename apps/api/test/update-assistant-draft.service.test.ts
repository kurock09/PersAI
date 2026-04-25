import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { UpdateAssistantDraftService } from "../src/modules/workspace-management/application/update-assistant-draft.service";

async function run(): Promise<void> {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
  process.env.PERSAI_INTERNAL_API_TOKEN =
    process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

  // parseInput does not touch the repositories or audit service, so stubbing
  // them with `null as never` keeps the test focused on the validator we
  // actually changed.
  const service = new UpdateAssistantDraftService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never
  );

  // ADR-076 Slice 4 follow-up (2026-04-25 founder report): the assistant
  // settings "Save" path PATCHes the lifecycle-emitted avatarUrl back to
  // /assistant/draft, which now arrives as `/api/avatar/<hash>.<ext>`. The
  // pre-fix validator forced `https://` and rejected every save attempt
  // with "avatarUrl must use the https:// scheme."; lock the new shape in.
  const acceptedHashedJpg = service.parseInput({
    avatarUrl: "/api/avatar/abcdef0123456789.jpg"
  });
  assert.equal(acceptedHashedJpg.avatarUrl, "/api/avatar/abcdef0123456789.jpg");

  const acceptedHashedNoExt = service.parseInput({
    avatarUrl: "/api/avatar/0123456789abcdef"
  });
  assert.equal(acceptedHashedNoExt.avatarUrl, "/api/avatar/0123456789abcdef");

  const acceptedLegacyHttps = service.parseInput({
    avatarUrl: "https://cdn.example.com/avatar.png"
  });
  assert.equal(acceptedLegacyHttps.avatarUrl, "https://cdn.example.com/avatar.png");

  // Defense-in-depth: relative paths outside `/api/avatar/` and non-https
  // schemes (javascript:, file://, data:) must still be rejected so the
  // surface that ADR-067 hardened around does not regress.
  let rejectedRelative: unknown = null;
  try {
    service.parseInput({ avatarUrl: "/etc/passwd" });
  } catch (err) {
    rejectedRelative = err;
  }
  assert.ok(
    rejectedRelative instanceof BadRequestException,
    "relative paths outside /api/avatar/ must be rejected"
  );

  let rejectedJavascript: unknown = null;
  try {
    service.parseInput({ avatarUrl: "javascript:alert(1)" });
  } catch (err) {
    rejectedJavascript = err;
  }
  assert.ok(
    rejectedJavascript instanceof BadRequestException,
    "javascript: scheme must be rejected"
  );

  let rejectedHttp: unknown = null;
  try {
    service.parseInput({ avatarUrl: "http://insecure.example.com/x.png" });
  } catch (err) {
    rejectedHttp = err;
  }
  assert.ok(rejectedHttp instanceof BadRequestException, "http:// scheme must be rejected");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
