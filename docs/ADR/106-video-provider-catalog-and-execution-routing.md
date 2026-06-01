# ADR-106: Video provider catalog and execution routing

## Status

Accepted (2026-06-01)

## Context

PersAI already has a working OpenAI media path:

- `image_generate` -> OpenAI
- `image_edit` -> OpenAI
- `video_generate` -> OpenAI/Sora

OpenAI image generation/editing is considered stable and must not be disturbed by this program.

The product need is narrower: add lower-cost / production-relevant video alternatives so admins can configure `video_generate` plans with Runway and Kling instead of forcing expensive Sora-only usage. The admin flow must remain coherent:

1. `Admin > Tools` stores provider API keys.
2. `Admin > Runtime` defines provider model catalogs, pricing, capabilities, and active rows.
3. `Admin > Plans` selects primary/fallback models for `video_generate`.
4. Runtime materialization and provider-gateway execution use that selected model/provider truth.

Independent audits found that catalog-only changes are insufficient. Today, video is OpenAI-only through multiple seams:

- runtime/provider constants allow only OpenAI video providers/models;
- `video_generate` materialization clones the image credential ref;
- API native-tool policy gates video to OpenAI;
- runtime native projection mirrors that OpenAI-only gate;
- provider-gateway dispatch supports only `OpenAIProviderClient`;
- runtime HTTP result validation rejects non-OpenAI video responses;
- plan fallback is model-key-only and does not currently imply a different provider/secret.

This ADR defines the executable implementation program for agents. It is intentionally scoped to video providers and does not reopen image generation/editing architecture.

## Decision

Add Runway and Kling as **video-only managed catalog/credential providers**.

Do not add them as chat-routing providers. Chat routing remains:

- `openai`
- `anthropic`

Media catalog/execution providers become:

- image: `openai` only for this ADR;
- image edit: `openai` only for this ADR;
- video: `openai`, `runway`, `kling`.

The system must split provider concepts explicitly:

- `CHAT_ROUTING_PROVIDERS`: providers eligible for primary/fallback/router chat model selection.
- `MANAGED_CATALOG_PROVIDERS`: providers that may own runtime model catalog rows and API key metadata.
- `VIDEO_GENERATE_PROVIDERS`: providers eligible for `video_generate` execution.

Runway/Kling catalog rows may declare `video` capability only in this ADR. They must not receive automatic chat fallback rows, router entries, or primary chat model options.

`video_generate` credentials must be decoupled from `image_generate`. The selected plan video model must resolve to a concrete `(providerId, modelKey, secretId)` at materialization time. A fallback video model may resolve to a different provider and therefore to a different secret.

Provider-specific request mapping belongs inside provider-gateway clients, not in the model-facing tool schema. The public/runtime video tool contract should stay provider-neutral where possible (`prompt`, optional reference image, `seconds`, `size`), while Runway/Kling adapters translate to provider-specific API fields and allowed values.

## Non-goals

- Do not change the OpenAI `image_generate` execution path.
- Do not change the OpenAI `image_edit` execution path.
- Do not add Runway/Kling chat routing.
- Do not support all possible video providers.
- Do not build a generic provider marketplace.
- Do not expose raw provider-specific video complexity to the assistant unless a later ADR requires it.
- Do not add dead stubs, TODO scaffolding, or fake provider clients that appear production-ready without execution tests.
- Do not add Prisma schema changes unless implementation discovers a real persisted-shape blocker. The current settings/secret tables are expected to be string-keyed enough for this ADR.

## Agent execution model

### Orchestrator responsibilities

The main orchestrator owns the ADR execution. It must:

1. Start from a clean git tree.
2. Record the baseline SHA in `docs/SESSION-HANDOFF.md` before or during the first implementation slice.
3. Keep one session to one bounded slice unless the user explicitly expands scope.
4. Assign slice-sized work to subagents with precise file boundaries.
5. Diff-review every subagent result before accepting it.
6. Prevent cross-slice leakage, especially changes to OpenAI image paths.
7. Run the required focused tests and repo gates for each slice.
8. Update docs in the same slice when behavior, API boundary, runtime contract, or active admin workflow changes.
9. Stop and surface conflicts if code, docs, contracts, or audits disagree.

### Subagent rules

Subagents must:

- read this ADR plus the slice-specific files before editing;
- return changed files, behavioral summary, tests run, and risks;
- avoid unrelated refactors;
- avoid broad formatting churn;
- not commit or push;
- not modify `image_generate` / `image_edit` behavior unless the slice explicitly allows it;
- add focused tests for each changed seam.

### Required startup reading for all implementation agents

1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ARCHITECTURE.md`
5. `docs/API-BOUNDARY.md`
6. `docs/DATA-MODEL.md`
7. `docs/TEST-PLAN.md`
8. this ADR
9. relevant prior ADRs:
   - `docs/ADR/051-global-runtime-provider-settings-h1b.md`
   - `docs/ADR/052-tool-credential-refs-and-tool-quota-limits-h2.md`
   - `docs/ADR/086-async-media-jobs-for-generated-image-audio-and-video.md`
   - `docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md`
   - `docs/ADR/105-media-job-truth-and-orchestrated-cleanup.md`

## Execution ledger

| Slice | Title                                    | Purpose                                                                                 | Deploy                       |
| ----- | ---------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| 0     | Baseline and contract map                | Confirm clean baseline, exact generated contract workflow, and current hardcoded seams  | NO                           |
| 1     | Provider catalog types and normalization | Add Runway/Kling to managed catalog/settings as video-only providers                    | API/WEB if shipped           |
| 2     | Admin Tools credentials                  | Add provider key storage/editing for Runway/Kling video credentials                     | API/WEB                      |
| 3     | Admin Runtime catalog UI                 | Render Runway/Kling video-only catalog cards and pricing rows                           | WEB/API                      |
| 4     | Plan validation and model selection      | Make video model selection validate/resolve across OpenAI/Runway/Kling                  | API/WEB                      |
| 5     | Materialization decoupling               | Build independent `video_generate` credential refs from selected video catalog provider | API                          |
| 6     | Runtime contract and native gating       | Allow OpenAI/Runway/Kling video refs through runtime/API gates                          | API/RUNTIME                  |
| 7     | Provider gateway clients                 | Implement Runway/Kling video submit/poll/download adapters                              | PROVIDER-GATEWAY             |
| 8     | Runtime execution and fallback           | Execute provider-aware video refs and optional cross-provider fallback                  | RUNTIME                      |
| 9     | Ledger/pricing and billing facts         | Ensure video billing facts carry correct provider/model/catalog pricing truth           | API/RUNTIME/PROVIDER-GATEWAY |
| 10    | End-to-end verification and docs         | Run focused and repo gates, update architecture/API/data/test docs                      | DEPENDS                      |

Minimum useful path for admin-selectable but not live-callable catalog work: `0 -> 1 -> 2 -> 3 -> 4`.

Minimum production path for live Runway/Kling video: `0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10`.

Do not present the feature as production-ready until the live production path is complete.

## Slice specifications

### Slice 0 - Baseline and contract map

**Scope**

- Confirm clean tree.
- Record baseline SHA.
- Identify exact contract generation command.
- Confirm all current OpenAI-only video gates and all current OpenAI image paths.

**Likely files to inspect**

- `packages/contracts/openapi.yaml`
- `packages/runtime-contract/src/index.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/media-model-routing.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/src/modules/turns/provider-gateway.client.service.ts`
- `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/web/app/admin/tools/page.tsx`
- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/admin/plans/page.tsx`

**Exit**

- Handoff records baseline SHA and exact implementation order.
- No product code changes.

### Slice 1 - Provider catalog types and normalization

**Scope**

- Extend managed provider catalog types to include `runway` and `kling`.
- Introduce shared provider-tier constants.
- Ensure `availableModelsByProvider` remains chat-only.
- Ensure Runway/Kling catalogs do not receive default chat rows.
- Enforce video-only capability for Runway/Kling rows.
- Preserve historical/inactive row behavior and pricing metadata semantics.

**Likely files**

- `packages/contracts/openapi.yaml`
- generated `packages/contracts/src/generated/**`
- `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`
- API tests for runtime provider settings/profile.

**Required tests**

- Contract generation.
- API provider settings tests.
- Runtime provider profile tests.
- A new test proving Runway/Kling cannot be normalized as chat routing providers.
- A new test proving Runway/Kling non-video capabilities are rejected or normalized away according to implementation choice.

**Exit**

- API can read/write settings with four catalog provider buckets.
- Chat model aliases still derive only from chat-capable OpenAI/Anthropic rows.

**Status (2026-06-01): Completed.** Runtime provider types now distinguish chat routing providers (`openai`, `anthropic`) from managed catalog providers (`openai`, `anthropic`, `runway`, `kling`) and video-generate providers (`openai`, `runway`, `kling`). The OpenAPI/admin runtime provider catalog contract exposes all four catalog buckets, Runway/Kling catalog rows are video-only, and focused API tests cover chat-routing rejection plus non-video capability rejection. No Slice 2+ credential, materialization, runtime, provider-gateway, or billing work was included.

### Slice 2 - Admin Tools credentials

**Scope**

- Add Admin Tools credential entries for Runway and Kling video provider API keys.
- Store secrets through the existing `PlatformRuntimeProviderSecretStoreService`.
- Keep OpenAI image credentials unchanged.
- Make key metadata load/display work for the new provider keys.

**Likely files**

- `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`
- `apps/api/src/modules/workspace-management/application/platform-runtime-provider-secret-store.service.ts`
- `apps/api/src/modules/workspace-management/application/manage-admin-runtime-provider-settings.service.ts`
- `apps/web/app/admin/tools/page.tsx`
- relevant API/web tests.

**Required tests**

- API tests for save/load key metadata.
- Web tests for Tools page rendering if existing pattern supports it.

**Exit**

- Admin can save and see masked metadata for Runway/Kling video keys.
- Image generate/edit credential UI and secret ids are unchanged.

**Status (2026-06-01): Completed.** Admin Tools now stores and displays separate encrypted video provider keys for Runway and Kling through the existing secret-store path: `tool_video_generate_runway` -> `tool/video_generate/runway/api-key` and `tool_video_generate_kling` -> `tool/video_generate/kling/api-key`. The existing `tool_image_generate` OpenAI media credential slot remains unchanged for image generation, image edit, and current OpenAI video behavior. No Admin Runtime catalog UI, plan selection, materialization, runtime/provider-gateway execution, provider clients, or billing work was included.

### Slice 3 - Admin Runtime catalog UI

**Scope**

- Add Runway/Kling model catalog cards to `Admin > Runtime`.
- Restrict Runway/Kling model row capability editor to `video`.
- Align video billing default with API (`time_metered` unless product chooses a different explicit default).
- Keep primary/fallback/router chat provider selectors limited to OpenAI/Anthropic.

**Likely files**

- `apps/web/app/admin/runtime/page.tsx`
- `apps/web/app/app/runtime-provider-settings-admin.ts` if still live.
- runtime admin page tests.

**Required tests**

- Runtime page test that Runway/Kling cards render.
- Runtime page test that chat routing selector does not offer Runway/Kling.
- Runtime page test that Runway/Kling new model rows are video-only.

**Exit**

- Admin can configure active Runway/Kling video model rows with pricing metadata.

**Status (2026-06-01): Completed.** `Admin > Runtime` now renders Runway/Kling catalog cards alongside OpenAI/Anthropic. Runway/Kling rows are video-only in the UI, new video rows default to `time_metered`, and chat provider selectors remain OpenAI/Anthropic-only. No plan selection, materialization, runtime/provider-gateway execution, provider clients, or billing work was included.

### Slice 4 - Plan validation and model selection

**Scope**

- Make plan `videoGenerateModelKey` and `videoGenerateFallbackModelKey` validate across all video catalog providers.
- Keep image model validation unchanged unless needed to preserve existing OpenAI image behavior.
- Resolve ambiguous duplicate model ids explicitly. Preferred shape: either reject duplicate active video model keys across providers or store provider-scoped selection if contracts are intentionally changed.

**Likely files**

- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/web/app/admin/plans/page.tsx`
- contract files if plan selection shape changes.

**Decision point**

Current plans submit bare `modelKey`. Duplicate model ids across providers are ambiguous. Orchestrator must choose before implementation:

1. **Conservative path:** enforce unique active video model keys across providers and keep the current plan shape.
2. **Stronger path:** migrate plan selection to provider-scoped `{ providerId, modelKey }` for media roles.

Default for this ADR: choose conservative path unless duplicate real provider model names force provider-scoped contracts.

**Required tests**

- Plan save accepts Runway/Kling video models.
- Plan save rejects Runway/Kling for image fields.
- Plan save rejects duplicate active video model keys if conservative path is used.
- Plans page shows video options grouped by provider.

**Exit**

- Admin can select Runway/Kling video primary/fallback models in plans without breaking image selectors.

**Status (2026-06-01): Completed.** The conservative path was chosen: plan media selections continue to store bare model keys, and duplicate active video model ids across OpenAI/Runway/Kling are rejected so provider resolution remains unambiguous. Plan validation now accepts active OpenAI/Runway/Kling video rows for `videoGenerateModelKey` / fallback while preserving existing image validation. `Admin > Plans` displays provider-labeled video options and disables duplicate active video ids. No materialization, runtime/provider-gateway execution, provider clients, or billing work was included.

### Slice 5 - Materialization decoupling

**Scope**

- Stop cloning `image_generate` credential ref into `video_generate`.
- Resolve `video_generate` ref from selected video catalog row.
- Materialize `providerId`, `modelKey`, and provider-specific `secretId`.
- Materialize fallback refs when fallback model provider differs.

**Likely files**

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`
- materialization tests.

**Required tests**

- OpenAI video materializes as before, but no longer by image credential cloning.
- Runway primary video model materializes with Runway secret.
- Kling primary video model materializes with Kling secret.
- Cross-provider fallback materializes with distinct provider/secret refs.
- Image generate/edit materialization snapshots remain unchanged.

**Exit**

- Runtime bundle carries honest video provider credential refs independent of image credentials.

**Status (2026-06-01): Completed.** Materialization now resolves `video_generate` credential refs from the selected active video catalog provider: OpenAI video keeps the existing OpenAI media credential, while Runway/Kling use their dedicated video provider credential ids. Cross-provider video fallbacks materialize provider-specific refs. Image generate/edit materialization remains unchanged. No runtime/provider-gateway execution gates, provider clients, or billing work was included.

### Slice 6 - Runtime contract and native gating

**Scope**

- Widen video provider ids in runtime contract.
- Update API runtime tool policy to allow configured OpenAI/Runway/Kling video refs.
- Update runtime native projection mirror.
- Keep image provider constants unchanged.

**Likely files**

- `packages/runtime-contract/src/index.ts`
- `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- related tests.

**Required tests**

- API policy allows Runway/Kling video refs.
- API policy still rejects unsupported video providers.
- Runtime projection exposes `video_generate` when configured with Runway/Kling.
- Image tools remain OpenAI-only.

**Exit**

- Assistants configured with Runway/Kling video are not hidden or rejected before execution.

**Status (2026-06-01): Completed.** The shared runtime contract and API/runtime native gates now allow configured `video_generate` refs for OpenAI, Runway, and Kling. Image generation/edit gates remain OpenAI-only and chat routing remains OpenAI/Anthropic-only. No provider-gateway clients, Runway/Kling dispatch/execution, provider adapters, or billing work was included.

### Slice 7 - Provider gateway clients

**Scope**

- Add Runway and Kling provider clients.
- Add provider-gateway dispatch for video provider ids.
- Implement submit/poll/download flow for each provider.
- Normalize request fields per provider inside adapters.
- Return normalized `ProviderGatewayVideoGenerateResult` with provider-specific billing facts.

**Likely files**

- `apps/provider-gateway/src/modules/providers/provider-video-generation.service.ts`
- `apps/provider-gateway/src/modules/providers/provider-gateway.module.ts`
- new `apps/provider-gateway/src/modules/providers/runway/*`
- new `apps/provider-gateway/src/modules/providers/kling/*`
- provider gateway tests.

**Required tests**

- Provider dispatch routes OpenAI/Runway/Kling correctly.
- Unknown provider fails explicitly.
- Runway adapter maps prompt/reference/seconds/size/model to expected API request.
- Kling adapter maps prompt/reference/seconds/size/model to expected API request.
- Billing facts carry correct provider key and model key.

**Exit**

- Provider-gateway can execute normalized video requests through OpenAI/Runway/Kling in tests.

**Status (2026-06-01): Completed.** Provider-gateway now dispatches `video_generate` by materialized provider id to OpenAI, Runway, or Kling. Runway and Kling adapters implement async submit/poll/download flows with normalized gateway results and provider/model keyed time-metered billing facts. Kling uses the official Kling API task flow with JWT auth from Access Key + Secret Key and direct `image2video` base64 image input; no KIE proxy upload/task path remains in the active implementation. OpenAI video model validation remains Sora-only; Runway/Kling accept non-empty catalog model ids. No runtime execution/fallback orchestration, API materialization/gating, or billing ledger work was included.

### Slice 8 - Runtime execution and fallback

**Scope**

- Update runtime `video_generate` execution to use materialized provider/secret refs.
- Update gateway client result validation to accept OpenAI/Runway/Kling.
- Decide and implement fallback behavior:
  - model-only fallback within same provider, or
  - provider-aware fallback chain using materialized fallback refs.

Default for this ADR: implement provider-aware fallback for video only if fallback refs are materialized in Slice 5. Otherwise keep explicit primary-only behavior and do not pretend cross-provider fallback exists.

**Likely files**

- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/media-model-routing.ts`
- `apps/runtime/src/modules/turns/provider-gateway.client.service.ts`
- runtime tests.

**Required tests**

- Runtime sends Runway/Kling provider ids to provider-gateway.
- Runtime accepts Runway/Kling provider-gateway results.
- Runtime stores generated video artifacts as before.
- OpenAI video execution remains green.
- If fallback is implemented: provider failure attempts the configured fallback provider once and records honest error/fallback telemetry.

**Exit**

- Runtime can execute configured non-OpenAI video models through provider-gateway.

**Status (2026-06-01): Completed.** Runtime `video_generate` now calls provider-gateway with the materialized provider/secret/model ref from the assistant bundle and supports one bounded provider-aware fallback using materialized fallback refs. Provider-gateway response validation accepts OpenAI/Runway/Kling video results and rejects provider mismatches. Image generation/edit behavior remains unchanged. No billing ledger/pricing work was included.

### Slice 9 - Ledger/pricing and billing facts

**Scope**

- Ensure generated video billing facts use the executing provider/model.
- Ensure pricing lookup uses timestamp-matched catalog row for OpenAI/Runway/Kling.
- Ensure no ledger row hardcodes OpenAI for video.
- Keep quota settlement semantics unchanged: media units remain plan-owned user quota; provider money/cost facts are additive accounting truth.

**Likely files**

- provider clients from Slice 7
- API ledger/billing fact recording services
- runtime result types if needed
- existing ADR-099 tests.

**Required tests**

- Runway video billing facts append provider/model/currency/cost truth correctly.
- Kling video billing facts append provider/model/currency/cost truth correctly.
- OpenAI video billing facts remain correct.
- Image billing facts remain unchanged.

**Exit**

- Admin economics does not misattribute Runway/Kling video cost to OpenAI.

**Status (2026-06-01): Completed.** Persisted video billing-fact ledger lookup now uses the executing provider's catalog bucket plus timestamp-matched row, so OpenAI/Runway/Kling video costs are attributed to the actual provider/model and historical effective window. Media quota settlement remains unchanged. No runtime/provider-gateway execution or Slice 10 E2E work was included.

### Slice 10 - End-to-end verification and docs

**Scope**

- Update active docs for final behavior.
- Run focused tests from all touched apps.
- Run required repo gates.
- If deploy requested, deploy affected services and live-smoke one OpenAI video and one Runway/Kling video path in `persai-dev`.

**Docs likely to update**

- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`
- this ADR status / execution notes.

**Required repo gate**

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
```

**Exit**

- Docs and code agree.
- Feature is clearly marked as either catalog-only or live-callable.
- Next recommended deploy/smoke step is recorded.

**Status (2026-06-01): Completed.** Final Slice 10 verification ran an independent read-only audit plus repo/focused gates over the full ADR-106 path. The implementation is now code-live-callable for `video_generate` with OpenAI, Runway, and Kling after deployment and real operator credentials: Admin Tools owns separate Runway/Kling video keys, Admin Runtime owns video-only Runway/Kling catalog rows, Admin Plans can select unambiguous OpenAI/Runway/Kling video models, materialization writes provider-specific video refs/fallbacks, runtime executes those refs through provider-gateway, and billing facts/ledger attribution use the executing provider/model. `image_generate` and `image_edit` remain OpenAI-only, and chat routing remains OpenAI/Anthropic-only. No live external provider smoke was run in this local Slice 10 session; the next operator step is deploy affected services and smoke one OpenAI video plus at least one real Runway/Kling video path in `persai-dev`.

## Cross-slice invariants

1. OpenAI image generation/editing behavior must remain unchanged.
2. Runway/Kling must never appear as primary/fallback/router chat providers.
3. Runway/Kling model rows must be video-only for this ADR.
4. Admin plan selections must not create ambiguous provider resolution.
5. `video_generate` must not share `image_generate` secrets after Slice 5.
6. Provider-gateway must fail unknown video providers explicitly.
7. Runtime and API native gating must agree.
8. Billing facts must name the actual executing provider.
9. Generated contracts must be committed whenever `openapi.yaml` changes.
10. No compatibility shim may hide a broken provider path as "configured" when it is not executable.

## Risks

- **Provider API instability:** Runway/Kling API shapes, polling semantics, and result download URLs may differ from OpenAI. Adapter tests must mock exact provider responses.
- **Ambiguous model ids:** Bare model keys can collide across providers. Conservative implementation must reject duplicate active video keys or move to provider-scoped plan selections.
- **Cross-provider fallback semantics:** Existing media fallback is model-key-oriented. True provider fallback requires materialized fallback refs with separate secrets.
- **Billing drift:** Hardcoded OpenAI billing facts would make cost reporting wrong. This must be verified before production use.
- **UI overclaim:** Showing Runway/Kling in plans before execution slices are complete can make admins believe the provider is live. The orchestrator must label catalog-only states honestly.
- **Credential coupling regression:** Any accidental reuse of `tool_image_generate` for video will couple OpenAI image work to Runway/Kling video configuration and is not acceptable.

## Alternatives considered

### Add Runway/Kling as full peers of OpenAI/Anthropic

Rejected. They are not chat-routing providers for this product decision. Treating them as full runtime providers would pollute chat selectors, fallback logic, and router assumptions.

### Put Runway/Kling keys under the existing image credential

Rejected. Current video sharing the image credential is already a coupling problem. New providers should fix that seam, not deepen it.

### Add only catalog rows and defer execution indefinitely

Rejected as production behavior. Catalog-only work may be a temporary implementation milestone, but it must be labeled as not live-callable.

### Add many video providers now

Rejected. Runway and Kling are enough for the current product/cost need. More providers would add adapter and pricing complexity before the execution seam is proven.

## Consequences

### Positive

- Admins can price and select cheaper video models without disturbing working OpenAI image flows.
- Video provider choice becomes real runtime truth, not a UI-only label.
- Future video providers can follow the same catalog/credential/execution pattern once proven.
- Provider costs can be attributed correctly in the existing pricing/ledger model.

### Negative

- This is a multi-slice change across contracts, API, web, runtime, and provider-gateway.
- Generated contracts and admin UI tests must move together.
- True cross-provider fallback requires more careful materialization and runtime retry behavior than the existing model-only fallback.

## Acceptance checklist

- [x] `Admin > Tools` can save OpenAI image key and Runway/Kling video keys independently.
- [x] `Admin > Runtime` shows OpenAI/Anthropic chat-capable catalogs and Runway/Kling video-only catalogs.
- [x] `Admin > Plans` can select OpenAI/Runway/Kling models for `video_generate`.
- [x] `Admin > Plans` cannot select Runway/Kling models for `image_generate` or `image_edit`.
- [x] Published runtime bundle materializes `video_generate` with provider-specific secret refs.
- [x] Runtime can execute OpenAI video after the refactor.
- [x] Runtime can execute Runway video through provider-gateway.
- [x] Runtime can execute Kling video through provider-gateway.
- [x] Unsupported video provider fails explicitly and observably.
- [x] Billing facts and cost rows use the actual provider/model.
- [x] Docs explain whether the deployed state is catalog-only or live-callable.

Operator residual: live smoke with real Runway/Kling credentials is still required after deploy before claiming provider operational readiness in `persai-dev` or PROD.
