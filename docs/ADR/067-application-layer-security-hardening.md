# ADR-067: Application-Layer Security Hardening

## Status

Accepted

## Context

A security audit (code + live GKE cluster) after Wave 1-3 infrastructure hardening revealed five application-layer gaps:

1. **Media storage quota not enforced.** The `media_storage_bytes` quota dimension exists in the DB schema and plan catalog, but `incrementUsage("media_storage_bytes")` is never called during file upload. Users can upload unlimited media.
2. **Rate limit keyed per-owner, not per-peer.** `EnforceAbuseRateLimitService` keys its user-level counter on the PersAI owner's `userId`. For Telegram, all external peers share one bucket — a single spammer exhausts the owner's rate limit.
3. **No draft string length validation.** `displayName`, `instructions`, and `avatarUrl` pass through `normalizeOptionalDraftField()` without max-length guards. A 10 MB instructions payload causes DB bloat and DoS.
4. **`avatarUrl` not validated.** Accepts any string including `javascript:`, `data:`, or `ftp:` schemes. Potential stored XSS if rendered unsafely.
5. **Ingress NetworkPolicy only covers free pool.** `openclaw-ingress-baseline` selector targets `persai.dev/runtime-pool=free_shared_restricted_sandbox` only. Paid-shared and paid-isolated pools have no ingress restriction.

## Decision

### D1 — Media quota enforcement

`ManageChatMediaService` and `InboundMediaService` call `TrackWorkspaceQuotaUsageService.recordMediaUpload()` on the media upload path. `ManageChatMediaService` keeps a cheap pre-check, while the authoritative guard is the shared-state media-byte apply path: if the full object no longer fits the remaining workspace media-storage budget, the uploaded blob is deleted and the attachment is not retained.

### D2 — Per-peer Telegram rate limit

`EnforceAbuseRateLimitService` gains an in-memory sliding-window counter keyed by `assistantId:surface:peerKey`. For Telegram turns, `threadId` (the Telegram chat session key) is passed as `peerKey`. Limits are configurable via `ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE` and `ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE`. The in-memory approach is acceptable because:
- Each API pod independently enforces limits (effective per-pod, which is protective enough)
- No DB migration required
- Stale entries are garbage-collected periodically

### D3 — Draft string length limits

`UpdateAssistantDraftService.parseInput()` enforces:
- `displayName`: max 100 characters
- `instructions`: max 50,000 characters
- `avatarEmoji`: max 8 characters (already constrained by Prisma `@db.VarChar(8)`)

### D4 — avatarUrl validation

`UpdateAssistantDraftService.parseInput()` validates `avatarUrl`:
- Must start with `https://`
- Must parse as a valid URL (`new URL()`)
- Max 2048 characters

### D5 — NetworkPolicy for all pools

`openclaw-ingress-baseline` selector removes `persai.dev/runtime-pool` restriction so the ingress policy applies to all openclaw pods regardless of pool. After ADR-066, all external webhook traffic enters via the API proxy, so openclaw pods only need ingress from API pods and GKE health-check CIDRs.

## Consequences

- Media storage is now enforced on the touched upload-retention paths. Existing over-quota workspaces are not repaired retroactively, and this ADR does not by itself claim perfect long-term byte reconciliation for every later delete path.
- Per-peer rate limiting is in-memory and resets on pod restart. This is acceptable for initial protection. A persistent store can be added later if needed.
- Draft length limits may reject payloads that were previously accepted. The chosen limits (100 / 50,000) are generous for legitimate use.
- NetworkPolicy change is safe because ADR-066 already moved all external traffic through the API proxy.
