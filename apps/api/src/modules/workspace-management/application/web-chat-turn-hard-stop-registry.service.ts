import { Injectable, Logger } from "@nestjs/common";

/**
 * Pre-prod polish 2026 / FIX 1, Slice 1.2 — server-side soft-detach.
 *
 * Background. Before this slice, the SSE controller in `assistant.controller.ts`
 * registered a single `clientAbortController` and aborted the runtime turn
 * on *any* client disconnect — both `req.on("aborted")` and `res.on("close")`
 * fed the same abort signal directly into `streamToCompletion` →
 * `combineAbortSignals` → the runtime fetch. So a user backgrounding their
 * tab, locking the phone screen, walking out of WiFi, or simply navigating
 * to a different chat truncated the runtime turn at whatever point it had
 * reached. If a long tool (image_generate, video_generate) was mid-flight,
 * the side-channel never finished and the persisted assistant message was
 * a stub. Telegram parity testing confirmed the bug: lock screen mid-image
 * → return → user sees a half-message with no image.
 *
 * Slice 1.2 splits the two cases:
 *   - **Soft-disconnect** (SSE socket dies because the client tab/screen
 *     went away): no abort is propagated to the runtime. The turn finishes
 *     server-side, the existing persistence path stores the full assistant
 *     message, and the client picks it up via the next history fetch.
 *   - **Hard-stop** (user pressed the Stop button): the new
 *     `POST /assistant/chat/web/stop` endpoint dispatches an explicit hard
 *     abort. The runtime sees an aborted signal and bails through the
 *     existing `client-aborted` → `persistInterruptedOutcome` path.
 *
 * This registry is the in-memory dispatch table that lets the new endpoint
 * find a turn's `AbortController`. Keys are `clientTurnId` (already required
 * by the streaming endpoint and propagated end-to-end through
 * `streamWebChatTurnService.prepare`/`streamToCompletion`). Each entry also
 * carries the owning `userId` so the Stop endpoint can refuse cross-user
 * dispatch attempts cheaply (defense-in-depth on top of the controller's
 * normal `resolveRequestUserId` auth).
 *
 * Multi-replica caveat. The registry is process-local. In a single-replica
 * dev/staging deployment (current path) this is sufficient. In a future
 * multi-replica deployment, a Stop POST that lands on a replica which does
 * not own the turn will fail with `404 turn_not_found`; the client falls
 * back to the local SSE-socket abort, which is the pre-Slice-1.2 behavior
 * — strictly no worse than today. Cross-replica routing (sticky session or
 * pubsub broadcast) is recorded as a known residual under ADR-073 and is
 * not part of this slice.
 */

interface RegisteredTurn {
  controller: AbortController;
  userId: string;
  registeredAt: number;
}

@Injectable()
export class WebChatTurnHardStopRegistry {
  private readonly logger = new Logger(WebChatTurnHardStopRegistry.name);
  private readonly turns = new Map<string, RegisteredTurn>();

  /**
   * Register an in-flight turn so the matching Stop POST can find it.
   * Idempotent: if a turn with the same `clientTurnId` is already
   * registered (which can happen with rapid client retries that hit the
   * same `clientTurnId` while the previous SSE handler is still cleaning
   * up), the older entry is dropped without aborting it — the
   * caller-controlled `release` path handles teardown of the older
   * controller via the SSE handler that owns it.
   */
  register(input: { clientTurnId: string; userId: string; controller: AbortController }): void {
    const existing = this.turns.get(input.clientTurnId);
    if (existing !== undefined) {
      this.logger.warn(
        `[hard-stop-registry] reregister clientTurnId=${input.clientTurnId} userId=${input.userId} (replacing prior entry registered at ${new Date(existing.registeredAt).toISOString()})`
      );
    }
    this.turns.set(input.clientTurnId, {
      controller: input.controller,
      userId: input.userId,
      registeredAt: Date.now()
    });
  }

  /**
   * Remove the registry entry for a finished/cancelled turn. Safe to call
   * from `finally` blocks; if the entry was already replaced by a newer
   * registration (rapid retry path) we leave the newer entry alone — only
   * the SSE handler that registered *this exact* controller is allowed to
   * release it.
   */
  release(input: { clientTurnId: string; controller: AbortController }): void {
    const existing = this.turns.get(input.clientTurnId);
    if (existing === undefined) {
      return;
    }
    if (existing.controller !== input.controller) {
      // A newer registration replaced ours; do not delete.
      return;
    }
    this.turns.delete(input.clientTurnId);
  }

  /**
   * Dispatch a hard-stop to the named turn. Returns `true` when an entry
   * was found and `controller.abort()` was called; returns `false` when no
   * such turn is registered (the SSE handler may already have finished, or
   * the request landed on the wrong replica). Authorization is enforced
   * by `userId` match; mismatched userId returns `false` without leaking
   * the turn's existence — the controller layer already rejected the
   * request via auth before reaching this method, so this is the second
   * line of defense, not the first.
   */
  signalHardStop(input: { clientTurnId: string; userId: string }): boolean {
    const entry = this.turns.get(input.clientTurnId);
    if (entry === undefined) {
      return false;
    }
    if (entry.userId !== input.userId) {
      this.logger.warn(
        `[hard-stop-registry] cross-user stop refused clientTurnId=${input.clientTurnId} actualOwner=${entry.userId} attemptedBy=${input.userId}`
      );
      return false;
    }
    entry.controller.abort();
    this.turns.delete(input.clientTurnId);
    return true;
  }

  /**
   * Visible-for-testing accessor used by the API test fixtures to assert
   * that the registry contains / does not contain a given turn at a known
   * point in the SSE lifecycle. Production code paths use only `register`,
   * `release`, and `signalHardStop`.
   */
  hasForTesting(clientTurnId: string): boolean {
    return this.turns.has(clientTurnId);
  }
}
