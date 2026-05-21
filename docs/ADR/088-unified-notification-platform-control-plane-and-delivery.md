# ADR-088 — Unified Notification Platform: Control Plane, Delivery, and Semantic Channels

**Status:** Accepted  
**Date:** 2026-05-09  
**Authors:** PersAI engineering

---

## Context

The PersAI notification platform (ADR-088 baseline + Slice 2.5 multi-user correction + Slice 3 billing policy + Slice 4 legacy admin removal) shipped with several gaps that made operator administration confusing and delivery semantically incorrect:

1. User-facing notification sources (`reminder`, `idle_reengagement`, `background_task_push`, `quota_advisory`) hardcoded concrete channels (`telegram_thread`, `web_thread`) that ignored the user's own `assistant.preferredNotificationChannel` setting.
2. The `quota_advisory` producer hardcoded a surface-specific channel override instead of letting policy decide.
3. The admin Policies UI exposed `renderStrategy` as an editable dropdown and presented a confusing Postmark Template ID field (functionally a no-op at the channel level, not connected to real delivery).
4. Billing email test lived in the Channels tab alongside the Postmark template JSON editor — wrong conceptual location.
5. `web_thread` was offered as a `quota_advisory` default channel even though it requires a specific `chatId` that is not always available.

This ADR records all decisions made in the "Notifications Admin PROD Cleanup" slice to address these gaps.

---

## Decisions

### D1 — Semantic channels `user_preferred` and `current_thread`

Two new semantic values are added to the `NotificationChannelType` Prisma enum via migration `20260509110000_adr088_semantic_channels`:

- **`user_preferred`** — expanded at delivery time by reading `assistant.preferredNotificationChannel`:
  - `"telegram"` → `telegram_thread` (only when an active Telegram binding exists)
  - anything else → `web_notification_center`
- **`current_thread`** — expanded at delivery time by reading `intent.surface` + `intent.chatId`:
  - `"telegram"` → `telegram_thread`
  - `"web"` → `web_thread`
  - else → not resolvable (fail or escalate)

These are NOT real adapters. No `notification_channel_registry` row is created for them. The `ResolveWorkspaceNotificationChannelsService` returns `{ available: true }` for them so the delivery worker picks them up; the worker then calls `NotificationRoutingService.expandSemanticChannel(...)` before adapter selection.

### D2 — `user_preferred` unresolvable → escalation or fail

If `user_preferred` cannot be expanded (e.g. no assistant or binding):
- If the policy has an `escalationChannel` → route to escalation.
- If no escalation → mark intent `failed` with `failureReason=user_preferred_unavailable`.

No silent fallback. The operator must configure an escalation channel if they want guaranteed delivery.

### D3 — `current_thread` unresolvable → fail

If `current_thread` cannot be expanded (no surface context on intent):
- Mark intent `failed` with `failureReason=current_thread_context_missing`.
- No escalation path: this source is inherently in-thread and an escalation would be confusing.

### D4 — Policy defaults rewrite

| Source | channels | escalationChannel |
|---|---|---|
| `idle_reengagement` | `["user_preferred"]` | `web_notification_center` |
| `quota_advisory` | `["current_thread"]` | `null` |
| `reminder` | `["user_preferred"]` | `web_notification_center` |
| `background_task_push` | `["user_preferred"]` | `web_notification_center` |
| `billing_lifecycle` | `["email"]` | `admin_webhook` |
| `system_event` | `["admin_webhook"]` | `null` |
| `admin_system` | `["user_preferred"]` | `null` |

### D5 — Producer cleanup

Hardcoded `allowedChannels` overrides removed from user-facing producers:
- `quota-advisory-follow-up.service.ts` — no longer passes `["telegram_thread"]`/`["web_thread"]`; passes `surface` + `chatId` so `current_thread` can be expanded by the worker.
- `billing-lifecycle-producer.service.ts` — intentionally kept (`["email"]` primary, `["web_notification_center"]` optional push). These are direct producer decisions, not policy shortcuts.
- `system-event-notification-producer.service.ts` — kept (`["admin_webhook"]`); operational.
- `admin-system-notification-producer.service.ts` — `admin_system` is reactivated as the single admin push/digest source. Operators configure recipient assistant ids, enabled event codes, and the daily report time in `notification_policies.config`; delivery then reuses the ordinary `user_preferred` reminder path for those assistants.

### D6 — Postmark TemplatedEmail

`EmailChannelAdapter` now has two delivery modes:

- **Raw** (`POST /email`): used when `channelConfig.config.postmarkTemplateId` is absent. Behavior unchanged.
- **Templated** (`POST /email/withTemplate`): used when `postmarkTemplateId` is a non-empty number or string. `TemplateModel` carries rendered text fields plus raw `factPayload`.

The delivery worker merges `intent.policySnapshot.config` into the channel config it passes to adapters, so `postmarkTemplateId` stored on the `billing_lifecycle` policy reaches the email adapter without a separate policy lookup.

### D7 — Per-source Test endpoint

New `POST /api/v1/admin/notifications/policies/:source/test` endpoint. Body: `{ eventCode?, channelOverride? }`.

- For `billing_lifecycle`: auto-builds deterministic demo facts for the selected `eventCode` (one of `trial_ending | trial_expired | renewal_failed | grace_ending | grace_expired | payment_recovered`). Routes through the real email pipeline including Postmark Template ID if set.
- For other sources: builds a minimal `{ message: "Test..." }` fact payload and routes through the policy's default channel.
- In both cases: semantic channels (`user_preferred`, `current_thread`) are resolved to `web_notification_center` for test purposes.

### D8 — `grounded_llm` is NOT an LLM call from the notification platform

`grounded_llm` is, and permanently stays, a **pre-rendered pass-through**:
- For `reminder`, `idle_reengagement`, `background_task_push`, `quota_advisory` — the assistant runtime already generates the user-facing text with full chat context and passes it via `factPayload.pushText`. The notification platform forwards it.
- A second LLM call inside the notification platform would lose chat context, double-bill tokens, and risk inconsistent tone.
- Billing MUST NOT use LLM (text must be deterministic for legal/financial correctness).
- There is **no planned future ADR** for a notification-side LLM call. The enum value `grounded_llm` is kept to avoid a breaking schema/contract change.

The admin Policies UI labels it: `"pre-rendered (runtime-generated)"` and shows an explanatory note.

### D9 — Admin UI: Policies tab

Per-source form changes:
- `renderStrategy` is now **read-only info** with a one-line explanation per value.
- `Channels (current)` is a read-only bullet list.
- `Default channel` dropdown is limited to source-appropriate options (per D4 table).
- `Escalation channel` dropdown limited to real transport channels.
- `Postmark Template ID` input is visible only for `billing_lifecycle`.
- `LLM instruction` field removed (out of scope for this slice).
- Per-source **Test** button sends a real test notification; billing sources also show an event-code picker.

### D10 — Admin UI: Channels tab

- `user_preferred` and `current_thread` are filtered from the channel list (they have no real adapter and no registry row).
- Email template picker (billing template + JSON facts editor) removed from Channels tab. Billing email testing moves to Policies tab.
- Channel-level Test remains as raw connectivity ping (`static_fallback`).

---

## Consequences

- Operators now configure `user_preferred` / `current_thread` in policies; the platform delivers to each user's actual preferred surface.
- `admin_system` is no longer a dead legacy row: it now owns admin realtime push + daily digest delivery through configured admin assistants instead of a dedicated transport-specific channel concept.
- Billing escalates to `admin_webhook` on email failure rather than silently dead-lettering.
- Postmark template integration is now a one-field configuration, not a code-level template ID.
- No breaking changes to existing intents or delivery attempts. Old `telegram_thread`/`web_thread` entries in `notification_intents.allowed_channels` continue to route correctly through existing adapter paths.
- `grounded_llm` semantics clarified permanently; no second LLM call will be introduced at the notification layer.
