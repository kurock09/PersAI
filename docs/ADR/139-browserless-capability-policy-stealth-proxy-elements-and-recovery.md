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

### D9 — Live-validation addendum: `act` opaque 502, and proxy/stealth were never actually engaging (2026-07-07)

Post-deploy live acceptance surfaced two further defects, found by reading the executed code and Browserless's own BQL schema/docs — not by guessing:

**Correction to D7.** D7 read "two navigations reached Lavka's catalog/product pages and rendered a real Russian delivery address" as proof the sticky residential proxy already resolved to a usable Russian IP. That inference was wrong: a saved delivery address is account/profile data, not evidence about the egress IP. Direct inspection (browserleaks, on the exact same profile/session) shows the real IP is a DigitalOcean datacenter address, not residential, on every call — with or without a profile. D7's navigation-reliability and `scroll` fixes stand; its proxy-effectiveness claim does not and is superseded by this addendum.

- **Real defect 1 — `act` operation failures on the ephemeral `/function` path returned an opaque 502 instead of a graceful warning.** `runBrowserActionViaFunction` unconditionally converted the script's caught `error.message` into a fatal `BadGatewayException`, but the script's _only_ outer `try/catch` wrapped goto **and every operation**, so an ordinary "selector not found" `click`/`type` miss — the single most common `act` outcome, since the model is guessing selectors it has not yet verified live — discarded the already-successful navigation and looked identical to a true platform failure. Live-reproduced in isolation on a clean, profile-less `https://example.com` page: `click(selector: "#this-selector-does-not-exist-anywhere")` returned `Provider gateway request failed with status 502.` with zero other diagnostic text. **Fix:** each operation in the `/function` script's loop is now wrapped in its own `try/catch`; a per-operation failure is collected into `result.operationWarning` and the loop continues, so `finalUrl`/`title`/`content`/`elements` from the already-reached page are still returned. `runBrowserActionViaFunction` now reads `data.operationWarning` and folds it into the success `warning` field (mirroring the BQL path's existing `op_*` vs. fatal `splitBqlErrors` classification from the prior audit) instead of throwing. The outer catch now only fires for genuinely fatal goto/setup/extraction failures.
- **Real defect 2 — the persistent-session `proxy()` BQL mutation matched zero requests.** Browserless's `proxy` mutation is a **request-matching filter**, not a session-wide switch: its own docs state "Only requests that match these conditions are proxied and the rest are sent from the instance's own IP address," and every single official example — including the one explicitly titled "using the browserless proxy for **all** requests" — passes an explicit `url: ["*"]` pattern. `buildBrowserlessCapabilityPolicyMutations` sent `proxy(network: residential, sticky: true)` with no `url`/`type`/`method` filter at all, so the mutation was valid GraphQL, executed without any error on every call (which is why it was never caught by testing or by earlier "residential proxies ✅" self-checks that never actually queried a real IP-detection service), and matched nothing — 100% of traffic kept flowing over the browser's native datacenter IP for the life of every persistent session. **Fix:** the mutation now includes `url: ["*"]`, matching Browserless's own "proxy all requests" pattern exactly.
- **Real defect 3 — `stealth: true` at session creation does not mask the User-Agent.** Live inspection showed `Chrome/149.0.0.0 (headless)` verbatim in the UA on a `stealth: true` persistent session. Browserless's docs list "User Agent Masking" as its own distinct capability from the stealth route/fingerprint mitigations stealth actually covers (CDP-detection, canvas/WebGL noise, automation flags) — UA rewriting requires an explicit `userAgent(userAgent: String!)` mutation. **Fix:** `buildBrowserlessCapabilityPolicyMutations` now also emits `userAgent(userAgent: "...Chrome/149.0.0.0 Safari/537.36")` (a desktop string, Chrome major version matched to the fleet's own reported version to avoid a UA/CDP mismatch tell) whenever `capabilityPolicy.stealth` is true, on both the persistent `browserAction` and `startLogin` mutation builders.

Both proxy and UA masking are re-asserted per-BQL-call (per D8), so neither fix requires re-creating/re-logging-in any existing persistent profile — the very next `act`/`snapshot`/`startLogin` call against an existing session already carries the corrected mutations. Post-deploy, browserleaks (or an equivalent IP/UA check) must show a non-datacenter IP and a non-headless UA on the same persistent profile before D2/D3's stealth/proxy claims are considered live-verified; until then, treat those claims as **not yet proven**, superseding D7's premature confirmation.

This addendum does not reopen D1–D6 and does not change proxy/stealth policy ownership; it only fixes the two concrete gaps (a filter argument missing from one GraphQL mutation, and a missing second mutation) that made D2/D3's proxy/stealth wiring a documented-but-inert no-op, plus the `act` opaque-502 classification gap.

### D10 — Post-D9-deploy live acceptance: `act`/UA fixes confirmed live, residential proxy confirmed still inert, zero server-side observability closed (2026-07-07)

Live re-testing against the deployed D9 image (`provider-gateway:8b36fd09...`, confirmed via `kubectl describe pod` — this is genuinely the D9 code running, not a stale rollout) on the same persistent profile (`a-c2df1500`) against `lavka.yandex.ru`:

- **Confirmed fixed:** `act` (`click`/`type`) now completes a full real-world flow — login, search "Байкал", click the "Вода Baikal 450 мл" product, add to cart, cart counter increments — with no 502s. This directly validates D9's per-operation `try/catch`/`operationWarning` fix.
- **Confirmed fixed:** User-Agent masking works — browserleaks/JA4 inspection on the same profile now shows a desktop Windows/Chrome UA string, not `HeadlessChrome`. This directly validates D9's `userAgent()` mutation fix.
- **Confirmed still broken:** the egress IP is unchanged — `164.92.75.107`, DigitalOcean (AS14061), datacenter — identical on two separate live checks taken minutes apart, both after the D9 image was already running. D9's `url: ["*"]` filter fix did not change the observed IP.
- **`press` still returns 400** — this is D9's own intentional `BadRequestException` for persistent sessions (see the "Real defect" list above and the model-facing guidance change), not a regression; it is working as designed, not an open bug.

**Why the IP is still datacenter even though `userAgent()` (same mutation batch, same call) visibly took effect:** GraphQL only nulls the specific field that errors; sibling mutations in the same request (`proxy`, `userAgent`, `goto`, `op_*`) succeed or fail independently. Since the full flow succeeded end-to-end (page content, click, type all returned real data), `splitBqlErrors` did **not** see a fatal, non-`op_`-prefixed error — if `proxy(...)` had thrown a schema/permission error, `runPersistentBrowserActionViaBql` would have thrown `BadGatewayException` and the entire call would have failed, not partially succeeded. So `proxy(network: residential, sticky: true, url: ["*"])` is executing without any GraphQL-visible error and simply not changing the egress path. Browserless's schema has no field on the `proxy` mutation's response (`{ time }` only) that reports whether residential routing was actually granted versus silently skipped, so this cannot be distinguished from provider-gateway's response alone — it is architecturally a black box from inside the mutation result itself.

**Root cause, most likely:** this Browserless token's plan/fleet does not have residential-proxy entitlement provisioned, and Browserless's own implementation treats an unprovisioned `network: residential` request as a silent no-op rather than a hard schema/permission error (consistent with the pre-existing Risk already listed below: "Browserless residential proxy capability may be plan-gated or region-limited"). This is an account/billing-plane question, not a remaining code defect — verifying it requires checking the Browserless dashboard's plan/add-ons page (or the enterprise `exportMetrics`/`accountStatus` GraphQL API, which needs a **separate** Browserless _account_ API token, distinct from the fleet's browser-automation token already stored as this tool's credential) for whether "Residential Proxy" is an active line item, which is outside what provider-gateway's own request/response can prove either way.

**Observability gap closed:** `ProviderBrowserService` had zero logging before this change — `kubectl logs` on the live provider-gateway pods showed nothing but NestJS route-registration lines from pod startup for the entire test window, which is why this investigation had to rely entirely on external browserleaks checks instead of server-side evidence. Added a debug-level log line per persistent BQL call (profile id, whether a proxy/stealth policy is present, operation count) and an unconditional warn-level log of every `errors[]` entry (`path` + `message`) _before_ fatal/warning classification, so a future silently-executing-but-ineffective mutation (or any other BQL-level error) is visible in `kubectl logs` without needing an external IP/fingerprint check to notice it.

**Practical outcome:** the datacenter IP did not actually block the tested Lavka flow once the session was authenticated — the full add-to-cart cycle succeeded on the datacenter IP. This further disproves the earlier "Lavka hard-blocks without a residential/RU IP" theory (already partly walked back in D7/D9): IP-based blocking on this target, if it exists at all, is not an unconditional block on an authenticated persistent session's ordinary browse/search/cart flow.

### D11 — Element-extraction ranking and act chaining, from model-observed friction on the same live Lavka session (2026-07-07)

After the D10 add-to-cart success, the model reported two friction points from the same live session. Both were verified against the executed code (not taken at face value) before deciding what to fix.

- **Real defect — the 25-element cap had no visibility ranking.** `BROWSERLESS_INTERACTIVE_ELEMENTS_EVALUATE_SCRIPT` and `BROWSERLESS_FUNCTION_CODE`'s `collectElements` both ran `document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"]')` in plain document order and sliced to the first `MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS` (25) with no visibility or relevance filtering at all. On an ordinary e-commerce page, the first N interactive elements in DOM order are header/nav/logo/search-icon/cart-icon/category-menu chrome, not the catalog/product content further down the tree — live-confirmed on Lavka's search results, where product add-to-cart controls never made it into the unfiltered top-25 even though the products were visibly rendered in `content`. Raising the number alone would have been a blunt fix (still no guarantee on a page with more chrome than the new cap, plus token cost on every extraction). **Fix:** both scripts now filter to currently-visible elements (`element.getClientRects().length > 0` and computed `visibility`/`display` not hidden) _before_ the top-N cap is applied, removing most non-visible chrome (off-screen drawers, `display:none` menus, `visibility:hidden` nodes) ahead of the cap instead of after it. `MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS` is also raised from 25 to 60 in `packages/runtime-contract` as a safety margin for pages with a lot of visible nav/chrome ahead of the useful content, and the ephemeral path's previously-hardcoded literal `25` (a parity bug — it never actually read the shared constant) now interpolates the same constant as the persistent path.
- **Not a code defect — operation chaining was already supported but underused.** The model believed `act` required one operation per call (click → snapshot → click) and asked for a way to send `[click, type, press, click]` in one call. Reading the actual schema and executor: `operations` is already an array (`maxItems: MAX_RUNTIME_BROWSER_OPERATIONS` = 6) with an existing `wait_for_selector` operation kind, and both execution paths already run every operation in a single call/request (BQL: sibling `op_N` mutation fields in one query; `/function`: a single in-order loop, each step now independently caught per D9) — nothing architectural stopped a chain like `[click(search result), wait_for_selector(#add-to-cart), click(#add-to-cart)]` from working today. The actual gap was that the model-facing `operations` description never told the model this was safe or expected — it read as "one bounded operation," implicitly nudging toward one-call-per-step plus a defensive snapshot in between. **Fix:** the `operations` schema description (`native-tool-projection.ts`) and catalog guidance (`tool-catalog-data.ts`) now explicitly say steps run in order within a single call and instruct inserting `kind="wait_for_selector"` right after any step that opens new content (click that loads a product page, expands a panel, triggers client-side navigation), then continuing the chain in the same call instead of stopping for a separate snapshot. `press` remains excluded from that guidance's example chains for saved profiles per D9's existing prohibition — this addendum does not reopen that decision.

Both fixes stay inside ADR-139's existing S2 (provider-gateway Browserless stealth/proxy + persistent `elements` extraction) scope; no new ADR was opened.

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
- D9's UA-mask fix is now live-verified (D10): non-headless UA confirmed via browserleaks/JA4 on the live persistent profile. D9's proxy `url: ["*"]` fix is live-verified as _executing without error_ but is **not** live-verified as _effective_ — the egress IP remains an unproxied datacenter address on the same profile after deploy (D10). Treat "residential proxy actually changes the egress IP" as an open, unresolved, most-likely-plan-gated question, not a code defect to keep re-attempting in this file — see D10's root-cause analysis before spending further engineering time here.
- D9's `url: ["*"]` proxy filter proxies every request on the session, including ones a narrower filter (specific `type`/`method`) might have intentionally excluded for cost/latency; if per-request-type proxy scoping is ever needed, revisit this as a deliberate decision, not a silent broadening.
- D10 added the first server-side logging (`ProviderBrowserService`) for persistent BQL calls; this is diagnostic-only (debug/warn `kubectl logs` lines) and does not change any request/response behavior.
- D11's visibility filter (`getClientRects().length > 0` + non-hidden computed style) is a heuristic, not a true viewport/relevance ranking — it removes off-screen/hidden chrome but does not prioritize "above the fold" or "closest to page center" content; a page with more than 60 visible interactive elements ahead of the useful ones can still miss them. If that turns out to matter live, the next step is viewport-distance ranking, not just raising the cap again.
- D11's chaining guidance is a prompt/schema change only — it does not change `MAX_RUNTIME_BROWSER_OPERATIONS` (still 6) or add any new operation kind; live acceptance should confirm the model actually adopts multi-step chains instead of continuing its prior one-op-per-call habit before this is considered resolved.
