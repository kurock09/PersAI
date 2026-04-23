import assert from "node:assert/strict";
import { isUuidLikeIdempotencyKey } from "../src/modules/turns/turn-context-hydration.service";

// ADR-074 F1: regression for the silent presence-baseline crash.
//
// `AssistantChatMessage.id` is a Postgres `uuid` column. The presence
// baseline lookup originally passed `id: { not: input.idempotencyKey }`
// straight into a Prisma `findFirst`, but `RuntimeTurnRequest.idempotencyKey`
// is a free-form string — for example scheduled actions inject
// `"scheduled-action:<externalRef>:<runAtMs>"`. Postgres rejected every such
// query with `Inconsistent column data: Error creating UUID, … found 's' at
// 1`, the catch swallowed the error, and presence rendered with null
// timestamps on EVERY non-UUID-keyed turn — fully defeating T1 sense-of-time.
//
// `isUuidLikeIdempotencyKey` is the single gate the lookup uses now. Pin its
// behaviour so a future refactor cannot widen it to accept the strings that
// caused the original outage.

function runRejectsScheduledActionShapeTest(): void {
  assert.equal(isUuidLikeIdempotencyKey("scheduled-action:abc:123"), false);
  assert.equal(isUuidLikeIdempotencyKey("scheduled-action:c1d2:1761600000000"), false);
}

function runRejectsRandomStringsTest(): void {
  assert.equal(isUuidLikeIdempotencyKey(""), false);
  assert.equal(isUuidLikeIdempotencyKey("hello"), false);
  assert.equal(isUuidLikeIdempotencyKey("00000000-0000-0000-0000-00000000000"), false);
  assert.equal(isUuidLikeIdempotencyKey("00000000-0000-0000-0000-0000000000000"), false);
  assert.equal(isUuidLikeIdempotencyKey("not-a-uuid-at-all"), false);
  assert.equal(isUuidLikeIdempotencyKey(null), false);
  assert.equal(isUuidLikeIdempotencyKey(undefined), false);
}

function runAcceptsCanonicalUuidTest(): void {
  assert.equal(isUuidLikeIdempotencyKey("12345678-1234-1234-1234-123456789012"), true);
  assert.equal(isUuidLikeIdempotencyKey("ABCDEF12-3456-7890-ABCD-EF1234567890"), true);
}

async function main(): Promise<void> {
  runRejectsScheduledActionShapeTest();
  runRejectsRandomStringsTest();
  runAcceptsCanonicalUuidTest();
  console.log("presence baseline UUID guard OK");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
