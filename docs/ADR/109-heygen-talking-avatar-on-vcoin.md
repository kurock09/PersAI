# ADR-109: HeyGen talking-avatar mode and workspace character registry

## Status

Proposed (2026-06-03). Depends on ADR-108 at minimum through slice 3 (settle path debit + monthly grant). Parallel to ADR-102. **Slice 0 Completed (2026-06-04)** — baseline SHA, HeyGen v3 API truth, and 6 binding UX decisions recorded; see `## Slice 0 erratum (2026-06-04)` at the bottom of this ADR for the binding amendments that supersede the original slice specs where they conflict. **Slice 1 Completed (2026-06-04)** — HeyGen API key credential slot landed in `tool-credential-settings.ts` + `/admin/tools` Video Providers section; 7 verification gates green; no HeyGen HTTP calls yet (Slice 6 owns the client). **Slice 2a Completed (2026-06-04)** — HeyGen recognized as video catalog provider symmetric to Runway/Kling: union/contract widening, Admin Runtime UI card with empty round-trip, placeholder branches where exhaustive switches demanded; 8/8 verification gates green; Slice 2 split into 2a (substrate) + 2b (capability axis + plan validation). **Slice 2b Completed (2026-06-04)** — `RuntimeVideoModelKind = "cinematic" | "talking_avatar"` structural field on every `RuntimeProviderModelProfileBase`, provider-locked at parser level (HeyGen→talking_avatar, others→cinematic) with throw-on-incompatibility; plan validation refuses talking_avatar rows for `videoGenerateModelKey`/fallback; chat tool projection filters HeyGen out of cinematic `video_generate` surface via structural `isTalkingAvatarVideoProvider(providerId)` helper; Admin UI shows read-only "Cinematic"/"Talking Avatar" badge per row; 10/10 verification gates green; capability derivation is purely structural (invariant #15 preserved). **Slice 3 Completed (2026-06-04)** — `RuntimeVideoGenerateMode = "cinematic" | "talking_avatar"` request-mode contract with new optional fields (`mode`, `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey`) on `RuntimeVideoGenerateRequest` + symmetric `requested*` echoes on `RuntimeVideoGenerateToolResult` + pass-through on `ProviderGatewayVideoGenerateRequest`. Structural validation in runtime tool service: `mode === "talking_avatar"` requires speechText + speechLanguage + XOR(personaId, portraitImageAlias); `mode === "cinematic"` or absent ignores new fields. Provider-gateway DTO accepts and forwards new fields; HeyGen branch retains Slice 2a placeholder throw. NO multi-character refusal in code (operator-superseded original spec clause; single-speaker rule moves to Slice 8 tool description). Tool projection JSON Schema unchanged (Slice 8 + 9 will wire). 10/10 verification gates green; invariant #15 verified (XOR is pure boolean, no regex/parsing). **Slice 4 Completed (2026-06-04)** — HeyGen voice catalog cache substrate landed as a structural mirror of the existing Kling pattern: new `PlatformHeygenVoiceCatalogCache` Prisma model + migration, new `HeyGenVoiceCatalogService` with 24h TTL fetching `GET https://api.heygen.com/v3/voices` via `X-Api-Key` (defensive multi-alias response parsing of both wrapped + flat shapes), `RuntimeVideoVoiceCatalogEntry.previewAudioUrl?` added (backward-compatible), `RuntimeVideoVoiceCatalog.provider` widened to `"kling" | "heygen"`, Kling service augmented to extract/hydrate `previewAudioUrl` symmetrically, materialization service uses explicit parallel branches for kling/heygen. Discovered + fixed pre-existing Slice 2a fixture omission in `materialize-assistant-published-version.service.test.ts` (latent — not a Slice 3 false-PASS because Slice 3 verification did not run this specific test). 10/10 verification gates green; #15 NON-NEGOTIABLE preserved (all parsing is structural JSON field inspection of HeyGen API response, zero regex on user input). **Slice 5 Completed (2026-06-04)** — Workspace persona registry: new `WorkspaceVideoPersona` Prisma model + migration (`workspace_video_personas` table, soft-delete via `archived` flag, FK ON DELETE RESTRICT, unique index on `(workspaceId, displayNameLower)`); `ManageWorkspaceVideoPersonasService` with create (single `prisma.$transaction`: limit check → duplicate-name check → persona insert → ledger event recordEvent → balance read → debit, all inside one tx via ADR-108 wallet primitives, ledger-first → debit-second per ADR-108 Slice 3 discipline), list (active rows + platform limit), archive (soft-delete only, no HeyGen API call, no VC refund); workspace-scoped REST controller (`POST/GET/DELETE /api/v1/workspaces/:workspaceId/video-personas`) with multipart portrait upload + fail-closed `req.workspaceId` identity auth; portrait normalized to 1024×1024 JPEG via `sharp` and saved AFTER tx commits (orphan-blob safe). Two new platform knobs (`heygenPersonaWorkspaceLimit` default 10, `heygenPersonaCreationVcoin` default 20) on `PlatformRuntimeProviderSettings` + Admin Runtime UI "Vcoin Economy" fold (bundled fix for pre-existing `vcoinExchangeRate` save-payload omission in the same admin path). `WorkspaceVcoinLedgerEventKind` union widened to `"persona_creation"`. 12/12 verification gates green. Voice selection is exact `providerVoiceId` equality against Slice 4 cached shortlist (zero fuzzy match, zero regex); duplicate-name check is `.toLowerCase()` equality (no fuzzy match). NO HeyGen HTTP calls anywhere (Slice 6 owns). `apps/runtime/**` untouched — invariant #14 (REST-only persona mutation) preserved. ADR-108 (Vcoin substrate) is fully closed and verified live.

## Context

ADR-106 made `video_generate` provider-aware for OpenAI/Runway/Kling. ADR-107 added the audio capability axis (`silent`, `provider_native_audio`, `voice_control`) and the input capability axis (`text`, `single_reference_image`, `multi_image`, `omni`), and explicitly stated that "Runway voice/audio/avatar APIs must not be conflated with general-purpose `video_generate`" (`docs/ADR/107-provider-native-video-audio.md:39-40`). ADR-108 introduces Vcoin (VC) as the user-facing settlement currency for `video_generate`.

The next product step is HeyGen talking-avatar video. The product expectation is:

- User attaches a photo and asks to make a video with spoken text -> assistant produces a talking-head video using the photo and a Russian preset voice.
- User asks to "save Masha from this photo" -> assistant creates a workspace persona (display name + portrait + voice).
- User later asks to "have Masha read this text" -> assistant looks up the persona, reuses the cached HeyGen avatar, and renders the new video.

HeyGen exposes a Photo Avatar Video class of APIs that accept a photo and a voice id and produce a talking video without requiring the caller to first create a HeyGen avatar entity. HeyGen also exposes voice presets (`GET /v3/voices`) including Russian voices, and a voice cloning endpoint (`POST /v3/voices/clone`).

The architectural tension this ADR resolves: ADR-107 line 39-40 forbids conflating Runway voice/avatar APIs with general-purpose `video_generate`. HeyGen talking-avatar is architecturally similar (single-persona talking head from a portrait plus voice plus text). This ADR makes an **explicit, named exception** for HeyGen and formalizes the new product class as a top-level `mode` on the existing `video_generate` tool, so the tool surface does not multiply.

Per the 2026-06-03 audit synthesis, the user-confirmed shape is:

- `mode: "cinematic" | "talking_avatar"` as a top-level field on the `video_generate` request.
- `talking_avatar` is HeyGen-only in the first version; cinematic remains across OpenAI/Runway/Kling.
- Voice strategy MVP: HeyGen presets only (cached as Kling voice catalog is cached). Voice cloning is deferred to a later ADR.
- Workspace persona registry: separate PersAI entity. HeyGen avatar id is provider metadata stored on the persona row, created lazily on first use. Persona limit is configurable, default 10 per workspace.
- Plan toggle: boolean on the `video_generate` tool activation card in plans.
- Persona creation costs a fixed VC amount (configurable in Admin Tools) and is debited only on creation success.
- Render cost: catalog $/sec _ seconds _ `vcoinExchangeRate` per ADR-108 settle path.
- Multi-character in a single clip is deferred. MVP supports one persona per clip; the assistant proposes splitting a multi-character request into multiple clips.

## Decision

Add HeyGen as the fourth `video_generate` provider. Add `mode: "cinematic" | "talking_avatar"` as a top-level field on the request. Add a workspace-scoped persona registry. Gate `talking_avatar` per plan with a boolean on the `video_generate` activation card. Settle render cost through the ADR-108 VC wallet. Cache HeyGen presets the way Kling voices are cached.

### Provider policy

- `talking_avatar` is HeyGen-only. There is no automatic fallback to Runway, Kling, or OpenAI for `talking_avatar`. ADR-107 line 39-40 remains true for Runway and Kling; this ADR carves an exception only for HeyGen.
- `cinematic` continues to route to OpenAI / Runway / Kling exactly as ADR-106/107 already define.
- Voice cloning (`POST /v3/voices/clone`), avatar group APIs, scenes/montage, background music, and lipsync to third-party avatars are out of scope.
- Multi-character in a single clip is out of scope; the assistant must propose splitting into multiple clips when the user asks for it.

### User scenarios

**Scenario A: ad-hoc photo + text (no persona persistence).** User attaches a photo and asks to make a video with a spoken text. Runtime resolves the `portraitImageAlias` to a stored reference image, picks the assistant's default Russian voice (or the user-supplied `voiceKey`), and calls HeyGen Photo Avatar Video directly. No persona row is created. No "create avatar" VC charge. Render is debited from VC on success.

**Scenario B: explicit persona creation.** User says (or the assistant infers an explicit request) "save this as Masha". Runtime creates a `workspace_video_personas` row with `{ display_name, portrait_asset_id, heygen_voice_id, heygen_avatar_id = null }`. Persona creation debits the configured fixed VC cost on success. HeyGen avatar id is not created in this step.

**Scenario C: persona reuse.** User says "have Masha read this text". Runtime looks up persona by name (case-insensitive). If exactly one match: if `heygen_avatar_id` is null, runtime triggers HeyGen avatar creation lazily, persists the id, then proceeds with render. If `heygen_avatar_id` is already set, runtime uses it directly. Render is debited from VC on success. If zero matches, the assistant asks for clarification. If multiple matches, the assistant returns a list for the user to pick from. No keyword routing, no auto-guess.

### Persona registry shape

```ts
// workspace_video_personas
{
  id: string; // uuid
  workspace_id: string; // FK workspaces
  display_name: string; // unique within workspace, case-insensitive
  portrait_asset_id: string; // FK assistant_files (uploaded portrait)
  heygen_voice_id: string; // chosen at creation, from HeyGen presets
  heygen_avatar_id: string | null; // null until first talking_avatar render with this persona
  vc_cost_paid: number; // VC debited at creation
  created_at: Date;
  updated_at: Date;
}
```

A workspace has a configurable persona limit (default 10). The limit is stored in Admin Tools alongside the persona creation rate.

### Runtime contract shape (target)

The exact contract is finalized in slice 3 after a contract pass. The target shape is:

```ts
type RuntimeVideoGenerateMode = "cinematic" | "talking_avatar";

interface RuntimeVideoGenerateRequest {
  mode: RuntimeVideoGenerateMode;
  // cinematic-only fields
  prompt?: string;
  // talking_avatar fields
  speechText?: string;
  speechLanguage?: string; // ISO code, e.g. "ru"
  personaId?: string; // workspace persona, optional
  portraitImageAlias?: string; // ad-hoc photo when no persona
  voiceKey?: string; // explicit HeyGen preset voice id; overrides persona/default
  // common
  seconds?: number;
  size?: { width: number; height: number };
  // existing ADR-107 fields (audioMode, inputMode, voiceIds, voiceKeys, referenceTailImage, etc.)
}
```

Validation:

- `mode = "cinematic"`: same rules as ADR-106/107. `talking_avatar` fields are ignored if present.
- `mode = "talking_avatar"`: requires `speechText`, `speechLanguage`, and exactly one of `personaId` or `portraitImageAlias`. Plan must have `talkingVideoEnabled = true`. Provider must resolve to HeyGen; if not, the request fails honestly with `talking_avatar_provider_unavailable`.
- Multi-character requests (more than one persona reference or more than one named speaker in `speechText`) are rejected with `multi_character_not_supported`; the assistant is instructed by the tool description to split the work into multiple calls.

### Plan toggle

A new boolean `talkingVideoEnabled` on the `video_generate` tool activation card in the plan editor. Default false. When false, `mode = "talking_avatar"` requests fail with `feature_unavailable` and the runtime does not call HeyGen.

### Voice catalog cache

HeyGen voice presets are fetched via `GET /v3/voices` (or the equivalent listing endpoint), cached in a new platform table `platform_heygen_voice_catalog_cache` with the same 24h TTL pattern used by `KlingVoiceCatalogService`. Refresh is lazy on materialization (no cron). The cached shortlist is attached to the materialized assistant bundle on the `video_generate` ref when the resolved provider is `heygen`.

### Cost model

- **Persona creation cost (fixed VC):** stored in Admin Tools as `heygenPersonaCreationVcoin` (default 20 VC, configurable). Debited on persona row creation success. If `heygen_avatar_id` later creation fails, the persona row stays (with `heygen_avatar_id = null`) and the user is not charged twice.
- **Render cost (variable VC):** computed on success delivery by ADR-108 settle path. Catalog $/sec for HeyGen talking-avatar rows is admin-configured in Admin Runtime (same pattern as Runway/Kling video rows).
- **HeyGen-side avatar creation cost:** the HeyGen API may charge per avatar creation; that cost flows into the USD COGS ledger but is **not** separately surfaced to the user. The persona creation VC charge covers it conceptually.

## Non-goals

- Talking-avatar through Runway, OpenAI, or Kling. ADR-107 line 39-40 remains true for them.
- Voice cloning (`POST /v3/voices/clone`).
- Multi-character per clip / scenes / montage.
- Background music, sound effects, lipsync to non-HeyGen avatars.
- A standalone public Personas API / SDK.
- Sandbox / preview UI for personas (admin-side only in the first version).
- Auto-persisting every ad-hoc photo as a persona. Persona creation is explicit.
- Reforming VC pricing. ADR-108 owns it.
- Cross-plan persona sharing.

## Agent execution model

This ADR is executed by an **orchestrator agent that does not write code**. The orchestrator holds context across slices, plans one bounded slice at a time, spawns implementation subagents with precise prompts and file boundaries, diff-reviews every return, runs the focused tests and repo gates itself, and updates docs. Implementation subagents are the only actors that write source code.

### Orchestrator role

- **Read-only** for source/code files (`apps/**`, `packages/**`, `prisma/**`, infra, scripts).
- **Write-capable** only for docs: `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, this ADR's slice status blocks, and the doc updates listed per slice (`docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`).
- Spawns one implementation subagent per slice. May spawn additional readonly audit subagents inside the slice's planning step for context-gathering (HeyGen API truth, persona-lookup edge cases, etc.).
- Diff-reviews every subagent return and rejects if scope was violated.
- Runs focused tests and repo gates through its own shell. Does not trust a subagent's PASS/FAIL claim unless verbatim command output was included.
- Refuses to mark a slice complete if the per-slice acceptance gate fails.
- Never commits or pushes (matches AGENTS.md).
- Enforces the ADR-108 dependency: ADR-108 must be at least at Slice 3 (settle path debit + monthly grant) **before** ADR-109 Slice 7 (runtime talking_avatar execution) is spawned. Earlier ADR-109 slices (0-6) can interleave with later ADR-108 slices.

### Per-slice orchestrator workflow

1. **Confirm tree.** `git status` clean. If dirty, stop and surface to the user.
2. **Confirm baseline.** Record SHA in `docs/SESSION-HANDOFF.md` if not already recorded for this session.
3. **Confirm ADR-108 dependency** for slices that need it (>= ADR-108 Slice 3 required for ADR-109 Slice 7).
4. **Read slice spec.** This ADR's `Slice specifications` for the current slice + all `Likely files` for that slice.
5. **State plan in chat.** Slice id, purpose, Scope IN, Scope OUT, files to touch, tests to add, exit criteria. Precondition for spawning the implementation subagent.
6. **Spawn one implementation subagent** using the prompt template below. Sequential, write-capable.
7. **Receive subagent return.** Mandatory structure (see below).
8. **Diff-review.** Reject if any `Scope OUT` file was touched, any `Forbidden patterns` are present, or the return structure is incomplete.
9. **Run focused tests + repo gates** from the slice spec plus this ADR's cross-slice invariants. Through orchestrator's own shell.
10. **Apply doc updates** listed for the slice.
11. **Append CHANGELOG line** matching the existing pattern.
12. **Update SESSION-HANDOFF** with baseline SHA, files touched, tests run, risks, deploy, next recommended step.
13. **Mark slice complete** in this ADR's `Slice specifications` by appending a `**Status (YYYY-MM-DD): Completed.**` block in the ADR-106 format.
14. **State next recommended slice** in chat.

If any step fails, the orchestrator rolls back (`git restore`) or re-spawns the subagent with a corrected prompt. Partial work is not silently accepted.

### Implementation subagent prompt template

The orchestrator constructs every implementation subagent prompt with these exact sections, derived from the slice spec:

- **ADR + slice id.** Example: `"ADR-109 Slice 6 - Provider-gateway HeyGen client"`.
- **Required reading.** Verbatim absolute paths: this ADR + ADR-108 (always — talking-avatar settles through ADR-108 wallet) + the slice's prior-ADR list + this slice's `Likely files`.
- **Purpose.** One paragraph from the slice's `Scope`.
- **Scope IN.** Exact files / directories the subagent may edit.
- **Scope OUT.** Exact files / directories the subagent must not touch (cinematic execution paths, image/tts/stt, chat routing, OpenAI image path, ADR-108 wallet code unless explicitly opened, etc.).
- **Required tests.** Verbatim from the slice `Required tests`.
- **Forbidden patterns.** Slice-specific anti-patterns (no keyword routing for persona lookup, no auto-guess on ambiguous persona names, no fallback to non-HeyGen for `talking_avatar`, no broad reformat, no commits, no push).
- **Verification commands.** Exact `pnpm` invocations the subagent must run with output included.
- **Return structure.** The mandatory structure below, listed in full so the subagent cannot omit it.

### Subagent return structure (mandatory)

The implementation subagent must return all seven items. Returns missing any item are rejected without diff-review:

1. **Changed files** — one bullet per file with one-line behavioral summary.
2. **Tests added or changed** — file path + assertion summary.
3. **Tests run** — exact commands + PASS / FAIL per command + tail of output where useful.
4. **Behavioral summary** — 3-5 bullets, no prose.
5. **Risks observed** — anything the orchestrator should know that is not in the slice spec.
6. **Out-of-scope discoveries** — issues found but not fixed. Orchestrator decides whether to file a follow-up slice or expand the current one.
7. **Diff line counts per file.**

### Per-slice acceptance gate

Before the orchestrator marks a slice complete, all of the following must be true:

- [ ] Every file in `Scope IN` was changed as planned; no file in `Scope OUT` was touched.
- [ ] Every test listed in `Required tests` exists and passes.
- [ ] No `Forbidden patterns` appear in the diff.
- [ ] Doc updates listed for the slice are present in the same change set.
- [ ] CHANGELOG line appended.
- [ ] SESSION-HANDOFF updated.
- [ ] This ADR's slice spec carries a `Status (YYYY-MM-DD): Completed.` block.
- [ ] Repo verification gates for the slice pass through the orchestrator's own shell.
- [ ] Cross-slice invariants below remain true (orchestrator may spawn a small readonly audit subagent to confirm if the diff is non-trivial).
- [ ] For Slice 7+: ADR-108 Slice 3 was already merged before this slice was started.

If any item fails, the orchestrator either re-spawns the subagent with a corrected prompt or rolls the slice back.

### Subagent rules (binding on every implementation subagent)

- Read this ADR + ADR-108 + the slice-specific files before editing.
- Edit only files listed in `Scope IN`.
- Refuse to edit `Scope OUT` files even if a refactor would seem helpful — surface as `Out-of-scope discoveries`.
- Return the mandatory structure above in full.
- Do not commit or push.
- Do not run broad reformatters across files outside `Scope IN`.
- Do not introduce keyword routing for persona lookup — that lives in the model + tool description, never in code.
- Do not silently auto-pick a persona on ambiguous match — surface the list to the user via runtime advisor copy.
- Do not let `mode: "talking_avatar"` fall back to non-HeyGen providers.
- Add focused tests for each changed seam.
- Run every verification command listed by the orchestrator and include the exact output tail.

### Cross-slice invariants the orchestrator enforces (above per-slice Scope OUT)

1. Cinematic mode behavior unchanged anywhere in this ADR.
2. ADR-106 invariants preserved (Runway/Kling video-only, chat routing OpenAI/Anthropic-only, OpenAI image untouched).
3. ADR-107 line 39-40 still applies to Runway and OpenAI; only HeyGen has the named exception.
4. ADR-105 media-job durability preserved.
5. Image / TTS / STT / chat routing behavior unchanged anywhere in this ADR.
6. No keyword routing for persona lookup anywhere.
7. `talking_avatar` mode never falls back to non-HeyGen providers.
8. Persona registry is workspace-scoped, never assistant-scoped.
9. VC debit for persona creation + render goes through ADR-108 wallet code (no parallel debit path).
10. HeyGen `avatar_id` is never surfaced in user-visible labels — only the persona's `display_name`.

If a subagent return violates any of these, the slice is rolled back.

### Required startup reading

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. `docs/ADR/108-video-vcoin-economy-and-pre-talking-avatar-cleanup.md`
9. this ADR
10. relevant prior ADRs:
    - `docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md`
    - `docs/ADR/086-async-media-jobs-for-generated-image-audio-and-video.md`
    - `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
    - `docs/ADR/105-media-job-truth-and-orchestrated-cleanup.md`
    - `docs/ADR/106-video-provider-catalog-and-execution-routing.md`
    - `docs/ADR/107-provider-native-video-audio.md`

## Execution ledger

| Slice | Title                                 | Purpose                                                                                                                                                                                                                                                                                                                                    | Deploy                     |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 0     | Baseline + HeyGen API confirm         | Re-read HeyGen Photo Avatar Video API + Voices listing. Confirm Russian preset voice availability. Confirm pricing and avatar creation semantics. Record baseline SHA.                                                                                                                                                                     | NO                         |
| 1     | HeyGen credential + Admin Tools UI    | `tool_video_generate_heygen` -> `tool/video_generate/heygen/api-key`. Secret store integration. Display in Admin Tools Video Providers section alongside Runway and Kling.                                                                                                                                                                 | API + WEB                  |
| 2     | HeyGen catalog row + Admin Runtime UI | Add `heygen` to `VIDEO_GENERATE_PROVIDERS` / `MANAGED_CATALOG_PROVIDERS`. Add catalog rows for `heygen` talking-avatar models with `capabilities: ["video"]`, `billingMode: "time_metered"`. Admin Runtime renders the HeyGen card video-only. Catalog can mark a row as talking-avatar-only (so cinematic plan selection cannot pick it). | API + WEB                  |
| 3     | Mode contract + tool projection       | Add `RuntimeVideoGenerateMode = "cinematic" \| "talking_avatar"` to runtime contract. Add `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey` fields. Native tool projection extends `video_generate` schema with new fields, conditional on plan toggle.                                                        | CONTRACT + RUNTIME + WEB   |
| 4     | HeyGen voice catalog cache            | New `HeyGenVoiceCatalogService` and `platform_heygen_voice_catalog_cache` Prisma table. 24h TTL. Lazy refresh on materialization. Bundle attach when ref provider is `heygen`.                                                                                                                                                             | API                        |
| 5     | Workspace persona registry            | New `workspace_video_personas` table. CRUD service. Per-workspace persona limit setting (default 10, configurable in Admin Tools). VC debit on persona creation success (uses ADR-108 wallet).                                                                                                                                             | API                        |
| 6     | Provider-gateway HeyGen client        | New `apps/provider-gateway/src/modules/providers/heygen/heygen-provider.client.ts`. Submit Photo Avatar Video request, poll status, download result. Lazy avatar creation when persona reuse path requires it. Emit `billingFacts` time-metered.                                                                                           | PROVIDER-GATEWAY           |
| 7     | Runtime talking_avatar execution      | Runtime `runtime-video-generate-tool.service.ts` routes `mode = "talking_avatar"` to HeyGen. Resolves persona or ad-hoc photo. Validates plan toggle. Validates one-persona-per-clip. Calls provider gateway. Persists artifact. VC settle through ADR-108 path.                                                                           | RUNTIME + API              |
| 8     | Plan toggle + materialization gate    | Add `talkingVideoEnabled` boolean on plan `video_generate` tool activation. Admin Plans UI exposes it. Materialization writes the flag onto the bundle so runtime can fail honestly when off.                                                                                                                                              | API + WEB                  |
| 9     | Assistant Settings UI: Characters     | New section between Character (order 1) and Limits (order 2) in `apps/web/app/app/_components/assistant-settings.tsx`. Workspace personas list, create form (upload portrait + select voice + name), delete with confirm. Section hidden when plan `talkingVideoEnabled` is false.                                                         | WEB                        |
| 10    | Chat UX for talking video             | Tool description updated so the model knows when to ask "save as a reusable persona?" vs ad-hoc. No keyword routing. Tool description encodes multi-character refusal: split into multiple calls. Active media job pill and final artifact rendering reuse existing UX (Slice 6 of ADR-108 already adjusted balance display).              | RUNTIME (tool description) |
| 11    | Tests + docs + verification + smoke   | E2E tests for ad-hoc, persona create, persona reuse, multi-character refusal. Docs updates (ARCHITECTURE, API-BOUNDARY, DATA-MODEL, TEST-PLAN). Full verification gate. Live smoke in `persai-dev` with a real HeyGen credential.                                                                                                          | DOCS + ALL                 |

Minimum useful path for catalog-only HeyGen (admin can configure but feature not live): `0 -> 1 -> 2 -> 3`.

Minimum production path for live HeyGen talking-avatar: `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11`.

Persona-aware path requires slice 5. Ad-hoc-only path can in principle launch at slice 7 if the assistant Settings section is deferred, but slice 8 plan toggle and slice 11 smoke are still required.

## Slice specifications

### Slice 0 - Baseline + HeyGen API confirm

**Scope**

- Re-read HeyGen Photo Avatar Video documentation (or equivalent endpoint that accepts a portrait + voice id + text and returns a video task).
- Confirm Russian preset voices in `GET /v3/voices` are reachable.
- Record exact endpoint paths, auth header shape, polling cadence guidance, and result download shape.
- Record HeyGen pricing model (per-second, currency).
- Record baseline SHA in `docs/SESSION-HANDOFF.md`.

**Exit**

- Provider truth is written down. No code change.

**Status (2026-06-04): Completed.** HeyGen v3 API truth (8 sections) + 6 binding UX decisions recorded. Baseline SHA `24d1d6ca89b92149a94d77c87c4c3af18cbbbd6c`. Source-of-truth landed in `docs/SESSION-HANDOFF.md` (`2026-06-04 — ADR-109 Slice 0` block). Binding amendments to the original slice specs (E1–E6, plus new Slice 10b for time-based talking-video banner UX, plus cross-slice invariants #14 and #15) recorded in `## Slice 0 erratum (2026-06-04)` at the bottom of this ADR. Later slices read both the original spec and the erratum; on conflict, **erratum wins**.

### Slice 1 - HeyGen credential + Admin Tools UI

**Scope**

- Add `tool_video_generate_heygen: "tool/video_generate/heygen/api-key"` to `TOOL_CREDENTIAL_IDS`.
- Map to tool code `video_generate`.
- Add display label.
- Add to `VIDEO_PROVIDER_CREDENTIAL_KEYS` in `apps/web/app/admin/tools/page.tsx`.
- Render in the existing Video Providers section.
- Reuse `PlatformRuntimeProviderSecretStoreService` exactly as Runway/Kling do.

**Required tests**

- API: save/load HeyGen key metadata.
- Web: Tools page renders the HeyGen row.

**Exit**

- Admin can store the HeyGen API key.

**Status (2026-06-04): Completed.** Baseline SHA `c4fa3825f64827ca21ffb10703fc2dc8a7456f9b` (post-Slice 0 closure commit). Landed via orchestrator-execution model with one Claude Opus 4.8 implementation subagent (first run) + same subagent resumed once to apply a derive-based refactor in `manage-admin-tool-credentials.service.ts:loadToolKeyMetadata()` after a Scope OUT typecheck blocker was surfaced. Future Slice subagents will use Sonnet 4.6 / GPT-5.4 per operator directive (Opus is cost-overkill for implementation slices). 6 files modified inside expanded Scope IN: `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts` (added `tool_video_generate_heygen` to `TOOL_CREDENTIAL_IDS`, `TOOL_CODE_BY_CREDENTIAL_KEY`, display labels, and updated operator notes), `apps/api/src/modules/workspace-management/application/manage-admin-tool-credentials.service.ts` (derive-based refactor of `loadToolKeyMetadata()` `Record<ToolCredentialKey, …>` initializer using `Object.fromEntries(ALL_TOOL_CREDENTIAL_KEYS.map(...))` — semantic-preserving, removes the need for future provider slices to touch this file), `apps/web/app/admin/tools/page.tsx` (added third element to `VIDEO_PROVIDER_CREDENTIAL_KEYS`, updated Video Providers section copy), plus 3 augmented test files (`tool-credential-settings.test.ts` with `runHeygenCredentialRegistration` function asserting secret id / tool code / `ALL_TOOL_CREDENTIAL_KEYS` membership / reverse-resolve / secret ref shape; `manage-admin-tool-credentials.service.test.ts` with HeyGen save input + `updatedCredentials` assertion symmetric to Runway/Kling; `page.test.tsx` with new focused test asserting HeyGen row renders with default `"Enter API key..."` placeholder, not the Kling JSON placeholder). All 7 verification gates PASS via orchestrator's own shell: recursive lint, root format:check, `@persai/api` typecheck, `@persai/web` typecheck, `tool-credential-settings.test.ts`, `manage-admin-tool-credentials.service.test.ts`, `vitest run app/admin/tools/page.test.tsx` (3 tests). Cross-slice invariants 1–15 verified to remain true: no HeyGen URL / HTTP detail anywhere (pure storage), no keyword routing introduced, no behavioral change for Runway/Kling/OpenAI rows, no `Scope OUT` file outside the one-line expansion in `manage-admin-tool-credentials.service.ts` touched, no docs files touched by subagent (orchestrator writes docs). Deploy: API + WEB. No migration. No feature flag. Admin can now store the HeyGen API key in `/admin/tools` Video Providers section.

### Slice 2 - HeyGen catalog row + Admin Runtime UI

**Note (2026-06-04):** This slice has been split into **2a (substrate widening)** and **2b (capability axis + plan validation)** during orchestrator planning. The original combined spec is preserved below; deliverable boundaries are recorded in the Status stamp.

**Scope**

- Extend `MANAGED_CATALOG_PROVIDERS` and `VIDEO_GENERATE_PROVIDERS` with `heygen`.
- Extend `PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS` in `packages/runtime-contract/src/index.ts`.
- Add empty default catalog bucket `heygen: { models: [] }`.
- Admin Runtime renders the HeyGen card with the same video-only constraint applied to Runway/Kling.
- Add a per-row capability flag on catalog rows to indicate talking-avatar-only models (so plan validation cannot select them for cinematic). _(Slice 2b)_
- Plan validation: accept HeyGen rows only for `videoGenerateModelKey` / fallback when the model is marked talking-avatar-capable. _(Slice 2b)_

**Required tests**

- Catalog accepts HeyGen rows video-only. _(2a)_
- Chat selectors do not see HeyGen. _(2b — capability-axis-driven)_
- Talking-avatar-only catalog rows cannot be selected as cinematic primary/fallback. _(2b)_

**Exit**

- 2a: Admin sees a HeyGen card in `/admin/runtime` with empty catalog round-trip clean.
- 2b: Admin can configure HeyGen models with `talking_avatar` capability flag, and plan validation refuses cinematic selection of talking-avatar-only rows.

**Status (2026-06-04): Slice 2a + 2b Completed.** Baseline SHA `d18d0064...` (Slice 1 closure). Subagent: Claude Sonnet 4.6 medium thinking — first hire under the operator directive to retire Opus 4.8 from implementation slices. Single subagent run, no resume needed; Sonnet honestly self-reported a 5-file implicit scope expansion (`platform-runtime-provider-settings.ts`, `runtime-provider-settings-admin.ts`, `runtime-provider-settings-admin.test.ts`, `knowledge/page.test.tsx`, `assistant-api-client.test.ts`) as pure-additive `heygen: { models: [] }` data defaults symmetric to existing `kling: { models: [] }` sites, with no behavioral logic — pattern matches Slice 1 `loadToolKeyMetadata()` precedent. Orchestrator diff-reviewed every implicit-scope edit; all confirmed pure data-default. Substrate widening landed in: `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts` (`MANAGED_CATALOG_PROVIDERS`, `VIDEO_GENERATE_PROVIDERS`, `isVideoOnlyCatalogProvider`, 2 catalog default blocks); `packages/runtime-contract/src/index.ts` (`PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS`); `apps/web/app/admin/runtime/page.tsx` (~11 sites including `providerLabel()`, local `MANAGED_CATALOG_PROVIDERS`, `isVideoOnlyCatalogProvider()`, `normalizeCatalogForSlice2()`, `createEmptyCatalog()`, `withDerivedCatalogWeights()`, `buildCatalogFallback()`, `selectedCatalogIndexByProvider`, `newCatalogCapabilityByProvider`, `clampCatalogIndex` useEffect, card-footer copy branch). Placeholder branches added in 2 of 5 anticipated sites: `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts::generateVideo()` (`throw new Error("ADR-109 Slice 6: HeyGen runtime execution not yet implemented")`) and `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts::VIDEO_PROVIDER_CREDENTIAL_KEY` (`heygen: "tool_video_generate_heygen"` — references the Slice 1 credential symmetric to Runway/Kling); other 3 (`runtime-video-generate-tool.service.ts`, `runtime-tool-policy.ts`, `native-tool-projection.ts`) untouched because typecheck passed without modification. Contracts package updated: `packages/contracts/openapi.yaml` (added `"heygen"` to `ManagedRuntimeCatalogProvider` enum + `RuntimeProviderModelCatalogByProviderState` required array + properties); `packages/contracts/src/generated/model/managedRuntimeCatalogProvider.ts` + `packages/contracts/src/generated/model/runtimeProviderModelCatalogByProviderState.ts` (targeted Slice 2a additions only — orchestrator deliberately rolled back unrelated repo-wide generated-files drift surfaced by `pnpm --filter @persai/contracts run generate` so the Slice 2a commit stays clean; pre-existing contracts/generated drift is independent repo tech debt and not addressed in this slice). 15 files modified total (+111/−28); zero new files. All 8 verification gates PASS via orchestrator's own shell: `pnpm -r lint`, `pnpm format:check`, api/web/runtime/provider-gateway typechecks, `vitest run app/admin/runtime/page.test.tsx` (17 tests including new "renders the HeyGen catalog card with the empty-rows placeholder copy"), `tsx test/runtime-provider-profile.test.ts`. Cross-slice invariants 1–15 verified true: no HeyGen URL / HTTP detail anywhere (Slice 6 owns the HTTP layer), no keyword routing / message-body parsing introduced, no Prisma schema or migration changes, no plan-validation logic changes (deferred to 2b), no capability-axis field on catalog rows (deferred to 2b), no behavioral change for OpenAI/Runway/Kling rows. Deploy: API + WEB. No migration. No feature flag.

**Slice 2b Completed (2026-06-04).** Baseline SHA `f999d889` (Slice 2a closure). Subagent: Claude Sonnet 4.6 medium thinking, single run, no resume needed. Capability axis `RuntimeVideoModelKind = "cinematic" | "talking_avatar"` landed as a structural field on `RuntimeProviderModelProfileBase`, derived from provider identity at parse time (HeyGen→talking_avatar, others→cinematic), and enforced by the parser: `provider === "heygen" && kind !== "talking_avatar"` throws, and `provider !== "heygen" && kind === "talking_avatar"` throws. This makes capability provider-locked structurally rather than via any keyword or string-match heuristic — cross-slice invariant #15 remains true. Plan validation in `manage-admin-plans.service.ts::assertCapabilityModelKeysAvailable` now builds a `videoModelKindMap: Map<modelKey, kind>` from active video models across all 4 providers and refuses `videoGenerateModelKey` / `videoGenerateFallbackModelKey` with `BadRequestException` "is a talking_avatar (cinematic_only) model and cannot be used as a plan videoGenerateModelKey or videoGenerateFallbackModelKey. Talking-avatar models are exposed separately via the workspace plan toggle (Slice 9)." when the resolved row has `kind === "talking_avatar"`. Chat-side tool projection in `apps/runtime/src/modules/turns/native-tool-projection.ts` now filters out `video_generate` tool exposure when the configured video provider is a talking-avatar provider — uses new `isTalkingAvatarVideoProvider(providerId)` helper in `packages/runtime-contract/src/index.ts` (which checks providerId against the structural `PERSAI_RUNTIME_TALKING_AVATAR_VIDEO_PROVIDER_IDS = ["heygen"]` list — pure enum membership, never user-input parsing). Admin Runtime UI surfaces capability via a read-only badge per row (`aria-label="Capability kind"`, displays "Talking Avatar" for HeyGen rows and "Cinematic" otherwise). OpenAPI schema gained a `RuntimeVideoModelKind` enum component (`cinematic`, `talking_avatar`) and `kind` field on `RuntimeProviderModelProfileCommonState` — clean architecture because all 5 oneOf billing-mode variants already `allOf`-extend the common base. Generated contracts: new `packages/contracts/src/generated/model/runtimeVideoModelKind.ts` (manually mirroring orval style), `runtimeProviderModelProfileCommonState.ts` augmented with `kind` field + import, `index.ts` augmented with one new export. Pre-existing repo-wide generated-files drift NOT touched (orchestrator deliberately kept Slice 2b's contracts edit scope to exactly 3 generated files + 1 new file). Subagent self-reported 7-file implicit scope expansion: `platform-runtime-provider-settings.ts` (3 sites incl. provider-aware default), `tool-path-pricing-catalog.ts` (1 site, `kind: "cinematic"` for ledger pseudo-profile), `runtime-provider-settings-admin.ts` (1 site), `runtime-provider-settings-admin.test.ts` (3 sites), `assistant-api-client.test.ts` (3 sites), `admin/knowledge/page.test.tsx` (6 sites), `admin/runtime/page.test.tsx` (3 sites) — all pure-additive `kind` data defaults symmetric to Slice 2a's `kind`-free precedent; no behavioral logic introduced. Tests augmented: `runtime-provider-profile.test.ts` (5 new assertions covering default-cinematic / default-talking-avatar / explicit kind acceptance / incompatible-HeyGen-cinematic-throws / incompatible-Runway-talking-avatar-throws), `manage-admin-plans.service.test.ts` (new block: HeyGen v2 row rejected with `cinematic_only` error message; runway-gen-4 row passes), `native-tool-projection.test.ts` (2 new assertions: `video_generate` absent for heygen provider bundle, present for runway), `admin/runtime/page.test.tsx` (1 new test asserting "Cinematic"/"Talking Avatar" badges via `aria-label="Capability kind"`). 18 files modified + 1 new file (+445 / -5). All 10 verification gates PASS via orchestrator's own shell: recursive lint, root format:check, api/web/runtime/provider-gateway typechecks, `tsx test/runtime-provider-profile.test.ts`, `tsx test/manage-admin-plans.service.test.ts`, `tsx test/native-tool-projection.test.ts`, `vitest run app/admin/runtime/page.test.tsx` (18/18). Cross-slice invariants 1–15 verified true; specifically #11 ADR-107 line 39-40 carve-out enforced parser-side (Runway/Kling rows cannot be talking_avatar), and #15 NON-NEGOTIABLE (capability derivation is purely structural from `providerId` enum, not from any user input or model name string). Deploy: API + WEB. No Prisma migration. No feature flag.

### Slice 3 - Mode contract + tool projection

**Note (2026-06-04):** Original spec contained "Multi-character heuristic at request validation: refuse `>1 personaId` or detection of more than one named speaker pattern in speech text. Honest error code `multi_character_not_supported`." — the second half (parsing speech text) violates cross-slice invariant #15 (no keyword routing / no message-body parsing). **Operator superseded this clause: NO multi-character refusal in code anywhere. The `personaId` field is single-valued by type (multi-character is structurally impossible). The single-speaker rule lives ONLY in the LLM-facing tool description that Slice 8 will write — the model decides via instruction, not via code-side regex or counting.** Original "tool projection exposes new fields when plan has `talkingVideoEnabled` or `mode` is `cinematic`" wording was also imprecise; revised approach: Slice 3 lands types + structural validation + gateway pass-through ONLY. Tool projection JSON Schema for the new fields is deferred to Slice 8 (which owns tool description) + Slice 9 (which owns the plan toggle that lights up the talking-avatar tool surface).

**Scope (revised)**

- Add `RuntimeVideoGenerateMode = "cinematic" | "talking_avatar"` const + type + type guard in `packages/runtime-contract/src/index.ts`.
- Add new optional request fields (`mode`, `speechText`, `speechLanguage`, `personaId`, `portraitImageAlias`, `voiceKey`) to `RuntimeVideoGenerateRequest` and symmetric `requested*` echoes on `RuntimeVideoGenerateToolResult`.
- Symmetric pass-through fields on `ProviderGatewayVideoGenerateRequest` so the runtime → provider-gateway transport carries them.
- Structural validation in `runtime-video-generate-tool.service.ts`: when `mode === "talking_avatar"`, require non-empty `speechText` + non-empty `speechLanguage` + exactly one of `personaId` / `portraitImageAlias`. When `mode === "cinematic"` or absent, silently ignore new fields (legacy behavior preserved).
- Provider-gateway DTO acceptance of the new fields (defensive type-rejection of malformed values with honest 400; HeyGen branch retains the Slice 2a placeholder throw).

**Scope OUT (forbidden in this slice)**

- Tool projection JSON Schema for new fields and any tool description text (Slice 8 + 9 territory).
- Plan toggle `talkingVideoEnabled` (Slice 9).
- Any runtime execution path for `talking_avatar` rendering (Slice 7).
- Persona table or persona service (Slices 4-5).
- ADR-108 wallet code paths.
- Cinematic request shape — must round-trip identical bits.
- Multi-character refusal in code (operator directive — Slice 8 tool description holds the single-speaker rule).

**Forbidden patterns**

- Auto-defaulting `mode` to `"talking_avatar"` if `speechText` is present — `mode` must be an explicit top-level field set by the model.
- ANY regex / string matching / keyword detection / message-body parsing of `speechText`, `prompt`, or user input (invariant #15 NON-NEGOTIABLE).
- Counting `personaIds` for multi-character refusal — the type is single-valued, multi-character is structurally impossible.
- Hiding cinematic fields when `mode = "cinematic"` — the cinematic surface must remain unchanged.

**Required tests**

- `mode = "cinematic"` round-trips unchanged.
- `mode = "talking_avatar"` validates required fields.
- ~~Multi-character refusal returns a stable error code.~~ Superseded by operator directive (see note above): no multi-character refusal in code; single-speaker rule lives in Slice 8 tool description.

**Exit**

- Request contract is talking-avatar-ready and structurally validated (still not callable end-to-end until Slice 6 lands HeyGen HTTP client + Slice 7 wires the execution path).

**Status (2026-06-04): Completed.** Baseline SHA `1331c2e9` (Slice 2b closure). Subagent: GPT-5.4 medium (first hire on this project). Initial run honestly stopped on a false-positive "dirty tree" blocker (subagent interpreted the COMMITTED Slice 2b changes in `runtime-contract/src/index.ts` + `native-tool-projection.ts` as uncommitted working-directory drift); orchestrator confirmed `git status: nothing to commit, working tree clean` and resumed the subagent with clarification. Second run delivered cleanly. 6 files modified, all Scope IN (+568 / -6): `packages/runtime-contract/src/index.ts` (`RUNTIME_VIDEO_GENERATE_MODES`, `RuntimeVideoGenerateMode`, `isRuntimeVideoGenerateMode`, extended `RuntimeVideoGenerateRequest` with 6 optional new fields, extended `RuntimeVideoGenerateToolResult` with 6 symmetric `requested*` echoes, extended `ProviderGatewayVideoGenerateRequest` for transport pass-through); `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts` (defensive structural parsing of new args via existing `asNonEmptyString` helper; structural XOR validation `hasPersonaId === hasPortrait` for personaId/portraitImageAlias; mode-gated forwarding to gateway request `ONLY when mode === "talking_avatar"`; new private helpers `buildRequestedTalkingAvatarEchoes` and `buildGatewayTalkingAvatarFields`; symmetric echo additions to 14 `payload:` sites); `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts` (`normalizeInput` accepts new fields with defensive type-rejection 400s; HeyGen `case` keeps Slice 2a placeholder throw). Tests augmented: `runtime-video-generate-tool.service.test.ts` 7 focused scenarios (persona happy path, portrait happy path, cinematic-ignores-extras, missing-speechText-throws, missing-speechLanguage-throws, both-persona-and-portrait-throws-XOR, neither-persona-nor-portrait-throws-XOR); `provider-gateway.client.service.test.ts` assertion that new fields serialize into HTTP body; `provider-video-generation.service.test.ts` pass-through assertions + cinematic non-injection + defensive type-rejections + Slice 2a HeyGen-placeholder regression test. Verification (all 10 PASS): recursive lint, root format:check, api/web/runtime/provider-gateway typechecks, 4 focused tests, Slice 2b sanity test on `native-tool-projection.test.ts`. Cross-slice invariants 1–15 verified true; specifically #15 NON-NEGOTIABLE — zero regex, zero string matching, zero message-body parsing introduced; XOR check is pure boolean equality on `null`-vs-non-`null` field presence; `mode` is an explicit field set by the LLM, never inferred from any text content. NO multi-character refusal in code anywhere (operator directive). Tool projection JSON Schema and tool description text remain unchanged (Slice 8 + 9 will wire them with the plan toggle). Deploy: RUNTIME + PROVIDER-GATEWAY. No migration. No feature flag.

### Slice 4 - HeyGen voice catalog cache

**Scope**

- New service `HeyGenVoiceCatalogService` modeled on `KlingVoiceCatalogService`.
- New Prisma model `PlatformHeygenVoiceCatalogCache { id, fetched_at, voices_json }` with single-row pattern keyed `heygen-presets-voices`.
- 24h TTL.
- Lazy refresh on materialization.
- Materialization attaches a `videoVoiceCatalog` shortlist (provider `heygen`) on the `video_generate` ref when provider resolves to `heygen`.

**Required tests**

- Fresh cache returns cached shortlist.
- Expired cache refreshes from API.
- Materialization attaches the catalog only for `heygen` refs.

**Exit**

- Runtime knows which HeyGen voices it can offer.

**Status (2026-06-04): Completed.** Subagent: Claude Sonnet 4.6 medium thinking, single run, clean exit. 6 files modified + 4 new files, all Scope IN (~+48 lines diff stat). New `PlatformHeygenVoiceCatalogCache` Prisma model (table `platform_heygen_voice_catalog_cache`, PK on `cache_key VARCHAR(64)`, `voices_json JSONB`, `fetched_at TIMESTAMPTZ`) landed via hand-authored migration `20260604220000_slice4_heygen_voice_catalog_cache` (Postgres not running locally; SQL mirrors the Kling migration exactly with renamed identifiers; Prisma `generate` confirms the model is structurally valid). New `HeyGenVoiceCatalogService` at `apps/api/src/modules/workspace-management/application/heygen/heygen-voice-catalog.service.ts` mirrors `KlingVoiceCatalogService`'s public surface (`getMaterializedVoiceCatalog(): Promise<RuntimeVideoVoiceCatalog | null>`) with 24h TTL + lazy refresh; reads the HeyGen API key from `TOOL_CREDENTIAL_IDS.tool_video_generate_heygen` (registered in Slice 1) via `PlatformRuntimeProviderSecretStoreService`; fetches `GET https://api.heygen.com/v3/voices` with `X-Api-Key` header (HeyGen v3 auth convention); defensive multi-alias parsing accepts both `{data:[...]}` and flat-array response shapes plus field aliases `voice_id`/`voiceId`, `language`/`voice_language`, `gender`/`voice_gender`/`sex`, `preview_audio_url`/`preview_audio`/`previewAudioUrl`; documented failure modes: missing API key → returns null + WARN log; HTTP error → falls back to cached row + WARN log; empty refresh → falls back to cached row. Contract widening: `RuntimeVideoVoiceCatalogEntry.previewAudioUrl?: string | null` added (optional, backward-compatible); `RuntimeVideoVoiceCatalog.provider` widened from `"kling"` to `"kling" | "heygen"`. `KlingVoiceCatalogService` augmented symmetrically (extracts `previewAudioUrl` in `parseVoiceRow`, hydrates it from cached JSON in `parseCachedVoices`) — Kling regression test confirms existing behavior unchanged. Materialization wiring (`MaterializeAssistantPublishedVersionService.attachMaterializedVideoVoiceCatalog`) refactored from `if (ref.providerId !== "kling") return ref` early-return to explicit parallel branches for `"kling"` and `"heygen"`, each calling its own service. **Subagent honesty (no false-PASS regression):** the subagent discovered that `apps/api/test/materialize-assistant-published-version.service.test.ts` was already failing at HEAD — when Slice 2a added `"heygen"` to `MANAGED_CATALOG_PROVIDERS`, the test fixture's `availableModelCatalogByProvider` literal was not updated to include `heygen: { models: [] }`. Slice 3 verification did NOT include running this specific test (Slice 3's focused suite was `runtime-video-generate-tool`, `provider-gateway.client`, `provider-video-generation`), so this is not a Slice 3 false-PASS — it is a latent Slice 2a fixture omission. Fixed in Slice 4 as a 3-line addition. Tests added: `apps/api/test/heygen-voice-catalog.service.test.ts` (7 assertions: fresh→network+upsert, warm→no network, expired→refresh, missing creds→null, HTTP 401→stale fallback, flat array, `voiceId` alias) and `apps/api/test/materialize-heygen-voice-catalog.test.ts` (5 assertions: heygen catalog with `previewAudioUrl`, heygen ref→catalog attached, runway/openai refs→no attach, null catalog→ref unchanged, Kling regression). Verification (all 10 PASS via orchestrator shell): recursive lint, root format:check, api/web/runtime/provider-gateway typechecks (Prisma generate confirms `platformHeygenVoiceCatalogCache` valid), focused tests, kling regression, materialize-published-version regression. Cross-slice invariants 1–15 verified true; specifically #11 ADR-107 carve-out preserved (Slice 2b `kind=talking_avatar` constraint unchanged), #15 NON-NEGOTIABLE preserved (all parsing in the new service is purely structural JSON field inspection of the HeyGen API response — zero regex on user input, zero message-body parsing, zero keyword routing anywhere). NO HeyGen render wiring (Slice 6 owns; `provider-video-generation.service.ts` still throws `"ADR-109 Slice 6: HeyGen runtime execution not yet implemented"` on the `heygen` case). NO portrait/persona handling (Slice 5 + 6 own). NO LLM tool description text (Slice 8). NO plan toggle (Slice 9). Deploy: API. Migration `20260604220000_slice4_heygen_voice_catalog_cache` must run via `Dev Image Publish` migration approval gate per AGENTS.md before downstream slices. No feature flag.

### Slice 5 - Workspace persona registry

**Status (2026-06-04): Completed.** See SESSION-HANDOFF.md and CHANGELOG.md for full delivery details. Key decisions: soft-delete only (no hard-delete; `archived=true` preserves `heygenAvatarId` for Slice 6 cascade); non-filtered unique index on `(workspaceId, displayNameLower)` (Prisma 6.x limitation; Slice 6 will address); storage after tx; no VC refund on archive; `req.workspaceId` identity check for workspace authorization. Controller test deferred per scope.

**Scope**

- New `workspace_video_personas` Prisma model.
- CRUD service + workspace-scoped HTTP endpoints.
- Persona limit default 10, stored in Admin Tools as `heygenPersonaWorkspaceLimit`.
- Persona creation cost setting `heygenPersonaCreationVcoin` (default 20), debited on success via ADR-108 wallet.
- Persona deletion: cascade deletes `heygen_avatar_id` from HeyGen (best-effort) and removes the row.

**Scope OUT (forbidden in this slice)**

- Inventing a new VC debit path — must call the wallet service shipped by ADR-108 Slice 2 (rejection if ADR-108 Slice 2 is not merged yet).
- Provider-gateway HeyGen client (Slice 6).
- Runtime execution wiring (Slice 7).
- UI (Slice 9).
- Cross-workspace persona sharing.

**Forbidden patterns**

- Persona creation that proceeds when ADR-108 wallet rejects the debit — must surface honest `vcoin_balance_exhausted`.
- Two transactions for "create persona row" + "debit VC" — must be a single transaction; rollback persona row if debit fails.
- Hard-coding persona limit. Limit must be read from Admin Tools setting.
- Calling HeyGen API from this slice — Slice 5 only stores PersAI-side metadata.

**Required tests**

- Create / list / delete persona round-trip.
- Limit enforced.
- VC debit happens only on success.
- Duplicate display name within workspace rejected (case-insensitive).
- Delete cascades to HeyGen best-effort.

**Exit**

- Workspace can own up to N personas.

### Slice 6 - Provider-gateway HeyGen client

**Scope**

- New `HeyGenProviderClient` with:
  - submit Photo Avatar Video task (portrait, voice id, text, language, seconds, size);
  - poll task status;
  - download result url;
  - lazy create HeyGen avatar id when persona reuse path requires it;
  - emit `billingFacts` time-metered (`capability: "video"`, `providerKey: "heygen"`, `modelKey: <catalog model>`, `durationMs`/`durationSeconds`).
- Wire dispatch in `provider-video-generation.service.ts`.
- Polling-loss / accepted-task / retry behavior mirrors Runway/Kling.

**Scope OUT (forbidden in this slice)**

- Runway / Kling / OpenAI provider-client code (no edits, even refactors).
- Runtime side wiring (Slice 7).
- Persona DB writes — only HeyGen-side `avatar_id` creation, which is returned for the caller (Slice 7) to persist.
- ADR-108 wallet code.

**Forbidden patterns**

- Inlining persona DB lookups inside the provider client — the client receives a portrait URL + voice id + optional cached `heygen_avatar_id`, nothing more.
- Hardcoding HeyGen voice list — must consume the shortlist from materialized bundle (Slice 4 cache).
- Silent retry on 4xx HeyGen errors — only 5xx and transient transport errors retry per the existing Runway/Kling pattern.
- Returning fake `billingFacts` when HeyGen response lacks duration — must surface and fail honestly.

**Required tests**

- Ad-hoc submit: portrait + voice + text -> accepted task -> poll -> download.
- Persona reuse with cached `heygen_avatar_id`: avatar reused, no create call.
- Persona reuse with null `heygen_avatar_id`: create-then-render, persona row updated with new id.
- Polling loss handling matches existing pattern.
- BillingFacts emit time-metered fact.

**Exit**

- Provider-gateway can talk to HeyGen end-to-end.

### Slice 7 - Runtime talking_avatar execution

**Scope**

- `runtime-video-generate-tool.service.ts`: route `mode = "talking_avatar"` to HeyGen provider.
- Resolve `personaId` or `portraitImageAlias` to actual portrait asset; resolve voice id (persona default, explicit `voiceKey`, or assistant's default Russian preset).
- Validate plan toggle `talkingVideoEnabled`; honest fail when off.
- Refuse multi-persona in one request honestly.
- Async media job path: same lifecycle as cinematic (deferred enqueue, scheduler, completion delivery).
- VC settle through ADR-108 path on success.

**Scope OUT (forbidden in this slice)**

- Cinematic execution path — must round-trip identical bits.
- Provider-gateway code (Slice 6 owns it).
- Persona CRUD (Slice 5 owns it; this slice only reads).
- `media-delivery.service.ts` (settle path owned by ADR-108 Slice 2; this slice only ensures `billingFacts` flow correctly so the existing VC debit path fires).
- New tool registration in `native-tool-projection.ts` (Slice 3 owns the projection; this slice only wires execution).

**Forbidden patterns**

- Any fallback to Runway / Kling / OpenAI for `talking_avatar` — must fail honestly with `talking_avatar_provider_unavailable` if HeyGen is not configured.
- Auto-creating a persona when only `portraitImageAlias` was supplied — ad-hoc path must not persist anything.
- Auto-resolving an ambiguous persona name by picking the most recent — must return the list to the model via tool result for user disambiguation.
- Pattern-matching speech text for "Masha" / "Misha" / any name list — persona lookup is name-equality only against the workspace registry.

**Required tests**

- Ad-hoc end-to-end produces a video and debits VC.
- Persona reuse end-to-end produces a video, debits VC, sets `heygen_avatar_id` on first use.
- Plan toggle off blocks the request honestly.
- Multi-persona refused honestly.

**Exit**

- Talking-avatar is callable end-to-end.

### Slice 8 - Plan toggle + materialization

**Scope**

- Add `talkingVideoEnabled` boolean on plan `video_generate` tool activation card (in `manage-admin-plans.service.ts` and the editor UI).
- Materialization writes the flag onto the `video_generate` ref in the bundle.
- Tool projection (slice 3) reads the flag to decide whether to advertise talking-avatar fields.

**Required tests**

- Plan save/load round-trips the flag.
- Materialization carries the flag.
- Tool projection hides fields when flag is false.

**Exit**

- Admin can enable/disable talking-avatar per plan.

### Slice 9 - Assistant Settings UI: Characters

**Scope**

- New section in `assistant-settings.tsx`, ordered between Character (1) and Limits (2).
- List existing personas with portrait thumb + name + voice label.
- Create form: upload portrait, choose voice from the HeyGen preset cache, enter name. On submit: confirm VC cost, create.
- Delete with confirm.
- Hidden when plan `talkingVideoEnabled` is false.
- Empty state shows "Create a character to make talking videos with a consistent face and voice".

**Required tests**

- Section renders only when toggle is on.
- Create flow validates inputs and shows VC cost.
- Delete confirms and removes.

**Exit**

- Users can manage personas without leaving Assistant Settings.

### Slice 10 - Chat UX for talking video

**Scope**

- Update the `video_generate` tool description to instruct the model:
  - when user attaches a photo + says "make a video" + provides text, use `talking_avatar` mode;
  - when user says "save this as <name>" (or similar explicit persona creation phrasing), create a persona first;
  - when user references a persona by name and the lookup is ambiguous, ask the user to disambiguate;
  - when user asks for multiple speakers in one clip, propose splitting into multiple clips.
- No keyword routing in code paths; the model uses the tool description.
- Active media job pill, sidebar dot, and final video rendering reuse the existing chat UX from ADR-108 Slice 6 (balance display) and ADR-105 (media job lifecycle).

**Scope OUT (forbidden in this slice)**

- Any new code paths in `apps/runtime/src/modules/turns/**` beyond updating tool description strings (and the matching snapshot test).
- Web components — Slice 9 owns Assistant Settings; chat UX reuse is verified, not extended.
- Provider-gateway changes.

**Forbidden patterns**

- Adding any regex / keyword routing for "talking" / "voice" / "озвучь" / "persona" / "character" / specific Russian or English verbs anywhere in code.
- Adding code that infers `mode` from the message body — `mode` is set by the model based on the tool description, never by string matching.
- Hard-coding the persona disambiguation copy — must come from a stable string table so locales can extend it.

**Required tests**

- Tool description text snapshot test (so unintended drift is visible in diffs).

**Exit**

- Assistant naturally drives talking-video workflows.

### Slice 11 - Tests + docs + verification + live smoke

**Scope**

- E2E coverage: ad-hoc photo + text; persona create then reuse; multi-character refusal; plan toggle off; insufficient VC.
- Update `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`.
- Cross-reference ADR-108, ADR-107 (with the explicit exception note for HeyGen), ADR-106, ADR-105.
- Full verification gate.
- Live smoke in `persai-dev` with a real HeyGen credential: one ad-hoc talking video, one persona-based reuse.

**Exit**

- Feature is live-callable and documented.

## Cross-slice invariants

1. `talking_avatar` mode is HeyGen-only. No automatic fallback to other video providers.
2. Cinematic mode behavior is unchanged.
3. Image / TTS / STT / chat behavior is unchanged.
4. Persona registry is workspace-scoped, not assistant-scoped.
5. HeyGen `avatar_id` is provider metadata stored on the persona row, never exposed in user-visible labels.
6. Voice cloning is out of scope; only HeyGen presets.
7. Multi-character per single clip is rejected; assistant proposes splitting.
8. Plan toggle gates `talking_avatar`; off plan returns honest `feature_unavailable`.
9. Persona creation has a fixed VC cost (configurable in Admin Tools), debited on success only.
10. Render cost is variable VC computed per ADR-108 settle path.
11. ADR-107 line 39-40 stays true for Runway and OpenAI; this ADR carves an exception only for HeyGen.
12. No keyword routing for persona lookup; rely on the model and tool description.
13. ADR-106/107 invariants (Runway/Kling video-only, chat routing OpenAI/Anthropic-only, OpenAI image untouched) are preserved.

## Risks

- **HeyGen API rate limits / regional availability.** Mitigation: provider-gateway client surfaces honest accepted/poll/loss patterns matching Runway/Kling; document the operator-side rate limit policy.
- **Russian voice preset quality may not match user expectations.** Mitigation: voice cloning planned for a follow-up ADR; assistant should set expectations honestly when a user asks for a custom voice.
- **Persona limit 10 may be too low for agency-style workspaces.** Mitigation: limit is configurable in Admin Tools.
- **Race on lazy avatar creation when two requests reference the same persona in parallel.** Mitigation: persona row lock during first creation; second request waits or replays.
- **Photo privacy / GDPR.** HeyGen stores uploaded portraits. Mitigation: persona delete cascades to HeyGen best-effort; document retention policy.
- **Multi-character UX gap.** Users will ask. Mitigation: assistant proposes splitting; ADR-110 (future) can introduce montage.
- **Voice cloning deferral.** Users will ask. Mitigation: UI labels and assistant copy honest about preset-only support.
- **Plan migration friction.** Operators must enable `talkingVideoEnabled` per plan and tune VC grants. Mitigation: ADR-108 migration runbook is the place to anchor it.
- **HeyGen pricing changes.** Catalog $/sec is admin-editable; pricing drift handled the same as Runway/Kling drift.
- **Costs accumulate fast at high VC grant.** Settle-only debit means a user with a large monthly grant can burn VC in seconds. Mitigation: assistant exposes balance through advisor copy (ADR-108 slice 7).

## Alternatives considered

### New top-level tool `talking_video_generate`

Rejected. Multiplies the tool surface for a closely related class. The model already understands `video_generate`. ADR-106 explicitly chose to keep one tool with provider-neutral surface.

### Extend `audioMode` enum with `talking_avatar`

Rejected. `audioMode` is an ortho-axis describing audio behavior; `talking_avatar` is a structurally different request (different required inputs, different provider, different validation). Mixing them muddies both axes.

### Extend `inputMode` enum with `talking_avatar`

Rejected for the same reason. `inputMode` describes input shape (text, single image, multi-image, omni); `talking_avatar` is a mode of operation, not an input class.

### Persona registry assistant-scoped

Rejected. The product expectation is reuse across assistants in the same workspace ("Masha is my brand persona"). Workspace scope matches.

### Pre-create HeyGen avatar at persona creation

Rejected. Users may create personas they never use. Lazy creation avoids paying for unused HeyGen avatars and avoids a sync HeyGen call inside the persona create UX.

### No persona persistence (always ad-hoc)

Rejected. Reuse is the explicit product ask. Without persona persistence, every "Masha" video re-uploads the photo and re-creates the HeyGen avatar, which is wasteful and breaks naming continuity.

### Multi-character via scene montage

Deferred. Requires either a HeyGen multi-scene API (if/when available) or PersAI-side ffmpeg sandbox stitching. Both are larger than this ADR. Assistant proposes splitting instead.

## Consequences

### Positive

- Talking-avatar arrives as a first-class mode on the existing tool, with explicit honest exception to the ADR-107 rule.
- Persona reuse gives users a coherent brand-presence workflow across multiple videos.
- Settle through ADR-108 VC keeps cost honesty.
- Provider boundary mirrors Runway/Kling so HeyGen does not require a special-case execution path.

### Negative

- Adds a new provider, a new cache table, a new wallet debit category (persona creation), a new persona table, and a new section in Assistant Settings.
- Two-axis growth in the tool schema (cinematic vs talking_avatar) needs careful tool-description writing to keep model behavior crisp.
- Russian voice preset constraint will frustrate some users until voice cloning lands.
- Multi-character split is a workaround until montage support lands.

## Acceptance checklist

- [ ] HeyGen credential stored under `tool_video_generate_heygen` and visible in Admin Tools.
- [ ] HeyGen catalog rows configurable in Admin Runtime as video-only and talking-avatar-only.
- [ ] Runtime contract carries `mode = "cinematic" | "talking_avatar"` plus speech / persona / portrait / voice fields.
- [ ] Tool projection advertises the new fields only when plan toggle is on.
- [ ] HeyGen voice presets cached and attached on materialization.
- [ ] `workspace_video_personas` table exists with limit enforcement and VC debit on creation.
- [ ] Provider-gateway HeyGen client submits / polls / downloads.
- [ ] Provider-gateway lazily creates HeyGen avatar id for personas without one and persists it.
- [ ] Runtime executes `talking_avatar` end-to-end through HeyGen and debits VC on success.
- [ ] `talking_avatar` does not fallback to Runway / Kling / OpenAI.
- [ ] Cinematic mode behavior is unchanged (regression test).
- [ ] Plan toggle `talkingVideoEnabled` exists, gates execution, and hides UI fields when off.
- [ ] Assistant Settings has a Characters section (workspace-scoped) when toggle is on.
- [ ] Multi-character requests are refused honestly with split suggestion.
- [ ] Persona deletion cascades to HeyGen best-effort.
- [ ] E2E coverage exists for ad-hoc, persona create, persona reuse, multi-character refusal, plan toggle off, insufficient VC.
- [ ] Docs updated (ARCHITECTURE / API-BOUNDARY / DATA-MODEL / TEST-PLAN).
- [ ] ADR-107 line 39-40 exception for HeyGen recorded in this ADR and cross-referenced in ADR-107 if needed.
- [ ] Full verification gate PASS.
- [ ] Live smoke in `persai-dev` recorded for one ad-hoc and one persona-based talking video.

## Slice 0 erratum (2026-06-04)

The original ADR-109 (Proposed 2026-06-03) drafted slice specs before HeyGen API truth was empirically confirmed and before the user-facing UX gestures were agreed. Slice 0 closed both gaps. This erratum records the binding amendments. **Later slices read both the original spec and this erratum; on conflict, the erratum wins.** Slice specs above are not edited in place so the diff history of the original plan stays legible.

### E1 — Scenario B retired from runtime

**Supersedes:** § Decision § "User scenarios" § Scenario B; § Slice 5 spec; § Slice 7 spec; § Slice 10 spec.

**Decision:** persona creation is **REST-only**. The only mutator surface is the HTTP endpoint hit by the Settings → Characters create form. Runtime never creates a persona during tool execution. The model, when it detects an explicit "save as <name>" intent, **advises** the user in chat to create the persona via Settings → Characters; it does not have a `create_persona` tool to call.

**Why:** simpler runtime, smaller surface area, no need for runtime to learn "save as" intent, no risk of phantom personas from misclassified intents, no runtime-side VC debit path (the REST endpoint owns the transaction).

**Slice impact:**

- **Slice 5** stays as planned: `workspace_video_personas` table + CRUD service + HTTP endpoints + per-workspace limit (`heygenPersonaWorkspaceLimit`, default 10) + creation cost (`heygenPersonaCreationVcoin`, default 20 VC). Only the **REST endpoint** triggers it. No runtime caller. The endpoint runs the create + VC debit in ONE Prisma transaction (rollback persona row if debit fails).
- **Slice 7** is narrowed to Scenarios **A** (ad-hoc photo, no persona persistence) and **C** (persona reuse by `personaId`). Scenario B is removed from runtime entirely.
- **Slice 10** tool description teaches the model to advise persona creation in Settings when it detects intent; never to call a non-existent `create_persona` tool.

### E2 — Voice preview as a hard requirement everywhere `voice_id` appears

**Supersedes:** § Slice 4 spec; § Slice 9 spec.

**Decision:** every surface that displays or selects a `voice_id` must offer audio preview playback via a shared `<VoicePreviewButton voiceId={...} />` component. Surfaces:

- Settings → Characters → create form (voice picker; preview per voice option).
- Settings → Characters → persona card list (preview the persona's voice).
- Chat → disambiguation card list (preview each candidate's voice when names collide).
- Future chat surfaces that show voice metadata.

**Primary path:** consume `preview_audio_url` straight from `GET /v3/voices` (HeyGen-hosted). No re-hosting, no transcoding.

**Fallback path** (when `preview_audio_url === null` for a voice): Slice 4's cache refresh generates a short preview ("Hello, I can talk" or locale-appropriate equivalent) once per 24h TTL via `POST /v3/voices/speech` (Starfish-compatible voices only — filter `?engine=starfish`). Mp3 stored in PersAI blob storage. URL served to the client. **Cost is platform-paid** ($0.000667/sec × ~3s ≈ $0.002 per voice per refresh), never debited to the user wallet.

**Slice impact:**

- **Slice 4** scope expands: cache shape gains `previewAudioUrl: string` per voice (always non-null after first refresh); the cache row stores both HeyGen-native preview URLs and PersAI-generated fallback URLs uniformly so callers do not branch.
- **Slice 9** scope expands: voice picker UI includes preview button per option; persona card list includes preview button per row.
- New shared web component: `apps/web/app/_components/voice-preview-button.tsx` (audio play/pause with loading state). Built in Slice 9 alongside Characters UI.

**Cost guard:** if HeyGen reports voice has `engine != "starfish"` AND `preview_audio_url === null`, the cache row carries `previewAudioUrl: null` and the UI hides the preview button for that voice (rather than generating an empty/silent fallback). This is degraded UX, not a failure — confirmed acceptable in MVP.

### E3 — Talking-video banner UX is time-based (not phase-mapped) — NEW Slice 10b

**Supersedes:** § Decision § "User scenarios" (banner mentioned implicitly); § Slice 10 spec (Slice 10 still owns tool description only).

**Why this is needed:** HeyGen poll endpoint (`GET /v3/videos/{id}`) returns only `status: "pending" | "processing" | "completed" | "failed"`. No `progress: 0..100`, no `eta_seconds`, no nested `stage`/`phase`. Third-party signals indicate "1–3 minutes to render a 1-minute video" and HeyGen recommends webhooks over polling in production. A static "video processing…" banner on a 5-minute render reads as a hang.

**Decision:** add a **new Slice 10b — Talking-video banner UX (time-based)**. Pure-web slice. No backend changes. No `media_jobs.phase` column. No new contract fields.

**New Slice 10b specification:**

```
### Slice 10b - Talking-video banner UX (time-based)

Type: WEB only. No deploy of API/runtime/contracts.

Scope
- Detect that the active media job is talking-avatar (vs cinematic) on the client side, from the existing job snapshot (e.g. the `video_generate` ref provider key visible on the persisted artifact metadata, or a new optional `displayKind: "talking_avatar"` field on the active job DTO that the runtime can set when it accepts the job).
- Add a time-based banner copy rotation that swaps the user-visible banner text as elapsed time crosses thresholds. Suggested thresholds (locale-overridable):
  - 0–30s: "Готовим аватар…" / "Preparing avatar…"
  - 30s–2min: "Синтезируем голос…" / "Synthesizing voice…"
  - 2–5min: "Видео рендерится…" / "Rendering video…"
  - 5+ min: "Финальный проход, скоро будет готово…" / "Final pass, almost there…"
- Cinematic banner stays as today (preserves cross-slice invariant 1). The rotation applies only when the active job is talking-avatar.
- Banner copy lives in `apps/web/messages/en.json` and `ru.json` under a stable namespace (e.g. `chat.talkingAvatarBanner.stage1` … `stage4`).
- No timer in the i18n strings themselves; the React component owns the elapsed-time tracking and reads the localized strings.

Scope OUT
- Backend changes (runtime, API, contracts, provider-gateway).
- Cinematic banner copy or behavior.
- Real progress / ETA estimation (HeyGen does not surface it).
- Persisting elapsed-time stamps in the database.

Forbidden patterns
- Querying provider status more aggressively to extract phase info — none exists.
- Adding phase strings to runtime job snapshot that the runtime cannot honestly populate from HeyGen.
- Hard-coding banner copy strings outside the i18n catalog.

Required tests
- Web component test: given a mock active talking-avatar job with elapsed time X seconds, asserts the correct banner stage string is rendered.
- Web component test: given a cinematic job, asserts the legacy banner copy renders unchanged.

Exit
- Long HeyGen renders feel alive instead of hung.

Deploy
- WEB only.
```

Slice 10b lands after Slice 10 (tool description) and before Slice 11 (smoke). It can in principle land earlier if the active-job DTO already carries enough information to distinguish talking-avatar from cinematic on the web.

### E4 — Settings Characters section: locked-with-upsell when plan toggle is off

**Supersedes:** § Slice 9 spec ("Hidden when plan `talkingVideoEnabled` is false").

**Decision:** when `talkingVideoEnabled = false` on the active plan, the Characters section is **visible but disabled**, not hidden. Disabled state shows:

- The section title and position (between Character #1 and Limits #2) so users know the feature exists.
- A quiet upsell hint, e.g. "Доступно на тарифе X+" / "Available on Plan X+", with an inactive-style link to `/pricing`.
- Any persona cards the workspace already owns (e.g. created during an upgrade trial) remain visible but disabled: no edit, no delete, no use. A small banner explains "Эти персонажи будут доступны снова при активации тарифа" / "These characters will be usable again when the plan is reactivated".
- No create form, no upload affordances.

**Tone:** quiet conversion hint, not a sales banner. Aligns with "не шумно" (user directive 2026-06-04). Runtime still hard-rejects talking-avatar render with `feature_unavailable` when the toggle is off (existing Slice 7 plan-gate validation).

**Slice impact:** Slice 9 must produce two visual states (enabled + disabled) and a tiny i18n entry for the upsell hint.

### E5 — Persona creation is REST-only — new cross-slice invariant #14

Reinforces E1 as a permanent constraint:

> **#14. Persona creation is REST-only.** Runtime tool calls never create personas. The only mutator surface for `workspace_video_personas` is the HTTP endpoint hit by the Settings → Characters form. Any future "create persona via chat" feature requires a new ADR.

### E6 — HeyGen integration targets v3 only

**Supersedes:** § Slice 1 spec (credential setup), § Slice 6 spec (provider client implementation).

**Decision:** every HeyGen API call PersAI makes uses **v3** endpoints against `https://api.heygen.com`. Auth header: `X-Api-Key: <key>`. Submit requests always carry an `Idempotency-Key` header (UUID per logical attempt). PersAI never calls v1/v2 endpoints (e.g. `POST /v2/video/generate` with `character.type: "talking_photo"`, `POST /v1/talking_photo`, `GET /v1/video_status.get`) even though they remain accepted until 2026-10-31. This avoids inheriting the v1/v2 sunset deadline and the documented v2 `talking_photo` lip-sync/billing bugs.

**Slice impact:**

- Slice 6 provider client uses `POST /v3/videos` (with `type: "image"` for Scenario A and `type: "avatar"` for Scenario C), `GET /v3/videos/{video_id}` for poll, `POST /v3/avatars` for lazy avatar create, `DELETE /v3/avatars/looks/{look_id}` + `DELETE /v3/avatars/{group_id}` for persona delete cascade.
- Slice 4 voice cache uses `GET /v3/voices` and (fallback) `POST /v3/voices/speech`.

### E7 — Defensive status parsing — new cross-slice invariant #15 (anti-keyword-routing reinforcement)

Reinforces user directive (2026-06-04) that PersAI must never keyword-route or parse message bodies:

> **#15. No keyword routing, no message-body parsing, no string-matching for behavior decisions, anywhere in PersAI code.** The model decides via tool description; PersAI code only handles structural data. This includes:
>
> - Mode selection (`mode: "cinematic" | "talking_avatar"`) is set explicitly by the model, never inferred from `speechText` content, photo presence, or any other request body inspection.
> - Persona resolution is exact-name equality (case-insensitive Unicode) against the workspace registry; no fuzzy match, no regex, no keyword list.
> - Multi-character detection uses **structural** signals only (e.g. `>1 personaId` field, or strict structural parse like "more than one named-speaker block in the speech script"). Never a keyword list of names.
> - Persona-creation intent ("save this as Masha") is detected by the model (tool description) and surfaced as advice; PersAI code does not parse this string.
> - Disambiguation choice: structured tool result `{status: "needs_disambiguation", candidates: [...]}` lets the chat render cards; the user clicks; the model re-issues `video_generate` with the chosen `personaId`. The chat code does not parse anything.
> - HeyGen poll status: defensive parsing treats any non-terminal status value as "in progress" (the documented `pending`/`processing`/`completed`/`failed` enum plus the `waiting` value seen in create responses; any future undocumented value follows the same rule).

This invariant binds every slice from this point on. A subagent that introduces keyword/regex/string-match routing must have its diff rejected.

### E8 — Tool result shape: `needs_disambiguation` variant

**Supersedes:** § Slice 7 spec (implicit).

**Decision:** the `video_generate` tool result type gets a new discriminated-union member returned when persona name resolves to more than one row:

```ts
type RuntimeVideoGenerateResult =
  | { status: "accepted"; jobId: string /* existing fields */ }
  | { status: "failed"; reason: string; code: string }
  | {
      status: "needs_disambiguation";
      candidates: Array<{
        personaId: string;
        displayName: string;
        portraitUrl: string;
        voiceId: string;
        voiceLabel: string;
        voicePreviewUrl: string | null;
        createdAtIso: string;
      }>;
    };
```

When the chat sees `status: "needs_disambiguation"`, it renders the candidate list as cards (shared `<PersonaCard>` component built in Slice 9). User clicks one card → next model turn calls `video_generate` with the chosen `personaId` → resolves uniquely → proceeds normally. The model receives the candidate list in the tool result and can also render the disambiguation as text if the UI does not enable cards (graceful degradation).

**Slice impact:** Slice 3 (contract) defines the union member. Slice 7 (runtime) returns it on ambiguous lookup. Slice 9 / Slice 10 / Slice 10b extend the chat rendering layer to display cards (lives in `apps/web/app/app/_components/chat-message.tsx` or a new sibling component).

### E9 — Ad-hoc voice selection (revised 2026-06-04 20:18 MSK)

**Supersedes:** an earlier draft of this erratum item that proposed runtime picking the first RU preset as a hardcoded default. Rejected after user feedback — that would be runtime "guessing", which violates cross-slice invariant #15 (no behavior decisions in PersAI code) and diverges from the proven ADR-107 Slice 4 Kling `voice_control` pattern.

**Decision:** the **model picks `voiceKey` explicitly**, the same way it already picks Kling `voiceIds[]` / `voiceKeys[]` under ADR-107 Slice 4 `audioMode: "voice_control"`.

- **Scenario A (ad-hoc):** the materialized tool bundle exposes the HeyGen voice shortlist (Slice 4 cache, attached as `videoVoiceCatalog` per Slice 4 spec). Each shortlist entry carries `voice_id`, `name`, `language`, `gender`, `preview_audio_url`, and (where present) tag/style metadata. The tool description teaches the model to pick a voice that fits the user's context (brand persona, requested gender/mood, language). The model passes the chosen `voiceKey` (= HeyGen `voice_id`) in the `video_generate` tool call. **Runtime does NOT pick a default.** If `mode = "talking_avatar"` is Scenario A and `voiceKey` is missing, runtime fails honestly with `voice_required` so the model retries the same tool call with an explicit pick. This is exactly the Kling `voice_control` failure honesty pattern (`requested_mode_unsupported` for missing voice ids).
- **Scenario C (persona reuse):** voice is already fixed on the persona row (`heygen_voice_id`, chosen by the user in Settings → Characters → Create). The model does not override it. If the user explicitly says "use a different voice" and the model passes an explicit `voiceKey`, runtime accepts the per-call override without mutating the persona row.

**Why this is better than the hardcoded default:**

- Honest. Code never "guesses" — the model decides based on the actual request context (e.g. "женский нежный для парфюмерии", "мужской низкий для рекламы автосалона", "детский для мультика про игрушки").
- Consistent with the ADR-107 Slice 4 pattern PersAI already ships and validates for Kling — no new architectural muscle, just reuse.
- Failure mode is loud, not silent. If the model misses the field, the user sees an honest retry, not the wrong voice playing.
- No assistant-level default-voice setting needed for MVP. A future ADR may add one if usage shows heavy ad-hoc traffic with predictable voice preference per assistant.

**Slice impact:**

- **Slice 3 (tool projection):** `voiceKey` field on `talking_avatar` request shape; tool description includes the voice shortlist (mirrors how the bundle already injects voice catalog for Kling under `voice_control`).
- **Slice 4 (voice cache):** shortlist shape is the same as Kling's `videoVoiceCatalog` attach (provider key `heygen`, voice list with metadata + preview URL). Slice 4 spec already calls for this — E2 just adds `preview_audio_url` guarantee on top.
- **Slice 7 (runtime execution):** validation for Scenario A requires `voiceKey` to be present in the request; missing → `voice_required` honest error; runtime never reads a default from constants or env. For Scenario C, runtime reads `heygen_voice_id` from the persona row unless `voiceKey` was explicitly set in the request (per-call override).
- **Slice 10 (tool description):** teaches the model how to pick from the shortlist by context — gender, language, tags. Same template the Kling voice_control description already uses.

### E10 — Webhook vs polling: polling for MVP (consistent with Runway/Kling)

**Adds clarification not in original ADR.**

HeyGen recommends webhooks (`callback_url` in create body or `POST /v3/webhooks/endpoints`) over polling in production. PersAI's existing Runway/Kling/OpenAI video providers all use polling via `pollMediaJobs` scheduler. For MVP, **HeyGen also uses polling** for consistency. Webhook adoption is a separate optimization slice after the program lands and produces real traffic data.

**Slice impact:** Slice 6 provider client uses polling. Polling cadence default = 10s (matching HeyGen v3 quick-start), tolerant to the 5–30s spread documented across HeyGen sources. Polling-loss tolerance follows the existing Runway/Kling pattern.

### E11 — "Tool description" terminology + Admin Presets editor (added 2026-06-04 20:21 MSK)

**Clarifies what "tool description" means across this ADR (no new behavior, terminology pinning only).**

Throughout this ADR (notably § Decision § "Cost model", § Slice 10 spec, and erratum items E1/E7/E8/E9) the phrase "tool description" refers to the text that LLMs see in the function/tool JSON schema for `video_generate`, NOT a user-visible UI string. Concretely:

- **Code default** lives in `apps/runtime/src/modules/turns/native-tool-projection.ts::createVideoGenerateToolDefinition` (and the sibling `voiceCatalogHint` helper). This is what Slice 10 and Slice 4 (voice shortlist hint) actually edit.
- **Admin live override** is available via the existing `/admin/presets` editor (`apps/web/app/admin/presets/page.tsx::ToolPromptState`), which exposes per-tool `codeDefaultModelDescription`, `modelDescription` (override), `modelUsageGuidance` (override), and `modelDescriptionOverridden` / `modelUsageGuidanceOverridden` flags. The runtime resolver `resolveToolDefinitionDescription(policy, codeDefault)` returns the override when present, otherwise the code default. Same pattern already governs every other native tool.
- **Implication for Slice 10:** Slice 10 only changes the code default in `native-tool-projection.ts`. The `/admin/presets` editor automatically picks up the new code default in its "Code default" column and lets operators override per-deployment without a code change. No new admin UI is needed for ADR-109 — `/admin/presets` already covers it.
- **Implication for Slice 4:** the HeyGen voice shortlist hint (analogous to the existing Kling `voiceCatalogHint`) is generated at projection time inside `native-tool-projection.ts` and concatenated into the same `description` string. Slice 4 cache supplies the shortlist data; Slice 10 wires the hint string.

This is terminology pinning. No prior erratum item changes substantively because of E11 — the architecture was already correct, the word "tool description" was just under-specified.

---

### Erratum-induced acceptance checklist additions

Append to § Acceptance checklist above when implementation lands:

- [ ] No `apps/runtime/**` file mutates `workspace_video_personas` (E1, invariant #14).
- [ ] Every `voice_id`-rendering UI surface uses the shared `<VoicePreviewButton>` component (E2).
- [ ] Voice cache populates `previewAudioUrl` from HeyGen native URL OR PersAI-generated fallback (E2).
- [ ] Talking-video banner copy rotates by elapsed time on talking-avatar jobs only (E3, Slice 10b).
- [ ] Cinematic banner copy unchanged (E3, invariant #1).
- [ ] Settings Characters section is visible-with-upsell (not hidden) when toggle is off (E4).
- [ ] PersAI code calls only HeyGen v3 endpoints (E6).
- [ ] `Idempotency-Key` header present on every `POST /v3/videos` submit (E6).
- [ ] HeyGen poll defensively treats any non-terminal status as in-progress (E7, invariant #15).
- [ ] `video_generate` result type includes `needs_disambiguation` variant (E8).
- [ ] No keyword routing / message-body parsing introduced anywhere (E7, invariant #15).
