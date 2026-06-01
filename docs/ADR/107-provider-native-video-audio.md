# ADR-107: Provider-native audio for generated video

## Status

Accepted (2026-06-01)

## Context

ADR-106 made `video_generate` provider-aware for OpenAI, Runway, and Kling, but intentionally kept the normalized runtime video contract silent:

- prompt;
- optional reference image;
- seconds;
- size;
- provider/model/secret selected from the catalog.

That was enough to make Runway/Kling live-callable for video without disturbing the working OpenAI media path. It is not enough for audio.

The product expectation is clear: when a user asks for a generated video with speech, music, scene sound, or a supplied voice/music reference, PersAI should use provider-native video/audio capabilities where the selected provider and model actually support them. It should not invent a separate TTS/mux pipeline as the first solution.

Provider docs found before this ADR:

- Kling 3.0 documents native audio, multi-character speaking, voice tone binding, multilingual speech, dialects/accents, and audio-visual output in the same generation.
- Kling API wrappers expose audio-related video controls such as `enable_audio`, `keep_original_audio`, `sound`, `lip_sync`, and external dubbing/audio URLs in specific task modes.
- Runway docs list `veo3.1` / `veo3.1_fast` audio and no-audio pricing, but the standard Gen-4.5 `image_to_video` guide exposes only visual generation fields. Runway also has separate audio/voice/avatar APIs, which are not the same as general video generation with an arbitrary music/voice reference.

Therefore audio support must be model/mode-aware, not a global `video_generate` boolean.

## Decision

Add provider-native audio support for `video_generate` as an optional capability on top of ADR-106.

The first implementation path must stay simple:

- keep silent video as the default;
- enable audio only when the selected provider/model/catalog row explicitly supports it;
- prefer provider-native video audio over PersAI-side TTS or muxing;
- support user intent for speech/music/scene sound through the video prompt when the provider supports native audio;
- support audio or voice references only for provider modes that explicitly accept those inputs;
- preserve honest fallback: if the selected provider/model cannot satisfy requested audio, return a clear unsupported-audio result or use a silent fallback only when the plan/policy allows it.

Provider policy for the first pass:

- **Kling:** primary target for native audio because official/user-facing docs explicitly describe video-native audio and voice binding.
- **Runway:** enable only for models/modes whose API reference clearly supports audio output or audio controls. Do not assume Gen-4.5 supports native audio just because Runway has separate audio APIs.
- **OpenAI:** keep existing OpenAI video behavior intact; only widen the contract if OpenAI's current API path can map the new audio fields honestly.

## Non-goals

- Do not build a separate PersAI TTS + video mux pipeline in this ADR.
- Do not add generic audio editing, music generation, dubbing, or podcast features outside `video_generate`.
- Do not promise audio for every Runway/Kling model.
- Do not silently generate a speech/music request as silent video without a user-visible explanation.
- Do not change `image_generate` or `image_edit`.
- Do not add Runway/Kling to chat routing.
- Do not introduce fake provider stubs or TODO scaffolding.

## Runtime contract shape

The exact contract should be chosen in Slice 1 after reading current code and provider refs, but the target product shape is:

```ts
type VideoAudioMode =
  | "silent"
  | "provider_native"
  | "preserve_reference_audio"
  | "reference_voice_or_track";
```

Meaning:

- `silent`: current ADR-106 behavior.
- `provider_native`: provider generates speech/music/scene sound from the prompt in the same video generation.
- `preserve_reference_audio`: provider keeps audio from a supplied reference video where supported.
- `reference_voice_or_track`: provider uses a supplied audio/voice/music reference where supported, for example Kling lip-sync/local dubbing modes.

The model-facing tool should not expose raw provider parameter names. Runtime/provider-gateway adapters own mapping to provider-specific request fields such as `enable_audio`, `sound`, `keep_original_audio`, `local_dubbing_url`, or a Runway model-specific audio selector.

## Agent execution model

### Orchestrator responsibilities

The orchestrator must:

1. Start from a clean git tree.
2. Record baseline SHA in `docs/SESSION-HANDOFF.md`.
3. Execute one bounded slice per session unless explicitly expanded.
4. Use subagents for implementation slices and diff-review all results.
5. Keep ADR-106 invariants intact: Runway/Kling video only, no chat routing, image tools OpenAI-only.
6. Verify provider docs before enabling any provider/mode.
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

| Slice | Title                                   | Purpose                                                                                            | Deploy                           |
| ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| 0     | Provider capability audit               | Map current OpenAI/Runway/Kling audio-capable video API shapes and current PersAI video seams      | NO                               |
| 1     | Contract and catalog capability         | Add minimal audio-mode/capability truth without changing execution yet                             | CONTRACT/API/WEB                 |
| 2     | Admin selection and validation          | Let admins configure audio-capable video models and prevent impossible plan selections             | API/WEB                          |
| 3     | Materialization and runtime intent      | Materialize audio mode/reference truth and let runtime distinguish silent vs audio-requested video | API/RUNTIME                      |
| 4     | Provider-gateway audio mapping          | Implement provider-native audio mapping, Kling first, Runway only where docs prove support         | PROVIDER-GATEWAY/RUNTIME         |
| 5     | Billing, delivery honesty, verification | Attribute audio-priced video correctly and verify user-visible audio/silent outcomes               | API/RUNTIME/PROVIDER-GATEWAY/WEB |

Minimum useful path for honest catalog/admin support: `0 -> 1 -> 2`.

Minimum production path for live provider-native video audio: `0 -> 1 -> 2 -> 3 -> 4 -> 5`.

## Slice specifications

### Slice 0 - Provider capability audit

**Scope**

- Re-read current official provider docs and API references.
- Confirm exact request/response fields for:
  - Kling native audio (`enable_audio` / current equivalent);
  - Kling preserve/reference audio or lip-sync modes;
  - Runway audio-capable video models, especially `veo3.1` / `veo3.1_fast`;
  - OpenAI current video audio behavior if exposed through the active provider gateway path.
- Map existing PersAI files touched by ADR-106 that would need audio mode wiring.

**Exit**

- Handoff records provider capability map.
- No code changes.

### Slice 1 - Contract and catalog capability

**Scope**

- Add the smallest durable capability truth needed to distinguish silent video from audio-capable video models.
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
- Audio capability cannot make Runway/Kling chat-capable.
- Existing silent video rows remain valid.

### Slice 2 - Admin selection and validation

**Scope**

- Add admin-visible audio capability/mode controls only where needed.
- Prevent selecting audio-required behavior for models without audio support.
- Keep silent video as the default.

**Likely files**

- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/admin/plans/page.tsx`
- plan validation services/tests

**Required tests**

- Admin Runtime can mark a video model as native-audio capable.
- Admin Plans can select audio-capable video models for audio video.
- Plan save rejects audio requests for silent-only models.
- Image selectors remain OpenAI-only.

### Slice 3 - Materialization and runtime intent

**Scope**

- Materialize audio mode/reference requirements into `video_generate` refs or runtime bundle policy.
- Runtime must distinguish:
  - user requested silent/default video;
  - user requested speech/music/scene sound;
  - user supplied audio/video reference and asked to preserve/use it.
- Runtime must fail honestly or choose an allowed fallback when audio is requested but unavailable.

**Likely files**

- materialization service/tests
- runtime video tool service/tests
- native tool projection guidance

**Required tests**

- Silent video materializes and runs as ADR-106.
- Audio-requested video requires an audio-capable model/ref.
- Unsupported audio does not silently become successful silent video.
- Fallback keeps provider/model/audio capability honest.

### Slice 4 - Provider-gateway audio mapping

**Scope**

- Implement provider-specific request mapping for proven audio modes.
- Start with Kling native audio if docs/API reference are clear.
- Add Runway audio mapping only for specific models/modes with documented audio behavior.
- Do not build PersAI-side TTS/mux.

**Likely files**

- `apps/provider-gateway/src/modules/providers/kling/*`
- `apps/provider-gateway/src/modules/providers/runway/*`
- `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts`
- runtime provider-gateway client validation

**Required tests**

- Kling native audio request sets the correct provider field and returns audio-bearing video metadata if available.
- Kling unsupported audio/reference mode fails explicitly.
- Runway audio mode is accepted only for documented audio-capable models.
- Provider mismatch and unknown provider behavior remain explicit.

### Slice 5 - Billing, delivery honesty, verification

**Scope**

- Ensure provider billing facts distinguish silent vs audio-priced video where provider pricing differs.
- Delivery should honestly report whether the requested audio was produced, unsupported, or unavailable.
- Run final focused and repo gates.

**Required tests**

- Cost attribution uses the executing provider/model/audio mode.
- Silent fallback does not masquerade as audio success.
- Focused API/web/runtime/provider-gateway tests pass.
- Repo gates pass.

**Live smoke**

- One silent OpenAI video path.
- One Kling native-audio video path with speech or scene sound.
- One audio-unsupported path that returns an honest user-visible outcome.
- Runway audio smoke only if the chosen Runway model/mode is confirmed by API docs and credentials.

## Cross-slice invariants

1. Silent video remains the default behavior.
2. Audio support is capability-gated by provider/model/mode.
3. Runway/Kling remain video-only providers, not chat-routing providers.
4. `image_generate` and `image_edit` remain OpenAI-only.
5. Audio-requested video must not silently succeed as silent video without explanation.
6. Provider pricing and billing facts must reflect audio/no-audio differences.
7. No PersAI-side TTS/mux pipeline in this ADR.

## Risks

- Provider docs may differ from wrapper APIs; implementation must verify the exact API surface used by PersAI.
- Runway model names may expose audio pricing before a simple audio control exists in the general video endpoint.
- Audio output may be present but not easy to detect from metadata; tests should validate the strongest available provider signal.
- Reference audio/voice modes may require upload/public URL handling and stricter file validation than image references.

## Acceptance checklist

- [ ] Provider capability audit completed and recorded.
- [ ] Catalog can represent silent vs native-audio video capability.
- [ ] Admin can configure audio-capable video rows without polluting chat/image paths.
- [ ] Plans/runtime reject impossible audio requests honestly.
- [ ] Kling native audio is supported where API docs confirm it.
- [ ] Runway audio is supported only for documented audio-capable model/mode combinations.
- [ ] Billing facts distinguish audio-priced video where provider pricing differs.
- [ ] Delivery/user-visible result says when audio was produced or not supported.
- [ ] Live smoke verifies at least one provider-native audio video path.
