# ADR-161: Provider-native prompt-cache discipline and canonical usage accounting

## Status

**Open — canonical v2 and cache-prefix repairs deployed; OpenAI replay hotfix implemented locally; hotfix deployment and S6 live acceptance pending.**

### 2026-07-21 cache-prefix repair checkpoint

Post-cutover DeepSeek live turns still reported only approximately 27–29%
cache-read share. Request/log correlation and source inspection identified two
additional exact prefix changes:

- `cross_session_carry_over` was present when initialized, then removed on
  later turns by the old first-turn/long-idle trigger;
- a successful catalog `{action:"describe"}` changed the provider-visible
  `tools` payload from the catalog stub to the full contract for later calls.

The provider-independent repair freezes `cross_session_carry_over` once per
Assistant chat, including an explicit empty snapshot, through an atomic
control-plane first-writer-wins resolve endpoint. Runtime reuses those exact
stored bytes on every later turn and fails closed without injecting an
unpersisted proposal. The superseded long-idle/cooldown/mark-fired runtime path
and API endpoint are deleted.

Catalog `tools` now remain byte-stable for the whole turn on every provider.
`describe` returns the full description and `inputSchema` only in its immutable
tool result. A turn-local loaded-contract set authorizes later execution
server-side; it never reprojects or mutates `providerRequest.tools`. Catalog
stubs accept the contract arguments returned by `describe`, while Runtime
continues to validate and authorize every actual call.

The first OpenAI post-cutover tool-loop smoke also exposed one independent
sealed-spine protocol regression from `ebf310c4`: assistant pre-tool text was
replayed as an assistant `input_text` content block. OpenAI accepted the first
tool call but rejected the follow-up with HTTP 400 because typed assistant
content accepts `output_text` or `refusal`, not `input_text`. PersAI does not
retain the provider-owned id/status/annotations needed to synthesize a
`ResponseOutputMessage`; therefore the canonical replay uses OpenAI's official
assistant `EasyInputMessage` string content shape. Function calls,
`function_call_output`, developer inputs, and explicit cache-boundary blocks
are unchanged.

This is a new parent-orchestrated program. The opening baseline is
`d4bd32679929bef89cc13120cf2719ad9a2b0df3`. The documentation opening is
`de265c57`; S0 contracts/catalog migration landed locally in `07bf3843`;
the managed-secret-only OpenAI prerequisite cleanup landed locally in
`65c11816`; and S1-S3 provider/runtime cache behavior landed locally in
`ebf310c4`. The final canonical accounting cutover was later deployed from
`ce5d7f06`, and the 2026-07-21 cache-prefix repair from `bfd800c5`. The
OpenAI replay hotfix below is not yet deployed.
The initial opening audit returned CLEAN after repair of all findings. The
founder then added a mandatory long-tool-loop requirement: prove append-only
prefix reuse and positive net provider-cost savings over 40–50 exchanges, not
only cache metrics. After iterative repair, the independent re-audit of this
refinement returned **CLEAN with zero P0/P1/P2 findings**.

Implemented local truth through S3:

- canonical text usage v2 contracts, catalog-declared cache policy/write
  weight, and transaction-safe JSON catalog backfill;
- immutable compact in-turn spine plus newest-three full overlays;
- DeepSeek stable-history-before-volatile placement and official cache usage;
- Anthropic stable quantized anchor plus latest sealed-result breakpoint;
- OpenAI common-prefix key selected by measured controlled traffic: identical
  repeats read 2,172 of 2,190 input tokens while variant keys read zero;
- policy-only OpenAI retention/explicit-breakpoint transport, exact boundary
  markers, provider-derived prefix telemetry, and removal of the scalar
  retention fallback/carrier.

Focused provider/runtime/accounting tests, typechecks, formatting, and the
independent S1-S3 audit findings are resolved.

S4 is implemented locally after `ee375d04`: provider streaming and
non-streaming paths emit canonical v2 text usage; runtime carries explicit v2
through web/Telegram/sync results; API receipts, quota, ledger, smoke readers,
Admin aggregates, generated contracts, and Business/Ops surfaces use
non-overlapping partitions and actual-vs-no-cache cost. Historical v1 remains
only in the explicit bounded rollout seam and is excluded from v2 ratios.
Unknown versions fail closed. Currency aggregates are partitioned, explicit
zero cache-write pricing is preserved, and non-text accounting remains
unchanged. The independent S4 audit returned four P1 findings; all were
corrected. S5 full audits/gates and S6 live acceptance remain pending.

S5 local closure gates are complete. Independent billing/rollout and
security/privacy audits returned CLEAN. The independent architecture/cache
audit found one P1: OpenAI and Anthropic placed mutable volatile context before
the sealed in-turn spine. The provider assemblers now emit stable
history/request, sealed spine/boundary, newest-three overlays, then the mutable
volatile/developer suffix; volatile-only regression fixtures prove the prior
sealed provider prefix remains byte-identical. Full API, provider-gateway,
runtime, and web suites pass, together with recursive lint, repository format,
API/Web/provider/runtime typechecks, contracts generation, Prisma validation,
and migration fixtures. S6 live provider matrix, sequential 50-iteration
benchmarks, authenticated 40–50-tool turn, deployment, and live acceptance
remain pending.

Release A deployed and was founder-accepted at exact SHA `03bacd5d`: all
API/runtime/provider-gateway/web/sandbox replicas were healthy, API and
runtime consumer markers were observed, producer flags remained false, full CI
was green, and migration
`20260720161500_adr161_s0_cache_write_catalog_backfill` was applied. The
founder then directed one final maintenance cutover rather than B1/B2 because
there are no commercial users. The final release removes every rollout flag,
image floor, capability marker, probe, v1/missing-discriminator consumer, and
old text-accounting carrier. A bounded rolling deployment overlap is accepted;
steady state contains only validated canonical v2 accounting.

The parent agent orchestrates, audits, reconciles documentation, and commits
only after an accepted coherent checkpoint. Founder-directed implementation
delegation: use `gpt-5.6-terra-medium` for complex tasks and `gpt-5.4-medium`
for simple tasks; `gpt-5.6-sol-medium` and all Opus models are forbidden.
Do not proliferate artificial slices: execute the dependency-ordered flow
below, keeping each delegated task bounded by one clear contract. Provider
request repairs remain locally batched, but the cross-service usage-contract
cutover requires an explicit versioned rollout protocol: additive consumer
support first, canonical v2 producers second, then removal of the transitional
v1 seam. Local commits are allowed at accepted checkpoints; push happens once,
only after all implementation, audits, and full gates pass. The final state
contains no legacy path.

ADR-119, ADR-124, ADR-130, ADR-135, ADR-143, and ADR-151 remain closed.
ADR-156 remains closed except for one explicitly superseded in-turn aging
detail: every completed exchange gets one immutable compact spine entry at
first insertion; newest-three full observations are bounded suffix overlays;
older in-turn spine entries are not remasked. Cross-turn ADR-156 windows remain
unchanged. This narrow supersession is required to make the long-loop prefix
append-only and is not a general observation-window redesign.

## Context

After a large runtime/tooling change cycle, the observed cached-input fraction
fell materially below the desired level. The founder requested a factual,
read-only audit across OpenAI, DeepSeek, and Anthropic using source code,
runtime receipts, the live database, GKE logs, Cloud Logging, controlled chat
turns, and current provider documentation.

The audit found no per-turn mutation in the compiled stable system prompt.
The confirmed defects are provider-specific request placement, cache-control
refresh, history-breakpoint coverage, and incompatible usage semantics.

### Live evidence at the opening baseline

- Current audited Assistant bundle:
  - `runtimeBundleHash` =
    `ea81ec457687b87cc39c83bf07c2f9debfdf901a8207242bcebea696b8eb5df8`;
  - stable system prompt = `16,986` characters;
  - `stablePrefix.hash` =
    `5d4c82db3c3ce39d1d5f520668b992eec73327b7fbd2b8ddd1473396f90d76f4`.
- Two controlled same-thread DeepSeek turns used the same bundle and reported
  exactly `4,736` cached tokens each. Their first-iteration tool payloads were
  both `43,174` JSON characters. Total input differed because conversation and
  hydrated context differed; the stable system-cache read did not.
- Across the recent seven-day DeepSeek receipt window:
  - main-turn cache-read share was `2,055,680 / 8,828,245 = 23.29%`;
  - tool-loop-follow-up cache-read share was
    `4,055,040 / 8,190,893 = 49.51%`;
  - cache reads were non-zero on almost every call, so the defect is not
    “caching disabled”; the reusable frontier is too early on many calls.
- Across 90 days of canonical receipt entries:
  - OpenAI: `21,012,992 / 40,682,938 = 51.65%` cache-read share;
  - DeepSeek: `6,110,720 / 17,074,801 = 35.79%`;
  - Anthropic: `1,632,795 /
(596,889 + 678,553 + 1,632,795) = 56.14%`, using the only correct
    cross-provider denominator for Anthropic.
- Cloud Logging `turn-catalog-metrics` showed first-iteration tool payloads
  between `28,867` and `45,514` characters, with up to 18 distinct sizes in a
  day. This proves multiple wire projection families exist. It does not by
  itself assign causality to one commit.
- The current live projection for the audited bundle contains 25 tools and
  approximately `43.3k` JSON characters. The largest full projections are
  `browser`, `todo_write`, `shell`, `files`, `image_edit`, `skill`,
  `memory_write`, and `grep`.

Historical weekly receipts establish that OpenAI tool-loop cache-read share
was higher before late June and lower in the sparse post-June samples. They do
**not** identify a single causal commit. This ADR does not claim one.

## Confirmed code facts

### F1 — only DeepSeek ordinary/deep chat places `developerInstructions` before history

`DeepSeekProviderClient.buildMessages` currently emits:

1. stable `systemPrompt`;
2. per-turn `developerInstructions` as a second `system` message;
3. volatile-context `system` messages;
4. hydrated/conversation history;
5. in-turn tool history and follow-up content.

Routing hints, working files, open jobs, presence/time, delivery state, and
tool-loop follow-up guidance therefore precede historical messages on
DeepSeek. A change in those blocks stops exact prefix reuse before history.

OpenAI ordinary/deep chat does **not** have this defect: it places the stable
system item first, splices volatile context before the active user question,
and appends `developerInstructions` after history.

Anthropic ordinary/deep chat does **not** have this placement defect when
moving-history caching is enabled: it appends the wrapped
developer-instruction message after history. Anthropic background-worker
requests receive no positive moving-history threshold and may keep developer
instructions in top-level system blocks before messages. Background workers
have no conversation-history cache objective in this ADR; they remain in
canonical accounting/telemetry scope but are excluded from the D2 chat
placement cutover.

### F2 — Anthropic omits the moving history breakpoint on tool follow-ups

`shouldApplyAnthropicMovingHistoryBreakpoint` returns true only when request
classification is absent or `main_turn`. A `tool_loop_followup` retains the
tools + system breakpoint but receives no moving message-history breakpoint.
Conversation and growing `toolHistory` therefore remain outside the history
cache frontier on those calls.

### F3 — OpenAI cache configuration could become stale inside a turn

The initial OpenAI `prompt_cache_key` includes a `variantHash` of
`deepModeEnabled` and the complete projected tools array.

At the opening baseline, catalog `describe` expansion and active Scenario
Script re-projection mutated `providerRequest.tools` inside the tool loop.
Those mutation seats did not rebuild `promptCache`; the wire tools could
therefore differ from the tools used to derive the current key. The 2026-07-21
repair removes catalog expansion from the wire entirely. Scenario-driven
projection remains an explicit family change.

This is a confirmed routing-key granularity inconsistency, not proof of unsafe
cache reuse: OpenAI combines `prompt_cache_key` with its own initial exact
prefix hash. If PersAI selects a variant-key policy, stale variant inputs are
invalid. If it selects a common-prefix key, final tools are intentionally not
part of the key. Whether either shape produces a higher read rate is not
assumed; it must be measured.

### F4 — tool projection families are intentionally and accidentally dynamic

Confirmed dynamic inputs at the opening baseline included:

- active/inactive Skill knowledge-source enums;
- Scenario-bound Script appearance and schema;
- explicit excluded-tool sets;
- bundle/policy/credential changes.

The 2026-07-21 repair removes catalog stub-to-full wire expansion. The full
contract is now returned only as the immutable `describe` tool result.

Tool order is deterministic for identical bundle and projection options.
The audit did not prove random JSON object-key ordering and this ADR does not
claim it.

### F5 — current usage fields have incompatible meanings

- OpenAI `input_tokens` includes cache-read tokens; `cached_tokens` is a subset.
- DeepSeek `prompt_tokens` includes cache-hit tokens; provider-native hit/miss
  fields partition the prompt according to the provider contract.
- Anthropic `input_tokens` is uncached input only;
  `cache_creation_input_tokens` and `cache_read_input_tokens` are separate.

PersAI currently stores all three meanings in one `inputTokens` field.
Consequences:

- the Admin cache-share query divides `cachedInputTokens` by `inputTokens` for
  every provider, which is invalid for Anthropic and can exceed 100%;
- the internal smoke receipt DTO omits `cacheCreationInputTokens`;
- OpenAI discards GPT-5.6+ `cache_write_tokens`;
- DeepSeek's current adapter reads undocumented
  `prompt_tokens_details.cached_tokens` while the official provider response
  exposes top-level `prompt_cache_hit_tokens` and
  `prompt_cache_miss_tokens`, with
  `prompt_tokens = hit + miss`;
- the cost ledger sets `billableInputTokens = inputTokens` and then adds cache
  creation/read charges. For providers whose total input includes cached
  subsets, the field contract is not sufficient to prove non-overlapping
  billing components;
- the user-facing Credits path in `TrackWorkspaceQuotaUsageService` repeats
  the same overlap and derives a cache-write token weight from a USD
  `cacheCreationInputPer1M` price instead of an explicit quota-weight field.

### F6 — stable compile-time prefix discipline is already correct

The compiled ordinary `systemPrompt` is content-hashed. Presence/time,
heartbeat, routing, current files/jobs, active Scenario reminders, and other
turn-specific state are not interpolated into that compiled system string.
Materialization changes can legitimately produce a new stable hash; this is
configuration invalidation, not per-turn volatility.

### F7 — current OpenAI APIs are model-family-specific

Current OpenAI documentation checked 2026-07-20 states:

- models before GPT-5.6 use automatic caching and may use
  `prompt_cache_retention`;
- GPT-5.6+ uses `prompt_cache_key`, supports explicit
  `prompt_cache_breakpoint`, and uses
  `prompt_cache_options: { mode, ttl: "30m" }`;
- older models reject `prompt_cache_options` and explicit breakpoints;
- GPT-5.6+ reports cache writes as `cache_write_tokens`, billed at 1.25×
  uncached input.

Supporting both active model families is current provider behavior, not a
legacy PersAI compatibility shim. The model catalog must declare the exact
wire policy; runtime must not infer it from model-name string heuristics.

## Decision

### D1 — one canonical cache-zone model

Every text-provider request is assembled from the same logical zones:

1. **tool projection family** — exact provider-visible tool definitions;
2. **stable system** — compiled, content-hashed Assistant prefix;
3. **stable hydrated history** — durable memory core, cross-session carry-over,
   rolling synopsis, and canonical prior conversation/tool exchanges;
4. **turn-stable request prefix** — context and active user content that remain
   semantically and byte stable for every provider call in one tool loop;
5. **sealed in-turn exchange spine** — each completed exchange is inserted
   once as ordered per-iteration assistant text + tool call + deterministic
   compact result and is immutable for the rest of the turn;
6. **live observation overlay/suffix** — newest three full observations,
   incomplete tool work, previews, and guidance that may change next.

Runtime carries an explicit stable-history boundary in the provider request.
Adapters must not infer it from `messages.length - 1`: on a tool follow-up the
last base message may be assistant working text, not the active user question.
The request also carries an explicit sealed-spine boundary. Each exchange keeps
its own assistant pre-tool text rather than rebuilding one aggregate assistant
text block before all tool history. At first insertion, its provider protocol
pair uses the existing deterministic compact representation and is never
rewritten. Newest three full observations are emitted afterward as explicitly
labelled recent-observation overlays, not duplicate tool protocol pairs; they
can rotate without changing the spine. Errors retain informative compact
content and are never bare-masked. Cross-turn projection remains newest one
full / next four compact / older masked.

For a fixed tool projection family, iteration `n + 1` must preserve the
complete cache-content prefix through the prior sealed-spine boundary. No
request builder may insert or rewrite semantic content before that boundary.
The sealed prefix grows on every completed exchange; newest-three full overlays
remain after it. This is the long-loop cache invariant.

`cacheContentHash` is computed from provider-visible semantic content and order
while excluding cache-control metadata (`cache_control`,
`prompt_cache_breakpoint`, request-wide cache options/key). Control locations
are recorded separately. Raw JSON bytes may differ when a provider marker
moves; cache-content bytes before the sealed boundary may not.

Provider adapters may serialize these zones differently, but they must preserve
the longest provider-valid stable prefix and use the provider's cache controls
at the sealed-loop boundary where supported. A tool projection-family
change intentionally starts a new prefix family; within one family, completed
tool history must grow append-only.

No prompt text, tool arguments, user content, file paths, or retrieved content
is written to cache observability logs. Only bounded counts, enums, and hashes
are observable.

### D2 — clean DeepSeek placement cutover

DeepSeek ordinary/deep chat must stop projecting per-turn
developer/volatile blocks before history. Background-worker placement is not
changed by this decision.

The adapter will use the explicit stable-history and sealed-loop boundaries
to partition stable history, turn-stable request context, sealed exchanges,
and the live suffix. Developer/volatile content needed throughout the turn
must be frozen into the turn-stable prefix; genuinely iteration-specific
guidance stays after the sealed-loop boundary and must never be inserted
before an earlier exchange.

DeepSeek has no explicit cache marker. Its documented disk cache persists
request/output boundaries, fixed token intervals, and detected common
prefixes. Therefore the adapter must expose and hash the exact reusable wire
content prefix through the sealed-loop boundary, and sequential live evidence
must prove that provider-reported hit tokens grow beyond the compiled system
prefix into sealed current-turn exchanges during a long loop.

There is one production path after cutover. Delete the early second-system
developer path; add no flag, fallback layout, dual serializer, or legacy
compatibility branch.

Provider contract tests must pin exact role/order for:

- first user turn;
- ordinary multi-turn history;
- active Scenario/reminder;
- tool call + `reasoning_content` round-trip;
- tool result follow-up;
- multimodal-to-text sanitized follow-up.
- byte-identical cache-content hashes through consecutive sealed-loop
  boundaries.

The live gate must prove both correctness and a cache frontier beyond the
compiled system prompt on a seeded history larger than one provider cache
unit.

### D3 — Anthropic cross-turn anchor plus growing tool-loop breakpoint

For ordinary/deep chat, retain the quantized stable-history anchor and add one
rolling breakpoint at the latest **sealed compact spine** tool result on every
`tool_loop_followup`. That provider protocol block is immutable from first
insertion. The newest-three full observation overlays, active/incomplete
exchange, and iteration-volatile developer suffix never belong to the sealed
prefix.

Final order is:

1. stable history with its bounded anchor;
2. turn-stable context;
3. active user request;
4. immutable compact exchange spine;
5. rolling breakpoint on the latest sealed compact tool result;
6. newest-three full observation overlays;
7. active preview/incomplete follow-up content;
8. iteration-volatile developer suffix.

Anthropic documents that `tools`, `system`, and `messages` form one ordered
cache prefix, that tool calls/results are cacheable, and that a growing
conversation can read the prior breakpoint and write only the appended suffix.
The rolling marker uses one of the four provider breakpoint slots; it must not
mark an incomplete tool call/result or the changing developer suffix. The
existing 3,000-token stable-history quantization remains unchanged. Moving the
marker does not violate D1 because `cacheContentHash` excludes cache-control
metadata; semantic content/order through the prior sealed boundary remains
unchanged.

Tests and live telemetry must prove:

- tools + system breakpoint always exists when caching is configured;
- eligible main and follow-up calls retain the stable-history anchor;
- each follow-up marks the latest sealed compact spine result and no later
  block;
- iteration `n + 1` reads through iteration `n`'s prior reusable boundary;
- the compact spine never rewrites and grows once per completed exchange;
- provider-reported writes/uncached tokens and their cost are recorded on every
  iteration;
- cumulative provider-input cost is lower than the no-cache counterfactual in
  the required long-loop benchmark.

### D4 — OpenAI key/request consistency and model-declared wire policy

OpenAI cache-key semantics must match the selected experiment: a variant key
must be derived from the final wire request and rebuilt when its variant inputs
change; a common-prefix key intentionally excludes dynamic tools/hydrated
variants and remains stable while OpenAI's own initial-prefix hash enforces
exact matching.

Implementation begins with a measured key experiment:

- **Variant-consistent key:** retain the tool/hydrated variant inputs and
  recompute after every tool/message projection mutation.
- **Common-prefix key:** key only the stable Assistant/family traffic shard and
  rely on OpenAI's exact prefix match plus initial-prefix hash.

The experiment uses identical controlled traffic and provider-reported
read/write tokens. The parent records the selected shape in this ADR before
the implementation slice is accepted. There is no unmeasured key rewrite.

#### D4 measured key experiment — 2026-07-20

The experiment ran through the deployed `provider-gateway` internal HTTP
endpoint after confirming the OpenAI client was warm and its catalog was
control-plane applied. It used the Admin-managed `openai/api-key`; no
Kubernetes environment secret was read. The warmed catalog included
`gpt-5.6-terra`.

Eight sequential `gpt-5.6-terra` requests used the same 2,190-input-token
controlled prompt and changed only a bounded developer suffix per ordinal.
They were paced at five seconds between calls (12 requests/minute for the one
common key, below the 15 requests/minute constraint):

- variant-consistent keys (`adr161-variant-1` through `-4`) reported cache
  reads of `0, 0, 0, 0` tokens;
- a stable common-prefix key (`adr161-common`) reported cache reads of
  `0, 2,172, 2,172, 2,172` tokens;
- the deployed legacy adapter did not expose cache-write tokens
  (`null`) on these responses, so this evidence selects key shape only and
  does not satisfy the GPT-5.6+ write-cost acceptance gate.

**Selected semantics: common-prefix key.** The production key is stable for an
Assistant/family traffic shard and intentionally excludes dynamic tools and
hydrated variants; OpenAI's exact initial-prefix matching remains the content
correctness guard. GPT-5.6+ explicit write/read accounting remains mandatory
after the policy cutover.

Replace the ambiguous scalar `promptCacheRetention` carrier with one canonical
model-catalog `promptCachePolicy`:

- pre-GPT-5.6 policy: automatic caching plus provider-supported
  `prompt_cache_retention`;
- GPT-5.6+ Responses policy: `prompt_cache_options` in `explicit` mode with
  `30m` TTL, an explicit stable anchor, and an explicit sealed-spine
  breakpoint.

OpenAI Responses `function_call_output` items do not support an explicit
`prompt_cache_breakpoint`; supported explicit markers are content blocks such
as `input_text`, `input_image`, and `input_file`. After each compact spine
exchange, the OpenAI adapter appends one deterministic developer `input_text`
boundary item with this exact canonical shape:

```json
{
  "role": "developer",
  "content": [
    {
      "type": "input_text",
      "text": "<persai_tool_exchange_boundary ordinal=\"000001\"/>",
      "prompt_cache_breakpoint": { "mode": "explicit" }
    }
  ]
}
```

The ordinal is one-based, six-digit, zero-padded ASCII decimal; the literal is
UTF-8 with no leading/trailing whitespace and no newline. Every prior boundary
item and its `prompt_cache_breakpoint` metadata remain in the same cache epoch.
On warmed fixed-family iterations, only the newly appended latest boundary is a
new write candidate; earlier markers are provider read candidates.
Newest-three full observation overlays and volatile guidance follow it. This
is bounded model-visible developer-channel provider-control content, not a user
instruction, tool result, or authorization input.

A tool projection-family change starts a new cache epoch. Marker content stays
in the semantic spine, but breakpoint metadata from prior epochs is removed.
The reset request retains the explicit stable anchor and marks only the latest
current spine boundary, so it creates at most two new writes (new-family anchor

- latest spine boundary), within OpenAI's four-write limit. All reset writes
  are included in the independently reset post-change cost counterfactual.

Explicit mode prevents the rotating full-observation overlay from becoming an
implicit write target. The 50-iteration benchmark must prove that the boundary
blocks preserve the D1 cache-content invariant, retain the expected marker
count, create only the newest write on warmed fixed-family iterations, read
through the immediately prior boundary, enforce the reset epoch/write rules,
do not alter tool-result association/tool choice/final behavior with 40–50
accumulated markers, and produce positive measured net provider-input savings.
Cache-read percentage alone is insufficient because GPT-5.6+ cache writes are
billable.

Catalog data, not model-name branching, selects the wire policy. Rematerialize
all affected bundles and remove the old carrier/read path in the same cutover.
No dual-read compatibility shim remains.

### D5 — canonical non-overlapping usage accounting

Replace ambiguous text-generation cache token fields with one versioned
canonical `TextGenerationUsageAccountingV2` schema:

- `totalInputTokens`;
- `uncachedInputTokens`;
- `cacheWriteInputTokens`;
- `cacheReadInputTokens`;
- `outputTokens`;
- `totalTokens`;
- provider/model/step metadata.

Invariant:

`totalInputTokens = uncachedInputTokens + cacheWriteInputTokens + cacheReadInputTokens`

and:

`totalTokens = totalInputTokens + outputTokens`

Both equations are mandatory for every emitted v2 entry. A provider with no
separately priced write class sets `cacheWriteInputTokens = 0`; its
miss/uncached tokens occupy `uncachedInputTokens`.

Canonical v2 token fields are non-negative integers. If any required input or
output component is unavailable, no canonical token entry is emitted; record a
bounded `usage_unavailable` status instead. If a provider-reported total
disagrees with either invariant, record `usage_mismatch` and fail ledger and
Credits accounting closed for that entry.

Each adapter normalizes its provider-native response once:

- OpenAI: total, cached read, GPT-5.6+ write, residual uncached;
- DeepSeek: official top-level `prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens`, validated against `prompt_tokens`; an alternate
  response shape may be accepted only if current live evidence documents it,
  precedence is explicit, and conflicting shapes fail accounting closed;
- Anthropic: raw uncached, creation/write, read.

If provider fields disagree with totals, fail accounting closed for billing,
emit a safe mismatch metric, and retain the provider request outcome; never
invent a residual or silently double-charge.

The provider text result contract always carries `textUsage`: either one
validated `accounted` entry or an explicit bounded `usage_unavailable` /
`usage_mismatch` result. Successful `RuntimeTurnResult` values always carry a
canonical `textUsageAccounting` envelope; successful non-text synthetic turns
carry the valid zero-entry envelope. Generic `usage` is telemetry only and is
never converted into canonical v2 accounting.

Cost ledger formula:

`uncached × inputPrice + write × cacheWritePrice + read × cacheReadPrice + output × outputPrice`

For each provider call also compute a read-only no-cache input counterfactual
from the same provider-reported tokenization:

`noCacheInputCost = totalInputTokens × inputPrice`

`actualCachedInputCost = uncached × inputPrice + write × cacheWritePrice + read × cacheReadPrice`

`netCacheSavings = noCacheInputCost - actualCachedInputCost`

`netCacheSavingsPercent = netCacheSavings / noCacheInputCost`

Output cost is reported but excluded from this delta because caching does not
change output generation. These values are evidence/analytics derived from
immutable usage and catalog prices; they are not additional ledger charges.

The Admin dashboard, text-turn receipts, text smoke endpoint, text-generation
logs, pricing tests, and text model cost ledger consume only this canonical
schema. The user-facing text Credits quota service and quota-event metadata
consume the same non-overlapping classes.
Historical v1 receipt JSON remains immutable archive and is excluded from v2
cache-rate aggregates; there is no permanent dual-read alias layer.

Token-metered model catalog profiles add an explicit
`cacheWriteInputTokenWeight`. It is product quota truth and must never be read
from a USD price field at runtime. The migration seeds it once from the
currently approved economics with this exact formula:

`inputTokenWeight × (cacheCreationInputPer1M / inputPer1M)`

when both prices are positive; otherwise `inputTokenWeight`. No rounding occurs
until aggregate Credits are finalized. Newly created token-metered profiles
materialize the same deterministic default into the catalog field at write
time; Admin/catalog data owns it thereafter. Runtime never derives quota weight
from price. Providers with no separate write class emit zero write tokens.

Credits formula:

`uncached × inputWeight + write × cacheWriteInputTokenWeight + read × cacheReadInputTokenWeight + output × outputWeight`

Canonical cache-read share:

`cacheReadInputTokens / totalInputTokens`

Cache-write share and hit-call share are separate metrics. Never blend
provider calls with incompatible denominators.

### D6 — explicit tool projection-family identity

Compute a content hash and character count from the exact final
provider-visible tools payload. Record:

- projection family hash;
- tool count;
- JSON character count;
- catalog/full counts;
- reason flags: bundle baseline, Skill source family, Scenario Script family,
  catalog expansion, excluded tools.

The family identity is observability and cache-key input only where the
selected provider policy requires it. It is not authorization. Runtime still
re-resolves every tool call server-side.

ADR-151 Scenario Script authorization remains unchanged. ADR-135 is narrowly
superseded only for post-`describe` wire expansion: the plan-selected
catalog/full projection remains authoritative, but catalog tools never expand
inside `providerRequest.tools`. The full contract exists only in the
`describe` result and a turn-local loaded marker authorizes subsequent calls.
The current 43k payload is a measured size, not by itself proof that one named
tool caused a miss.

### D7 — safe cache observability

Add per-provider-call structured metrics:

- request classification and tool-loop iteration;
- provider/model;
- stable-system hash + chars;
- hydrated-history family hashes + chars;
- sealed-loop `cacheContentHash` + chars and boundary kind;
- tool projection-family hash + chars/count;
- volatile-context and developer-tail character counts;
- effective cache-policy mode, key hash, and breakpoint count;
- canonical total/uncached/write/read token counts;
- actual cached-input cost, no-cache input counterfactual, and net savings;
- mismatch/fallback indicators.

Prometheus counters/histograms aggregate token classes and calls by bounded
provider/model/classification labels. Never use Assistant, chat, request,
cache-key, or content hashes as metric labels.

Receipts retain per-step canonical accounting so main turn and tool follow-up
can be evaluated separately. A turn-level blended number may be displayed only
as a weighted sum over canonical total input. Long loops additionally expose
cumulative reads, writes, misses, actual input cost, counterfactual input cost,
and net savings by iteration without prompt content.

### D8 — no legacy paths and no speculative attribution

- One request assembler per provider after cutover.
- One canonical text-generation usage schema after cutover.
- One model-declared OpenAI cache-policy carrier.
- No feature flags, shadow serializers, TODO stubs, permanent compatibility
  aliases, or indefinite dual reads.
- A bounded versioned v1/v2 internal seam is allowed only for the ordered
  Kubernetes rollout. It has an explicit removal slice and is absent at
  closure.
- No reopening closed prompt/tool-observation programs beyond D1's explicit
  in-turn-only ADR-156 aging supersession.
- No claim that a particular historical commit caused the regression without
  a byte/hash-correlated request record.
- No universal “90%” acceptance threshold. First turns and long tool loops
  have different unavoidable volatile fractions; acceptance is boundary- and
  provider-specific.

`RuntimeUsageSnapshot` consumers for image, video, audio, embedding, and other
non-text capabilities are outside this ADR. Their existing capability-specific
usage contracts are not text-cache aliases and are not removed by D5.

## Scope

### In scope

- `packages/runtime-contract` text-provider request/cache/usage contracts;
- runtime request assembly, cache keys, tool projection-family identity, and
  per-step accounting;
- OpenAI, Anthropic, and DeepSeek text provider clients;
- API receipts, Admin business metrics, model-cost ledger, user Credits quota
  accounting/event metadata, and pricing/weight tests;
- model-catalog cache policy and bundle materialization;
- safe logs/Prometheus metrics;
- controlled provider-matrix smoke, a sequential 50-iteration production-shaped
  tool-loop benchmark, and exact-image live acceptance.

Likely modules:

- `apps/runtime/src/modules/turns/**`;
- `apps/provider-gateway/src/modules/providers/{openai,anthropic,deepseek}/**`;
- `apps/provider-gateway/src/modules/metrics/**`;
- `apps/api/src/modules/workspace-management/application/**`;
- `apps/api/prisma/**` only if the selected catalog/accounting cutover requires
  relational schema changes;
- focused provider/runtime/API tests and smoke helpers.

### Out of scope

- changing prompt prose, persona, Role, Skill, Scenario, memory, or response
  semantics beyond D1's bounded per-exchange ordering/projection rule and D4's
  exact OpenAI developer-channel boundary marker;
- changing plan-selected ADR-135 catalog/full exposure beyond removal of the
  measured post-`describe` wire mutation;
- changing ADR-143/156 compact/full definitions or cross-turn windows;
- changing provider/model routing or fallback policy;
- adding a cache service or PersAI-owned KV cache;
- cross-provider cache reuse;
- dynamic/token-budget cache compaction;
- changing Script authorization or execution;
- comparing PersAI to an undefined external dashboard metric as a closure gate.
- changing non-text image/video/audio/embedding usage contracts or accounting.

## Orchestrated work plan

### S0 — contracts, fixtures, and observability

- Introduce canonical text-generation usage accounting v2 and exact provider
  fixtures without changing shared non-text usage contracts.
- Add the explicit `cacheWriteInputTokenWeight` catalog field and migration
  plan; remove runtime derivation from USD pricing in the final cutover.
- Add safe zone/projection/cache-policy telemetry.
- Add provider-matrix and 50-iteration loop fixtures, reusable-prefix
  assertions, no-cache counterfactual calculations, and current model-catalog
  cache-policy shape.
- Define and test the versioned v1/v2 mixed-pod rollout/rollback protocol.
- No provider placement behavior change.

Gate: independent audit of contract semantics, billing partition invariants,
PII/cardinality safety, and migration/cutover plan.

### S1 — DeepSeek stable-history cutover

- Implement D2 and delete the early volatile-system path.
- Decode official DeepSeek top-level hit/miss fields, validate their sum, and
  define any live-proven alternate shape explicitly.
- Add seeded long-history and append-only sealed-loop-prefix tests.

Gate: focused provider/runtime suites and independent request-order audit.

### S2 — Anthropic growing-history and completed-loop caching

- Implement D3 with the existing stable-history quantization plus the rolling
  latest-completed-exchange breakpoint.
- Add main/follow-up breakpoint and read/write accounting coverage.
- Prove completed tool results receive the rolling marker while incomplete
  exchanges and volatile suffixes never do.

Gate: independent cache-boundary audit; no chunk-size tuning.

### S3 — OpenAI key and policy cutover

- Run the bounded key experiment and record the selected result.
- Validate GPT-5.6+ explicit mode + stable/spine boundary blocks against the
  long-loop cache-content, behavior, and net-savings gates.
- Implement key/request consistency.
- Cut model catalog/runtime bundle to `promptCachePolicy`.
- Add GPT-5.6+ explicit breakpoint/write accounting while preserving the
  provider-required pre-5.6 policy through catalog truth.
- Delete the old carrier and read path.

Gate: current OpenAI documentation re-check, full OpenAI provider tests, and
independent catalog/request audit.

### S4 — API dashboard, Credits, receipts, and ledger cutover

- Move smoke receipts, Admin metrics, Credits quota/event metadata, pricing,
  and ledger to canonical v2.
- Exclude historical v1 rows from v2 ratios.
- Prove exact non-overlapping cost and Credits formulas for all three
  providers, including explicit cache-write weights.
- Expose actual cached-input cost, no-cache counterfactual, absolute net
  savings, and savings percentage for each text call/turn/provider cohort.
- Remove ambiguous old usage fields/readers.

Gate: independent billing/accounting audit and exact fixtures against
provider-native examples.

### S5 — final local audit and ordered versioned cutover

- Full recursive lint, format, API/Web/provider/runtime typechecks, affected
  and full tests, Prisma validation/migration checks when applicable.
- Independent architecture, cache-boundary, security/privacy, and billing
  audits must return CLEAN.
- Release A: deploy additive runtime and API text-usage consumers that treat
  the current missing discriminator as transitional v1 and accept only an
  explicit `schemaVersion: 2` for canonical v2, while accounting v1 exactly as
  before. Provider-gateway and runtime continue emitting v1.
- Release B1: after every runtime consumer advertises v2 capability, activate
  and enforce the runtime v2-consumer image floor; only then may
  provider-gateway text clients begin emitting v2. Runtime consumes v2 but
  continues emitting v1 to API.
- Release B2: after every API consumer advertises v2 capability, activate and
  enforce the API v2-consumer image floor; only then may runtime begin emitting
  v2 text usage to API receipts, Credits events, and ledger events.
- Prove no active/queued old producer remains at either boundary, then Release
  C deletes v1 consumers, the missing-discriminator branches, old text fields,
  and transitional routes in provider-gateway, runtime, and API.
- Rollback is version-scoped; an unrecognized version fails accounting closed
  and never silently drops or double-counts usage.
- Before Release C, deploy truth additionally activates v2-producer floors for
  provider-gateway and runtime, validates every exported internal contract
  marker, and retains the already-active consumer floors. GitOps rejects a
  rollback below any active floor from the moment that floor is activated,
  including during B1/B2 before v1 removal.
- This bounded three-release migration is not a permanent legacy path.

### S6 — live provider matrix and long-loop savings acceptance

For each active provider/model family:

1. cold request;
2. exact warm repeat;
3. same stable history with changed developer/volatile context;
4. seeded history beyond the provider cache unit;
5. one short tool loop;
6. catalog `describe` contract delivery with an unchanged tools-family hash;
7. active Scenario Script projection family;
8. provider fallback before output.

Then run, for every active text provider/model-family cache policy, one
sequential **50-iteration** tool loop through the production request builder
and provider adapter:

- one fixed tool projection family for the primary run;
- exactly one completed tool exchange is appended per iteration;
- calls are sequential, never parallel, and each next call begins only after
  the previous provider response completes and its tool result is finalized;
- inter-request timing and any provider-specific controlled settle delay are
  recorded separately from the authenticated natural-cadence run;
- the controlled OpenAI run is paced to at most 15 requests/minute for one
  `prompt_cache_key` and completes within the 30-minute TTL; per-key request
  rate is recorded;
- bounded synthetic tool-result sizes are selected from safely observed
  production p50 and p95 character-count buckets;
- provider/model/tool family, initial prompt, and turn-stable context remain
  unchanged;
- every iteration records input size and reserved output budget and must satisfy
  `inputTokens + reservedOutputTokens <= catalogContextWindow`;
- no overflow recovery, truncation, session compaction rewrite, tool-history
  clear, or cache epoch reset may occur in the fixed-family run;
- a separate run changes the projection family once at iteration 20 to prove
  one explicit family reset followed by re-warming.

Finally run one authenticated end-to-end PersAI turn with 40–50 sequential tool
exchanges and the same telemetry. Its natural cadence and per-key request rate
are recorded separately rather than artificially paced. No benchmark-only tool
or cache bypass ships in the user-visible projection.

Required evidence:

- final zone/projection hashes and counts;
- provider-native plus canonical read/write/uncached totals;
- DeepSeek cache frontier survives changed developer context and extends into
  seeded stable history and sealed current-turn exchanges;
- Anthropic follow-up carries both the stable anchor and latest-completed-loop
  breakpoint, and the next iteration reads through that boundary;
- no incomplete exchange or volatile suffix carries a breakpoint;
- OpenAI key follows the selected semantics: final-variant consistency for a
  variant key, or deliberate stability for a common-prefix key;
- after the newest-three delay, the prior sealed-loop `cacheContentHash` is
  byte-identical in the next request; cache-control metadata/location is
  compared separately;
- median cache-read tokens in iterations 41–50 exceed iterations 2–10;
- all 50 requests remain inside the catalog context budget with no overflow,
  truncation, compaction rewrite, or history reset;
- cumulative actual cached-input cost is strictly below the no-cache input
  counterfactual for every active provider/model-family policy;
- report absolute provider-currency savings, savings percentage, read/write/
  uncached tokens, and per-iteration cumulative curves;
- the projection-change run resets its cost/savings counterfactual at iteration
  20; iterations 20–50 must independently become net-positive after rewarming,
  and the whole run must also remain net-positive;
- on the OpenAI reset request, prior-epoch breakpoint metadata is absent and
  provider usage shows no more than the two allowed new writes (new-family
  stable anchor + latest spine boundary); both are charged to the post-reset
  segment;
- the authenticated 40–50-exchange turn completes normally without context
  recovery and reports natural inter-request cadence;
- all canonical accounting equations balance;
- ledger cost matches the provider-specific fixture;
- Credits delta and event metadata match provider-specific quota fixtures;
- no prompt/user/tool-result content appears in logs or metric labels.

Founder acceptance closes ADR-161 only after the parent reconciles ADR,
handoff, changelog, architecture/API/data-model/test-plan documentation.

## Acceptance criteria

1. Compiled stable-system bytes/hash remain unchanged when only per-turn
   volatile state changes.
2. DeepSeek ordinary/deep chat places developer/volatile context after stable
   history and preserves the append-only sealed-loop prefix on main and
   tool-follow-up requests.
3. Anthropic retains the stable-history anchor and marks the latest sealed
   compact spine result on follow-ups; full overlays and incomplete/volatile
   suffix blocks remain unmarked.
4. OpenAI cache key follows the measured selected key semantics; no stale
   variant-derived key remains if variant mode is selected.
5. GPT-5.6+ cache writes are captured and priced; pre-5.6 behavior is selected
   only by catalog policy.
6. Tool projection families are deterministic and observable without content
   leakage.
7. All providers emit canonical non-overlapping input classes satisfying the
   accounting invariant.
8. Admin, smoke, receipts, Prometheus, Credits, and ledger use canonical
   non-overlapping classes, expose main/follow-up separately, and report
   actual-vs-no-cache provider-input cost.
9. No old text-usage alias, old cache-policy carrier, dual text serializer, or
   feature flag remains after the versioned cutover removal release; non-text
   capability usage contracts are unchanged.
10. Mixed-version rollout and rollback tests prove no silent accounting loss
    or duplicate charge.
11. In the fixed-family 50-iteration benchmark, each sealed-loop
    `cacheContentHash` is byte-identical in the next request and cache-read
    tokens grow with completed exchanges.
12. OpenAI retains all prior spine breakpoint markers, writes only the newly
    appended boundary on warmed fixed-family iterations, reads through the
    immediately preceding boundary, preserves correct tool/final behavior with
    40–50 markers, and applies the bounded two-write epoch-reset rule.
13. Every active provider/model-family policy shows strictly positive
    cumulative provider-input savings against the same-token no-cache
    counterfactual; a cache-hit percentage without positive savings fails.
14. OpenAI's controlled run stays at or below 15 requests/minute per key; the
    authenticated turn separately reports its natural request rate.
15. One authenticated 40–50-exchange PersAI turn passes, and the
    projection-family reset run is net-positive both end-to-end and for the
    independently reset post-change segment.
16. Every benchmark request remains inside the catalog context/output budget;
    no overflow recovery, truncation, compaction rewrite, or history reset
    occurs.
17. Full local, CI, exact-image, and provider-matrix live gates pass.
18. A chat's `cross_session_carry_over` snapshot, including an empty snapshot,
    remains byte-identical for the lifetime of that chat.
19. Catalog `describe` exposes the full contract only in tool history and does
    not change provider-visible `tools` on OpenAI, DeepSeek, or Anthropic.

## Risks and mitigations

- **DeepSeek role/order behavior:** lock provider-valid ordering in contract
  tests and live smoke before closure; fail closed rather than restoring the
  old early-volatile path.
- **Anthropic/OpenAI cache-write amplification:** retain the stable anchor,
  mark only the sealed compact spine, and reject any policy whose measured
  write premium makes the 50-iteration net savings non-positive.
- **OpenAI model-family API differences:** model catalog declares the exact
  wire policy; older models never receive unsupported GPT-5.6 options.
- **OpenAI boundary-marker behavior:** the deterministic developer text marker
  carries no user/tool content; exact bytes are pinned and focused/live tests
  must prove correct tool-result association, tool choice, result use, and
  final behavior with 40–50 retained marker blocks.
- **Billing drift:** canonical partitions must balance before ledger writes;
  mismatches are observable and non-billable until reconciled.
- **Credits drift:** quota weights are explicit catalog truth; cost prices are
  never reused as Credits weights at runtime.
- **Mixed-pod rollout:** use the bounded versioned consumer-first protocol and
  delete v1 only after old producers drain.
- **Metric cardinality/content leakage:** hashes remain in structured logs or
  receipts, never Prometheus labels; no raw content is logged.
- **Tool-family churn:** observe exact families first; do not weaken
  authorization or closed ADR behavior to chase a percentage.
- **Provider best-effort cache behavior:** closure uses sequential live
  provider-reported tokens and positive net cost, not an assumed hit guarantee.
- **Long-loop context growth:** immutable compact spine entries are bounded;
  any context recovery/reset invalidates the benchmark rather than being
  counted as cache success.

## Consequences

### Positive

- Provider cache behavior follows one explicit zone model.
- DeepSeek can reuse stable history instead of only the early system prefix.
- Completed tool-loop history becomes a growing reusable prefix on every
  provider, using provider-native controls where available.
- OpenAI keys and cache controls match the actual request/model family.
- Cache read/write rates and actual net savings are comparable across
  providers.
- Future cache regressions identify the first changed zone from safe evidence.

### Negative

- Canonical accounting and model-policy cutovers touch provider, runtime, API,
  billing, and observability boundaries.
- Historical v1 receipts remain archival and cannot be mixed into v2 trend
  charts.
- Dynamic tool projection still creates legitimate cache families.
- Provider-matrix acceptance requires paid live calls on all three providers.
