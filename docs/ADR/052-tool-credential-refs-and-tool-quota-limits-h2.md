# ADR-052: Tool credential refs and tool quota limits baseline (H2)

## Status

Accepted

## Context

`H1b` proved the global runtime provider settings pattern:

- PersAI stores encrypted provider keys and emits `persai`-source secret refs
- OpenClaw resolves those refs through an internal PersAI endpoint
- platform admins manage provider/model defaults from a dedicated admin UI

However, several OpenClaw tools require their own API credentials that are separate from the LLM provider key:

- `web_search` — search provider API key (Google, Bing, or similar)
- `web_fetch` — optional Firecrawl API key for structured page parsing
- `image_generate` — image generation provider key (DALL-E, Stability, etc.)
- `tts` — text-to-speech provider key (OpenAI TTS, ElevenLabs, etc.)
- `memory_search` — remote embeddings provider key (OpenAI embeddings, Voyage, etc.)

Currently these credentials live only in OpenClaw env/config. PersAI cannot govern which tools get credentials or rotate them without Kubernetes-level secret management.

The tool catalog now has 8 entries (expanded from the original 3). Each tool is individually governed by plan activation and daily call limits to prevent runaway token consumption.

The current quota system has a single `cost_or_token_driving_tool_class` dimension. This is too coarse — an admin should be able to limit `image_generate` to 20/day while allowing 200/day for `web_search`.

## Decision

1. **Expand the tool catalog to 8 entries.**

   New tool entries with appropriate class and capability group:
   - `web_fetch` — `cost_driving` / `knowledge`
   - `image_generate` — `cost_driving` / `knowledge`
   - `tts` — `cost_driving` / `communication`
   - `browser` — `cost_driving` / `knowledge`
   - `memory_search` — `utility` / `workspace_ops`

   Existing entries stay unchanged:
   - `web_search` — `cost_driving` / `knowledge`
   - `memory_get` — `utility` / `workspace_ops`
   - `cron` — `utility` / `workspace_ops`

2. **Extend the encrypted secret store for tool credentials.**

   Reuse the existing `PlatformRuntimeProviderSecret` table and `PlatformRuntimeProviderSecretStoreService` infrastructure. The `providerKey` column becomes a general-purpose credential identifier that covers both provider keys (`openai`, `anthropic`) and tool credential keys (`tool_web_search`, `tool_web_fetch`, `tool_image_generate`, `tool_tts`, `tool_memory_search`).

   Tool credential IDs follow the pattern `tool/<tool_code>/api-key` in the persai secret-ref namespace.

3. **Add per-tool daily call limits to plan activation.**

   Extend `PlanCatalogToolActivation` with an optional `dailyCallLimit` column. When `null`, the tool has no call-count limit (but still governed by `token_budget`). When set, PersAI tracks daily usage per tool per workspace and materializes the limit into the OpenClaw spec.

4. **Add a workspace-level daily tool usage counter.**

   New table `WorkspaceToolUsageDailyCounter` tracks `(workspaceId, toolCode, date, callCount)`. Counters reset daily. The counter is the source of truth for enforcing `dailyCallLimit`.

5. **Extend `ToolCatalogTool.providerHints` to declare credential requirements.**

   `providerHints` gains a `requiredCredentialId` field (nullable string) that maps to a `PlatformRuntimeProviderSecret.providerKey`. Tools with `providerHints.providerAgnostic = true` and no `requiredCredentialId` do not require separate credentials.

6. **Add a dedicated admin API for tool credential management.**

   - `GET /api/v1/admin/runtime/tool-credentials` — returns tool catalog with credential status (configured, lastFour, updatedAt) for each tool that requires credentials
   - `PUT /api/v1/admin/runtime/tool-credentials` — accepts write-only raw keys for tool credentials, triggers reapply

   `PUT` is a dangerous admin action and requires step-up (`admin.tool_credentials.update`).

7. **Extend the internal secret-resolution endpoint.**

   The existing `POST /api/v1/internal/runtime/provider-secrets/resolve` already accepts generic secret IDs. Extend the `PROVIDER_BY_SECRET_ID` map and `resolveSecretValueById` to handle tool credential IDs (`tool/<code>/api-key`) in addition to provider credential IDs (`openai/api-key`, `anthropic/api-key`).

8. **Materialization includes tool credential refs and quota policy.**

   The materialized `openclawBootstrap` gains:
   - `governance.toolCredentialRefs` — maps each tool that requires credentials to its `persai`-source secret ref
   - `governance.toolQuotaPolicy` — maps each tool to its `dailyCallLimit` and current day usage

   OpenClaw can use these to:
   - resolve tool credentials through the same internal PersAI endpoint
   - enforce or report daily call limits and communicate them to the user through the assistant

9. **The assistant communicates limit status naturally.**

   When a tool call approaches or exceeds its daily limit, the information travels through the LLM context:
   - at 80%+ usage: a system-prompt hint suggests the assistant mention remaining budget
   - at limit: the tool returns a structured `daily_limit_reached` error that the LLM translates into a natural message ("Your daily search limit is reached. Try again tomorrow or upgrade your plan.")

   No separate notification system is needed — the assistant is the communication channel.

## Consequences

### Positive

- Every tool that needs a separate API credential is now manageable from PersAI admin UI without Kubernetes secret rotation.
- Plans can individually enable/disable each tool and set daily call limits, giving fine-grained control over cost.
- The reuse of the existing encrypted secret store and internal resolve endpoint minimizes new infrastructure.
- Daily call limits plus the existing token budget create two-tier cost protection without complex credit systems.
- The assistant naturally communicates limit status to the user.

### Trade-offs

- The `PlatformRuntimeProviderSecret.providerKey` column now carries both provider and tool credential identifiers; naming becomes slightly overloaded.
- Daily counter tracking adds a new table and requires periodic cleanup of old date rows.
- The expanded tool catalog (8 entries) requires seed data updates and broader plan activation management.

## Out of scope

- Per-user model picker or tool marketplace
- Runtime tool execution logic (stays in OpenClaw)
- Telegram / WhatsApp / MAX channel credential management (H4/H5)
- Credit-based billing or monetary cost accounting
- Real-time token-level tracking per tool call (covered by existing `token_budget`)

## Relation to prior ADRs

- [ADR-049](049-platform-admin-runtime-control-plane-phasing.md) — H2 is the next approved slice in the north-star program
- [ADR-051](051-global-runtime-provider-settings-h1b.md) — H2 reuses the encrypted secret store and internal resolve infrastructure from H1b
- [ADR-031](031-tool-catalog-and-activation-model-e1.md) — H2 extends the tool catalog and plan activation model with new entries and daily limits
- [ADR-028](028-quota-accounting-baseline-p5.md) — H2 adds per-tool daily counters alongside the existing quota accounting dimensions
- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — tool credential refs travel through the same materialization/apply path
