# ADR-111: HeyGen voice cloning and Characters UX v2

## Status

Closed as completed (2026-06-08). Baseline SHA: `2f24b93d09b32af392199916245692acf0308690`. Closure SHA: `1aabfd76`.

This ADR is an orchestration program. The parent agent acts as an orchestrator/reviewer and does not write production code. Implementation work must be delegated to GPT-5.4 subagents unless the user explicitly overrides that rule for a specific slice.

ADR-109 remains the completed talking-avatar foundation. This ADR does **not** reopen ADR-109. It supersedes only the ADR-109 non-goal that deferred HeyGen voice cloning, and it carries the post-ADR-109 Characters UX cleanup and video-player polish that should land before voice-clone UI is layered onto the same surface.

## Context

ADR-108 completed the VC wallet substrate for `video_generate`. ADR-109 completed the HeyGen talking-avatar path: credential, catalog, voice presets, workspace video personas, plan toggle, materialization, runtime execution, provider-gateway HeyGen v3 client, and user-facing Characters management.

After ADR-109, the useful next work is narrower than a broad HeyGen expansion:

- Keep `Custom audio lip-sync` out for now. It conflicts with PersAI chat voice-message semantics and is likely niche; voice cloning covers most "my voice" needs with better reuse.
- Keep `voice_settings`, background controls, and other HeyGen passthrough tuning out for now. They add UI surface before demand is proven. A generated HeyGen dashboard `title` may be added opportunistically when the provider client is touched, but it is not a slice.
- Add HeyGen voice cloning because it creates durable user value: one voice sample becomes a reusable workspace voice for many scripts and many characters.
- Polish Characters UI before adding voice clones, because the current wide cards and locked-state demo path are too sparse and too custom for the premium/minimal product direction.
- Fix video playback polish separately but inside this program: the lightbox hero play overlay currently stays visible because its display condition depends on `chromeVisible`; Capacitor preview failures likely still need MIME/Range validation at the file-download boundary, with `blob:` preview fallback investigated only if needed.

HeyGen voice cloning API truth confirmed from official docs:

- `POST /v3/voices/clone`
- Auth: `X-Api-Key`
- Body: `{ audio, voice_name, language?, remove_background_noise? }`
- `audio` may be `{ type: "url", url }`, `{ type: "asset_id", asset_id }`, or `{ type: "base64", media_type, data }`
- Response: `data.voice_clone_id`
- Poll: `GET /v3/voices/{voice_clone_id}` until status is `complete`
- Resulting voice can be used with `POST /v3/videos`
- Error examples include `resource_limit_reached` (limit 10), `plan_upgrade_required`, `authentication_failed`, and `rate_limit_exceeded`

## Decision

Create a workspace-scoped cloned-voice model and integrate it with the existing talking-avatar persona path.

The product model is:

1. Characters remain workspace video personas: face + display name + selected voice.
2. Voice clones become separate workspace resources, not hidden fields embedded inside a single persona.
3. Persona creation/editing can choose either a HeyGen preset voice or a workspace cloned voice.
4. The Characters section becomes "Characters and voices" in practice: a premium two-column character grid plus a compact "My voices" subsection.
5. The user can create a cloned voice either from the voices subsection or inline while creating/editing a character.
6. Voice-clone creation supports two input modes in the same modal:
   - upload an audio file;
   - record a sample by reading a prepared prompt, reusing the existing chat recorder / Capacitor-aware recording path.
7. VC is debited only after the HeyGen clone reaches successful completion. Failed or cancelled local waits do not debit.
8. Rendering a talking-avatar video resolves voice in this order:
   - explicit request-level `voiceKey`;
   - persona's linked cloned voice;
   - persona's preset HeyGen voice;
   - runtime's existing required-voice error where no usable voice is available.

## Non-goals

- Custom audio lip-sync (`audio_url` / `audio_asset_id` directly on video render).
- New top-level user-facing tool.
- Voice cloning outside HeyGen.
- Voice cloning for TTS/chat voice output. This ADR is only for HeyGen talking-avatar video voices.
- Multi-character per clip, montage, scenes, background music, HeyGen webhooks, Video Translate, Photo Avatar Looks.
- Broad redesign of Assistant Settings outside the Characters / video-player surfaces named here.
- Rewriting ADR-109 or changing its landed historical record.

## Orchestrator execution model

### Orchestrator role

- The parent agent is the **orchestrator**.
- The orchestrator is read-only for production code: `apps/**`, `packages/**`, `prisma/**`, `infra/**`, `scripts/**`.
- The orchestrator may edit docs only: this ADR, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, and the cross-doc files explicitly listed in a slice (`docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`).
- The orchestrator hires GPT-5.4 implementation subagents for source-code work.
- The orchestrator may hire readonly audit subagents before a slice when current code truth is uncertain.
- The orchestrator writes the slice prompt, reviews subagent diffs, runs verification itself, updates docs, and accepts/rejects/resumes the subagent.
- The orchestrator never commits or pushes unless the user explicitly asks.

### Per-slice workflow

1. Confirm `git status --short` is clean. If not clean, stop and report.
2. Record baseline SHA in `docs/SESSION-HANDOFF.md` for the session.
3. Read the slice spec in this ADR and the likely files.
4. State the slice plan in chat: slice id, purpose, Scope IN, Scope OUT, tests, deploy expectation, exit criteria.
5. Spawn exactly one GPT-5.4 implementation subagent for the slice unless the slice spec explicitly allows a second subagent for an isolated follow-up.
6. Require the subagent to return the mandatory structure below.
7. Diff-review every touched file. Reject if the subagent touched Scope OUT, added forbidden patterns, or omitted tests.
8. Run focused tests plus repo gates through the orchestrator shell.
9. Update docs for the slice.
10. Append `docs/CHANGELOG.md`.
11. Update `docs/SESSION-HANDOFF.md`.
12. Append `**Status (YYYY-MM-DD): Completed.**` to the slice spec.
13. State the next recommended slice.

### Implementation subagent prompt template

Every implementation subagent prompt must contain:

- **ADR + slice id.**
- **Model:** GPT-5.4.
- **Required reading:** absolute paths for this ADR, ADR-108, ADR-109, and the slice's likely files.
- **Purpose.**
- **Scope IN:** exact files/directories allowed.
- **Scope OUT:** exact files/directories forbidden.
- **Forbidden patterns.**
- **Required tests:** concrete assertions, not generic "test behavior".
- **Verification commands:** exact commands to run and include output for.
- **Return structure:** the mandatory structure below.

### Subagent return structure

The subagent must return all items:

1. **Changed files** with one-line behavioral summary.
2. **Tests added or changed** with assertion summary.
3. **Tests run** with command, PASS/FAIL, and useful output tail.
4. **Behavioral summary** in 3-5 bullets.
5. **Risks observed.**
6. **Out-of-scope discoveries.**
7. **Diff line counts per file.**

Missing any item is grounds for rejection before diff-review.

### Cross-slice invariants

1. ADR-109 talking-avatar execution remains HeyGen-only. No fallback to OpenAI, Runway, or Kling for `mode="talking_avatar"`.
2. Cinematic `video_generate` behavior remains unchanged except for the generic video-player polish in Slice 1.
3. Image, image-edit, TTS, STT, chat text routing, and OpenAI image paths are unchanged.
4. VC debits for voice-clone creation use ADR-108 wallet and ledger primitives; no parallel wallet path.
5. Render-cost VC continues to flow through existing ADR-108 media delivery settlement; voice cloning must not change render settlement.
6. Voice-clone rows are workspace-scoped, not assistant-scoped.
7. HeyGen cloned voice ids are provider metadata and are not exposed as user-visible labels.
8. Persona cards show user-facing voice labels, not raw provider ids.
9. No keyword routing for user intent or persona lookup. The model uses tool descriptions and materialized structured catalogs.
10. Browser/Capacitor recording reuses the existing chat recorder abstraction where practical; do not write a second recorder stack unless the current one cannot be reused and the blocker is documented.
11. Locked Characters UI uses the same card component as unlocked UI, with disabled actions, not a separate custom demo component.
12. No broad reformat of `assistant-settings.tsx` or generated files outside the slice scope.

## Execution ledger

| Slice | Title                                            | Purpose                                                                                                                                                                                                                                                                                                                  | Deploy                   |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1     | Video player and Capacitor preview polish        | Fix generic video-preview/playback polish before adding more video-heavy UI. Hero play overlay disappears when playback starts; chrome auto-hides; file download path preserves video MIME and Range truth; investigate `blob:` preview only if MIME/Range does not close the Capacitor issue. **Completed 2026-06-07.** | WEB                      |
| 2     | Characters UI v2                                 | Replace the sparse wide Characters list with a premium/minimal two-column grid and use the same card component for locked and unlocked states. Remove custom locked demo layout. **Completed 2026-06-07.**                                                                                                               | WEB                      |
| 3     | Voice clone substrate                            | Add workspace cloned-voice persistence, admin/runtime settings, contract state, and VC ledger kind without calling HeyGen yet. **Completed 2026-06-07.**                                                                                                                                                                 | API + CONTRACT           |
| 4a    | Voice clone backend                              | Implement HeyGen voice clone submit/poll, workspace cloned-voice CRUD endpoints, successful-completion VC debit, and provider error mapping. **Completed 2026-06-07.**                                                                                                                                                   | API + PROVIDER-GATEWAY   |
| 4b    | Persona linked-clone substrate + runtime resolve | Add persona cloned-voice linkage while preserving preset fallback, then implement talking-avatar voice resolution order. **Completed 2026-06-07.**                                                                                                                                                                       | API + RUNTIME + CONTRACT |
| 5     | Voice clone UI + docs + smoke                    | Add the "My voices" subsection, clone modal with upload/record modes, inline clone-from-character path, tool-description guidance, docs updates, full verification, and live smoke. **Completed 2026-06-08.**                                                                                                            | WEB + RUNTIME + DOCS     |

Recommended execution order: `1 -> 2 -> 3 -> 4a -> 4b -> 5`.

Slice 4 was split after the first GPT-5.4 implementation subagent returned an architectural blocker before code changes:

- `4a` HeyGen provider-gateway clone client + polling, API cloned-voice CRUD, and successful-completion VC debit;
- `4b` persona linked-clone substrate + runtime resolve order.

Rationale: the provider-gateway/API clone CRUD + debit work is coherent, but the runtime precedence rule `explicit voiceKey -> persona linked cloned voice -> persona preset voice` requires a persona linkage field first. Current persona persistence and internal runtime fetches only carry preset HeyGen voice fields, so implementing runtime precedence in `4a` would either overload preset fields or lose the fallback.

## Slice specifications

### Slice 1 - Video player and Capacitor preview polish

**Scope**

- `image-lightbox.tsx`: hide hero play overlay when `videoPlaying === true`, independent of `chromeVisible`.
- Add a small auto-hide chrome timer after playback starts.
- Keep the transport controls accessible and return chrome on user interaction.
- Verify same-origin assistant-file video download preserves `Range`, `206`, `Content-Range`, `Accept-Ranges`, and `Content-Type: video/*`.
- If upstream file download lacks MIME truth, fix upstream or web proxy fallback so video files do not become `application/octet-stream`.
- Investigate `localPreviewUrl` / `blob:` only if the MIME/Range fix does not explain Capacitor behavior.

**Scope IN**

- `apps/web/app/app/_components/image-lightbox.tsx`
- `apps/web/app/app/_components/chat-message.tsx` only if preview state needs a local fix
- `apps/web/app/api/assistant-file/[fileRef]/route.ts`
- Upstream API file-download route/service only if response headers are missing video MIME/Range truth
- Focused tests for touched web/API paths

**Scope OUT**

- HeyGen provider client changes.
- Characters UI.
- Voice cloning.
- Async media-job state machine.

**Forbidden patterns**

- Hiding controls permanently without a way to recover them.
- Autoplay-only fixes that fail when the user manually presses play.
- Hardcoding HeyGen-specific MIME behavior in generic file routes.

**Required tests**

- Lightbox hero play button disappears after `onPlay`.
- Lightbox hero play button reappears on `onPause` / `onEnded`.
- Video file route preserves `Range` passthrough and `206` status where upstream supports it.
- Video MIME remains `video/mp4` (or the stored video MIME), not `application/octet-stream`.

**Status (2026-06-07): Completed.** The video lightbox hero play overlay now depends only on `videoPlaying`, so it disappears once playback starts even when chrome is visible. Video chrome auto-hides after playback starts and returns on user tap. Inline chat video previews no longer rely on Android WebView decoding the first frame: the chat card renders a deterministic compact play placeholder while keeping a hidden metadata-only `<video>` for duration. The same-origin `assistant-file` BFF has focused regression coverage proving `Range`/validator passthrough plus upstream `206`, `Content-Range`, `Accept-Ranges`, `Content-Length`, and `Content-Type: video/mp4` preservation. Upstream API download already served real ranged responses, so no API or `persai-mobile` change was needed.

### Slice 2 - Characters UI v2

**Scope**

- Convert Characters list to premium/minimal responsive grid:
  - 1 column on mobile;
  - 2 columns on desktop/tablet;
  - compact horizontal cards with smaller portrait, muted voice label, subtle actions.
- Replace `Голос:` / `Voice:` style with a cleaner label such as `Voice - Alex` or locale equivalent following existing i18n style.
- Move long explanation into quiet help/tooltip or compact helper text.
- Make "Create character" a grid slot or a compact aligned CTA, not a detached wide empty area.
- Locked state uses the same card component geometry as unlocked state:
  - existing personas visible but disabled;
  - optional demo records use the same component;
  - no custom oversized demo card;
  - create slot disabled with plan-gating copy.

**Scope IN**

- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/assistant-settings.test.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- Shared UI component files only if extracting a small local card component is cleaner than growing `assistant-settings.tsx`

**Scope OUT**

- API contract changes.
- Voice-clone schema/UI.
- Persona creation/edit semantics.
- Avatar replacement.

**Forbidden patterns**

- Creating a second locked-state component with different layout.
- Adding noisy badges, dates, usage counts, or provider ids to compact cards.
- Broad reformat of `assistant-settings.tsx`.

**Required tests**

- Unlocked state renders personas in the standard card component.
- Locked state renders the same card component disabled and does not expose delete/edit actions.
- Create CTA is enabled only when plan and limits allow.
- i18n keys exist for both locales.

**Status (2026-06-07): Completed.** Characters now render through shared compact card/create-slot helpers inside `assistant-settings.tsx`, with a one-column mobile grid and two-column desktop/tablet grid. Locked and unlocked states share the same card geometry: locked saved personas remain visible but disabled, the demo persona uses the same card path, and locked cards expose no edit/delete/portrait-open actions. The create CTA lives in the grid and disables for plan gating or persona-limit gating without opening the modal. Voice labels now use the cleaner `Voice - {voice}` / `Голос - {voice}` copy, and focused tests cover unlocked cards, locked disabled cards, gated create behavior, limit behavior, and locale keys.

### Slice 3 - Voice clone substrate

**Scope**

- Add `workspace_video_cloned_voices` (or equivalent) persistence.
- Store workspace scope, display name, normalized display name for uniqueness, HeyGen voice clone id nullable until complete, language hint, status, default flag, optional preview URL, source metadata, timestamps, and archived flag.
- Add admin/runtime settings:
  - `heygenVoiceCloneWorkspaceLimit` default 5, hard cap 10;
  - `heygenVoiceCloneCreationVcoin` default 50 VC.
- Add VC ledger kind for successful voice clone creation (for example `voice_clone_creation`).
- Add contract state for cloned voices where needed by API/web, but do not expose raw provider ids as labels.
- No HeyGen HTTP call yet.

**Scope IN**

- `apps/api/prisma/schema.prisma`
- New Prisma migration
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts` only if settings types live there
- `apps/api/src/modules/workspace-management/domain/**` for repository ports
- `apps/api/src/modules/workspace-management/infrastructure/persistence/**` for repository implementations
- `packages/contracts/openapi.yaml` and generated contract files if REST state is introduced here
- Focused API tests

**Scope OUT**

- Provider-gateway HeyGen clone calls.
- Runtime talking-avatar execution.
- Web UI.
- Changes to ADR-108 wallet internals beyond adding a permitted ledger kind/type.

**Forbidden patterns**

- Assistant-scoped cloned voices.
- Charging VC before a clone is complete.
- Raw HeyGen voice clone id in user-facing display strings.
- New wallet/debit implementation outside ADR-108 repositories.

**Required tests**

- Repository create/list/archive round-trip.
- Workspace limit enforced.
- Display-name uniqueness enforced within workspace.
- Settings default to 5 clone limit and 50 VC cost.
- Ledger kind parses/round-trips where kind unions are typed.

**Status (2026-06-07): Completed.** The API substrate now has workspace-scoped `workspace_video_cloned_voices` persistence, a Prisma migration, domain/repository ports, and module registration. The model stores normalized display names, nullable HeyGen clone id, language hint, status, default flag, preview URL, source metadata, timestamps, and soft-archive state. Platform runtime settings now carry `heygenVoiceCloneWorkspaceLimit` (default 5, hard cap 10) and `heygenVoiceCloneCreationVcoin` (default 50), with parser/default/round-trip tests. The VC ledger typed kind now permits `voice_clone_creation`, but no wallet debit, HeyGen HTTP call, REST endpoint, runtime resolve, or web UI was added in this slice.

### Slice 4 - Voice clone backend + runtime resolve

**Scope**

- Add HeyGen voice clone client:
  - `POST /v3/voices/clone`
  - `GET /v3/voices/{voice_clone_id}` polling until exact `complete`
  - structural handling of provider errors including `resource_limit_reached`, `plan_upgrade_required`, auth, and rate-limit
- Add API service/endpoints to create/list/delete/set-default cloned voices.
- Voice clone create accepts uploaded audio bytes. Recording output from web must arrive through the same upload shape.
- Debit VC only when HeyGen reports successful completion and the cloned voice row is marked ready, in one transaction with ledger event idempotency.
- Failed clone attempts store honest status or fail cleanly with no VC debit.
- Talking-avatar render voice resolution supports cloned voices:
  - explicit `voiceKey` wins;
  - persona linked cloned voice next;
  - persona preset voice next.
- Keep render billingFacts and ADR-108 video render settlement unchanged.

**Scope IN**

- `apps/provider-gateway/src/modules/providers/heygen/**`
- `apps/provider-gateway/test/heygen-provider.client.test.ts`
- `apps/api/src/modules/workspace-management/application/heygen/**`
- `apps/api/src/modules/workspace-management/interfaces/http/**` relevant workspace video persona controller/routes
- `apps/api/test/*heygen*`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/test/runtime-video-generate-tool.service.test.ts`
- `packages/runtime-contract/src/index.ts` if provider/runtime request shape needs cloned voice ids

**Scope OUT**

- Characters UI.
- Chat voice-message transcription path.
- TTS voice output.
- Video render settlement code in `media-delivery.service.ts`.
- Webhooks.
- Custom audio lip-sync.

**Forbidden patterns**

- Treating any status containing `"complete"` as success; success must be exact structural status.
- Retrying non-transient 4xx errors silently.
- Debiting VC before successful completion.
- Storing cloned voices under assistant id.
- Using keyword routing to detect "my voice" in code.

**Required tests**

- Submit clone request uses `POST /v3/voices/clone` with `X-Api-Key`.
- Polling treats exact `complete` as success; non-terminal statuses continue; failures surface honestly.
- 400 `resource_limit_reached` and 403 `plan_upgrade_required` map to stable product errors.
- Successful clone creates/updates a ready cloned-voice row and debits VC once.
- Failed clone does not debit VC.
- Runtime uses explicit voice override before persona cloned voice before persona preset voice.

**Split status (2026-06-07): Split into 4a/4b before code changes.** A GPT-5.4 subagent confirmed the provider-gateway/API clone CRUD + debit work can land independently, but runtime voice precedence needs persona linked-clone substrate first. 4a owns HeyGen clone submit/poll, cloned-voice CRUD, stable product error mapping, and successful-completion VC debit. 4b owns persona cloned-voice linkage, internal/runtime contract widening, and the final runtime precedence implementation.

**4a Status (2026-06-07): Completed.** Provider-gateway now exposes HeyGen voice clone submit/poll via `POST /v3/voices/clone` and `GET /v3/voices/{voice_clone_id}`, with exact `status === "complete"` success handling and stable product error mapping for clone limit, plan-upgrade, auth, and rate-limit conditions. API now exposes workspace-scoped cloned voice create/list/archive/set-default endpoints, accepts multipart audio upload, validates the audio file, enforces workspace limit and duplicate-name checks, marks failed provider attempts as `failed` without debit, and finalizes successful clones by marking the row `ready` and recording a `voice_clone_creation` VC debit in the same transaction. Runtime/persona linked-clone resolution remains in 4b.

**4b Status (2026-06-07): Completed.** Personas now persist optional workspace cloned-voice linkage via `clonedVoiceId` while retaining preset `heygenVoiceId` / `heygenVoiceLabel` fallback fields. API create/update validates linked cloned voices as same-workspace, active, ready, and provider-backed. Internal runtime persona reads expose linked cloned-voice metadata only when the link remains usable, materialized persona catalogs expose safe display labels rather than provider ids, and talking-avatar runtime voice resolution now follows ADR order: explicit request `voiceKey`, then linked ready cloned voice, then preset persona voice.

### Slice 5 - Voice clone UI + docs + smoke

**Scope**

- Add "My voices" subsection to the Characters area.
- Keep minimalist/premium visual language from Slice 2.
- Add voice clone cards with display name, status, preview where available, default marker, linked character count/name summary, and delete.
- Add clone modal with two modes:
  - upload file;
  - record voice.
- Reuse the existing chat recorder / Capacitor-aware recording abstraction. If reuse is impossible, document why before implementing a small wrapper.
- Recording mode includes:
  - prepared reading prompt from i18n;
  - timer;
  - level/SPL indicator if available from the existing recorder path;
  - preview playback;
  - retry/re-record;
  - fallback to upload when mic permission fails.
- Inline path from persona create/edit: `Clone a new voice` creates a clone and attaches it to the character after success.
- Add user copy for quality guidance and rights confirmation.
- Update tool description/materialized voice catalog guidance so the model can refer to cloned voices without keyword routing.
- Update `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`.
- Live smoke in dev with a real HeyGen credential:
  - create cloned voice from upload or recording;
  - attach cloned voice to a persona;
  - render a talking-avatar video using that persona;
  - verify VC debit for clone and VC render debit remain distinct.

**Scope IN**

- `apps/web/app/app/_components/assistant-settings.tsx`
- Existing chat recorder component/hook files, only for reuse/export if needed
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/assistant-api-client.test.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- Cross-doc files listed above

**Scope OUT**

- Building a second audio-recorder stack if existing chat recorder can be reused.
- Custom audio lip-sync video rendering.
- Background music, video translate, webhooks.
- Reworking non-Characters settings sections.

**Forbidden patterns**

- Hiding legal/rights copy behind a hover-only affordance.
- Making voice clone creation look instant if HeyGen is still polling.
- Showing raw HeyGen clone ids in UI.
- Letting a failed clone appear selectable for render.

**Required tests**

- Voice subsection renders ready/in-progress/failed states.
- Clone modal upload path validates name/audio/cost.
- Record path handles permission failure and uses fallback copy.
- Persona form can select an existing cloned voice.
- Inline clone path attaches the new voice after success.
- Tool description includes cloned voice guidance only when talking video is enabled and cloned voices are materialized.
- Cross-doc updates mention ADR-111.

**Status (2026-06-08): Completed.** The Characters surface now includes a `My voices` subsection with ready/pending/failed cloned-voice cards, preview/default/archive actions, linked-character summaries, VC cost/limit copy, and honest disabled states. The clone modal supports upload and browser recording modes with visible quality guidance, rights confirmation, sample prompt, preview playback, retry/remove, and microphone-permission fallback copy. Post-audit cleanup added stale microphone-start guards, clone/persona blob URL revocation, and UI limit gating aligned with API active-row truth. Persona create/edit can attach only ready cloned voices while preserving preset HeyGen fallback voice fields, and the inline clone flow attaches a newly ready clone to the open persona form. Runtime tool projection now surfaces safe linked cloned-voice labels from materialized persona catalog truth without raw provider ids or keyword routing. Archiving a cloned voice now best-effort marks workspace assistants config-dirty so materialized persona guidance refreshes. Cross-docs were updated in `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, and `TEST-PLAN`. Local focused tests and the full verification gate passed. Authenticated `persai-dev` live smoke was completed after the Clerk middleware and HeyGen audio MIME fixes: voice clone creation succeeded, the clone was usable from saved character UI, and later provider-gateway rollout noise was confirmed transient rather than an ADR defect.

## Acceptance checklist

- [x] Video lightbox hero play overlay no longer covers playing video.
- [x] Capacitor video preview path has verified MIME/Range behavior.
- [x] Characters UI uses a compact premium two-column grid on desktop.
- [x] Locked and unlocked Characters states share the same card component.
- [x] `workspace_video_cloned_voices` (or final equivalent) exists and is workspace-scoped.
- [x] Clone limit and clone VC price are admin/runtime settings.
- [x] HeyGen `POST /v3/voices/clone` and poll path are implemented.
- [x] Voice clone success debits VC once through ADR-108 wallet/ledger.
- [x] Failed clone attempts do not debit VC.
- [x] Persona can use either a preset HeyGen voice or a workspace cloned voice.
- [x] Runtime resolves voice in the ADR-111 precedence order.
- [x] Voice clone UI supports upload and record modes.
- [x] Existing chat recorder / Capacitor recording path is reused or a blocker is documented.
- [x] UI includes quality guidance and rights confirmation.
- [x] No keyword routing or fuzzy persona/voice intent detection was added.
- [x] Docs updated: ARCHITECTURE, API-BOUNDARY, DATA-MODEL, TEST-PLAN.
- [x] Full verification gate PASS.
- [x] Live dev smoke recorded for cloned voice creation + persona render.

## Program closure

ADR-111 is closed as completed on 2026-06-08.

Completed scope:

- HeyGen voice cloning is workspace-scoped, limit/cost governed, and debits VC only after successful provider completion.
- Characters UI v2, cloned-voice UI, upload/record voice clone creation, preset/cloned voice selection, and cloned-voice archive/default paths are implemented.
- Talking-avatar runtime voice resolution follows explicit request `voiceKey` -> linked ready cloned voice -> preset persona voice.
- Mobile/chat video preview and lightbox playback polish landed in the generic video surface.
- Post-smoke fixes closed the real live blockers: Clerk auth coverage for cloned-voice routes, browser recording conversion to WAV, and HeyGen `audio/x-wav` projection.

Out of scope remains out of scope and should not be reopened under ADR-111:

- Custom audio lip-sync.
- HeyGen Studio API / scene assembly.
- Broad HeyGen voice/video passthrough tuning.
- TTS/chat voice output; future TTS work belongs to a separate TTS v2 ADR/slice.

## Risks

- **HeyGen account capability.** Voice cloning may require a paid HeyGen plan. Surface `plan_upgrade_required` honestly and do not present it as a PersAI user-plan problem.
- **Provider clone limit.** HeyGen example error says clone limit 10. PersAI default limit should be lower or equal to avoid user-facing provider failures.
- **Voice rights.** Users can upload someone else's voice. UI must require a rights acknowledgement and keep audit metadata.
- **Audio quality.** Low-quality mobile recordings produce poor clones. UI should guide users toward clean speech and expose level feedback during recording.
- **Async wait.** Cloning is submit/poll, not instant. UI must show honest in-progress state and avoid charging until success.
- **Large UI file.** `assistant-settings.tsx` is already large. Subagents must avoid broad reformat and prefer small extracted components only when they reduce risk.
- **Mobile recorder drift.** Web and Capacitor recording behavior must stay aligned; reuse current chat recorder path where possible.

## Alternatives considered

### Put voice cloning into ADR-109

Rejected. ADR-109 is the historical talking-avatar foundation. Voice cloning was explicitly a non-goal there and introduces a new domain entity, new VC event kind, new UI subsection, and new provider workflow. A new ADR preserves historical clarity.

### Make cloned voice a field on `workspace_video_personas`

Rejected as the only model. It is simpler at first but wastes HeyGen clone quota when the same voice should be reused across multiple faces/looks. ADR-111 stores cloned voices as workspace resources and lets personas link to them.

### Ship custom audio lip-sync first

Rejected for now. It conflicts with chat voice-message semantics and is less reusable than voice cloning. It can be added later with the existing HeyGen video client if user demand appears.

### Add all HeyGen passthrough tuning now

Rejected. `voice_settings`, backgrounds, expressiveness, and similar knobs add UI complexity before there is clear demand. Keep the premium path simple.

## Consequences

### Positive

- Users can create reusable brand/personal voices for talking-avatar videos.
- Characters UI becomes compact and premium before more entities are added.
- Voice clones are reusable across multiple personas.
- VC accounting remains consistent with ADR-108.
- The orchestrator/subagent model keeps large web/API/provider/runtime changes reviewable.

### Negative

- Adds a new persistent workspace resource and a second HeyGen async workflow.
- Adds more Settings UI complexity inside an already large component.
- Requires careful handling of microphone recording across web and Capacitor.
- Requires explicit rights/quality copy, which adds product surface even in a minimalist UI.
