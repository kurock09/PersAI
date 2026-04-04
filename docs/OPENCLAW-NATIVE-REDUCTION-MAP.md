# OPENCLAW-NATIVE-REDUCTION-MAP

## Purpose

Reduce OpenClaw fork risk by moving PersAI-specific behavior out of native OpenClaw files whenever that can be done safely without weakening runtime guarantees.

This document is the practical reduction map for `H14` inside the Step 15 runtime program.

## Reduction principle

Keep a patch native only when the behavior truly must happen:

- inside runtime execution
- inside native tool/provider selection
- inside native config/schema validation
- inside native gateway boot/runtime state wiring

Move a patch out of native when the same result can be achieved through:

- PersAI control-plane materialization
- PersAI internal API bridge
- OpenClaw PersAI-only bridge files
- plugin-sdk boundary
- config generation instead of runtime code edits

## Best near-term reduction candidates

### 1. Secret provider setup UX logic

Current undocumented high-risk file:

- `openclaw/src/secrets/configure.ts`

Assessment:

- high merge risk
- mostly CLI/setup UX logic
- not central to user-facing runtime execution

Safe reduction path:

- stop depending on OpenClaw interactive secret-provider configuration for PersAI-managed production paths
- prefer PersAI-owned admin/config generation for provider and tool credentials
- keep OpenClaw runtime as a resolver/executor, but not as the primary place where PersAI operators shape provider setup

Result:

- reduce importance of native `configure.ts`
- eventually remove PersAI-specific pressure to keep patching OpenClaw secret configuration UX

### 2. PersAI secret source shape can converge toward generic provider flow

Current high-risk/native files:

- `openclaw/src/config/types.secrets.ts`
- `openclaw/src/config/zod-schema.core.ts`
- `openclaw/src/secrets/ref-contract.ts`
- `openclaw/src/secrets/resolve.ts`

Assessment:

- these are real merge-risk files
- today they exist because PersAI added a dedicated native `source: "persai"` secret flow

Safe reduction path:

- move toward `exec` provider + PersAI API bridge for PersAI-managed secrets/tool credentials
- keep OpenClaw using a generic native provider type
- remove the need for PersAI-specific secret-source branching in core config/schema code

Why this is attractive:

- turns a PersAI-specific native schema/runtime patch into a generic OpenClaw-supported provider pattern
- directly reduces fork-diff in config + secret resolution code

### 3. Explicit spec store injection in runtime bootstrap

Current native file:

- `openclaw/src/gateway/server-runtime-state.ts`

Assessment:

- small native patch
- low complexity
- already called out in `H14b`

Safe reduction path:

- rely on the same singleton/store resolution path already centralized in `server-http.ts`
- remove explicit PersAI store creation from `server-runtime-state.ts`

Result:

- easy one-file fork reduction
- low implementation risk

## Medium-value reduction candidates

### 4. Provider auth helpers should stay on plugin-sdk boundaries where possible

Related files:

- `openclaw/src/plugin-sdk/provider-auth.ts`
- `openclaw/src/plugin-sdk/provider-auth-api-key.ts`
- `openclaw/src/plugin-sdk/persai-credential.ts`
- `openclaw/src/agents/model-auth-env.ts`
- `openclaw/src/web-search/runtime.ts`
- `openclaw/src/tts/tts.ts`

Assessment:

- plugin-sdk exports are a good reduction direction
- request-scoped credential lookup for live execution still happens inside native runtime paths

Safe reduction path:

- keep widening the plugin-sdk seam for extension-facing code
- avoid new native ad hoc provider-auth patches outside central runtime credential helpers
- converge credential-aware extensions onto shared helper surfaces instead of one-off native edits

Important limit:

- do **not** try to move active request-scoped provider resolution fully out of native runtime if that would reintroduce `process.env` races or duplicated provider-selection logic

### 5. Product-facing tools should prefer PersAI-owned bridge tools over exposing generic native tools

Related files:

- `openclaw/src/agents/openclaw-tools.ts`
- `openclaw/src/agents/tools/cron-tool.ts`
- `openclaw/src/agents/tools/reminder-task-tool.ts`

Assessment:

- replacing generic native tools with PersAI-owned product tools is good reduction in blast radius
- but the final tool registry is still native, so this is not full fork elimination by itself

Safe reduction path:

- continue exposing PersAI-owned tools like `reminder_task` instead of generic `cron` for product UX
- continue driving policy and limits from PersAI control plane
- later reduce native registry special cases if upstream/plugin seams improve

## What should remain native for now

These should **not** be aggressively moved out just to shrink diff count.

### 1. Request-scoped credential resolution during runtime execution

Files such as:

- `openclaw/src/agents/model-auth-env.ts`
- `openclaw/src/web-search/runtime.ts`
- `openclaw/src/agents/tools/web-fetch.ts`
- `openclaw/src/tts/tts.ts`
- `openclaw/src/tts/providers/openai.ts`
- `openclaw/src/tts/providers/elevenlabs.ts`

Reason:

- provider selection and final auth resolution happen during live runtime execution
- PersAI cannot safely force that behavior purely from outside once execution is already inside OpenClaw

### 2. Tool filtering at the final runtime tool registry

File:

- `openclaw/src/agents/openclaw-tools.ts`

Reason:

- PersAI can compute policy, but the final list of actual runtime tools still exists here
- deny-by-default for shared runtime must still be enforced at the runtime registry boundary

### 3. PersAI runtime bridge endpoints

Files under:

- `openclaw/src/gateway/persai-runtime/`

Reason:

- these are PersAI-owned bridge files, not dangerous core-schema edits
- they already isolate much of the integration away from OpenClaw core

## Recommended order

### H14a

- migrate PersAI-managed provider/tool secret resolution toward generic `exec` provider + PersAI API bridge
- goal: remove PersAI-specific secret-source/schema patches from native OpenClaw core

### H14b

- remove explicit spec-store wiring from `server-runtime-state.ts`

### H14c

- stop adding PersAI-specific behavior to native secret configuration UX unless there is no alternative

### H14d

- prefer plugin-sdk/helper seams and PersAI-owned bridge tools before touching native runtime files

## Decision rule for future patches

Before adding or preserving any native OpenClaw patch, ask:

1. Can this be expressed in PersAI materialization or policy instead?
2. Can this be expressed in a PersAI-only bridge file instead?
3. Can this be expressed through plugin-sdk/helper seams instead?
4. Does it truly need to run inside native runtime execution or schema validation?

If the answer to `1-3` is yes, do not deepen the native patch.

## Related docs

- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/OPENCLAW-FORK-AUDIT-AUTOMATION.md`
- `docs/OPENCLAW-SHARED-RUNTIME-HARDENING.md`
- `docs/ROADMAP.md`
