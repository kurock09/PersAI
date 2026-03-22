# SESSION-HANDOFF

## What changed

- Implemented targeted startup hotfix slice for dev deploy runtime failures (no Step 2/product scope changes).
- Fixed web startup command wiring:
  - `apps/web/package.json` `start` now: `next start -p 3000 -H 0.0.0.0`
  - `apps/web/Dockerfile` now runs `CMD ["pnpm", "start"]` (no extra argument forwarding)
- Fixed api build artifact production reliability:
  - `apps/api/package.json` `build` now uses `tsc -p tsconfig.build.json --incremental false`
  - `apps/api/Dockerfile` now includes fail-fast check:
    - `RUN test -f /workspace/apps/api/dist/main.js`
- Updated docs:
  - `docs/CHANGELOG.md`
  - `docs/SESSION-HANDOFF.md`

## Why changed

- Current dev rollout reached new pinned SHA images but both containers still failed to start:
  - api: missing `/workspace/apps/api/dist/main.js`
  - web: invalid `next start` invocation caused by argument forwarding
- This slice applies only minimal startup/build fixes required to make containers reach Running.

## Decisions made

- Kept scope strictly to startup/build command fixes for `apps/web` and `apps/api`.
- Did not redesign Docker strategy or runtime architecture.
- Added explicit fail-fast assertion in api Docker build so broken image no longer publishes silently.

## Files touched

- apps/web/package.json
- apps/web/Dockerfile
- apps/api/package.json
- apps/api/Dockerfile
- docs/CHANGELOG.md
- docs/SESSION-HANDOFF.md

## Migrations run

- Not run (startup/build/docs slice only).

## Tests run / result

- Pending in this slice before push:
  - run local checks
  - push to `main`
  - wait for `Dev Image Publish`
  - `argocd app sync persai-dev`
  - verify pods/logs in `persai-dev`

## Known risks

- If build output path changes in future, docker fail-fast check path must be updated accordingly.

## Next recommended step

- Complete operational rollout loop for this hotfix:
  - push
  - wait for publish
  - sync Argo
  - verify `api/web` Running and tail logs for startup confirmation.
