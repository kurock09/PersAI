# ADR-138: Browser persistent profiles, live login, and session reuse

## Status

**Closed locally 2026-07-05** — slices S0–S6 landed locally; deploy + live acceptance pending. **Push = deploy** at founder closure only.

## Date

2026-07-05

## Baseline SHA

`466b7b97` on `main`. Implementation subagents start only from a **clean git tree** on the orchestrator branch (no unrelated tracked edits).

## Founder-locked decisions (audit checklist)

| #   | Decision                  | Locked answer                                                                                                                                                                                                       |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Profile scope             | **Per-assistant** `(assistantId, profileKey)` — not per-workspace                                                                                                                                                   |
| 2   | Display name              | **Assistant-chosen** `displayName` on `login`; system owns stable `profileKey`                                                                                                                                      |
| 3   | Cookie/session storage    | **Browserless** session/reconnect; PersAI stores mapping + metadata only                                                                                                                                            |
| 4   | Web login UX              | **Fullscreen modal** (lightbox pattern: portal, back-handler, Capacitor-safe)                                                                                                                                       |
| 5   | Modal open trigger        | **Auto** when `pendingBrowserLogin` appears in chat turn/stream state — **not** markdown `[[action:…]]` chip                                                                                                        |
| 6   | Login complete            | User presses **«Готово»** in modal → API `completeLogin` → verify → `active`                                                                                                                                        |
| 7   | Pre-navigate login URL    | `login` accepts `url`; Browserless opens it **before** live URL                                                                                                                                                     |
| 8   | Telegram                  | **Link only** in message — no modal                                                                                                                                                                                 |
| 9   | Settings UI               | **Integrations** section in assistant settings — site cards **below** messenger grid, thin separator; same `IntegrationCard` visual language; favicon from site origin; status badge; trash delete; reconnect/check |
| 10  | Stateless browser cutover | **No legacy ephemeral path** — all `browser` calls use profile model or explicit ephemeral only when `profile` omitted **and** action is not reusing stored session; remove catalog prose «sessions are ephemeral»  |
| 11  | MVP includes              | profiles, `login`, `list_profiles`, `profile` on `act`/`snapshot`, TTL + expiry job, business errors, **`optimizeForSpeed`**, **`format: pdf`** on `snapshot`                                                       |
| 12  | Out of MVP                | `/unblock` captcha retry — deferred slice after live acceptance                                                                                                                                                     |
| 13  | Plan TTL                  | Sliding `expiresAt` from `lastUsedAt`; **30d** Starter / **90d** Scale via plan billing hint `browserProfileTtlDays`                                                                                                |

### Explicitly rejected (do not reintroduce)

- Per-workspace browser session pool
- Skill-hardcoded profile names (`profile: "bitrix"` in scenario JSON as sole name source)
- User click on markdown action chip to open login modal
- Storing CRM cookies in PersAI Postgres/GCS
- Parallel «old stateless /function-only» browser path kept for compatibility
- `Browserbase` or second browser provider in this program

## Orchestration model

- **Parent agent** owns ADR-138, dispatches slices **S0–S6**, reviews every diff, runs verification gates, reconciles docs, holds vector.
- **Implementation subagents** (Composer / GPT-5.4 / Sonnet) implement **one slice per task**; no scope expansion.
- Parent **does not** land implementation code directly except ADR + orchestration docs.
- Cycle: assign slice → review diff → focused tests + typecheck → fix list → next slice.
- **Push = deploy** once at program end after closure gate.

## Context

### Problem

Today `browser` (`snapshot` / `act`) calls Browserless `/function` with a **fresh browser every time**. CRM and portal scenarios require:

1. One-time human login (2FA, captcha) via live window
2. Reuse of cookies across assistant turns
3. Named sessions the assistant manages (`displayName` from model)
4. Honest expiry with business-level errors for skills
5. Faster table scraping (`optimizeForSpeed`) and PDF export (`format: pdf`)

Catalog currently teaches: «Sessions are bounded and ephemeral» — wrong for target product.

### Active code path (pre-ADR)

| Layer            | File                              | Today                                  |
| ---------------- | --------------------------------- | -------------------------------------- |
| Contract         | `packages/runtime-contract`       | `snapshot`, `act` only                 |
| Runtime          | `runtime-browser-tool.service.ts` | → provider-gateway                     |
| Provider-gateway | `provider-browser.service.ts`     | single `/function` POST, text snapshot |
| Web              | —                                 | no browser login UI                    |

## Decision

### D1 — `AssistantBrowserProfile` (API-owned)

```prisma
model AssistantBrowserProfile {
  id                  String   @id @default(uuid()) @db.Uuid
  assistantId         String   @map("assistant_id") @db.Uuid
  workspaceId         String   @map("workspace_id") @db.Uuid
  profileKey          String   @map("profile_key") @db.VarChar(128)
  displayName         String   @map("display_name") @db.VarChar(500)
  loginUrl            String   @map("login_url") @db.Text
  originHost          String   @map("origin_host") @db.VarChar(255)
  providerSessionId   String   @map("provider_session_id") @db.VarChar(512)
  status              AssistantBrowserProfileStatus
  lastUsedAt          DateTime? @map("last_used_at") @db.Timestamptz(6)
  expiresAt           DateTime? @map("expires_at") @db.Timestamptz(6)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  assistant Assistant @relation(...)
  workspace Workspace @relation(...)

  @@unique([assistantId, profileKey])
  @@index([assistantId, status])
  @@index([status, expiresAt])
}

enum AssistantBrowserProfileStatus {
  pending_login
  active
  expired
}
```

- `profileKey` — server-generated stable slug (from `displayName` + disambiguation); model uses this in `profile` param after `login`/`list_profiles`.
- `originHost` — from `loginUrl` for favicon (`https://www.google.com/s2/favicons?domain=` or equivalent).

### D2 — Tool contract (model-facing)

**Actions** (extend `PERSAI_RUNTIME_BROWSER_ACTIONS`):

| Action          | Purpose                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `describe`      | existing catalog contract load                                                             |
| `list_profiles` | read-only list for assistant `{ profileKey, displayName, status, originHost, lastUsedAt }` |
| `login`         | create/reopen `pending_login`, return `liveUrl` + `profileKey`                             |
| `snapshot`      | optional `profile`, optional `format: "text" \| "pdf"`, optional `optimizeForSpeed`        |
| `act`           | optional `profile`, optional `optimizeForSpeed`, `operations` required                     |

**Business error reasons** (tool result `reason`, `isError: true`):

| reason                          | Skill-facing message intent                        |
| ------------------------------- | -------------------------------------------------- |
| `browser_profile_not_found`     | No profile — run `login` first                     |
| `browser_profile_expired`       | Session expired — reconnect                        |
| `browser_profile_pending_login` | Login not finished — open live window / press Done |

Ephemeral (no `profile`): allowed for public pages only; catalog steers CRM flows to profiles.

### D3 — `pendingBrowserLogin` (web chat state)

Add to turn completion + stream terminal payload + chat list when status is `pending_login`:

```ts
pendingBrowserLogin?: {
  profileId: string;
  profileKey: string;
  displayName: string;
  liveUrl: string;
  loginUrl: string;
} | null;
```

Web: `use-chat` opens `BrowserLoginModal` when field becomes non-null (including mid-stream tool completion). Dismiss via Cancel sets client flag; chip «Продолжить вход» can reopen.

### D4 — Provider-gateway Browserless integration

| Concern        | Endpoint / mechanism                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Login + live   | Session API or BQL `liveURL(interactable: true)` after `goto(loginUrl)`                         |
| Reuse          | `Browserless.reconnect` / session id on `act`/`snapshot` with `profile`                         |
| Speed          | Block images/fonts/3p scripts; `domcontentloaded` when `optimizeForSpeed`                       |
| PDF            | `/pdf` or `page.pdf()` routed when `format: "pdf"`; artifact via storage plane (GCS + manifest) |
| Telegram login | Same `liveUrl` in outbound text — no web modal                                                  |

Remove single-path assumption in `provider-browser.service.ts`; keep one service, multiple strategies.

### D5 — TTL

- On successful `act`/`snapshot` with `profile`: `lastUsedAt = now()`, `expiresAt = now() + plan.browserProfileTtlDays`.
- Scheduler lease `browser_profile_expiry`: mark `active` rows with `expiresAt < now()` → `expired`; best-effort Browserless session delete.
- Lookup: `expired` → business error, not 500.

### D6 — Settings UI

Inside assistant settings **Integrations** section (`assistant-settings.tsx`):

1. Existing messenger `IntegrationCard` grid (Telegram, WhatsApp, MAX)
2. Thin divider + subheading «Подключённые сайты» / «Connected sites»
3. Grid of site cards: favicon, `displayName`, `originHost`, status dot, delete icon button, click → reconnect opens modal with fresh `liveUrl`

API: `GET /api/v1/assistant/:assistantId/browser-profiles`, `DELETE .../:profileId`.

## Slices

| Slice       | Owner    | Deliverable                                                                                                                               | Gate                                                                   |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **S0**      | Subagent | ADR (this doc), `runtime-contract` types/constants, Prisma model + migration, `AGENTS.md` pointer                                         | `runtime-contract` typecheck; `prisma validate` — **landed locally**   |
| **S1**      | Subagent | API profile repository + services (`create/login/complete/list/delete/touch/expire`), internal runtime routes, scheduler job registration | Focused API tests — **landed locally**                                 |
| **S2**      | Subagent | Provider-gateway: reconnect, liveURL login, optimizeForSpeed, pdf snapshot path                                                           | `provider-browser.service.test.ts` green — **landed locally**          |
| **S3**      | Subagent | Runtime `browser` tool: all actions, API client for profile resolve, remove ephemeral-only flow                                           | Runtime browser tests — **landed locally**                             |
| **S4**      | Subagent | Web chat: `pendingBrowserLogin` wired through stream/sync/list; Telegram live URL in channel adapter                                      | API stream tests — **landed locally**                                  |
| **S5**      | Subagent | Web: `BrowserLoginModal`, auto-open in `use-chat`, settings site cards + i18n                                                             | Web component tests — **landed locally**                               |
| **S6**      | Subagent | Tool catalog + projection, DATA-MODEL/API-BOUNDARY/TEST-PLAN, golden guards, full verification gate                                       | lint, format, typecheck, focused tests — **landed locally 2026-07-05** |
| **Closure** | Parent   | SESSION-HANDOFF, CHANGELOG, ADR status → closed locally; founder push=deploy                                                              | All gates — **pending push/deploy + live acceptance**                  |

## Acceptance (live)

1. Assistant calls `login` with `displayName` + `url` → web modal auto-opens on Bitrix login page.
2. User completes login, presses «Готово» → profile `active` in settings card.
3. `snapshot` with `profile` returns authenticated CRM content without re-login.
4. `optimizeForSpeed` measurably faster than default on same URL (smoke note in handoff).
5. `snapshot` with `format: "pdf"` delivers PDF artifact attachable via `files.attach`.
6. After forced expiry → `browser_profile_expired` business error, not stack trace.
7. Telegram turn returns clickable `liveUrl` text, no modal.
8. Delete profile from settings removes row and prevents reuse.

## Risks

- Browserless plan features (liveURL, reconnect TTL) must match production key tier.
- Mobile keyboard in live URL iframe — smoke on real device; fallback external link in modal footer.
- Dirty git tree at program start — orchestrator must branch from clean baseline.
