/**
 * ADR-169 repair — the per-workspace refresh-lock acquire timeout must not
 * be shorter than the provider HTTP round trip it waits on
 * (`MailboxOAuthTokenRefreshClientService.refresh`'s abort timeout, plus the
 * lock winner's secret-store resolves and Prisma update): a shorter acquire
 * timeout lets a waiting concurrent send give up before the winner's own
 * refresh could possibly have finished, failing a send the winner's refresh
 * would have unblocked a moment later. This locks the derived relationship
 * in place rather than two independently-chosen magic numbers that can
 * silently drift apart again.
 */
import assert from "node:assert/strict";
import { MAILBOX_REFRESH_LOCK_ACQUIRE_TIMEOUT_MS } from "../src/modules/workspace-management/application/mailbox-token-lifecycle.service";
import { MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS } from "../src/modules/workspace-management/application/mailbox-oauth-token-refresh.client";

function run(): void {
  assert.ok(
    MAILBOX_REFRESH_LOCK_ACQUIRE_TIMEOUT_MS > MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS,
    "the lock acquire timeout must exceed the provider refresh HTTP timeout it guards"
  );
  console.log(
    "✓ the refresh-lock acquire timeout (" +
      String(MAILBOX_REFRESH_LOCK_ACQUIRE_TIMEOUT_MS) +
      "ms) exceeds the provider refresh HTTP timeout it guards (" +
      String(MAILBOX_OAUTH_REFRESH_HTTP_TIMEOUT_MS) +
      "ms)"
  );
  console.log("\n✅ All mailbox-refresh-lock-timeout tests passed");
}

run();
