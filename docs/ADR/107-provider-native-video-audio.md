# ADR-107: Provider-native video audio, voice control, and extended video input modes

## Status

Closed as partial program (2026-06-07). Landed items remain active; the remaining provider-native video audio / multi-image / Omni / audio-priced-ledger items are deferred indefinitely with no active follow-up program. See `## Program closure (2026-06-03)` for the landed/deferred split. HeyGen talking-avatar work is handled separately by ADR-109, and voice-cloning / Characters UX v2 follow-up is handled by ADR-111.

## Context

ADR-106 made `video_generate` provider-aware for OpenAI, Runway, and Kling, but intentionally kept the normalized runtime video contract narrow:

- prompt;
- optional single reference image;
- seconds;
- size;
- provider/model/secret selected from the catalog.

That was enough to make the current OpenAI, Runway, and standard Kling video paths callable without disturbing the working OpenAI media flow. It is not enough for the next product step.

The next product expectation is broader than "turn sound on":

1. when a user asks for generated video with scene sound or provider-generated audio, PersAI should use provider-native video audio when the selected provider/model actually supports it;
2. when a user asks for spoken narration or character speech, PersAI must distinguish ordinary native audio from provider-side **voice control** / human-speech control;
3. when a user asks for Kling multi-image generation, PersAI must not pretend the current single `referenceImage` contract already covers it;
4. when a user asks for Kling Omni generation, PersAI must treat that as a distinct provider path, not as a normal `text2video` / `image2video` model switch.

### Corrected provider truth

The provider truth that must drive this ADR is:

- **Kling standard video path** currently means the provider endpoints already wired into PersAI: `POST /v1/videos/text2video` and `POST /v1/videos/image2video`, with task polling on the matching `{task_id}` routes.
- **Kling Omni** is documented separately and uses a different provider create path: `POST /v1/videos/omni-video`. It is not the same transport seam as the current standard Kling video path.
- **Kling multi-image / multi-element generation** is also a distinct provider capability family. It is not honestly represented by the current PersAI contract of one optional `referenceImage`.
- **Kling native audio** and **Kling voice control** are not the same thing. Native audio means provider-side audio generation in the produced video. Voice control means provider-side control of human speech / voice behavior and is model/mode-specific.
- Live/doc truth currently shows:
  - `kling-v3` supports native audio, but the current model matrix marks **voice control (human voice)** as unsupported.
  - `kling-v2-6` supports native audio and also has a distinct higher-cost voice-control path in the provider pricing/model matrix.
  - `kling-v3-omni` is documented, but the current PersAI standard Kling path cannot use it because that model belongs to the separate `/omni-video` provider route.
- **Runway** docs and pricing confirm that `veo3.1` and `veo3.1_fast` have audio-priced vs no-audio-priced video behavior. That does **not** mean every Runway video model supports audio, and it does **not** mean ordinary Gen-4.5 or Gen-4 Turbo should be treated as audio-capable.
- Runway also has separate voice/audio/avatar APIs. Those must not be conflated with general-purpose `video_generate`.

Therefore this ADR is about four distinct truths:

1. silent video;
2. provider-native audio in generated video;
3. provider-side voice control / human-speech generation;
4. extended video input modes such as Kling multi-image and Kling Omni.

These must be model/mode-aware, not one global `video_generate` boolean.

## Decision

Add provider-native audio support and extended provider video-mode support on top of ADR-106, while keeping the public product seam honest.

The first implementation path must stay strict:

- keep silent video as the default;
- enable native audio only when the selected provider/model/catalog row explicitly supports it;
- distinguish native audio from voice-controlled speech;
- prefer provider-native video/audio over a PersAI-side TTS/mux pipeline;
- support multi-image or Omni input only for providers and adapters that explicitly accept those inputs;
- preserve honest fallback: if the selected provider/model cannot satisfy requested audio/voice-control/multi-image behavior, return a clear unsupported result or fall back only when the fallback model can honestly satisfy the request class.

### Provider policy for the first pass

- **Kling standard video** is the first target for native audio because the current PersAI adapter already owns that seam.
- **Kling voice control** is a narrower capability than native audio and must be represented separately in catalog/runtime truth.
- **Kling multi-image** is a separate capability family and requires an explicit provider path/adapter shape beyond the current single reference-image contract.
- **Kling Omni** requires a distinct provider-gateway route for `/v1/videos/omni-video`; it must not be modeled as a normal standard-video model on the current `text2video` / `image2video` execution path.
- **Runway** audio must be enabled only for documented audio-capable model/mode combinations such as `veo3.1` and `veo3.1_fast`. Do not infer audio for `gen4.5` or `gen4_turbo`.
- **OpenAI** keeps current video behavior unless the active PersAI provider path gains clear, honest support for the same capability classes.

## Non-goals

- Do not build a separate PersAI TTS + video mux pipeline in this ADR.
- Do not add generic audio editing, dubbing, or podcast features outside `video_generate`.
- Do not promise native audio or voice control for every Runway/Kling model.
- Do not treat Kling Omni as "just another model row" on the standard Kling endpoints.
- Do not treat Kling multi-image as already solved by the current one-image `referenceImage` contract.
- Do not silently satisfy speech/music requests with silent video without a user-visible explanation.
- Do not change `image_generate` or `image_edit`.
- Do not add Runway/Kling to chat routing.
- Do not introduce fake provider stubs or TODO scaffolding.

## Runtime contract shape

The exact contract should be chosen in Slice 1 after reading current code and provider refs, but the target product shape must separate audio intent from input mode:

```ts
type VideoAudioMode =
  | "silent"
  | "provider_native_audio"
  | "voice_control"
  | "preserve_reference_audio"
  | "reference_voice_or_track";

type VideoInputMode =
  | "text"
  | "single_reference_image"
  | "multi_image"
  | "reference_video"
  | "omni";
```

Meaning:

- `silent`: current ADR-106 behavior.
- `provider_native_audio`: provider generates audio in the same video job, but not necessarily controllable human speech.
- `voice_control`: provider generates controllable spoken voice / human speech as part of the video job.
- `preserve_reference_audio`: provider keeps audio from a supplied reference video where supported.
- `reference_voice_or_track`: provider uses a supplied voice/music/audio reference where the provider API explicitly supports it.
- `multi_image`: provider supports more than one image/reference input in one video-generation request.
- `omni`: provider supports a richer mixed-input mode that is not reducible to ordinary text-to-video or single-image-to-video.

The model-facing tool should not expose raw provider parameter names. Runtime and provider-gateway adapters own mapping to provider-specific request fields such as `sound`, `keep_original_sound`, voice-control toggles, multi-image arrays, or the separate Kling `/omni-video` path.

## Agent execution model

### Orchestrator responsibilities

The orchestrator must:

1. Start from a clean git tree.
2. Record baseline SHA in `docs/SESSION-HANDOFF.md`.
3. Execute one bounded slice per session unless explicitly expanded.
4. Use subagents for implementation slices and diff-review all results.
5. Keep ADR-106 invariants intact: Runway/Kling remain video-only, no chat routing, image tools OpenAI-only.
6. Verify provider docs and, where needed, live API behavior before enabling any provider/model/mode.
7. Run focused tests for every changed seam.
8. Update docs in the same slice when contract/API/runtime behavior changes.

### Required startup reading

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. `docs/ADR/106-video-provider-catalog-and-execution-routing.md`
9. this ADR

## Execution ledger

| Slice | Title                              | Purpose                                                                                                                        | Deploy                           |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| 0     | Provider capability audit          | Map current OpenAI/Runway/Kling audio, voice-control, multi-image, and Omni API shapes against current PersAI seams            | NO                               |
| 1     | Contract and catalog capability    | Add durable capability truth for native audio, voice control, multi-image, and Omni eligibility without changing execution yet | CONTRACT/API/WEB                 |
| 2     | Admin selection and validation     | Let admins configure the new video capability truth and prevent impossible plan/runtime selections                             | API/WEB                          |
| 3     | Materialization and runtime intent | Materialize audio/input-mode truth and make runtime distinguish silent, audio, voice-control, multi-image, and Omni requests   | API/RUNTIME                      |
| 4     | Provider-gateway extended mapping  | Implement proven provider mappings: Kling standard audio first, then Kling multi-image/Omni, and Runway only where docs prove  | PROVIDER-GATEWAY/RUNTIME         |
| 5     | Billing, delivery honesty, verify  | Attribute cost honestly and verify user-visible audio/voice/input-mode outcomes                                                | API/RUNTIME/PROVIDER-GATEWAY/WEB |

Minimum useful path for honest catalog/admin support: `0 -> 1 -> 2`.

Minimum production path for live provider-native audio and extended Kling video modes: `0 -> 1 -> 2 -> 3 -> 4 -> 5`.

## Slice specifications

### Slice 0 - Provider capability audit

**Scope**

- Re-read current official provider docs and API references.
- Confirm exact request/response fields for:
  - Kling native audio on the current standard video endpoints;
  - Kling voice control / human speech modes;
  - Kling multi-image / multi-element video path;
  - Kling Omni create/query path and how it differs from standard video;
  - Runway audio-capable video models, especially `veo3.1` / `veo3.1_fast`;
  - OpenAI current video-audio behavior if exposed through the active provider gateway path.
- Map existing PersAI files touched by ADR-106 that would need audio/input-mode wiring.

**Exit**

- Handoff records provider capability map.
- No code changes.

### Slice 1 - Contract and catalog capability

**Scope**

- Add the smallest durable capability truth needed to distinguish:
  - silent-only video;
  - native-audio video;
  - voice-control-capable video;
  - single-image vs multi-image vs Omni-capable video paths.
- Keep chat routing and image capabilities unchanged.
- Ensure old catalog rows normalize to silent-video-compatible behavior.

**Likely files**

- `packages/contracts/openapi.yaml`
- generated contracts
- `packages/runtime-contract/src/index.ts`
- runtime provider settings/profile code and tests

**Required tests**

- Contract generation.
- Catalog normalization keeps Runway/Kling video-only.
- Audio/voice-control/multi-image/Omni capability truth cannot make Runway/Kling chat-capable.
- Existing silent video rows remain valid.

### Slice 2 - Admin selection and validation

**Scope**

- Add admin-visible capability controls only where needed.
- Prevent selecting audio-required, voice-control-required, multi-image-required, or Omni-required behavior for models that do not support it.
- Keep silent video as the default.

**Likely files**

- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/admin/plans/page.tsx`
- plan validation services/tests

**Required tests**

- Admin Runtime can mark a video model as native-audio capable separately from voice-control-capable.
- Admin Plans/runtime validation reject impossible audio/voice-control/input-mode combinations.
- Image selectors remain OpenAI-only.

### Slice 3 - Materialization and runtime intent

**Scope**

- Materialize audio/input-mode requirements into `video_generate` refs or runtime bundle policy.
- Runtime must distinguish:
  - user requested silent/default video;
  - user requested scene sound/native audio;
  - user requested spoken/narrated voice output;
  - user requested multi-image generation;
  - user requested Omni generation.
- Runtime must fail honestly or choose an allowed fallback only when the fallback can satisfy the same requested class.

**Likely files**

- materialization service/tests
- runtime video tool service/tests
- native tool projection guidance

**Required tests**

- Silent video materializes and runs as ADR-106.
- Audio-requested video requires an audio-capable model.
- Voice-controlled video requires a voice-control-capable model.
- Multi-image and Omni requests do not silently degrade to single-image standard video without explanation.
- Fallback keeps provider/model/audio/input-mode honesty.

### Slice 4 - Provider-gateway extended mapping

**Scope**

- Implement provider-specific request mapping for proven modes.
- Start with Kling standard native audio on the current standard path.
- Add Kling multi-image and Kling Omni only through explicit provider routes.
- Add Runway audio mapping only for specific models/modes with documented audio behavior.
- Do not build PersAI-side TTS/mux.

**Likely files**

- `apps/provider-gateway/src/modules/providers/kling/*`
- `apps/provider-gateway/src/modules/providers/runway/*`
- `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts`
- runtime provider-gateway client validation

**Required tests**

- Kling native audio request sets the correct provider field on the standard path.
- Kling voice-control request fails explicitly when routed to a model/path that does not support it.
- Kling multi-image request uses its own provider path and does not reuse ordinary single-image request shape.
- Kling Omni request uses the dedicated provider path and does not masquerade as ordinary standard video.
- Runway audio mode is accepted only for documented audio-capable models.
- Provider mismatch and unknown provider behavior remain explicit.

### Slice 5 - Billing, delivery honesty, verification

**Scope**

- Ensure provider billing facts distinguish silent vs native-audio vs voice-control-priced video where provider pricing differs.
- Delivery should honestly report whether the requested audio, voice-controlled speech, or extended input mode was actually produced, unsupported, or unavailable.
- Run final focused and repo gates.

**Required tests**

- Cost attribution uses the executing provider/model/audio/input-mode.
- Silent fallback does not masquerade as audio or voice-control success.
- Unsupported multi-image or Omni requests do not masquerade as ordinary standard-video success.
- Focused API/web/runtime/provider-gateway tests pass.
- Repo gates pass.

**Live smoke**

- One silent OpenAI video path.
- One Kling native-audio video path.
- One Kling voice-control path only if the exact provider API path/model is confirmed and wired.
- One Kling multi-image or Omni path only after the dedicated provider route is implemented.
- One audio-unsupported path that returns an honest user-visible outcome.
- Runway audio smoke only if the chosen Runway model/mode is confirmed by API docs and credentials.

## Cross-slice invariants

1. Silent video remains the default behavior.
2. Native audio, voice control, multi-image, and Omni support are capability-gated by provider/model/mode/path.
3. Runway/Kling remain video-only providers, not chat-routing providers.
4. `image_generate` and `image_edit` remain OpenAI-only.
5. Audio-requested video must not silently succeed as silent video without explanation.
6. Voice-control-requested video must not silently downgrade to ordinary native-audio or silent video without explanation.
7. Multi-image and Omni requests must not silently downgrade to ordinary single-image standard video without explanation.
8. Provider pricing and billing facts must reflect audio/no-audio/voice-control differences where provider pricing differs.
9. No PersAI-side TTS/mux pipeline in this ADR.

## Risks

- Provider docs may differ from the exact live API surface/credentials/region used by PersAI; implementation must verify the exact path that PersAI calls.
- Runway model names may expose audio pricing before a simple audio control exists in the general video endpoint used by PersAI.
- Kling Omni is documented but requires a different provider path than the current standard Kling adapter; catalog truth alone is insufficient.
- Audio output may be present but not easy to detect from metadata; tests should validate the strongest available provider signal.
- Voice-control and reference-audio modes may require stricter upload/public-URL handling than image references.

## Acceptance checklist

- [x] Provider capability audit completed and recorded.
- [x] Catalog can represent silent vs native-audio vs voice-control video capability.
- [x] Catalog/runtime can distinguish single-image vs multi-image vs Omni-capable video paths.
- [x] Admin can configure these video capability rows without polluting chat/image paths.
- [x] Plans/runtime reject impossible audio, voice-control, multi-image, and Omni requests honestly.
- [x] Kling native audio is supported where the active provider path confirms it.
- [~] Runway audio is supported only for documented audio-capable model/mode combinations. (Deferred indefinitely; no follow-up program — see `## Program closure (2026-06-03)`.)
- [~] Kling multi-image and Kling Omni are supported only through explicit provider routes. (Deferred indefinitely beyond the bounded `image` + `image_tail` two-image case landed in Slice 4; no follow-up program — see `## Program closure (2026-06-03)`.)
- [~] Billing facts distinguish the priced execution mode where provider pricing differs. (Deferred indefinitely; audio-priced ledger dimensions never added; no follow-up program — see `## Program closure (2026-06-03)`.)
- [~] Delivery/user-visible result says when audio, voice control, or extended input mode was produced or not supported. (Deferred indefinitely; delivery narration not implemented; no follow-up program — see `## Program closure (2026-06-03)`.)
- [~] Live smoke verifies at least one provider-native audio video path. (Deferred indefinitely; live smoke not executed; no follow-up program — see `## Program closure (2026-06-03)`.)

## Program closure (2026-06-03)

ADR-108 Slice 0 closes ADR-107 as a program. The acceptance checklist above is now partial: landed items remain landed; the rest is deferred indefinitely with no follow-up program, no roadmap, and no candidate slice list. ADR-107 is not reopened. Reviving any deferred capability requires a new ADR.

### Landed

- **Slice 1 — Contract and catalog capability.** Recorded in `docs/CHANGELOG.md` 2026-06-02 entry "ADR-107 Slice 1 — video capability contract/catalog truth (`packages/runtime-contract`, `packages/contracts`, `apps/api`, `apps/web`, `apps/runtime`, `docs`; 2026-06-02)". `RuntimeVideoModelParameters.audioCapabilities` (`silent` / `provider_native_audio` / `voice_control`) and `inputCapabilities` (`text` / `single_reference_image` / `multi_image` / `omni`) are durable contract truth on video catalog rows. OpenAPI and generated contracts expose the shape; legacy rows normalize to silent + text (+ `single_reference_image` when `referenceImageSupported=true`). Runway/Kling stay video-only and out of chat routing.
- **Slice 4 — Bounded Kling voice control + 2-image tail mapping.** Recorded in `docs/CHANGELOG.md` 2026-06-02 entry "ADR-107 Slice 4 — bounded Kling voice control + 2-image tail mapping (`packages/runtime-contract`, `apps/runtime`, `apps/provider-gateway`, `docs`; 2026-06-02)". Runtime `video_generate` accepts explicit `voiceIds[]` / `voiceKeys[]`; for Kling on `text2video` and `image2video`, `audioMode:"voice_control"` maps to the documented `voice_list` path with `sound:"on"`; `inputMode:"multi_image"` with exactly two ordered image aliases maps to Kling `image` + `image_tail`. Out-of-bounds requests fail honestly.
- **Slice 5 — Bounded billing + unsupported-mode honesty verification.** Recorded in `docs/CHANGELOG.md` 2026-06-02 entry "ADR-107 Slice 5 — bounded billing + unsupported-mode honesty verification (`apps/runtime`, `apps/api`, `docs`; 2026-06-02)". Async `video_generate` paths preserve current provider/model billing facts; `requested_mode_unsupported` outcomes are terminal user/runtime failures rather than retryable runtime failures. No new audio-priced ledger dimensions were added; that work is deferred indefinitely (see below).
- **Slice 2 — Admin selection and validation (code-only on the active path; not separately ledgered in CHANGELOG).** Anchored at `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts:430-433`. The runtime provider settings save path validates audio/input capability shapes for video catalog rows so admins cannot mark a row capability-of-execution that the runtime/provider-gateway path cannot honor; chat/image surfaces are unaffected.
- **Slice 3 — Materialization and runtime intent (code-only on the active path; not separately ledgered in CHANGELOG).** Anchored at `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts:1092-1307`. Runtime `video_generate` distinguishes silent / provider-native-audio / voice-control / single-reference-image / 2-image-tail intents and rejects unsupported axes honestly via the structural unsupported-mode terminal outcome that Slice 5 then surfaces as a non-retryable failure.

### Deferred indefinitely (no follow-up program)

- Kling Omni provider route (`POST /v1/videos/omni-video`). The standard Kling adapter does not call it; no Omni route work is scheduled.
- Broad Kling multi-image / multi-element generation beyond the bounded `image` + `image_tail` two-image case landed in Slice 4. Larger multi-shot, custom storyboard, and multi-element semantics are not modeled.
- Runway voice / avatar APIs being routed through `video_generate`. Line 39-40 of this ADR ("Runway voice/avatar APIs must not be conflated with general-purpose `video_generate`") stays binding for Runway. ADR-109 carves a HeyGen-only named exception; nothing else is opened.
- The `preserve_reference_audio` and `reference_voice_or_track` audio modes mentioned in this ADR's "Runtime contract shape" section. They were never implemented and will not be implemented.
- Audio-priced ledger dimensions distinguishing silent vs native-audio vs voice-control cost. The internal USD COGS ledger (`model_cost_ledger_events`) keeps a single per-row provider cost without splitting by audio axis. ADR-108 introduces a separate Vcoin (VC) wallet for user-facing settlement of `video_generate`; that does not split the COGS ledger by audio axis either.
- Delivery copy that narrates produced audio / input-mode details to the user. The current generic completion framing stays; it avoids false success claims and does not narrate audio/input-mode production.

These items have no scheduled follow-up program, no roadmap, and no candidate slice list. A future need to revisit any of them requires a new ADR.

### Accepted residuals

The `omni` value of `inputCapabilities` is honestly representable on a video catalog row, and the Admin Runtime catalog UI accepts that capability label. However, the runtime `video_generate` execution path hard-rejects an `omni` request and the API runtime-provider settings save path also rejects `omni` for execution rows. This catalog-vs-runtime split is intentional: catalog truth stays expressive enough to describe what the provider documents, while the executable surface only advertises wired routes. It is not a bug, will not be fixed, and will stay this way until or unless a future ADR opens the dedicated `/omni-video` provider route.

OpenAI video continues to share the existing `tool_image_generate` OpenAI media credential entry. The video provider selector for OpenAI does not have a dedicated `tool/video_generate/openai/api-key` slot (only Runway and Kling have dedicated video provider credential slots, added by ADR-106 Slice 2). ADR-109 does not change this and adds its own dedicated `tool/video_generate/heygen/api-key` slot through the same ADR-106 Slice 2 pattern. A future change that splits the OpenAI image and OpenAI video credentials requires its own ADR.

### Cross-link

This program closure track is `docs/ADR/108-video-vcoin-economy-and-pre-talking-avatar-cleanup.md`. ADR-108 does not implement any deferred item from this ADR; it documents this closure (Slice 0), introduces a Vcoin wallet for `video_generate` settlement, and prepares the substrate that ADR-109 needs.

The talking-avatar program is `docs/ADR/109-heygen-talking-avatar-on-vcoin.md`. ADR-109 carries a single named exception to line 39-40 of this ADR: HeyGen `talking_avatar` mode is allowed on `video_generate` as a top-level `mode` field. Line 39-40 stays binding for Runway, OpenAI, Kling, and any future provider that is not explicitly opened by its own ADR.
