# ADR-163: Kimi managed chat text provider

## Status

**Open 2026-07-23 — local CLEAN; push requested; live acceptance pending.**  
Baseline at docs open: `f6214543`.

P0 docs audit CLEAN. P1–P4 implemented (registration, `KimiProviderClient`,
runtime multimodal pdf_only + Admin UI). Composer triple audit CLEAN after
dead dual-admin delete + kimi-k3 Add-model pricing seed. AGENTS gate +
api/runtime/provider-gateway full suites + focused web ADR tests green.
Credential-gated live smoke (chat + tool loop + vision image + usage
`cached_tokens`) still required before closure.

Parent orchestrates, audits, and commits. Implementation and independent
audits use **`cursor-grok-4.5-high-fast` only**. Terra / Sonnet / Sol / Opus
are forbidden for ADR-163 implementation subagents.

**Delivery shape:** one program → one push/deploy at end. Audits CLEAN — no
DeepSeek fork residue, no legacy dual ProviderSelect lists.

Do not reopen closed ADR-124 for new DeepSeek scope. Do not reopen ADR-161
cache redesign for Kimi.

---

## Audit summary (pre-ADR, 2026-07-23)

### Product intent

PersAI already has Western text providers **OpenAI** + **Anthropic** and one
Chinese provider **DeepSeek**. Founder wants **one additional Chinese**
provider for long B2B tool-loop / Scripts chains (not coding-as-product).

Chosen provider: **Kimi (Moonshot)** — primary model **`kimi-k3`**.

### What already exists (reuse — do not rebuild)

| Seam | Where | Reuse |
| --- | --- | --- |
| Chat-routing provider registry | `CHAT_ROUTING_PROVIDERS` in `runtime-provider-profile.ts` | Add one enum member |
| OpenAPI managed provider enums + Admin settings maps | `packages/contracts/openapi.yaml` → orval | Add required `kimi` keys; regen |
| Gateway warmable client contract | `ProviderWarmableClient` | Implement for Kimi |
| Text generate/stream HTTP | `provider-text-generation.controller.ts` | Unchanged surface |
| Warmup + managed secret seat | `provider-warmup.service.ts`, `PERSAI_RUNTIME_PROVIDER_SECRET_IDS` | Pattern `{provider}/api-key` → `kimi/api-key` |
| Error classification spine | `provider-text-error.ts` + ADR-124 D3 | Extend only if Kimi codes miss the map |
| Slot routing / single global fallback | ADR-124 D4 | Free once catalog rows exist |
| Shared `reasoningContent` on tool exchanges | `packages/runtime-contract` | Reuse field; adapter-local wire name `reasoning_content` |
| Usage accounting v2 spine | `normalizeProviderTextGenerationUsageV2` | Add **Kimi branch** (not DeepSeek’s) |
| Admin Runtime / Plans UI machinery | admin runtime page + catalog authoring | New provider option + key card + catalog rows |
| Cache-zone telemetry helper | `provider-cache-zone-observability.ts` | Optional use from Kimi client |
| Prompt-cache build for non-OpenAI/non-Anthropic | runtime `buildPromptCacheConfig` → `undefined` | Kimi stays here (automatic Moonshot cache) |

### What must be net-new

1. Registration of provider key `kimi` across chat-routing allowlists / OpenAPI /
   gateway / runtime validators / Admin UI lists.
2. Thin **`KimiProviderClient`** targeting Moonshot OpenAI-compatible Chat
   Completions (`https://api.moonshot.ai/v1`).
3. Kimi-specific usage normalize (`prompt_tokens` + top-level `cached_tokens`).
4. Catalog seed/capability defaults + Admin pricing for chosen models.
5. Multimodal allowlist inclusion (Kimi is vision-capable — unlike DeepSeek
   text-only chat in PersAI).
6. Focused tests + credential-gated live acceptance.

### Anti-duplication / anti-DeepSeek-copy (hard rules)

| Forbidden | Why |
| --- | --- |
| Fork/`cp` of `deepseek-provider.client.ts` as the Kimi client | DeepSeek client embeds DeepSeek-only debt (text-only throws, hit/miss field names, freeze-era comments) |
| Port `deepseekToolLoopDeveloperFreeze` | ADR-161 DeepSeek-only experiment; not a shared compat layer |
| Port D2a / append-trace / compact-at-insert | Rolled back; founder forbid |
| Reuse DeepSeek usage branch (`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`) | Kimi publishes top-level `cached_tokens` |
| Assume text-only / keep Kimi out of multimodal allowlist | Kimi K3/K2.6/K2.7 support image (+ video) input |
| Invent `kimiReasoningContent` parallel field | Use shared `reasoningContent` |
| OpenAI Responses API / `prompt_cache_key` / breakpoints for Kimi | Moonshot Chat Completions + automatic context cache; OpenAI cache wire is ignored/wrong |
| New env-var credential pattern | Managed secret `kimi/api-key` only |
| Plugin registry / DI discovery rewrite | Fourth provider is enum + thin client, not a platform rewrite |

### Light structural cleanup required inside this ADR (clean-audit bar)

These are **not** optional polish if an audit would otherwise leave dual truth:

1. Prefer deriving chat-provider unions from the canonical lists
   (`CHAT_ROUTING_PROVIDERS` / `PROVIDER_GATEWAY_PROVIDERS` /
   `PERSAI_TEXT_GENERATION_USAGE_PROVIDER_KEYS`) instead of adding a fourth
   hand-maintained `NativeManagedProvider` copy in every file when touched.
2. Deduplicate multimodal allowlists that today exist both in runtime
   (`runtime-text-only-multimodal-sanitizer.ts`) and API
   (`manage-admin-plans.service.ts`) — one shared source, include `kimi`.
3. Fix Admin `providerLabel` gaps for non-OpenAI/Anthropic labels while
   touching the Runtime page (DeepSeek mislabel if still present).
4. Do **not** widen media-generation helpers (`image`/`video` completion
   paths that intentionally stay `openai|anthropic`) unless a chat helper
   truly needs Kimi.

---

## Context (provider facts)

Official Moonshot / Kimi Open Platform (global):

- Base URL: `https://api.moonshot.ai/v1`
- Protocol: OpenAI-compatible **Chat Completions** (not Responses API)
- Primary model: `kimi-k3` — 1M context, always thinks, `reasoning_effort`
  `low|high|max` (default `max`), native image/video understanding, tools
- Optional cheaper catalog rows (same provider): `kimi-k2.6`,
  `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` (256k)
- Thinking wire: `reasoning_content` on assistant messages; Preserved Thinking
  / multi-turn + tool loops require echoing historical reasoning content
- Cache: **automatic** prefix context cache; no cache id / TTL params; previous
  prompt must exceed 256 tokens to be cache-eligible
- Usage (Chat Completions): `prompt_tokens`, `completion_tokens`,
  `total_tokens`, top-level **`cached_tokens`**; stream via
  `stream_options.include_usage`
- Pricing (1M tokens, excl. tax, docs 2026-07): K3 cache hit **$0.30** /
  miss **$3.00** / output **$15.00**

PersAI stack today has three chat-routing providers only. Adding Kimi is the
ADR-124 “catalog + secret + thin adapter” shape — applied cleanly, not as a
DeepSeek clone.

---

## Decision

### D1 — Fourth managed chat provider key `kimi`

Register `kimi` as a first-class **chat-routing** provider beside
`openai` | `anthropic` | `deepseek`:

- OpenAPI `ManagedRuntimeProvider` (+ required Admin maps)
- `CHAT_ROUTING_PROVIDERS` / gateway `PROVIDER_GATEWAY_PROVIDERS`
- runtime-contract text provider unions + usage provider keys
- managed secret id **`kimi/api-key`**
- Admin Runtime: API-key card + catalog authoring + Plans slot selection

No Helm/`KIMI_*` env bootstrap required (same managed-secret-only pattern as
DeepSeek today).

### D2 — Thin native Kimi adapter (Chat Completions)

Add `apps/provider-gateway/.../kimi/kimi-provider.client.ts` implementing
`ProviderWarmableClient`:

- OpenAI SDK (or equivalent HTTP) with Moonshot `baseURL`
- `generateText` / `streamText` on Chat Completions
- Tools / `tool_calls` accumulation compatible with existing gateway result
  shape
- Multimodal content mapping for image (and video if PersAI content blocks
  already carry it — do not invent a parallel attachment system)
- Capture/echo `reasoning_content` into shared `reasoningContent` for tool
  history when the selected model returns it (required for K3 / thinking
  tool loops per Moonshot docs)
- Map catalog/runtime thinking intent to Kimi params **adapter-locally**:
  - K3: top-level `reasoning_effort` when slot/catalog expresses effort
  - Do not send OpenAI `prompt_cache_*` / Anthropic `cache_control`
- `stream_options.include_usage: true` on streams
- Stable message order for automatic cache: tools + stable system + sealed
  history first; volatile / mutable developer tail last (reuse existing
  runtime zone ordering; do not invent a second zone model)

Extract **small shared helpers only when a second OpenAI-compat Chat
Completions client would otherwise duplicate pure mechanics** (e.g. tool-call
delta accumulation). Helpers must be provider-neutral names/locations — never
`deepseek*` renamed. Prefer leaving OpenAI Responses client and Anthropic
client untouched.

### D3 — Usage accounting branch for Kimi

Extend `normalizeProviderTextGenerationUsageV2` with an explicit `kimi`
branch locked to Moonshot fields:

- `totalInputTokens = prompt_tokens`
- `cacheReadInputTokens = cached_tokens` (top-level; default 0 if absent)
- `uncachedInputTokens = prompt_tokens - cached_tokens` (fail closed if
  negative / missing components)
- `cacheWriteInputTokens = 0` (automatic cache; no billed write field in
  current Chat Completions usage shape)
- `outputTokens = completion_tokens`

Do **not** fall through to Anthropic or DeepSeek branches. Confirm against a
live Moonshot payload before closure; if the live shape differs, fix the
branch — do not paper over with dual readers.

### D4 — Catalog defaults and product models

Seed / capability defaults (admin-overridable):

| Model key | Role | Notes |
| --- | --- | --- |
| `kimi-k3` | Primary long B2B / tool-loop slot | 1M context; vision; always thinking |
| `kimi-k2.6` | Optional cheaper general agent | 256k; vision; thinking toggleable |
| `kimi-k2.7-code` / `-highspeed` | Optional | Only if founder wants coding-speed rows; **not** required for ADR closure |

Pricing rows must match published Moonshot rates at seed time (K3:
0.30 / 3.00 / 15.00 per 1M for cache hit / miss / output).  
`promptCachePolicy`: `null` (automatic provider cache; no OpenAI explicit
policy).

### D5 — Multimodal

Kimi chat models are vision-capable. Add `kimi` to the **shared** multimodal
input allowlist used by:

- runtime text-only sanitizer (must **not** strip images for Kimi)
- Admin Plans `systemTool` vision guard

Media **generation** providers remain unchanged.

### D6 — Cache discipline (lessons without DeepSeek code)

For long tool loops, cost and correctness depend on Moonshot automatic prefix
cache:

1. Keep stable prefix byte-stable across in-turn iterations (existing ADR-161
   zone order).
2. Echo `reasoningContent` on assistant tool-call turns when present.
3. Honest usage normalize + stream `include_usage`.
4. Live proof of growing / non-zero cache reads on a warmed long loop.
5. **No** developer-freeze port unless a post-landing live incident proves
   Kimi-specific bust — then open a tiny follow-up, do not preload freeze.

### D7 — Orchestration and closure gate

Parent-only commits. Implementation subagents: Grok only.  
Independent allowed-model audits after implementation packets; each audit
driven to **CLEAN** before the next packet starts. Final program audit CLEAN
before push.

**Closure requires (all):**

1. Full AGENTS verification gate green locally.
2. Admin can save `kimi/api-key`, author catalog rows, assign plan slots.
3. Live authenticated turns on `persai-dev` (or hybrid): plain chat,
   multi-step tool loop (≥20 tool steps preferred for B2B shape), at least
   one vision turn, satisfiable fallback involving Kimi if credentials allow.
4. Usage v2 rows show sane `cacheRead`/`uncached`/`output` for Kimi.
5. No DeepSeek-named helpers left in the Kimi path; no dead dual registration
   lists for chat providers touched by this ADR.

---

## Work packets (internal; one push at end)

Packets are focus units for orchestration/audit, **not** deploy checkpoints.

| Packet | Content | Audit bar |
| --- | --- | --- |
| **P0** | This ADR + handoff/changelog/AGENTS active-program note | Docs CLEAN |
| **P1** | OpenAPI + canonical provider lists + contract regen + secret id + empty maps | Types/allowlists consistent; no orphan list |
| **P2** | `KimiProviderClient` + warmup + text dispatch + usage v2 branch + gateway tests | Adapter CLEAN; usage fixtures pinned |
| **P3** | Runtime allowlists (incl. multimodal) + validator accept `kimi` + light enum dedup on touched paths | No DeepSeek freeze coupling; multimodal shared source |
| **P4** | Admin Runtime/Plans UI + catalog defaults/pricing | UI shows Kimi; labels correct |
| **P5** | Full local gate + credential live acceptance | Founder accept → **one push/deploy** |

If a packet audit is DIRTY: fix to CLEAN before continuing. No “known debt”
carry into push.

---

## Explicit out of scope

- Qwen / GLM / Doubao / other Chinese providers
- Kimi Batch, Files extract product flows, official Moonshot `web_search`
  built-ins as PersAI platform tools
- Video **generation** via Kimi
- OpenAI Responses migration for Kimi
- ADR-161 D2a revival or DeepSeek developer-freeze generalization
- Per-slot fallback matrix
- Sandbox egress allowlist work (chat calls leave from provider-gateway)
- China-region alternate base URL product matrix (single global
  `api.moonshot.ai` unless founder later opens a follow-up)
- Reopening ADR-124 / ADR-161 for new architecture

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Missed allowlist → warmup/UI/runtime reject | Canonical lists + greps in audit; OpenAPI required keys updated together |
| Wrong usage mapping → silent `usage_unavailable` / bad ledger | Live payload pin in tests before close |
| Thinking tool-loop 400 without reasoning echo | Capture/echo from day one for thinking models |
| Accidental DeepSeek copy | Explicit anti-copy rules; audit rejects `deepseek*` helpers in kimi path |
| Long-loop cost surprise (K3 output $15 + always-on thinking) | Product accepts; optional cheaper catalog rows; cache proof mandatory |
| Dual admin provider lists drift | Touch both settings + profile admin paths or delete dead one if proven unused |

---

## Relates to

- ADR-124 (closed) — provider-agnostic slots + thin OpenAI-compat onboarding shape
- ADR-051 / ADR-050 — runtime provider settings / profile baseline
- ADR-099 — pricing catalog + cost ledger
- ADR-161 (open) — cache discipline + usage v2; Kimi adds a usage branch only
- ADR-121 — thinking budget / effort plumbing (adapter maps what catalog/slots already expose; no new routing dimension)

---

## Next step after this ADR

Parent launches **P1** implementation via Grok subagent with this ADR as the
only scope source. No code until P0 docs audit is CLEAN.
