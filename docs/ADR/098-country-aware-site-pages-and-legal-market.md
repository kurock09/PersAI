# ADR-098 Country-aware site pages and legal-market baseline

## Status

Accepted - 2026-05-18

## Context

PersAI needed real public trust pages instead of landing-page hash links, and the founder wanted:

- admin-editable `/terms`, `/privacy`, `/requisites`, and `/contacts`
- two legal markets: `rf` and `intl`
- market derived from the existing user `countryCode` instead of a new duplicated user field
- onboarding/setup to collect country explicitly with IP-based defaulting
- compliance required versions to stop reading one hardcoded global TOS/privacy version for every user

The active repo already had the necessary regional foundation:

- `app_users.country_code`
- `app_users.preferred_locale`
- locale resolution on `/me`
- admin-controlled product content patterns such as prompt templates and plans

What was missing was a single persisted site-page model plus one shared legal-market rule.

## Decision

### 1. Legal market derives from country

Add shared `resolveLegalMarket(countryCode)` with only two outcomes:

- `RU` -> `rf`
- every other country -> `intl`

No new user-level `market` field is introduced.

### 2. Public site pages become platform-owned persisted content

Add `platform_site_pages` as the canonical persisted model for public trust/legal pages.

Each row is keyed by:

- `slug` (`terms`, `privacy`, `requisites`, `contacts`)
- `market` (`rf`, `intl`)
- `locale` (`ru`, `en`)
- `status` (`draft`, `published`)

Published rows are the public runtime truth. Draft rows are the admin editing surface.

### 3. Public/admin API boundary

Add:

- `GET /api/v1/public/geo-hint`
- `GET /api/v1/public/site-pages/:slug`
- `GET /api/v1/admin/site-pages`
- `PUT /api/v1/admin/site-pages/:slug`
- `POST /api/v1/admin/site-pages/:slug/publish`

Public page reads resolve market and locale in this order:

1. explicit query params
2. guest cookie / geo header heuristics
3. anonymous market fallback to `rf` when no country hint exists
4. locale fallback (`rf -> ru`, `intl -> en`)

If explicit query params are provided and are outside the contract (`market` not in `rf|intl`, `locale` not in `ru|en`), the API returns `400` instead of silently coercing or ignoring them.

Successful public reads also return the currently published `availableVariants[]` for the requested slug so the web UI can render only real market/locale switches.

Admin site-page management is platform-scoped admin work, not ordinary workspace-owner work.

### 4. Compliance required versions derive from published site-page versions

The required TOS/privacy version is no longer one hardcoded global value in the happy path.

Instead:

- market resolves from `app_users.country_code`
- the required versions are read from the published `terms` / `privacy` rows for that market
- the historical MVP constants remain only as a fallback if the CMS rows are missing

### 5. Setup collects country explicitly

The setup first step now includes a searchable ISO country picker.

- existing `app_users.country_code` remains the stored truth
- `/api/v1/public/geo-hint` provides a best-effort default from request headers/cookies
- the country is also mirrored into a guest cookie so public site pages can resolve market before login or after email click-through

### 6. Bootstrap/backfill for baseline site pages is automatic

The `platform_site_pages` table must not stay empty in a freshly migrated environment.

The canonical starter rows are therefore inserted in two places:

- `prisma seed` for explicit bootstrap/dev reset flows
- API startup auto-seed for idempotent environment backfill when rows are missing

This startup path inserts missing rows only; it does not overwrite operator-edited content.

## Consequences

### Positive

- landing footer and billing emails now point to real public pages
- one admin surface owns public trust text
- RF vs international legal text can diverge without duplicating user truth
- compliance can evolve per market by publishing a new page version
- setup now captures a durable country choice early instead of guessing forever from locale
- new environments do not rely on a separate manual backfill step just to serve baseline legal pages
- anonymous opens on public trust pages now default to the RF variant unless a country hint or explicit query says otherwise

### Negative

- public legal correctness now depends on admins keeping the published page rows current
- there is still only a two-market legal model; finer regional policy matrices remain out of scope
- billing email market inference is still locale-based when there is no user country available at click time
- startup auto-seed must remain insert-only so it never clobbers admin-managed edits
- anonymous defaulting is intentionally founder-biased toward RF and may feel surprising for international incognito traffic until a country hint is known

## Out of scope

- a multi-region legal-policy engine beyond `rf` vs `intl`
- country-specific billing/tax logic beyond public page routing
- localized admin UI copy for the new site-page editor
- historical OpenClaw compatibility paths

