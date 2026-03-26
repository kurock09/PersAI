# ADR-054: Config generation lazy invalidation (H3.1)

## Status

Accepted

## Context

H3 delivered deep runtime hydration — 7 Markdown bootstrap documents, per-user workspace isolation, memory delegation. However, the materialized spec that OpenClaw consumes becomes stale whenever any of its 8 upstream data sources change:

1. **Global provider settings** (provider, model, keys) — the only source with auto-propagation today, via an O(N) sequential inline reapply loop in `ManageAdminRuntimeProviderSettingsService.updateSettings`. At 1,000+ workspaces the admin HTTP request blocks for minutes; at 5,000–10,000 it is catastrophic.
2. **Plan catalog** (entitlements, `billingProviderHints.primaryModelKey`, tool activations) — admin changes have no auto-propagation.
3. **Bootstrap presets** (SOUL, USER, IDENTITY, AGENTS templates) — admin changes have no auto-propagation.
4. **Tool catalog** — seed/admin changes have no auto-propagation.
5. **User profile** (birthday, name, gender) — onboarding changes have no auto-propagation.
6. **Workspace locale/timezone** — onboarding changes have no auto-propagation.
7. **Channel bindings** (Telegram connect/revoke) — no auto-propagation.
8. **Subscription** (workspace plan code) — billing not wired yet, but hook must be ready.

The ROADMAP entry for H3.1 states: "eliminate full re-materialization on global settings change; introduce `settingsGeneration` lazy-invalidation so OpenClaw pulls fresh provider/model on demand instead of rebuilding all bootstraps (critical at scale ≥1 000 workspaces)."

We generalize the scope from provider settings only to **all 8 sources**.

## Decision

### Two-tier lazy invalidation

**Tier 1 — global `configGeneration` counter** for admin-wide changes:

- New singleton table `PlatformConfigGeneration` with monotonically increasing `generation` integer.
- Atomically incremented on every admin write that affects materialization: provider settings, plan catalog create/update, bootstrap preset update, tool catalog changes.
- Each `AssistantMaterializedSpec` records `materializedAtConfigGeneration` — the global generation it was built against.
- The generation value is embedded in `openclawBootstrap.governance.configGeneration` so OpenClaw can compare locally without an HTTP call.

**Tier 2 — per-assistant `configDirtyAt` timestamp** for user-scoped changes:

- New nullable `configDirtyAt` column on `Assistant`.
- Set to `NOW()` when per-user data that flows into materialization changes: user profile, workspace locale/timezone, channel bindings, subscription.
- Cleared to `NULL` after successful materialization.
- Compared against `AssistantMaterializedSpec.createdAt` by the freshness endpoint.

### Mass reapply elimination

`ManageAdminRuntimeProviderSettingsService.reapplyLatestPublishedVersions()` is removed entirely. Admin settings save persists data, bumps `configGeneration`, and returns immediately. No other admin service has mass-reapply logic.

### OpenClaw freshness check at chat time

Two new PersAI internal endpoints (authenticated with `OPENCLAW_GATEWAY_TOKEN`):

1. **`GET /internal/v1/runtime/config-generation`** — returns `{ generation: number }`. Single row read, cacheable.
2. **`POST /internal/v1/runtime/ensure-fresh-spec`** — accepts `{ assistantId, publishedVersionId, currentConfigGeneration }`. Returns 204 if fresh or 200 with `{ bootstrap, workspace, contentHash, configGeneration }` if stale (either global or per-user). Does NOT call back to OpenClaw — returns data directly.

OpenClaw chat handlers (sync and stream) implement a two-layer check:

- **Fast path:** compare `bootstrap.governance.configGeneration` with an in-memory cached global generation (TTL configurable via `PERSAI_CONFIG_GENERATION_CACHE_TTL_MS`, default 3600000 = 1 hour). If match and cache valid → proceed with stored spec. Zero HTTP overhead.
- **Full check:** when cache expires or generation mismatch → call `ensure-fresh-spec`. PersAI checks both global generation and per-assistant `configDirtyAt`. If stale → re-materializes one assistant and returns fresh spec. OpenClaw validates, writes workspace files, and stores in spec store.
- **Fail-open:** if PersAI is unreachable during freshness check, use stored spec with warning log. Chat availability > config freshness.
- **Per-assistant mutex:** in-process dedup prevents concurrent re-materializations for the same assistant.

### Where markers are written

**configGeneration++ (admin writes):**

| Service | Trigger |
|---------|---------|
| `ManageAdminRuntimeProviderSettingsService` | Provider/model/key save |
| `ManageAdminPlansService` | Plan create/update (includes entitlements + tool activations) |
| `ManageBootstrapPresetsService` | Preset template update |
| Tool catalog admin (when surfaced) | Tool CRUD |

**configDirtyAt = NOW() (per-user writes):**

| Service | Trigger |
|---------|---------|
| `UpsertOnboardingService` | Profile update (name, birthday, gender, locale, timezone) |
| `ConnectTelegramIntegrationService` | Telegram connect |
| `RevokeTelegramIntegrationSecretService` | Telegram revoke |
| Future billing webhook handler | Subscription change |

## Consequences

### Positive

- Admin saves complete instantly regardless of assistant count. Scales to 10,000+ workspaces.
- All 8 data sources auto-propagate to assistants lazily within the configured TTL.
- 99% of chat requests incur zero additional HTTP overhead (generation cache hit).
- Billing integration ready — when subscription changes are wired, they automatically trigger lazy refresh via `configDirtyAt`.
- Manual reapply remains as an instant escape hatch for individual assistants.
- Platform rollout per-workspace sequential apply is unaffected (small N, different concern).

### Trade-offs

- Changes propagate with up to TTL delay (default 1 hour). Acceptable for admin-frequency changes.
- First chat after a stale detection pays ~200-500ms materialization latency.
- OpenClaw depends on PersAI internal API availability for freshness checks (mitigated by fail-open + cache).
- `PlatformConfigGeneration` is a global counter — a plan change invalidates all assistants, not just those on the changed plan. Acceptable because lazy invalidation means only chatting assistants pay, and plan changes are infrequent.

## Schema changes

- New table: `platform_config_generations` (id VARCHAR(32) PK, generation INT DEFAULT 1, updated_at TIMESTAMPTZ)
- `assistants`: add `config_dirty_at` (TIMESTAMPTZ, nullable)
- `assistant_materialized_specs`: add `materialized_at_config_generation` (INT, DEFAULT 0)

## Out of scope

- Per-plan granular generation tracking (over-optimization for current scale)
- Background job queue for deferred bulk reapply (replaced entirely by lazy approach)
- Real-time push notification to OpenClaw on config change (polling via TTL is sufficient)

## Relation to prior ADRs

- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — spec apply/store mechanism that H3.1 extends with lazy refresh
- [ADR-049](049-platform-admin-runtime-control-plane-phasing.md) — PersAI as control plane; H3.1 adds generation-based cache coherence
- [ADR-052](052-tool-credential-refs-and-tool-quota-limits-h2.md) — tool quota/activation data that becomes a tracked invalidation source
- [ADR-053](053-runtime-hydration-depth-persona-memory-workspace-h3.md) — bootstrap documents and per-user workspace that benefit from lazy refresh
