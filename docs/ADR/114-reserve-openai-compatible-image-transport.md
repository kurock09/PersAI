# ADR-114: Reserve OpenAI-compatible media transport

## Status

Completed for the decided scope. Baseline SHA: `22bad4919040b54b87539531ed92ea5ccf3206de` on `main`; working tree was clean at ADR replacement start.

Implemented in Slice 1:

- `Admin > Tools` reserve OpenAI-compatible Media block;
- materialized reserve transport config for image generation/edit refs;
- one-shot reserve retry for `image_generate` and `image_edit` on allowlisted primary OpenAI transport/account failures;
- internal logs and existing-platform admin notification on successful reserve fallback;
- focused provider/API/runtime/web typechecks and focused tests;
- live operator validation that reserve image fallback works as intended.

Not implemented by design: OpenAI video fallback. It remains explicitly deferred until a separate live compatibility proof for PersAI's exact OpenAI video route exists and a new follow-up decision chooses to implement it.

This ADR replaces the withdrawn realtime live voice ADR-114 and the superseded fal-backed image-provider draft. The active decision is intentionally narrower: add a reserve OpenAI-compatible transport inside the existing Media credential block for OpenAI image calls, and for OpenAI video only after the current video route is verified as compatible.

## Context

PersAI already has a working OpenAI media credential path for `image_generate`, `image_edit`, and the existing OpenAI video path. The product goal is reliability, not a new model/provider architecture:

- preserve current direct OpenAI behavior;
- preserve current model choices such as `gpt-image-2` and `gpt-image-1.5`;
- preserve current `image_generate`, `image_edit`, and OpenAI video request and response contracts;
- add a reserve API key and base URL for OpenAI-compatible media calls, using ProxyAPI-style transport when the direct OpenAI transport fails for infrastructure/account-access reasons.

ProxyAPI documents an OpenAI-compatible/native OpenAI route:

```text
https://api.proxyapi.ru/openai/v1
```

with `Authorization: Bearer <PROXYAPI_KEY>`, and documents support for:

- `/images/generations`;
- `/images/edits`;
- `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`;
- multi-output via `n`;
- multi-reference edit via `image[]`;
- mask-based inpainting;
- `usage` in the response for GPT Image token billing.

ProxyAPI also documents OpenAI Video API support as limited. Therefore, image generation/editing is the implementation scope of this ADR. OpenAI video reserve fallback is deferred until a later explicit slice with live compatibility proof for PersAI's exact OpenAI video route.

## Decision

Add a reserve OpenAI-compatible media transport behind the existing OpenAI media provider path.

This is not a new user-visible image provider and not a new model catalog family. It is the same OpenAI image client/request shape with different transport configuration:

```text
primary:
  apiKey: existing OpenAI key
  baseURL: https://api.openai.com/v1

reserve:
  apiKey: reserve OpenAI-compatible key
  baseURL: https://api.proxyapi.ru/openai/v1
```

The reserve transport is used for `image_generate` and `image_edit` when enabled by the operator. The existing OpenAI video path shares the Media credentials UI, but video fallback is not enabled by this ADR's first implementation slice.

## Admin UX

### Admin > Tools

Add one compact block in the existing `Media` section, beside the shared Image Generation / Edit / OpenAI Video API key:

- `Enable reserve OpenAI-compatible media transport` — boolean;
- `Reserve API key` — encrypted secret;
- `Reserve base URL` — encrypted/configured value, default `https://api.proxyapi.ru/openai/v1`.

No Admin Runtime provider selector is needed for this ADR. No Admin Plans provider selector is needed for this ADR.

### Admin > Runtime

No model-provider redesign. Existing OpenAI image model catalog rows remain the model truth and pricing truth.

At most, Runtime may display a read-only status hint that reserve media transport is configured, but it must not introduce a second selectable provider/model row in this ADR.

### Admin > Plans

No plan shape change. Plans keep selecting existing image model keys such as `gpt-image-2` and `gpt-image-1.5`.

## Execution Behavior

For each OpenAI media call covered by this ADR:

1. Build the same request as today.
2. Send it to the primary direct OpenAI client.
3. If the primary fails with an allowlisted fallback-trigger error and reserve transport is enabled/configured, retry the same logical request once with the reserve OpenAI-compatible client.
4. Return the successful result normally.
5. If both transports fail, surface the existing calm media-tool failure behavior while logging both failures internally.

The reserve retry must be attempted at most once per logical provider call.

## Fallback Trigger Policy

Fallback is allowed only for transport/provider/account availability failures where retrying the same valid request through a reserve transport is meaningful:

- network error;
- timeout;
- HTTP `429` rate limit or quota exhaustion;
- HTTP `500`, `502`, `503`, `504`;
- primary OpenAI account/key access failures that indicate operational unavailability, such as disabled/suspended account, insufficient quota, region/access unavailable, or auth failure for the primary key.

Fallback is not allowed for request/content/user-correctable failures:

- HTTP `400 invalid_request`;
- unsupported parameters such as bad `size`, `quality`, `background`, duration, aspect ratio, or model;
- bad image, bad mask, mismatched mask size, unsupported MIME, too-large reference file;
- prompt/content safety rejection or moderation/policy refusal;
- provider response saying the request is structurally invalid;
- any error where the reserve provider would receive the same invalid input and likely fail for the same reason.

If classification is ambiguous, prefer no fallback and return the honest error. False fallback can hide product/model bugs and burn reserve quota.

## Billing and Observability

The successful transport must be visible in internal logs and billing facts:

- `primary_used` for direct OpenAI success;
- `primary_failed_reserve_used` when reserve succeeds;
- `primary_failed_reserve_failed` when both fail.

Cost ledger rows must reflect the actual successful transport/provider context without changing user-facing monthly media quota semantics. The existing media monthly quota reservation and success-only delivery settlement remain unchanged.

ProxyAPI image responses include token `usage`; implementation should use that where the existing OpenAI image path already uses provider usage. Do not add new billing-facts metadata just to identify reserve transport in Slice 1. Price and ledger the successful image call through the existing OpenAI model/pricing path, and keep transport attribution in internal logs plus the admin notification described below.

## Admin Notification

When reserve fallback succeeds, create one existing-platform admin notification event for that fallback occurrence.

Requirements:

- notify only after reserve transport succeeds;
- emit at most once per logical fallback occurrence;
- include the tool (`image_generate` or `image_edit`), model key, primary failure class/status, reserve base URL host, and available job/chat identifiers;
- do not notify for primary success;
- do not notify for invalid requests where fallback was not attempted;
- reserve failure after primary failure may be logged as an error, but does not require a user/admin notification in Slice 1 unless the existing notification taxonomy already has a suitable failure event.

The notification must use the existing admin notification/recipient mechanism. Do not create a parallel notification system.

## Non-Goals

- Adding `fal` as an image provider.
- Adding Ideogram as an image provider.
- Changing direct OpenAI image behavior.
- Changing Plans model selection.
- Adding Admin Runtime provider/model rows for ProxyAPI.
- Reworking image/video tool contracts, series mode, multi-reference semantics, or media quota accounting.
- Enabling OpenAI video fallback in Slice 1.
- Adding new billing-facts metadata solely for transport attribution.
- Retrying on content/policy/invalid-input errors.
- Implementing realtime live voice; that withdrawn ADR-114 scope is cancelled.

## Execution Model

This is an orchestrator-run program. The parent agent must not implement production code directly during implementation slices unless the operator explicitly changes that rule in the session prompt.

The parent agent's job is to:

1. study the current system before assigning work;
2. create one sequential GPT-5.4 subagent task per slice;
3. give the subagent a bounded prompt with required reading, target files, non-goals, and verification commands;
4. review the subagent's diff against this ADR and the existing architecture;
5. run or request focused checks and the repository gate;
6. reconcile docs, handoff, and changelog only after code truth is verified;
7. stop and report honestly if ProxyAPI endpoint behavior, response usage, error taxonomy, or current OpenAI media code contradicts this ADR.

Do not parallelize implementation subagents for this ADR. Do not make tiny PR-churn slices. Each slice must be coherent enough to audit cleanly.

## Slice Plan

### Slice 0 — Current-system and ProxyAPI verification

**Type:** read-only + ADR refinement if needed.  
**Deploy:** no.

The orchestrator studies:

- current OpenAI media provider client setup, including image and OpenAI video only to understand what is out of Slice 1;
- whether base URL is configurable in the existing OpenAI SDK wrapper;
- current image generate/edit error taxonomy;
- current tool credential storage/materialization;
- current image billing facts, ledger handling, and existing admin notification mechanisms;
- current media job retry/failure behavior.

The orchestrator verifies with ProxyAPI docs and, if a key is available, live smoke:

- `/images/generations` with `gpt-image-2`;
- `/images/edits` with one reference;
- `/images/edits` with multiple references;
- mask edit if current PersAI contract supports masks;
- `n > 1`;
- response `usage`;
- representative failure responses for invalid request vs auth/quota/rate-limit.
- current OpenAI video request path, if any, only to document why video fallback is deferred.

Exit with a short implementation brief. If any assumption is wrong, amend this ADR before implementation.

### Slice 1 — Reserve transport configuration and execution

**Type:** one coherent API/provider-gateway implementation slice by one GPT-5.4 subagent.  
**Deploy:** required.
**Status:** completed for image generation/editing only.

Implement:

- `Admin > Tools` reserve media transport block with enable bool, encrypted API key, and base URL;
- materialization of reserve transport config to the provider-gateway/runtime image path;
- OpenAI image client support for primary + reserve OpenAI-compatible transport;
- allowlisted fallback classification;
- one retry on reserve transport for `image_generate` and `image_edit`;
- internal logs that identify actual transport used;
- existing-platform admin notification when reserve fallback succeeds;
- focused tests for fallback/no-fallback decisions.

This slice must not change Admin Plans, Admin Runtime model selection, direct OpenAI request shape, or image/video tool semantics.

### Slice 2 — Hardening, docs, and live smoke

**Type:** hardening and verification slice by one GPT-5.4 subagent or orchestrator-audited doc pass after code lands.  
**Deploy:** required if Slice 1 code shipped.

Complete:

- operator-facing copy polish;
- docs updates to `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md`, `CHANGELOG.md`, and `SESSION-HANDOFF.md` as needed;
- focused tests plus repository gate;
- live smoke:
  - primary OpenAI image generation still works;
  - primary OpenAI image edit still works;
  - forced primary retryable failure falls back to reserve generation;
  - forced primary retryable failure falls back to reserve edit;
  - fallback success creates one admin notification;
  - invalid request does not fallback.

This hardening/live-smoke slice is now complete for the ADR's image-only scope.

## Verification Baseline

Focused checks should include provider-gateway OpenAI image client tests, tool credential tests, materialization tests, media-job fallback tests, admin notification tests, and ledger/billing-facts regression tests proving pricing/quota semantics did not change.

Before claiming an implementation slice clean, run the repository gate required by `AGENTS.md`:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```
