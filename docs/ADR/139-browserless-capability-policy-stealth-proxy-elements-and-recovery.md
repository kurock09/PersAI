# ADR-139: Browserless capability policy, stealth/proxy defaults, persistent elements, and recovery-owned reauth

## Status

**Open** — parent-orchestrated implementation program. Parent agent owns ADR and final doc reconciliation. Implementation is delegated slice-by-slice to **GPT-5.4** subagents only. **Push = deploy** and is founder-controlled, so this ADR may be implemented and committed locally by slice, but not pushed as part of ordinary slice execution.

## Date

2026-07-07

## Baseline SHA

`9c64ea36` on `main`, starting from a clean git tree.

## Context

ADR-138 established the first production Browserless profile path:

- per-assistant persistent browser profiles
- `browser.login` / `browser.list_profiles`
- Browserless-backed live login modal on web
- persistent-profile `snapshot` / `act`
- profile TTL and expiry scheduler
- product-owned `pendingBrowserLogin` modal flow

That baseline is now the only active profile model. The next required product layer is not "more login plumbing"; it is **capability policy** over the persistent Browserless path:

1. ensure persistent profiles always use the intended Browserless production capability path
2. add platform-owned stealth + sticky proxy policy for persistent sessions
3. restore interactive `elements` on the persistent BrowserQL path so follow-up `act` calls can target stable selectors
4. make recovery truthful: cold/reconnectable sessions must not be narrated as permanently expired, and web re-auth must stay product-owned instead of asking the model to paste Browserless live URLs into chat

The founder constraints for this program are explicit:

- **prod-only**
- **no legacy compatibility path**
- **no push during implementation**
- **commits allowed per slice**
- **parent orchestrator owns the ADR**
- **GPT-5.4 implementation subagents only**

## Explicitly rejected

Do not reintroduce or invent any of the following:

- legacy `/reconnect` compatibility as an active path
- dual old/new Browserless behavior "for safety"
- model-owned proxy configuration
- model-owned recovery narration based on raw provider failures
- Browserless live URL pasted into ordinary web chat output
- non-prod-only wiring or temporary deploy-detour logic
- a second browser provider or custom browser engine in this slice

## Decision

### D1 — Persistent profile capability policy is platform-owned

Persistent browser profiles remain Browserless-managed sessions. PersAI owns **policy**, not browser-engine internals.

For persistent profiles, the platform owns:

- whether stealth is enabled
- whether sticky residential proxy is enabled
- which identity the sticky policy binds to
- whether and how interactive elements are extracted
- whether a failed session is reconnectable, needs re-auth, or is truly expired

These are not model knobs in v1 of this ADR.

### D2 — Stealth + sticky residential proxy are the persistent-profile default

The default capability policy for persistent profiles is:

- `stealth: true`
- sticky residential proxy enabled

The initial product-default transport is Browserless built-in residential proxy if the active Browserless plan accepts it. The architecture must keep a typed slot for a later external `proxy.server` override, but that override is not the normal path in this ADR.

Sticky proxy identity binds to PersAI profile identity `(assistantId, profileKey)`, not to an ephemeral request id and not to a volatile session instance. Reconnect and re-auth should preserve the same policy intent.

Country-specific forcing is **not** hardcoded in this ADR. If the active Browserless account cannot honor the desired region, the system must fail honestly or fall back according to platform policy; it must not pretend Russian routing was guaranteed.

### D3 — Persistent BrowserQL returns normalized interactive `elements`

The persistent BrowserQL path must stop returning permanently empty `elements`.

PersAI already has a normalized interactive-element surface in the runtime contract (`RuntimeBrowserPage.elements`). Under this ADR:

- persistent text `snapshot` results should return normalized interactive elements when extractable
- persistent `act` results should also return refreshed elements when the final page is text-addressable
- PDF/image artifact results may keep `elements: []` unless text-page elements are intentionally included later

`includeElements` is a **PersAI-owned behavior**, not a Browserless-native flag. The extraction logic should reuse the same selector-quality approach as the existing ephemeral path where practical, but it must execute within the single-consumer persistent BrowserQL flow, not via a parallel second consumer.

### D4 — Recovery state is structured product truth

The product must distinguish:

- `pending_login`
- `needs_user_reauth`
- `browser_profile_expired`

A transient BrowserQL op failure, reconnect race, 429, or cold session is not enough evidence to tell the user the profile is permanently expired.

The recovery sequence is:

1. detect cold/reconnectable session
2. retry or reconnect inside API/provider policy
3. only if that fails with durable evidence, surface structured re-auth or expired state

The assistant should speak from this structured state, not infer session death from raw provider errors.

### D5 — Web re-auth is modal-first and product-owned

On web:

- the model must not paste Browserless `liveUrl` into chat
- the product opens or reopens the existing profile login modal via `pendingBrowserLogin` or equivalent product state
- a persistent fallback banner above the input may invite the user to continue login if the modal was dismissed or blocked

Re-auth must reuse the existing profile identity where possible. The user should not be forced to invent a new profile name for a session that merely needs login renewal.

Telegram remains a simpler v1 path: no Browserless live modal semantics in-channel. If re-auth is required, the user is directed to `persai.dev` to complete login in web.

### D6 — Parent-orchestrated execution model

This ADR is intentionally executed under the parent-orchestrator model:

- parent agent writes ADR-139 and owns cross-doc reconciliation
- implementation subagents are **GPT-5.4 only**
- each subagent gets one bounded slice
- commits may happen slice-by-slice after focused gates pass
- no push in slice execution because **push = deploy**

### D7 — Live-validation addendum: navigation reliability and scroll (2026-07-07)

Live Lavka acceptance testing on a real persistent profile surfaced two additional defects in the executed capability path, found by reading the actual goto/wait-strategy and operation-kind code, not by assuming a proxy/geo cause:

- **Not a proxy/geo defect.** Two of four navigations in the same live session (over the same sticky residential proxy) reached Lavka's catalog and product pages and rendered a real Russian delivery address. This proves the sticky residential proxy already resolves to a usable Russian-appearing IP; per D2, country-specific forcing (`proxyCountry`) remains intentionally out of scope and is not the blocker.
- **Real defect 1 — unreliable goto wait strategy.** Both the ephemeral `/function` path and the persistent BrowserQL path defaulted `goto`'s wait condition to `networkidle2` / `networkIdle` ("no more than ~2 connections for 500ms"). Browserless documents this condition as "use with caution": real-world pages with persistent background traffic (live-tracking sockets, polling, analytics beacons — exactly what a delivery-ETA app like Lavka's home/search pages run) can hold >2 connections indefinitely and never satisfy it, turning ordinary navigation into a hard failure at the full `timeoutMs` budget. This matched the observed pattern exactly: home and search timed out at 120s; lighter category/product pages (less background traffic) resolved fine. **Fix:** `goto` now always navigates on `domContentLoaded` (never gambles the whole request on network silence) and takes one short, bounded settle step afterward (`waitForTimeout`/`sleep`, 3000ms, skipped when `optimizeForSpeed` is set) to let async JS-rendered content populate before the page is read.
- **Real defect 2 — no scroll capability.** The `act` operation set (`click`, `type`, `press`, `select_option`, `wait_for_selector`, `wait_for_timeout`) had no way to scroll. Virtualized/lazy-loaded grids (e.g. Lavka's catalog, which rendered only an empty-cart placeholder on first load) only populate cards once scrolled into view; nothing in the contract could trigger that. **Fix:** added a `scroll` operation kind (`{ kind: "scroll", selector: string | null }`) — scrolls a selector into view, or scrolls the viewport down by one page height when no selector is given — implemented consistently on both the ephemeral (`page.$eval`/`page.evaluate`) and persistent BrowserQL (`evaluate(content: ...)`, not the native `scroll` mutation, to keep both paths' no-selector semantics identical) execution paths. Prompt-owner guidance in `native-tool-projection.ts` and `tool-catalog-data.ts` now tells the model to use `scroll` before re-reading content when a catalog/feed page renders but shows an empty or placeholder list.

This addendum does not reopen D1–D6 and does not change proxy/stealth policy ownership; it only fixes navigation-reliability and operation-coverage gaps found while validating D2/D3 live. Local only; not pushed as part of this addendum, matching push = deploy.

### D8 — Per-query proxy re-assertion, and a v0 domain-based RU test heuristic (2026-07-07)

Two follow-up questions from the D7 live-validation review:

**Is re-sending `proxy(network: residential, sticky: true)` on every persistent BrowserQL call correct, or wasteful?** Confirmed correct, not redundant, by reading Browserless's own docs: BQL traffic-interception mutations (`proxy`, `reject`, etc.) only take effect "when the query is executing" — each POST to `.../session/bql/{id}` is a discrete query run against the same persisted browser, not a re-connect. Omitting `proxy(...)` on any single call would leak that call's traffic off the residential proxy entirely (defeats stealth for that request), so it must be re-asserted every call. This does **not** rotate the underlying IP: `sticky` is documented as a property of the session's connection lifetime ("routes all requests through the same IP address for the duration of the connection"), so re-declaring the same `network`/`sticky` parameters on a later query re-affirms the existing binding rather than requesting a new one — consistent with the live Lavka evidence in D7 (same Russian-appearing address across multiple calls in one session). Browserless's own guidance is explicit that only _changing_ proxy parameters mid-session (a real rotation) is the high-signal bot tell to avoid; unchanged re-assertion is not that.

**Where does `proxyCountry` come from for prod?** Confirmed via code read: nothing in `apps/api` or `apps/runtime` captures an end user's IP or does IP-geolocation today, and Browserless persistent browser profiles are scoped by `(assistantId, profileKey)` — assistant-owned, not per-end-user — so a single sticky session has no one well-defined "current user" to geo-resolve against, and Telegram's Bot API never exposes end-user IPs to begin with. This makes real per-user IP-based geo-targeting a bigger design question than this ADR's scope (candidates: a platform/assistant-owned static country setting; the existing self-declared `AppUser.countryCode` onboarding field; or new IP-geolocation infra for the web channel only) — **still open, not decided here.**

As an explicit, narrowly-scoped stand-in for live testing only (not a production geo policy), `buildBrowserlessCapabilityPolicyMutations` now resolves a test-only `country: RU` BQL argument from the goto/login target's own hostname (`.ru` / punycode `.рф` → `xn--p1ai` suffix), applied identically on both the persistent `browserAction` and `startLogin` mutation builders so the very first proxy directive on a session already carries the same country as every later one. Any other hostname keeps today's behavior (`country` omitted, Browserless's automatic pool choice). This is a v0 heuristic, not the production answer to the open question above — it must not be read as "geo is solved," and must not be extended to other countries or made non-domain-based without revisiting this decision.

## Implementation slices

| Slice  | Owner            | Deliverable                                                                                                    |
| ------ | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| **S0** | Parent           | ADR-139 plus `AGENTS.md`, `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md` reconciliation |
| **S1** | GPT-5.4 subagent | Contract/API browser capability policy plumbing and focused tests                                              |
| **S2** | GPT-5.4 subagent | Provider-gateway Browserless stealth/proxy wiring and persistent `elements` extraction                         |
| **S3** | GPT-5.4 subagent | Runtime/catalog guidance and pass-through tests                                                                |
| **S4** | GPT-5.4 subagent | Recovery path and modal-first web UX                                                                           |
| **S5** | Parent           | Final focused verification, doc closeout, handoff/changelog updates, residual-risk summary                     |

## Verification

Focused checks for this ADR:

```bash
corepack pnpm --filter @persai/provider-gateway exec tsx test/provider-browser.service.test.ts
corepack pnpm --filter @persai/runtime exec tsx test/runtime-browser-tool.service.test.ts test/native-tool-projection.test.ts
corepack pnpm --filter @persai/api exec tsx test/assistant-browser-profile.service.test.ts test/resolve-pending-browser-login-for-web-chat.test.ts test/extract-pending-browser-login-from-turn.test.ts test/tool-catalog-data.test.ts
corepack pnpm --filter @persai/web exec vitest run app/app/_components/browser-login-modal.test.tsx app/app/_components/chat-area.test.tsx app/app/_components/assistant-settings.test.tsx --config vitest.config.ts
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/runtime run typecheck
corepack pnpm --filter @persai/provider-gateway run typecheck
corepack pnpm --filter @persai/web run typecheck
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
```

Post-deploy live acceptance must prove:

1. persistent profile login still succeeds
2. Browserless accepts the intended stealth/proxy policy, or the failure is explicit and documented
3. persistent `snapshot` returns authenticated text plus non-empty targetable `elements` where appropriate
4. `act` using selectors from `elements` succeeds or returns honest per-operation warnings, never opaque 502
5. cold/reconnectable sessions retry or reconnect before any `expired` narrative
6. web re-auth reopens the existing profile modal or banner without model-pasted Browserless URLs
7. Telegram re-auth sends the user to PersAI web instructions instead of a Browserless live URL

## Risks

- Browserless residential proxy capability may be plan-gated or region-limited.
- Sticky residential introduces cost/latency and should stay persistent-profile-only, not become the default for all ephemeral browser work.
- Persistent BrowserQL is single-consumer; element extraction must not open a second concurrent session consumer.
- Recovery misclassification is a product-trust issue; the API/runtime/web boundary must own it, not ad hoc assistant narration.
- Docs must not drift back to ADR-138's older persistent `/function` wording after this cutover.
- The fixed 3s post-goto settle window (D7) is a bounded heuristic, not a guarantee of full client-side rendering; very heavy infinite-scroll/virtualized pages may still need one or more explicit `scroll` operations from the model before content is fully populated.
- The D8 domain-based `country: RU` heuristic is test-only scaffolding for validating that Browserless's `country` BQL argument works end-to-end; it is not the production geo-targeting design (which end-user/assistant signal to trust for `proxyCountry` remains an open decision) and must not be treated as closing that question.
