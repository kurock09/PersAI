# ADR-124: Provider-agnostic model routing, prompt-cache-retention capability, structured-output schema sanitation, fallback semantics for provider 4xx errors, and third-provider onboarding (DeepSeek, thin OpenAI-compatible client)

## Status

Implemented locally — 2026-06-21 (full local gate green; deploy/live validation pending)

> Open orchestration ADR, implementation complete in the working tree. New long-term system rules: (1) every model routing slot may point at **any active model from any provider** in the catalog — provider is a property of the resolved model, not a single account-wide `primaryProvider`; (2) **prompt-cache retention** is an admin-managed model capability (like output budget / context window in ADR-122), so a model that requires extended caching is expressed in the catalog, not hardcoded; (3) the structured-output JSON schema sent to Anthropic is sanitized to the keywords Anthropic accepts; (4) the provider fallback fires on the **provider-side error classes that another provider can actually satisfy** (balance/quota/capacity/auth, before the first token), not only on HTTP 5xx / timeout; (5) a **third provider is onboarded as a thin OpenAI-compatible client (DeepSeek)** via catalog rows + seed + a client adapter on the prepared seams — never a routing rewrite. DeepSeek code/config is landed and credential-gated; live validation remains pending until `deepseek/api-key` is configured after deploy. Do not treat closed program ADRs as backlog for this work. **Prod-first: no transitional flags, no permanent compatibility shims — user base is still small, so we cut over cleanly.**

## Date

2026-06-21

## Relates to

ADR-050 (runtime provider profile baseline), ADR-099 (provider pricing catalog and unified model cost ledger), ADR-110 (model resolution fallback and prompt-cache orchestration — this ADR widens its fallback trigger surface), ADR-121 (two-dimensional execution routing — `thinkingBudget` plumbing this ADR must not break), ADR-122 (output budget and context window as model capabilities — this ADR adds a third capability field and reuses the same read/write/seed fold-in seat), ADR-123 (native sandbox / provider + secret wiring — unaffected).

**Third provider (DeepSeek) — included as the final, credential-gated slice (D5 / Slice 4), not a separate ADR.** Slices 1–3 deliberately built the seams (provider-agnostic slots, capability-driven request shaping, classification-based fallback) so the third provider lands as a catalog + seed + client-adapter addition rather than a routing rewrite. DeepSeek landed **last**, **separately** from the urgent fixes (it did not block Slices 1–3). Code is locally verified; live validation remains `pending` until DeepSeek API credentials + a live validation run are available — it is the deploy-time proof that the prepared abstraction holds.

---

## Context

### Symptom (user-visible / founder-stated)

1. Switched the active model to OpenAI `gpt-5.5` — it does not work.
2. Anthropic balance ran out; the runtime did **not** fall over to the other provider, the turn just failed.
3. Founder intent: in a plan, be able to pick **any** active model from **any** provider per slot (`normal` / `premium` / `reasoning` / `retrieval` / `system`), not only models from a single `primaryProvider`; keep **one** simple global fallback (no per-slot fallback matrix).

### Live evidence (persai-dev, 2026-06-21)

- **OpenAI `gpt-5.5`** fails because it requires extended (`24h`) prompt caching. The runtime always sends `prompt_cache_retention: "in_memory"`; there is no way to express that a given model needs `"24h"`.
- **Anthropic** failures in the window were of two kinds: (a) `400 output_config.format.schema: For 'number' type, properties maximum, minimum are not supported.` and (b) the account-level **unpaid-balance** stop. Neither triggered a fallback to OpenAI.

### Confirmed root cause (independently re-verified, file:line)

**A — prompt-cache retention is a hardcoded constant, not a model capability.**

- `apps/runtime/src/modules/turns/turn-execution.service.ts:165` and `apps/runtime/src/modules/turns/session-compaction.service.ts:106`: `const DEFAULT_OPENAI_PROMPT_CACHE_RETENTION = "in_memory"`. This single literal is the only retention value the runtime ever passes; `apps/provider-gateway/.../openai-provider.client.ts:1636` forwards it verbatim as `payload.prompt_cache_retention`.
- `RuntimeProviderModelProfile` (ADR-122 added `maxOutputTokens` / `contextWindow`) has **no** `promptCacheRetention` field, so a model that requires `"24h"` cannot be represented; `gpt-5.5` always receives `"in_memory"` and the request is rejected.

**B — the Anthropic structured-output schema sanitizer is too narrow.**

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:1191` `sanitizeAnthropicStructuredOutputSchema` recursively strips **only** `maxItems` and `minItems`. Anthropic's `output_config.format.schema` (json_schema mode) also rejects numeric-range keywords (`minimum`, `maximum`, and the related `exclusiveMinimum` / `exclusiveMaximum` / `multipleOf`). A tool/output schema that constrains a number with `minimum`/`maximum` therefore 400s. The single sanitizer seat already exists (`:1183`, `:1191`) and is used by both the non-streaming (`:162`) and streaming (`:294`) paths — it is just incomplete.

**C — the fallback only fires on 5xx / timeout, so provider 4xx never fails over.**

- `apps/runtime/src/modules/turns/runtime-text-fallback.ts:59` `isRetryableRuntimeTextFailure` returns `true` only for `ProviderGatewayTimeoutError` or an HTTP status `>= 500`; `isRetryableRuntimeTextStreamFailureCode` (`:72`) only matches three stream codes. A provider **402/429 balance/quota** stop (Anthropic unpaid balance, OpenAI `insufficient_quota`) is a 4xx and is classified non-retryable, so the configured fallback model is never tried even though it could serve the turn.
- The classification is HTTP-status-only: `ProviderGatewayHttpError` does not carry the provider's structured error `type`/`code`, so there is no way to distinguish "the other provider can satisfy this" (balance, quota, rate-limit, capacity, single-provider auth) from "this request is malformed and will fail on every provider" (our own bad schema). Both currently look the same to the runtime.

**D — every routing slot is locked to a single `primaryProvider`.**

- `apps/api/.../resolve-runtime-provider-routing.service.ts` resolves `primaryProviderKey` once (`:100`) and assigns it to **all** slots: `normalReply`, `premiumReply`, `reasoning`, `systemTool`, `retrieval` each set `providerKey: primaryProviderKey` (`:165`, `:174`, `:183`, `:192`, `:201`). Only the **model key** is per-slot; the provider is account-wide. So you cannot run, say, `reasoning` on OpenAI while `normal` runs on Anthropic. A single global fallback already exists as the `provider_failure_or_timeout` entry in `fallbackMatrix` (`:216`), consumed by `resolveRuntimeTextFallbackSelection` (`runtime-text-fallback.ts:35`).

**Conclusion:** the failures are three independent gaps plus one structural limit. `gpt-5.5` needs a capability the catalog can't express; Anthropic 400s on a schema keyword the sanitizer doesn't strip; balance/quota stops don't fall over because classification is HTTP-status-only; and slots can't mix providers because provider is account-wide rather than a property of the resolved model.

## Decision

Make **provider a property of the resolved model per slot**, add **prompt-cache retention** as a third admin-managed model capability, **complete the Anthropic structured-output sanitizer**, and **classify provider failures by error semantics** so the existing single global fallback fires for the 4xx classes another provider can satisfy. No new env vars; no magic constants promoted to truth — capabilities are catalog truth, classification is explicit.

### D1 — `promptCacheRetention` model capability

Add to `RuntimeProviderModelProfile` (and its shared read/write normalization seat, mirroring ADR-122 D1):

- `promptCacheRetention: "in_memory" | "24h" | null` — admin-set; `null` ⇒ runtime uses the conservative default (`"in_memory"`).

- Validation in `normalizeModelProfiles()`: enum-or-null; both admin-save validation and read-side coercion share the one normalization seat.
- Fold the value into `MODEL_CAPABILITY_DEFAULTS` at **read + write** (ADR-122 fold-in pattern), keyed by model: `gpt-5.5` ⇒ `"24h"`; other current models ⇒ `"in_memory"` (or `null`). Existing PROD rows become correct on next read, idempotently, no manual save.
- Carry it onto the routing slot (D4 carrier) so the runtime reads `slot.promptCacheRetention` instead of the module constant. Demote `DEFAULT_OPENAI_PROMPT_CACHE_RETENTION` to a single named last-resort fallback used only when the slot value is absent. **OpenAI-only consumer**: the Anthropic path ignores it (no behavior change for Anthropic). Confirm `gpt-5.5`'s actual requirement against current OpenAI docs at implementation time rather than assuming `"24h"`.

### D2 — Complete the Anthropic structured-output schema sanitizer

Extend `sanitizeAnthropicStructuredOutputSchema` to strip the keywords Anthropic's `output_config.format.schema` rejects, in addition to `maxItems`/`minItems`: at minimum `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`. Keep the recursion (objects + arrays). Verify the exact unsupported-keyword set against current Anthropic structured-output documentation at implementation time and strip exactly that set — do not over-strip keywords Anthropic does accept (the schema's `type`/`properties`/`required`/`enum` semantics must be preserved). Single seat (`:1191`), already shared by streaming + non-streaming.

### D3 — Classify provider failures by error semantics; fall back on satisfiable 4xx (pre-first-token)

- **Propagate the provider's structured error class to the runtime boundary.** `ProviderGatewayHttpError` (and the stream-failure path) must carry the provider error `type`/`code` (e.g. OpenAI `insufficient_quota` / `rate_limit_exceeded`, Anthropic `billing` / `overloaded_error` / `rate_limit_error`), not just the HTTP status. The provider gateway already receives these from the SDK error objects; today they are flattened to a status.
- **Broaden `isRetryableRuntimeTextFailure` to a classification, not a status threshold.** Fall back when the error class is one the **other provider can satisfy**: balance/billing (Anthropic unpaid balance, OpenAI `insufficient_quota`), quota/rate-limit, provider capacity/overload, and single-provider auth/credential failure — **including** when these surface as 4xx (402/403/429). Keep 5xx / timeout retryable as today.
- **Do not fall back on malformed-request errors** that would fail identically on every provider (e.g. a schema/request our own code built wrong — the D2 class of bug). These must surface as a real error, not silently mask a bug by looping providers.
- **Pre-first-token only.** Fallback is allowed only before any output token has been emitted/persisted (the existing constraint); a mid-stream provider drop after partial output is not silently re-run on another provider. This preserves the ADR-122 truncation-guard contract.

### D4 — Provider-agnostic routing slots (single global fallback retained)

- Each `modelSlot` resolves its **own** `providerKey` from the catalog — the provider that **owns** the slot's selected model — instead of the account-wide `primaryProviderKey`. Concretely, `resolve-runtime-provider-routing.service.ts` looks up which provider's active catalog contains the resolved model key for each slot and sets that slot's `providerKey` accordingly (and the ADR-122 capability lookup already keys on `(providerKey, modelKey)`, so it follows naturally).
- The plan exposes, per slot (`normal` / `premium` / `reasoning` / `retrieval` / `system`), a **Provider + Model** selection drawn from **all active models across all providers**. `primaryProvider` remains only the **default/seed** for slots the operator leaves unset — it is no longer a hard ceiling on slot providers.
- **Keep the single global fallback.** The existing `provider_failure_or_timeout` entry (one fallback provider + model) stays as-is. We explicitly do **not** introduce a per-slot or per-trigger fallback matrix in the plan UI — founder rejected that complexity ("если есть один общий — зачем усложнять"). `fallbackProvider` is **not** legacy: it is the single global fallback target and stays.
- This is the seam that lets the third provider (D5) be added as catalog rows + a client adapter without touching slot routing.

### D5 — Third provider: DeepSeek as a thin OpenAI-compatible client (credential-gated final slice)

DeepSeek exposes an OpenAI-compatible Chat Completions API, so it is onboarded as a **thin adapter on the existing OpenAI client shape**, not a new bespoke integration. Strictly an addition on the D1–D4 seams:

- **Provider registration + secrets.** Register `deepseek` as a provider key alongside `openai`/`anthropic`; wire its API key/base-URL the same way existing provider secrets are wired (no new env-var pattern — reuse the platform provider-credential seat). The client adapter targets DeepSeek's OpenAI-compatible base URL and reuses the OpenAI request/response shaping; provider-specific deltas (no `prompt_cache_retention`, model id names, any unsupported params) are handled in the adapter, not in shared code.
- **Catalog + seed (capability truth).** Add DeepSeek models as active catalog rows with their ADR-122/D1 capabilities (`contextWindow`, `maxOutputTokens`, `promptCacheRetention` — `null`/`in_memory` since DeepSeek has no extended-cache requirement) and ADR-099 pricing/token-weight rows. No model is special-cased in code — it is catalog data.
- **Routing (free via D4).** Because slots resolve the provider from the selected model (D4), a DeepSeek model becomes selectable per slot and as the single global fallback target with **zero** routing-code change.
- **Fallback classification (free via D3).** DeepSeek balance/quota/rate-limit/auth errors map into the same satisfiable-4xx classes as OpenAI (it is OpenAI-compatible), so cross-provider fallback to/from DeepSeek works on the D3 classification without new branches; only confirm DeepSeek's concrete error `type`/`code` strings against its live API and add them to the classification map.
- **Validation gate.** This slice requires real DeepSeek credentials and a live turn (chat + structured output + a forced fallback) before it is marked done. Until then it is `pending` and **does not block** Slices 1–3 from shipping.

## Work plan

Bounded slices, gated by the `AGENTS.md` verification gate between slices, committed as they land, **pushed only at the very end** (push triggers deploy). Migrations/contract regen done before the gate when artifacts change.

- **Slice 1 — provider-unblock (urgent).** D2 (Anthropic schema sanitizer) + D1 (`promptCacheRetention` capability: profile field, normalization, defaults fold-in, slot carrier, runtime read). Unblocks Anthropic structured output and `gpt-5.5`. Unit tests: sanitizer strips the unsupported set and preserves the rest; retention normalization (enum/null/defaults fold-in).
- **Slice 2 — fallback semantics.** D3: propagate provider error class through the gateway boundary; classification-based `isRetryableRuntimeTextFailure`; satisfiable-4xx fallback, pre-first-token only, malformed-request excluded. Unit tests for each error class (balance/quota/rate-limit/capacity/auth ⇒ fallback; malformed 400 ⇒ no fallback; 5xx/timeout ⇒ fallback; mid-stream ⇒ no silent re-run).
- **Slice 3 — provider-agnostic slots + plan UI.** D4: per-slot provider resolution in `resolve-runtime-provider-routing.service.ts`; plan slot rows select Provider+Model from all active models; single global fallback retained. Regenerate contracts if the routing/plan shape is exposed outward. Tests for slot provider resolution and the unchanged single-fallback shape.
- **Slice 4 (final, credential-gated) — third provider: DeepSeek.** D5: register the `deepseek` provider + credential wiring; thin OpenAI-compatible client adapter; DeepSeek model catalog rows + pricing/capability seed; add DeepSeek's concrete error `type`/`code` strings to the D3 classification map. Lands **last and separately**; **must not block Slices 1–3**. Unit tests for the adapter shaping + the new error-class mappings; **stays `pending` until real DeepSeek credentials + a live validation turn (chat + structured output + forced fallback) pass.**

## Implementation status (2026-06-21)

- **Slice 1 — landed locally.** `RuntimeProviderModelProfile` now carries `promptCacheRetention`; the read/write normalization path folds known defaults in the same capability seat as ADR-122; runtime turn execution and compaction read retention from the resolved slot and use only a named last-resort fallback when absent. Anthropic structured-output schema sanitation now strips unsupported range/constraint keywords while preserving supported schema structure.
- **Slice 2 — landed locally.** Provider-gateway text failures now propagate structured provider error details and semantic `ProviderGatewayTextErrorKind` values through HTTP and stream failure paths. Runtime fallback reads the semantic kind first, keeps timeouts/5xx retryable, permits satisfiable provider-side 4xx before first token, and excludes malformed/invalid requests.
- **Slice 3 — landed locally.** Plan/admin contracts and UI now expose provider+model choices for each text slot. Slot resolution is fail-closed for explicit provider/model mismatches and ambiguous duplicate model ids, while retaining the single global fallback target.
- **Slice 4 — landed locally, live validation pending.** DeepSeek is registered as `deepseek`, warmed through the existing managed secret id `deepseek/api-key`, exposed in Admin Runtime/Plans, and implemented as a thin text-only OpenAI-compatible Chat Completions adapter at `https://api.deepseek.com`. Catalog defaults include active `deepseek-v4-flash` and `deepseek-v4-pro` rows (1M context, 384k output, token-metered pricing). Legacy `deepseek-chat`/`deepseek-reasoner` aliases are not seeded.
- **Verification — green locally.** Full AGENTS gate plus ADR-124 focused tests/typechecks pass. Deploy-time validation remains required for `gpt-5.5` prompt-cache retention, Anthropic numeric-schema sanitation, pre-first-token provider-failure fallback, mixed-provider slot selection, and DeepSeek credential-gated chat/structured-output/fallback smoke.

## Consequences

### Positive

- `gpt-5.5` works (catalog expresses its retention requirement); Anthropic structured output stops 400-ing on numeric-range keywords.
- Balance/quota/capacity stops on one provider transparently fall over to the configured fallback instead of failing the turn.
- Operators can mix providers per slot from one catalog; the third provider (DeepSeek) lands as a catalog/adapter addition on the prepared seams (D5), not a routing rewrite — and proves the abstraction holds.
- Retention joins output-budget/context-window as admin truth on the same catalog seat — no scattered constants.

### Negative / risks

- Broadening fallback to 4xx must **not** mask our own malformed-request bugs — the classification must exclude them, and tests must lock that boundary (chosen explicitly in D3).
- Carrying provider error `type`/`code` to the runtime touches the provider/runtime contract — escalates to the integration matrix per `docs/TEST-PLAN.md`.
- Per-slot provider resolution changes how a slot's provider is derived; mixed-provider plans must be validated so a slot's model actually exists in the chosen provider's active catalog.
- Falling back across providers can cross cost tiers; the single global fallback target is operator-chosen, so cost stays governed by the existing pricing catalog.

## Alternatives considered

- **Hardcode `gpt-5.5` retention in the OpenAI client.** Rejected — a per-model special-case is not catalog truth and breaks the moment another model needs `"24h"`; ADR-122 already established capabilities as the seat.
- **Strip all numeric/constraint keywords from every Anthropic schema unconditionally.** Rejected as over-strip — only the keywords Anthropic actually rejects are removed, verified against current docs, so legitimate constraints survive on providers that accept them.
- **Make every 4xx retryable.** Rejected — malformed-request 4xx would loop providers and hide real bugs; classification by provider error semantics is the correct discriminator.
- **Per-slot / per-trigger fallback matrix in the plan UI.** Rejected by founder as unnecessary UI complexity — one global fallback already exists and is sufficient.
- **Remove `primaryProvider` / `fallbackProvider` as legacy.** Rejected — `fallbackProvider` is the live single global fallback (not legacy); `primaryProvider` is demoted to the default seed for unset slots rather than removed.
- **DeepSeek as a separate ADR vs. the final slice of this one.** Chosen as the **final slice here**: the third provider is the direct payoff of the D1–D4 seams (provider-agnostic slots, capability fields, classification fallback), so keeping it in the same ADR documents the seam-then-prove arc in one place. It is still isolated as a credential-gated last slice that does not block the urgent fixes — so the slice discipline ("urgent fixes ship without waiting on external credentials") is preserved without fragmenting the decision across two ADRs.
- **Fold DeepSeek into Slice 1 (build the client up front).** Rejected — it depends on external credentials + a live validation run, so bundling it would gate the urgent `gpt-5.5`/Anthropic-fallback fixes on DeepSeek availability; it is sequenced last and pending-gated instead.
