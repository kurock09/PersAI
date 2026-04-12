# SR10 Load-Test Pack

Runnable load-validation harness for `SR10` at `100 / 500 / 1000` concurrent-user profiles.

## What it does

- drives real PersAI API traffic against existing seams:
  - `POST /api/v1/assistant/chat/web`
  - `POST /api/v1/assistant/chat/web/stream`
  - `POST /api/v1/assistant/chat/web/stage-attachment`
  - `POST /api/v1/assistant/voice/transcribe`
- runs three ordered phases per profile:
  - `step`
  - `burst`
  - `soak`
- collects client-side latency/error evidence
- snapshots admin overview before/after each phase when `SR10_ADMIN_TOKEN` is present
- stops automatically on gate failure so higher tiers are not treated as valid evidence

## Files

- runner: `scripts/loadtest/run-sr10.cjs`
- example config: `scripts/loadtest/sr10.example.json`
- reports: `artifacts/sr10-loadtest/*.json`

## Secrets and ids

The config file references env vars instead of storing secrets inline.

Required env vars depend on enabled scenarios:

- `SR10_ADMIN_TOKEN`
- `SR10_USER_TOKEN_1`
- `SR10_USER_TOKEN_2`
- `SR10_USER_TOKEN_3`

Synthetic Telegram loadtest traffic was removed after ADR-072 Step 13. Telegram should now be validated through real live checks against the public webhook/Bot API path instead of the old internal turn seam.

## Typical setup

1. Copy `scripts/loadtest/sr10.example.json` to a local untracked file such as `scripts/loadtest/sr10.local.json`.
2. Replace API base URL and real assistant ids.
3. Export the required env vars in the shell.
4. If you enable `voice_transcribe`, place a small sample file at `scripts/loadtest/fixtures/sample-voice.webm` or update the path in config.

## Commands

Dry-run:

```powershell
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --dry-run
```

Single profile:

```powershell
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --profile 100
```

Full ladder:

```powershell
node scripts/loadtest/run-sr10.cjs --config scripts/loadtest/sr10.local.json --profile 100,500,1000
```

Or via package script:

```powershell
corepack pnpm run sr10:load -- --config scripts/loadtest/sr10.local.json --profile 100
```

## Report shape

Each run writes one JSON file with:

- run id
- selected profiles
- per-phase client summary:
  - total
  - succeeded / failed
  - error rate
  - `p50 / p95 / p99 / max`
  - scenario breakdown
  - error code breakdown
- admin overview snapshots before/after phase when admin token is configured
- gate verdict and stop reason

## Current limits

- This harness is intentionally repo-local and simple; it does not yet scrape `/metrics` directly or persist raw time-series.
- Telegram load uses the internal PersAI Telegram turn seam, not public Telegram delivery infrastructure.
- Media upload uses generated small files by default; it validates flow pressure, not large-object bandwidth ceilings.
- `100 / 500 / 1000` is a practical execution ladder for now; canonical final `SR10` evidence in docs still requires the full `1000 / 3000 / 5000` gate later.
