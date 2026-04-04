# OPENCLAW-FORK-AUDIT-AUTOMATION

## Purpose

Define the minimum automation expected for Step `R15c`.

This exists because `openclaw/docs/PERSAI-FORK-PATCHES.md` is useful but not sufficient as the only source of truth. The real fork must be audited from:

- current code
- git diff from the fork base
- git history on critical native files

## Current baseline

PersAI now includes:

- `scripts/openclaw-fork-audit.cjs`
- root scripts:
  - `corepack pnpm run openclaw:fork:audit`
  - `corepack pnpm run openclaw:fork:audit:strict`

The script audits the local sibling OpenClaw repo by default (`../openclaw`) and reports:

- file diff from `persai-fork-base..HEAD`
- implementation-file subset
- high-risk implementation files
- files not referenced in `docs/PERSAI-FORK-PATCHES.md`
- recent history touching critical native files

### First baseline run

First local baseline run against the current pinned fork (`ca815889fb4a0944b98a1355e04afc58636e42f3`) reported:

- 91 changed files from `persai-fork-base..HEAD`
- 68 implementation files
- 23 high-risk implementation files
- undocumented high-risk files:
  - `src/config/zod-schema.core.ts`
  - `src/secrets/configure.ts`

This is useful immediately because it proves the patch document is not yet a complete control surface by itself.

## Usage

### Normal report

```bash
corepack pnpm run openclaw:fork:audit
```

### Strict mode

```bash
corepack pnpm run openclaw:fork:audit:strict
```

Strict mode exits non-zero when a high-risk implementation file changed in the fork but is not referenced in `docs/PERSAI-FORK-PATCHES.md`.

### Optional overrides

```bash
node scripts/openclaw-fork-audit.cjs --repo="../openclaw" --base-tag=persai-fork-base --patch-doc=docs/PERSAI-FORK-PATCHES.md
```

## Why this matters

Without this automation, upstream merge safety depends too heavily on:

- memory
- manual Markdown upkeep
- clean-looking merges that may still lose runtime/security behavior

The audit script gives agents and maintainers a fast baseline before:

- upstream sync
- release prep
- paid-production runtime hardening work

## Current limitations

This is a baseline, not the final end-state.

It does **not** yet:

- enforce CI by itself
- understand semantic equivalence of code changes
- prove runtime behavior correctness
- replace targeted smoke tests

## Planned follow-up

### R15c completion

PersAI now treats the following as the canonical upstream-update gate:

```bash
corepack pnpm run openclaw:fork:update-gate
```

This wrapper runs, in order:

1. strict fork diff audit from `persai-fork-base..HEAD`
2. `openclaw/scripts/verify-persai-patches.mjs`
3. OpenClaw typecheck (`pnpm exec tsc --noEmit`)
4. plugin-sdk export checks

Agents should use this gate instead of inventing an ad hoc subset of checks.

Current status:

- the gate is wired and runnable
- the previously undocumented high-risk files (`src/config/zod-schema.core.ts`, `src/secrets/configure.ts`) are now explicitly covered in `openclaw/docs/PERSAI-FORK-PATCHES.md`
- the canonical gate now passes on the current Windows maintainer environment as well as the normal repo layout

Current expected outcome:

- `corepack pnpm run openclaw:fork:update-gate` should pass before an upstream merge is treated as ready for the targeted smoke pack below

### Targeted runtime/security smoke after the gate

Passing the gate above is necessary but not sufficient.

Before treating an upstream merge as ready for deploy or release prep, run the targeted runtime/security smoke pack:

1. PersAI runtime preflight through API (`GET /api/v1/assistant/runtime/preflight`)
2. streaming web chat turn in `/app`
3. direct OpenClaw `healthz` / `readyz`
4. direct `spec/apply` + web chat contract check against `/api/v1/runtime/*`
5. one channel/reminder-sensitive path that exercises PersAI bridge behavior if the changed fork area touches:
   - `src/gateway/persai-runtime/*`
   - `src/agents/tools/cron-tool.ts`
   - `src/gateway/persai-runtime/persai-runtime-telegram.ts`
   - `src/secrets/*`
   - `src/config/*`

Use `docs/LIVE-TEST-HYBRID.md` as the canonical smoke reference.

### R15c1

- expand invariant checks beyond path/document drift into symbol/behavior checks for critical files

### R15c2

- add CI usage for strict mode

### R15c3

- keep the wrapper gate and smoke checklist aligned with release/update workflow docs so upstream merges always run the same gate

### R15c4

- use `docs/OPENCLAW-NATIVE-REDUCTION-MAP.md` to distinguish:
  - native patches that must be preserved
  - native patches that should be migrated out of OpenClaw core over time

## Related files

- `scripts/openclaw-fork-audit.cjs`
- `openclaw/docs/PERSAI-FORK-PATCHES.md`
- `openclaw/scripts/verify-persai-patches.mjs`
- `docs/OPENCLAW-SAAS-RUNTIME-PLAN.md`
- `docs/OPENCLAW-NATIVE-REDUCTION-MAP.md`
