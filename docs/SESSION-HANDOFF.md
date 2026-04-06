# SESSION-HANDOFF

## 2026-04-06 - SR7b web staged attachment visibility parity

### Current active slice

- `SR7` — Media pipeline capacity hardening

### Current active sub-slice

- `SR7b` — Web staged attachment visibility parity

### What stale program state was fixed

1. After `SR7a`, canon still left the active sub-slice wording anchored to the STT scratch pass even though the next truthful bounded seam had already narrowed to the web staged upload visibility gap.
2. The shared `SR7` observation baseline described touched STT/inbound/delivery metrics but did not yet record the web staged attachment path as part of that same bounded media-stage surface.

### What subagents were launched and why

No new subagents were needed in this pass because the web staged-upload observability gap had already been narrowed from prior readonly `SR7` evidence gathering and live validation discussion.

### What evidence they returned

- Prior `SR7` evidence already showed the media system is shared across channels, but the web staged upload/image path remained the obvious bounded visibility gap after `SR7a`.
- Direct code inspection confirmed `ManageChatMediaService.stageForWebThread` performed validation, optional preprocessing, quota gating, runtime upload, and attachment persist without recording a media-stage metric.
- Existing metrics serialization tests already covered one media-stage family, making a small parity extension the minimal honest `SR7b` implementation.

### What was completed

1. `ManageChatMediaService.stageForWebThread` now records bounded `web_stage_attachment` media-stage metrics with `success` and `failure` outcomes.
2. Added focused regression coverage in `apps/api/test/manage-chat-media.stage-web-thread.test.ts` for direct metric emission on the web staged upload path.
3. Extended `apps/api/test/platform-readiness.service.test.ts` so `/metrics` serialization now also covers `web_stage_attachment`.
4. Updated canonical docs and progress markers so `SR7b` is the truthful active `SR7` sub-slice instead of an undocumented follow-up.

### What remains

- Deploy and observe the expanded `SR7` media-stage surface in the target environment across web upload/image/file use, plus the earlier voice/STT paths.
- Make one honest decision from live evidence: either `SR7` can close on bounded visibility plus current fixes, or one more bounded media-pressure seam still remains active.

### Confirmed risks

1. This pass improves operational visibility but does not by itself remove inline preprocessing/upload pressure from the API request path.
2. `web_stage_attachment` is intentionally one bounded stage, so deeper intra-stage hotspots may still need later decomposition if live evidence shows the single metric is insufficient.

### Unresolved hypotheses

1. With the web staged-upload gap closed, the next remaining `SR7` hotspot may be true runtime/API pressure rather than observability blind spots.
2. Live multi-channel use may still show that one more bounded media-pressure control is needed before `SR7` can close honestly.

### Verification run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.stage-web-thread.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/platform-readiness.service.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` remains active because this pass closes a visibility gap but still needs live target-environment observation before claiming media bursts are bounded and operationally visible enough to open `SR8`.

### Next recommended step

- Deploy the `SR7b` API change, exercise voice plus web image/file upload flows in the live environment, inspect `media_stage_*` across both API pods, and then decide honestly whether `SR7` can close or needs one final bounded pressure-control pass.

## 2026-04-06 - SR7a STT scratch isolation and media-stage visibility

### Current active slice

- `SR7` — Media pipeline capacity hardening

### Current active sub-slice

- `SR7a` — STT scratch isolation and media-stage visibility

### What stale program state was fixed

1. Canon still showed `SR7` as active but with no chosen bounded sub-slice even after fresh evidence isolated the shared `_stt_tmp` scratch directory as the first honest media temp-file seam.
2. Current baseline docs still described shared lazy `_stt_tmp` cleanup as the active safeguard, and the active `SR7` state still had no bounded media-stage observation surface recorded in canon.

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **Map media hot paths** — to identify which media paths can dominate API/runtime under burst and whether a small implementation target existed.
2. **Map temp file lifecycle** — to trace where media temp files are created, cleaned, or can collide/leak across STT paths.
3. **Check SR7 boundaries** — to confirm the chosen fix stays inside `SR7` and not `SR6`, `SR8`, or `SR9`.

### What evidence they returned

- Hot-path mapping showed that web and Telegram inbound media both hit `MediaPreprocessorService` inline on the API request path, and STT currently stages through runtime upload -> transcribe -> cleanup.
- Temp-file mapping showed that `MediaPreprocessorService.transcribeAudio()` used a shared `_stt_tmp` runtime media directory with fire-and-forget batch cleanup before upload, and direct web voice transcription used a separate but still shared `_voice_tmp` path, creating the same class of collision risk across PersAI-owned STT ingress paths.
- Boundary mapping confirmed this seam belongs to `SR7` because it is media preprocessing and temp-file lifecycle pressure, not workspace quota enforcement (`SR6`), webhook/realtime fan-in (`SR8`), or quota/billing correctness (`SR9`).
- The existing metrics surface exposed only generic HTTP/request signals, not bounded stage-level media signals for the touched STT/inbound/delivery hotspots.

### What was completed

1. `MediaPreprocessorService` now stages preprocessing STT through a per-request transient scratch directory instead of the shared `_stt_tmp` path.
2. Direct web voice transcription in `ManageChatMediaService` now stages through a per-request transient scratch directory instead of the shared `_voice_tmp` path.
3. Cleanup now removes the same transient directory after the transcription attempt on both touched STT ingress paths, so one in-flight request no longer depends on deleting another request's scratch files.
4. Added bounded `/metrics` visibility for touched media-heavy paths: `stt_transcribe`, inbound attachment resolve, and outbound delivery persist.
5. Added focused regression coverage in `apps/api/test/platform-http-metrics.service.test.ts`, `apps/api/test/platform-readiness.service.test.ts`, `apps/api/test/media-preprocessor.service.test.ts`, `apps/api/test/manage-chat-media.transcribe-voice.test.ts`, and `apps/api/test/media-delivery.service.test.ts`.
6. Updated canonical docs and related baseline docs so `SR7a` is the explicit active sub-slice and the old shared scratch-path wording is no longer presented as the current baseline.

### What remains

- The broader `SR7` slice still needs deploy-time observation and later bounded fixes around media burst pressure across uploads/STT/TTS/image/pdf flows.

### Confirmed risks

1. This pass isolates PersAI-owned STT scratch paths and adds bounded visibility for touched media stages; it does not yet bound all media temp-file churn or remove preprocessing from the hot API request path.
2. Cleanup remains best-effort at the adapter/runtime boundary, so crash-time or runtime-unreachable leftovers can still require a later cleanup strategy.

### Unresolved hypotheses

1. The next dominant `SR7` pressure point may now be duplicated download -> re-upload I/O in media delivery or broader inline preprocessing pressure rather than shared STT scratch collisions.
2. A later `SR7` pass may still need bounded preprocessing concurrency limits or worker/offload if live burst evidence shows inline preprocessing still dominates API/runtime resources.

### Verification run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/platform-http-metrics.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/platform-readiness.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/media-preprocessor.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/manage-chat-media.transcribe-voice.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/media-delivery.service.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` remains active because this first deploy package still needs target-environment observation; even with the new metrics surface we do not yet have live evidence that media bursts are bounded and visible operationally, so opening `SR8` would be dishonest.

### Next recommended step

- Deploy this first `SR7a` package, observe the new media-stage signals in the target environment, and only then choose the next bounded `SR7` fix based on which hotspot actually dominates.

## 2026-04-06 - SR6 operational closure accepted, SR7 opened, and dev rollout churn reduced

### Current active slice

- `SR7` — Media pipeline capacity hardening

### Current active sub-slice

- none yet; the next session should choose one bounded `SR7` sub-slice from actual media/temp-file burst evidence

### What stale program state was fixed

1. Canon still treated `SR6f` as a blocking storage slice even after the user explicitly accepted operational sufficiency and live evidence showed the protection already bounds oversized writes near quota, blocks follow-up work, and preserves cleanup.
2. Dev delivery still treated OpenClaw-only pin bumps as if they should also trigger api/web image rebuilds and extra GitOps churn, which was causing unnecessary Argo syncs and GKE cost.

### What subagents were launched and why

Two readonly evidence-gathering subagents:

1. **Inspect double rollout** — to identify the minimal safe CI/workflow change that removes unnecessary OpenClaw/api/web rollout churn.
2. **Check SR6 closure docs** — to identify the exact canonical markers that still blocked `SR7` and how to close `SR6` truthfully without pretending the original strict `SR6f` shell-exit bar passed.

### What evidence they returned

- The extra rollout churn came from two workflows independently writing `infra/helm/values-dev.yaml`, while OpenClaw-only SHA bumps still triggered the generic api/web image workflow.
- The current live pod already carried the latest runtime and payload fixes, so the remaining `dd exit code 0` behavior was not a stale-image/cache issue.
- Canonical docs still blocked `SR7` on the strict original `SR6f` criterion even though the user accepted operational closure with an explicit residual risk.

### What was completed

1. `SR6` was closed in canon as an operationally sufficient storage/workspace hardening slice.
2. `SR7` was opened as the new active slice.
3. Canon now records the accepted residual honestly: we do not claim ideal `dd`/shell exit-code semantics on every oversized-write path, only bounded growth plus visible quota failure and cleanup safety.
4. Dev GitHub workflows were narrowed so OpenClaw-only deliveries no longer trigger unnecessary api/web image builds and related extra Argo/GKE churn.
5. Repo instructions/runbooks were updated so future agents bump `openclaw-approved-sha.txt` and let the OpenClaw workflow own the follow-up Helm image pin.

### What remains

- Choose one bounded `SR7` media/temp-file sub-slice from fresh evidence instead of continuing storage work.
- Observe the narrowed workflow behavior in the next normal OpenClaw-only delivery to confirm that the extra rollout/build churn is actually reduced as intended.

### Confirmed risks

1. Accepted residual from `SR6`: one-shot oversized `dd`/shell paths can still present a clean command exit even though quota enforcement already bounds growth and blocks follow-up work.
2. The workflow change reduces unnecessary dev churn, but it does not collapse all GitOps writes into a single commit; api/web pushes and OpenClaw pin bumps still remain separate delivery events when both truly change.

### Unresolved hypotheses

1. `SR7` may uncover that media temp-file churn, not the remaining `dd` semantics edge, is now the dominant storage-pressure path at scale.
2. If GKE cost pressure remains high even after narrower workflow triggers, the next infra hygiene pass may still want a single combined GitOps writer for dev.

### Verification run

- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/workspace-quota-guard.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts src/agents/pi-embedded-runner/run/payloads.test.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` can now be opened because the user accepted `SR6` operational closure and canon now reflects that accepted residual explicitly instead of pretending the original strict `SR6f` shell-exit criterion passed.

### Next recommended step

- Start `SR7` with one bounded media/temp-file evidence pass and keep the remaining `SR6` residual only as accepted background risk unless real abuse/support evidence says it must be reopened.

## 2026-04-06 - SR6f embedded quota exec failures stay visible in UI replies

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6f` — One-shot oversized write runtime stop closure

### What stale program state was fixed

1. The runtime-side `exec` result had already been hardened, but the embedded/UI payload layer still suppressed ordinary `exec` tool failures when verbose mode was off, which could make quota-triggered exec failures look like a silent or apparently successful turn to the user.

### What subagents were launched and why

None for this pass. The remaining seam was identified directly from code and from the mismatch between the intended runtime failure and the user-facing live behavior.

### What evidence they returned

- `bash-tools.exec.ts` already contained the new post-command quota hard-fail path for non-cleanup commands.
- `pi-embedded-runner/run/payloads.ts` still suppressed `exec`/`bash` tool errors when verbose mode was off, unless a separate mutating-tool policy forced a warning.
- `payloads.test.ts` explicitly encoded that old suppression behavior for generic `exec` failures.

### What was completed

1. `openclaw/src/agents/pi-embedded-runner/run/payloads.ts` now keeps workspace-quota `exec` failures visible even when verbose mode is off.
2. Added focused regression coverage in `openclaw/src/agents/pi-embedded-runner/run/payloads.test.ts`.
3. Updated the OpenClaw pin in `PersAI` again so the next deploy carries the embedded/UI-facing fix too.

### What remains

- One final live repro after deploy is still required.
- The closure question is now very narrow: confirm the same oversized write no longer appears as a clean success and that the quota failure is actually visible to the user in the target environment.

### Confirmed risks

1. This pass fixes user-visible surfacing of quota-triggered exec failure, but it still does not prove the process is always interrupted early enough to minimize overshoot.
2. Cleanup remains intentionally allowed under quota exceedance and should stay that way.

### Unresolved hypotheses

1. This may be the final missing seam needed for an honest `SR6` close if the next live repro now reports the failure clearly.
2. If live still shows apparent success, the remaining issue is deeper than post-check semantics plus payload surfacing and will need one more bounded runtime investigation.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/workspace-quota-guard.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts src/agents/pi-embedded-runner/run/payloads.test.ts src/agents/pi-embedded-runner/run/payloads.errors.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked until the same oversized-write live repro is rerun after this user-facing fix deploy.

### Next recommended step

- Let this deploy finish, run the same oversized-write repro again without relying on prior context, and then decide whether `SR6` can finally close.

## 2026-04-06 - SR6f one-shot oversized write still completes past quota

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6f` — One-shot oversized write runtime stop closure

### What stale program state was fixed

1. Canon had drifted into treating `SR6d` as live-confirmed enough to move the active blocker fully to `SR6e`, but the next live repro showed the core oversized-write termination gate is still not honestly closed.
2. `SR6` could not be closed truthfully after a live run where ordinary file mutations passed but one oversized write still exited successfully and only later commands were blocked.

### What subagents were launched and why

- None in this pass; the new evidence was a direct live test result against the deployed runtime and was sufficient to re-open the truthful active blocker immediately.

### What evidence they returned

- Ordinary file mutations were clean in live use:
  - `writeFile`
  - overwrite
  - delete
  - rename with overwrite
- Workspace stayed near `48M` during those operations and cleanup still worked.
- The one-shot oversized write repro remained a live failure:
  - command: `dd if=/dev/zero of=/workspace/quota_live_check_big/oversized_1000M.bin bs=1M count=1000`
  - result: command completed with `code 0`
  - follow-up command then failed with `Workspace storage quota exceeded: 880.0 MB used, limit 700.0 MB. Delete files to free space.`

### What was completed

1. Recorded truthful post-deploy evidence that `SR6e` helped ordinary file-mutation paths but did not close the one-shot oversized write gate.
2. Updated canonical docs so `SR6` remains active and the honest blocker is now `SR6f`, not speculative `SR7`.

### What remains

- A bounded runtime-side fix is still required so one oversized foreground write does not complete successfully past quota.
- `SR7` remains blocked until that live gate is actually passed.

### Confirmed risks

1. Current quota enforcement is still permissive enough that one long write can finish and only later commands fail.
2. This is still a real active-path `SR6` blocker, not only a docs or observation nuance.

### Unresolved hypotheses

1. The remaining failure may still be caused by polling cadence / kill timing rather than by the broader `SR6e` mutation-cost work.
2. A tighter runtime-stop strategy may still close `SR6` without requiring a full quota-accounting redesign.

### Verification run

- Live evidence from UI/runtime:
  - initial workspace: `48M`
  - ordinary file mutations: pass cleanly
  - oversized one-shot write: still completes successfully
  - cleanup after exceedance: succeeds
  - final workspace after cleanup: `48M`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked because the main `SR6` live closure gate failed again: one oversized write still finished successfully past quota.

### Next recommended step

- Take one more bounded runtime pass on `bash-tools.exec.ts` so the oversized write command itself gets interrupted in the target environment, then rerun the same live repro before any `SR6` closure claim.

## 2026-04-06 - SR6f post-command quota hard fail for non-cleanup exec

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6f` — One-shot oversized write runtime stop closure

### What stale program state was fixed

1. The prior `SR6f` wording treated the remaining live gap as purely "kill during command", but the code still had a smaller truthful seam: a non-cleanup command could leave the workspace over quota and still be returned as a clean success with `exitCode 0`.

### What subagents were launched and why

Two readonly evidence-gathering subagents:

1. **SR6f exec gap** — identified the exact runtime seam still allowing a successful outcome after post-command over-quota detection.
2. **Argo double rollout** — investigated the user's CI/gitops concern and separated it from the bounded SR6 runtime fix.

### What evidence they returned

- In `bash-tools.exec.ts`, the post-command quota check only appended a warning when the workspace ended over quota, then still resolved the tool result with `status: "completed"` and `exitCode: outcome.exitCode ?? 0`.
- The likely reason for the double Argo/OpenClaw rollout is two separate GitHub workflows independently committing `infra/helm/values-dev.yaml` (`global.images.tag` vs `openclaw.image.tag`/`digest`), which is a separate infra hygiene issue rather than the narrow SR6 runtime blocker.

### What was completed

1. `openclaw/src/agents/bash-tools.exec.ts` now rejects non-cleanup exec commands when the post-command quota check still finds the workspace over limit or cannot verify quota, instead of returning a clean success.
2. Added focused regression coverage in `openclaw/src/agents/bash-tools.exec.workspace-quota-watch.test.ts` for the post-command over-quota failure path.
3. Updated canonical docs to keep `SR6f` truthful after the new bounded implementation pass.

### What remains

- Live repro is still required.
- The final `SR6` closure question is now narrower: confirm the same oversized write no longer surfaces as a clean success in the target environment.
- The duplicate Argo/OpenClaw rollout concern is still real, but remains outside this bounded SR6 runtime pass.

### Confirmed risks

1. This pass guarantees a non-cleanup exec no longer reports clean success after leaving the workspace over quota, but it still does not prove the process is always interrupted early enough to avoid any overshoot.
2. Cleanup commands remain intentionally more permissive so remediation still works under quota exceedance.

### Unresolved hypotheses

1. This narrower post-command hard-fail may be enough for honest `SR6` closure if the live environment now surfaces the oversized write as failed instead of successful.
2. If the live repro still looks too permissive, one more bounded runtime pass may be needed on kill timing rather than on post-command result semantics.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/workspace-quota-guard.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` remains blocked until the same oversized-write live repro is rerun after deploy.
- The Argo double-rollout issue was investigated, but it is caused by two independent gitops commits and should be handled as a separate infra hygiene slice rather than mixed into the current SR6 runtime-attribution window.

### Next recommended step

- Push the `SR6f` runtime-result hardening, let deploy finish, rerun the same oversized-write repro, and then decide whether `SR6` can finally close.

## 2026-04-06 - SR6e known file-mutation quota cache delta accounting

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6e` — Known file-mutation quota cache delta accounting

### What stale program state was fixed

1. `SR6d` was still shown as active in canon even after live evidence had already confirmed the fast oversized write now gets terminated near the quota boundary instead of completing successfully.
2. Canon still treated all sandbox file mutations as unconditional cache invalidation tails, even though the remaining honest active-path issue had shifted to avoidable post-mutation `du -sb` cost rather than another correctness gap on the same write path.

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **DU hot-path map** — identified where `du -sb` still runs on active quota paths and whether that had become the main remaining `SR6` blocker.
2. **Workspace churn map** — checked session/transcript cleanup, workspace cleanup, and archive churn to separate active-path blockers from episodic residual tails.
3. **Many-files closure check** — compared remaining many-small-files / cleanup risks and recommended the single best final bounded `SR6` pass.

### What evidence they returned

- `workspace-quota-guard.ts` still performs the real workspace measurement via cached `du -sb`, and the exec quota watch intentionally invalidates before each sample, so the hot-path cost question moved from correctness to storage amplification.
- `fs-bridge.ts` still invalidated the cache after known file mutations even when the runtime already knew the exact byte delta, which meant the next guarded read fell back to another full `du -sb` walk.
- Session/archive cleanup tails still exist, but current deployed config already enforces bounded session maintenance and the strongest remaining active-path cost seam was the avoidable re-measure immediately after known file mutations.

### What was completed

1. `openclaw/src/agents/workspace-quota-guard.ts` now exposes a bounded cache-adjust helper so known file mutations can keep cached usage aligned without a fresh full-tree scan.
2. `openclaw/src/agents/sandbox/fs-bridge.ts` now updates cached usage by exact byte delta for file overwrite, file remove, and overwrite rename; recursive/directory-shaped removals still fail safe through invalidation.
3. Added focused regression coverage in `openclaw/src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts` for the new mutation-aware cache path.
4. Updated canonical docs to truthful `SR6e` state across:
   - `docs/SCALING-READINESS-PLAN.md`
   - `docs/ROADMAP.md`
   - `docs/TEST-PLAN.md`
   - `docs/ADR/069-workspace-storage-quota-and-dind-privileged-removal.md`
   - `docs/CHANGELOG.md`

### What remains

- `SR6` still needs one honest deploy/live decision after `SR6e`.
- Remaining residual risks are now narrower:
  - periodic `du -sb` polling during long-running `exec` is still a stop-gap rather than final accounting
  - backgrounded command behavior still lacks the same level of live evidence
  - session/archive cleanup churn remains an episodic storage-cost tail, but no longer appears to be the strongest active-path blocker under the current bounded config

### Confirmed risks

1. This pass reduces avoidable `du` walks after known file mutations, but does not remove `du -sb` from the active architecture.
2. Mid-exec quota watch overshoot is still bounded by sampling, not by byte-accurate reservations.
3. Recursive deletes and directory-shaped mutations still fall back to invalidation, so some full re-measure tails remain by design.

### Unresolved hypotheses

1. Live deploy evidence may show that periodic `exec` polling cost is already acceptable after `SR6e`, allowing honest `SR6` closure.
2. If not, the only honest remaining storage tail before `SR7` may be a later redesign of `du` polling cadence/accounting rather than any new correctness gap.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/workspace-quota-guard.test.ts src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked until `SR6e` is deployed and the remaining `SR6` residual risks are checked against live behavior one more time.
- Unlike the earlier `SR6b`/`SR6d` state, the main active-path correctness blocker is no longer open in docs or code; the remaining question is whether the residual storage-cost tails are acceptable enough to close `SR6` honestly after deploy.

### Next recommended step

- Deploy `SR6e`, run one live workspace-mutation-heavy flow plus one quota-watch sanity flow, and then make the final honest `SR6` closure decision instead of opening `SR7` speculatively.

## 2026-04-06 - SR6c workspace quota measurement fail-safe semantics

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6c` — Workspace quota measurement fail-safe semantics

### What stale program state was fixed

1. `SR6b` reduced large-write burst risk, but quota measurement could still fail open when `du -sb` failed or returned malformed output.
2. Prior docs described the guard path too optimistically for that case; updated them to truthful fail-safe semantics.

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **Quota measurement failure mapper** — mapped exact `du` failure and malformed-output fail-open behavior.
2. **Next SR6 hot-path selector** — compared fail-open against other remaining SR6 tails to decide what was best to batch before one deploy.
3. **Docs truth recheck** — identified which canonical docs needed updates for another bounded SR6 pass.

### What evidence they returned

- `workspace-quota-guard.ts` returned `cached?.bytes ?? 0` on `du` failure, which could degrade guarded paths into an effectively permissive reading.
- Invalid `du` output also collapsed to `0` and could be cached as if it were valid.
- This was the best next bounded fix to batch with `SR6b`, because it directly protects the same runtime quota guard path before one deploy window.

### What was completed

1. `openclaw/src/agents/workspace-quota-guard.ts` now treats `du` failure or malformed output as measurement failure instead of silently reading `0`.
2. `openclaw/src/agents/bash-tools.exec.ts` now fails safe on unverified quota state for guarded non-cleanup commands, and terminates a running command if mid-exec quota measurement cannot be verified.
3. `openclaw/src/agents/sandbox/fs-bridge.ts` now fails safe for `writeFile` when quota cannot be measured.
4. Added focused regression coverage in:
   - `openclaw/src/agents/workspace-quota-guard.test.ts`
   - `openclaw/src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts`
   - `openclaw/src/agents/bash-tools.exec.workspace-quota-watch.test.ts`

### What remains

- `SR6` is still active and not honestly closed.
- Remaining work still includes:
  - live deploy verification for the oversized-write repro
  - measuring the cost of periodic `du -sb` checks on active paths
  - transcript/session filesystem churn and cleanup cost
  - many-small-files behavior and workspace-wide scans on hot paths

### Confirmed risks

1. This pass improves quota integrity, but does not make `du -sb` cheap.
2. Overshoot is still bounded by the polling interval rather than true kernel-level quota enforcement.
3. Backgrounded command behavior still needs live evidence before broader closure claims.

### Unresolved hypotheses

1. After deploy, the next main SR6 bottleneck may become `du -sb` polling cost itself.
2. Transcript/session churn may still dominate long-tail filesystem pressure even after quota guard hardening.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/workspace-quota-guard.test.ts src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked because `SR6` is not honestly closed yet.
- These changes make the runtime quota guard materially safer for one deploy window, but broader SR6 closure still depends on live evidence and remaining filesystem tails.

### Next recommended step

- Deploy the combined `SR6a` / `SR6b` / `SR6c` guard batch and rerun the oversized single-command write repro before touching any non-SR6 slice.

## 2026-04-06 - SR6d first-poll quota watch tightening for fast oversized writes

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6d` — First-poll quota watch tightening for fast oversized writes

### What stale program state was fixed

1. `SCALING-READINESS-PLAN.md`, `TEST-PLAN.md`, and `SESSION-HANDOFF.md` still framed the active bounded work as `SR6c`, even though new live evidence showed the open problem had moved back to the `SR6b` kill window.
2. `TEST-PLAN.md` still described the live bar as if the already-deployed stop-gap had closed the fast single-command write gap; updated to truthful post-repro wording.
3. `ADR-069` still described mid-exec watch as only a later follow-up without capturing the new first-poll blind-window evidence.

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **Quota race analysis** — mapped why one oversized command could still finish despite the deployed mid-exec watch.
2. **Tool path mapping** — checked whether the assistant could be writing through a different unguarded path instead of the intended `exec` path.
3. **Docs truth check** — identified exactly which canonical docs were now stale after the new live repro.

### What evidence they returned

- `bash-tools.exec.ts` scheduled the first mid-exec quota sample only after the full `WORKSPACE_QUOTA_WATCH_INTERVAL_MS = 2000`, leaving a blind window where a fast oversized write could complete before the first check.
- The user live repro on the deployed runtime showed truthful behavior:
  - repeated `150 MB` writes crossed the configured `700 MB` quota and then blocked follow-up commands
  - one single-command `800 MB` write still completed successfully in the same session
  - the next command then failed with `Workspace storage quota exceeded: 796.9 MB used, limit 700.0 MB. Delete files to free space.`
- The core remaining issue was still on the guarded `exec` path, not a docs-only misunderstanding and not a proven `SR7` or `SR9` concern.

### What was completed

1. `openclaw/src/agents/bash-tools.exec.ts` now performs the first post-spawn quota-watch check almost immediately instead of waiting for the full periodic interval.
2. Added focused regression coverage in `openclaw/src/agents/bash-tools.exec.workspace-quota-watch.test.ts` for the old "finishes before first poll" blind window.
3. Updated canonical docs to truthful `SR6d` state across:
   - `docs/SCALING-READINESS-PLAN.md`
   - `docs/TEST-PLAN.md`
   - `docs/ROADMAP.md`
   - `docs/ADR/069-workspace-storage-quota-and-dind-privileged-removal.md`
   - `docs/CHANGELOG.md`

### What remains

- `SR6` is still active and not honestly closed.
- Remaining work still includes:
  - live deploy verification that the same single-command oversized write is now terminated by the quota watch instead of succeeding and only blocking follow-up commands
  - measuring the cost of periodic `du -sb` checks on active paths
  - transcript/session filesystem churn and cleanup cost
  - many-small-files behavior and workspace-wide scans on hot paths

### Confirmed risks

1. This remains a stop-gap based on `du -sb` polling, not true kernel-level quota enforcement.
2. Overshoot is still bounded by the first sample plus the polling interval rather than by byte-accurate reservations.
3. Backgrounded command behavior still needs separate live evidence before broader closure claims.

### Unresolved hypotheses

1. After this first-poll tightening, the next dominant `SR6` bottleneck may become `du -sb` cost itself rather than the fast-write blind window.
2. Session/transcript churn may still dominate long-tail filesystem pressure even after this pass.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/workspace-quota-guard.test.ts src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked because `SR6` is not honestly closed yet.
- The new live repro proved the previously deployed stop-gap was still insufficient for one fast oversized write, so another bounded `SR6` pass was required before any next-slice claim.

### Next recommended step

- Deploy `SR6d`, rerun the exact single-command oversized write repro in the target environment, and only then decide whether the active `SR6` blocker has actually moved away from the `exec` kill window.

## 2026-04-06 - SR6b mid-exec workspace quota watch

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6b` — Mid-exec workspace quota watch for large-write bursts

### What stale program state was fixed

1. New live evidence showed a single command could still grow workspace storage by ~17 GB in one session, so prior docs language implying the burst window was already closed became too strong.
2. `SCALING-READINESS-PLAN.md`, `TEST-PLAN.md`, `ROADMAP.md`, `ADR-069`, `CHANGELOG.md`, and `SESSION-HANDOFF.md` were updated to reflect the truthful state: `SR6` is still active and required another bounded pass.

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **Exec kill-path mapper** — identified the safest bounded place to monitor and terminate a running `exec`.
2. **Quota burst-gap mapper** — verified exactly why a single command could still write multi-GB data before quota enforcement reacted.
3. **SR6 boundary recheck** — confirmed the 17 GB burst issue is still `SR6`, not `SR7` or `SR9`, unless later evidence shows concurrent billing semantics are involved.

### What evidence they returned

- `bash-tools.exec.ts` only checked quota before spawn and after exit; the post-check only warned.
- A running `exec` already had a safe kill path via `runExecProcess(...).kill()` -> supervisor cancellation -> `SIGKILL`.
- Existing docs overclaimed by implying the burst-write window was already closed, even though a single command could still overrun quota before exit.

### What was completed

1. Added a bounded mid-exec quota watch in `openclaw/src/agents/bash-tools.exec.ts` for non-cleanup commands.
2. When periodic checks detect workspace usage above quota during a running command, the process is terminated to stop further workspace growth.
3. Cleanup commands still bypass this kill path so over-quota remediation remains possible.
4. Added focused OpenClaw regression coverage in `openclaw/src/agents/bash-tools.exec.workspace-quota-watch.test.ts`.
5. Updated canonical docs to truthful `SR6b` state and corrected prior over-strong quota wording.

### What remains

- `SR6` is still active and not honestly closed.
- Remaining storage/workspace work still includes:
  - validating this fix against the real oversized-write repro in a live environment
  - reducing the cost of periodic `du -sb` checks on active paths
  - session/transcript filesystem churn and cleanup cost
  - many-small-files behavior and workspace-wide scans on hot paths

### Confirmed risks

1. This is a stop-gap: periodic `du -sb` polling limits growth but is not the final storage enforcement architecture.
2. A command can still overshoot by the amount written between quota-watch polls.
3. Backgrounded commands are not proven bounded by the same live enforcement path yet.

### Unresolved hypotheses

1. The next dominant `SR6` bottleneck may still be `du -sb` cost itself rather than the write burst.
2. Session/transcript churn may still be a larger long-tail filesystem cost than large-file bursts once this path is deployed.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/bash-tools.exec.workspace-quota-watch.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked because `SR6` is not honestly closed yet.
- Even after this bounded `SR6b` fix, broader FUSE/churn/cleanup evidence for `SR6` closure is still missing.

### Next recommended step

- Deploy this `SR6b` fix and rerun the oversized single-command write repro in the target environment; do not open `SR7` unless that live check passes and the remaining `SR6` tails are honestly reduced.

## 2026-04-06 - SR6a workspace quota cache invalidation parity

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6c` — Workspace quota measurement fail-safe semantics

### What stale program state was fixed

1. `SESSION-HANDOFF.md` still had a stale footer marker at `SR0` / `SR1`; updated to truthful `SR6` / `SR6a` / `SR7`.
2. `SCALING-READINESS-PLAN.md` wording for `SR6` mixed filesystem quota-enforcement cost with broader quota correctness; clarified `SR6` vs `SR7` / `SR9` boundaries.
3. `ADR-069` still described cache invalidation as write/exec-only even though `SR6` evidence showed the missing `remove` / `rename` parity tail.

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **Storage/workspace path mapper** — mapped where assistant workspaces, sessions, transcripts, media, and OpenClaw state actually live.
2. **Cleanup/quota hot-path mapper** — found active-path filesystem amplification around quota checks, cleanup, and transcript/session churn.
3. **SR6 scope separator** — prevented this pass from drifting into `SR7` media redesign or `SR9` quota/billing correctness.

### What evidence they returned

- PersAI assistant workspaces and OpenClaw state both land on the same GCS FUSE-backed bucket prefix in dev, but use different subtrees.
- Sandbox `writeFile` invalidated the workspace quota cache, while sandbox `remove` / `rename` did not.
- That gap could leave a stale over-quota reading after files were deleted or atomically replaced through the filesystem bridge.
- The broader remaining `SR6` risks are still `du -sb` pressure on active exec paths, session/transcript file churn, cleanup scans, and many-small-files growth.

### What was completed

1. `openclaw/src/agents/sandbox/fs-bridge.ts` now invalidates the workspace quota cache after successful sandbox `remove` and `rename`, matching `writeFile`.
2. Added focused OpenClaw regression coverage in `openclaw/src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`.
3. Updated canonical docs for truthful `SR6` state and boundaries:
   - `docs/SCALING-READINESS-PLAN.md`
   - `docs/ROADMAP.md`
   - `docs/TEST-PLAN.md`
   - `docs/ADR/069-workspace-storage-quota-and-dind-privileged-removal.md`
   - `docs/SESSION-HANDOFF.md`

### What remains

- `SR6` remains active.
- Next storage/workspace passes still need evidence and possible fixes for:
  - `du -sb` amplification on active exec paths
  - session/transcript filesystem churn and cleanup cost
  - many-small-files behavior under workspace/media growth
  - workspace-wide `readdir` patterns on hot paths

### Confirmed risks

1. This pass fixes one stale-cache tail, not the underlying cost of `du -sb` on GCS FUSE.
2. Session/transcript persistence still uses small-file patterns that may remain expensive under churn.

### Unresolved hypotheses

1. The next dominant `SR6` cost center may be the post-exec forced `du` refresh in `bash-tools.exec.ts`.
2. Workspace-wide scans such as avatar/path cleanup may become material before transcript append cost does.

### Verification run

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/bash-tools.exec.workspace-quota-cleanup.test.ts src/agents/sandbox/fs-bridge.workspace-quota-cache.test.ts`

### Why the next SR is still blocked or can be opened

- `SR7` is still blocked because `SR6` is not honestly closed yet.
- This session only closed one bounded `SR6a` amplification seam; broader FUSE/churn/cleanup behavior still needs more `SR6` evidence and fixes.

### Next recommended step

- Stay in `SR6` and take the next bounded pass on active-path `du -sb` amplification versus transcript/session filesystem churn; do not open `SR7` yet.

## 2026-04-06 - SR5a sandbox startup path optimization

### Active slice after this session

- `SR6` — Storage and workspace path hardening
- `SR5` closed: sandbox startup optimized (SR5a), dind contention measured (SR5b), cross-pool isolation confirmed

### What stale program state was fixed

1. `SCALING-READINESS-PLAN.md` active-state marker was stale at `SR2` — updated to `SR5` active, `SR6` next, `SR4` last closed.
2. `ROADMAP.md` active-state marker was stale at `SR2` — updated to match truthful post-SR4 state.
3. Both docs now carry the honest post-SR4 baseline (single_replica contract, Recreate rollout, multi-replica unsupported, active-turn lane ceiling).

### What subagents were launched and why

Three readonly evidence-gathering subagents:

1. **Sandbox startup path mapper** — mapped the full startup timeline from container start to `/readyz` in OpenClaw fork. Key finding: sequential `docker pull`, no retry, no progress logging.
2. **Helm sandbox pool config mapper** — mapped all pool definitions, dind sidecar config, probes, resources, rollout strategy. Key finding: startupProbe budget = 900s, dind has no probes, all three dev pools use Recreate + sandbox preload.
3. **Sandbox image preload implementation mapper** — mapped preload script, registry auth, dind socket wait, sandbox session lifecycle. Key finding: preload is Helm-only shell wrapper, two sequential pulls into dind daemon store, no caching between restarts.

### What evidence they returned

- Startup path is fully sequential: dind start → socket poll (≤180s) → metadata token → docker login → pull #1 → pull #2 → exec gateway → HTTP listen → readiness.
- Two `docker pull` commands are independent — parallelizable.
- No retry on pull failure — container restarts from scratch.
- No operational logging during preload — silent until gateway starts or fails.
- `startupProbe` allows up to 900s (180 × 5s) before Kubernetes kills the startup.
- Recreate strategy means full downtime during pod replacement — reducing preload time directly reduces deploy gap.

### What was completed

1. **Parallel docker pulls**: both `SANDBOX_BASE_IMAGE` and `SANDBOX_COMMON_IMAGE` now pull concurrently via `&` + `wait` in the preload shell script.
2. **Bounded retry with backoff**: each pull retries up to `preloadPullRetries` (default 3) with 5s backoff between attempts, instead of immediate container crash.
3. **Timestamped progress logging**: `[sandbox-preload]` log markers at socket wait, token acquisition, GAR login, pull start/completion, and gateway start.
4. **Configurable retry count**: new `sandboxRuntime.preloadPullRetries` Helm value (default 3).
5. **Docs alignment**: SCALING-READINESS-PLAN, ROADMAP, TEST-PLAN, SESSION-HANDOFF all updated to truthful post-SR4 state with SR5 active.
6. **SR5a sub-slice defined** in SCALING-READINESS-PLAN with full template (outcome, scope, out-of-scope, evidence, verification, rollback, exit criteria).

### What remains

Inside SR5 (later sub-slices):
- `SR5b`: dind contention and sandbox session concurrency caps under burst
- `SR5c`: per-tier sandbox concurrency assumptions and predictable degradation documentation
- `SR5d`: startupProbe budget tightening after Tier 2 measurement of actual startup times
- `SR5e`: dind sidecar probe addition (requires measuring dind startup variance)

Outside SR5 (later slices):
- `SR6`: storage/workspace path redesign, GCS FUSE pressure
- `SR7`: media pipeline redesign
- `SR8`: webhook/realtime burst fan-in
- `SR9`: billing/quota concurrency correctness
- `SR10`: final capacity validation and prod gate

### Confirmed risks

1. Parallel `docker pull` with `&` + `wait` requires `/bin/sh` job control — this is standard POSIX and works in the `docker:dind-rootless` image's shell environment, but has not been validated on a live cluster yet (Tier 2 pending).
2. Retry count of 3 means a permanently broken registry will delay container death by ~30s (3 attempts × 2 images × 5s backoff worst case) before `set -eu` exits the script.

### Unresolved hypotheses

1. **Actual wall-clock improvement from parallel pulls**: plausible hypothesis is ~40-60% reduction in pull phase (depends on bandwidth vs latency), but requires Tier 2 measurement.
2. **dind startup time variance**: unknown whether dind sidecar readiness is the dominant wait or the image pulls are — requires operational measurement.

### Verification run

- `Tier 0` checks passed:
  - `helm template` renders cleanly for both `values.yaml` and `values-dev.yaml`
  - `runtime-pools:readiness:strict` gate passes
  - all three sandbox-capable dev pools render the parallel pull + retry script with correct retry count
- `Tier 2` deploy smoke passed (2026-04-06):
  - ArgoCD auto-synced after push, fresh pod rollout for all 3 sandbox pools
  - all pods reached 3/3 Ready, zero restarts
  - `[sandbox-preload]` logs confirmed parallel pull behavior with interleaved layer downloads
  - measured startup times (container start → gateway start):
    - `paid_isolated` (separate node): **~7m46s** (socket 5s, token+login 2s, parallel pulls 7m39s)
    - `free_shared_sandbox` (shared node): **~10m25s** (socket 6s, token+login 2s, parallel pulls 10m17s)
    - `paid_shared_sandbox` (shared node): **~10m25s** (socket 6s, token+login 2s, parallel pulls 10m17s)
  - retry was not triggered — all pulls succeeded on attempt 1
  - estimated sequential baseline would be ~13-17 min → parallel saves **~5-7 min** per deploy
  - shared-node pools are slower due to bandwidth contention between 2 pods on the same node

### Why SR6 is still blocked

SR5 is not closed. SR5a is closed (Tier 2 confirmed). Remaining SR5 sub-slices cover dind contention, sandbox concurrency caps, and degradation behavior. SR6 cannot open until SR5 is honestly closed.

### SR5b — dind contention baseline (completed same session)

Controlled stress test: 4× concurrent `python3 sum(i*i for i in range(10**8))` on all three sandbox pools.

Results:
- `free_shared_restricted_sandbox` (dind 1 core): saturated at 741-1000m, ~4× slowdown, pod stable
- `paid_shared_restricted_sandbox` (dind 1 core): saturated at 1001m, ~4× slowdown, pod stable
- `paid_isolated` (dind 2 cores): saturated at 2000m, ~2× slowdown, pod stable, completes ~2× faster
- RAM is not the constraint — 70-90% headroom on all tiers
- degradation is linear and predictable, not crash/OOM
- pod readiness never lost during sustained saturation, 0 restarts across all pools
- `docker stats` CPU% inside rootless dind is unreliable — use `kubectl top` for honest metrics

### Cross-pool isolation test (completed same session)

Stressed free pool with 4× concurrent CPU-bound sandbox exec while paid pools idle:
- `free_shared` dind: 712m CPU (saturating) — working as expected
- `paid_shared` dind: 3m CPU — completely unaffected
- `paid_isolated` dind: 2m CPU — completely unaffected
- All pods Ready, 0 restarts throughout
- Isolation confirmed: separate nodes, separate dind sidecars, separate cgroup limits

### SR5 closure verdict

SR5 exit criteria met: "sandbox-heavy bursts degrade predictably and do not destabilize unrelated tiers"
- SR5a: startup path optimized, ~5-7 min deploy-gap reduction confirmed
- SR5b: per-tier dind contention measured, linear degradation proven, pod stability confirmed
- Cross-pool isolation verified under sustained single-pool stress

Accepted known risks carried forward:
- dind CPU limits are product/cost decisions — current limits adequate for current user count
- sandbox session GC/TTL not stress-tested (5 min hot container window)
- IO-bound sandbox workloads not tested (CPU-bound only)
- node co-location re-introduces bandwidth contention during pulls (~2.5 min extra)

### Next recommended step

- `SR5` is closed. `SR6` — Storage and workspace path hardening is now the active slice.
- SR6 scope: GCS FUSE pressure, many-small-files behavior, cleanup cost, workspace quota cost, session/transcript FS behavior.

---

## 2026-04-05 - SR4 production decision gate

### Active slice after this session

- `SR5` — Sandbox and dind capacity hardening

### Final SR4 verdict

1. `SR4` can close honestly as the runtime production baseline for the current OpenClaw model.
2. The supported production path is now explicit and enforced:
   - PersAI/OpenClaw runtime mode is `single_replica`
   - one pod per runtime pool only
   - rollout overlap is blocked with `Recreate`
   - multi-replica session mode is explicitly unsupported at readiness, startup, and deploy/render layers
3. The architectural ceiling is also explicit:
   - the first single-replica throughput ceiling is the shared global active-turn lane, especially `main`
   - cache-backed prep was already moved out of that lane where safe
   - the remaining lane-held work is tied to process-global/runtime-mutating behavior, so reducing it further would require changing the runtime ownership/concurrency model rather than another bounded local fix

### What is now considered the SR4 production baseline

- OpenClaw is acceptable only as a single-replica runtime base per pool.
- This baseline is a deliberate bounded contract, not proof of horizontal session-safe scaling.
- Queue saturation on the shared global active-turn lane is now a known runtime limit and operational signal, not an unresolved hidden assumption.
- PersAI now pins the approved OpenClaw fork and dev image tag to `7cb2c4b360a57b4523d775b67b11a11189fbe9bb` for this closed `SR4` baseline.

### What leaves SR4 and moves to later slices

- `SR5` — sandbox/dind startup and heavy sandbox throughput ceilings
- `SR6` — workspace/storage path and filesystem pressure ceilings
- `SR8` — webhook/realtime burst fan-in against the now-explicit single-replica runtime
- `SR10` — target-tier capacity validation and final production gate evidence

## 2026-04-05 - SR4 single-replica throughput ceiling baseline

### Active slice after this session

- `SR4` — OpenClaw runtime throughput and multi-replica correctness

### What was completed

1. Took the next bounded `SR4` pass on the supported single-replica runtime path itself.
2. Confirmed the first practical single-replica throughput ceiling is not a hidden multi-pod seam anymore, but the in-process active-turn lane:
   - `runEmbeddedPiAgent(...)` still serializes each session on its own `session:` lane
   - every active turn also consumes a shared global lane slot for the full run lifetime
   - the default `main` lane capacity remains `agents.defaults.maxConcurrent = 4`
   - once those slots are occupied, additional turns queue behind the same single gateway process
3. Checked nearby candidates and did not find a smaller safe bottleneck fix than this queue/capacity seam:
   - `models.json` preparation is already cached/serialized
   - runtime plugin loading is cache-backed
   - per-session transcript/workspace writes remain important cost centers, but they did not displace the global active-turn cap as the first obvious ceiling
4. Added one narrow operational improvement without changing the runtime model:
   - when an active turn waits for global lane capacity, OpenClaw now emits an explicit `[throughput-backpressure]` warning with lane, wait time, queue depth, and effective `maxConcurrent`
   - this makes single-replica saturation visible as a named runtime signal instead of only a generic queue warning
5. Took one more bounded pass on lane hold time itself:
   - moved cache-backed pre-global prep (`resolveRunWorkspaceDir(...)`, fallback detection, `resolveOpenClawAgentDir()`, `ensureOpenClawModelsJson(...)`) out of the shared global lane
   - kept global-mutating work inside the lane, including runtime plugin activation, hook/model resolution, auth/runtime mutation, `process.chdir(...)`, skill env overrides, and the actual active run lifecycle
   - this shortens global-lane occupancy a bit without changing session ownership or queue semantics

### What is now confirmed

- The nearest single-replica ceiling is the shared global active-turn lane, especially `main`.
- The global lane is still held by the real run body, but no longer by the cache-backed model/workspace prep that can safely happen earlier.
- This is a bounded concurrency ceiling, not proof that the pool can safely scale to arbitrary active turns by config alone.
- No honest local change in this pass removed that ceiling without changing the runtime ownership/concurrency model.

### What remains inside SR4

- `SR4` stays active.
- The next bounded question is whether one more narrow pass can reduce the time each active turn holds a global lane slot, or whether the remaining ceiling is now honest enough to treat as the runtime limit for the current model.

### Metrics / checks completed

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/pi-embedded-runner.run-queue-wait.test.ts`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run src/agents/pi-embedded-runner.run-global-lane-prep.test.ts src/agents/pi-embedded-runner.run-queue-wait.test.ts`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`

## 2026-04-05 - SR4 deploy/runtime prohibition baseline

### Active slice after this session

- `SR4` — OpenClaw runtime throughput and multi-replica correctness

### What was completed

1. Took the next bounded `SR4` pass on deploy/runtime contract enforcement rather than another exploratory runtime note.
2. Confirmed there is still no honest multi-replica session-safe path in current OpenClaw runtime code:
   - session ordering is still process-local
   - restart/drain remains per process only
   - active run ownership is still in-memory and not recovered after process restart
   - Redis-backed spec storage plus shared workspace mount still do not prove distributed session ownership
3. Converted that truth into enforcement instead of readiness-only warning:
   - OpenClaw startup now fails fast if `PERSAI_RUNTIME_READINESS_MODE=multi_replica` is declared
   - PersAI Helm render now fails if an OpenClaw runtime pool declares anything except `single_replica`
   - PersAI Helm render now fails if an OpenClaw runtime pool sets `replicaCount != 1` or enables autoscaling
   - PersAI Helm render now also fails if an OpenClaw runtime pool declares a rollout strategy other than `Recreate` or keeps `rollingUpdate` overlap settings that could create a second pod during update
4. Made the supported bounded path explicit in canonical PersAI values:
   - `PERSAI_RUNTIME_READINESS_MODE: "single_replica"`
   - one pod per runtime pool remains the only supported contract
   - OpenClaw rollout strategy is now `Recreate`, so update-time overlap cannot silently violate that contract

### What is now confirmed

- The only currently enforceable bounded-safe path is `single_replica` with one OpenClaw pod per runtime pool.
- That supported path now includes non-overlapping rollout semantics, not just steady-state replica count.
- This is an operational contract only, not proof of future multi-replica runtime correctness.
- Multi-replica session mode is now explicitly unsupported at both startup and deploy/render layers instead of merely surfacing as readiness-only red.

### What remains inside SR4

- `SR4` stays active.
- The next key runtime question is no longer "can operators accidentally deploy unsupported multi-replica mode?".
- The next bounded piece is whether there is any narrow throughput/capacity seam left that can be improved without distributed session-ownership redesign.

### Metrics / checks completed

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run --config vitest.gateway.config.ts src/gateway/server/readiness.test.ts src/gateway/server-http.probe.test.ts`
- `helm template persai . -f values.yaml`
- `helm template persai . -f values-dev.yaml`

## 2026-04-05 - SR4 session continuity ceiling baseline

### Active slice after this session

- `SR4` — OpenClaw runtime throughput and multi-replica correctness

### What was completed

1. Took the next bounded `SR4` pass on the runtime session continuity / execution-ordering seam itself.
2. Confirmed from the OpenClaw runtime code that multi-replica session correctness is still not proven:
   - runtime session state lives in per-host `sessions.json` + transcript files
   - command/session lane ownership is process-local in the in-memory command queue
   - drain/restart logic is per process only and does not hand active session ownership to another pod
   - Redis-backed apply/spec storage only shares apply metadata, not full session continuity
3. Tightened the runtime contract again to remove false-positive cluster claims:
   - in PersAI runtime `multi_replica` mode, readiness now stays `not ready` even with Redis-backed spec storage
   - readiness explicitly surfaces that multi-replica session correctness is not yet supported, because session store, workspace continuity, and execution ordering are not cluster-proven by code
4. This keeps the slice bounded:
   - no distributed queue redesign
   - no OpenClaw runtime architecture rewrite
   - no PersAI API refactor

### What is now confirmed

- OpenClaw is not yet proven as a bounded multi-replica runtime for PersAI sessions.
- `PERSAI_RUNTIME_SPEC_STORE=redis` remains necessary, but it still only covers applied-spec metadata.
- The session continuity blocker is now confirmed more concretely:
  - one `sessionKey` can still be executed concurrently on different pods because lane ownership is process-local
  - session transcripts and session store remain per-host persistence unless a broader runtime redesign changes that contract
  - restart/drain behavior does not transfer an active runtime session turn safely across replicas

### What remains inside SR4

- `SR4` stays active.
- The next key bounded piece is to decide whether there is any genuinely bounded single-session safety path available without a queue/runtime redesign:
  - either one honest pod-affinity / single-owner path that is enforceable by contract
  - or explicit deploy/runtime prohibition of PersAI multi-replica session mode until distributed session ownership exists

### Metrics / checks completed

- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec tsc --noEmit`
- `corepack pnpm --dir "C:\Users\alex\Documents\openclaw" exec vitest run --config vitest.gateway.config.ts src/gateway/server/readiness.test.ts src/gateway/server-http.probe.test.ts`

## 2026-04-05 - SR3e distributed abuse counter closing pass

### Active slice after this session

- `SR4` — OpenClaw runtime throughput and multi-replica correctness

### What was completed

1. Closed the last clearly localized `SR3` API distributed abuse-correctness gap.
2. `EnforceAbuseRateLimitService` no longer updates user-level and assistant-level abuse counters through `find -> compute -> upsert` outside a contention-safe boundary:
   - added repository-level `registerDistributedAttempt(...)`
   - moved the touched abuse counter registration path into a serializable Postgres transaction with retry on `P2034`
3. This means the shared abuse counters for `assistantId + userId + surface` and `assistantId + surface` no longer silently lose increments under burst/multi-replica contention.
4. Kept the slice bounded:
   - no Redis/platform-wide rate-limit redesign
   - no OpenClaw/runtime redesign
   - no broad API refactor beyond the touched abuse-control seam

### Can SR3 close after this?

- Yes.
- `SR3` can now close honestly as the API concurrency/dependency hardening baseline:
  - chat bootstrap no longer relies on single-winner `find -> create`
  - adapter preflight no longer amplifies burst-time dependency pressure
  - duplicate in-process Prisma client pressure is removed
  - touched abuse/rate-limit counters no longer rely on process-local memory or racy distributed `find -> compute -> upsert`
- Remaining scale/distributed concerns now sit outside `SR3` and belong to later slices:
  - OpenClaw runtime throughput / multi-replica correctness in `SR4`
  - broader capacity validation / production gates in later slices

### Confirmed risks

- Closing `SR3` does not prove OpenClaw runtime distributed correctness or queue semantics.
- Closing `SR3` does not by itself prove target-environment capacity; that remains for later validation slices.
- Shared Postgres remains a direct dependency for the touched abuse-control source of truth.

### Metrics / checks completed

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/prisma-assistant-abuse-guard.repository.test.ts`

### Next recommended step

- Close `SR3` and move to `SR4` — OpenClaw runtime throughput and multi-replica correctness.

## 2026-04-05 - SR3d distributed peer abuse baseline

### Active slice after this session

- `SR3` — API concurrency and dependency hardening

### What was completed

1. Closed the next bounded `SR3` distributed abuse-correctness risk on the touched inbound peer-throttle path.
2. `EnforceAbuseRateLimitService` no longer keeps `peerKey` abuse windows only in process-local memory:
   - added persisted `assistant_abuse_peer_states`
   - replaced the in-memory peer `Map` path with repository-backed atomic peer attempt registration
3. This means the touched `assistantId + surface + peerKey` throttle window now survives API service-instance boundaries instead of silently resetting when the next request lands on another replica.
4. Kept the slice bounded:
   - no Redis/platform-wide rate-limit redesign
   - no OpenClaw/runtime architecture changes
   - no broader abuse-policy rewrite

### What remains inside SR3

- `SR3` is still active.
- Next likely narrow API-side risks inside `SR3`:
  - any remaining abuse/rate-limit paths that still rely on non-distributed assumptions outside the touched peer path
  - any remaining adapter/request timeout or backpressure edges outside the already-hardened preflight path
  - broader DB/query pressure under burst once the most obvious process-local assumptions are removed

### Confirmed risks

- The touched peer abuse path is no longer process-local only, but this does not yet prove every abuse-control decision is fully distributed across all API surfaces.
- Shared Postgres is now the source of truth for the touched peer window, so DB health/latency now matters directly for that bounded guard path.
- OpenClaw multi-replica correctness remains outside `SR3`.

### Metrics / checks still required

- Completed for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/admin-delete-user.service.test.ts`

### Next recommended step

- Stay inside `SR3` and take the next narrow API correctness slice: another remaining abuse/rate-limit distributed gap, or a bounded timeout/backpressure edge outside the already-hardened preflight path.

## 2026-04-05 - SR3c shared Prisma client baseline

### Active slice after this session

- `SR3` — API concurrency and dependency hardening

### What was completed

1. Closed the next bounded `SR3` DB/process-pressure risk inside the API process.
2. Identity-access and workspace-management no longer open separate `PrismaClient` instances for the same API process:
   - `PrismaService` is now exported from `IdentityAccessModule`
   - `WorkspaceManagementPrismaService` is now an alias token to the shared `PrismaService` singleton
3. This removes one concrete source of connection-pool fragmentation and duplicate process-local DB pressure without changing the higher-level repository/service contracts.
4. Kept the slice narrow:
   - no ORM-wide refactor
   - no schema changes
   - no runtime/OpenClaw redesign

### What remains inside SR3

- `SR3` is still active.
- Next likely narrow API-side risks inside `SR3`:
  - distributed abuse/rate-limit correctness beyond process-local memory
  - any remaining adapter/request timeout or backpressure edges outside the already-hardened preflight path
  - broader DB/query pressure once pool fragmentation is no longer doubled by two local Prisma clients

### Confirmed risks

- One duplicate Prisma client/pool inside the API process is gone, but this does not by itself prove safe DB behavior under burst.
- In-memory peer abuse throttling remains process-local and is not yet a distributed guarantee across replicas.
- OpenClaw multi-replica correctness remains outside `SR3`.

### Metrics / checks still required

- Completed for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/prisma-service-sharing.test.ts`

### Next recommended step

- Stay inside `SR3` and take the next narrow API concurrency slice: distributed abuse/rate-limit correctness or another bounded pressure path.

## 2026-04-05 - SR3b adapter preflight pressure hardening

### Active slice after this session

- `SR3` — API concurrency and dependency hardening

### What was completed

1. Closed the next bounded `SR3` dependency/backpressure risk inside the API-side OpenClaw adapter path.
2. `OpenClawRuntimeAdapter.preflight(...)` no longer re-runs `/healthz` + `/readyz` on every burst-adjacent API call:
   - added short TTL cache (`5s`)
   - added in-flight dedup per runtime tier
3. Added cache invalidation when a runtime-side request fails in a way that makes the cached readiness suspect:
   - `runtime_unreachable`
   - `timeout`
   - `runtime_degraded`
   - `invalid_response`
4. Kept the slice bounded:
   - no OpenClaw redesign
   - no queue/runtime distributed changes
   - no Prisma/data-layer refactor

### What remains inside SR3

- `SR3` is still active.
- Next likely narrow API-side risks inside `SR3`:
  - DB pool strategy / Prisma client process assumptions
  - distributed abuse/rate-limit correctness beyond process-local memory
  - any remaining long-request timeout/backpressure edges outside the preflight path itself

### Confirmed risks

- Adapter preflight no longer amplifies dependency pressure linearly with every nearby runtime call in the touched window, but the API still lacks a broader DB pool strategy slice.
- In-memory peer abuse throttling remains process-local and is not yet a distributed guarantee across replicas.
- OpenClaw multi-replica correctness remains outside `SR3`.

### Metrics / checks still required

- Completed for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/openclaw-runtime-adapter.test.ts`

### Next recommended step

- Stay inside `SR3` and take the next narrow API concurrency slice: DB pool / Prisma process assumptions, or distributed abuse guard correctness.

## 2026-04-05 - SR3 thread-creation race hardening

### Active slice after this session

- `SR3` — API concurrency and dependency hardening

### What was completed

1. Closed the first bounded `SR3` API concurrency risk around chat-thread creation under burst and multi-replica operation.
2. Added an atomic repository seam:
   - `AssistantChatRepository.findOrCreateChatBySurfaceThread(...)`
   - Prisma implementation now treats `P2002` unique-key races as an expected concurrent-create case and falls back to the already-created row instead of assuming one process/thread wins cleanly.
3. Switched the burst-sensitive API paths that previously did `find -> create` to the new atomic path:
   - web inbound turn prepare
   - staged web attachment/chat bootstrap
   - internal Telegram turn attachment bootstrap
   - reminder web fallback delivery
4. Kept the slice narrow:
   - no DB pool redesign
   - no OpenClaw runtime redesign
   - no queue / Redis / cron architecture changes

### What remains inside SR3

- `SR3` is still active.
- Next likely narrow API-side risks inside `SR3`:
  - DB pool strategy and Prisma-client/process assumptions
  - OpenClaw adapter timeout / backpressure behavior on long or degraded runtime calls
  - distributed abuse/rate-limit correctness beyond single-process in-memory guards

### Confirmed risks

- Chat-thread creation no longer depends on a hidden single-process assumption for the touched paths, but other API concurrency surfaces still exist.
- In-memory peer abuse throttling remains process-local and is not yet a distributed correctness guarantee across replicas.
- OpenClaw multi-replica correctness remains outside `SR3`.

### Metrics / checks still required

- Completed for this sub-slice:
  - `corepack pnpm --filter @persai/api run typecheck`
  - `corepack pnpm --filter @persai/api exec tsx test/stream-web-chat-turn.service.test.ts`
  - `corepack pnpm --filter @persai/api exec tsx test/handle-internal-cron-fire.test.ts`

### Next recommended step

- Stay inside `SR3` and take the next narrow API concurrency slice: DB/dependency pressure and timeout behavior under burst.

## 2026-04-05 - SR2 closure baseline

### Active slice after this session

- `SR3` — API concurrency and dependency hardening

### What was completed

1. Closed the infra-only `SR2` baseline around explicit workload rollout/disruption truth:
   - `api` now has the same first bounded disruption/placement baseline as `web`
   - both `api` and `web` now run with:
     - `replicaCount: 2`
     - `PodDisruptionBudget` enabled with `minAvailable: 1`
     - topology spread across hostname and zone using `ScheduleAnyway`
2. Kept `autoscaling` explicit but disabled for `api`, `web`, and OpenClaw:
   - the Helm truth now shows where HPA belongs
   - but `SR2` does not pretend CPU/memory HPA policy is proven before request-path/runtime evidence exists
3. Kept OpenClaw inside honest `SR2` scope only:
   - runtime pools remain topology/config ready
   - OpenClaw is still **not** declared multi-replica safe
   - distributed runtime correctness remains outside `SR2`
4. `SR2` is now closeable as an infra baseline slice:
   - rollout strategy, disruption baseline, placement baseline, and autoscaling assumptions are explicit
   - base/dev chart truth is internally consistent
   - the next unresolved risk domain is no longer infra defaults, but API/runtime correctness under concurrency

### What remains after SR2

- `SR3` — API concurrency and dependency hardening

### Confirmed risks

- `SR2` only closes the infra baseline. It does **not** prove API burst behavior, DB pool behavior, webhook fan-in safety, or other concurrency semantics.
- OpenClaw multi-replica correctness remains unproven and stays outside `SR2`.
- HPA remains intentionally disabled until later slices provide evidence that request-path behavior and autoscaling policy match real runtime characteristics.

### Metrics / checks still required

- `SR2` completion evidence for this closing pass:
  - `helm template` for base and dev values
  - `corepack pnpm run runtime-pools:readiness:strict`
- Future slices need their own verification:
  - `SR3` for API concurrency/dependency behavior under multi-replica operation
  - later runtime slices for OpenClaw throughput and distributed correctness

### Next recommended step

- Close `SR2` and open `SR3` — API concurrency and dependency hardening.

## 2026-04-05 - SR2b first disruption / placement baseline

### Active slice after this session

- `SR2` — GKE production baseline

### What was completed

1. Turned the `web` workload into the first honest `SR2` disruption/placement baseline:
   - `replicaCount: 2`
   - `PodDisruptionBudget` enabled with `minAvailable: 1`
   - topology spread enabled across hostname and zone using `ScheduleAnyway`
2. Kept `autoscaling` explicit but still disabled for `web`:
   - the chart now clearly shows the intended HPA seam
   - but `SR2b` does not pretend CPU/memory-based HPA policy is proven without target-environment evidence
3. Intentionally did **not** enable the same baseline for `api` or OpenClaw pools yet:
   - `api` still has infra dependencies and request-path risk that should not be masked by a cosmetic multi-replica claim before target-environment rollout evidence
   - OpenClaw multi-replica correctness remains outside `SR2`; infra config must not imply runtime distributed safety that has not been proven

### What remains inside SR2

- `SR2` is still not closed.
- One final narrow infra piece remains:
  - decide and validate the honest target-environment baseline for `api` disruption behavior
  - keep OpenClaw explicitly outside multi-replica safety claims while still documenting the runtime-pool rollout expectation
  - collect deploy-smoke and observation-window evidence for the now-enabled `web` baseline plus the final `api` decision

### Confirmed risks

- `web` now has the first real disruption/placement baseline, but it still needs target-environment rollout and observation evidence before it counts as accepted production proof.
- `api` still lacks an enabled disruption/placement baseline, so full `SR2` closure is blocked on the final API-side infra decision and verification.
- OpenClaw infra remains pool-aware, but that must not be misread as proof of safe multi-replica runtime semantics.

### Metrics / checks still required

- `Tier 0` completed for this sub-slice:
  - `helm template` for base and dev values
  - `corepack pnpm run runtime-pools:readiness:strict`
- Still required before `SR2` can close:
  - `Tier 2` target-environment smoke for `web` rollout/disruption behavior
  - `Tier 3` observation window for `web` readiness/restarts/rollout health
  - the final `api` disruption baseline decision plus the same smoke/observation evidence

### Next recommended step

- Stay inside `SR2` and land the final narrow infra piece: the honest `api` disruption baseline decision plus target-environment validation for `web` and `api`.

## 2026-04-05 - SR2 workload rollout baseline

### Active slice after this session

- `SR2` — GKE production baseline

### What was completed

1. Made the Helm workload baseline explicit for `api`, `web`, and OpenClaw runtime pools instead of relying on implicit Kubernetes defaults:
   - explicit `revisionHistoryLimit`
   - explicit `minReadySeconds`
   - explicit rolling-update strategy (`maxUnavailable: 0`, `maxSurge: 1`)
   - explicit container `resources`
2. Added the chart seams for the next controlled SR2 infra moves without enabling them by default:
   - workload `autoscaling` sections
   - workload `podDisruptionBudget` sections
   - workload `topologySpreadConstraints` sections
   - dedicated Helm templates for `HorizontalPodAutoscaler` and `PodDisruptionBudget`
3. Kept the slice bounded and honest:
   - no application concurrency changes
   - no OpenClaw distributed-correctness claims
   - no queue / Redis / cron redesign
4. Fixed one existing chart-truth inconsistency discovered during SR2 validation:
   - base `infra/helm/values.yaml` did not define `ingress`, but multiple templates already expected `.Values.ingress.enabled`
   - added explicit base `ingress` defaults so the base chart now renders cleanly

### What remains inside SR2

- `SR2` is not closed yet.
- Still required inside `SR2`:
  - turn the new `podDisruptionBudget` / `topologySpreadConstraints` / `autoscaling` seams into a target-environment baseline with explicit enabled values per workload
  - define the final replica/disruption policy for `api`, `web`, and the OpenClaw pools instead of leaving the production switch disabled
  - collect target-environment `Tier 2` deploy smoke and `Tier 3` observation evidence for rollout/restart/disruption behavior

### Confirmed risks

- Current chart truth now makes rollout assumptions explicit, but `api` and `web` still run with `replicaCount: 1` in current values, so zero-downtime disruption safety is not yet proven.
- HPA/PDB/topology rules now have explicit config surfaces, but they are not yet enabled in the active environment values, so autoscaling and eviction behavior remain unproven.
- OpenClaw multi-replica correctness remains outside `SR2`; infra prep must not be misread as proof that multi-replica runtime behavior is safe.

### Metrics / checks still required

- `Tier 0`:
  - `helm template` for base and env values
  - `corepack pnpm run runtime-pools:readiness:strict`
- Future `SR2` acceptance must also include:
  - target-environment deploy smoke for rollout and restart behavior
  - observation-window evidence for pod readiness, restart, rollout progress, and disruption handling

### Next recommended step

- Stay inside `SR2` and land the next narrow infra slice: enable and validate the first honest production `PDB` / topology / autoscaling baseline per workload in the target environment.

## 2026-04-05 - SR1 closure baseline (observation / alerts / runbook)

### Active slice after this session

- `SR2` — GKE production baseline

### What was completed

1. Added `docs/SR1-OBSERVABILITY-BASELINE.md` as the canonical `SR1` operational baseline for:
   - deploy smoke checklist
   - first observation-window checklist
   - minimum alert baseline
   - operator notes for PersAI API `/health` / `/ready` / `/metrics`
   - operator notes for OpenClaw `/healthz` / `/readyz`
2. Documented the current honest OpenClaw-side signal truth without inventing a larger runtime observability platform:
   - probes: `/healthz`, `/readyz`
   - guarded readiness details: `ready`, `failing[]`, `uptimeMs`
   - startup/readiness failure logs from `waitForTransportReady()`
   - Telegram runtime failure logs when Telegram is enabled
   - PersAI API `runtime_route` logs as the proof of which OpenClaw pool actually handled live traffic
3. Updated `docs/TEST-PLAN.md` so `SR1` now has explicit `Tier 2` and `Tier 3` verification expectations instead of only code-level metrics work.
4. `SR1` is now closeable as a baseline slice:
   - API readiness baseline exists
   - API request/error/latency baseline exists
   - OpenClaw probe/log baseline is explicit
   - deploy observation and alert expectations are explicit

### What remains after SR1

- `SR2` — GKE production baseline

### Confirmed risks

- OpenClaw still does not expose a Prometheus metrics endpoint in the `SR1` baseline; runtime-side observation is still probe/log based.
- OpenClaw multi-replica safety is still unproven and remains outside `SR1`.
- Queue throughput, queue depth, and distributed tracing remain outside `SR1`.

### Metrics / alerts still required

- No additional `SR1` baseline metrics are required before closing the slice.
- Future slices will need their own domain-specific metrics and alerts:
  - `SR2` infra rollout/disruption/autoscaling signals
  - later runtime/queue/storage/media/burst slices beyond the `SR1` baseline

### Next recommended step

- Close `SR1` and open `SR2` — GKE production baseline.

## 2026-04-05 - SR1 readiness baseline (API health/ready/metrics)

### Active slice

- `SR1` — platform baseline and observability

### What was completed

1. Replaced the formal `/ready` behavior with a real readiness snapshot backed by the two active API Prisma clients:
   - `identity_access_db`
   - `workspace_management_db`
2. Added a small shared readiness service with short TTL + in-flight dedup so `/ready` and `/metrics` use one operational truth instead of independent hardcoded values.
3. `/ready` now returns `503` with dependency-level status/error detail when either DB dependency is not ready.
4. `/metrics` no longer hardcodes `app_ready 1`; it now exposes:
   - `app_ready`
   - `app_dependency_ready{dependency=...}`
   - `app_dependency_check_duration_ms{dependency=...}`
   - `process_resident_memory_bytes`
   - `nodejs_heap_used_bytes`
   - `nodejs_heap_total_bytes`
   - `nodejs_external_memory_bytes`
5. Added focused API test coverage for readiness caching and the new `/ready` + `/metrics` contracts.
6. Follow-up hardening for the same SR1 sub-slice:
   - `/ready` no longer forces a fresh DB probe on every request; it now reuses the short TTL + in-flight dedup snapshot path
   - `/ready` no longer exposes raw DB/Prisma error text; public dependency errors are now sanitized to safe readiness codes
7. `SR1b` added the first minimal API request metrics baseline at the existing HTTP completion point in `RequestLoggingMiddleware`:
   - `http_requests_total`
   - `http_requests_in_flight`
   - `http_error_requests_total`
   - `http_requests_by_status_total{method,route,status_code,status_class}`
   - `http_request_duration_ms_sum{...}`
   - `http_request_duration_ms_max{...}`
   - `http_request_duration_ms_bucket{...,le=...}`
8. `SR1b` keeps request logging and request metrics on one completed-response truth, instead of introducing a separate observability pipeline.
9. `SR1b` fix-pass corrected three operational issues in the HTTP metrics export:
   - latency histogram now emits a Prometheus-compatible histogram family shape with bounded buckets, `+Inf`, `_sum`, and `_count`
   - route labels no longer use raw request URLs as-is; when a framework route pattern is unavailable, labels fall back to bounded low-cardinality route groups
   - `http_requests_in_flight` now closes on non-finish response termination paths (`close`) and no longer depends on `finish` only

### What remains inside SR1

- Add the next minimal observability sub-slice without widening scope:
  - explicit alert/dashboard doc for OpenClaw-side baseline signals
  - deploy-time observation checklist for `/health`, `/ready`, and `/metrics` in the target environment

### Confirmed risks

- `/ready` is no longer a formality, but it currently proves only API process + DB availability; it does not yet prove OpenClaw runtime readiness, Telegram reachability, or wider external dependency health.
- Multi-replica OpenClaw safety remains unproven and stays outside this SR1 sub-slice.
- Dependency readiness still has no historical failure counters, so alerting currently depends on scrape-time gauges rather than failure-rate series.

### Unresolved hypotheses

- It is still unverified whether API operator pain during burst comes more from DB latency, runtime saturation, or ingress/request fan-in; this sub-slice only makes those next measurements possible.

### Metrics / alerts still required

- Mandatory alerts now possible from the current baseline:
  - `app_ready == 0`
  - `app_dependency_ready{dependency="identity_access_db"} == 0`
  - `app_dependency_ready{dependency="workspace_management_db"} == 0`
  - sustained increase in `app_dependency_check_duration_ms{dependency=...}`
  - sustained high `process_resident_memory_bytes` / heap growth
  - no request traffic when traffic is expected: `increase(http_requests_total[5m]) == 0`
  - sustained 5xx responses: `increase(http_error_requests_total[5m]) > 0`
  - sustained high latency on active routes using `http_request_duration_ms_sum`, `http_requests_by_status_total`, and latency buckets
- Still missing before SR1 can be considered closed:
  - runtime/OpenClaw dependency signals
  - target-environment deploy observation using the new request metrics

### Next recommended step

- Stay inside `SR1` and land the next narrow observability slice: target-environment deploy observation for the new readiness/request metrics plus the first OpenClaw-side baseline signals.

## 2026-04-05 - Scaling readiness program control baseline (SR0)

### What was done

Established the documentation/control layer for the scaling-readiness program so future Cursor-agent sessions can continue the `1000–5000` online-user readiness work from canonical repo docs instead of reconstructing context from chat history.

### What changed

1. Added `docs/ADR/070-scaling-readiness-program-and-clean-delivery-discipline.md` as the umbrella ADR for:
   - evidence-first scaling delivery
   - clean-delivery / no-trash rules
   - anti-scope rules
   - explicit deploy/verification cadence
2. Added `docs/SCALING-READINESS-PLAN.md` as the central execution-plan source-of-truth with:
   - `SR0`-`SR10` slice order
   - current active slice = `SR0`
   - next recommended slice = `SR1`
   - Cursor-agent session entry + handoff protocol
   - verification tiers and deploy batching rules
3. Updated `docs/ROADMAP.md` and `docs/TEST-PLAN.md` to reference the scaling-readiness program as the canonical future execution path.
4. Updated `docs/CHANGELOG.md` so the control-layer baseline is visible in repo history.

### Why this matters

- Scaling work now has one umbrella architecture decision and one central execution plan.
- Future agent sessions should not need to infer slice order, cleanup rules, or observation cadence from older audit conversations.
- Risky scale-path work can now be delivered as bounded slices without silently deepening legacy branches or temporary rollout paths.

### Current active slice

- `SR6` — Storage and workspace path hardening

### Current active sub-slice

- `SR6a` — Workspace quota cache invalidation parity for filesystem mutations

### Next recommended slice

- `SR7` — Media pipeline capacity hardening

### Suggested entry reads for the next session

1. `docs/SCALING-READINESS-PLAN.md`
2. `docs/ROADMAP.md`
3. `docs/SESSION-HANDOFF.md`
4. `docs/ADR/070-scaling-readiness-program-and-clean-delivery-discipline.md`
5. relevant storage/workspace ADRs and docs for `SR6`

## 2026-04-05 - Workspace quota guard hardening (3 live-test bug fixes)

### What was done

Live testing via assistant revealed three bugs in workspace quota enforcement:
1. **exec pre-check blocked cleanup commands** (`rm -rf`) when quota exceeded — deadlock, assistant could not free space
2. **du cache 30s TTL** allowed 1.5 GB burst writes in a single turn before enforcement triggered
3. **workspaceQuotaBytes resolved from env default** instead of plan's `quotaAccounting`, so admin UI changes did not propagate

### What changed (OpenClaw fork)

- `src/agents/bash-tools.exec.ts` — cleanup commands (`rm`, `unlink`, `truncate`, `find -delete`) now bypass quota pre-check with warning; du cache invalidated before post-check
- `src/agents/workspace-quota-guard.ts` — added `invalidateWorkspaceCache()` export
- `src/agents/sandbox/fs-bridge.ts` — invalidates du cache after successful write
- `docs/PERSAI-FORK-PATCHES.md` — updated Patch #28 description

### What changed (PersAI)

- `apps/api/src/.../materialize-assistant-published-version.service.ts` — `resolveWorkspaceQuotaBytes()` reads `quotaAccounting.workspaceStorageBytesLimit` from plan, falls back to env default
- `docs/ADR/069-...` — updated with cleanup bypass, cache invalidation, plan-aware quota
- Updated OpenClaw SHA in `openclaw-approved-sha.txt` and `infra/helm/values-dev.yaml`

### Deploy order

1. Push OpenClaw first
2. Update PersAI SHA + push

### Risks

- Cleanup regex is simple; complex piped commands (`bash -c "rm ..."`) won't match — acceptable, assistant uses direct `rm` calls

## 2026-04-05 - Voice-only response NO_REPLY suppression

### What was done

OpenClaw runtime no longer injects fallback text when a response contains only media (voice/image). The `NO_REPLY` sentinel text from TTS tool output is now filtered at three levels: `resolveAgentResponse` returns empty text when only media is present, stream handler skips `NO_REPLY` prefix deltas, and HTTP sync/channel handlers stop forcing fallback text.

### What changed (OpenClaw fork)

1. `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — `resolveAgentResponse` returns empty text for media-only; stream filters `isSilentReplyText`/`isSilentReplyPrefixText`; no fallback delta when text is empty
2. `src/gateway/persai-runtime/persai-runtime-http.ts` — sync/channel handlers stop injecting "No response from OpenClaw." on empty text
3. `src/gateway/persai-runtime/persai-runtime-agent-turn.test.ts` — tests for media-only sync + stream scenarios

### What changed (PersAI)

1. `infra/dev/gitops/openclaw-approved-sha.txt` — `cce6f701912effb39897120f124683f974210a60`
2. `infra/helm/values-dev.yaml` — openclaw image tag updated

### Deploy order

1. Push OpenClaw first
2. Push PersAI — CI rebuilds/repins the OpenClaw image

## 2026-04-05 - Workspace storage quota + dind privileged canary (ADR-069)

### What was done

Two remaining security gaps closed:

1. **Workspace storage quota**: sandbox `write` and `exec` tools now enforce a per-plan workspace size limit via cached `du -sb` (30s TTL). Default 500 MB. Write tool hard-blocks on quota exceeded; exec tool hard-blocks before execution and appends warning after execution if quota exceeded.

2. **dind privileged canary (reverted)**: attempted `privileged: false` with rootless securityContext. GKE COS rejected rootlesskit (`operation not permitted`). Reverted to `privileged: true`. Known infra trade-off — mitigation via GKE Sandbox (gVisor) or rootless-capable node pool.

### What changed (OpenClaw fork)

1. `src/gateway/persai-runtime/persai-runtime-tool-policy.ts` — `extractWorkspaceQuotaBytes()`
2. `src/agents/persai-runtime-context.ts` — `workspaceQuotaBytes` on request context
3. `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — wire through all 3 turn types
4. `src/gateway/persai-runtime/persai-runtime-http.ts` — extract + pass at all 3 call sites
5. `src/agents/workspace-quota-guard.ts` — NEW: cached du + enforceWorkspaceQuota
6. `src/agents/sandbox/fs-bridge.ts` — write quota pre-check
7. `src/agents/bash-tools.exec.ts` — exec pre-check + post-check
8. `docs/PERSAI-FORK-PATCHES.md` — Patch #28

### What changed (PersAI)

1. `docs/ADR/069-workspace-storage-quota-and-dind-privileged-removal.md` — new ADR
2. `packages/config/src/api-config.ts` — `QUOTA_WORKSPACE_STORAGE_BYTES_DEFAULT` (524288000 = 500 MB)
3. `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — `workspaceQuotaBytes` in bootstrap governance
4. `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts` — `workspaceStorageBytesLimit` in types
5. `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` — read/write workspace quota
6. `apps/web/app/admin/plans/page.tsx` — Workspace storage (MB) field in Admin Plans UI
7. `infra/helm/templates/openclaw-deployment.yaml` — dind privileged canary attempted then reverted
8. `infra/dev/gitops/openclaw-approved-sha.txt` — `5ce51cb37d5d22d9a648b2d3b4f5100ed33791fc`
9. `infra/helm/values-dev.yaml` — openclaw image tag updated

### Deploy order

1. Push OpenClaw first
2. Push PersAI — CI rebuilds/repins the OpenClaw image

### Risks

- dind rootless without `privileged` failed on GKE COS nodes (rootlesskit `operation not permitted`). Reverted to `privileged: true`. Known infra trade-off.
- Workspace quota uses cached `du` (30s window). A fast burst can briefly exceed quota by the amount written in one cache window.
- Existing over-quota workspaces are not retroactively blocked — they will be blocked on the next write/exec attempt.

### Verification

1. After deploy: run `exec` with `dd if=/dev/zero of=test.bin bs=1M count=600` in a free-tier assistant — should be blocked.
2. After deploy: verify dind sidecar starts successfully and sandbox code execution works.

### Next recommended step

- Delete 7.5 GB test data from GCS workspace (manual cleanup)
- Monitor dind pod startup in all pools after deploy

## 2026-04-05 - OpenClaw Telegram owner claim instant bootstrap patch

### What was done

After a successful 6-digit Telegram owner claim, the runtime now patches the in-memory `bootstrap.channels.telegram` state immediately (`ownerClaimStatus: "claimed"`, fills `ownerTelegramUserId`/`ownerTelegramUsername`/`ownerTelegramChatId`, clears code fields). Without this patch, the bot would re-prompt for the claim code on subsequent messages until the next full spec refresh from PersAI API.

### What changed (OpenClaw fork)

1. `src/gateway/persai-runtime/persai-runtime-telegram.ts` — new `applyTelegramOwnerClaimToBootstrap()` function + call after successful claim
2. `src/gateway/persai-runtime/persai-runtime-telegram.test.ts` — unit test for the new function

### What changed (PersAI)

1. `infra/dev/gitops/openclaw-approved-sha.txt` — advanced to `8d6a6fcbe842ee6cba24e8aeea590a9b522cce15`
2. `infra/helm/values-dev.yaml` — openclaw image tag updated, digest cleared for CI repin
3. `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Deploy order

1. Push OpenClaw first
2. Push PersAI — CI rebuilds/repins the OpenClaw image

## 2026-04-05 - Application-layer security hardening (ADR-067)

### What was done

Five application-layer security gaps found during live audit were fixed:

1. **Media storage quota enforced** — `ManageChatMediaService` and `InboundMediaService` now call `recordMediaUpload()` after every successful attachment creation. A pre-check rejects uploads that would exceed the workspace's `media_storage_bytes` limit.
2. **Per-peer Telegram rate limit** — `EnforceAbuseRateLimitService` gained an in-memory sliding-window counter keyed by `assistantId:surface:peerKey`. For Telegram turns, `threadId` (Telegram chat session key) is passed as the peer key. Configurable via `ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE` (default 5) and `ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE` (default 12).
3. **Draft string length limits** — `displayName` max 100, `instructions` max 50,000, `avatarUrl` max 2,048, `avatarEmoji` max 8.
4. **avatarUrl validation** — must use `https://` scheme and parse as a valid URL.
5. **NetworkPolicy covers all pools** — `openclaw-ingress-baseline` selector removed `persai.dev/runtime-pool` restriction so the ingress policy applies to all openclaw pods (free, paid-shared, paid-isolated). Safe because ADR-066 moved all external webhook traffic through the API proxy.

### What changed

1. `docs/ADR/067-application-layer-security-hardening.md` — new ADR
2. `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts` — added `checkMediaStorageQuota()` and `recordMediaUpload()` methods
3. `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts` — quota pre-check + post-increment on upload and staged upload paths
4. `apps/api/src/modules/workspace-management/application/media/inbound-media.service.ts` — quota post-increment on channel inbound media
5. `apps/api/src/modules/workspace-management/application/media/media.types.ts` — added `userId` to `InboundMediaResolveParams`
6. `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts` — passes `userId` and `peerKey` (threadId)
7. `apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts` — maxLength guards + avatarUrl https validation
8. `apps/api/src/modules/workspace-management/application/enforce-abuse-rate-limit.service.ts` — in-memory per-peer sliding window counter
9. `packages/config/src/api-config.ts` — `ABUSE_PEER_SLOWDOWN_REQUESTS_PER_MINUTE`, `ABUSE_PEER_BLOCK_REQUESTS_PER_MINUTE`
10. `infra/helm/templates/networkpolicies.yaml` — removed pool-specific selector from openclaw-ingress-baseline

### Risks

- Media quota enforcement applies to new uploads only. Existing over-quota workspaces are not retroactively blocked.
- Per-peer rate limit is in-memory and resets on pod restart. Acceptable for initial protection.
- Draft length limits may reject payloads that were previously accepted. Limits are generous (100 / 50,000).
- NetworkPolicy change is safe after ADR-066 (all external traffic via API proxy).

### Deploy order

1. Deploy PersAI API (all code changes)
2. Deploy Helm chart (NetworkPolicy change)
3. No OpenClaw changes needed

### Verification

1. `corepack pnpm --filter @persai/api run typecheck`
2. `corepack pnpm --filter @persai/web run typecheck`
3. `corepack pnpm -r --if-present run lint`
4. `corepack pnpm run format:check`
5. After deploy: upload a file with a workspace near quota limit, verify rejection
6. After deploy: send >12 messages from one Telegram peer in 60s, verify rate-limit

## 2026-04-05 - Telegram tier-aware ingress proxy (ADR-066)

### What was done

1. **Telegram webhook traffic is now tier-aware** — GKE Ingress for `bot.persai.dev/telegram-webhook` now routes to the PersAI API (`api:3001`) instead of the hardcoded `free_shared_restricted` OpenClaw pool. A new `TelegramWebhookProxyController` resolves the assistant's runtime tier and transparently forwards the Telegram update to the correct OpenClaw pool.
2. **Ingress template cleaned** — removed all free-pool context variables and wiring from `ingress.yaml`. Bot traffic condition now depends on `api.enabled && telegramWebhook.enabled` instead of free pool readiness.
3. **Security policy note updated** — the stale "Telegram follows free shared pool during cutover" note in `runtime-tier-security-policy.ts` replaced with the ADR-066 reference.
4. **Documentation** — ADR-066, API-BOUNDARY, CHANGELOG, SESSION-HANDOFF updated.

### What changed

1. `docs/ADR/066-telegram-tier-aware-ingress-proxy.md` — new ADR documenting the decision
2. `apps/api/src/modules/workspace-management/interface/http/telegram-webhook-proxy.controller.ts` — new controller
3. `apps/api/src/modules/workspace-management/workspace-management.module.ts` — registered controller
4. `infra/helm/templates/ingress.yaml` — bot.persai.dev backend changed from openclaw-free-shared to api
5. `apps/api/src/modules/workspace-management/application/runtime-tier-security-policy.ts` — note updated
6. `docs/API-BOUNDARY.md` — new endpoint documented
7. `docs/CHANGELOG.md` — entry added

### Risks

- One extra network hop per Telegram webhook (~5-10ms, within Telegram's 60s tolerance).
- If `resolveByAssistantId` fails (deleted assistant, DB outage), the proxy returns 200 `{ ok: false }` to Telegram, which prevents retries but drops the update. This matches the existing OpenClaw behavior for unknown assistants.
- NestJS JSON body parser deserializes then re-serializes the Telegram update. Semantic content is identical; byte-for-byte equality is not guaranteed. OpenClaw's grammY parser accepts any valid JSON.

### Deploy order

1. Deploy PersAI API (new controller registers automatically)
2. Deploy Helm chart (ingress rule changes)
3. No OpenClaw changes needed
4. No Telegram bot re-registration needed

### Verification

1. `corepack pnpm --filter @persai/api run typecheck`
2. `corepack pnpm --filter @persai/web run typecheck`
3. `corepack pnpm run format:check`
4. After deploy: send a Telegram message to a paid-tier bot, verify in API logs that proxy routes to `paid_shared_restricted` pool
5. Verify free-tier bot still works (routes to `free_shared_restricted`)

## 2026-04-05 - Telegram claim UX + Admin Ops fixes

### What was done

1. **Telegram claim-required UI was cleaned up** — the integrations card no longer shows a redundant `claim_required` badge in the header while the code panel is already visible.
2. **Expired Telegram owner-claim codes now self-heal** — the API rotates an expired pending code on integration-state read, and the web UI refreshes around the expiry time so operators see the new valid code without manual reload.
3. **Ops Cockpit tester override was completed** — assistant-level test plan override now really changes effective plan/runtime reads instead of only persisting an override field in governance.
4. **Admin delete-user no longer crashes on append-only audit log** — the delete flow stopped issuing forbidden `assistantAuditEvent.updateMany(...)` mutations and now uses one scoped maintenance path while parent deletes trigger FK `SET NULL`.
5. **Ops Cockpit IDs are copyable** — assistant/workspace/apply IDs in the cockpit cards now have copy actions for the full raw values.

### What changed

1. `apps/api/src/modules/workspace-management/application/telegram-integration.metadata.ts` and `resolve-telegram-integration-state.service.ts` — expired pending Telegram owner-claim codes are reissued on read.
2. `apps/web/app/app/_components/telegram-connect.tsx` — hides the noisy claim badge and auto-refreshes state around claim expiry.
3. `apps/api/src/modules/workspace-management/application/resolve-effective-subscription-state.service.ts` — precedence is now `assistant override -> workspace subscription -> assistant fallback -> catalog default -> none`, matching the intended tester-override behavior.
4. `apps/web/app/admin/ops/page.tsx` — `Plan Control` keeps operator selection stable, shows feedback in-card, and adds copy buttons for visible IDs.
5. `apps/api/src/modules/workspace-management/application/admin-delete-user.service.ts` — removes direct audit-row `updateMany(...)` calls and narrows the append-only trigger bypass to the parent-delete transaction path.
6. `apps/api/test/subscription-state-resolve.test.ts` and `apps/api/test/admin-delete-user.service.test.ts` — focused regressions for override precedence and delete-user audit handling.

### Verification

1. `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts`
2. `corepack pnpm --filter @persai/api exec tsx test/subscription-state-resolve.test.ts`
3. `corepack pnpm --filter @persai/api exec tsx test/admin-delete-user.service.test.ts`
4. `corepack pnpm --filter @persai/api run typecheck`
5. `corepack pnpm --filter @persai/web run typecheck`
6. `corepack pnpm run format:check`

## 2026-04-05 - Telegram owner claim switched to 6-digit code flow

### What was done

1. **Deep-link-first owner claim was removed** — PersAI no longer depends on `tg://` or `https://t.me/...start=...` to finish Telegram owner verification.
2. **Telegram connect now issues a one-time 6-digit code** — the integrations panel shows that code directly, and the owner confirms by sending it to the bot chat.
3. **OpenClaw runtime now prompts for the code in chat** — while claim is pending, Telegram DM ingress answers with a short locale-aware instruction telling the user to send the 6-digit code from PersAI.

### What changed

1. `apps/api/src/modules/workspace-management/application/telegram-integration.metadata.ts` — owner claim token/deep-link metadata replaced with `telegramOwnerClaimCode` and expiry field.
2. `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts` and `telegram-integration.types.ts` — integration state now exposes owner claim `code` / `claimExpiresAt` instead of `claimDeepLink`.
3. `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — Telegram bootstrap now materializes `ownerClaimCode` and `ownerClaimCodeExpiresAt` for OpenClaw runtime.
4. `apps/web/app/app/_components/telegram-connect.tsx` plus `apps/web/messages/{en,ru}.json` — claim-required UI now shows the 6-digit code with copy action instead of a link CTA.
5. `openclaw/src/gateway/persai-runtime/persai-runtime-telegram.ts` — owner gate now accepts `482913`, `/start 482913`, or `/claim 482913`, prompts for the code while unclaimed, and no longer uses `persai_claim_*`.

### Verification

1. `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts`
2. `corepack pnpm --filter @persai/api run typecheck`
3. `corepack pnpm --filter @persai/web run typecheck`
4. `pnpm test -- src/gateway/persai-runtime/persai-runtime-telegram.test.ts`

## 2026-04-05 - Wave 3 media storage quota + Admin Runtime UX

### What was done

1. **`mediaStorageBytesLimit` end-to-end** — added new field to `AdminPlanQuotaLimits` in OpenAPI, backend types, `manage-admin-plans.service.ts` (parse, write, read), `track-workspace-quota-usage.service.ts` (plan-level override with fallback to global default), and Admin Plans UI (editable in MB, stored as bytes).
2. **Admin Runtime page usability overhaul** — restructured from cramped two-column wall-of-text to clean sectioned grid: Model routing, Available models, API keys sections with 2-column cards. Sandbox security tier cards show human-readable names, compact metric grid (PIDs/RAM/CPU), and collapsible tool policy details. No functional changes to save/load logic.

### What changed

1. `packages/contracts/openapi.yaml` — `mediaStorageBytesLimit` added to `AdminPlanQuotaLimits`
2. `packages/contracts/src/generated/` — regenerated
3. `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts` — `mediaStorageBytesLimit` in `AdminPlanInput` and `AdminPlanState` quotaLimits
4. `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` — parsePlanInput, toWriteInput, toAdminPlanState updated
5. `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts` — `PlanQuotaHints.mediaStorageBytesLimit`, plan-level override in `resolveLimits`
6. `apps/web/app/admin/plans/page.tsx` — `PlanDraft.mediaStorageMb`, form field, read-only card display
7. `apps/web/app/admin/runtime/page.tsx` — full rewrite for usability
8. `docs/CHANGELOG.md` — updated
9. `docs/SESSION-HANDOFF.md` — this entry

### Risks

- Existing plans have no `mediaStorageBytesLimit` in `billingProviderHints.quotaAccounting` — they continue to get the global default. This is safe because the read path already returns `null` for missing values, and `resolveLimits` falls back to config.
- Admin UI converts MB to bytes via `* 1048576`. Very large values (>2TB) could overflow JS integer precision, but this is not a realistic plan limit.
- The Runtime page rewrite is purely visual — all state management and API calls are identical. If any Tailwind class names don't resolve in the deployed theme, cards may render unstyled.

### Deploy order

No special deploy order needed. The API handles missing `mediaStorageBytesLimit` gracefully (returns null, defaults to global config). Frontend and API can deploy independently.

---

## 2026-04-05 - Wave 1 infrastructure security hardening (ADR-065)

1. **openclaw container securityContext locked down** — readOnlyRootFilesystem, runAsNonRoot (uid 1000), drop ALL capabilities, no privilege escalation. Explicit `/tmp` emptyDir mount (500Mi) for Node.js scratch and ffmpeg temp files.
2. **Per-pool resource limits differentiated** — free_shared gets 250m/1 CPU and 512Mi/1Gi RAM; paid_shared gets 500m/2 CPU and 1Gi/2Gi RAM; isolated gets 1/4 CPU and 2Gi/4Gi RAM. dind sidecar resources also per-pool.
3. **Sandbox Docker limits per tier** — free_shared: 64 PIDs, 512m, 0.5 CPUs. paid_shared: 128 PIDs, 1g, 1 CPU. isolated: 256 PIDs, 2g, 2 CPUs. Previously all tiers used identical 256/1g/1 defaults.
4. **Per-pool session maintenance** — free: 500 entries / 256mb disk. paid_shared: 1000 / 1gb. isolated: 2000 / 2gb (unchanged from global default for isolated).
5. **Egress NetworkPolicy** — openclaw pods can only reach kube-dns (53), PersAI internal API (3002), and external HTTPS (443). GCP metadata endpoint (169.254.169.254) and private CIDRs (10/8, 172.16/12, 192.168/16) blocked.
6. **RuntimeTierSecurityPolicyState v2** — added `sandboxLimits` field with per-tier pidsLimit, memoryMb, cpus. Admin Runtime UI `TierSecurityCard` now shows differentiated resource limits, not just identical policy flags.

### What changed

1. `docs/ADR/065-wave1-infra-security-hardening.md` — new ADR
2. `infra/helm/templates/openclaw-deployment.yaml` — securityContext, /tmp volume, per-pool resources
3. `infra/helm/templates/networkpolicies.yaml` — openclaw-egress-baseline NetworkPolicy
4. `infra/helm/values-dev.yaml` — per-pool resource limits, sandbox Docker limits, session maintenance, dind resources
5. `apps/api/src/modules/workspace-management/application/runtime-tier-security-policy.ts` — schema v2, `sandboxLimits`, `TIER_SANDBOX_LIMITS` per tier
6. `packages/contracts/openapi.yaml` — `SandboxResourceLimits` schema, `sandboxLimits` in `RuntimeTierSecurityPolicyState`
7. `packages/contracts/src/generated/` — regenerated
8. `apps/web/app/admin/runtime/page.tsx` — `TierSecurityCard` shows PIDs/Memory/CPUs per tier
9. `docs/CHANGELOG.md` — updated
10. `docs/SESSION-HANDOFF.md` — this entry

### Risks

- `readOnlyRootFilesystem: true` on openclaw requires the runtime to use `/tmp` for scratch and `/mnt/workspaces/persai` (GCS FUSE) or `/home/node/.openclaw/workspace` (emptyDir) for state. If any library writes to other root paths, the pod will crash. Verify after deploy.
- Free-tier sandbox limits (64 PIDs, 512m) are significantly lower than before (256 PIDs, 1g). Complex sandbox operations (multi-process builds, large npm installs) may OOM or hit PID limit. This is intentional for free tier blast radius but should be monitored.
- Egress NetworkPolicy blocks all private CIDRs. If Redis Memorystore is on a private IP, it will be blocked. Redis access from openclaw goes through the PersAI internal API, not directly, so this should be safe. Verify.
- dind sidecar still requires `privileged: true` — this is a known limitation addressed in a future gVisor (ADR-065 scope note) wave.

### Deploy order

1. Apply Helm changes: `helm template persai ./infra/helm -f ./infra/helm/values-dev.yaml | kubectl apply -f -`
2. Restart all openclaw pool pods: `kubectl rollout restart deployment/openclaw-free-shared-restricted-sandbox deployment/openclaw-paid-shared-restricted-sandbox deployment/openclaw-paid-isolated -n persai-dev`
3. Verify pods start cleanly (check for EROFS/crash from readOnlyRoot)
4. Verify egress: from openclaw pod, `curl -s https://api.openai.com` should work, `curl http://169.254.169.254/` should timeout
5. Verify sandbox exec works: send a web chat turn that triggers a tool call
6. Verify admin UI: `/admin/runtime` should show differentiated PIDs/Memory/CPUs per tier

### Next recommended step

- Wave 3: PersAI product limits — `mediaStorageBytesLimit` editable in Admin Plans, `sandboxExecTimeoutSeconds` in materialization, concurrent turn mutex

## 2026-04-05 - Wave 2: OpenClaw fork security fixes + PersAI media cleanup

1. **Cross-assistant file read blocked** — `resolvePersaiWorkspaceMediaStoragePath` in OpenClaw no longer falls back to the global workspace root. Path resolution is strictly constrained to the current assistant's workspace directory. Previously, a crafted `storagePath` like `../../<other-assistant-id>/media/...` could read another assistant's files.
2. **Lazy _stt_tmp cleanup** — PersAI media preprocessor now calls `deleteChatMediaBatch(assistantId, "_stt_tmp")` before each transcription, clearing any orphan temp files left by prior crashes or incomplete cleanups.

### What changed

1. `openclaw/src/gateway/persai-runtime/persai-runtime-media.ts` — `resolvePersaiWorkspaceMediaStoragePath` constrained to assistant workspace dir, removed `resolvePersaiWorkspaceRoot` import
2. `openclaw/docs/PERSAI-FORK-PATCHES.md` — updated patch description
3. `apps/api/src/modules/workspace-management/application/media/media-preprocessor.service.ts` — lazy `_stt_tmp` batch delete before transcription

### Risks

- If `image_generate` tool produces paths that resolve outside `workspaceDir/media/` but still within workspace root, those will now fail to download. Verified: image-generate saves to `workspaceDir/media/tool-image-generation/` which is inside the assistant workspace dir — safe.
- The lazy `_stt_tmp` delete is fire-and-forget. If the runtime is unreachable at that moment, cleanup silently fails. The per-file delete in `finally` still runs as before, so this is a belt-and-suspenders approach.

### Push order

1. Push `openclaw` first (cross-assistant read fix)
2. Push `PersAI` second (pin new OpenClaw SHA + media cleanup + Wave 1 infra hardening)

## 2026-04-05 - Cron webhook auth fix and web chat context leak fix

1. **Cron webhook token mismatch fixed** — `openclaw-configmap.yaml` pointed `cron.webhookToken` at `OPENCLAW_GATEWAY_TOKEN`, but the PersAI `cron-fire` endpoint checks `PERSAI_INTERNAL_API_TOKEN`. These are different secrets (`30d2c1...` vs `97f0b1...`), so every cron-fired webhook (including `reminder_task`) was rejected with HTTP 401. Fixed by changing the ConfigMap template to use `PERSAI_INTERNAL_API_TOKEN`.
2. **Web chat attachment context leak fixed** — `buildContextForExistingAttachments(chatId)` was called on every web chat turn, pulling ALL attachments (user uploads + model-generated media) from the entire chat into the user message. This caused: (a) growing token waste per turn, (b) repeated `[Files available in your workspace: ...]` blocks persisted in OpenClaw session history, (c) unnecessary `image` tool calls from the blanket "inspect it with the image tool" instruction even when no new images were present. Fixed by scoping to current message attachments only, deduplicating by storage path, and gating the image-inspect instruction on whether the current message actually contains images.

### What changed

1. `infra/helm/templates/openclaw-configmap.yaml` — `cron.webhookToken.id` changed from `OPENCLAW_GATEWAY_TOKEN` to `PERSAI_INTERNAL_API_TOKEN`
2. `apps/api/src/modules/workspace-management/application/media/inbound-media.service.ts` — `buildContextForExistingAttachments(chatId)` replaced with `buildContextForCurrentMessageAttachments(messageId)` using `listByMessageId`, storagePath dedupe, and scoped image instruction
3. `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` — caller updated to pass `userMessage.id`
4. `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts` — caller updated to pass `userMessage.id`

### Risks

- Cron fix requires `helm template | kubectl apply` + pod rollout restart to take effect on the live cluster.
- Telegram and group channels were audited and confirmed unaffected by bug 2 (they use `inboundMediaService.resolve()` scoped to current attachments only).
- Old OpenClaw session history entries still contain previously injected `[Files available...]` text blocks; these will be naturally pruned by session compaction/rotation.

### Deploy order

1. Apply Helm changes: `helm template persai ./infra/helm -f ./infra/helm/values-dev.yaml | kubectl apply -f -`
2. Restart OpenClaw pods: `kubectl rollout restart deployment/openclaw-free-shared-restricted-sandbox deployment/openclaw-paid-shared-restricted-sandbox deployment/openclaw-paid-isolated -n persai-dev`
3. Restart API pod (for the attachment fix): `kubectl rollout restart deployment/api -n persai-dev`
4. Verify: create a new `reminder_task` and confirm it fires; send a file in web chat and confirm subsequent messages do not re-inject it.

## 2026-04-05 - Telegram owner-claim and SaaS hardening baseline

1. **Telegram DM access is no longer implicitly public** — the materialized Telegram channel policy is now `owner_only`, connect enters `claim_required`, and the intended direct-message owner must finish a Telegram deep-link claim before the integration is treated as fully connected.
2. **Integration state is now honest across UI/control-plane/runtime** — `GET /assistant/integrations/telegram` and the web integrations UI now distinguish `not_connected`, `claim_required`, `connected`, and `invalid_token` instead of flattening everything into connected/not-connected.
3. **Disconnect/revoke from PersAI is resilient again** — Telegram revoke/disconnect no longer fails just because an older binding was still in legacy/unmanaged secret-ref state; the encrypted provider key is removed best-effort and the binding is pushed into inactive/not-connected truth anyway.
4. **OpenClaw now blocks two real Telegram SaaS failure modes earlier in ingress** — repeated Telegram deliveries are deduped by `assistantId + update_id`, and owner-only DM gate checks now run before `requestPersaiTelegramTurn`, so random Telegram users and duplicate webhook retries do not silently create extra runtime turns.
5. **Terminal Telegram auth failure is explicit** — runtime-side `401 Unauthorized` profile failures now promote the integration into `invalid_token` instead of being treated as endless retry-only noise.
6. **Owner onboarding is now immediate after claim** — once the owner sends the matching 6-digit code from PersAI in the bot chat, the bot sends a short system-language Telegram message so the private owner chat appears immediately without manual search.

### What changed

1. **PersAI control-plane/UI/docs were updated together** — connect/revoke/state materialization, internal Telegram turn idempotency, the integrations UI, contracts, docs, and ADR now all reflect one Telegram SaaS model instead of partial/runtime-only behavior.
2. **The OpenClaw fork revision is part of this delivery unit** — PersAI now pins `openclaw-approved-sha.txt` and `infra/helm/values-dev.yaml` to `e4f73e39c64064d74d4127e7eebbb881054fdf78`, the exact fork commit that carries the Telegram runtime hardening slice.
3. **Dev image digest was intentionally cleared again** — `openclaw.image.digest` is blank in dev values so CI can rebuild and repin the image for the new approved fork SHA after push.

### Files touched

- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/sync-telegram-chat-target.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.metadata.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-turn.controller.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/home-dashboard.tsx`
- `apps/web/app/app/_components/sidebar.tsx`
- `apps/web/app/app/_components/telegram-connect.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/model/telegramIntegrationBotState.ts`
- `packages/contracts/src/generated/model/telegramIntegrationConnectionStatus.ts`
- `packages/contracts/src/generated/model/telegramIntegrationOwnerClaimState.ts`
- `packages/contracts/src/generated/model/telegramIntegrationRuntimeState.ts`
- `packages/contracts/src/generated/model/telegramIntegrationState.ts`
- `docs/ADR/064-telegram-owner-claim-and-saas-hardening.md`
- `docs/API-BOUNDARY.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`
- `docs/SESSION-HANDOFF.md`
- `docs/TEST-PLAN.md`
- `infra/dev/gitops/openclaw-approved-sha.txt`
- `infra/helm/values-dev.yaml`

### Push order

1. `openclaw`
2. `PersAI`

### Pinned OpenClaw SHA

`e4f73e39c64064d74d4127e7eebbb881054fdf78`

## 2026-04-05 - K16 sandbox tool surface live verification

1. **Root cause confirmed: Helm template had never been applied to the cluster** — the `values-dev.yaml` changes from the previous session (explicit `tools.sandbox.tools.allow` with all PersAI product/service tools, `docker.user: "0:0"`) were committed and pushed but `helm template | kubectl apply` was never run, so live pods still carried the old ConfigMap with only `DEFAULT_TOOL_ALLOW` (six core coding tools).
2. **After deploy + rollout restart all tools appeared** — `helm template persai ./infra/helm -f ./infra/helm/values-dev.yaml | kubectl apply -f -` updated three pool ConfigMaps, and `kubectl rollout restart` recycled all OpenClaw sandbox pods. A fresh session immediately showed the full tool surface: `tts`, `browser`, `reminder_task`, `web_fetch`, `web_search`, `image_generate`, `memory_search`, `memory_get`, `persai_tool_quota_status`, `persai_workspace_attach`, plus the six core coding tools.
3. **No OpenClaw source patches were needed** — the initial hypothesis (tool factories returning `null`, plugin config missing, provider stubs required) turned out to be unnecessary. The bundled web-search providers (google, xai) are enabled by default, PersAI per-request credentials resolve at tool-creation time inside `persaiRuntimeRequestContext.run()`, and memory plugin tools load via the default `memory-core` slot.
4. **Tool daily limits remain to be exercised** — the `toolQuotaPolicy` pipeline (PersAI → bootstrap → `persaiRuntimeRequestContext` → OpenClaw per-call webhook) is wired but not yet tested live with real call-count assertions.

## 2026-04-04 - K16 sandbox runtime hotfix

1. **Live runtime proof found two remaining deployment-side breaks after the earlier K16 slices** — sandbox sessions were still falling back to OpenClaw's coding-only default sandbox allowlist, so the agent only saw the six core coding tools instead of the PersAI product/service tools declared in materialized `TOOLS.md`.
2. **`write` / `edit` were failing because the sandbox user did not match the real workspace mount ownership** — with rootless `docker:dind` and GCS FUSE, `/workspace` appeared as `root:root` inside the sandbox container while the runtime process still ran as `uid=1000`, producing the live `Permission denied` failures that the earlier control-plane work did not address.
3. **Dev Helm now matches the intended runtime matrix more honestly** — `infra/helm/values-dev.yaml` sets an explicit sandbox `tools.allow` / `tools.deny` policy that includes the actual PersAI product/service tools (`web_search`, `web_fetch`, `image_generate`, `tts`, `browser`, `memory_*`, `reminder_task`, `persai_tool_quota_status`, `persai_workspace_attach`, etc.) while still keeping `cron` hidden-internal and the channel/system tools denied.
4. **Sandbox writes are wired for the real rootless runtime topology** — the same Helm file now pins `agents.defaults.sandbox.docker.user` to `0:0`, which is the correct in-container identity for the rootless Docker namespace used by the shared sandbox pools and allows writable GCS FUSE workspaces without opening the network or root filesystem baseline.
5. **Operational implication** — after rollout, tools and per-tool limits can only be claimed as working once the live sandbox pods are recreated and rechecked, but the deployment config no longer contains the two known structural reasons that were keeping the runtime surface out of sync with tariff truth.

## 2026-04-04 - OpenClaw runtime hardening pin advance

1. **The OpenClaw fork is now cleanly pinned to the runtime hardening follow-up** — the approved fork SHA advanced to `62adb8631535262d9270bf5e4b1ab09bb16b5dd6`, and PersAI now points to that exact revision in both `openclaw-approved-sha.txt` and `infra/helm/values-dev.yaml`.
2. **Runtime-side file policy now matches the K16 hardening intent more closely** — the fork gained a dedicated runtime file-security validator used by workspace attach and outbound artifact fetches, reducing the chance that unsafe runtime media bypasses the normal PersAI media policy posture.
3. **Quota fallback keeps its runtime override seam** — request-level `providerOverride` / `modelOverride` remain available in the runtime bridge so PersAI can route a token-limit fallback turn to the materialized safe model without rewriting stored bootstrap documents.
4. **Verification checkpoint** — OpenClaw `npx tsc --noEmit` passed, focused `vitest` runtime file-security/workspace-attach tests passed, PersAI full lint passed, `format:check` passed, and both `@persai/api` and `@persai/web` typecheck passed after the new fork SHA was pinned.

## 2026-04-04 - K16 user-facing plan and usage UX cleanup

1. **User-facing plan visibility now reflects the real effective plan** — the assistant plan visibility payload was expanded so the web app can show current tariff identity, token usage, active chat usage, and active per-tool daily limits instead of relying on three coarse percentages.
2. **Sidebar no longer reinforces the old chat-progress mental model** — the left rail now shows the current tariff plus token budget consumption, which better matches the K16 fallback/quota behavior than the previous chat-only progress bar.
3. **Assistant settings now expose only the useful limit surfaces** — the settings panel keeps token and active-chat usage bars, removes the stale third usage bar, and lists the actual plan-managed tool limits available to the current user under the effective plan.
4. **Verification checkpoint** — contracts were regenerated, `@persai/api` typecheck passed, `@persai/web` typecheck passed, and focused regression coverage was added for `ResolvePlanVisibilityService`.

## 2026-04-04 - K16 per-tier security matrix completion

1. **Tier policy is now code-backed instead of implied** — PersAI gained a runtime tier security policy module that defines the operator-facing baseline for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated` in one place instead of leaving the meaning of tiers scattered across Helm values and docs.
2. **All product tiers now declare the same restricted execution boundary** — the matrix fixes `sandbox.mode=all`, Docker backend, `scope=session`, `workspaceAccess=rw`, `network=none`, `readOnlyRoot=true`, sandbox-only `exec`, and sandbox-workspace-only `write` as the current security baseline for all three product tiers.
3. **Service/platform tools are explicitly separated per tier** — `reminder_task` stays the only plan-managed service tool in the matrix, `cron` remains hidden-internal, and `persai_workspace_attach` plus `persai_tool_quota_status` are exposed as read-only platform-managed tools across tiers.
4. **Operators can now inspect the matrix directly in admin runtime settings** — `AdminRuntimeProviderSettingsState` and the `admin/runtime` page now include a read-only per-tier security matrix block, so runtime policy visibility no longer depends on reading Helm files or roadmap prose.
5. **Verification checkpoint** — contracts were regenerated, `@persai/api` typecheck passed, `@persai/web` typecheck passed, and the existing runtime settings admin test fixture was updated to the richer contract shape.

## 2026-04-04 - K16 admin/tool UX cleanup completion

1. **Tool policy classes now survive all the way into plan/admin truth** — PersAI catalog metadata now marks `persai_workspace_attach` and `persai_tool_quota_status` as `platform_managed`, and plan activation sync/backfill creates consistent non-plan-managed rows instead of pretending those tools do not exist in plan state.
2. **Server-side plan guards stayed strict** — ordinary admin plan mutations still only accept `plan_managed` tool codes, so system/internal tools cannot be toggled through raw API payloads even if a client tries to bypass the UI.
3. **Admin Plans UI now reflects the real control-plane model** — the page separates editable `plan_managed` tools from read-only `platform_managed` and `hidden_internal` groups, removing the old single-tool `cron` special case and making always-on product plumbing visible to operators without turning it into tariff clutter.
4. **Verification checkpoint** — contracts were regenerated, focused `manage-admin-plans.service.test.ts` passed, and both `@persai/api` and `@persai/web` typecheck passed after the richer tool activation contract was synced.

## 2026-04-04 - K16 file hardening baseline completion

1. **Media/file validation is no longer scattered across upload paths** — PersAI now has a shared media security policy that is used by ordinary chat upload, staged web upload, voice transcription, inbound channel attachments, and tool-output persistence.
2. **Raw generic binaries are no longer part of the normal allow path** — `application/octet-stream` now requires a verified safe type through sniffing/extension resolution instead of silently passing as an ordinary upload.
3. **Dangerous executable/script extensions are blocked explicitly** — uploads such as `.exe`, `.js`, `.sh`, `.ps1`, `.bat`, `.jar`, `.svg`, and similar risky formats are now denied by file policy before they reach normal runtime storage flow.
4. **Tool-output persistence now respects the same gate before storage** — downloaded artifacts are validated before they are re-uploaded into runtime workspace storage, so generated/downloaded tool output is no longer a late-checked bypass around the normal media policy.
5. **Runtime-side bypass paths were also narrowed** — OpenClaw runtime media upload and `persai_workspace_attach` now validate the same class of unsafe files, and the runtime-side allowed MIME list was brought back in sync with PersAI for safe audio variants such as `audio/x-opus+ogg`.
6. **Verification checkpoint** — `@persai/api` typecheck passed, `@persai/web` typecheck passed, focused `media-security-policy.test.ts` passed, focused `media-delivery.service.test.ts` passed, and focused OpenClaw `persai-runtime-file-security.test.ts` plus `persai-workspace-attach-tool.test.ts` passed. Full OpenClaw build was not used as the primary verifier on this machine because the repo build script currently fails earlier on its existing `bash`/`node` environment path setup.

## 2026-04-04 - K16 Ops Cockpit tester override completion

1. **Assistant-level tester override is now a first-class control-plane seam** — `assistant_governance` gained `assistantPlanOverrideCode`, and effective subscription precedence is now `workspace subscription -> assistant override -> assistant fallback -> catalog default -> none`.
2. **The override is honest and runtime-facing, not UI-only** — materialization now resolves the effective plan before building runtime `toolQuotaPolicy`, so a tester override changes the generated runtime plan truth instead of only changing admin visibility.
3. **Ops Cockpit now supports the actual operator workflow** — the page uses a wider layout, shows effective plan code/source/override/fallback details, and adds explicit `Apply test plan` plus `Reset to normal` actions for selected users.
4. **Billing separation is preserved** — the tester override does not mutate `workspace_subscriptions`; resetting simply clears the assistant override and returns the assistant to normal billing-driven resolution.
5. **Verification** — `@persai/api` typecheck passed, `@persai/web` typecheck passed, and focused tests passed for subscription precedence, assistant lifecycle/runtime assignment, the new admin override service, and the web assistant API client.

## 2026-04-04 - K16 graceful limit fallback completion

### What changed

1. **Quota fallback now reaches the user-facing transport cleanly** — web chat transport/runtime state now carries explicit metadata when a turn was intentionally degraded to the safe fallback model because of plan/quota pressure.
2. **The chat UI no longer hides that degraded path** — the client adds a neutral fallback-mode activity marker instead of pretending the answer came from the normal route.
3. **Fallback controls and hard-stop wording are now aligned** — admin runtime copy describes fallback as the safe lower-cost/degraded path, while `quota_limit_reached` UX is reserved for cases where no safe fallback route exists.

### Files touched

- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/web-chat.types.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/assistant-api-client.test.ts`
- `apps/web/app/admin/runtime/page.tsx`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/model/assistantWebChatRuntimeState.ts`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - K16 policy truth baseline

### What changed

1. **The old raw activation rows were no longer enough as the policy source of truth** — PersAI already computed effective tool availability, but runtime-facing deny materialization and admin plan editing still depended too directly on raw `toolActivations`, which left room for drift and hidden/internal tools leaking back into ordinary plan flows.
2. **Control-plane tool policy is now explicitly classified** — catalog metadata now distinguishes `plan_managed` tools from `hidden_internal` tools, the plan repository no longer upserts non-plan-managed rows during normal plan sync, and admin plan input now rejects attempts to edit hidden/internal tools such as `cron` through the ordinary tariff editor.
3. **Runtime deny now follows the same effective truth without losing per-tool limits** — materialized runtime tool policy is built from effective availability plus preserved daily limits, so OpenClaw still gets the correct per-tool cap data while deny activation follows the same control-plane resolution used by capability envelope reasoning and user-visible tool docs.

### Files touched

- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/application/effective-tool-availability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-tool-availability.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/test/tool-catalog-activation.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/test/manage-admin-plans.service.test.ts`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15 sandbox workspace/session boundary correction

### What changed

1. **Live sandbox behavior showed the boundary was still too coarse** — sandbox-capable pools were up, but `sandbox.scope: agent` still let multiple PersAI assistants collapse into one shared `agent:main` sandbox/workspace path, which broke the intended per-assistant writable zone.
2. **The runtime baseline now matches PersAI workspace isolation semantics** — Helm values now set sandbox scope to `session`, so each assistant/session gets its own sandbox container and workspace mount instead of silently reusing one shared agent-level sandbox.
3. **This closes a real post-rollout tail, not just a doc nuance** — the change was driven by live failure evidence (`PermissionError` / wrong workspace mount target), and it is now part of the honest sandbox baseline rather than a deferred cleanup.

### Files touched

- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

1. PersAI
2. Roll out/sync PersAI so fresh sandbox-capable pods pick up `sandbox.scope: session`
3. Verify an assistant can create/write inside its own workspace zone without widening access outside that zone

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - H15a sandbox startup budget tuning

### What changed

1. **Cold-start reality was slower than the original startup window** — fresh sandbox-capable pods can spend substantial time preloading `openclaw-sandbox*` images and bringing the gateway up before `readyz` becomes available.
2. **Probe budget is now an explicit tuned runtime parameter** — Helm values now carry `openclaw.sandboxRuntime.startupProbe` so rollout budgets live in values/config instead of as a smaller hardcoded threshold in the deployment template.
3. **This is baseline hardening for all sandbox-capable pools** — the higher startup budget is not a `paid_isolated` special case; it is a general protection against false restarts during honest cold boot and recovery.

### Files touched

- `infra/helm/templates/openclaw-deployment.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `docs/ROADMAP.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15 sandbox rootless socket correction

### What changed

1. **Live verification caught the real backend path** — the `docker:dind-rootless` sidecar was healthy, but the daemon socket lived at `/run/user/1000/docker.sock` instead of `/var/run/docker.sock`, so the initial sandbox-capable pool wiring still looked healthy while the runtime container could not talk to Docker.
2. **Helm values now match the real rootless daemon path** — `openclaw.sandboxRuntime.dockerSocketPath` and `dockerHost` now target the rootless socket path, which preserves the same architecture while making the backend actually reachable from the OpenClaw runtime container.
3. **The fix is verified from inside the live runtime container** — manual `docker version` checks now succeed in both shared sandbox pools when pointed at `unix:///run/user/1000/docker.sock`, so the remaining work is rollout/cutover validation rather than guessing at backend state.

### Files touched

- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `infra/dev/gke/RUNBOOK.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15 sandbox image supply path

### What changed

1. **The missing sandbox image is now treated as a real deploy dependency** — the active live failure was not the Docker socket anymore, but the absence of `openclaw-sandbox-common` in Artifact Registry for the approved OpenClaw SHA.
2. **Publish automation now covers the full sandbox image chain** — the OpenClaw dev-image workflow is updated to publish `openclaw`, `openclaw-sandbox`, and `openclaw-sandbox-common` for the same approved SHA instead of leaving the sandbox image outside the official GitOps supply path.
3. **Sandbox-capable pools now preload their runtime image honestly** — before the OpenClaw gateway starts, the pod can log into GAR via Workload Identity and pull the exact sandbox images into the local rootless Docker backend, so a new pod does not depend on ad hoc manual preload state.

### Files touched

- `.github/workflows/openclaw-dev-image-publish.yml`
- `infra/helm/templates/_helpers.tpl`
- `infra/helm/templates/openclaw-deployment.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `infra/dev/gitops/README.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15 sandbox auto-recovery live fixes

### What changed

1. **The live blocker moved from "image missing" to "fresh pod cannot self-recover"** — after publishing the sandbox images, new sandbox-capable pods still failed until the runtime GSA could actually read Artifact Registry and the Docker daemon could see the same bind-source paths as the OpenClaw process.
2. **Artifact Registry pull access is now part of the runtime baseline** — `openclaw-runtime` needed `roles/artifactregistry.reader` on the GAR repository so a newly rolled pod can preload `openclaw-sandbox` and `openclaw-sandbox-common` without manual operator warming.
3. **`docker-dind` now mirrors the real workspace mount surface** — the chart mounts both `workspace-gcs` and `/home/node/.openclaw/workspace` into the sidecar daemon, which removes the live `mkdir /mnt/workspaces ... permission denied` / `mkdir /home/node ... permission denied` sandbox crash path and lets new pods recover automatically after rollout.

### Files touched

- `infra/helm/templates/openclaw-deployment.yaml`
- `infra/dev/gke/RUNBOOK.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/ROADMAP.md`

### Push order

1. PersAI
2. Roll out/sync PersAI so new sandbox pool pods get the mirrored mount wiring
3. Verify the `openclaw-runtime` GSA still has `Artifact Registry reader` and confirm a fresh pod can pull sandbox images without manual `docker pull`

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15 paid-isolated sandbox parity

### What changed

1. **`paid_isolated` no longer stays outside the sandbox baseline** — after closing the shared-tier sandbox path, the isolated paid tier was still configured as a direct runtime without the same Docker-backed sandbox runtime surface.
2. **Dev truth now requires sandbox parity for the isolated tier** — `values-dev`, runtime-pool readiness, and live-test guidance now treat `paid_isolated` as another sandbox-capable pool that must enable `sandboxRuntime`, use the published sandbox images, and satisfy the same backend checks.
3. **This removes the last silent exception inside `R15e/R15g`** — the tiered runtime plan now closes with one consistent sandbox activation story across free shared, paid shared, and paid isolated lanes.

### Files touched

- `infra/helm/values-dev.yaml`
- `scripts/runtime-pools-readiness.cjs`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/ROADMAP.md`
- `docs/LIVE-TEST-HYBRID.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

1. PersAI
2. Roll out/sync PersAI so `openclaw-paid-isolated` gets the same sandbox runtime surface as the sandbox-capable shared lanes
3. Verify a fresh `paid_isolated` pod exposes `docker-dind`, sandbox image preload, and healthy `readyz`

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15 sandbox-ready shared pool baseline

### What changed

1. **Shared sandbox rollout now has a real physical path** — the chart/runtime model now distinguishes product-facing shared tiers from separate sandbox-capable physical pools, so sandbox activation no longer implies flipping the current only shared runtime in place.
2. **Sandbox backend prerequisites are now explicit in infra** — the OpenClaw dev image build path now includes Docker CLI support, sandbox-capable pool values carry a Docker-backed backend surface, and deployment wiring can mount a dedicated in-cluster Docker runtime path for those pools.
3. **Readiness/docs now enforce honest activation criteria** — `runtime-pools:readiness`, the runtime plan, roadmap, and live-test docs now treat backend/image readiness plus live route evidence as part of the sandbox activation gate, not just rendered sandbox JSON.

### Files touched

- `.github/workflows/openclaw-dev-image-publish.yml`
- `infra/helm/templates/_helpers.tpl`
- `infra/helm/templates/openclaw-configmap.yaml`
- `infra/helm/templates/openclaw-deployment.yaml`
- `infra/helm/templates/ingress.yaml`
- `infra/helm/templates/networkpolicies.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `scripts/runtime-pools-readiness.cjs`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

1. PersAI
2. Deploy/sync only after the rebuilt OpenClaw image with Docker CLI support is available and the sandbox-capable pool backend wiring is validated

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15g runtime-route observability

### What changed

1. **Live cutover proof is now explicit** — the OpenClaw adapter emits `runtime_route` log lines on real bridge calls so operators can verify which runtime host and tier were actually used for a specific assistant instead of relying only on plan defaults or healthy pods.
2. **Proof shape is stable across runtime paths** — the log includes `assistantId`, HTTP method/path, resolved runtime tier, route source, and target host, so web chat, Telegram turns, reminder/task control, memory, and media paths can all be checked with the same operational workflow.
3. **R15 docs now require evidence, not inference** — the runtime plan, roadmap, and live-test guide now treat materialized `effectiveTier` plus adapter `runtime_route` lines as the repeatable cutover proof for `R15g`.

### Files touched

- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/LIVE-TEST-HYBRID.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15d runtime assignment follow-through

### What changed

1. **Hidden single-runtime assumptions removed from support paths** — the tier-aware runtime model now reaches memory workspace actions, media upload/download/transcription paths, and reminder/cron control instead of only apply/chat/stream/channel entry points.
2. **Assistant runtime tier is now resolvable as a shared service** — a dedicated runtime-tier resolver reads the latest materialized runtime assignment so non-chat paths can reuse one canonical `effectiveTier` source.
3. **Admin ops runtime diagnostics are now tier-aware** — the ops cockpit no longer reports only one global OpenClaw host. It now surfaces the resolved runtime tier plus the effective endpoint host used for preflight/support diagnostics.
4. **Control-plane truth is now consistent with runtime helpers** — this closes the remaining `R15d` roadmap item that no admin/runtime flow may assume one permanent global runtime endpoint.

### Files touched

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts`
- `apps/api/src/modules/workspace-management/application/control-internal-assistant-reminder-task.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/application/media/inbound-media.service.ts`
- `apps/api/src/modules/workspace-management/application/media/media-delivery.service.ts`
- `apps/api/src/modules/workspace-management/application/media/media-preprocessor.service.ts`
- `apps/api/src/modules/workspace-management/application/ops-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-runtime-tier.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/web/app/admin/ops/page.tsx`
- `packages/contracts/openapi.yaml`
- `docs/ROADMAP.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15e/R15f legacy runtime removal

### What changed

1. **Legacy single-runtime config removed** — the active API config no longer uses one global `OPENCLAW_BASE_URL`; all runtime routing now requires explicit per-tier URLs for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`.
2. **Compatibility alias removed from Helm topology** — the chart no longer renders the legacy `svc/openclaw` compatibility alias. Ingress and runtime wiring now point directly to canonical pool services.
3. **Dev values now represent the full tiered runtime model** — all three canonical pools are enabled in dev values with explicit in-cluster service URLs so the next deploy/live test exercises the actual target topology instead of a compatibility layer.
4. **Readiness/runbook/live-test docs now match the new truth** — runtime pool readiness, hybrid live test instructions, and operational runbooks now reference explicit pool services instead of the removed alias/fallback path.

### Files touched

- `apps/api/.env.dev.example`
- `apps/api/.env.local.example`
- `apps/api/src/modules/workspace-management/application/runtime-endpoint-routing.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/test/openclaw-runtime-adapter.test.ts`
- `apps/api/test/runtime-endpoint-routing.test.ts`
- `packages/config/src/api-config.ts`
- `infra/helm/templates/openclaw-service.yaml`
- `infra/helm/templates/ingress.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `scripts/runtime-pools-readiness.cjs`
- `docs/API-BOUNDARY.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/ROADMAP.md`
- `docs/TEST-PLAN.md`
- `docs/LIVE-TEST-HYBRID.md`
- `infra/dev/gke/RUNBOOK.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15f adapter runtime router

### What changed

1. **Adapter routing is now tier-aware** — the OpenClaw adapter no longer assumes one permanent runtime origin. It now resolves the target base URL from the assistant's resolved runtime tier, using tier-specific env vars when configured and falling back to the compatibility alias otherwise.
2. **Resolved runtime tier now flows through runtime call sites** — apply, setup preview, web chat, web stream, and Telegram channel turns now pass the resolved runtime tier into the adapter instead of relying on one hardcoded `OPENCLAW_BASE_URL`.
3. **Inbound runtime context now exposes tier truth** — the inbound runtime context/prepare path reads the latest materialized runtime assignment and carries `effectiveTier` through the shared web and Telegram turn entry points.
4. **Config surface prepared for per-tier services** — API config and Helm values now expose `OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED`, `OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED`, and `OPENCLAW_BASE_URL_PAID_ISOLATED`. Current dev values wire `free_shared_restricted` to `openclaw-free-shared-restricted` while keeping paid tiers empty so they continue to use the compatibility alias.
5. **Focused router verification added** — new routing tests validate deterministic tier URL selection and safe fallback behavior, and API typecheck passed after the router cutover slice.

### Files touched

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-inbound-runtime-context.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-assignment.ts`
- `apps/api/src/modules/workspace-management/application/runtime-endpoint-routing.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/test/openclaw-runtime-adapter.test.ts`
- `apps/api/test/runtime-endpoint-routing.test.ts`
- `apps/api/.env.dev.example`
- `apps/api/.env.local.example`
- `packages/config/src/api-config.ts`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `docs/ROADMAP.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15e runtime pool Helm scaffolding

### What changed

1. **Helm runtime pools introduced** — `infra/helm/values*.yaml` now define `openclaw.runtimePools` with a `defaultPoolKey` plus canonical pool keys for `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`.
2. **Pool-aware OpenClaw resources** — the chart now renders per-pool OpenClaw deployments, services, and configmaps with explicit runtime-pool labels instead of assuming one permanent physical `openclaw` deployment/config forever.
3. **Compatibility alias preserved** — the legacy service name `openclaw` still points to the configured default pool, so the current adapter/config path remains stable while `R15f` router work is still pending.
4. **Network/ingress compatibility held intentionally** — the external Telegram/webhook ingress path and the current OpenClaw ingress NetworkPolicy remain tied to the default pool only. This avoids accidental traffic split before a real routing layer exists.
5. **Readiness gate added** — `runtime-pools:readiness` and `runtime-pools:readiness:strict` now verify the compatibility-phase rules: a valid default pool must exist and be enabled, and `api.env.OPENCLAW_BASE_URL` must remain on `http://openclaw:18789` until the later router cutover.

### Files touched

- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `infra/helm/templates/_helpers.tpl`
- `infra/helm/templates/openclaw-configmap.yaml`
- `infra/helm/templates/openclaw-deployment.yaml`
- `infra/helm/templates/openclaw-service.yaml`
- `infra/helm/templates/ingress.yaml`
- `infra/helm/templates/networkpolicies.yaml`
- `scripts/runtime-pools-readiness.cjs`
- `package.json`
- `docs/ROADMAP.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15d runtime assignment control-plane slice

### What changed

1. **Plan default runtime tier added** — admin plan contracts and the Plans UI now carry `runtimeTierDefault` with the three canonical Step 15 values: `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`. This makes runtime policy an explicit product control-plane field instead of an implied future infra decision.
2. **Starter plan backfill added** — the startup seed path now ensures the default `starter_trial` plan carries `runtimeTierDefault: free_shared_restricted`, so existing environments do not stay in a null/implicit state after the new control-plane field ships.
3. **Assistant override seam formalized** — assistant governance now exposes a typed parsed `runtimeTierOverride`, sourced from `policyEnvelope.runtimeAssignment.runtimeTierOverride`, so admin/rollout patches have one canonical override seam before any tier router is introduced.
4. **Materialization now emits resolved runtime assignment** — materialized governance/bootstrap state now includes the resolved runtime assignment object with `planDefaultTier`, `runtimeTierOverride`, `effectiveTier`, and `source`. This gives `R15e/R15f` a stable control-plane truth without changing the current live runtime pool yet.
5. **Docs and contracts synced** — `ROADMAP`, `OPENCLAW-SAAS-RUNTIME-PLAN`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, and the OpenAPI/generated contracts now describe the new `R15d` slice truthfully instead of treating runtime assignment as docs-only.

### Files touched

- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts`
- `apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-assignment.ts`
- `apps/api/src/modules/workspace-management/application/seed-tool-catalog.service.ts`
- `apps/api/test/runtime-assignment.test.ts`
- `apps/api/test/assistant-lifecycle-runtime-assignment.test.ts`
- `apps/web/app/admin/plans/page.tsx`
- `packages/contracts/openapi.yaml`
- `docs/ROADMAP.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-04 - R15b live verification and docs truth sync

### What changed

1. **Live rollout verified** — `persai-dev` now has fresh `api`, `web`, and `openclaw` pods on the latest rollout, with `api-internal` deployed as a dedicated ClusterIP service and both `api-ingress-baseline` and `openclaw-ingress-baseline` `NetworkPolicy` objects active in-cluster.
2. **New runtime boundary proven live** — external smoke confirms `https://api.persai.dev/health`, `https://persai.dev/`, and `https://bot.persai.dev/healthz` all return `200`, while `https://api.persai.dev/api/v1/internal/...` now returns `404` from the public ingress path.
3. **Internal listener/service split proven in-cluster** — from the live OpenClaw pod, `http://api:3001/api/v1/internal/...` returns `404`, `http://api-internal:3002/health` returns `404`, and authenticated calls to `http://api-internal:3002/api/v1/internal/...` reach the internal listener instead of the public one.
4. **OpenClaw runtime wiring confirmed** — the live OpenClaw pod resolves `PERSAI_API_BASE_URL=http://api-internal:3002`, has `PERSAI_INTERNAL_API_TOKEN` present, and mounts an `openclaw-config` that points the PersAI secret resolver to `api-internal:3002` while keeping the shared-runtime deny-list and prepared sandbox baseline active.
5. **R15b truth sync** — `docs/ROADMAP.md`, `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`, `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`, `docs/TEST-PLAN.md`, and `docs/CHANGELOG.md` now reflect the live state instead of the previous “prepared but not enforced” wording. `R15b` is now treated as complete; the remaining hardening work moves to later tiered-runtime slices rather than lingering as stale baseline blockers.

### Files touched

- `docs/ROADMAP.md`
- `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Push order

PersAI only.

### Pinned OpenClaw SHA

Unchanged — `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-03 - PersAI docs: tiered OpenClaw runtime strategy, hardening baseline, fork audit automation

### What changed

1. **New ADR (`docs/ADR/063-tiered-openclaw-runtime-and-clean-cutover.md`)** — Accepted one combined platform program for paid production: shared-runtime hardening + tiered runtime routing + GKE preparation. PersAI stays the control plane; OpenClaw stays the execution plane. Target runtime classes are `free_shared_restricted`, `paid_shared_restricted`, and `paid_isolated`. UI must choose runtime policy, not pod/service topology.

2. **New execution plan (`docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`)** — Detailed working plan with principles, runtime tiers, clean-cutover rules, GKE preparation baseline, and slice breakdown `R15a` through `R15g`. Explicitly keeps assistant “humanity” intact while moving risk controls into runtime/infra boundaries.

3. **Shared runtime hardening baseline** — Added `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md` to capture the current code-informed blockers before paid shared-runtime production: broader effective tool surface than the PersAI catalog alone, missing explicit sandbox/tool/workspace hardening in the current Helm-rendered OpenClaw config, and over-wide trust in shared internal bearer/network boundaries.

4. **Fork audit automation baseline** — Added `scripts/openclaw-fork-audit.cjs` plus root commands `openclaw:fork:audit` and `openclaw:fork:audit:strict`, and documented them in `docs/OPENCLAW-FORK-AUDIT-AUTOMATION.md`. First baseline run against the pinned OpenClaw fork SHA (`ca815889fb4a0944b98a1355e04afc58636e42f3`) reported 91 changed files, 68 implementation files, 23 high-risk implementation files, and flagged two undocumented high-risk files missing from `openclaw/docs/PERSAI-FORK-PATCHES.md`: `src/config/zod-schema.core.ts` and `src/secrets/configure.ts`.

5. **Roadmap / architecture / test-plan alignment** — `docs/ROADMAP.md` now includes **Step 15 — Tiered OpenClaw Runtime and Production Hardening**; `docs/ARCHITECTURE.md` adds the planned runtime segmentation boundary; `docs/TEST-PLAN.md` adds Step 15 verification focus (fork audit automation, shared-runtime hardening, runtime assignment, GKE reachability).

6. **Fork-diff reduction map** — Added `docs/OPENCLAW-NATIVE-REDUCTION-MAP.md` to classify what can be safely moved out of native OpenClaw over time versus what should remain native for now. Immediate candidates: migrate PersAI-managed secrets/tool credentials toward generic `exec` provider + PersAI API bridge, remove the small explicit store patch in `server-runtime-state.ts`, and stop deepening PersAI-specific native secret-configuration UX when PersAI-owned admin/config generation is enough.

7. **Shared runtime hardening baseline in Helm** — `infra/helm/templates/openclaw-configmap.yaml` now renders explicit OpenClaw `tools.deny` config from Helm values, and both `infra/helm/values.yaml` / `infra/helm/values-dev.yaml` now carry a restricted baseline that denies dangerous built-ins in shared runtime (`gateway`, `nodes`, `canvas`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `sessions_yield`, `subagents`). The same values also define a prepared restricted `agents.defaults.sandbox` shape (`network: none`, `readOnlyRoot: true`, `capDrop: ["ALL"]`, PID/memory/CPU limits), but sandbox intentionally remains `mode: "off"` for now because the current GKE deployment does not yet expose a real in-cluster sandbox backend/container strategy.

8. **Sandbox activation gate** — `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`, `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`, `docs/ROADMAP.md`, and `docs/TEST-PLAN.md` now explicitly require sandbox activation to happen through a separate canary-ready runtime path with rollback and removal steps. The prepared sandbox config must not be enabled by mutating the current only shared runtime in place.

9. **API internal listener/service split** — PersAI API now listens on a dedicated internal port (`API_INTERNAL_PORT=3002`) in addition to the public API port (`3001`). The public listener rejects `/api/v1/internal/*`, the internal listener rejects non-internal routes, Helm now renders a dedicated `api-internal` ClusterIP service, and OpenClaw runtime-facing calls (`PERSAI_API_BASE_URL`, `persaiSecretResolver.baseUrl`) now target `http://api-internal:3002`.

10. **Network-policy scaffold + safer boundary model** — `infra/helm/templates/networkpolicies.yaml` and Helm `networkPolicy` values now align with the new split topology. `openclaw` ingress can be narrowed to API pods plus explicitly allowlisted pod-visible trusted ingress CIDRs, and API ingress policy is intentionally gated on explicit public ingress CIDR configuration so `api.persai.dev` is not broken by accident.

11. **Token blast-radius split** — The runtime auth boundary is now separated into two secrets: `OPENCLAW_GATEWAY_TOKEN` is kept for `PersAI -> OpenClaw` ingress auth, while `PERSAI_INTERNAL_API_TOKEN` now authorizes `OpenClaw -> PersAI internal API` calls (`tools/check|consume`, task sync/control, cron fire, provider secret resolution, lazy freshness, Telegram bridge/status flows). Helm values/config, API auth checks, OpenClaw outbound callers, examples, and runbooks now reflect the split.

12. **Auto-sync rollout rule documented** — The central runtime plan, GitOps notes, and GKE runbook now explicitly require new secret keys to be added to source-of-truth and observed in Kubernetes **before** merge/push on an auto-synced branch. This avoids Argo CD rolling out code that already requires a missing key such as `PERSAI_INTERNAL_API_TOKEN`.

13. **CIDR / NetworkPolicy rollout gate** — Added `scripts/networkpolicy-readiness.cjs` plus root commands `networkpolicy:readiness` and `networkpolicy:readiness:strict`. The script reads Helm values, reports whether API/OpenClaw ingress policies are actually renderable with the configured CIDRs, and fails in strict mode while required CIDR inputs are still missing. Strategy docs, GitOps notes, and the GKE runbook now use it as the pre-merge/pre-rollout gate for CIDR-dependent policy changes on auto-synced branches.

14. **CIDR source-of-truth clarified** — The rollout guidance now explicitly distinguishes pod-visible trusted ingress CIDRs from raw Telegram sender CIDRs. For the current GKE Ingress-backed path, official Google Cloud Load Balancing firewall-rules guidance is treated as the primary source for pod-level ingress allowlists, while Telegram webhook ranges are supplemental only when they are actually visible at pod level behind the deployed ingress path.

15. **Canonical CIDR starter block added** — `infra/helm/values-dev.yaml` now contains a commented recommended starter block for `networkPolicy.apiIngress.publicIpBlocks`, `networkPolicy.openclawIngress.trustedIngressIpBlocks`, and optional `telegramWebhookIpBlocks`, with GKE-oriented examples and verification notes. `infra/dev/gke/RUNBOOK.md` mirrors the same block so agents can follow one canonical source instead of inventing ad hoc CIDR placeholders.

16. **Canonical pre-prod merge gate added** — `infra/dev/gke/RUNBOOK.md` now includes one explicit pre-prod checklist for agents/operators before CIDR-dependent auto-sync rollout: required secrets must already exist in source-of-truth and Kubernetes, real CIDR values must be filled in `values-dev.yaml`, `networkpolicy:readiness:strict` must pass, Helm render must succeed, and the ingress path must be checked against the documented source-of-truth. This turns the remaining deploy prep into one concrete gate instead of scattered rules.

17. **OpenClaw fork update gate added** — PersAI now includes `scripts/openclaw-fork-update-gate.cjs` plus root command `corepack pnpm run openclaw:fork:update-gate`. This wrapper runs the canonical upstream-update checks against the sibling OpenClaw repo in one place: strict fork diff audit, `scripts/verify-persai-patches.mjs`, OpenClaw `tsc --noEmit`, and plugin-sdk export validation. `docs/OPENCLAW-FORK-AUDIT-AUTOMATION.md`, `docs/OPENCLAW-PRESESSION.md`, and `docs/LIVE-TEST-HYBRID.md` now connect that gate to the targeted post-gate runtime/security smoke pack.

18. **Fork gate completed and made cross-platform-safe** — `openclaw/docs/PERSAI-FORK-PATCHES.md` now explicitly covers the previously undocumented high-risk files `src/config/zod-schema.core.ts` and `src/secrets/configure.ts`, closing the last strict-audit blockers. `scripts/openclaw-fork-update-gate.cjs` was also made Windows-safe so the canonical gate now passes end-to-end on the current maintainer environment instead of only in Unix-like PATH setups.

19. **Release notes / handoff sync** — `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/TEST-PLAN.md`, and this handoff now reflect the truthful state: `R15c` is complete, the canonical fork-update gate is green, and the next required step after it is the targeted smoke pack rather than more fork-doc debt cleanup.

20. **R15b shared-runtime tool baseline tightened** — the Helm-rendered shared OpenClaw baseline now also denies `agents_list` and `session_status`, not only `gateway`, `nodes`, `canvas`, `sessions_*`, and `subagents`. This closes the obvious remaining gap where non-product user-facing turns could still introspect agent/session metadata that PersAI does not expose as part of the governed runtime catalog.

21. **R15b shared-runtime readiness gate added** — PersAI now includes `scripts/shared-runtime-hardening-readiness.cjs` plus root commands `corepack pnpm run shared-runtime:readiness` and `corepack pnpm run shared-runtime:readiness:strict`. This gate verifies the prepared shared-runtime baseline itself (deny-list coverage, token split wiring, internal API base URLs, and prepared sandbox/resource limits) separately from CIDR-dependent `networkpolicy:readiness`, so operators can distinguish “baseline regressed” from “CIDRs are still intentionally unset”.

22. **Secret source-of-truth aligned for Step 15** — `secretmanager.googleapis.com` was enabled on the current GCP project, the `persai-openclaw-secrets` source-of-truth object was created in Google Secret Manager, and `PERSAI_INTERNAL_API_TOKEN` was synced into `persai-dev/persai-openclaw-secrets`. This closes the earlier operational blocker where the runtime hardening code depended on a required secret key that was still absent from Kubernetes.

### Files touched

- `docs/ADR/063-tiered-openclaw-runtime-and-clean-cutover.md`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`
- `docs/OPENCLAW-FORK-AUDIT-AUTOMATION.md`
- `docs/OPENCLAW-NATIVE-REDUCTION-MAP.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `infra/helm/templates/openclaw-configmap.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`
- `package.json`
- `scripts/openclaw-fork-audit.cjs`
- `openclaw/docs/PERSAI-FORK-PATCHES.md`
- `openclaw/src/agents/persai-runtime-tool-limits.ts`
- `openclaw/src/agents/tools/cron-tool.ts`
- `openclaw/src/agents/tools/persai-tool-quota-status-tool.ts`
- `openclaw/src/agents/tools/reminder-task-tool.ts`
- `openclaw/src/config/config.secrets-schema.test.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-freshness.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-freshness.test.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-heartbeat-model.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-provider-profile.test.ts`
- `openclaw/src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `openclaw/src/secrets/resolve.ts`
- `openclaw/src/secrets/resolve.test.ts`
- `infra/dev/gitops/openclaw-approved-sha.txt`

### Push order

1. `openclaw` `main` first.
2. `PersAI` `main` second — pin must match the pushed OpenClaw SHA; CI can rebuild/re-pin the OpenClaw image digest.

### Pinned OpenClaw SHA

- `31ec4f70d76eebfef933754934ee922c9d094c11`

---

## 2026-04-03 - PersAI Web: landing redesign, setup personality presets, welcome chat, memory pagination

### What changed

1. **Landing page (`apps/web/app/page.tsx`)** — Premium minimalist first-screen: full-viewport aurora background (`<canvas>` animated), typographic manifesto headline (two-line, weight contrast), EN/RU locale switcher (`LandingLocaleSwitcher`), platform badge strip (Telegram active with pulse dot, VK/WhatsApp/MAX dimmed with brand colours and "soon" label). No scroll on first screen; responsive desktop and mobile.

2. **Setup wizard — gender step (`apps/web/app/app/setup/page.tsx`)** — Default gender pre-selected to `"neutral"` (was `null`). Grid layout fixed to `grid-cols-3` (was `grid-cols-2 sm:grid-cols-4`, caused button pileup).

3. **Setup wizard — personality step** — 9 locale-aware personality presets (3 per gender: neutral/male/female) defined in `apps/web/app/app/_components/assistant-persona.ts` (`PersonaPreset` interface, `PERSONA_PRESETS` map). Presets carry `labelKey`, `descKey`, `traits`, and `buildInstructions(name, user, locale)` that returns EN or RU instruction text based on the `persai-locale` cookie. Sliders fine-tune traits only; preset selection updates the instructions textarea (not the other way around). "Custom" (4th button) clears preset selection. Avatar portrait shown on step 2. EN/RU switcher added to setup header.

4. **Welcome chat** — On first visit after assistant create/recreate (detected via `chats.length === 0` + no existing `surfaceThreadKey="welcome"` chat), `use-chat.ts` fires `sendWelcome(locale)` which streams an assistant-only turn with `welcomeTurn: true` and `welcomeLocale`. Backend (`send-web-chat-turn.service.ts`) stores sentinel `__welcome_init__` to DB; `stream-web-chat-turn.service.ts` injects locale-resolved instruction (`resolveWelcomeTurnInstruction`) to OpenClaw instead of the sentinel. Frontend `loadHistory` filters out the sentinel so it is never visible. `welcomeTriggeredRef` prevents double-fire within a session.

5. **Memory history pagination (`apps/web/app/app/_components/assistant-settings.tsx`)** — History tab shows 10 most-recent items initially; "Load more (N)" button appends 10 more per click. Counter resets on memory reload. Backend unchanged (fetches up to 80 desc by `createdAt`).

6. **Pre-commit gates** — All 4 gates pass: lint (removed stale `eslint-disable react-hooks/exhaustive-deps` comment, removed unused `WELCOME_TURN_SENTINEL` import from stream service), format (prettier applied to 4 files), api typecheck, web typecheck. All 17 web tests + all API test suites pass.

### Files touched

- `apps/web/app/page.tsx`
- `apps/web/app/_components/landing-locale-switcher.tsx`
- `apps/web/app/app/setup/page.tsx`
- `apps/web/app/app/_components/assistant-persona.ts`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/chat/page.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ru.json`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`

### Push order

PersAI only (no OpenClaw fork changes in this session).

### Pinned OpenClaw SHA

Unchanged — `bf913e276fd52ec4ac3d1259cf8ba50afef4e0b2`

---

## 2026-04-03 - PersAI/OpenClaw: setup preview moved to ephemeral runtime seam

### What changed

1. **PersAI API** — `PreviewAssistantSetupService` no longer calls the normal runtime lifecycle (`cleanupWorkspace` + `applyMaterializedSpec` + `sendWebChatTurn` + cleanup again) for setup preview. It now materializes transient artifacts and sends them to a dedicated adapter method `previewSetupTurn`.
2. **OpenClaw fork** — added `POST /api/v1/runtime/chat/web/preview`, backed by a preview-only executor that:
   - validates transient bootstrap/tool-policy payloads
   - writes bootstrap docs into a temp preview workspace root
   - runs one embedded PersAI web turn
   - cleans the isolated preview session key
   - deletes the temp preview workspace root
   This path does **not** write to the applied spec store and does **not** touch the live assistant workspace.
3. **Docs** — added ADR-062 and updated architecture/API/test docs so setup preview is explicitly modeled as an ephemeral runtime seam rather than "almost normal apply".
4. **Tests** — added PersAI regression coverage that preview does not use live apply/cleanup/web-turn methods; added OpenClaw preview executor coverage and adapter coverage for the new endpoint.

### Files touched

- `PersAI`: `docs/ADR/062-ephemeral-setup-preview-runtime-seam.md`, `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`, `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`, `apps/api/src/modules/workspace-management/application/preview-assistant-setup.service.ts`, `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`, `apps/api/test/openclaw-runtime-adapter.test.ts`, `apps/api/test/preview-assistant-setup.service.test.ts`
- `openclaw`: `src/gateway/persai-runtime/persai-runtime-preview.ts`, `persai-runtime-preview.test.ts`, `persai-runtime-turn-context.ts`, `persai-runtime-http.ts`, `persai-runtime-workspace.ts`, `persai-runtime-session-cleanup.ts`, `src/gateway/server-http.ts`, `docs/PERSAI-FORK-PATCHES.md`

### Push order

1. **openclaw** `main` first.
2. **PersAI** `main` second — pin must match the pushed OpenClaw SHA; CI can rebuild/re-pin the OpenClaw image digest.

### Pinned OpenClaw SHA

- `ca815889fb4a0944b98a1355e04afc58636e42f3`

---

## 2026-04-03 - PersAI: abuse unblock + quota reconciliation + ops logs; OpenClaw: Telegram fenced markdown HTML

### What changed

1. **PersAI API** — `EnforceAbuseRateLimitService`: when quota pressure is **not** active, persisted `quota_pressure_temporary_block` / `quota_pressure_slowdown` rows no longer stick until `ABUSE_TEMP_BLOCK_SECONDS` (plan/limit fixes take effect on next request). `AdminAccessContext.hasGlobalPlatformAdminScope`: global `ops_admin|security_admin|super_admin` (`app_user_admin_roles.workspace_id` null) may `POST /api/v1/admin/abuse-controls/unblock` for assistants in **any** workspace; workspace-scoped admins unchanged. `AdminAbuseControlsController` `@HttpCode(200)` (Nest default 201 broke admin UI). `ApiExceptionFilter`: `unhandled_http_exception` pino logs for non-`HttpException` with `requestId`, path, stack. `ManageAdminAbuseControlsService` audit uses **assistant** `workspaceId`. Tests: `enforce-abuse-rate-limit`, `admin-authorization`, `manage-admin-abuse-controls`.
2. **PersAI Web** — `postAdminAbuseUnblock`: `isSuccessStatus` (200|201) + typed success body.
3. **OpenClaw fork** — `telegram-assistant-markdown-html.ts` / tests: fence language classes, fence-aware segmentation, oversized fence split for packing; `docs/PERSAI-FORK-PATCHES.md` §15.
4. **Ops** — `apps/api/scripts/k8s-snapshot-abuse.cjs` (optional DB snapshot helper for abuse/quota rows).
5. **Docs** — `docs/CHANGELOG.md`, `docs/API-BOUNDARY.md`, `docs/ADR/044-abuse-and-rate-limit-enforcement-g2.md` (post-acceptance section), `docs/TEST-PLAN.md`.

### Files touched

- `openclaw`: `telegram-assistant-markdown-html.ts`, `.test.ts`, `docs/PERSAI-FORK-PATCHES.md`
- `PersAI`: abuse/admin/api-exception/web client/services/controllers, `apps/api/test/*.ts`, `apps/api/scripts/k8s-snapshot-abuse.cjs`, `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`, `docs/API-BOUNDARY.md`, `docs/ADR/044-abuse-and-rate-limit-enforcement-g2.md`, `docs/TEST-PLAN.md`

### Push order

1. **openclaw** `main` first.
2. **PersAI** `main` second — pin must match pushed OpenClaw SHA; CI can repin OpenClaw image digest.

### Pinned OpenClaw SHA

- `bf913e276fd52ec4ac3d1259cf8ba50afef4e0b2`

---

## 2026-04-03 - OpenClaw: Telegram outbound HTML (parseMode markdown)

### What changed

1. **Fork** — `telegram-outbound-chunks.ts` (shared limit + `splitTelegramOutboundText`); `telegram-assistant-markdown-html.ts` converts assistant markdown-ish text to safe Telegram HTML and packs messages; `sendTelegramReplyWithConfiguredParseMode` uses `parse_mode: HTML` for `markdown` bootstrap mode (no raw MarkdownV2); entity parse errors fall back to `lossyPlainFromTelegramHtml`. Tests + `verify-persai-patches.mjs` + `PERSAI-FORK-PATCHES.md` §17.
2. **PersAI** — `docs/API-BOUNDARY.md` materialization semantics; Telegram connect UI footnote (i18n EN/RU); dev pin `b6239197d384dc4bf99a9e76cd6bc5cb61d31919`.

### Files touched

- `openclaw`: `telegram-outbound-chunks.ts`, `telegram-assistant-markdown-html.ts`, `.test.ts` files, `persai-runtime-telegram.ts`, `docs/PERSAI-FORK-PATCHES.md`, `scripts/verify-persai-patches.mjs`
- `PersAI`: `docs/API-BOUNDARY.md`, `apps/web/messages/en.json`, `ru.json`, `telegram-connect.tsx`, `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Push order

1. **openclaw** `main` first (includes prior unpushed chunking commit + this commit).
2. **PersAI** `main` second.

### Pinned OpenClaw SHA

- `b6239197d384dc4bf99a9e76cd6bc5cb61d31919`

---

## 2026-04-03 - OpenClaw: Telegram outbound text split (4096 limit)

### What changed

1. **Fork** — `persai-runtime-telegram.ts`: `splitTelegramOutboundText` + `TELEGRAM_BOT_API_MAX_MESSAGE_LENGTH`; `sendTelegramReplyWithConfiguredParseMode` sends multiple `ctx.reply` chunks when needed; multi-chunk path is plain text (MarkdownV2 only for single-chunk replies). Tests + `verify-persai-patches.mjs` + `PERSAI-FORK-PATCHES.md` §15.
2. **PersAI** — Dev pin `66136ec5edc9bfc2d372c132d95123e650162510`.

### Files touched

- `openclaw`: `persai-runtime-telegram.ts`, `persai-runtime-telegram.test.ts`, `docs/PERSAI-FORK-PATCHES.md`, `scripts/verify-persai-patches.mjs`
- `PersAI`: `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Push order

1. **openclaw** `main` first.
2. **PersAI** `main` second.

### Pinned OpenClaw SHA

- `66136ec5edc9bfc2d372c132d95123e650162510`

---

## 2026-04-02 - OpenClaw: `persai_workspace_attach` + Telegram media path resolution

### What changed

1. **Fork** — Tool `persai_workspace_attach` (`src/agents/tools/persai-workspace-attach-tool.ts`): validates a workspace-relative file (≤25MB), returns `details.media.mediaUrls` as storage paths relative to `workspace/media` (e.g. `chat/foo.png` or `../SOUL.md`). Registered from `createOpenClawTools` when PersAI context has `assistantId` and `workspaceDir`. `persai_workspace_attach` added to `TRUSTED_TOOL_RESULT_MEDIA`. `resolvePersaiWorkspaceMediaStoragePath` exported from `persai-runtime-media.ts`; `deliverTelegramMedia` uses it instead of resolving only under `media/`.
2. **PersAI** — Dev pin updated to OpenClaw commit `2a5f9b939d4a0031b01b5868ed730e67fd13e3e9`. `generateToolsMd` / catalog adds a one-line hint for `persai_workspace_attach`.

### Files touched

- `openclaw`: `persai-workspace-attach-tool.ts`, `openclaw-tools.ts`, `pi-embedded-subscribe.tools.ts`, `persai-runtime-media.ts`, `persai-runtime-telegram.ts`, tests, `docs/PERSAI-FORK-PATCHES.md`, `scripts/verify-persai-patches.mjs`
- `PersAI`: `materialize-assistant-published-version.service.ts`, `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Push order

1. **openclaw** `main` first.
2. **PersAI** `main` second — pin must match pushed OpenClaw SHA.

### Pinned OpenClaw SHA

- `2a5f9b939d4a0031b01b5868ed730e67fd13e3e9`

---

## 2026-04-03 - Admin bootstrap preset `tools` (TOOLS.md wrapper + `{{tools_catalog_block}}`)

### What changed

- Fifth preset id **`tools`**: default template in `prisma/bootstrap-preset-data.ts`; `VALID_PRESET_IDS` driven from that map; `MaterializeAssistantPublishedVersionService` interpolates **`{{tools_catalog_block}}`** with plan-generated active/disabled limits + Live usage. `SeedToolCatalogService.syncBootstrapPresets` backfills missing preset rows only (adds `tools` on upgrade without wiping edits). Admin UI `/admin/presets`: TOOLS.md editor + sample preview for `tools_catalog_block`. Docs: `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`.

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`, `manage-bootstrap-presets.service.ts`, `materialize-assistant-published-version.service.ts`, `seed-tool-catalog.service.ts`, `apps/web/app/admin/presets/page.tsx`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

---

## 2026-04-03 - OpenClaw: live tool quota read (`persai_tool_quota_status` + API check)

### What changed

1. **Fork** — New runtime tool `persai_tool_quota_status` (`src/agents/tools/persai-tool-quota-status-tool.ts`): `POST` to PersAI `/api/v1/internal/runtime/tools/check` with `assistantId` (+ optional `toolCode`), same bearer as `consume`. Registered from `createOpenClawTools` only when PersAI `assistantId` is present in request context. Docs: `docs/PERSAI-FORK-PATCHES.md` §2 + PersAI-only file list; `scripts/verify-persai-patches.mjs` checks.
2. **PersAI API** — `CheckInternalRuntimeToolDailyLimitService`, `POST .../tools/check` on `InternalRuntimeToolQuotaController`; `generateToolsMd` adds “Live usage” / call `persai_tool_quota_status` note. `docs/API-BOUNDARY.md` describes the check seam.

### Files touched

- `openclaw`: `src/agents/tools/persai-tool-quota-status-tool.ts`, `src/agents/openclaw-tools.ts`, `docs/PERSAI-FORK-PATCHES.md`, `scripts/verify-persai-patches.mjs`
- `PersAI`: `apps/api/.../check-internal-runtime-tool-daily-limit.service.ts`, `internal-runtime-tool-quota.controller.ts`, `workspace-management.module.ts`, `materialize-assistant-published-version.service.ts`, `test/internal-runtime-tool-quota.controller.test.ts`, `docs/API-BOUNDARY.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`, `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`

### Push order

1. **openclaw** `main` first — note the new commit SHA.
2. **PersAI** `main` second — pin files must match that SHA; CI rebuilds OpenClaw image.

### Ready commit message (openclaw)

- `feat(persai): persai_tool_quota_status + fork docs for quota check`

### Ready commit message (PersAI)

- `feat(api): internal runtime tools/check + TOOLS.md quota hint; docs; pin OpenClaw 72db7474e2`

### Pinned OpenClaw SHA

- `72db7474e2735b7c1b395ce5b01fad6409e45536`

---

## 2026-04-03 - OpenClaw: Telegram voice — no duplicate text before sendVoice

### What changed

1. **Fork** — `sendTelegramAssistantTurnReply`: if `turnResult.media` includes voice note (`audio` + `audioAsVoice`), skip `ctx.reply` text; still run `deliverTelegramMedia` for **all** items (image, audio file, video, document unchanged).

### Files touched

- `openclaw`: `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `PersAI`: `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Push order

1. **openclaw** `main` first
2. **PersAI** `main` second

### Ready commit message (PersAI)

- `chore(infra): pin OpenClaw 32f3ffb618 — Telegram voice without duplicate text`

---

## 2026-04-03 - OpenClaw: Telegram webhook timeout (duplicate photo turns)

### What changed

1. **Fork** (`openclaw`) — `webhookCallback(bot, "http", …)` now sets `timeoutMilliseconds` from `getTelegramWebhookHandlerTimeoutMs()` (default 55s, env `PERSAI_TELEGRAM_WEBHOOK_HANDLER_TIMEOUT_MS`, max 58s) and `onTimeout: "return"` so Telegram does not see 500 after 10s while a vision/LLM turn is still running.
2. **PersAI** — `infra/dev/gitops/openclaw-approved-sha.txt` and `infra/helm/values-dev.yaml` (`openclaw.image.tag`, `digest` cleared) point at the new fork SHA for rebuild/repin.

### Files touched

- `openclaw`: `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `PersAI`: `infra/dev/gitops/openclaw-approved-sha.txt`, `infra/helm/values-dev.yaml`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Push order

1. Push **openclaw** `main` first.
2. Push **PersAI** `main` second (CI rebuilds OpenClaw image for the new SHA).

### Ready commit message (PersAI)

- `chore(infra): pin OpenClaw c231d42d59 — Telegram webhook timeout fix`

---

## 2026-04-02 - Auth: redirect if already signed in on `/sign-in` or `/sign-up`

### What changed

1. **`RedirectSignedInUserToApp`** — Full `replace` navigation to `/app` (or safe `redirect_url`) when an active Clerk session opens these routes manually.
2. **`/sign-in`** — After `useAuth` loads, `isSignedIn` → redirect component; otherwise existing form + post-login `navigateAfterClerkAuth` unchanged.
3. **`/sign-up`** — Order: loading spinner → if `signUp.status === "complete"` still **`SignUpCompleteSplash` → `/app/setup`** (first registration); else if `isSignedIn` → redirect to `/app` (returning users). Does not affect the verify → finalize → setup path.

### Files touched

- `apps/web/app/app/_components/redirect-signed-in-to-app.tsx` (new)
- `apps/web/app/sign-in/[[...sign-in]]/page.tsx`, `sign-up/[[...sign-up]]/page.tsx`
- `apps/web/messages/en.json`, `ru.json` (`redirectingSignedIn`)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Ready commit message

- `fix(web): redirect signed-in users away from sign-in and sign-up`

---

## 2026-04-02 - Fix: sign-up redirected to sign-in instead of `/app/setup`

### What changed

1. **Root cause** — After sign-up, `router.push("/app")` triggered the `/app` RSC before Clerk cookies were reliably on the request; `auth()` in `app/page.tsx` sent users to `/sign-in` while the client already had a session (“already signed in”).
2. **Fix** — `navigateAfterClerkAuth` (`window.location.assign` / `replace`) after `signUp.finalize` and on the sign-up complete splash; targets **`/app/setup`** for new users. Google sign-up `redirectUrl` → `/app/setup`. SSO callback `finalizeSignUp` → `/app/setup`. Sign-in `finalize` uses the same full navigation and **`getSafeRedirectPathFromSearch`** for `redirect_url` (restricted to `/app` and `/admin` prefixes).

### Files touched

- `apps/web/app/lib/clerk-navigation.ts` (new)
- `apps/web/app/sign-up/[[...sign-up]]/page.tsx`, `sign-in/[[...sign-in]]/page.tsx`, `sso-callback/page.tsx`
- `apps/web/app/app/_components/chat-message.tsx`, `voice-message-player.tsx` (voice bar width alignment — same commit batch)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Ready commit message

- `fix(web): post-sign-up full navigation to /app/setup (session cookie race)`

---

## 2026-04-02 - Web voice UX: one bubble, no visible transcript, Telegram-style player

### What changed

1. **API — merge staged attachments into the real user turn** — New `MergeStagedWebChatAttachmentsService`: after `PrepareAssistantInboundTurnService` creates the user message with transcript (web only), attachments on recent “staging-only” user rows (empty content or legacy `(attached: …)`, within 5 minutes) are reassigned to that message and staging rows are deleted. Staging `content` from `ManageChatMediaService.stageForWebThread` is now `""` instead of `(attached: filename)`. Prepare returns `userMessage.attachments` populated from the DB after merge.
2. **Web — immediate playable audio** — `use-chat` sets `localPreviewUrl` via `createObjectURL` for audio/video; each `stageWebChatAttachment` response replaces the matching local row with server attachment id (revoke blob). Stream `onCompleted` applies `transport.userMessage.attachments` when present.
3. **Web — UI** — User messages with `audio`/`voice` attachments no longer render the text body (transcript still sent to API). `VoiceMessagePlayer`: compact play/pause, seek bar, duration. New strings in `messages/en.json` and `messages/ru.json`.

### Files touched

- `apps/api/src/modules/workspace-management/application/merge-staged-web-chat-attachments.service.ts` (new)
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/web/app/app/_components/voice-message-player.tsx` (new)
- `apps/web/app/app/_components/chat-message.tsx`, `use-chat.ts`
- `apps/web/messages/en.json`, `apps/web/messages/ru.json`
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Risks

- Chats created **before** deploy may still show two user rows (staging + transcript) until those threads age out; new turns use the merged shape.
- Merge window is 5 minutes; an abandoned staging row older than that is not merged into a later unrelated turn.

### Next steps

- Manual smoke: record voice → play immediately → refresh → one bubble, no transcript line, player works.

### Ready commit message

- `feat(web,api): voice message UX — merge staging, Telegram-style player`

---

## 2026-04-02 - Docs: `OPENCLAW_ADAPTER_TIMEOUT_MS` aligned with code (90s default)

### What changed

1. **Config default** — `packages/config/src/api-config.ts` already uses Zod default `90000` for `OPENCLAW_ADAPTER_TIMEOUT_MS`; `apps/api/.env.local.example` and `.env.dev.example` use `90000`.
2. **Documentation** — `docs/API-BOUNDARY.md`, `README.md`, `docs/LIVE-TEST-HYBRID.md`, `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md` updated: dev Helm and code default are both **90s**; removed stale references to `15000` / “code default 3000, dev overrides”.
3. **CHANGELOG** — Unreleased entry records the doc + default alignment.

### Files touched

- `docs/API-BOUNDARY.md`, `README.md`, `docs/LIVE-TEST-HYBRID.md`, `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`
- (prior slice) `packages/config/src/api-config.ts`, `apps/api/.env.local.example`, `apps/api/.env.dev.example`

### Risks

- Longer default wait on hung OpenClaw when env omits override; mitigated by explicit lower `OPENCLAW_ADAPTER_TIMEOUT_MS` for fast-fail workflows.

### Next steps

- If stream still cuts off in browser, investigate GCLB / BackendConfig idle timeouts separately from adapter timeout.

### Ready commit message

- `docs(config): align OPENCLAW_ADAPTER_TIMEOUT_MS docs with 90s default`

---

## 2026-04-02 - UI/UX MVP polish + i18n localization (EN + RU)

### What changed

1. **Mobile chat UX** — responsive sidebar with hamburger toggle, touch-friendly message bubbles, bottom-anchored input, safe-area padding for mobile web.
2. **Auto chat naming** — new chats derive title from first ~50 characters of the user's initial message instead of showing a technical ID (backend: `PrepareAssistantInboundTurnService.createChat`).
3. **Custom authentication UI** — replaced all prebuilt Clerk components (`<SignIn />`, `<UserButton />`, `<UserProfile />`) with fully custom pages using Clerk hooks (`useSignIn`, `useSignUp`, `useUser`, `useClerk`). New pages: `/sign-in`, `/sign-up`, `/sso-callback`, `/app/profile`.
4. **Clerk theme integration** — `ClerkProvider` `appearance` prop wired to CSS variables (`--accent`, `--surface-raised`, etc.) + safety-net CSS overrides in `globals.css`.
5. **Color theme refinements** — warm green accent palette, resolved dark-theme muddiness and light code-block visibility issues.
6. **i18n localization (EN + RU)** — installed `next-intl`; created `i18n/request.ts` (cookie → Accept-Language → fallback), `messages/en.json` (~300+ strings, 12 namespaces), `messages/ru.json` (product-quality Russian, friendly "ты" tone). All user-facing components migrated to `useTranslations`/`getTranslations` with `t()` calls. `assistant-persona.ts` refactored to translation keys. `LocaleSwitcher` in sidebar.

### Files touched

- `apps/web/app/app/_components/app-shell.tsx` (i18n)
- `apps/web/app/app/_components/assistant-persona.ts` (labelKey refactor)
- `apps/web/app/app/_components/assistant-settings.tsx` (i18n)
- `apps/web/app/app/_components/chat-area.tsx` (i18n + mobile UX)
- `apps/web/app/app/_components/chat-input.tsx` (i18n + mobile UX)
- `apps/web/app/app/_components/chat-message.tsx` (i18n)
- `apps/web/app/app/_components/home-dashboard.tsx` (i18n)
- `apps/web/app/app/_components/sidebar.tsx` (i18n + locale switcher + mobile)
- `apps/web/app/app/_components/telegram-connect.tsx` (i18n)
- `apps/web/app/app/profile/page.tsx` (i18n + custom profile)
- `apps/web/app/app/setup/page.tsx` (i18n)
- `apps/web/app/layout.tsx` (NextIntlClientProvider + ClerkProvider appearance)
- `apps/web/app/globals.css` (Clerk overrides + theme)
- `apps/web/app/page.tsx` (landing i18n + custom auth link)
- `apps/web/app/sign-in/[[...sign-in]]/page.tsx` (custom sign-in + i18n)
- `apps/web/app/sign-up/[[...sign-up]]/page.tsx` (custom sign-up + i18n)
- `apps/web/app/sso-callback/page.tsx` (i18n)
- `apps/web/i18n/request.ts` (new — next-intl config)
- `apps/web/messages/en.json` (new — English strings)
- `apps/web/messages/ru.json` (new — Russian strings)
- `apps/web/next.config.ts` (next-intl plugin)
- `apps/web/package.json` (next-intl dependency)
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts` (auto chat naming)
- `docs/ROADMAP.md` (S14f, S14g items)
- `docs/UI-SPEC.md` (auth, theme, i18n, mobile, tech stack)
- `docs/ARCHITECTURE.md` (auth boundary, i18n boundary sections)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`
- `pnpm-lock.yaml`

### Risks

- `next-intl` adds a server-side locale resolution step on every request; negligible perf impact but introduces a cookie dependency for locale persistence.
- Russian translations are product-written but not proofread by a native speaker — may need minor copy adjustments.
- Custom Clerk auth UI depends on Clerk hook API stability; major Clerk upgrades may require form logic updates.

### Next steps

- Smoke test both locales (EN/RU) end-to-end in deployed environment.
- Verify mobile responsiveness on real devices (iOS Safari, Android Chrome).
- Consider adding more locales if user demand appears.
- Push and deploy.

---

## 2026-04-02 - Infra: public domain persai.dev + unified GKE Ingress

### What changed

1. **Global static IP** — reserved `persai-dev-ip` (`34.8.195.135`) via `gcloud compute addresses create --global`.
2. **Unified Ingress** — new `infra/helm/templates/ingress.yaml` replaces the single-purpose `openclaw-ingress.yaml`. Routes three hosts through one GCE L7 LB:
   - `persai.dev` → web:3000
   - `api.persai.dev` → api:3001
   - `bot.persai.dev/telegram-webhook` → openclaw:18789
3. **ManagedCertificates** — new `infra/helm/templates/managed-certificates.yaml` provisions Google-managed TLS certs for all three domains.
4. **values-dev.yaml** — added `ingress` section (hosts, staticIpName, certificates); uncommented `TELEGRAM_WEBHOOK_BASE_URL: "https://bot.persai.dev"` to switch Telegram from polling to webhook.
5. **DNS** — A records for `persai.dev`, `api.persai.dev`, `bot.persai.dev` configured in Reg.ru pointing to `34.8.195.135`.
6. **Deprecated** `openclaw-ingress.yaml` — replaced by comment; telegram webhook route moved into unified ingress.

### Files touched

- `infra/helm/templates/ingress.yaml` (new — unified ingress for web/api/bot)
- `infra/helm/templates/managed-certificates.yaml` (new — 3 Google-managed TLS certs)
- `infra/helm/templates/openclaw-ingress.yaml` (deprecated — replaced by unified ingress)
- `infra/helm/values-dev.yaml` (ingress section, TELEGRAM_WEBHOOK_BASE_URL uncommented)
- `infra/dev/gitops/README.md` (updated Ingress documentation)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Risks

- ManagedCertificate provisioning takes 10–30 minutes after DNS propagation; HTTPS unavailable until then.
- Telegram webhook activation depends on ArgoCD syncing the updated API deployment with `TELEGRAM_WEBHOOK_BASE_URL`. Until sync, Telegram stays on polling.
- Removing `openclaw.telegramWebhook.host` and `managedCertificate` from values breaks the old template, but old template is now a no-op comment.

### Next steps

- Verify HTTPS works on all three domains after certificate provisioning completes.
- Confirm Telegram switches to webhook mode after ArgoCD sync (check OpenClaw logs for `[persai-telegram] Webhook set`).
- Smoke test web UI at `https://persai.dev/app`.

---

## 2026-04-02 - UI polish, voice UX, Clerk proxy, ROADMAP update

### What changed

1. **Code syntax highlighting** — integrated `highlight.js` into web chat code blocks with 16 registered languages and custom dark/light token color schemes.
2. **Theme refresh** — green accent palette replacing purple/indigo, warmer neutral tones across dark and light modes.
3. **Voice recording UX** — client-side silence detection (bytes/sec ratio < 1000 for recordings >= 2s) now shows "No speech was detected in your recording" with guidance to check microphone settings, instead of the generic "Chat could not complete this turn" error. Server-side empty-transcription errors also map to the same message.
4. ~~**Clerk CDN proxy** — `next.config.ts` adds a rewrite for `/clerk-cdn/*` to self-host the Clerk JS bundle; `clerk.browser.js` added to `public/`.~~ Superseded by H10: migrated to Clerk production instance with custom domain + API route proxy.
5. **Diagnostic log cleanup** — removed temporary `transcribeVoice` logging from `ManageChatMediaService`.
6. **ROADMAP update** — Step 14 expanded with S14a–S14e items (persona identity, setup preview, admin ops, TTS refactor, bug fixes).

### Files touched

- `apps/web/app/app/_components/chat-message.tsx` (highlight.js integration)
- `apps/web/app/app/_components/chat-input.tsx` (silence detection)
- `apps/web/app/app/assistant-api-client.ts` (voice error mapping)
- `apps/web/app/globals.css` (theme + hljs tokens)
- `apps/web/app/page.tsx` (inlined sign-in button)
- `apps/web/next.config.ts` (Clerk CDN proxy rewrite)
- `apps/web/package.json` (`highlight.js`, `@clerk/clerk-js`)
- `apps/web/public/clerk.browser.js` (new — self-hosted Clerk bundle)
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts` (removed diag logs)
- `docs/ROADMAP.md` (Step 14 items)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`
- `pnpm-lock.yaml`

### Risks

- Silence detection threshold (1000 bytes/sec) is heuristic; very quiet but valid recordings may trigger the warning. Can be tuned.
- ~~Self-hosted `clerk.browser.js` will need periodic updates when upgrading `@clerk/clerk-js`.~~ Superseded by H10: self-hosted bundles removed.

### Next steps

- Smoke test voice recording with correct microphone.
- Web chat audio player for tool-generated TTS mp3.
- Consider workspace file delivery tool for assistant.

---

## 2026-04-02 - Feat: Admin full user delete + cron cleanup

### What changed

1. **Admin user delete** — full cascade delete from Ops Cockpit.
   - `DELETE /api/v1/admin/ops/users/:userId` → `AdminDeleteUserService`: runtime workspace reset, then single DB transaction deleting all user-owned data (rollout items, abuse states, attachments, messages, chats, memory, tasks, specs, published versions, bindings, governance, assistant, audit nullify, members, admin roles, workspace if orphaned, user).
   - Self-delete protection.
   - Frontend: trash icon with Yes/No confirmation in user table.

2. **Phantom cron cleanup** — cleared all 5 stale cron jobs from OpenClaw pod `jobs.json` (4 disabled test reminders + 1 legacy main-agent recurring task).

### Files touched

- `apps/api/src/modules/workspace-management/application/admin-delete-user.service.ts` (new)
- `apps/api/src/modules/workspace-management/interface/http/admin-ops.controller.ts` (DELETE endpoint)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` (provider)
- `apps/api/src/modules/identity-access/identity-access.module.ts` (route)
- `apps/web/app/admin/ops/page.tsx` (delete button + confirmation)
- `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, `docs/UI-SPEC.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Risks

- Cascade delete is irreversible; self-delete guard prevents accidental admin removal.
- Runtime workspace reset is best-effort (continues on failure).
- Cron cleanup is pod-local; new deployment gets fresh `jobs.json` from GCS FUSE mount.

### Next steps

- Smoke test delete on a test user.
- Consider adding step-up token for destructive delete action.

---

## 2026-04-02 - Refactor: TTS directive path → tool-call-only path

### What changed

Replaced the unreliable `[[tts:…]]` directive-based TTS pipeline with the native tool-call path. Model now calls the `tts` tool directly instead of embedding directives in response text.

- **Config:** `tts.auto: "off"` in Helm — disables directive parsing and removes the "Use [[tts:…]]" hint from system prompt.
- **OpenClaw gateway cleanup:** removed `resolveAgentResponseWithTts`, `normalizeTtsDirectives`, `stripTtsDirectives`, `createTtsDeltaStripper`, `flushTtsDeltaStripper`, and related imports from `persai-runtime-agent-turn.ts`. All three turn functions (web sync, telegram, stream) now use plain `resolveAgentResponse()`.
- **OpenClaw native cleanup:** removed `outputDir` pass-through from `maybeApplyTtsToPayload` in `tts.ts` (no longer called from gateway).
- **PersAI cleanup:** removed `stripTtsDirectives` from `StreamWebChatTurnService`.
- **Kept:** `outputDir` in `textToSpeech` and `tts-tool.ts` — required by the tool-call path to write mp3 to shared workspace (`/mnt/workspaces/persai/<assistantId>/media/tts/`).

### Why

The directive path was fundamentally fragile:

- Model generated directives in unpredictable formats (`[[tts:text]]`, `[[tts:content]]`, `[[tts]]content[[/tts]]`).
- Parsing/stripping code couldn't cover all variants reliably.
- Different users got different behavior depending on session history.
- The tool-call path is a stable API contract: model calls `tts(text)`, OpenClaw generates audio, returns result. Same behavior for all users.

### Files touched

- `openclaw/src/gateway/persai-runtime/persai-runtime-agent-turn.ts` (515 → 377 lines, directive code removed)
- `openclaw/src/tts/tts.ts` (`maybeApplyTtsToPayload` `outputDir` removed)
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` (`stripTtsDirectives` removed)
- `infra/helm/values-dev.yaml` (`tts.auto: "off"`)
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Risks

- If a model or prompt variant still generates `[[tts:…]]` directives, they will appear as raw text (no stripping). Mitigated by: `tts.auto: off` removes the system prompt hint, and fresh sessions have no directive history.
- Requires assistant reset for users who have old directive patterns in session context.

### Next steps

- Deploy: push OpenClaw first, then PersAI.
- Smoke test: web chat (text only, voice via tool, stop voice) + Telegram same.
- Web chat audio player for tool-generated mp3 (currently shows `[Голосовой ответ готов и отправлен.]` placeholder).

---

## 2026-04-02 (superseded) - Fix: [[tts:…]] directive leakage in web chat + cross-channel TTS breakage

**Superseded by the directive→tool-call migration above.** The directive pipeline and all associated fixes have been removed.

---

## 2026-04-01 - Feat: Admin Ops Cockpit — user directory + per-user reapply

### What changed

Extended the Admin Ops Cockpit with a user directory table and per-user reapply capability.

- Backend: `AdminOpsUserDirectoryService` — paginated user list with assistant summary via `GET /api/v1/admin/ops/users`.
- Backend: `POST /api/v1/admin/ops/users/:userId/reapply` — reuses existing `ReapplyAssistantService` to reapply any user's assistant.
- Frontend: compact user table with search (debounce 300ms), pagination (20/page), per-row Reapply button. Clicking a row loads that user's cockpit (assistant, apply, runtime) below; "Show self" returns to admin's own view.
- `GET /admin/ops/cockpit` now accepts optional `?userId=` to load cockpit for any user.
- Routes registered in `ClerkAuthMiddleware` and `WorkspaceManagementModule`.

### Files touched

- `apps/api/src/modules/workspace-management/application/admin-ops-user-directory.service.ts` (new)
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts` (callerUserId/targetUserId split)
- `apps/api/src/modules/workspace-management/interface/http/admin-ops.controller.ts` (extended)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` (provider added)
- `apps/api/src/modules/identity-access/identity-access.module.ts` (routes added)
- `apps/web/app/admin/ops/page.tsx` (rewritten with UsersDirectory + user-scoped cockpit)
- `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`, `docs/UI-SPEC.md`

### Risks

- No schema changes, no migrations needed — reads existing `app_users` + `assistants` + `assistant_published_versions`.
- Reapply endpoint reuses proven `ReapplyAssistantService`; no new side effects.
- Admin role gate inherited from existing ops/cockpit pattern.

### Next steps

- Smoke test on dev: search users, verify reapply triggers correctly.
- Consider adding admin authorization check (currently relies on auth middleware pattern, same as ops/cockpit).

---

## 2026-04-01 - Feat: gender-based TTS voice + fix web voice transcription

### What changed

1. **Gender→voice mapping in OpenClaw fork** — TTS providers now read `persona.assistantGender` from workspace spec and pick gender-appropriate default voices (OpenAI: `onyx`/`nova`; Yandex: `filipp`/`alena`). Falls back to config/default voice when gender is `neutral` or unset.
2. **ffmpeg added to API Dockerfile** — web voice turns failed with "Chat could not complete this turn" because `ffmpeg` was missing from the container, causing webm→mp3 conversion to fail with `spawn ffmpeg ENOENT` and `/voice/transcribe` to return 400.

### Files touched

**OpenClaw (fork SHA `943157182d`):**

- `src/agents/persai-runtime-context.ts` — +`assistantGender` field, +`getPersaiAssistantGender()` getter
- `src/gateway/persai-runtime/persai-runtime-http.ts` — +`extractAssistantGenderFromWorkspace()`, pass gender to all 3 agent turn callsites
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — +`assistantGender` param in 3 turn functions + runtimeCtx
- `src/tts/providers/openai.ts` — gender→voice lookup before config default
- `src/tts/providers/yandex.ts` — gender→voice lookup before config default

**PersAI:**

- `apps/api/Dockerfile` — added `ffmpeg` to `apt-get install`
- `infra/dev/gitops/openclaw-approved-sha.txt` → `943157182d…`
- `infra/helm/values-dev.yaml` → `openclaw.image.tag` updated, digest cleared
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Verification

- OpenClaw: `npx tsc --noEmit` — pass
- PersAI: pre-commit gate (lint, format, typecheck) — pending

### Risks

- Gender voice mapping is additive; neutral/unset falls back to existing defaults — no regression for existing assistants.
- ffmpeg adds ~50 MB to API Docker image; acceptable trade-off for correct voice transcription.

### Next steps

- Smoke test web voice recording and TTS output for male/female/neutral assistants after deploy.
- Verify Yandex TTS responds with `filipp` for male-gendered assistants.

---

## 2026-04-01 - Feature/Fix: setup runtime preview + assistant identity enrichment

### What changed

Assistant create/recreate/edit now share a fuller assistant identity model and a real runtime-backed final preview.

- Added `assistantGender` across Prisma schema, domain entities, assistant draft/published snapshot state, OpenAPI contracts, generated client types, setup UI, and assistant settings UI.
- Assistant gender choices are now constrained to `female`, `male`, and `neutral`; legacy `other` is normalized away from API/bootstrap output.
- Added `PreviewAssistantSetupService` plus `POST /api/v1/assistant/setup/preview`; the setup last step now materializes a transient runtime workspace, asks the assistant to introduce itself, returns that response, and cleans the preview workspace immediately after.
- Refactored `MaterializeAssistantPublishedVersionService` to expose reusable runtime artifact building so preview and publish use the same bootstrap/materialization path.
- Fixed `/me` state propagation so recreate/setup correctly prefills `displayName`, `birthday`, `gender`, and timezone-related onboarding values instead of name only.
- Setup now exposes the same free-form personality text as edit, auto-seeded from sliders until the user customizes it.
- Custom assistant avatar upload now keeps a local preview blob during setup, uploads the real file only on final create, and persists backend `avatarUrl` instead of any local `blob:` URL.
- Assistant avatar rendering now caches authorized blob URLs client-side to avoid visible re-download/repaint lag on repeated mounts.
- Removed legacy `app-flow.client.tsx` and `app-flow.client.test.tsx`; added focused `setup/page.test.tsx`.

### Verification

- `corepack pnpm --filter @persai/web run test -- app/app/setup/page.test.tsx app/app/page.test.tsx`
- `corepack pnpm --filter @persai/web run lint`
- `corepack pnpm --filter @persai/api run lint`
- Web and API typecheck were already passing before the final test rerun in this session.

### Known issues

- `vitest` still logs a jsdom warning (`Not implemented: navigation to another Document`) during the setup test because the page triggers navigation semantics that jsdom does not fully implement; the suite still passes.
- `POST /assistant/reset` remains a full-wipe reset in current code and docs now reflect that source of truth; if product semantics change later, both docs and recreate UX assumptions must be updated together.

### Next steps

- Run a full workspace verification pass (`typecheck` / broader tests) before merging if you want whole-repo confidence beyond the focused setup/edit coverage.
- Smoke test create, reset, recreate, and edit flows against a real runtime/backend environment to confirm preview latency and avatar caching feel acceptable outside jsdom.

---

## 2026-04-01 - Fix: web voice placeholder fallback

### What changed

Web voice messages no longer send a fake `(voice message)` turn when transcription is empty or fails.

- `manage-chat-media.service.ts` — empty STT output now returns a validation error instead of passing an empty string through as a successful transcription.
- `assistant-api-client.ts` — voice transcription now preserves the backend error message instead of collapsing to a generic failure.
- `chat-input.tsx`, `chat-area.tsx`, `use-chat.ts` — the UI now shows the transcription failure in the normal issue banner and skips sending the voice turn instead of falling back to placeholder text.
- Dev OpenClaw image pin was then advanced to `786879fddda3ee05f756a0afe670dd412a460913` to keep PersAI aligned with the latest fork commit per deploy process.

### Known issues

- The current API image still logs `ffmpeg ENOENT` for some web voice conversion attempts; this no longer creates a fake chat turn, but conversion tooling should still be present in the container for best STT quality.

### Next steps

- Retest web voice with both short and longer recordings after deploy.

---

## 2026-04-01 - Fix: Telegram first-photo hallucination + Yandex IAM lookup pin bump

### What changed

Two follow-up fixes after the initial media/TTS stabilization:

**1. PersAI: force image inspection for inbound image attachments (1 file):**

- `inbound-media.service.ts` — image attachments now add an explicit instruction to inspect the file with the `image` tool before answering and to avoid guessing from filename/path alone.
- This targets the Telegram bug where the first photo reply could be nonsense, while the second retry became correct.

**2. OpenClaw: exact Yandex IAM credential lookup (1 file):**

- `src/tts/providers/yandex.ts` — `YANDEX_IAM_TOKEN` and `YANDEX_FOLDER_ID` now resolve via exact credential key lookup instead of provider fallback, preventing accidental reuse of `YANDEX_TTS_API_KEY`.

**3. Dev GitOps pin bump:**

- `infra/dev/gitops/openclaw-approved-sha.txt`
- `infra/helm/values-dev.yaml`
- Dev OpenClaw image pin bumped to `566bdd5aafbe001bcbe3e09e37b2eabda6da0c60`.

### Known issues

- This improves first-turn image reliability, but if Telegram photo replies still vary after deploy, the next place to inspect is the native multimodal prompt/attachment injection path inside OpenClaw rather than PersAI download timing.

### Next steps

- Deploy and retest Telegram photo analysis on the first message.
- Retest Yandex TTS in web and Telegram after the new OpenClaw image rolls out.

---

## 2026-04-01 - Fix: tool credentials config refresh + web audio transcription

### What changed

Two critical fixes for Yandex TTS and web voice transcription:

**1. PersAI: tool credential changes now bump `configGeneration` (1 file):**

- `manage-admin-tool-credentials.service.ts` — injected `BumpConfigGenerationService`, called after saving credentials. Without this, saving Yandex TTS API key + provider in admin UI never triggered bootstrap rematerialization — OpenClaw kept using the old `providerId: "openai"`.

**2. OpenClaw: explicit audio MIME in transcribe handler (1 file):**

- `persai-runtime-media.ts` — webm files were misclassified as "video" by extension-based detection, preventing audio transcription. Now infers `audio/*` MIME from file extension before calling `transcribeAudioFile`.

**3. PersAI: web file preprocessing + audio conversion (1 file, from previous session):**

- `manage-chat-media.service.ts` — `stageForWebThread` now runs `MediaPreprocessorService.process()` on upload (audio transcription, PDF text extraction, image normalization). `transcribeVoice` converts webm/ogg→mp3 via ffmpeg before upload.

### Known issues

- Yandex TTS requires `YANDEX_FOLDER_ID` env var if using IAM token auth (API key auth may not need it depending on service account binding).
- After deploy, admin must re-save tool credentials (or change any credential) to trigger the config generation bump for existing assistants.

### Next steps

- Deploy and verify Yandex TTS + web voice transcription end-to-end.
- Consider adding `YANDEX_FOLDER_ID` to PersAI admin tool credentials UI as a separate field.

---

## 2026-04-01 - Fix: TTS provider selection (Yandex/ElevenLabs/OpenAI)

### What changed

PersAI admin provider selection was broken — `getTtsProvider()` in OpenClaw never saw the chosen provider. Fixed by propagating `toolProviderOverrides` through the PersAI runtime context.

**OpenClaw changes (7 files):**

- `persai-runtime-context.ts` — added `toolProviderOverrides` field + `getPersaiToolProviderOverride()` helper
- `persai-runtime-tool-policy.ts` — added `extractToolProviderOverrides()` extractor
- `persai-runtime-agent-turn.ts` — all 3 turn functions propagate overrides to context
- `persai-runtime-http.ts` — all 3 HTTP handlers extract overrides from bootstrap
- `tts.ts` — `getTtsProvider()` checks PersAI override first; added `YANDEX_TTS_API_KEY` to primary lookup
- `providers/yandex.ts` — added `YANDEX_TTS_API_KEY` to primary env var lookup
- `tts.test.ts` — 2 new tests (Yandex override + precedence over env)

**PERSAI-FORK-PATCHES.md:** patch #22 added.

### Known issues

- None.

### Next steps

- Deploy and verify Yandex TTS works end-to-end.
- Consider adding voice/model selection UI in PersAI admin for OpenAI TTS.

---

## 2026-04-01 - Unified media pipeline (ADR-060)

### What changed

Replaced fragmented per-channel media logic with a unified three-service architecture:

**New services** (all in `apps/api/src/modules/workspace-management/application/media/`):

- `MediaPreprocessorService` — normalizes all inbound media before storage: audio webm/ogg→mp3 (ffmpeg), image heic→jpg + resize (sharp), PDF text extraction, video audio track STT. Single point for all format handling.
- `InboundMediaService` — unified `resolve()` method replaces `buildAttachmentContext` (web) and `enrichMessageWithAttachments` (telegram). Preprocesses → stores → creates attachment records → builds model context block.
- `MediaDeliveryService` — unified `deliver()` method replaces `persistToolMediaAttachments` (duplicated in stream + sync services). Downloads tool output → re-uploads to permanent storage → creates attachment records → delegates to channel adapter.
- `ChannelMediaAdapter` interface — `WebMediaAdapter` (no-op, proxy-based), `TelegramMediaAdapter` (bridge-delegated). Adding WhatsApp/VK = one new file.

**Refactored consumers:**

- `StreamWebChatTurnService` — uses `InboundMediaService.buildContextForExistingAttachments()` + `MediaDeliveryService.deliver()`. Removed `persistToolMediaAttachments`, `buildAttachmentContext`, `inferMimeType` private methods.
- `SendWebChatTurnService` — same refactoring as stream service.
- `HandleInternalTelegramTurnService` — uses `InboundMediaService.resolve()` instead of inline `enrichMessageWithAttachments` + `persistTelegramAttachments`.

**ADR:** `docs/ADR/060-unified-media-pipeline-preprocessor-delivery-inbound.md`

### Known issues

- `sharp` and `pdf-parse` are optional runtime dependencies — if not installed, image/PDF processing degrades gracefully (passthrough).
- `ffmpeg` must be available in container PATH for audio conversion (already present in current images).
- Telegram inbound media flow now downloads files from workspace storage to get Buffer for preprocessing — adds one extra IO hop vs the old direct-persist path. This is intentional: all channels go through the same preprocessing pipeline.

### Next steps

- Deploy and verify web + Telegram media flows work end-to-end through the new pipeline.
- Install `sharp` and `pdf-parse` in API container if not already present.
- ~~Fix Yandex TTS provider selection~~ — done (see session entry above).
- Fix web voice webm transcription (now handled by MediaPreprocessor audio normalization).

---

## 2026-03-31 - Fix: stream race condition — media NDJSON event was never emitted

### What changed

- Removed lifecycle `end` event handler from `runPersaiWebRuntimeAgentTurnStream` that was prematurely closing the HTTP response before `resolveAgentResponse` could extract and write the `{ type: "media" }` NDJSON event.
- The `finally` block already handled closing properly — the lifecycle handler was redundant and caused the `if (closed) return` guard to skip media extraction.
- Fork SHA: `43bcb54ab7891803e7b4e2e376640febc2bcf58c`.
- PERSAI-FORK-PATCHES.md updated (patch #18), verify-persai-patches.mjs updated (85/85 pass).

### Known issues

- None.

### Next steps

- Verify generated images now appear in web chat after this fix is deployed.

---

## 2026-03-31 - Fix: tool-generated media routing to user workspace

### What changed

- OpenClaw `saveMediaBuffer` now takes optional `baseDirOverride` — `image_generate` uses it to write directly to `workspaceDir/media/tool-image-generation/` instead of the ephemeral `.openclaw-state/media/` dir (TTL=2min).
- `resolveMediaFilePath` in the PersAI gateway bridge now accepts any path under `PERSAI_WORKSPACE_ROOT`, so the download proxy serves tool media correctly.
- PersAI `ClerkAuthMiddleware` now covers attachment upload/download/voice transcribe routes (was causing 401 on file uploads).
- Fork SHA: `f6b5d02a7c6cee60ef9397a2f0005614502abaeb`.
- PERSAI-FORK-PATCHES.md updated (patch #17), verify-persai-patches.mjs updated (84/84 pass).

### Known issues

- None introduced by this fix.

### Next steps

- Push OpenClaw first, then PersAI. CI will rebuild OpenClaw image and re-pin digest.

---

## 2026-03-31 - M-series implementation complete (M1–M7, ADR-059)

### What changed

All 7 milestones of the M-series (media, attachments, voice) are implemented and TypeCheck-clean across both repos.

**M1 — Media foundation:**

- Prisma: `assistant_chat_message_attachments` table, `media_storage_bytes` quota dimension, `AttachmentType`/`AttachmentProcessingStatus` enums, migration
- `AssistantChatMessageAttachmentRepository` (create, findByMessageIds, findById, deleteByMessageIds, deleteByChatId, deleteByAssistantId)
- `ManageChatMediaService` (upload/download business logic)
- `MediaAttachmentController` (upload + download proxy endpoints)
- OpenClaw bridge: `persai-runtime-media.ts` (workspace media upload/download/delete-chat/transcribe HTTP handlers)
- Runtime adapter: `uploadChatMedia`, `downloadChatMedia`, `deleteChatMedia`, `deleteChatMediaBatch`, `transcribeMedia`
- Extended `hardDeleteChat` with media cleanup, `resetAssistant` with attachment row deletion
- `mediaClasses` capability activation from plan entitlements
- `media_storage_bytes` quota tracking

**M2 — Tool media delivery (web chat):**

- OpenClaw bridge: `resolveAgentResponse` extracts `{ text, media[] }` from payloads, NDJSON `media` event after `done`
- PersAI adapter: parses `media[]` from sync response and stream events
- Send/stream services: download tool media, re-upload to permanent storage, create attachment rows
- Web UI: `AttachmentStrip` component renders images, audio, video, documents in message bubbles
- Message history load includes attachments

**M3 — Web voice messages:**

- Web UI: microphone button, `MediaRecorder` API (opus/webm), recording timer, transcription spinner
- OpenClaw bridge: `POST /api/v1/runtime/workspace/media/transcribe` (calls `transcribeAudioFile`)
- PersAI adapter: `transcribeMedia(assistantId, storagePath)`
- `ManageChatMediaService.transcribeVoice` with temp file cleanup
- PersAI API: `POST /api/v1/assistant/voice/transcribe` endpoint
- Web client: `transcribeVoice()` API call

**M4 — Web file/image upload:**

- Web UI: activated paperclip button, file picker, preview chips, optimistic local blob URLs
- Upload happens asynchronously after streaming turn completes
- `AttachmentStrip` renders all media types in user messages

**M5 — Telegram inbound media:**

- OpenClaw bridge: `bot.on("message:voice")`, `bot.on("message:photo")`, `bot.on("message:document")` handlers
- Downloads via Grammy `getFile`, stores in workspace, STT for voice
- Forwards structured `attachments[]` to PersAI internal turn
- PersAI: `AssistantChatSurface` enum extended to `web | telegram`
- `HandleInternalTelegramTurnService`: finds/creates Telegram chats, creates user messages, persists attachment rows

**M6 — Telegram outbound media:**

- `requestPersaiTelegramTurn` returns `{ text, media[] }` instead of plain string
- `deliverTelegramMedia`: sends `sendPhoto`/`sendVoice`/`sendAudio`/`sendVideo`/`sendDocument` via Grammy `InputFile`
- All 4 handlers (text, voice, photo, document) deliver media after text reply

**M7 — Yandex SpeechKit TTS:**

- New provider: `src/tts/providers/yandex.ts` (SpeechKit v1 REST API, oggopus + mp3, API-Key + IAM Token auth)
- Registered in `provider-registry.ts`, `TTS_PROVIDERS`, `ResolvedTtsConfig.yandex`
- Config types: `TtsConfig.yandex` in `types.tts.ts`
- Secret collector: `runtime-config-collectors-tts.ts` handles `yandex.apiKey`
- Env fallbacks: `TOOL_PROVIDER_ENV_FALLBACKS.tts.yandex` in `persai-runtime-context.ts`
- PersAI already had Yandex wired in `TOOL_PROVIDER_OPTIONS` — no PersAI changes needed

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `AssistantChatMessageAttachment` model, `AttachmentType`/`AttachmentProcessingStatus` enums, `WorkspaceQuotaDimension.media_storage_bytes`, `AssistantChatSurface.telegram`
- `apps/api/prisma/migrations/20260403100000_step13_m1_media_attachments_foundation/migration.sql`
- `apps/api/prisma/migrations/20260403200000_step14_m5_telegram_chat_surface/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-chat-message-attachment.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-chat-message-attachment.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat-message-attachment.repository.ts`
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/media-attachment.controller.ts`
- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/application/web-chat.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-capability-state.service.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-chat.entity.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**PersAI frontend:**

- `apps/web/app/app/assistant-api-client.ts` — attachment upload, download URL, transcribeVoice
- `apps/web/app/app/_components/use-chat.ts` — attachments in ChatMessage, optimistic upload, history hydration
- `apps/web/app/app/_components/chat-input.tsx` — file picker, voice recording, preview chips
- `apps/web/app/app/_components/chat-area.tsx` — sendPrompt with files, transcribe callback
- `apps/web/app/app/_components/chat-message.tsx` — AttachmentStrip component

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-media.ts` (new — media upload/download/delete/transcribe)
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — resolveAgentResponse with media extraction
- `src/gateway/persai-runtime/persai-runtime-http.ts` — sync response includes media[]
- `src/gateway/persai-runtime/persai-runtime-telegram.ts` — inbound voice/photo/document handlers, outbound media delivery
- `src/gateway/server-http.ts` — registered media + transcribe endpoints
- `src/tts/providers/yandex.ts` (new — Yandex SpeechKit TTS provider)
- `src/tts/provider-registry.ts` — registered Yandex provider
- `src/tts/tts.ts` — Yandex in TTS_PROVIDERS, ResolvedTtsConfig.yandex, resolveTtsApiKey, resolveTtsConfig
- `src/config/types.tts.ts` — TtsConfig.yandex section
- `src/secrets/runtime-config-collectors-tts.ts` — Yandex apiKey collector
- `src/agents/persai-runtime-context.ts` — Yandex env fallbacks in TOOL_PROVIDER_ENV_FALLBACKS

### Tests run

- `npx tsc --noEmit` — PersAI API (clean)
- `npx tsc --noEmit` — PersAI Web (clean at each milestone)
- `npx tsc --noEmit` — OpenClaw (clean)

### Risks

1. GCS FUSE latency (~5-15ms per file op) acceptable for current scale; direct GCS API with signed URLs can be swapped later.
2. Post-completion media delivery means tool-generated images appear only after full streaming turn completes.
3. Voice STT adds OpenAI Whisper API cost per voice message — governed by existing quota/tool-limit infrastructure.
4. Telegram media delivery is sequential (one `sendPhoto`/`sendVoice` per media item); sufficient for current scale.
5. Migrations need `prisma migrate deploy` on running DB before deployment.

### Next recommended step

- Deploy and test M-series end-to-end on dev environment (run migrations, verify upload/download/voice/Telegram flows).
- Step 14 tech debt: H11 (WhatsApp/MAX readiness), H14 (fork-diff reduction), H15 (GKE tuning), H16 (heartbeat isolation).
- Configure Yandex SpeechKit API key in admin tool credentials UI to activate Yandex TTS.

---

## 2026-03-31 - ADR-059: Systemic media, attachments, and voice plan (M-series)

### What changed

- Added ADR-059 (`docs/ADR/059-systemic-media-attachments-voice-m-series.md`) defining the full M-series architecture for universal media support across all channels (web, Telegram, future WhatsApp/MAX).
- Added Step 13 (M-series) to `docs/ROADMAP.md` with 7 slices (M1-M7) and sub-tasks.
- Updated `docs/ARCHITECTURE.md` with media boundary section.
- Updated `docs/API-BOUNDARY.md` with media endpoint contracts.
- Updated `docs/DATA-MODEL.md` with `assistant_chat_message_attachments` table and quota extension.
- Updated `docs/TEST-PLAN.md` with M-series test focus.
- Updated `docs/CHANGELOG.md`.

### Files touched

**PersAI:**

- `docs/ADR/059-systemic-media-attachments-voice-m-series.md` (new)
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Key architectural decisions

- **Separate table** (`assistant_chat_message_attachments`) over JSONB for clean quota aggregation, async processing status, and lifecycle management.
- **Post-completion media delivery** with natural model status text ("Generating image...") during tool execution — no fake inline binary streaming.
- **Existing workspace storage** (GCS FUSE) for media files under `<assistantId>/media/<chatId>/<messageId>/`.
- **Existing STT** (`transcribeAudioFile` / Whisper) for voice message transcription — no new STT infrastructure.
- **Existing TTS** (OpenAI, ElevenLabs, Microsoft) + new Yandex SpeechKit provider (1 new native OpenClaw file).
- **`mediaClasses` capabilities** activated from plan entitlements instead of hardcoded false.
- Native OpenClaw change in the M-series stayed intentionally small, centered on Yandex TTS support and a few runtime fixes/seams; the majority of the work remained PersAI-side or in PersAI bridge files.

### Slice dependency graph

```
M1 (foundation) ─┬─► M2 (tool media web) ─► M4 (web file upload)
                  ├─► M3 (web voice) ───────► M5 (Telegram inbound) ─► M6 (Telegram outbound)
                  └─► M7 (Yandex TTS) [independent]
```

### Risks

1. GCS FUSE latency (~5-15ms per file op) may be noticeable for large media; can swap to direct GCS API with signed URLs later without API/DB changes.
2. Post-completion delivery means images appear only after full response; acceptable tradeoff for reliability.
3. Seven slices require sustained focus; partial delivery (M1-M2) still provides value.

### Historical next step at that time

- Begin M1: Prisma migration for `assistant_chat_message_attachments`, repository, workspace media endpoints in OpenClaw bridge, upload/download API, cleanup integration, quota dimension.

---

## 2026-03-31 - Tool credential provider selection (web_search + tts)

### What changed

- **Fork** (`kurock09/openclaw`): commit `552dff354331f2a6a56e4cecea16d63f81e2e7d1`
- Admin can now choose which provider a tool credential targets instead of the hardcoded Tavily/OpenAI defaults.
- Supported provider selections:
  - `web_search`: Tavily (default), Brave, Perplexity, Google (Gemini)
  - `tts`: OpenAI (default), ElevenLabs, Yandex SpeechKit
- Provider selection is stored as a separate encrypted entry in the existing `platform_runtime_provider_secrets` table using a convention key (`tool_web_search__provider`), avoiding DB migration.
- OpenClaw bridge (`persai-runtime-tool-policy.ts`) uses `PROVIDER_ENV_OVERRIDES` map to resolve the correct env var dynamically based on `providerId` from the bootstrap payload.
- Admin UI shows a provider dropdown only for tools with >1 provider option.

### Files touched

**PersAI:**

- `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-tool-credentials.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/web/app/admin/tools/page.tsx`
- `infra/dev/gitops/openclaw-approved-sha.txt`
- `infra/helm/values-dev.yaml`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-tool-policy.ts` (PersAI-only bridge file, zero merge risk)

### Risks

- Yandex SpeechKit now has native OpenClaw provider support; remaining risk is operational correctness of runtime credential resolution and deployment pinning, not provider absence.
- Existing users with a Tavily key and no explicit provider selection will continue to work (default = tavily).

---

## 2026-03-31 - Systemic PersAI runtime tool credential resolution

### What changed

- **Fork** (`kurock09/openclaw`): commit `67d2503d999a61c5b13882001a302d8a81305a61`
- OpenClaw runtime credential lookup for PersAI-managed tools is now centralized instead of relying on scattered per-tool fallbacks:
  - `persai-runtime-context.ts` now exposes a shared `resolvePersaiToolCredentialForEnvVars(...)` helper and tracks the active tool name in request-local context
  - server-side tool execution now runs inside `withPersaiActiveTool(...)`, so generic provider-auth code can resolve the right tool-specific PersAI credential at runtime
  - provider auth now checks request-scoped PersAI tool credentials before global `process.env`
- This fixes the concrete runtime gap where PersAI-managed keys could exist in bootstrap/runtime context but still not be consumed by native OpenClaw execution:
  - `web_search` now prefers the provider that actually has a PersAI-injected credential, even when stale runtime metadata points at another provider
  - `tts` now resolves PersAI-managed OpenAI / ElevenLabs credentials during provider auto-pick and synthesis
  - `image_generate` mount-time auth inference now sees PersAI-managed image-generation credentials
  - `web_fetch` Firecrawl auth now uses the same shared runtime resolver
  - `memory_search` / embedding-provider auth now resolves PersAI-managed embeddings credentials through the same central auth path
- PersAI admin plan UI now explains "cost-driving tools" in plain language and renames the toggles to clearer labels for allow vs quota-governed behavior.
- Fork-maintenance docs were updated so future upstream merges can verify this native patch explicitly instead of rediscovering it by breakage.

### Files touched

**PersAI:**

- `apps/web/app/app/app-flow.client.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `infra/dev/gitops/openclaw-approved-sha.txt`
- `infra/helm/values-dev.yaml`

**OpenClaw:**

- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`
- `src/agents/persai-runtime-context.ts`
- `src/agents/pi-tool-definition-adapter.ts`
- `src/agents/model-auth-env.ts`
- `src/agents/tools/model-config.helpers.ts`
- `src/agents/tools/image-generate-tool.ts`
- `src/agents/tools/image-generate-tool.test.ts`
- `src/agents/tools/web-fetch.ts`
- `src/agents/model-auth.profiles.test.ts`
- `src/tts/tts.ts`
- `src/tts/tts.test.ts`
- `src/tts/providers/openai.ts`
- `src/tts/providers/elevenlabs.ts`
- `src/web-search/runtime.ts`
- `src/web-search/runtime.test.ts`

### Tests run

- **OpenClaw**
- `corepack pnpm exec tsc --noEmit --pretty false`
- `corepack pnpm exec vitest run --config vitest.unit.config.ts src/tts/tts.test.ts`
- `corepack pnpm exec vitest run --config vitest.unit.config.ts src/web-search/runtime.test.ts`
- `corepack pnpm exec vitest run --config vitest.config.ts src/agents/tools/image-generate-tool.test.ts`
- `corepack pnpm exec vitest run --config vitest.config.ts src/agents/model-auth.profiles.test.ts -t "honors PersAI|honors active memory_search"`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. This is an intentional native OpenClaw patch because the final provider/tool auth resolution happens inside runtime execution; PersAI alone cannot force native provider selection/auth lookup to honor request-scoped credentials after the turn enters OpenClaw.
2. Full `src/agents/model-auth.profiles.test.ts` in upstream OpenClaw still has two unrelated red cases (`legacy oauth.json` timeout and stale `openai-codex/gpt-5.4` expectation); the new PersAI credential-resolution assertions inside that file were run separately and passed.

## 2026-03-31 - Assistant runtime session hygiene order

### What changed

- **Fork** (`kurock09/openclaw`): commit `06e69c278cefdfc406bdae8200f4d9841ed4276d`
- Web assistant turns no longer create new runtime sessions in the legacy `main` agent bucket:
  - OpenClaw now derives PersAI web session keys as `agent:persai:<assistantId>:web:<chatId>:<surfaceThreadKey>`
  - that keeps new web turns in `agents/persai/sessions/...` alongside Telegram instead of defaulting into `agents/main/sessions/...`
- Full assistant reset is now stricter:
  - it still clears assistant workspace/spec/memory
  - it now also purges assistant session entries from both the current `persai` store and legacy `main` store leftovers
  - transcript files are removed directly instead of being left behind as `*.jsonl.reset...` archives
- Hard-delete web chat now clears runtime context too:
  - PersAI calls a new runtime seam `POST /api/v1/runtime/chat/web/session/delete`
  - OpenClaw removes the matching assistant web session from current and legacy stores before PersAI deletes the chat from DB

### Files touched

**PersAI:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/test/openclaw-runtime-adapter.test.ts`
- `apps/api/test/manage-web-chat-list.service.test.ts`
- `docs/API-BOUNDARY.md`
- `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `infra/dev/gitops/openclaw-approved-sha.txt`
- `infra/helm/values-dev.yaml`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-session.ts`
- `src/gateway/persai-runtime/persai-runtime-session.test.ts`
- `src/gateway/persai-runtime/persai-runtime-session-cleanup.ts`
- `src/gateway/persai-runtime/persai-runtime-session-cleanup.test.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.test.ts`
- `src/gateway/server-http.ts`

### Tests run

- `pnpm exec vitest run src/gateway/persai-runtime/persai-runtime-session.test.ts src/gateway/persai-runtime/persai-runtime-agent-turn.test.ts src/gateway/persai-runtime/persai-runtime-session-cleanup.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm exec tsx test/openclaw-runtime-adapter.test.ts`
- `pnpm exec tsx test/manage-web-chat-list.service.test.ts`
- `pnpm run typecheck`

### Risks

1. Reset now aggressively deletes assistant transcript files instead of archiving them, so operator-side forensic recovery of reset state is intentionally reduced.
2. Legacy `main` cleanup uses assistant-id matching to purge old traces; that is the right product behavior for reset hygiene, but it should remain scoped to assistant lifecycle paths and not be generalized into unrelated core session pruning.

## 2026-03-31 - Bootstrap and heartbeat hygiene

### What changed

- Assistant-scoped `BOOTSTRAP.md` is now truly one-time:
  - fresh assistant workspace apply still creates it
  - after the first successful web or Telegram assistant turn, PersAI calls a new runtime bridge seam `POST /api/v1/runtime/workspace/bootstrap/consume`
  - OpenClaw deletes `BOOTSTRAP.md` and writes a tiny consumed marker so later ordinary applies do not recreate it in that same workspace
- Full reset/recreate behavior is preserved:
  - `resetWorkspace` still deletes the whole assistant workspace
  - recreate/reset therefore clears the consumed marker too
  - the next fresh apply into the new workspace writes a fresh `BOOTSTRAP.md` again
- Heartbeat/background polling is now separated from user turn flow:
  - OpenClaw heartbeat runs in a dedicated `:heartbeat` session instead of the main user chat session
  - bootstrap-file filtering now treats heartbeat sessions like other background contexts, so stale `BOOTSTRAP.md` no longer bleeds into background runs as phantom user traffic
- Background heartbeat model selection is less confusing:
  - when no explicit heartbeat model override is configured, OpenClaw now asks PersAI internal endpoint `GET /api/v1/internal/runtime/provider-settings/default`
  - if PersAI global runtime settings are active, heartbeat uses that admin default model instead of only the local OpenClaw fallback
  - if PersAI global settings are not active / unavailable, fallback remains the native OpenClaw configured default

### Files touched

**PersAI:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `apps/api/test/openclaw-runtime-adapter.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`
- `docs/SESSION-HANDOFF.md`
- `docs/TEST-PLAN.md`

**OpenClaw:**

- `src/agents/workspace.ts`
- `src/agents/workspace.test.ts`
- `src/gateway/persai-runtime/persai-runtime-heartbeat-model.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-workspace.ts`
- `src/gateway/persai-runtime/persai-runtime-workspace.test.ts`
- `src/gateway/server-http.ts`
- `src/infra/heartbeat-runner.ts`
- `src/infra/heartbeat-runner.model-override.test.ts`
- `src/plugin-sdk/provider-auth.ts`
- `src/plugin-sdk/provider-auth-api-key.ts`
- `src/secrets/configure.ts`
- `tsconfig.json`
- `openclaw/docs/PERSAI-FORK-PATCHES.md`
- `openclaw/scripts/verify-persai-patches.mjs`

### Tests run

- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm vitest run src/gateway/persai-runtime/persai-runtime-workspace.test.ts src/infra/heartbeat-runner.model-override.test.ts src/agents/workspace.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/openclaw-runtime-adapter.test.ts`
- `corepack pnpm --filter @persai/api typecheck`

### Risks

1. The immediate hygiene fix isolates heartbeat from main user flow, but it does not fully finish broader H16 work around assistant-scoped autonomous loops and cheap-model routing for every background path.

## 2026-03-31 - H13 core unified turn gateway

### What changed

- Added a concrete PersAI-owned Telegram turn gateway:
  - new internal ingress `POST /api/v1/internal/runtime/turns/telegram`
  - backend now resolves assistant live-state, applies capability/quota/rate checks, invokes runtime, and returns Telegram-rendered denial copy from stable backend codes when blocked
- Added a thin OpenClaw non-web runtime execute seam:
  - `POST /api/v1/runtime/chat/channel`
  - current concrete surface: `telegram`
- Web and Telegram now share the same backend code family for user-facing failures instead of Telegram falling back to generic runtime-side messaging.
- Reminder callback delivery (`POST /api/v1/internal/cron-fire`) now evaluates the same PersAI live-state/capability/quota gates before fanout and renders reminder-safe denial copy from the same backend code family.
- Added true backend-owned per-tool daily limit enforcement:
  - PersAI now exposes `POST /api/v1/internal/runtime/tools/consume`
  - daily counters are consumed atomically in backend before the runtime tool call is allowed
  - OpenClaw uses the already existing `before_tool_call` seam for PersAI runtime turns instead of a broad native tool-assembly fork
- Added focused tests for:
  - Telegram internal turn controller
  - reminder callback rendered fallback
  - channel runtime adapter execution
  - H13 surface enforcement semantics
- Added focused tests for backend tool-limit consumption + propagation through web/runtime seams.
- Added ADR-058 to document the concrete H13 shape.

### Files touched

**PersAI API / web / docs:**

- `apps/api/src/modules/workspace-management/application/assistant-inbound.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-inbound-runtime-context.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/render-assistant-inbound-surface-message.service.ts`
- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
- `apps/api/src/modules/workspace-management/application/consume-internal-runtime-tool-daily-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-turn.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-tool-quota.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforcement-points.test.ts`
- `apps/api/test/handle-internal-cron-fire.test.ts`
- `apps/api/test/internal-runtime-turn.controller.test.ts`
- `apps/api/test/internal-runtime-tool-quota.controller.test.ts`
- `apps/api/test/openclaw-runtime-adapter.test.ts`
- `apps/api/test/quota-accounting.test.ts`
- `apps/api/test/render-assistant-inbound-surface-message.test.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/ADR/058-concrete-h13-unified-turn-gateway.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`
- `docs/SESSION-HANDOFF.md`
- `docs/TEST-PLAN.md`

**OpenClaw:**

- `src/agents/pi-tools.before-tool-call.ts`
- `src/agents/persai-runtime-context.ts`
- `src/agents/persai-runtime-tool-limits.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `src/gateway/server-http.ts`

### Tests run

- `corepack pnpm --filter @persai/api exec node --import tsx test/enforcement-points.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/handle-internal-cron-fire.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/openclaw-runtime-adapter.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/quota-accounting.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/internal-runtime-tool-quota.controller.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/render-assistant-inbound-surface-message.test.ts`
- `corepack pnpm --filter @persai/api exec node --import tsx test/internal-runtime-turn.controller.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm vitest run --config vitest.gateway.config.ts src/gateway/persai-runtime/persai-runtime-telegram.test.ts src/gateway/persai-runtime/persai-runtime-agent-turn.test.ts src/agents/pi-tools.before-tool-call.integration.e2e.test.ts`

### Risks

1. Reminder callbacks are now policy-gated by the same backend code family, but they still use the existing callback-delivery model rather than a fully redesigned backend-owned scheduler/runtime turn architecture.
2. Future messenger surfaces (WhatsApp/MAX/VK) still need their own PersAI adapters, but they can now plug into the same backend enforcement + runtime tool-limit seam without reopening OpenClaw policy ownership.

## 2026-03-29 - H8-scale Telegram lifecycle hardening

### What changed

- Added ADR-057 and updated architecture/boundary docs for the corrected runtime rule:
  - user settings changes stay assistant-scoped
  - `ensure-fresh-spec` returns fresh single-assistant materialized spec data
  - OpenClaw applies that spec locally instead of forcing backend runtime apply
- Fixed PersAI internal freshness controller:
  - stale single-assistant refresh now re-materializes and returns `{generation, assistantId, publishedVersionId, contentHash, spec}`
  - fresh path returns `204`
  - backend `ApplyAssistantPublishedVersionService` is no longer called from `ensure-fresh-spec`
- Added OpenClaw local runtime-apply helper so both HTTP `spec/apply` and chat-time freshness use the same validation/workspace/store flow.
- Hardened Telegram runtime lifecycle:
  - persisted transport/profile fingerprints in runtime spec store
  - no-op apply no longer restarts Telegram transport
  - profile sync no longer runs eagerly on every startup/reinit
  - startup reinit now uses bounded concurrency + jitter + retry backoff
  - profile API calls now honor cooldown and can defer until gateway readiness
- Added assistant-scoped runtime session cleanup for create/reset paths by clearing `agent:persai:<assistantId>:*` sessions and archiving removed transcripts.
- Helm OpenClaw config now enables enforced session maintenance limits for bounded session-store growth in deployed environments.
- Bumped PersAI dev GitOps OpenClaw pin to `b33f10e32b80cc4e9643e879ded92b5081df4ce0` and updated `values-dev.yaml` to rebuild/re-pin that fork image on the next PersAI push.
- Follow-up OpenClaw hotfix `4fe968ad407980e5708535ec96aada03e36fea91` now:
  - removes stale per-assistant runtime spec duplicates before Telegram bot reinit
  - persists Telegram `retry_after` cooldown windows and stops marking `429` profile syncs as successful
  - updates the dev GitOps OpenClaw pin / `values-dev.yaml` for rollout of that fix
- Follow-up OpenClaw hotfix `7ab9df9d0fb285987bc73f34d723af13eb231448` now:
  - retries Telegram replies as plain text when `MarkdownV2` entity parsing fails
  - prevents normal assistant answers from falling through to the generic `"Sorry, I encountered an error"` message when markdown punctuation is not escaped
  - updates the dev GitOps OpenClaw pin / `values-dev.yaml` for rollout of that fix
- Added focused OpenClaw tests for:
  - fresh-spec local apply path
  - assistant-scoped session cleanup path

### Files touched

**PersAI API / docs / infra:**

- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `docs/ADR/057-assistant-scoped-runtime-reconcile-and-telegram-lifecycle-h8-scale.md`
- `docs/API-BOUNDARY.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`
- `docs/SESSION-HANDOFF.md`
- `infra/helm/templates/openclaw-configmap.yaml`
- `infra/helm/values.yaml`
- `infra/helm/values-dev.yaml`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-local-apply.ts`
- `src/gateway/persai-runtime/persai-runtime-freshness.ts`
- `src/gateway/persai-runtime/persai-runtime-freshness.test.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-session-cleanup.ts`
- `src/gateway/persai-runtime/persai-runtime-session-cleanup.test.ts`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts`
- `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `src/gateway/server-http.ts`
- `docs/PERSAI-FORK-PATCHES.md`

### Tests run

- `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/persai-runtime/persai-runtime-freshness.test.ts src/gateway/persai-runtime/persai-runtime-session-cleanup.test.ts src/gateway/persai-runtime/persai-runtime-spec-store.test.ts`
- `corepack pnpm --filter @persai/api run typecheck`

### Risks

1. Probe-budget tuning is intentionally no longer tracked inside `H8-scale`; it moved into the later system-wide GKE tuning slice for 5000+ users, where startup/readiness budgets can be tuned across `api`, `web`, and `openclaw` together.
2. Full `openclaw` repository typecheck still has unrelated pre-existing failures outside the PersAI runtime slice, so verification relied on targeted tests plus PersAI API typecheck.

## 2026-03-28 - Reminder cleanup and delivery sanitization

### What changed

- Fixed Telegram reminder-task create for non-default PersAI agents: the runtime tool now sends `contextSessionKey` for chat-history lookup, but the backend no longer passes that value into cron job creation as a real cron session binding.
- This keeps reminder context assembly working while stopping OpenClaw cron from inheriting `agentId=persai` on `systemEvent` reminder jobs, which was causing `sessionTarget "main" is only valid for the default agent`.
- Fixed reminder delivery cleanup: `cron-fire` now strips the internal `Recent context:` appendix from reminder summaries before sending them to Telegram or the web reminders chat, so users only see the actual reminder text.
- Fixed Telegram group rename drift: inbound group messages now resync the current group title back to PersAI, and the internal group-upsert path also dedupes against the previous stored title for the same `telegramChatId`, so a renamed Telegram group no longer shows up twice as two active groups.
- Added a focused API regression test for the delivery sanitization path.
- Added a focused API regression test for Telegram group rename deduplication.
- Bumped PersAI dev GitOps OpenClaw pin to `e6625ad4ab6932ce0aa0be3249828798bf40d958` so the Telegram group title-sync fix deploys together with the backend cleanup.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `apps/api/test/handle-internal-cron-fire.test.ts`
- `apps/api/test/telegram-group-rename-dedupe.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/ROADMAP.md`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/agents/tools/cron-tool.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-telegram.ts`

### Tests run

- `corepack pnpm --filter @persai/api run test`
- `corepack pnpm --filter @persai/api run lint`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts src/agents/tools/cron-tool.ts src/gateway/persai-runtime/persai-runtime-http.ts`
- `corepack pnpm exec oxlint --type-aware src/gateway/persai-runtime/persai-runtime-telegram.ts`

### Risks

1. Reminder context is still appended into the internal cron payload text because that is the current low-diff way to preserve context across the timer boundary; delivery now sanitizes it before user-visible output, but a future cleanup could move this context into a dedicated non-user-visible field once the scheduler path is redesigned.

## 2026-03-28 - Reminder time-resolution hardening

### What changed

- Added backend-supported `delayMs` to PersAI reminder-task control so relative one-shot reminders no longer depend on a model inventing a correct absolute `runAt`.
- PersAI web inbound turns now pass live `currentTimeIso` and `userTimezone` into the OpenClaw runtime request.
- OpenClaw PersAI web runtime now appends a dynamic scheduling context to the system prompt:
  - current UTC time
  - user timezone
  - formatted current local time in that timezone when it can be rendered
- The existing backend validation for `runAt in the past` remains, so invalid timestamps still stop at the PersAI boundary with a clear `400` instead of surfacing as a generic `500`.
- Bumped PersAI dev GitOps OpenClaw pin to `9e0ca6cd6600a3d8c946fdfb9389721b62fe5df0` so this runtime fix can actually deploy.
- Fixed live reminder delivery auth gap: Helm OpenClaw config now sets `cron.webhookToken` from env `OPENCLAW_GATEWAY_TOKEN`, so runtime cron callbacks to `POST /api/v1/internal/cron-fire` include the bearer token required by PersAI API.
- Fixed stale one-shot task rows after successful delivery: some OpenClaw finished events include `nextRunAtMs` that is already in the past, so PersAI now treats `status=ok + nextRunAtMs<=now` as a completed one-shot and deletes the registry row instead of keeping it active.
- Polished reminder/task UI: new reminder rows now carry a schedule-aware label (`One-time reminder` / `Recurring reminder`), and web surfaces render clearer `Runs at` / `Next run` text plus a schedule-type badge in both Tasks Center and assistant settings.
- Fixed task control semantics: assistant-facing `disable`, `enable`, and `cancel` actions now call the backend runtime-control path (`pause` / `resume` / `cancel`) so recurring reminders stop at the OpenClaw cron layer instead of only disappearing from PersAI UI state.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/control-internal-assistant-reminder-task.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`

### Tests run

- `corepack pnpm run typecheck` in `apps/api`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts src/gateway/persai-runtime/persai-runtime-http.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. Relative one-shot reminders are now deterministic via `delayMs`, but absolute local-time reminder resolution still depends on model/tool argument quality; the new runtime time context is meant to reduce that failure mode rather than fully replace semantic parsing.
2. Full-repo `openclaw` `tsc --noEmit` still reports unrelated pre-existing errors outside the touched reminder/runtime files.

## 2026-03-28 - H12 reminder_task control-plane ownership follow-up

### What changed

- Moved `reminder_task` write actions off the direct runtime-side `cron.add/update/remove` path.
- Added PersAI internal control endpoint:
  - `POST /api/v1/internal/runtime/tasks/control`
- Added PersAI application service that:
  - validates `create/pause/resume/cancel` requests from the runtime tool
  - calls OpenClaw `POST /api/v1/runtime/cron/control` from the backend as an internal driver
  - writes PersAI task registry state after successful backend-driven cron mutations
- `reminder_task` now behaves like this:
  - `list` reads PersAI registry state
  - `create/pause/resume/cancel` call PersAI internal control-plane first
  - only PersAI backend now invokes internal `cron` writes
- The backend now derives the cron callback base URL from the authenticated internal request host instead of trusting a runtime-provided base URL.
- `cancel` now soft-reconciles stale runtime jobs: if the cron id is already gone, the PersAI registry row is still deleted.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/application/control-internal-assistant-reminder-task.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-task-registry.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/ROADMAP.md`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/server-http.ts`
- `docs/PERSAI-FORK-PATCHES.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. Scheduler execution still relies on OpenClaw native `cron` under the hood; this step removes product write-path dependence from the runtime tool, but it is not yet a fully PersAI-owned scheduler engine.
2. `cancel` now goes through backend-driven internal `cron.remove`; if a runtime job was manually deleted out-of-band, we currently treat that as a runtime failure instead of silently reconciling the stale row.

## 2026-03-28 - H12 product-facing reminder_task tool + plan policy

### What changed

- Added a new user-facing OpenClaw tool `reminder_task` for PersAI assistants.
- The tool now handles reminder/task semantics directly:
  - `create`
  - `list`
  - `pause`
  - `resume`
  - `cancel`
- `reminder_task` uses the existing cron/webhook bridge under the hood, but the model no longer needs raw native cron semantics for normal product behavior.
- Added PersAI internal endpoint:
  - `GET /api/v1/internal/runtime/tasks/items`
- That internal endpoint lets runtime-side tools resolve current tasks through PersAI task registry state, including registry ids and underlying `externalRef`, so pause/resume/cancel can work without exposing native cron ids as the primary UX.
- Updated tool catalog / plan seed policy:
  - added `reminder_task` to the governed tool catalog
  - disabled user-facing `cron` across seeded plan activations
  - enabled `reminder_task` across seeded plan activations

### Files touched

**PersAI API:**

- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/src/modules/workspace-management/application/list-internal-assistant-task-items.service.ts`
- `apps/api/src/modules/workspace-management/application/seed-tool-catalog.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-task-registry.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**OpenClaw:**

- `src/agents/tools/reminder-task-tool.ts`
- `src/agents/tools/cron-tool.ts`
- `src/agents/openclaw-tools.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint --type-aware src/agents/tools/reminder-task-tool.ts src/agents/tools/cron-tool.ts src/agents/openclaw-tools.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. `reminder_task` is now the product-facing scheduling tool, but under the hood it still uses the existing OpenClaw cron scheduler bridge. This is the intended intermediate step, not the final PersAI-owned scheduler.
2. The global seed policy now forces `cron` inactive and `reminder_task` active for plan activations. If later we want per-plan exceptions, that should become an explicit product rule rather than startup defaulting.
3. The tool currently resolves pause/resume/cancel targets from PersAI registry state by `taskId` or `titleMatch`; ambiguous title matches intentionally return an error instead of guessing.

## 2026-03-28 - H12 Telegram reminder outbound bridge

### What changed

- Extended the current H12 cron callback slice from `web-only fallback` to real Telegram outbound delivery.
- Added PersAI internal runtime ingress:
  - `POST /api/v1/internal/runtime/telegram/chat-target`
- Added PersAI service logic that:
  - stores the latest inbound Telegram chat target on the assistant's active Telegram binding metadata
  - reads the PersAI-managed bot token from the secret store
  - sends reminder summaries through Telegram Bot API when `preferredNotificationChannel=telegram` and a delivery chat is known
  - falls back to the existing web reminders chat if Telegram target/token is unavailable or send fails
- Added minimal OpenClaw bridge change:
  - `persai-runtime-telegram.ts` now POSTs the latest inbound Telegram chat target back to PersAI before executing the assistant turn

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- `apps/api/src/modules/workspace-management/application/sync-telegram-chat-target.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-cron-fire.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm exec oxlint src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `node scripts/verify-persai-patches.mjs`

### Risks

1. Telegram reminder outbound starts only after the assistant has received at least one inbound Telegram message, because that is when PersAI learns the concrete `telegramChatId` to send into.
2. WhatsApp and other non-web channels still degrade to `web` fallback for reminder delivery.
3. `cron-fire` currently sends the reminder summary text directly; full "re-enter agent turn on reminder fire" behavior is still follow-up work if we decide the callback should trigger a richer assistant action instead of message fanout only.

## 2026-03-28 - H12g memory lifecycle bridge

### What changed

- Implemented assistant memory lifecycle reset on both assistant creation and assistant reset.
- Added a minimal OpenClaw PersAI-runtime endpoint:
  - `POST /api/v1/runtime/workspace/memory/reset`
  - `POST /api/v1/runtime/workspace/reset`
- Added runtime-side memory workspace helper that:
  - ensures assistant workspace exists
  - recreates clean `MEMORY.md`
  - recreates empty `memory/`
  - removes legacy lowercase `memory.md` fallback file if present
- Wired PersAI backend calls:
  - `CreateAssistantService` now triggers memory workspace reset right after baseline assistant creation
  - `ResetAssistantService` now uses the combined runtime workspace reset path instead of two best-effort calls
- `edit/update/reapply` flows are intentionally untouched, so memory is not cleared outside create/reset.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-workspace.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/server-http.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm lint -- src/gateway/persai-runtime/persai-runtime-workspace.ts src/gateway/persai-runtime/persai-runtime-http.ts src/gateway/server-http.ts`

### Risks

1. This satisfies the product behavior, but no longer matches the earlier "zero OpenClaw changes" hope. The implementation uses a minimal `persai-runtime` bridge because PersAI API does not directly own the workspace filesystem.
2. `CreateAssistantService` still treats memory initialization as best-effort. `ResetAssistantService` is now strict and will fail the request if runtime workspace reset fails after the DB-side destructive reset has already committed.

## 2026-03-28 - H12 task registry + cron callback delivery slice

### What changed

- Added PersAI internal reminder/task control-plane ingress:
  - `POST /api/v1/internal/runtime/tasks/sync`
  - `POST /api/v1/internal/cron-fire`
- Added `assistantId + externalRef` uniqueness for `assistant_task_registry_items`, so recurring reminders can keep single-row semantics keyed by the OpenClaw cron job id.
- Added PersAI service logic that:
  - upserts/deletes current task rows from OpenClaw `cron.add` / `cron.update` / `cron.remove`
  - updates/removes those rows again when cron finished webhooks arrive
  - removes one-shot rows after successful completion
  - advances recurring rows by updating `nextRunAt`
- Added real web reminder delivery:
  - cron callbacks now create/find a dedicated web chat thread `system:reminders`
  - successful reminder summaries are stored there as assistant messages
  - preferred external channels currently degrade to `web` fallback instead of silently dropping the reminder
- Added minimal OpenClaw runtime bridge changes:
  - `persai-runtime-context.ts` now carries `assistantId` and `cronWebhookUrl`
  - PersAI runtime web/telegram turns populate those fields
  - `cron-tool.ts` auto-injects webhook delivery when PersAI runtime provides a callback URL
  - `cron-tool.ts` mirrors create/update/remove events to PersAI task registry sync endpoint
- Assistant reset now hard-deletes `assistant_task_registry_items` in the same destructive reset flow as chats/memory/materialized specs.

### Files touched

**PersAI API:**

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260402123000_step12_h12_task_registry_external_ref_unique/migration.sql`
- `apps/api/src/modules/workspace-management/application/sync-assistant-task-registry.service.ts`
- `apps/api/src/modules/workspace-management/application/handle-internal-cron-fire.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-task-registry.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-cron-fire.controller.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`

**OpenClaw:**

- `src/agents/persai-runtime-context.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-telegram.ts`
- `src/agents/tools/cron-tool.ts`
- `docs/PERSAI-FORK-PATCHES.md`
- `scripts/verify-persai-patches.mjs`

**Docs:**

- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm lint -- src/agents/persai-runtime-context.ts src/gateway/persai-runtime/persai-runtime-agent-turn.ts src/gateway/persai-runtime/persai-runtime-http.ts src/agents/tools/cron-tool.ts`
- `ReadLints` on touched PersAI/OpenClaw files: 0 diagnostics

### Risks

1. `cron-fire` currently delivers reminders only into the in-product web chat. If preferred channel is `telegram` / `whatsapp`, the current behavior is explicit fallback to `web`, not true outbound messenger send yet.
2. The new task registry sync depends on OpenClaw reaching PersAI at `cfg.secrets.providers["persai-runtime"].baseUrl` and authenticating with `OPENCLAW_GATEWAY_TOKEN`.
3. The OpenClaw file `src/gateway/persai-runtime/persai-runtime-telegram.ts` still carries pre-existing `curly` style lint noise outside this slice; I did not expand this task into a full style-only refactor there.

## 2026-03-28 - H12 preferred notification channel slice

### What changed

- Added PersAI-side reminder delivery preference persistence:
  - Prisma enum `AssistantPreferredNotificationChannel`
  - new `assistants.preferred_notification_channel` column with default `web`
- Added authenticated assistant preference endpoints:
  - `GET /api/v1/assistant/notification-preference`
  - `PATCH /api/v1/assistant/notification-preference`
- Added backend services that:
  - resolve only currently available delivery channels from active assistant bindings
  - always keep `web` available as the safe default
  - reject choosing disconnected external channels
  - append an assistant audit event when the reminder delivery preference changes
- Added settings UI under Channels:
  - real "Reminder delivery" selector backed by PersAI API
  - only available channels are shown
  - current behavior text matches the agreed semantics: preferred channel first, fallback when unavailable
- Updated `ROADMAP`, `DATA-MODEL`, and `CHANGELOG` to reflect that H12a and H12e are now implemented.

### Files touched

**PersAI API:**

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260402110000_step12_h12_preferred_notification_channel/migration.sql`
- `apps/api/src/modules/workspace-management/application/assistant-notification-preference.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-assistant-notification-preference.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-notification-preference.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`

**PersAI Web:**

- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/_components/use-app-data.ts`
- `apps/web/app/app/_components/assistant-settings.tsx`

**Docs:**

- `docs/ROADMAP.md`
- `docs/DATA-MODEL.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `ReadLints` on touched API/Web files: 0 linter diagnostics

### Risks

1. This slice persists and exposes channel preference, but it does not yet execute reminder delivery through that preference. `cron-fire`, actual channel fanout, and fallback delivery still need the next H12 slice.
2. Availability currently derives from assistant channel bindings plus implicit `web`; WhatsApp is structurally supported in the enum/API but remains product-inactive until its integration exists.
3. The existing memory lifecycle blocker remains unchanged: true create/reset initialization of `MEMORY.md` / `memory/` is still not feasible as "PersAI API only, zero OpenClaw changes" under the current runtime boundary.

## 2026-03-28 - H12/H13 foundation: unified inbound turn + code-first web/task UX

### What changed

- **Doc-first architecture freeze:** added `ADR-056` and aligned `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, and `TEST-PLAN` around the new direction:
  - PersAI becomes the unified inbound turn gateway for `web`, Telegram, reminder callbacks, and future messengers
  - PersAI-owned reminders/tasks replace product dependence on native OpenClaw cron over time
  - stable backend error codes become the UX contract across surfaces
- **Canonical API error envelope actually enforced:** added a global Nest exception filter (`ApiExceptionFilter`) and `ApiErrorHttpException` helper so API failures now consistently return:
  - `requestId`
  - `error.code`
  - `error.category`
  - `error.message`
- **Shared inbound turn foundation for web:** extracted `PrepareAssistantInboundTurnService` and moved the duplicated web prepare logic out of `SendWebChatTurnService` / `StreamWebChatTurnService`. Web sync and web stream now share the same assistant/live-state/chat-create/enforcement/abuse/active-chat-refresh path.
- **Code-first enforcement errors:** `EnforceAssistantCapabilityAndQuotaService` and `EnforceAbuseRateLimitService` now emit stable codes instead of plain conflict strings for the key chat gateway cases:
  - `assistant_not_live`
  - `plan_feature_unavailable`
  - `active_chat_cap_reached`
  - `quota_limit_reached`
  - `rate_limited`
- **Runtime errors normalized:** runtime adapter failures are normalized into stable frontend-consumable codes (`runtime_unreachable`, `runtime_timeout`, `runtime_degraded`, `runtime_auth_failure`, `runtime_invalid_response`) for both sync HTTP failures and streaming `failed` SSE events.
- **Web client updated to use backend codes first:** `assistant-api-client.ts` and `custom-fetch.ts` now read `error.code` from the canonical envelope / SSE payload and only fall back to string heuristics when no stable code is available.
- **Tasks UI aligned with agreed semantics:** both task surfaces now show only the current active reminders/tasks:
  - `assistant-settings.tsx` Tasks section
  - `app-flow.client.tsx` task center
    Paused/stopped items are no longer rendered as a separate “history-like” section.

### Files touched

**Docs / architecture:**

- `docs/ADR/056-unified-inbound-turn-gateway-and-persai-owned-reminders-h12-h13.md` — new ADR
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

**PersAI API:**

- `apps/api/src/main.ts` — registers global API exception filter
- `apps/api/src/modules/platform-core/interface/http/api-error.ts` — canonical API error helper
- `apps/api/src/modules/platform-core/interface/http/api-exception.filter.ts` — canonical error envelope filter
- `apps/api/src/modules/workspace-management/application/assistant-inbound-error.ts` — shared inbound/runtime error normalization
- `apps/api/src/modules/workspace-management/application/prepare-assistant-inbound-turn.service.ts` — shared web prepare path
- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/enforce-abuse-rate-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforcement-points.test.ts`

**Contracts / Web:**

- `packages/contracts/src/mutator/custom-fetch.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`

### Tests run

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `ReadLints` on touched API/Web files: 0 linter diagnostics

### Risks

1. This is the **foundation slice**, not the full H12/H13 delivery. Telegram ingress, reminder callbacks, preferred notification channel persistence, and PersAI-owned task/reminder writers are still follow-up work.
2. Existing backend endpoints outside the chat path still benefit from the new canonical error envelope, but only the chat gateway path has been explicitly normalized to stable product error codes in this slice.
3. Tasks UI now hides inactive items by design. Backend control endpoints for disable/enable/cancel still exist and remain valid, but the current product view intentionally shows only current active tasks/reminders.

### Next recommended step

- Implement the next H12/H13 product slice on top of this foundation:
  - add PersAI-owned reminder/task write path and preferred notification channel persistence
  - move Telegram ingress onto the shared PersAI inbound turn path
  - add internal callback ingress for reminder firing / cron webhook compatibility
  - extend stable error-code formatting from web to messenger/callback surfaces

## 2026-03-27 - Streaming Quality Hardening

### What changed

- **`res.flush()` on every SSE write:** `assistant.controller.ts` `sendSse` helper now merges event+data into one `res.write()` call and immediately calls `res.flush()` (with runtime check for availability). This eliminates TCP/Node output buffering that delayed token delivery to the client.
- **Removed `accumulated` from delta events:** Backend `onDelta` callback now sends only `{ delta }` instead of `{ delta, accumulated }`. The `accumulated` field was redundant for delta events (client rebuilds text from deltas) and caused each SSE payload to grow linearly with response length. `accumulated` is still sent for `thinking` events where the client needs the full thought text.
- **`requestAnimationFrame` batching:** Frontend `onDelta` and `onThinking` callbacks in `use-chat.ts` now buffer incoming tokens and flush to React state once per animation frame (~16ms / 60fps). Previous behavior was one `setMessages` per token (30-50 calls/sec). Pending deltas are synchronously flushed on `onRuntimeDone` and `onCompleted` to prevent text loss.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — `sendSse` merges writes + `flush()`, delta event sends only `{ delta }`

**PersAI Web:**

- `apps/web/app/app/assistant-api-client.ts` — `WebChatStreamEvent` delta type updated to `{ delta: string }`, parser no longer requires `accumulated` for delta events
- `apps/web/app/app/_components/use-chat.ts` — `requestAnimationFrame` batching for `onDelta` and `onThinking`, synchronous flush on `onRuntimeDone`/`onCompleted`

**Docs:**

- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors
- Prettier: all files pass

### Risks

1. If any other consumer of the SSE stream expects `accumulated` in delta events, it will break. Currently only the web frontend consumes this stream, and it never used `accumulated` for deltas.
2. `res.flush()` is cast via `(res as any).flush` — safe because Express/Node HTTP response always has it when not behind compression middleware. If compression is added later, ensure it supports `flush()`.
3. `requestAnimationFrame` is browser-only — fine since `use-chat.ts` is a client-only React hook (`"use client"`).

### Next recommended step

- Deploy and verify streaming is smooth (tokens appear per-frame, not in batches).
- Consider separating API onto `api.persai.dev` domain to eliminate the Next.js rewrite proxy layer for SSE.
- H11 — WhatsApp/MAX readiness and secret-ref parity.

## 2026-03-27 - Telegram Group Deduplication (supergroup migration fix)

### What changed

- **Backend joined-event dedup:** When a `joined` event arrives, `internal-runtime-config-generation.controller.ts` now runs `updateMany` to mark any existing active records with the same `title` but a different `telegramChatId` as "left" before upserting the new record. This handles the Telegram group→supergroup migration where `chat_id` changes.
- **Backend GET dedup:** `assistant.controller.ts` GET groups endpoint now deduplicates results by `title` (case-insensitive), keeping only the most recently updated record per title. Ordered by `updatedAt desc`.
- **Frontend filter:** `telegram-connect.tsx` groups list now shows only `status === "active"` groups. Counter badge already counted active-only; the list rendering now matches.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts` — stale-title deactivation before upsert
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — dedup-by-title in GET groups, order by `updatedAt`

**PersAI Web:**

- `apps/web/app/app/_components/telegram-connect.tsx` — filter to active-only in groups list

**Docs:**

- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors
- Prettier: all files pass

### Risks

1. Title-based dedup assumes groups don't share the same name. In practice Telegram group names are unique per bot context, so this is safe. If a user intentionally has two groups named "Bots" they would see only one — acceptable edge case.
2. The `updateMany` that marks old same-title entries as "left" uses `title` equality. If a group is renamed before migration, both old and new entries will remain — the GET dedup handles this at display time.

### Next recommended step

- Deploy and verify: add bot to a group, verify it shows once. If the group migrates to supergroup, the old entry should auto-deactivate.
- Clean existing duplicates in DB (optional): `UPDATE assistant_telegram_groups SET status='left' WHERE ...` for known stale entries.
- H11 — WhatsApp/MAX readiness and secret-ref parity.

## 2026-03-27 - Quota UX and Avatar Consistency Hardening

### What changed

- **Quota error UX:** `toWebChatUxIssue` in `assistant-api-client.ts` now classifies 409 quota errors into `quota_limit_reached` (budget/token/tool limits) and `feature_unavailable` (disabled capability) with user-friendly messages and guidance. Two new entries added to `WebChatUxIssueClass` union type.
- **Reapply HTTP code fix:** `POST /assistant/publish` and `POST /assistant/reapply` now decorated with `@HttpCode(200)` in `assistant.controller.ts`. Frontend `postAssistantReapply` uses `isSuccessStatus` + full object guard.
- **Shared AssistantAvatar component:** New `assistant-avatar.tsx` with sizes `sm` (28px), `md` (40px), `lg` (80px). Renders avatar image > emoji > Sparkles fallback. Used in chat header, message bubbles, empty state, home dashboard, sidebar, Telegram settings. Includes minute-granularity cache-busting `?v=` param on avatar URLs.
- **Avatar cache headers:** Backend avatar endpoint `Cache-Control` changed from `public, max-age=300` to `no-cache, must-revalidate`.
- **Telegram metadata sync:** After publish+apply, `PublishAssistantDraftService` patches the Telegram binding's `metadata.displayName` and `metadata.avatarUrl` with the assistant's draft values. New `patchMetadata` method in `AssistantChannelSurfaceBindingRepository`.
- **Telegram settings UI:** `ConnectedView` now receives `assistantAvatarUrl`, `assistantAvatarEmoji`, `assistantDisplayName` from `app-shell.tsx` and prefers them over stale `bot.*` metadata.

### Files touched

**PersAI API:**

- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — `@HttpCode(200)` on publish/reapply, `Cache-Control` fix
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts` — `syncTelegramBindingMetadata` after apply
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.repository.ts` — `patchMetadata` interface
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-channel-surface-binding.repository.ts` — `patchMetadata` implementation

**PersAI Web:**

- `apps/web/app/app/_components/assistant-avatar.tsx` — new shared component
- `apps/web/app/app/_components/chat-area.tsx` — uses `AssistantAvatar`, passes avatar props through
- `apps/web/app/app/_components/chat-message.tsx` — uses `AssistantAvatar` for assistant messages
- `apps/web/app/app/_components/home-dashboard.tsx` — uses `AssistantAvatar` in hero
- `apps/web/app/app/_components/sidebar.tsx` — uses `AssistantAvatar` in assistant card
- `apps/web/app/app/_components/telegram-connect.tsx` — uses `AssistantAvatar`, accepts assistant draft props
- `apps/web/app/app/_components/app-shell.tsx` — passes assistant draft props to TelegramConnect
- `apps/web/app/app/chat/page.tsx` — passes avatar props to ChatArea
- `apps/web/app/app/assistant-api-client.ts` — quota UX classifiers, reapply guard fix, new issue class types

**Docs:**

- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors

### Risks

1. `patchMetadata` does read-then-write (not atomic JSON merge) — acceptable for low-concurrency publish flow.
2. Cache-busting `?v=` changes every minute, which means avatar images refetch once per minute on navigation. Acceptable trade-off for immediate consistency after avatar change.
3. Telegram metadata sync is non-fatal (try/catch). If it fails, UI falls back to assistant draft props anyway.

### Next recommended step

- Test full flow: change avatar in settings → publish → verify avatar consistency across chat, sidebar, home, Telegram settings.
- Deploy and verify quota errors for `kurock09@gmail.com` show clear messages.
- H11 — WhatsApp/MAX readiness and secret-ref parity.

## 2026-03-27 - UI Polish: chat scroll, sidebar, avatar upload, Telegram sync

### What changed

- **Chat loading optimization:** Backend `listChatMessages` now uses reverse pagination (newest-first, cursor-before semantics). Frontend `useChat` loads a single page of 20 messages; `loadOlderMessages()` fetches earlier pages. `ChatArea` uses IntersectionObserver sentinel at top with scroll position preservation via `useLayoutEffect`.
- **New chat in sidebar:** `ChatPageInner` watches `chat.chatId` and calls `appData.reloadChats()` when a new chat is created during streaming.
- **Avatar file upload:** Full upload pipeline: `POST /api/v1/assistant/avatar` (NestJS multipart, 2MB limit) → OpenClaw `POST /api/v1/runtime/workspace/avatar` (writes `avatar.{ext}` to workspace dir). Readback via `GET /api/v1/assistant/avatar` → OpenClaw `GET /api/v1/runtime/workspace/avatar`. Frontend shows spinner during upload, stores permanent URL instead of `blob:`.
- **Telegram bot sync:** `syncBotProfile(bot, workspace, assistantId)` helper in `persai-runtime-telegram.ts` calls `setMyName`, `setMyDescription`, `setMyProfilePhoto` from workspace persona after bot initialization. Non-fatal (try/catch with warnings).

### Files touched

**OpenClaw fork (lower-risk PersAI bridge files):**

- `src/gateway/persai-runtime/persai-runtime-http.ts` — avatar POST/GET handler
- `src/gateway/persai-runtime/persai-runtime-telegram.ts` — syncBotProfile helper
- `src/gateway/server-http.ts` — avatar request stage registration
- `docs/PERSAI-FORK-PATCHES.md` — patches #8, #9
- `scripts/verify-persai-patches.mjs` — checks #8, #9, #10

**PersAI:**

- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/_components/chat-area.tsx`
- `apps/web/app/app/chat/page.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run

- `tsc --noEmit` PersAI API: 0 errors
- `tsc --noEmit` PersAI Web: 0 errors
- `tsc --noEmit` OpenClaw: 0 new errors (only pre-existing test/extension issues)
- Prettier: all touched files unchanged
- `verify-persai-patches.mjs`: 30/30 passed

### Risks / follow-up

- Avatar upload is synchronous and capped at 2MB; larger files or videos would need a streaming upload approach.
- Telegram `setMyProfilePhoto` may fail if the bot doesn't have admin permissions in the channel; errors are logged as warnings and don't block bot startup.
- Scroll position preservation uses `useLayoutEffect` which may cause minor visual jitter on very slow devices.

---

## 2026-03-27 - H10 Thinking/Reasoning UX + Telegram groups auth fix

### What changed

- **H10 stream plumbing:** OpenClaw PersAI runtime stream now emits `thinking` NDJSON chunks, and PersAI API forwards them as SSE `thinking` events to the web app.
- **H10 web UX:** assistant messages can now carry ephemeral streamed thought text, rendered as a collapsible `Thought for Xs` panel with a fade-out collapsed preview above the final assistant answer.
- **Reasoning enabled for web runtime:** PersAI web chat turns now request `reasoning=stream` from OpenClaw, so reasoning-capable models can surface live thought text during streaming without persisting it into the final assistant message.
- **Telegram groups fix:** added `GET /api/v1/assistant/integrations/telegram/groups` to `ClerkAuthMiddleware` route registration, fixing the `401` that prevented the Groups section from loading even when `assistant_telegram_groups` rows already existed.

### Why changed

- H10 was the next roadmap slice after H9 and closes the last major chat UX gap: users can now see live model reasoning separately from the final answer instead of waiting on a silent stream.
- The Telegram UI issue turned out to be an auth-routing omission, not runtime delivery: group join/leave callbacks were already reaching the API and updating the database, but the listing endpoint itself was not behind the same auth middleware as the other Telegram routes.

### Files touched

**OpenClaw fork:**

- `src/agents/command/types.ts`
- `src/agents/agent-command.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`

**PersAI:**

- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/_components/use-chat.ts`
- `apps/web/app/app/_components/chat-message.tsx`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run

- IDE diagnostics (`ReadLints`) on all touched OpenClaw and PersAI files: 0 errors
- Runtime audit in GKE:
  - confirmed `openclaw` on new image
  - confirmed Telegram `group-update` callbacks returning `200`
  - identified repeated `401` on `/api/v1/assistant/integrations/telegram/groups` before the auth-route fix

### Risks / follow-up

- Thought text is intentionally ephemeral in the web client and is not persisted into chat history or backend message records.
- Models without reasoning support will continue streaming only normal assistant deltas; the Thought panel simply will not appear.

### Next recommended step

- Deploy both repos, wait for new `openclaw` and `api` pods, then verify:
  - one streaming web chat shows the Thought panel
  - Telegram Groups section loads without `401`
  - existing tracked groups appear without re-adding the bot

## 2026-03-27 - H9 Per-Request Tool Credential Isolation

### What changed

- **Eliminated `process.env` race for tool credentials:** Replaced global `process.env` mutation (`injectToolCredentials`/`cleanupInjectedEnv`) with per-request `AsyncLocalStorage` context in all three agent turn entry points (sync, telegram, stream).
- **Extended `PersaiRuntimeRequestCtx`:** Added `toolCredentials?: Map<string, string>` field. Credentials now flow through `persaiRuntimeRequestContext.run()` alongside `toolDenyList` and `workspaceDir`.
- **New `getPersaiToolCredential` helper:** Reads per-request credential by env var name. Exposed via new `openclaw/plugin-sdk/persai-credential` subpath so extensions can import it without violating lint boundaries.
- **Patched 3 credential readers:** Tavily config (`extensions/tavily/src/config.ts`), Firecrawl config (`extensions/firecrawl/src/config.ts`), web-fetch tool (`src/agents/tools/web-fetch.ts`) — all check `getPersaiToolCredential(…)` before `process.env` fallback.
- **Removed dead code:** `injectToolCredentials()`, `cleanupInjectedEnv()`, `PERSAI_AGENT_WORKSPACE_DIR` save/restore constants.
- **Audit finding:** 3 of 5 `TOOL_CREDENTIAL_ENV_MAP` entries (`OPENAI_IMAGE_GEN_API_KEY`, `OPENAI_TTS_API_KEY`, `OPENAI_EMBEDDINGS_API_KEY`) are dead injections — no OpenClaw tool reads them today. Kept in the map for future wiring.

### Why changed

At 1000+ concurrent users, `process.env` mutation creates race conditions where different assistants' API keys overwrite each other. This produces credential cross-leak (security), incorrect billing (financial), and random tool failures (reliability). The `AsyncLocalStorage` pattern was already proven by H7b for `PERSAI_TOOL_DENY` — H9 extends it to cover all tool credentials.

### Files touched

**OpenClaw fork:**

- `src/agents/persai-runtime-context.ts` — added `toolCredentials` to interface, added `getPersaiToolCredential` helper
- `src/plugin-sdk/persai-credential.ts` — **new**, re-exports `getPersaiToolCredential`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — removed `process.env` mutation, pass credentials through context
- `extensions/tavily/src/config.ts` — read from context before `process.env`
- `extensions/firecrawl/src/config.ts` — read from context before `process.env`
- `src/agents/tools/web-fetch.ts` — read from context before `process.env`
- `package.json` — added `./plugin-sdk/persai-credential` export
- `scripts/lib/plugin-sdk-entrypoints.json` — registered new subpath

**PersAI:**

- `docs/ADR/055-per-request-tool-credential-isolation-h9.md` — **new**
- `docs/ROADMAP.md` — marked H9 complete
- `docs/CHANGELOG.md` — H9 entry
- `docs/SESSION-HANDOFF.md` — this entry

### Tests run

- TypeScript typecheck (`tsc --noEmit`): 0 new errors (all errors pre-existing in unrelated files)
- IDE linter: 0 errors on all changed files
- `plugin-sdk:check-exports`: pass
- `lint:plugins:plugin-sdk-subpaths-exported`: pass

### Risks

- **Low:** Extensions that resolve credentials at tool-creation time (not call time) may still read a stale `process.env` value if the tool is created outside a `persaiRuntimeRequestContext.run()` scope. Currently Tavily and Firecrawl resolve API keys inside `createWebSearchTool`/`createWebFetchTool` which are called within `createOpenClawTools` during the agent turn — inside the context scope. No issue today.
- **None for CLI users:** `process.env` fallback is preserved — non-PersAI CLI still works.

### Next recommended step

- H10 — thinking/reasoning UX (stream thinking tokens, collapsible "Thought for Xs" block)
- Or: wire the 3 dead credential refs (`OPENAI_IMAGE_GEN_API_KEY`, `OPENAI_TTS_API_KEY`, `OPENAI_EMBEDDINGS_API_KEY`) to actual OpenClaw tools so PersAI-managed keys for image generation, TTS, and embeddings are consumed at runtime.

---

## 2026-03-27 - H8 Telegram Runtime Readiness

### What changed

- **Encrypted bot token storage:** `ConnectTelegramIntegrationService` now stores the actual bot token encrypted (AES-256-GCM) via `PlatformRuntimeProviderSecretStoreService` under key `telegram_bot:{assistantId}`. `RevokeTelegramIntegrationSecretService` deletes it on revoke.
- **Materialize Telegram config:** `resolveTelegramChannelConfig()` in `materialize-assistant-published-version.service.ts` builds `openclawBootstrap.channels.telegram` with resolved `botToken`, `webhookUrl`, HMAC `webhookSecret`, `groupReplyMode`, `parseMode`, inbound/outbound policy.
- **OpenClaw Telegram bridge:** New `persai-runtime-telegram.ts` dynamically starts/stops Grammy bots per assistant on `spec/apply`. Handles `message:text` (with group mention/reply filtering) and `my_chat_member` (group join/leave → PersAI callback). Webhook handler at `POST /telegram-webhook/:assistantId`. Bots reinitialize from Redis store on pod restart.
- **GKE Ingress:** `openclaw-ingress.yaml` for `bot.persai.dev/telegram-webhook/*` with Google-managed TLS certificate.
- **Groups data model:** Prisma `assistant_telegram_groups` table. Internal callback `POST /api/v1/internal/runtime/telegram/group-update`. Public `GET /api/v1/assistant/integrations/telegram/groups`.
- **UI:** Groups section in Telegram config panel (auto-populated, name/members/status badge). Group reply mode toggle (Mention/Reply vs All). `groupReplyMode` added to config update flow.

### Files touched

**PersAI:**

- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-secret-store.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326300000_add_assistant_telegram_groups/migration.sql`
- `apps/web/app/app/_components/telegram-connect.tsx`
- `apps/web/app/app/assistant-api-client.ts`
- `packages/config/src/api-config.ts`
- `infra/helm/templates/openclaw-ingress.yaml`
- `infra/helm/values.yaml`, `infra/helm/values-dev.yaml`

**OpenClaw:**

- `src/gateway/persai-runtime/persai-runtime-telegram.ts` (new)
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts`
- `src/gateway/server-http.ts`

### H8j–H8k workspace isolation fixes

- **H8j — `workspaceDir` race (`process.env` → `commandInput`):** Telegram and web agent turns now pass `workspaceDir` directly in `commandInput` to `agentCommandFromIngress`, removing reliance on `process.env.PERSAI_AGENT_WORKSPACE_DIR`.
- **H8k — session `cwd` drift + memory tools:** Existing sessions stored stale `cwd` from creation time. Memory tools (`readAgentMemoryFile`, manager, backend-config, QMD) always used `resolveAgentWorkspaceDir(cfg, agentId)` → static `workspace-persai` path, ignoring runtime override. Fix: extracted `persaiRuntimeRequestContext` to `persai-runtime-context.ts`; `session-manager-init.ts` now syncs `header.cwd` on every turn; memory modules check `persaiRuntimeRequestContext.getStore()?.workspaceDir` first.
- **H8l — group callback URL fix:** `notifyPersaiGroupUpdate` tried to read nonexistent top-level `persaiSecretResolverBaseUrl` (strict schema rejects unknown keys → CrashLoopBackOff). Fixed to read `cfg.secrets.providers["persai-runtime"].baseUrl` instead — same provider already configured for secret resolution.

OpenClaw files touched:

- `src/agents/persai-runtime-context.ts` (new)
- `src/agents/openclaw-tools.ts` (re-export from new module)
- `src/agents/pi-embedded-runner/session-manager-init.ts`
- `src/memory/read-file.ts`, `src/memory/manager.ts`, `src/memory/backend-config.ts`, `src/memory/qmd-manager.ts`

OpenClaw commit: `6bcff3d2f4b13483b03fac259462c01b9a0ccec0`

### Deploy notes

1. Create K8s Secret entries: `TELEGRAM_WEBHOOK_HMAC_SECRET` in `persai-api-secrets`
2. Run Prisma migration for `assistant_telegram_groups` table
3. Set up DNS: `bot.persai.dev` → GKE Ingress IP
4. Create Google-managed certificate `persai-bot-cert` for `bot.persai.dev`
5. Deploy PersAI API first (new migration + config vars), then OpenClaw (new Grammy bridge)
6. Connect a Telegram bot in UI → publish/apply → bot should respond to DMs and group @mentions
7. Verify `openclaw.json` configmap has `secrets.providers.persai-runtime` with correct `baseUrl` (used by group update callbacks)

---

## 2026-03-26 - Force Reapply fix + null-plan backfill

### What changed

- **Force Reapply bumps configGeneration:** `ForceReapplyAllService` now calls `bumpConfigGenerationService.execute()` before the re-materialization loop. New specs get a higher generation, so OpenClaw's freshness check reliably detects the update.
- **Null-plan governance backfill:** `SeedToolCatalogService.onModuleInit()` now runs `backfillNullPlanGovernances()` — any `assistantGovernance` row with `quotaPlanCode=null` is updated to the active default plan. This fixes legacy assistants created before the plan catalog, which had empty `toolQuotaPolicy` and therefore empty deny lists.

### Why changed

- 5 of 6 assistants had no plan assigned → `resolveToolQuotaPolicy(null)` returned `[]` → no inactive tools → deny list empty. Only the 1 assistant created after plan system had a proper deny list.
- Force Reapply didn't increment `configGeneration`, so OpenClaw's in-memory cache could consider specs "fresh" even after mass re-materialization.

### Files touched

- `apps/api/src/modules/workspace-management/application/force-reapply-all.service.ts`
- `apps/api/src/modules/workspace-management/application/seed-tool-catalog.service.ts`

### Deploy notes

- After deploy: API auto-backfills null plans at startup → press Force Reapply All → all assistants get correct deny lists.

---

## 2026-03-26 - H3.4 runtime integration hardening

### What changed

- **Credential refs parsing (OpenClaw):** `extractToolCredentialRefs` in `persai-runtime-tool-policy.ts` now handles both Array and Object (Record) formats. PersAI materializes `toolCredentialRefs` as `Record<toolCode, {refKey, secretRef, configured}>`, but OpenClaw previously only accepted `Array<{toolCode, secretRef, configured}>`. Shared parsing logic extracted into `parseCredentialRefRow`.
- **process.env race condition (OpenClaw):** `PERSAI_TOOL_DENY` global env var replaced with `AsyncLocalStorage`-based `persaiRuntimeRequestContext` (defined in `persai-runtime-context.ts`, re-exported from `openclaw-tools.ts`). Each `agentCommandFromIngress` call runs inside `persaiRuntimeRequestContext.run()` with its own `toolDenyList` and `workspaceDir`. Fallback to `process.env.PERSAI_TOOL_DENY` preserved for non-PersAI CLI usage.
- **Tool catalog rename (PersAI):** `memory_center_read` → `memory_get`, `tasks_center_control` → `cron` in `tool-catalog-data.ts`, tests, and SQL data migration `20260326200000`. Migration also updates `workspace_tool_usage_daily_counters`. `PlanCatalogToolActivation` safe (references by UUID FK).
- **Auto-seed at startup (PersAI):** `SeedToolCatalogService` (`OnModuleInit`) syncs tool catalog, ensures default `starter_trial` plan with entitlement + tool activations, seeds bootstrap presets if empty. Eliminates need for manual `seed.ts` / `seed-catalog.ts` for new deployments.

### Why changed

- Credential refs were silently empty — API keys for search/images/TTS never reached OpenClaw tools.
- Concurrent web chat requests could corrupt each other's tool deny lists via shared `process.env`.
- Tool codes `memory_center_read` / `tasks_center_control` didn't match OpenClaw tool names (`memory_get` / `cron`), causing deny list mismatches.
- New user registration on clean DB required manual seed script execution.

### Slice boundary

- OpenClaw: 4 files (`persai-runtime-tool-policy.ts`, `persai-runtime-agent-turn.ts`, `openclaw-tools.ts`, `persai-runtime-context.ts`)
- PersAI: `tool-catalog-data.ts`, `seed-tool-catalog.service.ts`, `workspace-management.module.ts`, 2 test files, 1 SQL migration, docs

### Deploy notes

- After deploy: run `prisma migrate deploy` → API auto-seeds at startup → Force Reapply All to re-materialize existing specs with correct tool names.

---

## 2026-03-26 - H3.3 post-deploy fixes: user data, avatar editing, emoji picker

### What changed

- **Setup wizard user profile upsert:** removed `if (onboarding.status === "pending")` gate — `postOnboarding` is now always called in `handleCreate`. After reset, user-edited fields (name, birthday, gender, timezone) are persisted to DB before materialization, so USER.md and other bootstrap files reflect current data.
- **Avatar editing in settings:** added emoji picker (inline grid — avoids `overflow` clipping by `SlideOver`'s scroll container) + file upload button; selecting emoji clears URL and vice versa; `avatarUrl` now sent to API on save.
- **Sidebar avatar rendering:** sidebar assistant card now shows custom `avatarUrl` image when present, with emoji and default icon fallbacks.
- **Edit personality button:** restyled from text link to `ActionButton` component; placed in same row as "Save and apply".
- **Dead code cleanup:** removed unused `router` from `handleCreate` dependency array in setup wizard.

### Why changed

- After H3.3 deploy, live testing revealed: (1) USER.md preserved old data after reset+recreate because `postOnboarding` was skipped; (2) emoji picker was visually broken inside the slide-over panel due to `overflow` clipping; (3) no way to change avatar or upload image in edit flow; (4) sidebar showed default icon even when avatar was set.

### Slice boundary

- PersAI web only (no backend or OpenClaw changes)

### Files touched

- `apps/web/app/app/setup/page.tsx`
- `apps/web/app/app/_components/assistant-settings.tsx`
- `apps/web/app/app/_components/sidebar.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- `docs/UI-SPEC.md`

### Tests run

- Lint, format, typecheck (full workspace gate per AGENTS.md)

### Risks

- `postOnboarding` upsert is safe for repeated calls (backend handles existing records). No side effects.
- File upload creates `blob:` URL (local-only preview). No server-side file upload API exists yet — custom avatar images do not persist across sessions. Tracked as known limitation.

### Next recommended step

- **Server-side avatar upload:** add file upload endpoint for persistent avatar URL storage (GCS or equivalent)
- **H4 — Telegram runtime readiness** alignment against admin-driven runtime profile + managed secret refs
- **AI model routing investigation:** `gpt-5.1` selected in plan not applied after reapply (paused, needs debugging)

### Ready commit message

- `fix(web): always upsert user profile on recreate, add avatar editing and file upload in settings`

---

## 2026-04-04 - K16 limit fallback baseline

### What changed

- Web chat and Telegram inbound turns now return a structured quota decision instead of always hard-failing on quota exhaustion.
- Materialized `runtimeProviderRouting.fallbackMatrix.cost_driving_restricted` is now treated as a real safe-model degrade target, not just a policy hint.
- PersAI inbound transport paths pass explicit per-turn `providerOverride` / `modelOverride` into the OpenClaw bridge when quota degrade is allowed.
- OpenClaw runtime HTTP handlers accept those explicit turn overrides and apply them ahead of the materialized default runtime model selection.
- Admin plans no longer expose `Cost tool units` in the ordinary UI/API surface; `tokenBudgetLimit` remains the product-facing quota field.

### Why changed

- Hard chat shutdown on quota exhaustion was not user-friendly and did not match the intended K16 behavior.
- `Cost tool units` was an internal accounting lever leaking into the normal admin tariff UX.

### Slice boundary

- PersAI: inbound quota decision, runtime adapter payload, admin plans contract/UI cleanup, tests
- OpenClaw: minimal runtime HTTP bridge change so explicit per-turn provider/model overrides reach execution

### Verification

- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm exec tsx "apps/api/test/runtime-provider-routing.test.ts"`
- `corepack pnpm exec tsx "apps/api/test/openclaw-runtime-adapter.test.ts"`

### Next recommended step

- Finish the remaining K16 admin-facing UX around explaining degrade behavior and fallback-state visibility in operator surfaces.

---

## 2026-03-26 - H2 cleanup: tool/plan/limits consolidation and dead-code removal

### What changed

- **Tool catalog consolidation:** extracted all 8 tool definitions + `STARTER_TRIAL_TOOL_POLICY` into `apps/api/prisma/tool-catalog-data.ts`; both `seed.ts` and `seed-catalog.ts` now import from this single source of truth.
- **Dead capability flags removed:** `assistantLifecycle`, `memoryCenter`, `tasksCenter`, `viewLimitPercentages`, `tasksExcludedFromCommercialQuotas` — removed from `EffectiveCapabilityState`, `resolve-effective-capability-state.service.ts`, `resolve-plan-visibility.service.ts`, `resolve-openclaw-capability-envelope.service.ts`, `resolve-openclaw-channel-surface-bindings.service.ts`, `track-workspace-quota-usage.service.ts`, `admin-plan-management.types.ts`, OpenAPI contracts, admin plans UI, and all affected test files.
- **Per-plan quota limits:** plan quota accounting remains stored in `billingProviderHints.quotaAccounting`; `tokenBudgetLimit` is the product-facing admin control, while the internal cost-driving counter is no longer exposed in ordinary admin plans UI; `billingProviderHints` overwrite bug fixed (merge instead of replace).
- **Per-plan model selection:** `primaryModelKey` stored in `billingProviderHints`; resolved during materialization and passed to `ResolveRuntimeProviderRoutingService`.
- **Daily call limit enforcement:** `WorkspaceToolDailyUsageRepository` interface + Prisma implementation; `checkToolDailyLimit` / `incrementToolDailyUsage` on `TrackWorkspaceQuotaUsageService`; wired into module DI.
- **Admin Runtime UI completed:** fallback provider/model toggle, available models per provider editor, reapply summary display after save.
- **Docs aligned:** `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `UI-SPEC.md`, `TEST-PLAN.md`, `PRODUCT.md`, `ROADMAP.md`, `CHANGELOG.md`, `ADR-052` all updated to match current state.

### Why changed

- After H2 and H3 work, accumulated technical debt: duplicate tool definitions, unused capability flags still in types/UI/contracts, missing quota controls in admin UI, incomplete runtime admin page. This cleanup brings docs and code into alignment.

### Slice boundary

- PersAI only (no OpenClaw changes in this session)
- Backend: types, services, repository, module wiring, API contracts
- Frontend: admin plans page, admin runtime page, app-flow client
- Docs: 8 doc files updated

### Next recommended step

- **Deploy and seed:** run `seed-catalog` on GKE to ensure the consolidated tool catalog is applied
- **dailyCallLimit runtime integration:** wire OpenClaw `before_tool_call` hook to PersAI `incrementToolDailyUsage` callback
- **H4 — Telegram runtime readiness:** align Telegram against admin-driven runtime profile + managed secret refs

### Ready commit message

- `refactor(admin): consolidate tool catalog, remove dead capabilities, add per-plan quotas/model/daily-limit enforcement`

### Affected files

- `apps/api/prisma/tool-catalog-data.ts` (new)
- `apps/api/prisma/seed.ts`
- `apps/api/prisma/seed-catalog.ts`
- `apps/api/package.json`
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/effective-capability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-capability-state.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/application/plan-visibility.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-tool-daily-usage.repository.ts` (new)
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-tool-daily-usage.repository.ts` (new)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `packages/contracts/openapi.yaml`
- `apps/web/app/admin/plans/page.tsx`
- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/api/test/quota-accounting.test.ts`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/UI-SPEC.md`, `docs/TEST-PLAN.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/ADR/052-*`

---

## 2026-03-26 - Plans per-tool management + OpenClaw tool policy integration

### What changed

- Redesigned `/admin/plans` page: compact collapsible cards with inline summary (caps/channels/tools/activations on one line), expandable detail view, dense 3-column entitlements grid in edit mode, tool activation table with toggles and daily limit inputs.
- Extended backend admin plans API to accept/return `toolActivations[]` with per-tool `active` status and `dailyCallLimit`.
- Updated `syncToolActivationsForPlan` in Prisma repository to apply explicit per-tool overrides with class-derived fallback.
- Added PersAI contract types: `AdminPlanToolActivation`, `AdminPlanToolActivationInput`.
- Created OpenClaw `persai-runtime-tool-policy.ts` module: parses `toolCredentialRefs`/`toolQuotaPolicy` from bootstrap, resolves credentials via `resolvePersaiRefs`, builds tool deny list.
- Integrated tool policy validation on `POST /spec/apply` in OpenClaw.
- On chat turns, resolved tool credentials are injected as env vars (`TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, etc.) with cleanup.
- `createOpenClawTools()` now filters out tools listed in `PERSAI_TOOL_DENY` env var.

### Why changed

- H2 laid the foundation (encrypted tool credential store, materialization of toolCredentialRefs/toolQuotaPolicy into bootstrap), but OpenClaw was not consuming these values. This slice completes the integration loop so PersAI controls which tools are active and OpenClaw executes accordingly.

### Slice boundary

- PersAI admin UI + API: per-tool activation management at plan level
- OpenClaw: credential resolution + tool filtering from bootstrap
- Credential mapping: `tool/web_search/api-key` → `TAVILY_API_KEY`, `tool/web_fetch/api-key` → `FIRECRAWL_API_KEY`, etc.
- Still deferred:
  - per-provider web search key selection
  - AsyncLocalStorage for concurrency-safe credential injection
  - persona / memory hydration (H3)

### Next recommended step

- **H3 runtime hydration depth** — consume materialized persona, memory, tasks envelopes deeper in OpenClaw

### Ready commit message

- `feat(admin+openclaw): per-tool plan management + OpenClaw tool policy integration`

### Affected files (PersAI)

- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `packages/contracts/src/generated/model/adminPlanToolActivation.ts` (new)
- `packages/contracts/src/generated/model/adminPlanToolActivationInput.ts` (new)
- `packages/contracts/src/generated/model/adminPlanState.ts`
- `packages/contracts/src/generated/model/adminPlanInputBase.ts`
- `packages/contracts/src/generated/model/index.ts`
- `apps/web/app/admin/plans/page.tsx`

### Affected files (OpenClaw)

- `src/gateway/persai-runtime/persai-runtime-tool-policy.ts` (new)
- `src/gateway/persai-runtime/persai-runtime-http.ts`
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`
- `src/agents/openclaw-tools.ts`

## 2026-03-26 - H2 tool credential refs and tool quota limits baseline shipped

### What changed

- Added [ADR-052](ADR/052-tool-credential-refs-and-tool-quota-limits-h2.md) defining the H2 scope.
- Expanded tool catalog from 3 to 8 entries (`web_search`, `web_fetch`, `image_generate`, `tts`, `browser`, `memory_search`, `memory_get`, `cron`).
- Extended `PlanCatalogToolActivation` with `dailyCallLimit` for per-tool daily call limits.
- Added `WorkspaceToolUsageDailyCounter` table for tracking daily tool usage per workspace.
- Widened `PlatformRuntimeProviderSecret.providerKey` column from `VarChar(32)` to `VarChar(64)` to accommodate tool credential keys.
- Extended `PlatformRuntimeProviderSecretStoreService` to handle generic credential keys (both provider and tool), added `loadKeyMetadataByKeys` and extended `resolveSecretValueById` for tool secret IDs.
- Created `ManageAdminToolCredentialsService` and `AdminToolCredentialsController` for `GET`/`PUT /api/v1/admin/runtime/tool-credentials`.
- Added `admin.tool_credentials.update` step-up action in `AdminAuthorizationService`.
- Updated materialization to include `toolCredentialRefs` and `toolQuotaPolicy` in `openclawBootstrap`.
- Created admin UI page `/admin/tools` for tool credential management.
- Updated seed.ts with 8 tools and starter trial daily limits.
- Marked `docs/ROADMAP.md` Step 12 `H2` complete.

### Why changed

- H1b proved the encrypted secret store and internal resolve pattern for provider keys. H2 extends the same infrastructure to tool-specific credentials, giving platform admins centralized control over tool API keys without Kubernetes-level secret management.
- Per-tool daily call limits provide fine-grained cost control per plan, complementing the existing global `token_budget`.

### Slice boundary

- platform-admin only
- tool credentials managed globally (not per-assistant)
- 5 tool credential slots: `tool_web_search`, `tool_web_fetch`, `tool_image_generate`, `tool_tts`, `tool_memory_search`
- per-tool `dailyCallLimit` in plan activation (null = unlimited)
- OpenClaw resolves tool credentials through existing `POST /api/v1/internal/runtime/provider-secrets/resolve`
- still deferred:
  - runtime tool execution changes in OpenClaw fork
  - per-tool daily counter enforcement in OpenClaw runtime
  - assistant-level limit communication (system prompt hints at 80%+ usage)
  - Telegram / WhatsApp / MAX channel credential management

### Next recommended step

- **H3 — runtime hydration depth**
  - consume materialized persona, memory, tasks/reminders, tool policy, and related capability envelopes deeper in OpenClaw session/runtime policy
  - continue ADR-048 `P2` work

### Ready commit message

- `feat(admin): add tool credential refs + tool quota limits baseline (H2)`

## 2026-03-25 - H1a runtime provider admin UI shipped

### What changed

- Added a structured `H1a` editor to the existing admin rollout controls in `apps/web/app/app/app-flow.client.tsx`.
- Added `apps/web/app/app/runtime-provider-profile-admin.ts` to hydrate current runtime-provider governance state and generate safe rollout patches.
- Marked `docs/ROADMAP.md` Step 12 `H1a` complete and aligned changelog/ADR notes.

### Why changed

- `H1` proved the backend/materialization/runtime path, but changing provider refs still depended on raw JSON rollout editing. `H1a` gives platform admins a real control-plane UI without inventing a new backend mutation surface or storing raw secrets in PersAI.

### Slice boundary

- mutation path remains `POST /api/v1/admin/platform-rollouts`
- scope remains platform-admin only
- supports `OpenAI + Anthropic`
- edits:
  - primary/fallback provider + model
  - provider credential refs (`source`, `provider`, `id`, optional `refKey`)
- guardrail:
  - preserve unrelated `policyEnvelope` and `secretRefs.refs.*` branches because rollout updates replace whole governance envelopes

### Next recommended step

- **H2 — tool credential refs baseline**
  - move managed tool-provider secret refs onto the same control-plane pattern
  - keep runtime/tool execution in OpenClaw
  - avoid mixing this with Telegram/MAX/WhatsApp delivery follow-up yet

### Ready commit message

- `feat(admin): add runtime provider profile rollout UI`

## 2026-03-25 - H1 runtime provider profile baseline shipped

### What changed

- Added [ADR-050](ADR/050-runtime-provider-profile-baseline-h1.md) to lock the concrete H1 implementation shape.
- Marked `docs/ROADMAP.md` Step 12 `H1` complete.
- Aligned `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, and `docs/API-BOUNDARY.md` around one exact control-plane path:
  - `assistant_governance.policyEnvelope.runtimeProviderProfile`
  - `assistant_governance.secret_refs.refs.runtime_provider_credentials`
  - materialized `openclawBootstrap.governance.runtimeProviderProfile`

### Why changed

- The north-star from ADR-049 was already agreed, but the code slice still needed one precise production-grade contract before implementation. H1 now has an explicit boundary that reuses governance, rollout/reapply, and native OpenClaw apply/chat seams instead of introducing a parallel admin/runtime system.

### Slice boundary

- Mutation surface in H1: existing `POST /api/v1/admin/platform-rollouts`
- First supported providers: `OpenAI + Anthropic`
- Runtime behavior:
  - if materialized admin-managed runtime profile is present, OpenClaw validates and uses it
  - if absent, OpenClaw keeps legacy configured default model path
- Still deferred:
  - tool credential refs
  - deeper persona/memory/tasks/tool-policy hydration
  - Telegram/MAX/WhatsApp delivery/readiness follow-up

### Next recommended step

- **H1a — admin UI for runtime provider profile + provider credential refs**
  - platform-admin only
  - uses the already-shipped H1 backend/materialization/apply path
  - lands before `H2` so provider refs stop depending on rollout-only mutation UX
  - exact UI shape:
    - structured editor in existing admin rollout controls
    - current values hydrated from assistant governance state
    - generated rollout patch for `runtimeProviderProfile` + `runtime_provider_credentials`
    - no raw secret storage and no new backend mutation surface

### Ready commit message

- `feat(runtime): add admin-managed provider profile baseline`

## 2026-03-25 - ADR-049 north-star for admin-driven runtime control plane

### What changed

- Added [ADR-049](ADR/049-platform-admin-runtime-control-plane-phasing.md) to lock the long-term PersAI + OpenClaw direction into one canonical phased plan.
- Added `docs/ROADMAP.md` Step 12 so future sessions can follow the same ordered slices instead of rebuilding the sequence ad hoc.
- Updated `docs/ARCHITECTURE.md` to point future runtime-profile work at ADR-049 without changing the current runtime boundary.
- Fixed the stale compat-echo sentence in `docs/API-BOUNDARY.md` so docs match the current native fork behavior (`503` without prior apply).

### Why changed

- The next phase is no longer "make basic native runtime work" but "turn PersAI into the real control plane for runtime configuration without duplicating OpenClaw internals". That needs one written north-star and slice ladder so sessions do not drift or try to do everything at once.

### First recommended coding slice

- **H1 — platform-admin runtime provider profile baseline**
  - first providers: `OpenAI + Anthropic`
  - move assistant-scoped primary/fallback model refs into PersAI control plane
  - add provider credential refs without storing raw secret values in PersAI
  - keep OpenClaw as runtime executor + secret resolver
  - keep the first runtime consumption on the applied web path only

### Guardrails

- Reuse `assistant_governance.policyEnvelope.runtimeProviderRouting` and `assistant_governance.secret_refs` before inventing new control-plane objects.
- Do not widen into tool credential refs, Telegram runtime delivery, or WhatsApp/MAX delivery in the first slice.
- If H1 needs architecture/API/data-model changes beyond ADR-049, update docs first before code.

### Ready commit message

- `docs(adr): define phased runtime control-plane north-star`

## 2026-03-25 - OpenClaw pin advance for honest missing-apply failures

### What changed

- **Fork** (`kurock09/openclaw`): commit `f74bb8c23286f4b2452897035489dd1cc41931d6` changes `src/gateway/persai-runtime/persai-runtime-http.ts` so missing applied runtime specs return explicit `503` JSON errors for sync and stream chat instead of `[openclaw-compat]*` fallback replies.
- **PersAI pin wiring**: `infra/dev/gitops/openclaw-approved-sha.txt` now points to that fork commit, and `infra/dev/gitops/README.md` reflects the new approved SHA so the next `main` push builds and repins the correct OpenClaw image.

### Why changed

- Compat echo on missing apply masked a real runtime/state problem and could let PersAI store fake assistant replies in chat history. Bumping the approved SHA is required so auto-build/deploy picks up the honest `503` behavior instead of continuing to ship the older fork revision.

### Blocker

- **Push order matters:** push `openclaw` first so GitHub contains `f74bb8c23286f4b2452897035489dd1cc41931d6`, then push `PersAI` so the OpenClaw image-publish workflow can fetch that SHA.

### Next recommended step

- After both pushes, let the OpenClaw image workflow repin `infra/helm/values-dev.yaml`, then run hybrid smoke: API preflight, direct `healthz/readyz`, and one web streaming turn in `/app`.

### Ready commit message

- `chore(openclaw): pin fork f74bb8c23 for honest missing-apply failures`

## 2026-03-25 - Docs aligned with current live dev OpenClaw profile

### What changed

- Updated `README.md`, `docs/API-BOUNDARY.md`, `docs/LIVE-TEST-HYBRID.md`, `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`, and `docs/ROADMAP.md` to match the current dev runtime profile declared in `infra/helm/values-dev.yaml`.

### Why changed

- The live dev stack now runs with Redis-backed apply state, OpenAI as the default OpenClaw model, `OPENAI_API_KEY` secret wiring, and a raised API adapter timeout for stable streaming. Several docs still described the older pre-fix or generic state and needed drift cleanup.

### Next recommended step

- Keep future OpenClaw ops/doc updates anchored to the actual `values-dev.yaml` profile so live-test instructions, roadmap, and ADR notes do not drift after runtime changes.

### Ready commit message

- `docs(dev): align runtime docs with current openclaw profile`

## 2026-03-25 - Dev API timeout raised for OpenClaw web stream

### What changed

- `infra/helm/values-dev.yaml` first raised `OPENCLAW_ADAPTER_TIMEOUT_MS` for the dev `api` deployment (initially `15000`, later `90000` — see operational CHANGELOG and current `values-dev.yaml`).

### Why changed

- Live `POST /api/v1/assistant/chat/web/stream` requests were failing around `3116-3156 ms` even though OpenClaw was already generating valid text. The `api` container had no explicit timeout env, so it was using the earlier config default `3000 ms` and aborting the upstream runtime call too early.

### Next recommended step

- Let GitOps reconcile this `api` env, then re-run the same web chat thread and verify the UI receives `completed` instead of surfacing a timeout issue.

### Ready commit message

- `fix(dev): raise openclaw adapter timeout for web streaming`

## 2026-03-25 - Dev OpenClaw default model switched to OpenAI

### What changed

- `infra/helm/templates/openclaw-configmap.yaml` now writes `agents.defaults.model.primary` from Helm values, and `infra/helm/values-dev.yaml` sets that dev default to `openai/gpt-5.4`.

### Why changed

- Runtime state in Redis was working, but live chat still failed because OpenClaw booted with Anthropic default model while only `OPENAI_API_KEY` was configured in the cluster.

### Next recommended step

- Apply the updated ConfigMap/deployment via GitOps, verify startup logs show `agent model: openai/gpt-5.4`, then rerun chat + restart-safe smoke.

### Ready commit message

- `chore(dev): default openclaw runtime model to openai in values-dev`

## 2026-03-25 - Dev values switch OpenClaw to managed Redis

### What changed

- `infra/helm/values-dev.yaml` now sets `PERSAI_RUNTIME_SPEC_STORE=redis` for OpenClaw and sources `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL` from `persai-openclaw-secrets`.

### Why changed

- Manual live patching was being reverted by GitOps because the repo still declared `memory`. The cluster can only stay on managed Redis if the desired state in Git also says `redis`.

### Next recommended step

- Push PersAI, let Argo reconcile, then verify in the pod that `STORE=redis` before running restart and multi-replica smoke.

### Ready commit message

- `chore(dev): switch openclaw runtime spec store to redis in values-dev`

## 2026-03-25 - AGENTS rule: OpenClaw fork push-prep workflow

### What changed

- `AGENTS.md` now has an explicit **OpenClaw fork change workflow**: if a session changes `C:\Users\alex\Documents\openclaw`, agents must prepare both repos before saying "ready to push" (`openclaw` commit, PersAI SHA/tag update, digest clear, docs update, explicit push order).

### Why changed

- This repo regularly lands runtime changes in the fork while PersAI owns the pin/build/deploy boundary. Without a written workflow, agents can forget the second half of the delivery and leave CI/deploy in a broken or misleading state.

### Next recommended step

- Follow this rule on every future OpenClaw slice: push **OpenClaw first**, then push **PersAI**, then pull the CI repin commit back into the local PersAI checkout.

### Ready commit message

- `docs(agents): require dual-repo openclaw push preparation`

## 2026-03-25 - ADR-048 P0: Redis-backed apply store wiring (fork + PersAI ops docs)

### What changed

- **Fork** (`kurock09/openclaw`): commit `6ea3b32535d38e0884d8770e74483260caaf1a53` implements `redis` backend for `src/gateway/persai-runtime/persai-runtime-spec-store.ts` with lazy connect, key prefix, optional TTL, and unit coverage in `persai-runtime-spec-store.test.ts`; `memory` remains the single-replica default.
- **PersAI docs / pin wiring**: documented fork runtime envs (`PERSAI_RUNTIME_SPEC_STORE`, `PERSAI_RUNTIME_SPEC_STORE_REDIS_URL`, optional prefix/TTL) in `docs/API-BOUNDARY.md`, `docs/ADR/048-*`, `docs/ROADMAP.md`, `docs/LIVE-TEST-HYBRID.md`, `docs/CHANGELOG.md`; updated `infra/dev/gitops/openclaw-approved-sha.txt`; moved `infra/helm/values-dev.yaml` OpenClaw tag to the new fork SHA and cleared digest for workflow repin.

### Why changed

- Compat fallback after OpenClaw restarts is not a PersAI API problem; the root cause is process-local apply state in the runtime. Redis-backed storage closes that gap at the correct boundary and is the prerequisite for multi-replica OpenClaw.

### Next recommended step

- In the **fork repo**: commit/push the Redis store change, then bump `infra/dev/gitops/openclaw-approved-sha.txt` in PersAI and repin the OpenClaw image/digest.
- In **cluster ops**: provide a real Redis URL (managed Redis preferred for non-dev), set `PERSAI_RUNTIME_SPEC_STORE=redis`, deploy, then verify apply survives OpenClaw pod restart before increasing replicas above `1`.

### Ready commit message

- `chore(openclaw): pin redis-backed apply-store fork sha and document runtime store wiring`

## 2026-03-25 - ADR-048 P3: `agentCommandFromIngress` for PersAI web runtime (fork)

### What changed

- **Fork** (`kurock09/openclaw`): commit `baf61e8675b97ce5c31f768e732304c58d526e34` — new `src/gateway/persai-runtime/persai-runtime-agent-turn.ts`; `persai-runtime-http.ts` calls embedded agent for sync + NDJSON stream when `store.get` hits (after apply); no-apply path unchanged (`[openclaw-compat]*` echo).
- **PersAI:** `openclaw-approved-sha.txt` → above SHA; `values-dev.yaml` OpenClaw `tag` + cleared `digest` for CI repin; `validate-openclaw-persai-runtime.sh` checks agent bridge; docs ADR-048 / API-BOUNDARY / ROADMAP / LIVE-TEST / gitops README / CHANGELOG.

### Why changed

- Close ADR-048 **P3**: real agent output on web when governance materialization was applied; align with OpenAI-compat gateway ingress path.

### Blocker

- **Push fork first**, then PersAI `main`, so CI can fetch `baf61e8675b97ce5c31f768e732304c58d526e34`.

### Next recommended step

- OpenClaw Dev Image Publish → digest repin commit; Argo sync; live test apply → chat (expect model output if provider keys exist).

### Ready commit message

- `chore(openclaw): pin fork baf61e8675 for ADR-048 P3 agent ingress`

## 2026-03-25 - ADR-048 docs + deploy runbook; baseline vs completion

### What changed

- **ADR-048**: status clarifies **baseline shipped** (P0–P2 + PersAI-side native build) vs **remaining P3** (full agent turn) and fork P4 (drop echo); consequences updated (no “dual compat patch” wording).
- **infra/dev/gitops/README.md**: new **push order** section (fork before PersAI pin); removed stale “compat patch not configured” / “remaining blocker” lines; merged secret prerequisite into O3 assumptions; P3/echo called out explicitly.
- **docs/API-BOUNDARY.md**: subsection renamed to “Fork build (native runtime)”; authentication line no longer references removed compat patch; echo until P3 stated explicitly.
- **docs/LIVE-TEST-HYBRID.md**, **infra/dev/gke/RUNBOOK.md**, **README.md**, **docs/CHANGELOG.md**: aligned with same deploy and verification story.

### Why changed

- Operators hit **`not our ref`** when PersAI `main` ran before the fork push; docs contradicted reality on compat patch and “first pod blocker.” ADR-048 “completion” is ambiguous without separating **baseline milestone** from **P3**.

### Next recommended step

- **Fork-only session:** ADR-048 **P3** spike — call embedded agent path from `persai-runtime-http` for sync+stream; bump `openclaw-approved-sha.txt`; shared Redis store if HPA >1 OpenClaw replica.

### Ready commit message

- `docs(adr-048): align status, deploy order, and API-BOUNDARY with native baseline`

## 2026-03-25 - ADR-048 executed: native PersAI runtime in OpenClaw fork (P0–P2)

### What changed

- **Fork** (`kurock09/openclaw`): commit `8e61e0ba5eba49fccc2c0ae362e07b242c7e1d15` — added `src/gateway/persai-runtime/` (`persai-runtime-spec-store.ts`, `persai-runtime-session.ts`, `persai-runtime-http.ts`); wired `server-http.ts` + `server-runtime-state.ts` so apply persists, chat/stream read store, emit `X-Persai-Runtime-Session-Key`, echo prefixes `openclaw-persai-runtime*` when apply+persona present else legacy compat prefix.
- **PersAI**: `openclaw-approved-sha.txt` → above SHA; removed compat patch file + `validate-openclaw-compat-patch.sh`; added `validate-openclaw-persai-runtime.sh`; dropped patch step from `openclaw-dev-image-publish.yml`; `ci.yml` uses new validator; `values-dev.yaml` OpenClaw tag updated, digest cleared for CI repin; docs/ADR/API-BOUNDARY/README/gitops/ROADMAP Step 11 updated.

### Why changed

- Execute ADR-048 by shipping native routes in fork instead of CI patch; lay P0 multi-replica–ready store interface and P1/P2 hooks without rewriting embedded agent core (P3 next).

### Verification (post-push / post-deploy)

- Fork pushed to `origin`; PersAI OpenClaw workflow green; `values-dev` repinned digest; live: apply → chat shows `openclaw-persai-runtime*` + `X-Persai-Runtime-Session-Key` (see LIVE-TEST-HYBRID Phase B).

### Files touched (high level)

- OpenClaw: `src/gateway/persai-runtime/*`, `server-http.ts`, `server-runtime-state.ts`
- PersAI: workflows, `infra/dev/gitops/*`, `infra/helm/values-dev.yaml`, `docs/*`, `README.md`

### Tests run / result

- OpenClaw: local `pnpm`/tsc not available in agent shell; rely on fork CI after push.
- PersAI: not run (doc + infra edits).

### Ready commit message

- `feat(openclaw): native persai runtime p0-p2; drop compat patch and repin sha`

## 2026-03-25 - ADR-048: native OpenClaw runtime plan (fork-owned code)

### What changed

- Added [docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md](ADR/048-native-openclaw-runtime-from-persai-apply-chat.md): phased fork-side plan (persist apply, session mapping, hydrate persona/memory/tools from `openclawWorkspace` / bootstrap, delegate chat to native agent pipeline, retire compat echo), pointers to fork files (`agent-command`, hooks/cron turn, sessions store), materialization reference in `apps/api`.
- Linked ADR-048 from `docs/API-BOUNDARY.md` (PersAI→OpenClaw contract section).
- `docs/CHANGELOG.md` updated.

### Why changed

- User asked for plan + code for full OpenClaw features with PersAI settings; implementation cannot live in `apps/api` per ADR-012 — ADR records architecture and fork integration phases; executable bridge belongs in the OpenClaw fork PR.

### Files touched (high level)

- `docs/ADR/048-native-openclaw-runtime-from-persai-apply-chat.md`, `docs/API-BOUNDARY.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only.

### Next recommended step

- Spike in fork: call `runCronIsolatedAgentTurn` or `agentCommandFromIngress` from runtime HTTP handlers after loading stored apply payload; open PR on `kurock09/openclaw`, then bump `openclaw-approved-sha.txt`.

### Ready commit message

- `docs(adr): add 048 native openclaw runtime from persai apply chat plan`

## 2026-03-25 - Phase B: OpenClaw runtime smoke in LIVE-TEST-HYBRID

### What changed

- Extended [docs/LIVE-TEST-HYBRID.md](LIVE-TEST-HYBRID.md) with **Phase B: OpenClaw runtime smoke**: authenticated `GET /api/v1/assistant/runtime/preflight` through hybrid proxy, optional `kubectl port-forward` to `svc/openclaw:18789` for `healthz`/`readyz`, streaming chat check in `/app`, contract link and GitOps pin note.
- Logged in [docs/CHANGELOG.md](CHANGELOG.md).

### Why changed

- After Phase A contract freeze, operators need a single runbook step for “does OpenClaw work after deploy” without rereading adapter code.

### Files touched (high level)

- `docs/LIVE-TEST-HYBRID.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only.

### Next recommended step

- Run Phase B checks after your deploy; then fork/native runtime parity or Telegram/MAX delivery slices as separate ADR-backed work.

### Ready commit message

- `docs: add phase b openclaw runtime smoke to live-test hybrid`

## 2026-03-25 - Phase A: PersAI to OpenClaw HTTP runtime contract (v1)

### What changed

- Added design-freeze subsection **PersAI to OpenClaw HTTP runtime contract (v1)** to `docs/API-BOUNDARY.md`: normative contract (paths, JSON bodies, NDJSON stream records, auth header, env config keys, adapter error mapping, retry scope), explicit out-of-scope surfaces (Telegram/WhatsApp/MAX on this HTTP API), and compat patch reference behavior for drift checks against `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch` and [ADR-012](ADR/012-openclaw-fork-source-and-deploy-boundary.md).
- Linked the contract from `docs/ARCHITECTURE.md` under OpenClaw boundary.
- Recorded the slice in `docs/CHANGELOG.md`.

### Why changed

- Phase A requires a single documentation anchor so fork/runtime implementers can match PersAI’s adapter without reading Nest code.

### Files touched (high level)

- `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- Docs-only; no automated tests required.

### Known risks / intentional limits

- Contract documents current adapter + patch behavior; native fork parity remains a later slice.

### Next recommended step

- Phase B/C: deploy validation and/or native runtime parity in fork; extend contract only via explicit doc + ADR if the HTTP surface changes.

### Ready commit message

- `docs: add phase a persai-to-openclaw http runtime contract v1`

## 2026-03-25 - Prisma AbuseSurface enum mapping (web chat stream 500)

### What changed

- Added `@@map("abuse_surface")` to `enum AbuseSurface` in `apps/api/prisma/schema.prisma` so generated SQL uses the existing Postgres enum from Step 10 G2 migrations.
- Regenerated Prisma client (`pnpm --filter @persai/api run prisma:generate`).
- Restored `apps/web/next-env.d.ts` to reference `./.next/types/routes.d.ts` (avoid dev-only path).
- Dropped spurious working-tree noise via `git restore` on `app-flow.client.tsx`, `app-flow.client.test.tsx`, and `assistant-governance.entity.ts` where diffs were empty.

### Why changed

- Live `POST .../assistant/chat/web/stream` returned 500: Prisma referenced non-existent type `public.AbuseSurface` while the DB defines `abuse_surface`.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/web/next-env.d.ts`
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed

### Known risks / intentional limits

- Deploy `api` required for production; no DB migration change (schema already matched DB naming).

### Next recommended step

- Deploy API and re-verify web chat streaming end-to-end.

### Ready commit message

- `fix(api): map AbuseSurface prisma enum to abuse_surface for stream abuse upserts`

## 2026-03-24 - Step 10 G5 WhatsApp and MAX readiness hardening

### What changed

- Hardened OpenClaw provider/surface readiness projection so configured state now resolves from canonical provider binding repository for:
  - `telegram`
  - `whatsapp`
  - `max`
- Removed remaining Telegram-only configured-state assumption for future providers:
  - `whatsapp` and `max` are no longer hardcoded as unconfigured in projection
- Preserved explicit non-flat surface model:
  - WhatsApp surface remains `whatsapp_business`
  - MAX remains split into `max_bot` and `max_mini_app`
- Kept Telegram managed SecretRef lifecycle usability gate intact on top of binding readiness.
- Added targeted G5 test coverage for provider-configured readiness and MAX split-surface behavior.
- Added ADR-047 and updated roadmap/docs for G5.

### Why changed

- G5 requires architecture-only hardening so WhatsApp and MAX can be implemented later without redesign, while preserving existing web/Telegram/system-notification behavior.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/test/openclaw-channel-surface-bindings-g5.test.ts`
- `docs/ADR/047-whatsapp-max-readiness-hardening-g5.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings-g5.test.ts` — passed

### Known risks / intentional limits

- G5 does not implement WhatsApp runtime delivery flow yet.
- G5 does not implement MAX bot or MAX mini-app runtime delivery flow yet.
- Non-Telegram secret lifecycle policies for WhatsApp/MAX remain future work.

### Next recommended step

- Step 11 **H1** design language and product shell alignment.

### Ready commit message

- `refactor(api): harden step 10 g5 provider-surface readiness for whatsapp and max without delivery rollout`

## 2026-03-24 - Step 10 G4 retention/delete/compliance baseline

### What changed

- Finalized explicit MVP legal acceptance behavior:
  - onboarding now requires `acceptTermsOfService=true` and `acceptPrivacyPolicy=true`
  - persisted acceptance version/timestamp fields on `app_users`
- Extended `GET /api/v1/me` read model with explicit `compliance` state:
  - required/accepted ToS and Privacy versions
  - acceptance timestamps
  - retention/delete/audit baseline mode summary
- Tightened onboarding completion semantics:
  - `completed` now requires workspace presence + required legal acceptance
  - `pending` is returned when either workspace or legal acceptance is missing
- Finalized MVP retention/delete baseline as explicit platform behavior:
  - no hidden TTL auto-purge behavior
  - delete remains explicit action-only
  - reset and ownership transfer/recovery stay non-delete actions
- Added ADR-046 and updated roadmap/docs for G4.
- Applied minimal corrective middleware route coverage for existing protected endpoints added in previous slices (Telegram secret lifecycle, admin abuse unblock, admin ownership transfer/recovery).

### Why changed

- G4 requires unambiguous real-platform retention/delete/compliance behavior with explicit user trust boundaries and no hidden retention surprises.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260329130000_step10_g4_retention_delete_compliance_baseline/migration.sql`
- `apps/api/src/modules/identity-access/application/compliance-baseline.ts`
- `apps/api/src/modules/identity-access/application/current-user-state.types.ts`
- `apps/api/src/modules/identity-access/application/get-current-user-state.service.ts`
- `apps/api/src/modules/identity-access/application/upsert-onboarding.service.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/api/test/step2-auth-foundation.e2e.test.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/046-retention-delete-compliance-baseline-g4.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/step2-auth-foundation.e2e.test.ts` — passed
- `corepack pnpm --filter @persai/web run test -- --run app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- G4 does not introduce enterprise retention scheduler/legal hold/regional retention matrix.
- G4 does not add full account/workspace erasure orchestration endpoint.
- Retention remains explicit user/action-driven in MVP; no silent background purge jobs.

### Next recommended step

- Step 10 **G5** WhatsApp and MAX readiness hardening.

### Ready commit message

- `feat(api-web-contracts): add step 10 g4 explicit retention-delete-compliance baseline with legal acceptance state`

## 2026-03-24 - Step 10 G3 recovery and ownership transfer baseline

### What changed

- Added admin-governed ownership flow service and API surfaces:
  - `POST /api/v1/admin/assistants/ownership/transfer`
  - `POST /api/v1/admin/assistants/ownership/recover`
- Added dedicated admin controller/service wiring for ownership transfer and ownership recovery with explicit guarded parsing and conflict checks.
- Extended dangerous admin action scope and step-up action parsing with:
  - `admin.assistant.transfer_ownership`
  - `admin.assistant.recover_ownership`
- Implemented ownership guardrails:
  - assistant must be in admin workspace scope
  - transfer flow requires `currentOwnerUserId` match
  - target owner must be member of assistant workspace
  - target owner must not already own another assistant (MVP one-user-one-assistant rule)
- Defined and returned explicit consequences for attached resources:
  - `resetTriggered=false`
  - `deletionTriggered=false`
  - lifecycle versions preserved
  - memory/chat/task ownership links rebound via assistant owner relation
  - bindings + SecretRef lifecycle metadata preserved
  - prior audit history preserved
- Added ownership-flow audit events:
  - `assistant.ownership_transferred`
  - `assistant.ownership_recovered`
- Added ADR-045 and updated roadmap/docs for G3.

### Why changed

- G3 requires explicit recovery and ownership transfer flows that remain separate from reset/delete semantics, enforce ownership boundaries through governed rules, and preserve audit/RBAC assumptions.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/manage-admin-assistant-ownership.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-assistant-ownership.controller.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/manage-admin-assistant-ownership.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/045-recovery-and-ownership-transfer-g3.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-assistant-ownership.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts` — passed

### Known risks / intentional limits

- No end-user self-service ownership transfer path in G3 (admin-governed flows only).
- No cross-workspace ownership migration in G3.
- Ownership transfer/recovery does not introduce automatic publish/reset/delete behavior and does not broaden into retention/compliance deletion workflows.

### Next recommended step

- Step 10 **G4** retention/delete/compliance baseline.

### Ready commit message

- `feat(api-contracts): add step 10 g3 admin ownership recovery and transfer flows with explicit resource consequences`

## 2026-03-24 - Step 10 G2 abuse and rate-limit enforcement baseline

### What changed

- Added canonical abuse/rate-limit persistence model:
  - `assistant_abuse_guard_states`
  - `assistant_abuse_assistant_states`
- Added centralized abuse protection service for web chat transport boundaries with explicit layered controls:
  - per-user-per-assistant throttle window
  - per-assistant aggregate throttle window
  - surface-aware anti-flood hooks (`web_chat` active baseline)
  - quota-pressure-aware slowdown and temporary block behavior
- Hardened web chat boundaries to enforce G2 abuse decisions and return 429 when active:
  - `POST /api/v1/assistant/chat/web`
  - `POST /api/v1/assistant/chat/web/stream` (prepare path)
- Added admin abuse override/unblock endpoint:
  - `POST /api/v1/admin/abuse-controls/unblock`
  - role gate: `ops_admin|security_admin|super_admin` (+ narrow owner fallback)
  - clears active abuse blocks/slowdowns and applies temporary override window
- Added audit event:
  - `admin.abuse_unblock_applied`
- Added ADR-044 and updated roadmap/docs for G2.

### Why changed

- G2 requires finalized multi-layer abuse/rate-limit protection that goes beyond one rule, preserves normal user flows, aligns with quotas, and gives operators explicit audited unblock recovery controls.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260329100000_step10_g2_abuse_rate_limit_enforcement/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-abuse-guard.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-abuse-guard.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-abuse-guard.repository.ts`
- `apps/api/src/modules/workspace-management/application/enforce-abuse-rate-limit.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-abuse-controls.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-abuse-controls.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforce-abuse-rate-limit.test.ts`
- `apps/api/test/manage-admin-abuse-controls.test.ts`
- `packages/config/src/api-config.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/044-abuse-and-rate-limit-enforcement-g2.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/enforce-abuse-rate-limit.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/manage-admin-abuse-controls.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/enforcement-points.test.ts` — passed

### Known risks / intentional limits

- G2 activates abuse enforcement on web chat boundaries only; Telegram/WhatsApp/MAX transport-path activation remains future slice work.
- Slowdown is implemented as temporary 429 response window (explicit retry friction), not delayed queue execution.
- G2 intentionally does not add content-moderation or semantic abuse classification systems.

### Next recommended step

- Step 10 **G3** recovery and ownership transfer flows.

### Ready commit message

- `feat(api-contracts): add step 10 g2 multi-layer abuse and rate-limit enforcement with admin unblock override`

## 2026-03-24 - Step 10 G1 secret lifecycle hardening baseline

### What changed

- Added canonical managed SecretRef lifecycle hardening in assistant governance `secret_refs` (`persai.secretRefs.v1`) with Telegram baseline entry `refs.telegram_bot_token`.
- Added Telegram secret lifecycle APIs:
  - `POST /api/v1/assistant/integrations/telegram/rotate`
  - `POST /api/v1/assistant/integrations/telegram/revoke`
  - `POST /api/v1/assistant/integrations/telegram/emergency-revoke`
- Extended Telegram connect payload to accept optional `ttlDays` (`1..365`) and rotate SecretRef lifecycle metadata during connect/rotate.
- Extended Telegram integration state response with non-sensitive `secretLifecycle` metadata:
  - lifecycle status (`active|revoked|emergency_revoked|expired|legacy_unmanaged`)
  - ref key / manager / version
  - rotate/revoke/expiration timestamps and legacy fallback marker
- Hardened OpenClaw channel/surface projection so Telegram provider readiness now checks binding + SecretRef lifecycle usability (with narrow legacy compatibility fallback for pre-G1 active bindings).
- Added secret lifecycle audit events:
  - `assistant.secret_ref_rotated`
  - `assistant.secret_ref_revoked`
  - `assistant.secret_ref_emergency_revoked`
- Added ADR-043 and updated roadmap/docs for G1.

### Why changed

- Product baseline requires managed secret lifecycle properties (rotation, revoke, TTL, audit, emergency revoke) while preserving SecretRef delivery discipline and avoiding secret-value exposure across UI/domain surfaces.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/assistant-secret-refs-lifecycle.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/test/assistant-secret-refs-lifecycle.test.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `docs/ADR/043-secret-lifecycle-hardening-g1.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/api exec tsx test/telegram-integration.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/openclaw-channel-surface-bindings.test.ts` — passed
- `corepack pnpm --filter @persai/api exec tsx test/assistant-secret-refs-lifecycle.test.ts` — passed

### Known risks / intentional limits

- G1 lifecycle hardening is implemented for assistant managed SecretRefs (Telegram baseline); broad provider matrix expansion is deferred.
- TTL is enforced at read/evaluation time (computed `expired` status); no background scheduler is added in this slice.
- Existing admin notification webhook `signingSecret` storage model is unchanged in G1.

### Next recommended step

- Step 10 **G2** abuse and rate limit enforcement.

### Ready commit message

- `feat(api-contracts): add step 10 g1 managed secret lifecycle rotation revoke ttl and emergency revoke for telegram secret refs`

## 2026-03-24 - Step 9 F6 progressive rollout and rollback controls baseline

### What changed

- Added platform rollout persistence model:
  - `assistant_platform_rollouts`
  - `assistant_platform_rollout_items`
- Added admin rollout APIs:
  - `GET /api/v1/admin/platform-rollouts`
  - `POST /api/v1/admin/platform-rollouts`
  - `POST /api/v1/admin/platform-rollouts/{rolloutId}/rollback`
- Added rollout service behavior for platform-managed layers:
  - validates bounded rollout patch payload
  - selects targeted assistants by rollout percentage
  - captures per-assistant pre-update governance snapshot
  - updates only platform-managed governance fields
  - triggers soft reapply against latest published version where available
  - stores per-assistant apply outcomes (`succeeded|degraded|failed|skipped`)
- Added explicit rollback behavior:
  - restores captured governance snapshots
  - reapply after restore to align runtime
  - records rollback outcomes and marks rollout operation as `rolled_back`
- Extended dangerous admin step-up action set:
  - `admin.rollout.apply`
  - `admin.rollout.rollback`
- Hardened dangerous role model to be action-scoped:
  - plan dangerous actions stay `business_admin|super_admin`
  - rollout dangerous actions require `ops_admin|super_admin`
  - legacy owner fallback remains compatibility path
- Added audit events for rollout operations:
  - `admin.platform_rollout_applied`
  - `admin.platform_rollout_rolled_back`
- Added `/app` owner section "Platform rollout controls" with:
  - rollout percent + target patch JSON form
  - rollback selector
  - recent rollout operation summary
- Added ADR-042 and updated roadmap/docs for F6.

### Why changed

- F6 requires real operator controls for progressive platform-managed updates with rollback support, while preserving immutable user-owned assistant version truth and keeping soft update behavior.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328220000_step9_f6_rollout_rollback_controls/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-platform-rollouts.service.ts`
- `apps/api/src/modules/workspace-management/application/platform-rollout.types.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-platform-rollouts.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/042-progressive-rollout-and-rollback-controls-f6.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F6 rollout targeting is percentage-based single-wave execution per request; no automatic staged scheduler is added.
- No automatic rollback-by-threshold policy in this slice.
- Rollout UI uses JSON patch input for platform-managed fields and intentionally does not add a full policy editor.

### Next recommended step

- Step 10 **G1** secret lifecycle hardening.

### Ready commit message

- `feat(api-web): add step 9 f6 progressive rollout and rollback controls for platform-managed updates`

## 2026-03-24 - Step 9 F5 admin system notifications baseline

### What changed

- Added admin system-notification channel persistence model:
  - `workspace_admin_notification_channels`
  - baseline channel type: `webhook`
- Added admin notification delivery log model:
  - `admin_notification_deliveries`
- Added admin notifications API surface:
  - `GET /api/v1/admin/notifications/channels`
  - `PATCH /api/v1/admin/notifications/channels/webhook`
- Added bounded admin notification channel RBAC rules:
  - read/list uses existing admin read surface authorization
  - webhook channel write/manage requires `ops_admin|security_admin|super_admin` (legacy owner fallback preserved)
- Added best-effort non-blocking webhook delivery integration on selected high-signal audit events:
  - `assistant.runtime.apply_failed`
  - `assistant.runtime.apply_degraded`
  - `assistant.runtime.apply_succeeded`
  - `admin.plan_created`
  - `admin.plan_updated`
- Added `/app` admin system-notifications section:
  - webhook channel enable/config form
  - channel state list with latest delivery summary
- Added ADR-041 and updated roadmap/docs for F5.

### Why changed

- F5 requires a mandatory admin notification channel so critical system signals can reach admins outside web UI while preserving web as the primary admin workspace.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328190000_step9_f5_admin_system_notifications/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-system-notification.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-notification-channels.service.ts`
- `apps/api/src/modules/workspace-management/application/deliver-admin-system-notification.service.ts`
- `apps/api/src/modules/workspace-management/application/append-assistant-audit-event.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-notifications.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/041-admin-system-notifications-f5.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F5 supports webhook channel baseline only; no provider matrix, escalation policies, or digest scheduling.
- Delivery is best-effort and non-blocking; retries/backoff orchestration is intentionally out of scope.
- Signal set is intentionally bounded to selected high-signal events in this slice.

### Next recommended step

- Step 9 **F6** progressive rollout and rollback controls baseline.

### Ready commit message

- `feat(api-web): add step 9 f5 admin system-notification channel baseline with webhook delivery`

## 2026-03-24 - Step 9 F4 business cockpit baseline

### What changed

- Added role-gated admin business cockpit endpoint:
  - `GET /api/v1/admin/business/cockpit`
- Added centralized business cockpit read-model service:
  - `ResolveAdminBusinessCockpitService`
  - returns bounded business views for:
    - active assistants
    - active chats
    - channel split
    - publish/apply success (last 7 days snapshot)
    - quota pressure
    - plan usage snapshot
- Added dedicated admin business cockpit UI section in `/app`:
  - serious, scanable read-only business view
  - separate from ops cockpit section
- Kept operational control surfaces in ops cockpit only; business cockpit remains visibility-only.
- Added ADR-040 and updated roadmap/docs for F4.

### Why changed

- F4 requires a compact business cockpit baseline so platform operators can track commercial/product health signals without turning admin UI into a heavy BI dashboard.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/business-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-business-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-business.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/040-business-cockpit-baseline-f4.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- F4 is a baseline snapshot and does not provide long-range BI analytics, trend charts, or export tooling.
- Channel split is bounded to available control-plane signals and currently reflects MVP channel reality.
- Business cockpit intentionally does not add lifecycle/runtime action controls.

### Next recommended step

- Step 9 **F5** admin system notifications baseline.

### Ready commit message

- `feat(api-web): add step 9 f4 business cockpit baseline with bounded commercial and product views`

## 2026-03-24 - Step 9 F3 ops cockpit baseline

### What changed

- Added role-gated admin ops cockpit read endpoint:
  - `GET /api/v1/admin/ops/cockpit`
- Added centralized ops cockpit read-model service:
  - `ResolveAdminOpsCockpitService`
  - returns bounded operator snapshot for:
    - assistant presence and latest published version
    - runtime apply status and error pointer
    - runtime preflight (`live|ready|checkedAt`)
    - topology awareness (`adapterEnabled`, OpenClaw host)
    - high-signal incident projections
- Added bounded incident signal model in cockpit payload:
  - `assistant_absent`
  - `assistant_not_published`
  - `runtime_preflight_unhealthy`
  - `runtime_apply_failed`
  - `runtime_apply_degraded`
  - `runtime_apply_in_progress`
- Added cockpit control visibility model:
  - `reapplySupported` surfaced when latest published version exists
  - `restartSupported` surfaced as `false` in F3 by design
- Added `/app` ops cockpit section (admin/owner surface) with:
  - assistant/runtime status summary
  - publish/apply truth
  - incident signal list
  - runtime topology line
  - `Reapply latest published version` button wired to existing `POST /api/v1/assistant/reapply`
- Added ADR-039 and updated roadmap/docs for Step 9 F3.

### Why changed

- F3 requires a serious and readable operational cockpit baseline so operators can understand assistant/runtime health and lifecycle truth without relying on raw logs or manual DB inspection.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/ops-cockpit.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-ops.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `apps/web/app/globals.css`
- `docs/ADR/039-ops-cockpit-baseline-f3.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- F3 does not add restart/redeploy orchestration controls.
- F3 does not add historical BI, trends, or dense metrics dashboards.
- Cockpit is intentionally a bounded high-signal snapshot, not an incident timeline/explorer.

### Next recommended step

- Step 9 **F4** business cockpit baseline, reusing F3 operational truth and F1/F2 governance constraints.

### Ready commit message

- `feat(api-web): add step 9 f3 ops cockpit baseline with status signals and reapply control`

## 2026-03-24 - Step 9 F2 admin RBAC and dangerous-action step-up

### What changed

- Added explicit admin RBAC persistence model:
  - `app_user_admin_roles`
  - roles:
    - `ops_admin`
    - `business_admin`
    - `security_admin`
    - `super_admin`
- Added centralized admin authorization/step-up service:
  - `AdminAuthorizationService`
  - role-gated admin read access
  - dangerous admin action enforcement with signed short-lived step-up tokens
- Added admin step-up challenge endpoint:
  - `POST /api/v1/admin/step-up/challenge`
  - action-scoped challenge for:
    - `admin.plan.create`
    - `admin.plan.update`
- Hardened dangerous admin writes:
  - `POST /api/v1/admin/plans` requires `x-persai-step-up-token` for `admin.plan.create`
  - `PATCH /api/v1/admin/plans/{code}` requires `x-persai-step-up-token` for `admin.plan.update`
- Upgraded admin read auth checks from owner-only to role-based (with narrow owner fallback compatibility):
  - `GET /api/v1/admin/plans`
  - `GET /api/v1/admin/plans/visibility`
- Added audit role/actor context for admin actions:
  - new event: `admin.step_up_challenge_issued`
  - enriched events: `admin.plan_created`, `admin.plan_updated` with actor roles + step-up verified flags
- Contracts/OpenAPI updated for:
  - `POST /admin/step-up/challenge`
  - required step-up header on dangerous plan write operations
- Docs updated: ADR-038, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- F2 requires explicit non-collapsed admin role model and hardened dangerous-action confirmation flow so privileged admin operations are role-scoped and step-up protected.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328140000_step9_f2_admin_rbac_stepup/migration.sql`
- `apps/api/src/modules/workspace-management/application/admin-authorization.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-security.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/ADR/038-admin-rbac-and-stepup-f2.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed

### Known risks / intentional limits

- F2 does not add admin-role management API/UI (assignment/revocation workflows remain future scope).
- Step-up currently protects agreed dangerous plan write actions only; broader privileged-action matrix is future scope.
- Compatibility fallback (`workspace owner` -> implicit `business_admin`) remains intentionally narrow and transitional.

### Next recommended step

- Step 9 **F3** ops cockpit baseline using the F1/F2 audit + RBAC model as authorization and visibility foundation.

### Ready commit message

- `feat(api-web): add step 9 f2 admin rbac model and dangerous-action step-up enforcement`

## 2026-03-24 - Step 9 F1 append-only audit log hardening

### What changed

- Added canonical append-only audit persistence model:
  - `assistant_audit_events`
- Enforced append-only behavior at DB level for audit rows:
  - reject `UPDATE`
  - reject `DELETE`
- Added centralized audit append service in `workspace-management`:
  - `AppendAssistantAuditEventService`
- Wired critical high-signal audit coverage into existing control-plane flows:
  - assistant lifecycle:
    - `assistant.created`
    - `assistant.draft_updated`
    - `assistant.published`
    - `assistant.rollback_published`
    - `assistant.reset_published`
    - `assistant.reapply_requested`
  - runtime apply transitions:
    - `assistant.runtime.apply_in_progress`
    - `assistant.runtime.apply_succeeded`
    - `assistant.runtime.apply_failed`
    - `assistant.runtime.apply_degraded`
  - admin actions:
    - `admin.plan_created`
    - `admin.plan_updated`
  - policy/control:
    - `assistant.memory_forget_marker_appended`
  - channel binding and secret-adjacent token fingerprint change:
    - `assistant.telegram_connected`
    - `assistant.telegram_config_updated`
    - `assistant.telegram_token_fingerprint_updated`
- Docs updated: ADR-037, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- F1 requires critical control-plane and runtime-transition truth to be explicitly traceable in an append-only audit layer without turning audit into a noisy raw event dump.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260328120000_step9_f1_append_only_audit_log_hardening/migration.sql`
- `apps/api/src/modules/workspace-management/application/append-assistant-audit-event.service.ts`
- `apps/api/src/modules/workspace-management/application/create-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/update-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts`
- `apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts`
- `apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/do-not-remember-assistant-memory.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `docs/ADR/037-append-only-audit-log-hardening-f1.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- F1 does not add audit read/query APIs yet.
- F1 does not introduce broad chat-turn/event-stream raw dumping by design.
- There is still no dedicated secret management API in this slice; secret-adjacent coverage is limited to Telegram token fingerprint updates on connect.

### Next recommended step

- Step 9 **F2** admin RBAC and step-up actions, with audit events attached to privileged authorization transitions.

### Ready commit message

- `feat(api): add step 9 f1 append-only audit log hardening for lifecycle admin policy and runtime transitions`

## 2026-03-24 - Step 8 E6 provider and fallback baseline

### What changed

- Added explicit runtime provider/fallback projection service:
  - `ResolveRuntimeProviderRoutingService`
  - schema `persai.runtimeProviderRouting.v1`
- Added runtime routing model type:
  - `runtime-provider-routing.types.ts`
- Materialization now resolves provider routing baseline from:
  - effective capabilities
  - optional `policyEnvelope.runtimeProviderRouting` overrides
- Embedded `runtimeProviderRouting` into:
  - `openclawCapabilityEnvelope`
  - OpenClaw-facing materialization payloads (via existing envelope integration path)
- Added API validation script and test coverage:
  - `test:runtime-provider-routing`
  - updated envelope test fixture wiring for `runtimeProviderRouting`
- Docs updated: ADR-036, `ROADMAP`, `ARCHITECTURE`, `API-BOUNDARY`, `TEST-PLAN`, `CHANGELOG`, this handoff.

### Why changed

- E6 requires explicit, resilient runtime primary/fallback behavior while keeping user-facing complexity minimal and aligned with existing entitlement/governance truth.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/runtime-provider-routing.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/runtime-provider-routing.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/036-provider-and-fallback-baseline-e6.md`
- `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:runtime-provider-routing` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed

### Known risks / intentional limits

- E6 remains runtime-managed and provider-agnostic at execution level; it does not introduce vendor-level orchestration.
- No user-facing provider picker is added.
- No provider marketplace/plan-commerce provider packaging logic is added.

### Next recommended step

- Step 9 **F1** append-only audit log hardening.

### Ready commit message

- `feat(api): add step 8 e6 runtime provider fallback baseline routing`

## 2026-03-24 - Step 8 E5 integrations panel messenger presentation

### What changed

- Hardened `/app` user desktop integrations area into a messenger panel with three explicit cards:
  - Telegram
  - MAX
  - WhatsApp
- Telegram card now reflects real integration truth from E4:
  - `connected` state when binding exists
  - connectable state when allowed but not connected
  - not-allowed state when plan capability denies Telegram
- Preserved Telegram connect flow + post-connect configuration panel in the same card.
- MAX and WhatsApp are intentionally non-active in E5:
  - visually muted cards
  - explicit `Coming soon` labels
  - no connect action wired
- Added lightweight premium/warm card styling for uncluttered messenger presentation.
- Updated web app-flow tests to assert coming-soon state rendering.
- Docs updated: ADR-035, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E5 requires an honest user-facing integrations panel that matches messenger strategy and real binding truth without faking unsupported integrations.

### Files touched (high level)

- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `apps/web/app/globals.css`
- `docs/ADR/035-integrations-panel-messenger-presentation-e5.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- MAX and WhatsApp remain presentation-only in E5; connection and delivery are intentionally unsupported.
- Telegram card styling is premium baseline only; deeper polish belongs to later UX polish steps.

### Next recommended step

- Step 8 **E6** provider and fallback baseline over E1-E5 integration truths.

### Ready commit message

- `feat(web): add step 8 e5 messenger integrations panel with truthful states`

## 2026-03-24 - Step 8 E4 Telegram connection and delivery surface

### What changed

- Added canonical assistant-scoped channel binding persistence:
  - `assistant_channel_surface_bindings`
  - stores provider/surface state, policy/config, token fingerprint hint, and Telegram metadata
- Added Telegram integration control-plane endpoints:
  - `GET /assistant/integrations/telegram`
  - `POST /assistant/integrations/telegram/connect`
  - `PATCH /assistant/integrations/telegram/config`
- Implemented Telegram connect flow:
  - short token entry payload (`botToken`)
  - token verification via Telegram `getMe`
  - persisted `telegram` + `telegram_bot` active binding state
  - connected-state response payload (`persai.telegramIntegration.v1`) for UI
- Added web integrations-area UX for Telegram:
  - simple connect instruction flow + token input
  - connected state rendering
  - post-connect Telegram configuration panel
  - web remains primary control-plane surface
- Added best-effort bot profile sync:
  - display name and username from Telegram `getMe`
  - derived avatar URL when username is available
- Hardened E3 binding projection to read active Telegram binding truth from persistence (instead of static unconfigured assumption).
- Docs updated: ADR-034, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E4 requires real Telegram connection UX + persisted binding truth so Telegram can act as interaction/delivery surface without moving assistant control-plane ownership out of web.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260327120000_step8_e4_telegram_connection_surface/migration.sql`
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.entity.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-channel-surface-binding.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-channel-surface-binding.repository.ts`
- `apps/api/src/modules/workspace-management/application/telegram-integration.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-telegram-integration-state.service.ts`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts`
- `apps/api/src/modules/workspace-management/application/update-telegram-integration-config.service.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/telegram-integration.test.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/package.json`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/034-telegram-connection-and-delivery-surface-e4.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:telegram-integration` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test -- app/app/app-flow.client.test.tsx` — passed

### Known risks / intentional limits

- E4 does not implement Telegram webhook ingestion or runtime delivery transport wiring; this slice is connect/config + binding truth.
- Raw Telegram bot token is not persisted in domain read model; connect flow uses verification and stores fingerprint/hint metadata for control-plane traceability.
- WhatsApp/MAX connection and delivery remain out of scope.

### Next recommended step

- Step 8 **E5** integrations panel and messenger binding UX expansion over the E4 Telegram connect baseline.

### Ready commit message

- `feat(api-web): add step 8 e4 telegram connect flow and binding surface`

## 2026-03-24 - Step 8 E3 channel and surface binding model hardening

### What changed

- Added explicit channel/surface binding projection resolver:
  - `ResolveOpenClawChannelSurfaceBindingsService`
  - schema `persai.openclawChannelSurfaceBindings.v1`
- Binding projection now models non-flat structure:
  - providers: `web_internal`, `telegram`, `whatsapp`, `max`, `system_notifications`
  - surfaces: `web_chat`, `telegram_bot`, `whatsapp_business`, `max_bot`, `max_mini_app`, `system_notification`
  - assistant-binding status/state at provider level
  - policy/config split at provider and surface levels
- Integrated `openclawChannelSurfaceBindings` into `openclawCapabilityEnvelope` and materialization outputs consumed by OpenClaw.
- Applied corrective hardening for prior channel assumptions:
  - preserved existing `channelsAndSurfaces.max` entitlement gate for compatibility
  - projected that gate into two distinct surfaces (`max_bot`, `max_mini_app`) to avoid flattening
- Added explicit unavailable-surface suppression list (`deniedSurfaceTypes` + `declaredSurfaceTypes`).
- Added API test script `test:openclaw-channel-surface-bindings` and updated envelope test to validate embedded channel/surface binding payload.
- Docs updated: ADR-033, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E3 requires provider+surface binding truth to be explicit and runtime-safe so OpenClaw can distinguish available, unavailable, and non-existent surfaces without Telegram-specific or flat-surface assumptions.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/openclaw-channel-surface-bindings.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-channel-surface-bindings.service.ts`
- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/openclaw-channel-surface-bindings.test.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/033-channel-surface-binding-model-e3.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-channel-surface-bindings` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed

### Known risks / intentional limits

- E3 is projection hardening only; no Telegram/WhatsApp/MAX delivery execution is implemented.
- Provider config refs are modeled as control-plane references and not connected to runtime channel provisioning in this slice.
- Existing plan entitlement source for MAX remains one coarse gate; split commercial/package controls for `max_bot` vs `max_mini_app` are deferred.

### Next recommended step

- Step 8 **E4** Telegram connection and delivery surface over the E3 binding baseline.

### Ready commit message

- `feat(api): add step 8 e3 channel-surface binding envelope hardening`

## 2026-03-24 - Step 8 E2 OpenClaw capability envelope hardening

### What changed

- Added explicit OpenClaw-facing capability envelope resolver:
  - `ResolveOpenClawCapabilityEnvelopeService`
  - schema `persai.openclawCapabilityEnvelope.v1`
- Materialization now projects `openclawCapabilityEnvelope` into:
  - governance layer snapshot
  - `openclawBootstrap`
  - `openclawWorkspace`
- Envelope now contains explicit runtime truth:
  - per-tool allow/deny + deny reason
  - per-group allow/deny lists
  - canonical declared tool set (`catalog.declaredToolCodes`) for exists/non-exists truth
  - per-surface allowances (`webChat|telegram|whatsapp|max`)
  - quota-related class restrictions for utility/cost-driving classes
  - explicit unavailable-tool suppression list (`deniedToolCodes`)
- Preserved tasks/reminders as non-commercial quota class in envelope restrictions:
  - `tasksAndRemindersExcludedFromCommercialQuotas`
- Added API test script `test:openclaw-capability-envelope`.
- Docs updated: ADR-032, `ARCHITECTURE`, `API-BOUNDARY`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E2 requires one explicit OpenClaw-facing capability envelope so runtime knows what exists, what is denied, and what is unavailable without relying on implied defaults.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/openclaw-capability-envelope.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-openclaw-capability-envelope.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/openclaw-capability-envelope.test.ts`
- `apps/api/package.json`
- `docs/ADR/032-openclaw-capability-envelope-e2.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:openclaw-capability-envelope` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed

### Known risks / intentional limits

- E2 is projection hardening only; no backend runtime routing or tool execution framework is added.
- No per-tool admin UI control surface is added in E2.
- E2 does not introduce endpoint-by-endpoint per-tool enforcement expansion beyond existing control-plane gates.

### Next recommended step

- Step 8 **E3** channel/surface binding model hardening over the E1/E2 governance baseline.

### Ready commit message

- `feat(api): add step 8 e2 openclaw capability envelope with explicit suppression truth`

## 2026-03-24 - Step 8 E1 tool catalog and activation model

### What changed

- Added canonical governed tool catalog persistence:
  - `tool_catalog_tools`
  - `plan_catalog_tool_activations`
- Added explicit tool model dimensions for control-plane governance:
  - capability group (`knowledge|automation|communication|workspace_ops`)
  - tool class (`cost_driving|utility`)
  - plan-scoped activation status (`active|inactive`)
- Hardened plan catalog create/update persistence flow:
  - plan tool-activation rows are synchronized from existing tool-class entitlement toggles
- Added centralized per-tool availability resolver:
  - `ResolveEffectiveToolAvailabilityService`
  - projects catalog + plan activation + effective class guardrail into materialization-safe truth
- Upgraded materialized tool-availability schema from class-only to per-tool model:
  - `persai.effectiveToolAvailability.v2`
- Added deterministic seed baseline tool catalog rows and default-plan activation rows.
- Docs updated: ADR-031, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- E1 requires tools to be treated as a governed mini-system with explicit catalog and activation truth, while preserving the backend control-plane vs OpenClaw runtime boundary.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260327100000_step8_e1_tool_catalog_activation/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.entity.ts`
- `apps/api/src/modules/workspace-management/domain/tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-tool-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/application/effective-tool-availability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-tool-availability.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/tool-catalog-activation.test.ts`
- `apps/api/package.json`
- `docs/ADR/031-tool-catalog-and-activation-model-e1.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:tool-catalog-activation` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- E1 introduces persistence + materialization truth only; no per-tool admin/web UI controls are added in this slice.
- E1 does not add backend tool execution/routing logic; OpenClaw remains runtime execution owner.
- Class-level enforcement points from P6 remain active; endpoint-by-endpoint per-tool enforcement is not expanded in E1.

### Next recommended step

- Step 8 **E2** tool policy and OpenClaw capability envelope alignment over the E1 catalog/activation baseline.

### Ready commit message

- `feat(api): add step 8 e1 governed tool catalog and plan activation model`

## 2026-03-23 - Step 7 P1-P7 post-deploy live validation + hotfixes

### What changed

- Completed live validation on dev GKE for Step 7 P1-P7 user/admin flows after deploy.
- Verified deployed images aligned to the current release commit for both `api` and `web`.
- Confirmed live route availability and successful auth-gated responses for:
  - `GET /api/v1/admin/plans`
  - `GET /api/v1/admin/plans/visibility`
  - `GET /api/v1/assistant/plan-visibility`
- Confirmed admin plan creation and editing in UI and API:
  - `POST /api/v1/admin/plans` returns success (`201`)
  - `PATCH /api/v1/admin/plans/:code` returns success (`200`)
- Confirmed chat streaming happy path after entitlement correction:
  - stream completes
  - response persists
  - "Do not remember this" action remains available on committed assistant turns.
- Fixed two post-deploy regressions discovered during validation:
  - contracts path regression: `postAdminPlanCreate` was erroneously attached to `/admin/plans/visibility` in OpenAPI and was restored to `/admin/plans`
  - web client response guard: admin create path now accepts `201` and `200` as success for `POST /admin/plans`
- Regenerated contracts and revalidated web typecheck/tests.

### Why changed

- Deployment initially surfaced false 404 and false non-success errors caused by contract/client mismatch, not by backend route availability.
- This live pass was required to confirm P1-P7 product behavior end-to-end under real runtime conditions.

### Files touched (high level)

- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test` — passed
- Live cluster verification (`kubectl` + runtime logs) — passed for the P1-P7 target flows

### Known risks / intentional limits

- `Plan state: unconfigured` remains expected when no explicit workspace subscription lifecycle row is present; effective plan can still resolve via fallback.
- Prisma OpenSSL warning remains visible in API logs; it is not a blocker for current functionality but should be hardened in base image later.

### Next recommended step

- Start Step 8 E1 (tool catalog and activation model) and extend visibility from class-level to per-tool level once catalog primitives are introduced.

### Ready commit message

- `fix(web-contracts): align admin plan create route and 201 handling; document step7 live validation`

## 2026-03-26 - Step 7 P7 plan visibility read models

### What changed

- Added user-facing plan visibility endpoint:
  - `GET /api/v1/assistant/plan-visibility`
  - returns effective plan state plus key commercial limits as percentages only
- Added admin-facing plan visibility endpoint:
  - `GET /api/v1/admin/plans/visibility`
  - returns plan catalog state snapshot, usage pressure percentages/level, and effective entitlement snapshot
- Added centralized read-model service:
  - `ResolvePlanVisibilityService`
  - resolves visibility from existing P1-P6 control-plane truth (plan catalog, subscription resolution, capability resolution, quota state)
- Updated web `/app` to surface:
  - user-facing "Plan and limits visibility" section
  - owner-only "Admin plan visibility" section
- Updated OpenAPI/contracts and web API client for the new endpoints/types.
- Docs updated: ADR-030, `API-BOUNDARY`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P7 requires plans/limits/entitlements to be visible in product-correct, calm UX language while preserving backend governance boundaries and avoiding a noisy billing dashboard.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/plan-visibility.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-plan-visibility.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/*`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/030-plan-visibility-read-models-p7.md`
- `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run typecheck` — passed
- `corepack pnpm --filter @persai/web run test` — passed

### Known risks / intentional limits

- P7 provides snapshot visibility read models, not historical BI/reporting timelines.
- P7 keeps class-level tool visibility and does not introduce per-tool catalog UI.
- No billing-provider workflow UI (checkout/invoices/payment/tax) is added.

### Next recommended step

- Step 8 **E1** tool catalog and activation model, using P7 visibility as the baseline operator/user read surface.

### Ready commit message

- `feat(api-web): add step 7 p7 user and admin plan visibility read models`

## 2026-03-26 - Step 7 P6 enforcement points baseline

### What changed

- Added centralized enforcement layer service: `EnforceAssistantCapabilityAndQuotaService`.
- Activated P6 enforcement at agreed control-plane boundaries:
  - sync web chat send flow
  - streaming web chat prepare flow
- Enforcement checks now executed in one place:
  - capability checks:
    - web chat channel availability
    - text media class availability
    - utility tool-class availability
  - quota/cap checks:
    - active web chats cap for new-thread creation
    - token budget limit
    - cost/token-driving tool-class limit when quota-governed
- Added read access for workspace quota accounting state in repository boundary for enforcement.
- Materialization now includes explicit `toolAvailability` (`persai.effectiveToolAvailability.v1`) in:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document
- Added API test script: `test:enforcement-points`.
- Docs updated: ADR-029, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P6 turns P1-P5 plan/entitlement/capability/quota state into active product rules at explicit control-plane boundaries while keeping backend out of runtime behavior routing.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/enforce-assistant-capability-and-quota.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/enforcement-points.test.ts`
- `apps/api/package.json`
- `docs/ADR/029-enforcement-points-p6.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- P6 enforces at current agreed boundaries (web chat send/stream prepare); broader endpoint-by-endpoint enforcement remains future hardening scope.
- `toolAvailability` in P6 is class-level truth only; per-tool catalog activation remains Step 8 scope.
- Backend still does not route runtime tool behavior.

### Next recommended step

- Step 7 **P7** user/admin plan visibility over enforced limits/capabilities and percentage-oriented quota UX read models.

### Ready commit message

- `feat(api): add step 7 p6 centralized capability and quota enforcement points`

## 2026-03-26 - Step 7 P5 quota accounting baseline

### What changed

- Added canonical quota accounting persistence in API Prisma model:
  - `workspace_quota_accounting_state` (workspace latest counters/limits)
  - `workspace_quota_usage_events` (append-only usage/snapshot events)
- Added explicit quota dimensions enum:
  - `token_budget`
  - `cost_or_token_driving_tool_class`
  - `active_web_chats_cap`
- Added centralized `TrackWorkspaceQuotaUsageService` in `workspace-management` application layer to avoid scattered/runtime-hidden quota logic.
- Wired quota tracking into existing control-plane flows:
  - sync web chat turn (token + cost/token-driving usage)
  - stream web chat turn completed/partial outcomes (token + cost/token-driving usage)
  - active web chats snapshot refresh on prepare/archive/hard-delete paths
- Added workspace quota repository boundary + Prisma implementation.
- Added provider-agnostic quota default config values:
  - `QUOTA_TOKEN_BUDGET_DEFAULT`
  - `QUOTA_COST_OR_TOKEN_DRIVING_TOOL_UNITS_DEFAULT`
  - with existing `WEB_ACTIVE_CHATS_CAP` for active chat cap limit
- Added `test:quota-accounting` API script.
- Docs updated: ADR-028, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P5 requires explicit quota accounting for commercially meaningful dimensions while keeping tasks/reminders outside commercial quota limits and preserving P1-P4 architecture boundaries.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326220000_step7_p5_quota_accounting/migration.sql`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.entity.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-quota-accounting.repository.ts`
- `apps/api/src/modules/workspace-management/application/track-workspace-quota-usage.service.ts`
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/quota-accounting.test.ts`
- `apps/api/package.json`
- `packages/config/src/api-config.ts`
- `apps/api/.env.local.example`, `apps/api/.env.dev.example`
- `infra/helm/values.yaml`, `infra/helm/values-dev.yaml`
- `docs/ADR/028-quota-accounting-baseline-p5.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- No billing provider integration, invoicing/tax flows, or BI/reporting expansion in P5.
- No new public quota API endpoints in this slice.
- Token budget in P5 uses deterministic estimator (`chars_div_4_ceil_v1`) until runtime token telemetry is formalized.
- Enforcement matrix is not added in P5 (next slice scope).
- Tasks/reminders remain intentionally excluded from commercial quota accounting.

### Next recommended step

- Step 7 **P6** enforcement points using P4 effective capability state + P5 accounting counters.

### Ready commit message

- `feat(api): add step 7 p5 quota accounting baseline for token toolclass and active-web-chat dimensions`

## 2026-03-26 - Step 7 P4 capability resolution engine

### What changed

- Added centralized capability resolution service `ResolveEffectiveCapabilityStateService` with output schema `persai.effectiveCapabilities.v1`.
- Resolution inputs are now unified in one place:
  - P3 effective subscription state
  - P1/P2 plan catalog entitlements
  - assistant governance capability envelope
- Resolution output includes explicit effective allowances for:
  - tool classes
  - channels/surfaces
  - media classes
  - governed features
- Materialization now embeds `effectiveCapabilities` into:
  - governance layer snapshot
  - OpenClaw bootstrap document
  - OpenClaw workspace document
- Added API test `test:capability-resolution`.
- Applied minimal corrective hardening required by P4:
  - `findByCode` plan lookup now resolves by `code` regardless of plan status, so existing subscriptions pinned to inactive plans still resolve effective capability baseline.
- Docs updated: ADR-027, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P4 requires one explicit reusable capability truth source for enforcement layers and runtime projection without duplicating logic or turning backend into behavior routing.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/application/effective-capability.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-capability-state.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts` (minimal corrective hardening)
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/capability-resolution.test.ts`
- `apps/api/package.json`
- `docs/ADR/027-capability-resolution-engine-p4.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:capability-resolution` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- P4 computes and propagates effective capability truth but does not yet enforce every endpoint/action.
- Media-class allowance baseline is conservative and governance-driven; richer plan-level media entitlements remain future scope.
- No billing-provider or quota-accounting expansion in this slice.

### Next recommended step

- Step 7 **P5** quota accounting baseline, consuming P4 effective capability outputs.

### Ready commit message

- `feat(api): add step 7 p4 centralized capability resolution engine and materialization projection`

## 2026-03-26 - Step 7 P3 subscription state and billing abstraction boundary

### What changed

- Added canonical subscription persistence model:
  - Prisma enum `WorkspaceSubscriptionStatus`
  - table/model `workspace_subscriptions` (workspace-scoped subscription state)
- Added provider-agnostic billing boundary:
  - `BillingProviderPort` + normalized snapshot contract
  - null/no-op adapter baseline (`NullBillingProviderAdapter`) with no vendor integration
- Added effective subscription resolution service:
  - `ResolveEffectiveSubscriptionStateService`
  - precedence: workspace subscription -> assistant `quotaPlanCode` -> catalog default -> none
  - fallback status `unconfigured` for unresolved non-provider states
- Added repository boundary for workspace subscriptions and Prisma implementation.
- Added API test script `test:subscription-state` covering precedence behavior.
- Seed baseline now includes workspace subscription state for seeded workspace (`starter_trial`, `trialing`).
- Docs updated: ADR-026, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P3 establishes provider-agnostic subscription truth and future billing integration hooks without redesigning P1/P2 plan structures.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- migration `20260326200000_step7_p3_subscription_state_and_billing_boundary`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/domain/workspace-subscription.*`
- `apps/api/src/modules/workspace-management/application/billing-provider.port.ts`
- `apps/api/src/modules/workspace-management/application/effective-subscription.types.ts`
- `apps/api/src/modules/workspace-management/application/resolve-effective-subscription-state.service.ts`
- `apps/api/src/modules/workspace-management/infrastructure/billing/null-billing-provider.adapter.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-subscription.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/test/subscription-state-resolve.test.ts`
- `apps/api/package.json`
- `docs/ADR/026-subscription-state-and-billing-abstraction-p3.md`
- `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run prisma:generate` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run test:subscription-state` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- No concrete billing provider integration, webhooks, invoice/tax/payment flows in P3.
- Subscription state is modeled and resolved in backend control plane; no new public subscription API surface in this slice.
- Entitlement/quota enforcement engine remains out of scope.

### Next recommended step

- Step 7 **P4** capability resolution engine using P1/P2 catalog + P3 effective subscription resolution.

### Ready commit message

- `feat(api): add step 7 p3 workspace subscription state and billing abstraction boundary`

## 2026-03-26 - Step 7 P2 admin plan management UI/API

### What changed

- Added owner-gated admin plan management API:
  - `GET /api/v1/admin/plans`
  - `POST /api/v1/admin/plans`
  - `PATCH /api/v1/admin/plans/{code}`
- Added centralized plan management application service (`ManageAdminPlansService`) and expanded plan catalog repository for list/create/update flows.
- Added `/app` owner-only admin section for plan create/edit with serious control-plane forms:
  - naming and metadata
  - default-on-registration
  - trial + duration
  - entitlement and limits controls
- Extended contracts/OpenAPI + generated client models for admin plan endpoints and payloads.
- Docs updated: ADR-025, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P2 requires direct admin-side plan packaging controls without coupling to a billing vendor or exposing raw DB internals.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/interface/http/admin-plans.controller.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`
- `apps/api/src/modules/workspace-management/domain/assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-plan-catalog.repository.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `apps/web/app/app/assistant-api-client.ts`
- `apps/web/app/app/app-flow.client.tsx`
- `apps/web/app/app/app-flow.client.test.tsx`
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `docs/ADR/025-admin-plan-management-p2.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/TEST-PLAN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run contracts:generate` — passed
- `corepack pnpm --filter @persai/api run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed
- `corepack pnpm run typecheck` — passed
- `corepack pnpm run test:step2` — passed

### Known risks / intentional limits

- No billing provider console/workflow in P2 (checkout, subscription lifecycle, invoices/webhooks remain out of scope).
- Owner-gate uses workspace owner check; full admin RBAC expansion remains Step 9 scope.
- Entitlement enforcement runtime/quotas are not added in P2; this slice is plan management control surface only.

### Next recommended step

- Step 7 **P3** subscription state + billing abstraction, keeping P1/P2 provider-agnostic boundaries intact.

### Ready commit message

- `feat(api-web): add step 7 p2 owner-gated admin plan management ui and api`

## 2026-03-26 - Step 7 P1 plan catalog and entitlement model

### What changed

- Added canonical plan catalog persistence:
  - `plan_catalog_plans` (`code`, `status`, provider-agnostic metadata, `isDefaultFirstRegistrationPlan`, `isTrialPlan`, `trialDurationDays`)
  - `plan_catalog_entitlements` (1:1 by plan with grouped entitlement JSON arrays for capabilities, tool classes, channels/surfaces, limits permissions)
- Added DB integrity constraints:
  - partial unique index for single default first-registration plan
  - trial duration check (`is_trial_plan=false => null`, `is_trial_plan=true => >0`)
- Governance baseline creation now resolves `quotaPlanCode` from active default-first-registration plan in catalog (nullable fallback when catalog is empty).
- Seed baseline now inserts/updates provider-agnostic default trial plan `starter_trial` (14 days) and canonical entitlement payload.
- Docs updated: ADR-024, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- P1 makes plan packaging and entitlement truth explicit in the control plane without coupling to a billing vendor or introducing subscription workflow scope.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260326170000_step7_p1_plan_catalog_entitlements/migration.sql`
- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `docs/ADR/024-plan-catalog-and-entitlements-p1.md`
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Tests run / result

- pending in current session

### Known risks / intentional limits

- No plan-management API/UI in P1.
- No billing provider workflows (checkout, subscription state machine, invoices/webhooks).
- No entitlement enforcement engine yet; P1 defines canonical storage and governance default assignment only.

### Next recommended step

- Step 7 **P2** admin plan management UI (or management API first) while keeping P1 provider-agnostic model unchanged.

### Ready commit message

- `feat(api): add step 7 p1 canonical plan catalog and entitlement model`

## 2026-03-26 - Step 6 D5 Tasks Center MVP

### What changed

- Added **`assistant_task_registry_items`** and APIs: list tasks, pause (`disable`), resume (`enable`), stop (`cancel`), with sorting and **409** when `tasks_control` denies an action.
- Web **Tasks** section in the assistant editor (after Memory): Active / Inactive groups, source pill, next-run messaging, warm copy; **EDITOR_SECTIONS** includes `Tasks`.
- OpenAPI/contracts + Clerk middleware routes; `globals.css` task-center styling; `test:tasks-user-controls`; web tests for Tasks nav + mocked list.
- Docs: ADR-023, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `DESIGN`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D5 delivers the agreed Tasks Center MVP: inspect and control reminders/tasks without exposing raw runtime or building a workflow designer.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`, migration `20260326120000_step6_d5_tasks_center_registry`
- `apps/api/src/modules/workspace-management/**` (task domain, repo, services, controller, module, `tasks-user-controls.ts`)
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/web/app/app/app-flow.client.tsx`, `assistant-api-client.ts`, `app-flow.client.test.tsx`, `globals.css`
- `apps/api/test/tasks-user-controls.test.ts`, `apps/api/package.json`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `docs/ADR/023-tasks-center-mvp-d5.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm --filter @persai/api run test:tasks-user-controls` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires Postgres)

### Known risks / intentional limits

- Registry may stay **empty** until OpenClaw/sync (or ops) inserts rows; UI explains that honestly.
- Control actions update **PersAI registry state only** in D5; runtime must consume/sync separately.
- Cancelled items cannot be re-enabled from the API.

### Next recommended step

- Step 7 **P1** plan catalog (per `docs/ROADMAP.md`) or wire task registry population from OpenClaw when contract-ready.

### Ready commit message

- `feat(api-web): add step 6 d5 tasks center registry and ui`

## 2026-03-25 - Step 6 D4 tasks control domain hardening

### What changed

- Added canonical **`tasks_control`** on `assistant_governance` with default **`persai.tasksControl.v1`**: ownership (`user_assistant_owner`), source/surface hooks (`knownSurfaces`, `requireSurfaceTag`), control lifecycle **labels** (`statusKinds` + `executionOwnedBy: openclaw_runtime`), enable/disable and cancel flags, **`commercialQuota.tasksExcludedFromPlanQuotas: true`**, audit delegation to governance `auditHook`.
- Resolution + materialization: **`openclawWorkspace.tasksControl`** uses column → `policyEnvelope.tasksControl` → defaults; governance layer snapshot includes raw `tasksControl`.
- API/OpenAPI/contracts: **`governance.tasksControl`** on assistant lifecycle reads.
- **PRODUCT.md** corrected: tasks/reminders are not a commercial quota dimension (aligned with envelope).
- Docs: ADR-022, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D4 hardens the hybrid model: PersAI owns control/visibility metadata; OpenClaw owns execution — without a backend scheduler or task router.

### Files touched (high level)

- `apps/api/prisma/schema.prisma`, migration `20260325120000_step6_d4_tasks_control_domain`
- `apps/api/src/modules/workspace-management/domain/assistant-tasks-control.defaults.ts`, `tasks-control-resolve.ts`, `assistant-governance.entity.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`, `assistant-lifecycle.mapper.ts`, `assistant-lifecycle.types.ts`
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/api/test/tasks-control-resolve.test.ts`, `apps/api/package.json`
- `apps/web/app/app/app-flow.client.test.tsx`
- `docs/ADR/022-tasks-control-domain-d4.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run test:tasks-control` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires Postgres)

### Known risks / intentional limits

- No task rows, list APIs, or UI (D5); envelope is control-plane only.
- OpenClaw must still interpret `openclawWorkspace.tasksControl` if/when runtime integration needs it.

### Next recommended step

- Step 7 **P1** plan catalog (per `docs/ROADMAP.md`) or OpenClaw task-registry population when ready.

### Ready commit message

- `feat(api): add step 6 d4 tasks control envelope and materialization`

## 2026-03-24 - Step 6 D3 memory source policy enforcement

### What changed

- Enforced global memory **read** policy on all Memory Center–related APIs (list, forget-by-id, do-not-remember) using `globalMemoryReadAllSurfaces` on the resolved `memory_control` envelope.
- Enforced global **registry write** policy after successful web chat turns: caller supplies explicit `memoryWriteContext` (`web` + `trusted_1to1`); denies `group` and non–trusted-1:1 classifications; requires surface in both allowed and trusted 1:1 write lists.
- Extended default `memory_control` with `trustedOneToOneGlobalWriteSurfaces` and `sourceClassification`; Prisma migration backfills existing JSON documents.
- Docs: ADR-021, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP`, `CHANGELOG`, this handoff.

### Why changed

- D3 requires the agreed memory source policy to be **evaluated in code**, not implied by JSON alone, with explicit trust/surface classification in the control model.

### Files touched (high level)

- `apps/api/src/modules/workspace-management/domain/memory-source-policy.ts`, `memory-control-resolve.ts`, `assistant-memory-control.defaults.ts`
- `apps/api/src/modules/workspace-management/application/record-web-chat-memory-turn.service.ts`, `send-web-chat-turn.service.ts`, `stream-web-chat-turn.service.ts`, `list-assistant-memory-items.service.ts`, `forget-assistant-memory-item.service.ts`, `do-not-remember-assistant-memory.service.ts`, `materialize-assistant-published-version.service.ts`
- `apps/api/prisma/migrations/20260324160000_step6_d3_memory_source_policy_envelope/migration.sql`
- `apps/api/test/memory-source-policy.test.ts`, `apps/api/package.json`
- `docs/ADR/021-memory-source-policy-d3.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/api run test:memory-policy` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm run prisma:migrate:check` — not run in this session (requires local Postgres)

### Known risks / intentional limits

- Only **web** is a typed transport surface; channel/group ingest is intentionally unsupported—future surfaces must thread explicit `GlobalMemoryWriteAttemptContext`.
- Disabling `denyGroupSourcedGlobalWrites` still does not allow group → global registry (explicit not-supported path).
- Registry write denial **skips** registry insert only; chat completion remains successful.

### Next recommended step

- Step 6 **D5** Tasks Center MVP (per `docs/ROADMAP.md`).

### Ready commit message

- `feat(api): enforce step 6 d3 global memory source policy`

## 2026-03-23 - Step 6 D2 Memory Center MVP

### What changed

- Delivered Memory Center MVP (web): list of calm one-line summaries from completed web chat turns, source/type pill, forget-from-list, and “Do not remember this” on streamed assistant messages after IDs reconcile to server UUIDs.
- Backend: table `assistant_memory_registry_items`, record hook after successful `SendWebChatTurnService` / `StreamWebChatTurnService` completion, list/forget/do-not-remember endpoints, governance `forgetRequestMarkers` append on do-not-remember.
- Contracts/OpenAPI + Clerk middleware routes; minimal global CSS for memory cards and quiet buttons.
- Docs: ADR-020, `ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `ROADMAP` (D2 done), `CHANGELOG`, this handoff.

### Why changed

- D2 requires a trustworthy user-facing memory surface without raw OpenClaw internals or an admin console.

### Files touched (high level)

- `apps/api/prisma/*`, new migration `20260324140000_step6_d2_memory_center_registry`
- `apps/api/src/modules/workspace-management/**` (memory services, repos, controller, stream/send wiring)
- `packages/contracts/openapi.yaml`, `packages/contracts/src/generated/*`
- `apps/web/app/app/app-flow.client.tsx`, `assistant-api-client.ts`, `app-flow.client.test.tsx`, `globals.css`
- `apps/api/src/modules/identity-access/identity-access.module.ts`
- `docs/ADR/020-memory-center-mvp-d2.md`, `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm run prisma:migrate:check` — passed
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run lint` — passed
- `corepack pnpm run test:step2` — passed
- `corepack pnpm --filter @persai/web run build` — passed

### Known risks / intentional limits

- Summaries are derived from web chat transcripts, not a live export of OpenClaw runtime memory.
- Interrupted/partial stream turns do not create registry rows.
- Do-not-remember appends control-plane markers; runtime application in OpenClaw is not implemented in this slice.

### Next recommended step

- Step 6 `D3` memory source policy enforcement (ingest/write gates) building on registry + `memory_control`.

### Ready commit message

- `feat(api-web): add step 6 d2 memory center and web chat do-not-remember`

## 2026-03-23 - Step 6 D1 memory control domain hardening

### What changed

- Hardened backend memory **control plane** while keeping OpenClaw as runtime memory behavior owner:
  - added Prisma column `assistant_governance.memory_control` and migration with backfill from `policyEnvelope.memoryControl` when set
  - seeded new assistants with default `persai.memoryControl.v1` envelope (`createDefaultMemoryControlEnvelope`)
  - materialization now resolves effective memory control from column → legacy nested key → default
  - included `memoryControl` in materialization governance layer snapshot for auditability
  - exposed `governance.memoryControl` on assistant lifecycle API + OpenAPI/contracts
- Documented boundary in `docs/ARCHITECTURE.md`, `docs/API-BOUNDARY.md`, `docs/DATA-MODEL.md`, ADR-019; marked D1 complete in `docs/ROADMAP.md`.

### Why changed

- D1 requires explicit governable memory policy/hooks/markers in the control plane without moving runtime memory mechanics into `apps/api`.
- Prior code only read optional `policyEnvelope.memoryControl` during materialization; there was no canonical persisted baseline.

### Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260324120000_step6_d1_memory_control_domain/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-governance.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-memory-control.defaults.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-governance.repository.ts
- apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.types.ts
- apps/api/src/modules/workspace-management/application/assistant-lifecycle.mapper.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- apps/web/app/app/app-flow.client.test.tsx
- docs/ADR/019-memory-control-domain-d1.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run typecheck` — passed
- `corepack pnpm run prisma:migrate:check` — passed (local Postgres)
- `corepack pnpm --filter @persai/api run lint` — passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` — passed

### Known risks

- Existing materialized specs keep prior `content_hash` until republish/reapply path creates a new spec; new publishes pick up enriched governance layer including `memoryControl`.
- Clients must tolerate new `governance.memoryControl` field (nullable object).

### Next recommended step

- Step 6 `D2` Memory Center MVP (read-focused UX) using `governance.memoryControl` + future memory list APIs as designed.

### Ready commit message

- `feat(api): add step 6 d1 memory control envelope and materialization wiring`

## 2026-03-23 - OpenClaw patch protection hardening

### What changed

- Added deploy-safety protections around OpenClaw compatibility patch usage:
  - added `infra/dev/gitops/validate-openclaw-compat-patch.sh`
    - resolves pinned SHA from `infra/dev/gitops/openclaw-approved-sha.txt`
    - materializes OpenClaw at that exact SHA
    - runs `git apply --check` for `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`
  - wired the validator into `.github/workflows/ci.yml` so malformed patch files fail in CI before deployment workflows
  - strengthened `.github/workflows/openclaw-dev-image-publish.yml` patch step by adding an explicit `git apply --check` preflight before `git apply`

### Why changed

- Deploy failed with `error: corrupt patch at line 15` during patch apply.
- This adds an early deterministic gate so patch formatting or drift issues are caught before image publish/deploy path.

### Files touched

- infra/dev/gitops/validate-openclaw-compat-patch.sh
- .github/workflows/ci.yml
- .github/workflows/openclaw-dev-image-publish.yml
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- Not run locally in this slice (workflow and script hardening only).

### Known risks

- Validation depends on cloning `OPENCLAW_FORK_REPO`; transient GitHub/network outages can fail the guard even when patch is valid.
- Guard checks patch applicability against the pinned SHA only; patch may still fail if workflow target SHA is changed without updating the pin.

### Next recommended step

- Trigger CI once to confirm validator pass, then trigger `OpenClaw Dev Image Publish` to verify apply preflight and publish path end-to-end.

### Ready commit message

- `ci(gitops): add openclaw patch preflight validation guards`

## 2026-03-23 - Step 5 C6 chat error/degradation UX slice

### What changed

- Completed Step 5 slice `C6` only (human-friendly chat error/degradation UX):
  - added web chat UX error-classification layer in `apps/web` API client
  - mapped transport/runtime failures to user-facing classes with guidance:
    - auth/session
    - input validation
    - assistant-not-live lifecycle gate
    - active chat cap
    - runtime unreachable
    - runtime timeout
    - runtime degraded
    - runtime auth failure
    - provider/tool/channel-style failures
    - stream incomplete/partial outcomes
  - updated web chat UI to show friendly issue message + next-step guidance instead of raw error text
  - preserved honest streaming behavior:
    - partial outputs remain visible and preserved
    - failure/degradation guidance remains explicit but non-technical
  - updated docs:
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C6` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C6 requires user-facing clarity for chat degradation/error states without leaking runtime internals.
- Prior path could surface raw backend/runtime message text directly.
- New layer keeps messaging honest and actionable while preserving admin/support depth separation.

### Files touched

- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C6 classification is rule-based message/status mapping, not a dedicated centralized taxonomy service.
- Support/admin diagnostic depth remains intentionally outside normal user path and is not surfaced in this UI slice.

### Next recommended step

- Start Step 6 `D1` memory control domain while preserving C1-C6 chat boundary and UX behavior.

### Ready commit message

- `feat(web): add step 5 c6 human-friendly chat degradation and error UX classes`

## 2026-03-23 - Step 5 C5 active web chats cap slice

### What changed

- Completed Step 5 slice `C5` only (active web chats cap enforcement):
  - added backend cap enforcement for web chat transport paths:
    - synchronous path (`C2`) in `SendWebChatTurnService`
    - streaming path (`C3`) in `StreamWebChatTurnService`
  - cap is checked only when creating a **new** web chat thread (`surfaceThreadKey` not yet present)
  - existing thread turns continue to work even when cap is reached
  - cap counts active chats only (`archivedAt = null`)
  - added admin-configurable API config/env threshold:
    - `WEB_ACTIVE_CHATS_CAP` (default `20`)
  - wired cap env into examples and Helm values:
    - `apps/api/.env.local.example`
    - `apps/api/.env.dev.example`
    - `infra/helm/values.yaml`
    - `infra/helm/values-dev.yaml`
  - web `/app` now shows explicit user-facing guidance when cap is reached
  - updated docs:
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C5` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C5 requires a real, user-visible enforcement point for active web chat limits.
- The limit must block new chat creation explicitly without silent failure or destructive side effects.
- Cap must stay operationally tunable by admins without introducing billing implementation scope.

### Files touched

- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts
- apps/web/app/app/app-flow.client.tsx
- packages/config/src/api-config.ts
- apps/api/.env.local.example
- apps/api/.env.dev.example
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C5 currently enforces a single global per-assistant web active-chat cap value from API config; no plan/tier-specific limits yet.
- Cap enforcement is transport-path based (new-thread creation point), not a separate dedicated quota subsystem.
- C6 degradation/error UX refinements are not yet implemented.

### Next recommended step

- Proceed to Step 5 `C6` (chat error/degradation UX) while preserving explicit C5 cap guidance and non-destructive cap behavior.

### Ready commit message

- `feat(api-web): add step 5 c5 active web chats cap enforcement and guidance`

## 2026-03-23 - Step 5 C4 web chat list and actions slice

### What changed

- Completed Step 5 slice `C4` only (GPT-style web chat list and core chat actions):
  - added backend web chat list endpoint:
    - `GET /api/v1/assistant/chats/web`
  - added backend chat actions:
    - rename: `PATCH /api/v1/assistant/chats/web/:chatId`
    - archive: `POST /api/v1/assistant/chats/web/:chatId/archive`
    - hard delete: `DELETE /api/v1/assistant/chats/web/:chatId`
  - hard delete requires explicit confirmation payload:
    - `confirmText=DELETE`
  - implemented hard delete as true destructive delete:
    - removes chat row
    - removes related chat message rows
    - no soft-delete aliasing
  - added list metadata projection from canonical records:
    - `messageCount`
    - `lastMessagePreview`
    - timestamps and archive state
  - updated web `/app` with GPT-style chat list UI and actions:
    - open thread in composer
    - rename
    - archive
    - hard delete with explicit typed confirmation
  - updated contracts/docs:
    - OpenAPI + generated contract client/models
    - ADR `docs/ADR/018-web-chat-list-and-destructive-actions.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C4` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C4 requires user-facing chat management controls, not only transport/send UX.
- GPT-style chat list actions are now mapped to canonical backend records introduced in C1.
- Delete behavior is kept explicit and honest: destructive delete must not be masked as archive.

### Files touched

- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts
- apps/api/src/modules/workspace-management/application/web-chat.types.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- docs/ADR/018-web-chat-list-and-destructive-actions.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C4 list metadata preview is basic text projection (no rich excerpt formatting yet).
- Hard delete is irreversible by design and removes persisted history records.
- Telegram chat management remains out of scope.

### Next recommended step

- Proceed to Step 5 `C5` (active web chats cap) while preserving explicit archive/delete semantics from C4.

### Ready commit message

- `feat(web-api): add step 5 c4 web chat list with rename archive and hard delete`

## 2026-03-23 - Step 5 C3 streaming web chat slice

### What changed

- Completed Step 5 slice `C3` only (streaming-first web chat transport and UI path):
  - added backend streaming endpoint:
    - `POST /api/v1/assistant/chat/web/stream`
  - added streaming application service orchestration:
    - pre-stream lifecycle/apply gate enforcement
    - canonical user message persistence before stream starts
    - runtime stream delta handling
    - explicit completion/interruption/failure outcomes
  - added OpenClaw adapter streaming boundary method:
    - calls `POST /api/v1/runtime/chat/web/stream`
    - parses NDJSON runtime stream chunks (`delta|done`)
  - extended OpenClaw compatibility patch with streaming runtime endpoint:
    - `POST /api/v1/runtime/chat/web/stream`
  - kept C2 request/response transport endpoint in place for compatibility, but switched web UX to streaming-first path
  - updated web `/app` chat behavior:
    - primary send path is streaming (`Send message (stream)`)
    - live delta rendering
    - user-triggered interruption (`Stop streaming`)
    - honest partial-output state visibility
  - preserved canonical record truth during streaming:
    - on completion: assistant full message persisted
    - on interrupted/failed with partial text: partial assistant message persisted + system marker persisted
  - updated docs:
    - `docs/ADR/017-web-chat-streaming-first-transport.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C3` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C3 requirement is streaming-first web chat as the primary happy path.
- Streaming needed to preserve transparency for interruption/failure and avoid pretending full completion when runtime output is partial.
- Existing C1/C2 record-vs-runtime boundary is preserved by persisting records in backend while keeping runtime session truth in OpenClaw.

### Files touched

- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- docs/ADR/017-web-chat-streaming-first-transport.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- Streaming protocol is currently SSE from API and NDJSON from adapter/runtime; advanced resume/replay semantics are not implemented.
- Runtime streaming behavior in dev depends on OpenClaw compatibility patch path.
- C4 chat list/actions and persistence-backed chat history UX are not implemented yet.

### Next recommended step

- Proceed to Step 5 `C4` (chat list and chat actions) while keeping streaming-first path and record-vs-runtime split intact.

### Ready commit message

- `feat(web-api): add step 5 c3 streaming-first web chat transport and ui path`

## 2026-03-23 - Step 5 C2 web chat backend transport slice

### What changed

- Completed Step 5 slice `C2` only (web chat backend transport baseline):
  - added backend transport endpoint in `apps/api`:
    - `POST /api/v1/assistant/chat/web`
  - added application service for web chat turn transport:
    - parses/validates transport request payload
    - enforces assistant lifecycle/apply gate
    - resolves/creates canonical C1 chat record by `(assistantId, surface=web, surfaceThreadKey)`
    - appends user message record before runtime call
    - appends assistant message record after runtime call
  - extended OpenClaw runtime adapter boundary with web chat turn operation:
    - `POST /api/v1/runtime/chat/web`
  - updated auth middleware route protection for new endpoint
  - added OpenAPI contract for new endpoint and generated client updates in `packages/contracts`
  - extended OpenClaw source compatibility patch to include auth-protected `POST /api/v1/runtime/chat/web` endpoint for dev image workflow patching
  - updated docs:
    - `docs/ADR/016-web-chat-backend-transport-boundary.md`
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/ROADMAP.md` (`C2` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- C2 introduces minimal backend transport for web chat while preserving boundaries established in C1 and A8.
- Backend record/history truth remains canonical and runtime session/context truth remains in OpenClaw.
- Lifecycle/apply gate prevents transport from bypassing assistant publish/apply model.

### Files touched

- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/application/web-chat.types.ts
- apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- apps/api/src/modules/identity-access/identity-access.module.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/\*
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- docs/ADR/016-web-chat-backend-transport-boundary.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm --filter @persai/web run build` - passed

### Known risks

- C2 transport is synchronous request/response only (no streaming/backpressure semantics).
- OpenClaw web chat endpoint in this phase is compatibility-level and requires patched image path in dev workflow.
- Telegram and broader multi-surface transport handling remain intentionally out of scope.

### Next recommended step

- Proceed to Step 5 `C3` (streaming web chat transport) while preserving C1/C2 record-vs-runtime boundary.

### Ready commit message

- `feat(api): add step 5 c2 web chat backend transport through openclaw adapter`

## 2026-03-23 - Step 5 C1 chat domain model slice

### What changed

- Completed Step 5 slice `C1` only (backend chat record domain baseline):
  - added chat record persistence model in `apps/api` Prisma:
    - `assistant_chats`
    - `assistant_chat_messages`
  - added chat surface-awareness at identity level:
    - `assistant_chats` unique thread key `(assistant_id, surface, surface_thread_key)`
    - C1 surface baseline is `web`
  - added ownership/scope constraints for chat records:
    - assistant ownership tie via `(assistant_id, user_id) -> assistants(id, user_id)`
    - workspace scope tie via `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - added backend domain/repository wiring in `workspace-management`:
    - chat entity + message entity
    - chat repository contract
    - Prisma repository implementation
    - Nest provider registration
  - added ADR for C1 boundary decision:
    - `docs/ADR/015-chat-record-model-and-runtime-session-boundary.md`
  - updated docs:
    - `docs/ARCHITECTURE.md`
    - `docs/API-BOUNDARY.md`
    - `docs/DATA-MODEL.md`
    - `docs/ROADMAP.md` (`C1` marked complete)
    - `docs/CHANGELOG.md`
    - `docs/SESSION-HANDOFF.md`

### Why changed

- Step 5 requires canonical backend chat/history records before transport and streaming slices.
- Product boundary requires preserving split ownership:
  - backend owns user-facing record/history truth
  - OpenClaw owns runtime session/context truth
- Surface-aware threading must be explicit now so future web and non-web surfaces do not collapse into one global thread model.

### Files touched

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260323190000_step5_c1_chat_domain_model/migration.sql
- apps/api/src/modules/workspace-management/domain/assistant-chat.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-chat-message.entity.ts
- apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- docs/ADR/015-chat-record-model-and-runtime-session-boundary.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm --filter @persai/api run typecheck` - passed
- `corepack pnpm run typecheck` - failed in existing `packages/contracts` (`src/mutator/custom-fetch.ts`: missing `process` type), unrelated to C1 chat-domain changes

### Known risks

- C1 introduces storage/repository baseline only; chat transport/API behavior is intentionally deferred.
- Message append ordering in C1 is timestamp-based (`created_at`) and does not yet include explicit streaming/event sequencing semantics.
- `surface` enum is intentionally `web`-only in C1; adding other surfaces requires explicit next-slice model extension.

### Next recommended step

- Proceed to Step 5 `C2` (web chat backend transport) using the C1 record model as persistence boundary.

### Ready commit message

- `feat(api): add step 5 c1 chat record domain model with surface-aware threading`

## 2026-03-23 - Step 4 closure stabilization slice

### What changed

- Closed Step 4 validation loop with a narrow web/docs stabilization slice:
  - hardened browser/runtime API base URL resolution in `packages/contracts/src/mutator/custom-fetch.ts`
  - normalized first-time assistant state handling in `apps/web/app/app/assistant-api-client.ts` (`GET /assistant` `404` -> `null`)
  - accepted `200|201` for onboarding/assistant create-publish-rollback-reset flows in web API clients
  - applied minimal visual baseline in `apps/web/app/globals.css` (cards, spacing, form/button states, typography)
  - aligned hybrid live-test config to same-origin API pathing in `apps/web/.env.local` (`/api/v1` + rewrite target)
- Updated docs for Step 4 closure and stabilization:
  - `docs/CHANGELOG.md`
  - `docs/ROADMAP.md`
  - `docs/SESSION-HANDOFF.md`
- Added agent-facing hybrid live-test runbook:
  - created `docs/LIVE-TEST-HYBRID.md` for `local web + GKE api` validation flow
  - linked this runbook from:
    - `AGENTS.md`
    - `README.md`

### Why changed

- Live validation across two accounts surfaced stability gaps after onboarding/assistant bootstrap:
  - false-fatal `404` handling for assistant-not-created state
  - browser-side fetch fallback that could bypass same-origin proxy and fail in hybrid mode
- A minimal style baseline was required to make Step 4 control surface usable without waiting for full design/polish phases.
- Goal: close Step 4 as functionally complete and operationally verifiable without backend/API scope expansion.

### Files touched

- packages/contracts/src/mutator/custom-fetch.ts
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/me-api-client.ts
- apps/web/app/globals.css
- docs/LIVE-TEST-HYBRID.md
- AGENTS.md
- README.md
- docs/CHANGELOG.md
- docs/ROADMAP.md
- docs/SESSION-HANDOFF.md

### Tests run / result

- `corepack pnpm --filter @persai/web run test -- app-flow.client.test.tsx` - passed
- Manual live checks in hybrid mode (`local web + GKE api port-forward`) - passed for onboarding/assistant create/publish/apply paths

### Known risks

- Hybrid mode remains dependent on a stable local `kubectl port-forward` session for `svc/api` on `localhost:3001`.
- Full visual polish/design-system scope is intentionally deferred; current styling is baseline-only.

### Next recommended step

- Start Step 5 `Web Chat Core` (`C1`) while preserving Step 4 closure behavior.
- Optionally define a dedicated `Step 4.5 UI polish` milestone if design polish should be tracked independently before Step 5 expansion.

### Ready commit message

- `docs: close step 4 with hybrid stability fixes and minimal web styling baseline`

## What changed

- Completed Step 4 slice `B6` only (assistant activity/update markers in `apps/web`):
  - added lightweight `Assistant activity and updates` block to the user control surface
  - added non-intrusive ordinary markers for meaningful user-facing lifecycle updates
  - added recovery-worthy markers for apply failure/degraded outcomes and recent rollback/reset actions
  - added quiet no-update branch (`No visible assistant updates right now.`) to avoid notification noise
  - kept markers read-only and aligned with control-plane truth (no draft/version mutation side effects)
  - kept admin/debug runtime internals hidden from marker UI
  - updated web tests for:
    - ordinary marker visibility
    - recovery-worthy marker visibility
    - no-meaningful-update branch
- Completed Step 4 slice `B5` only (rollback/reset UX in `apps/web`):
  - added `Lifecycle safety controls` block with user-facing rollback and reset actions
  - rollback UX:
    - target-version input
    - explicit rollback action wired to `POST /assistant/rollback`
    - human-readable feedback after request
  - reset UX:
    - explicit semantics copy (reset assistant content; not account deletion)
    - required confirmation checkbox
    - required `RESET` typed confirmation
    - reset action wired to `POST /assistant/reset`
  - preserved lifecycle semantics from backend model:
    - rollback creates a new latest published snapshot from selected version
    - reset creates a new blank assistant content baseline while preserving ownership/workspace scope
  - preserved B1-B4 dashboard/editor/publish-apply state behavior
  - updated web tests for rollback flow and reset confirmation/execution flow
- Completed Step 4 slice `B4` only (publish/apply UX state model in `apps/web`):
  - added explicit publish/apply state labels in global status area
  - publish-state labels surfaced:
    - `Draft has changes`
    - `Publishing`
    - `Published`
    - `Draft only`
  - apply-state labels surfaced:
    - `Applying`
    - `Live`
    - `Failed`
    - `Not requested`
  - added rollback-availability visibility (`yes|no`) based on published version history
  - added `Publish draft` UI action wired to `POST /assistant/publish`
  - kept publish/apply separated in UX copy and backend mapping (no fake merged state)
  - kept runtime diagnostics/details hidden; only coarse user-safe status and message are displayed
  - updated web tests for publish/apply state mapping and publish action transition behavior
- Completed Step 4 slice `B3` only (dual-path setup flow in `apps/web`):
  - added `Assistant setup paths` block with two explicit branches:
    - quick start path
    - advanced setup path
  - quick start path applies a guided baseline into draft fields
  - advanced setup path applies manual display name + instructions into draft fields
  - both paths now write through control-plane draft API only:
    - `PATCH /assistant/draft`
  - when assistant is absent, setup path auto-creates assistant first via:
    - `POST /assistant`
      then applies draft update
  - setup flow explicitly does not publish and does not change runtime apply state directly
  - preserved B1/B2 behavior: onboarding gate, global publish/status bar, sectioned editor shell
  - updated web tests for quick-start and advanced-setup draft flow
- Completed Step 4 slice `B2` only (assistant editor sections in `apps/web`):
  - added sectioned assistant editor shell (not a wizard) under `/app` completed-onboarding branch
  - introduced visible editor sections:
    - Persona
    - Memory
    - Tools & Integrations
    - Channels
    - Limits & Safety Summary
    - Publish History
  - surfaced a global publish/status bar above editor sections with lifecycle truth:
    - draft truth (`draft.updatedAt`)
    - draft publish state (unpublished changes vs matches latest published snapshot)
    - published truth (`latestPublishedVersion`)
    - apply truth (`runtimeApply.status` + optional error)
  - kept B1 create-assistant flow for assistant-absent state
  - kept onboarding gate and protected route behavior unchanged
  - updated web tests for section visibility and assistant-absent behavior
- Completed Step 4 slice `B1` only (assistant dashboard shell in `apps/web`):
  - replaced completed-onboarding `/app` "Me" view with a minimal assistant-first dashboard shell
  - added primary status/control block that surfaces control-plane truth:
    - draft truth (`draft.updatedAt`)
    - published truth (`latestPublishedVersion`)
    - apply truth (`runtimeApply.status` + optional apply error message)
  - added basic assistant summary block with assistant identity, draft summary, and apply version pointers
  - preserved existing protected route + onboarding gate behavior
  - added web assistant API client wiring:
    - `GET /assistant` returns `null` on `404` for assistant-not-created state
    - `POST /assistant` creates assistant from the dashboard when absent
  - updated web tests for dashboard completed branch and assistant-absent branch
- Closed the remaining A8 apply-route compatibility gap:
  - added workflow-driven OpenClaw source patching in `.github/workflows/openclaw-dev-image-publish.yml`
  - added patch file `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`
  - patch injects auth-protected endpoint `POST /api/v1/runtime/spec/apply` into OpenClaw gateway HTTP server
  - endpoint validates minimal payload shape and returns JSON ack instead of `404`
- Added deterministic OpenClaw rollout wiring for patched images:
  - introduced `openclaw.image.digest` in Helm values and deployment template (digest-aware image ref)
  - OpenClaw workflow now reads docker build digest output and updates both:
    - `openclaw.image.tag`
    - `openclaw.image.digest`
      in `infra/helm/values-dev.yaml`
  - this ensures Argo applies a real OpenClaw rollout after each patched image build, even when approved SHA tag string is unchanged
- Added OpenClaw pre-session guidance baseline for agent startup discipline:
  - created `docs/OPENCLAW-PRESESSION.md` with mandatory OpenClaw docs pack, role-based optional links, and a 60-second pre-session checklist
  - updated `AGENTS.md` mandatory startup reading order to include `docs/OPENCLAW-PRESESSION.md`
  - recorded this baseline in `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md`
- Applied a narrow A8 runtime stabilization slice before Step 4:
  - added missing API runtime adapter wiring in Helm values (`OPENCLAW_ADAPTER_ENABLED`, `OPENCLAW_BASE_URL`, `OPENCLAW_GATEWAY_TOKEN`)
  - enabled adapter in dev values with in-cluster OpenClaw URL (`http://openclaw:18789`)
  - hardened `AssistantRuntimePreflightService` to return degraded preflight state (`live=false`, `ready=false`) on adapter-level failures instead of surfacing unhandled `500`
- Fixed the `api-migrate` Argo PreSync hook lifecycle deadlock:
  - changed `cloud-sql-proxy` from a regular Job sidecar container to a sidecar-style `initContainer` with `restartPolicy: Always`
  - added explicit proxy readiness wait in `api-migrate` before Prisma commands run
  - result: migration hook can now complete and reach `Succeeded` instead of hanging in `Running` after SQL steps finish
- Applied deploy reliability hardening for automatic DB migration + verification on each sync:
  - added new Helm template `infra/helm/templates/api-migrate-job.yaml`
  - `api-migrate` runs as Argo `PreSync` hook using API image + same env/secret + Cloud SQL proxy in sidecar-style init lifecycle
  - hook command is strict:
    - `corepack pnpm run prisma:migrate:deploy`
    - `corepack pnpm run prisma:migrate:status`
  - sync fails if migration/apply/status fails (prevents app/schema drift)
- Enabled dev Argo application automated sync:
  - `prune: true`
  - `selfHeal: true`
  - `CreateNamespace=true`
- Added migration automation guidance in:
  - `README.md`
  - `infra/dev/gitops/README.md`
  - `infra/dev/gke/RUNBOOK.md`
- Applied a narrow OpenClaw deploy automation slice:
  - extended `.github/workflows/openclaw-dev-image-publish.yml` to auto-update `infra/helm/values-dev.yaml` `openclaw.image.tag` to `OPENCLAW_APPROVED_SHA` after successful image publish on `main`
  - added `paths-ignore` for `infra/helm/values-dev.yaml` to prevent self-trigger loops from workflow-generated commits
- This removes the manual OpenClaw GitOps tag promotion step after push.
- Applied a narrow post-A8 deploy-automation hotfix to keep dev auto-deploy stable after `main` pushes.
- Fixed dev image pinning workflow behavior in `.github/workflows/dev-image-publish.yml`:
  - now updates only `global.images.tag` in `infra/helm/values-dev.yaml`
  - no longer rewrites every YAML `tag` field
- Restored dev values tag strategy in `infra/helm/values-dev.yaml`:
  - `api.image.tag=""` and `web.image.tag=""` (inherit `global.images.tag`)
  - `openclaw.image.tag` pinned back to approved OpenClaw SHA `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`
- This removes the recurring failure mode where OpenClaw was forced to non-existent app commit tags.
- Completed Step 3 slice `A8` only (OpenClaw thin adapter for preflight + apply/reapply).
- Added dedicated runtime adapter boundary:
  - application-level adapter interface + coarse DTO/error model
  - infrastructure-level OpenClaw HTTP implementation only
- Added first adapter interactions:
  - runtime preflight via `GET /healthz` + `GET /readyz`
  - apply/reapply via `POST /api/v1/runtime/spec/apply`
  - apply payload source is A7 materialized spec only (`openclawBootstrap`, `openclawWorkspace`, `contentHash`)
- Added apply execution flow service and wired lifecycle actions:
  - publish/rollback/reset now attempt runtime apply after materialization
  - apply-state transitions are explicit: `pending -> in_progress -> succeeded|failed|degraded`
  - coarse adapter error categories are persisted into `runtimeApply.error`
- Added two control-plane endpoints:
  - `POST /api/v1/assistant/reapply`
  - `GET /api/v1/assistant/runtime/preflight`
- Added OpenClaw adapter env/config baseline in `packages/config` + API env examples.
- Preserved architectural boundaries:
  - domain/application layers stay OpenClaw-agnostic
  - no chat relay, no Telegram/channels work
  - no behavior-level OpenClaw integration
- Updated docs:
  - `docs/ADR/014-openclaw-apply-reapply-adapter.md`
  - `docs/ARCHITECTURE.md`
  - `docs/API-BOUNDARY.md`
  - `docs/DATA-MODEL.md`
  - `docs/ROADMAP.md` (`A8` marked complete)
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- Platform-managed updates should be visible enough to feel trustworthy, but not noisy enough to feel intrusive.
- B6 introduces lightweight markers that separate ordinary updates from recovery-worthy events while preserving the soft auto-update model.
- This keeps user-facing transparency high without leaking admin/support diagnostics or turning the UI into an alert feed.
- Step 4 requires safe lifecycle recovery controls in user-facing UI before deeper activity/history work.
- B5 provides rollback/reset controls that match backend semantics and force explicit reset confirmation to prevent accidental destructive assistant-content resets.
- The UI now communicates rollback vs reset consequences without introducing account-deletion behavior or hiding meaningful impact.
- Step 4 requires a user-friendly but honest lifecycle model where users can understand publish and apply as separate truths.
- B4 makes publish/apply progress and failure outcomes visible without exposing raw runtime internals.
- This keeps lifecycle transparency aligned with control-plane state and prepares rollback/reset UX work in B5.
- Step 4 requires setup UX that supports both fast-start users and advanced users while preserving explicit lifecycle truth.
- B3 introduces two setup paths that always land in draft state, preventing hidden live-state mutation and avoiding accidental publish side effects.
- This keeps control-plane consistency with B1/B2 and prepares B4 publish/apply UX without widening into full persona/memory feature depth.
- Step 4 requires a sectioned control surface so assistant management does not collapse into one oversized settings page.
- B2 establishes editor information architecture and keeps lifecycle status globally visible while preserving draft/publish/apply control-plane truth.
- This creates a stable foundation for B3-B6 without introducing chat-first drift or raw runtime file exposure.
- Step 4 product order requires assistant control surface visibility before chat expansion.
- Prior `/app` completed branch showed account/workspace baseline only, so assistant lifecycle/apply truth was not visible to users.
- B1 introduces a minimal assistant-managed shell that keeps control-plane lifecycle truth explicit without expanding into full editor/chat/tasks/memory scope.
- Live A8 check after runtime wiring fix showed one final blocker before Step 4:
  - preflight was healthy, but `publish/reapply` still failed because OpenClaw returned `404` on `/api/v1/runtime/spec/apply`
- This slice restores the exact A8 route contract while keeping domain/application boundaries and avoiding behavior-level runtime expansion.
- Post-fix live check showed patched OpenClaw route was still absent because deployment did not roll:
  - OpenClaw image tag remained text-identical (`approved SHA`) and `IfNotPresent` prevented guaranteed refresh
  - deployment spec therefore stayed effectively unchanged and existing pod/image digest remained old
- Digest pinning closes this rollout gap without changing the approved-SHA governance model.
- Team requested a single source for OpenClaw pre-session reading so every new agent session starts with consistent runtime/ops assumptions.
- This reduces session drift when working on Step 4+ slices that depend on stable control-plane/runtime boundary understanding.
- Live A1-A8 validation showed A8 runtime drift in dev:
  - adapter env/secret wiring was absent in API runtime values, so apply path failed as configuration-disabled
  - preflight endpoint surfaced adapter exceptions as `500`, making operator/UX checks noisy
- This slice keeps A8 boundary/scope unchanged while making runtime status reporting stable and explicit.
- User-required turnkey deploy path was still blocked by one recurring issue: successful migration SQL with non-terminating hook lifecycle.
- The previous Job-sidecar pattern left `api-migrate` in `Running/Terminating`, which blocked Argo sync completion and required manual cleanup.
- The fix keeps the same migration guarantees but removes the hook completion deadlock.
- User requirement: deploy must be turnkey and stable without manual DB migration steps.
- Previous flow allowed successful rollout while migrations could be skipped/failing, creating future break risk.
- New PreSync migration hook guarantees schema update + verification before API rollout is considered successful.
- User requirement: no manual OpenClaw deploy/tag step after push.
- OpenClaw image build was automated, but tag promotion in GitOps values was still manual.
- The new workflow step closes this gap while preserving separation:
  - app workflow controls `global.images.tag`
  - OpenClaw workflow controls `openclaw.image.tag`
- The previous broad `sed` replacement rewrote all `tag:` lines in dev values, including OpenClaw pinning.
- That caused `openclaw` rollout failures (`ImagePullBackOff`) when app commit SHA tags did not exist for OpenClaw image.
- The hotfix makes image pinning deterministic and aligned with intended ownership:
  - app deploys follow `${GITHUB_SHA}` via `global.images.tag`
  - OpenClaw remains pinned to approved source SHA
- A8 activates the first real runtime bridge while preserving control-plane boundaries from O6/A7.
- Materialized spec is now not only stored but also consumed by a thin adapter for runtime apply/reapply.
- Coarse failure outcomes are explicitly surfaced in apply state for later UX/admin use.

## Decisions made

- OpenClaw integration remains adapter-only (infrastructure layer); no OpenClaw transport types in domain/application.
- HTTP remains the first transport; WebSocket remains out of scope.
- A8 adapter interactions are intentionally narrow:
  - preflight probes (`/healthz`, `/readyz`)
  - apply/reapply of materialized spec (`/api/v1/runtime/spec/apply`)
- Coarse boundary error model is stable and explicit:
  - `runtime_unreachable`
  - `auth_failure`
  - `timeout`
  - `invalid_response`
  - `runtime_degraded`
- Reapply is explicit and does not create a new published version.

## Files touched

- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/web/app/app/assistant-api-client.ts
- apps/web/app/app/app-flow.client.tsx
- apps/web/app/app/app-flow.client.test.tsx
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- .github/workflows/openclaw-dev-image-publish.yml
- infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch
- infra/helm/templates/openclaw-deployment.yaml
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- AGENTS.md
- docs/OPENCLAW-PRESESSION.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md
- apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts
- infra/helm/values.yaml
- infra/helm/values-dev.yaml
- infra/helm/templates/api-migrate-job.yaml
- infra/dev/gitops/argocd/application-dev.yaml
- .github/workflows/openclaw-dev-image-publish.yml
- README.md
- infra/dev/gitops/README.md
- infra/dev/gke/RUNBOOK.md
- .github/workflows/dev-image-publish.yml
- infra/helm/values-dev.yaml
- apps/api/.env.dev.example
- apps/api/.env.local.example
- apps/api/src/modules/identity-access/identity-access.module.ts
- apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts
- apps/api/src/modules/workspace-management/application/assistant-runtime-preflight.service.ts
- apps/api/src/modules/workspace-management/application/apply-assistant-published-version.service.ts
- apps/api/src/modules/workspace-management/application/publish-assistant-draft.service.ts
- apps/api/src/modules/workspace-management/application/reapply-assistant.service.ts
- apps/api/src/modules/workspace-management/application/rollback-assistant.service.ts
- apps/api/src/modules/workspace-management/application/reset-assistant.service.ts
- apps/api/src/modules/workspace-management/domain/assistant.repository.ts
- apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts
- apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts
- apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts
- apps/api/src/modules/workspace-management/workspace-management.module.ts
- packages/config/src/api-config.ts
- packages/contracts/openapi.yaml
- packages/contracts/src/generated/step2-client.ts
- packages/contracts/src/generated/model/\*
- docs/ADR/014-openclaw-apply-reapply-adapter.md
- docs/ARCHITECTURE.md
- docs/API-BOUNDARY.md
- docs/DATA-MODEL.md
- docs/ROADMAP.md
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- No new Prisma migration in A8.

## Tests run / result

- `corepack pnpm run prisma:generate` - passed
- `corepack pnpm run contracts:generate` - passed
- `corepack pnpm --filter @persai/api run lint` - passed
- `corepack pnpm run typecheck` - passed
- `corepack pnpm run test:step2` - passed
- `corepack pnpm run build` - passed

## Known risks

- Migration hook depends on Cloud SQL access rights for API runtime GSA (`roles/cloudsql.client`).
- If Cloud SQL IAM/scopes are broken, sync will now fail fast (desired behavior) until infra permissions are fixed.
- Argo application status can remain stale (`operationState`) after forced hook cleanup; if observed, clear the stale operation once and then rely on the fixed hook template for future sync cycles.
- Runtime apply endpoint contract in OpenClaw is assumed at `/api/v1/runtime/spec/apply`; any drift must be handled via adapter contract update.
- Current OpenClaw compatibility endpoint acknowledges apply payloads and validates shape/auth, but does not yet execute behavior-level assistant runtime mutation.
- Existing historical published versions without materialized spec will fail apply/reapply with `invalid_response` until backfilled/materialized.
- Adapter is synchronous request/response only; no async apply job tracking yet.

## Next recommended step

- Commit/push this hook lifecycle fix, then run one `main` push verification cycle:
  - confirm `api-migrate` reaches `Succeeded` (not `Running/Terminating`)
  - confirm workflow updates only `global.images.tag`
  - confirm OpenClaw workflow updates `openclaw.image.tag` to approved SHA
  - confirm Argo auto-sync completes without manual terminate/delete operations.

## H3: Runtime hydration depth — completed (2026-03-26)

### Status

- **H3a** — Persona, workspace, bootstrap: done (DB fields, materialization, OpenClaw workspace writer, env vars, Helm GCS FUSE, setup/settings UI, contracts).
- **H3b** — Memory management: done (OpenClaw HTTP memory API, PersAI proxy + adapter, Memory Center tabs).
- **H3c** — Chat history: done (paginated messages endpoint, `useChat.loadHistory` + thread navigation).

### Key files — PersAI

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — seven bootstrap Markdown docs → `openclawWorkspace.bootstrapDocuments`
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts` — proxy to `/api/v1/runtime/memory/*`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — `assistant/memory/workspace/*`, `assistant/chats/web/:chatId/messages`
- `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts` — cursor pagination for messages
- `apps/web/app/app/_components/use-chat.ts` — `loadHistory`
- `apps/web/app/app/chat/page.tsx` — calls `loadHistory` when opening existing thread
- `apps/web/app/app/assistant-api-client.ts` — client for workspace memory + messages
- `infra/helm/templates/openclaw-serviceaccount.yaml` — WI / SA template (with chart CSI mount as deployed)
- `packages/contracts` — `AssistantDraftState`, `AssistantDraftUpdateRequest`, `AssistantPublishedVersionSnapshotState`, `OnboardingRequest`, `AppUserSummary` (traits/avatar/birthday/gender)

### Key files — OpenClaw (fork)

- `src/gateway/persai-runtime/persai-runtime-workspace.ts` — per-assistant dirs, bootstrap write-once
- `src/gateway/persai-runtime/persai-runtime-memory.ts` — `/api/v1/runtime/memory/{items,add,edit,forget,search}`

### Ops / runtime env

- `PERSAI_WORKSPACE_ROOT`, `PERSAI_AGENT_WORKSPACE_DIR`

## Live-test fixes session (2026-03-26)

### What was done

Full interactive LIVE test of 8 areas after H2-cleanup + H3 deploy. Found and fixed:

1. **Plan model override not applied by OpenClaw**: `runtimeProviderProfile.primary.model` was always set to the global admin model; per-plan `primaryModelKey` was only in `runtimeProviderRouting` (which OpenClaw doesn't read). Fix: `materialize-assistant-published-version.service.ts` now overrides `runtimeProviderProfile.primary.model` with plan model key when present.
2. **Routing priority wrong**: `managedPrimary?.model` took precedence over `planModelKey`. Fix: swapped order in `resolve-runtime-provider-routing.service.ts`.
3. **Chat history stale on thread switch**: `useChat` hook didn't reset state when `threadKey` changed. Fix: added `prevThreadKeyRef` comparison and state reset in `use-chat.ts`.
4. **Admin Plans UI polish**: quota/model fields were dim (`text-text-subtle`); AI Model was free text. Fix: accent-bordered card sections, `<select>` for model from runtime `availableModelsByProvider`, vertical channels layout with full names and hint text.
5. **403 on runtime save**: user had `business_admin` role (legacy owner fallback) but `admin.runtime_provider_settings.update` requires `ops_admin`/`super_admin`. Fix: inserted `super_admin` role in `app_user_admin_roles` table for dev user.
6. **H3.1 tech debt**: logged in ROADMAP — lazy `settingsGeneration` invalidation to replace full re-materialization at scale (critical for ≥1000 workspaces).

### Commits

- `543c2d9` → `9b1b15a` (rebased) — refactor + live-test fixes on `main`

### Key files changed

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — plan model override in runtimeProviderProfile
- `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts` — planModelKey priority fix
- `apps/web/app/app/_components/use-chat.ts` — thread switch state reset
- `apps/web/app/admin/plans/page.tsx` — model select, channels vertical, styled sections, runtime models fetch
- `docs/ROADMAP.md` — H3.1 tech debt entry

---

## H3.3 — Assistant lifecycle rework (CREATE/EDIT/RESET)

### What changed

1. **EDIT simplification**: replaced "Save draft" + "Publish" two-step with single "Save and apply" button. Backend draft/publish versioning preserved internally for audit/rollback. Removed unused `publishing`/`pubFb` state and `Upload`/`Save` imports.

2. **RESET full wipe**: `reset-assistant.service.ts` rewritten with Prisma transaction that hard-deletes chat messages, chats, memory registry items, materialized specs, and published versions. Apply state reset to `not_requested`. Draft fields nulled. OpenClaw workspace cleanup via new `POST /api/v1/runtime/workspace/cleanup` endpoint (deletes workspace directory + removes spec store entries). Frontend redirects to `/app/setup` after reset. Setup wizard pre-fills user data (name, birthday, gender, timezone) from `/me` endpoint. `postAssistantCreate` 409 caught silently (assistant record already exists post-reset).

3. **Admin-editable bootstrap presets**: new `bootstrap_document_presets` table (id VARCHAR(32) PK, template TEXT). Prisma migration + seed for 4 presets (soul, user, identity, agents). Admin API: `GET /api/v1/admin/bootstrap-presets` and `PATCH /api/v1/admin/bootstrap-presets/:id`. Materialization service loads templates from DB with hardcoded fallback. Templates use `{{placeholder}}` interpolation — lines with empty/null placeholders are automatically removed. Admin UI: `/admin/presets` page with per-preset Markdown editor, variable chips (click to copy + insert at cursor), and live preview with sample data.

4. **OpenClaw changes**: `cleanupPersaiAssistantWorkspace()` function in `persai-runtime-workspace.ts`. `remove(assistantId)` method on `PersaiRuntimeSpecStore` interface (InMemory and Redis). `handleRuntimeWorkspaceCleanupHttpRequest` handler + route registration. `cleanupWorkspace(assistantId)` on `AssistantRuntimeAdapter` interface + `OpenClawRuntimeAdapter` implementation.

5. **App shell**: detects post-reset state (assistant exists, no published version, `applyStatus=not_requested`) and redirects to `/app/setup`.

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `BootstrapDocumentPreset` model
- `apps/api/prisma/migrations/20260401100000_h3_bootstrap_document_presets/migration.sql`
- `apps/api/prisma/bootstrap-preset-data.ts` — default template definitions
- `apps/api/prisma/seed.ts` — preset upsert
- `apps/api/src/modules/workspace-management/domain/bootstrap-document-preset.repository.ts`
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-bootstrap-document-preset.repository.ts`
- `apps/api/src/modules/workspace-management/application/manage-bootstrap-presets.service.ts`
- `apps/api/src/modules/workspace-management/interface/http/admin-bootstrap-presets.controller.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — template interpolation, preset loading
- `apps/api/src/modules/workspace-management/application/reset-assistant.service.ts` — full wipe rewrite
- `apps/api/src/modules/workspace-management/application/assistant-runtime-adapter.types.ts` — `cleanupWorkspace` method
- `apps/api/src/modules/workspace-management/infrastructure/openclaw/openclaw-runtime.adapter.ts` — cleanup implementation
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — reset return type
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` — new registrations

**PersAI frontend:**

- `apps/web/app/app/_components/assistant-settings.tsx` — "Save and apply" button, reset redirect
- `apps/web/app/app/_components/app-shell.tsx` — post-reset setup redirect
- `apps/web/app/app/setup/page.tsx` — user data pre-fill, 409 handling
- `apps/web/app/admin/presets/page.tsx` — new admin presets UI
- `apps/web/app/admin/layout.tsx` — nav item

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-workspace.ts` — `cleanupPersaiAssistantWorkspace`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts` — `remove()` method
- `src/gateway/persai-runtime/persai-runtime-http.ts` — cleanup endpoint handler
- `src/gateway/server-http.ts` — route registration

### Risks

- Bootstrap preset interpolation depends on exact `{{placeholder}}` syntax — admin typos in template will result in literal `{{...}}` text in generated documents.
- Reset full wipe is irreversible — no soft-delete or recovery path.
- `postAssistantCreate` 409 catch in setup wizard is broad — could mask other errors on that endpoint (acceptable for MVP).

### Next recommended step

- **H4 — Telegram runtime readiness alignment** against admin-driven runtime profile + managed secret refs.
- Live-test the full reset → setup → create → edit cycle on dev.

---

## H8 — Telegram runtime readiness

### What changed

1. **Encrypted bot token storage:** `ConnectTelegramIntegrationService` persists the bot token via `PlatformRuntimeProviderSecretStoreService` (AES-256-GCM) under key `telegram_bot:{assistantId}`. Token deleted on revoke/disconnect.

2. **Telegram channel materialization:** active Telegram binding → `openclawBootstrap.channels.telegram` with `enabled: true`, resolved `botToken`, `webhookUrl` (or null for polling), HMAC `webhookSecret`, `groupReplyMode`, `parseMode`, inbound/outbound policy. Inactive → `enabled: false`.

3. **OpenClaw Telegram bridge** (`persai-runtime-telegram.ts`): dynamically manages Grammy bot instances per assistant. On `spec/apply` with enabled Telegram, starts bot in webhook mode (if `webhookUrl` present) or polling mode (if null). Handles `message:text` → agent turn and `my_chat_member` → group status callback to PersAI.

4. **Polling fallback:** when `TELEGRAM_WEBHOOK_BASE_URL` env is unset, materialized `webhookUrl` is null, and OpenClaw uses `bot.start()` long polling — allows Telegram operation without public domain. Stale webhooks deleted on start.

5. **GKE Ingress** (`openclaw-ingress.yaml`): routes `bot.persai.dev/telegram-webhook/*` to OpenClaw with TLS managed certificate.

6. **Group tracking:** `assistant_telegram_groups` Prisma table stores join/leave events. OpenClaw sends `my_chat_member` to `POST /api/v1/internal/runtime/telegram/group-update`. `GET /api/v1/assistant/integrations/telegram/groups` returns group list.

7. **UI updates:** Groups section in connected Telegram panel. Group reply mode toggle. Disconnect/Reconnect buttons with confirmation dialog. Auto-populated group list from `my_chat_member` callbacks.

8. **Auto-apply on connect/disconnect:** `ConnectTelegramIntegrationService` and `RevokeTelegramIntegrationSecretService` now call `ApplyAssistantPublishedVersionService` after modifying integration, ensuring immediate OpenClaw sync.

9. **Telegram workspace isolation:** OpenClaw Telegram agent turns receive per-assistant `workspaceDir` from stored spec (same as web chat). Bot reads/writes the correct `MEMORY.md` and bootstrap files.

10. **Operational:** `OPENCLAW_ADAPTER_TIMEOUT_MS` increased to 90 000 ms for complex LLM queries. `OPENCLAW_STATE_DIR` set to persistent GCS FUSE volume for session survival across pod restarts.

### Why changed

H8 completes the Telegram delivery surface that was previously control-plane-only (E4 connect/config). Users can now interact with their assistant via Telegram DMs and group chats, with the same persona, memory, and tools as web chat.

### Slice boundary

- PersAI: encrypted token storage, materialization of Telegram channel config, `assistant_telegram_groups` table, group update internal endpoint, groups API, UI disconnect/reconnect/groups, auto-apply on connect/disconnect.
- OpenClaw: Telegram bridge (Grammy bot lifecycle, webhook/polling, event routing), workspace dir in agent turns, reinitialize from store on pod restart.
- No changes to: web chat, publish/rollback/reset, admin plans, provider settings, memory/tasks APIs.

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `AssistantTelegramGroup` model
- `apps/api/prisma/migrations/20260326300000_add_assistant_telegram_groups/migration.sql`
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts` — encrypted token upsert, auto-apply
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts` — token delete, auto-apply
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — `resolveTelegramChannelConfig()`
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` — groups endpoint, disconnect endpoint
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts` — group-update endpoint
- `packages/config/src/api-config.ts` — `TELEGRAM_WEBHOOK_BASE_URL`, `TELEGRAM_WEBHOOK_HMAC_SECRET`

**PersAI frontend:**

- `apps/web/app/app/_components/telegram-connect.tsx` — Disconnect/Reconnect buttons, groups section, group reply mode toggle
- `apps/web/app/app/assistant-api-client.ts` — `fetchAssistantTelegramGroups`, `postAssistantTelegramDisconnect`

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-telegram.ts` — Grammy bot manager, webhook/polling, event handlers
- `src/gateway/persai-runtime/persai-runtime-agent-turn.ts` — `runPersaiTelegramAgentTurn`
- `src/gateway/persai-runtime/persai-runtime-spec-store.ts` — `getAll()` for reinitialize
- `src/gateway/persai-runtime/persai-runtime-http.ts` — `syncTelegramBotForAssistant` on apply with `workspaceDir`
- `src/gateway/server-http.ts` — Telegram webhook route, reinitialize on startup

**Infra:**

- `infra/helm/templates/openclaw-ingress.yaml` — new Ingress for `bot.persai.dev`
- `infra/helm/values-dev.yaml` — `OPENCLAW_ADAPTER_TIMEOUT_MS: "90000"`, `OPENCLAW_STATE_DIR`, `TELEGRAM_WEBHOOK_HMAC_SECRET` secret, `telegramWebhook` section
- `infra/dev/gitops/openclaw-approved-sha.txt` — updated to `d1dcf2ef2`

### Tests run

- `npx tsc --noEmit` — PersAI API (clean), PersAI Web (clean)
- `pnpm --filter @persai/web run test` — passing (flaky `putAdminRuntimeProviderSettings` spy timing in CI, passes on rerun)
- OpenClaw typecheck clean for new files

### Risks

1. Polling mode uses long-lived connections from OpenClaw pod to Telegram — one connection per active bot. At scale, webhook mode is preferred.
2. ~~`TELEGRAM_WEBHOOK_BASE_URL` commented out in dev values~~ — resolved in H10: uncommented, DNS configured, webhook mode active.
3. Auto-apply on connect/disconnect adds latency to those API calls (~500ms). Wrapped in try/catch so failures are non-fatal.
4. Flaky web test (`putAdminRuntimeProviderSettings` spy timing) — pre-existing, unrelated to H8. Passes on CI rerun.

### Next recommended step

- **H9 — thinking/reasoning UX:** stream thinking tokens from OpenClaw, collapsible "Thought for X seconds" block in web chat with fade-out preview.
- ~~Configure `bot.persai.dev` DNS and uncomment `TELEGRAM_WEBHOOK_BASE_URL`~~ — done in H10.
- Monitor Telegram group tracking accuracy (join/leave events).

---

## H3.1 — configGeneration lazy invalidation (scale to 5 000–10 000 users)

### What changed

1. **New `PlatformConfigGeneration` singleton table** with monotonic `generation` counter. Atomically incremented on every admin config change: provider settings, plan create/update, bootstrap preset update. Seeded in migration.

2. **New `configDirtyAt` column on `assistants`** — set to `NOW()` when per-user data changes (onboarding/profile, Telegram connect/revoke, subscription). Cleared to `NULL` after successful materialization.

3. **New `materializedAtConfigGeneration` column on `assistant_materialized_specs`** — records which global generation the spec was built against. `configGeneration` also embedded in `openclawBootstrap.governance.configGeneration`.

4. **Removed `reapplyLatestPublishedVersions()`** from `ManageAdminRuntimeProviderSettingsService` — the O(N) sequential mass-reapply loop that blocked admin requests. Admin settings save now persists data, bumps generation, returns immediately.

5. **Generation bump wired into all admin write services**: `ManageAdminRuntimeProviderSettingsService`, `ManageAdminPlansService`, `ManageBootstrapPresetsService`. `configDirtyAt` wired into: `UpsertOnboardingService`, `ConnectTelegramIntegrationService`, `RevokeTelegramIntegrationSecretService`. Subscription hook ready for billing.

6. **Two new PersAI internal endpoints**: `GET /internal/v1/runtime/config-generation` (returns current generation, cacheable); `POST /internal/v1/runtime/ensure-fresh-spec` (checks global + per-user staleness, re-materializes if needed, returns fresh spec or 204).

7. **OpenClaw two-tier freshness check** in both chat handlers (sync + stream): cached global generation (TTL via `PERSAI_CONFIG_GENERATION_CACHE_TTL_MS`, default 1 hour) for fast-path zero-HTTP comparison; full PersAI freshness check when cache expires or generation mismatch. Reusable `applySpecLocally()` extracted from apply handler. Per-assistant mutex for dedup. Fail-open on PersAI unreachable.

8. **Frontend**: admin runtime settings page — `reapplySummary` display removed, replaced with `configGeneration` feedback. Admin Plans page — new "Force reapply all" emergency button (step-up protected, shows summary). API client updated. OpenAPI spec updated.

### Why changed

The O(N) inline mass-reapply was the only auto-propagation mechanism and it blocked admin requests for minutes at 1 000+ workspaces. Meanwhile, 7 of 8 data sources (plans, presets, profile, bindings, subscription, tool catalog, tool activations) had zero auto-propagation — changes were silently stale until manual reapply. H3.1 replaces both problems with a unified lazy invalidation system that scales to 10 000 users.

### Slice boundary

- PersAI: schema migration, generation bumps in admin services, dirty flags in user services, materialization embedding, new internal endpoints, removed mass-reapply, updated admin API response, frontend update.
- OpenClaw: freshness client, generation cache, local-apply helper, freshness check in chat handlers.
- No changes to: publish, rollback, reset, manual reapply, platform rollouts, Telegram delivery.

### Key files changed

**PersAI backend:**

- `apps/api/prisma/schema.prisma` — `PlatformConfigGeneration`, `Assistant.configDirtyAt`, `AssistantMaterializedSpec.materializedAtConfigGeneration`
- `apps/api/prisma/migrations/...` — migration + seed
- `apps/api/src/modules/workspace-management/application/manage-admin-runtime-provider-settings.service.ts` — removed mass-reapply, added generation bump
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` — added generation bump
- `apps/api/src/modules/workspace-management/application/manage-bootstrap-presets.service.ts` — added generation bump
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` — read generation, write to spec, clear dirty flag
- `apps/api/src/modules/workspace-management/application/ensure-spec-freshness.service.ts` — new service
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-config-generation.controller.ts` — new controller
- `apps/api/src/modules/identity-access/application/upsert-onboarding.service.ts` — set configDirtyAt
- `apps/api/src/modules/workspace-management/application/connect-telegram-integration.service.ts` — set configDirtyAt
- `apps/api/src/modules/workspace-management/application/revoke-telegram-integration-secret.service.ts` — set configDirtyAt

**PersAI frontend:**

- `apps/web/app/admin/runtime/page.tsx` — removed reapplySummary, shows configGeneration feedback
- `apps/web/app/admin/plans/page.tsx` — new "Force reapply all" button with step-up + summary
- `apps/web/app/app/app-flow.client.tsx` — updated feedback to configGeneration
- `apps/web/app/app/assistant-api-client.ts` — updated response validation, added `postAdminForceReapplyAll`

**OpenClaw fork:**

- `src/gateway/persai-runtime/persai-runtime-http.ts` — freshness check in both chat handlers (sync + stream)
- `src/gateway/persai-runtime/persai-runtime-freshness.ts` — new: two-tier freshness client with TTL cache + mutex

### Tests run

- `npx tsc --noEmit` — PersAI API (clean), PersAI Web (clean)
- `npx tsc --noEmit` — OpenClaw (all new files clean; pre-existing test errors in extensions unchanged)
- `npx prisma validate` — schema valid

### Risks

1. Changes propagate with up to TTL delay (default 1 hour). Manual reapply available as instant escape hatch.
2. First chat after stale detection pays ~200-500ms materialization latency.
3. Global `configGeneration` counter — plan change invalidates all assistants, not just those on the changed plan. Acceptable: only chatting assistants pay, plan changes are infrequent.
4. OpenClaw depends on PersAI internal API for freshness checks. Mitigated by fail-open + cache.
5. Migration needs `prisma migrate deploy` on running DB before deployment.

### Next recommended step

- **H4 — Telegram runtime readiness alignment** against admin-driven runtime profile + managed secret refs.
- Monitor lazy invalidation latency in dev; tune TTL if needed.
- When billing is connected (FINAL), subscription webhook sets `configDirtyAt` — no additional code needed.
- Run `npx prisma migrate deploy` when DB is available to apply migration.

---

## H10 — Domain migration, Clerk production instance + proxy, UI auth pages

### What changed

1. **persai.dev domain live on GKE:** unified GCE L7 Ingress deployed with Google-managed TLS certs for `persai.dev`, `api.persai.dev`, `bot.persai.dev`. Global static IP `persai-dev-ip` (`34.8.195.135`). DNS A records configured in Reg.ru. HTTPS verified working (HSTS preload for `.dev` domain enforced by browsers).

2. **Clerk production instance:** migrated from dev instance (`pk_test_`) to production (`pk_live_`) with custom domain `clerk.persai.dev`. Five CNAME DNS records added in Reg.ru (Frontend API, Account Portal, 3× DKIM). Updated `CLERK_SECRET_KEY` in Kubernetes secret `persai-api-secrets` to production key. Old Clerk users from dev instance do not carry over — new registration required.

3. **Clerk proxy for Russian ISP bypass:** Clerk's CDN runs on Cloudflare IPs that are blocked by some Russian ISPs. Solution:
   - `NEXT_PUBLIC_CLERK_PROXY_URL=https://persai.dev/clerk-proxy` routes all Clerk SDK traffic through the web app.
   - New API route handler `app/clerk-proxy/[...path]/route.ts` proxies to `clerk.persai.dev` with correct `Host` header (Next.js rewrites cannot override `Host`).
   - `/clerk-proxy` excluded from Clerk middleware matcher to avoid auth loops.
   - Pending: Clerk Dashboard proxy verification (shows "Invalid host" — awaiting fresh deploy with correct proxy handler to verify).

4. **Build-time env for Docker:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CLERK_PROXY_URL` added as Docker build ARGs in `apps/web/Dockerfile` and CI workflow (`.github/workflows/dev-image-publish.yml`). GitHub repo variables created. Required because Next.js bakes `NEXT_PUBLIC_*` at build time.

5. **GKE web API proxy:** added `PERSAI_WEB_API_PROXY_TARGET: "http://api:3001"` to `web.env` in `values-dev.yaml` — fixes internal `/api/v1/*` routing from web container to API service.

6. **Admin user deletion FK fix:** `AdminDeleteUserService` now reassigns `AssistantPublishedVersion.publishedByUserId` to the calling admin before deleting the target user, preventing FK `Restrict` constraint violations.

7. **UI: dedicated auth pages:** replaced modal `SignInButton` on landing with `Link` to `/sign-in`. New styled pages: `/sign-in`, `/sign-up`, `/sso-callback`, `/app/profile`.

8. **Removed self-hosted Clerk bundles:** deleted `apps/web/public/clerk/` directory and related `NEXT_PUBLIC_CLERK_JS_URL`/`NEXT_PUBLIC_CLERK_UI_URL` env vars — no longer needed with production instance.

### Why changed

- Domain migration from localhost/port-forward to persai.dev was required for production-ready external access.
- Clerk dev instance keys don't work with production custom domains; production instance required.
- Russian ISPs block Cloudflare IP ranges, making `clerk.persai.dev` inaccessible without a first-party proxy.
- `NEXT_PUBLIC_*` env vars are compile-time constants in Next.js — passing them only at runtime has no effect, they must be present during `next build` in Docker.
- Admin user deletion was blocked by FK constraint, preventing admin operations.

### Slice boundary

- PersAI infra: Helm values, Ingress, ManagedCertificates, Dockerfile build args, CI workflow.
- PersAI backend: `admin-delete-user.service.ts` FK fix.
- PersAI frontend: Clerk proxy route handler, middleware matcher, sign-in/sign-up/profile/sso-callback pages, landing page link.
- DNS (Reg.ru): A records for 3 domains, 5 CNAME records for Clerk.
- Kubernetes: updated `persai-api-secrets` secret with production Clerk key.
- No changes to: OpenClaw fork, Prisma schema, TTS, runtime spec, Telegram integration logic.

### Key files changed

**PersAI infra:**

- `infra/helm/values-dev.yaml` — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_PROXY_URL`, `PERSAI_WEB_API_PROXY_TARGET`, ingress section
- `infra/helm/templates/ingress.yaml` — unified GCE Ingress (new)
- `infra/helm/templates/managed-certificates.yaml` — Google-managed TLS certs (new)
- `infra/helm/templates/openclaw-ingress.yaml` — deprecated (replaced by unified ingress)
- `apps/web/Dockerfile` — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CLERK_PROXY_URL` build ARGs
- `.github/workflows/dev-image-publish.yml` — passes `build-args` from GitHub repo variables

**PersAI backend:**

- `apps/api/src/modules/workspace-management/application/admin-delete-user.service.ts` — reassign `publishedByUserId` before delete

**PersAI frontend:**

- `apps/web/app/clerk-proxy/[...path]/route.ts` — Clerk proxy route handler (new)
- `apps/web/middleware.ts` — exclude `/clerk-proxy` from Clerk middleware
- `apps/web/next.config.ts` — removed Clerk rewrite (replaced by API route), kept API proxy rewrite
- `apps/web/app/page.tsx` — landing: `Link` to `/sign-in`
- `apps/web/app/sign-in/[[...sign-in]]/page.tsx` — styled sign-in page (new)
- `apps/web/app/sign-up/[[...sign-up]]/page.tsx` — styled sign-up page (new)
- `apps/web/app/sso-callback/page.tsx` — SSO callback handler (new)
- `apps/web/app/app/profile/page.tsx` — user profile page (new)
- `apps/web/.env.local` — updated to `pk_live_`/`sk_live_` keys

### Tests run

- CI typecheck (`pnpm run typecheck`) — passed after fixing TS2769 in clerk-proxy route (body `undefined` → `null`)
- CI lint + prettier — passed after formatting fixes
- Manual: `https://persai.dev/` loads over HTTPS, sign-in page renders (via VPN from Russia)

### Risks

1. Clerk proxy verification in Dashboard pending — proxy handler deployed but Dashboard may still show "Invalid host" until a request successfully round-trips through the latest deploy.
2. Old Clerk dev users lost — production instance has empty user directory; all users must re-register.
3. Google-managed certs may take up to 24h to transition from `Provisioning` to `Active` for new domains.
4. `pullPolicy: IfNotPresent` in dev values can cause nodes to use cached old images after tag updates — force image pull or use immutable SHA tags.

### Next recommended step

- Verify Clerk proxy works end-to-end from Russia (sign-in without VPN).
- Confirm Clerk Dashboard proxy verification passes.
- Verify Telegram webhook works via `bot.persai.dev`.
- Continue UI improvements (sidebar, chat UX).
- **H4 — Telegram runtime readiness alignment** against admin-driven runtime profile.
