# ADR-140: Local browser bridge execution plane and Browserless headless-only cutover

## Status

**Open** — parent-orchestrated implementation program. Parent agent owns ADR, audit reconciliation, and final doc gate. Implementation is delegated slice-by-slice to **GPT-5.4** subagents only.

**Direct cutover, no transitional path.** No feature flags, no parallel `useLocalBridge` mode, no dual code branches. Platform has no external commercial users at cutover time; one clean pull-request series replaces the persistent Browserless plane with the local bridge in a single ordered set of slices.

**Supersedes and closes:** ADR-138 (persistent Browserless profiles / live login) and ADR-139 (Browserless capability policy, stealth/proxy, persistent BQL elements, recovery) for all persistent cloud session truth. ADR-138/139 remain archive references only after this program closes.

## Date

2026-07-08

## Baseline SHA

`aa2ad2ef` on `main` (post ADR-139 host-script + stayOnPage fixes). Implementation subagents start only from a **clean git tree** on the orchestrator branch.

## Founder-locked decisions

| # | Decision | Locked answer |
| --- | --- | --- |
| 1 | Tool surface | **Single** model-facing `browser` tool — same actions, same catalog vocabulary; execution plane changes under the hood |
| 2 | Session ownership | **Per-assistant** `(assistantId, profileKey)` — unchanged product model |
| 3 | Where cookies live | **On the user's device** — Chrome cookie store for the extension window; `WKWebsiteDataStore` (iOS) / `CookieManager` (Android) scoped per `profileKey` for Capacitor. PersAI database stores only the profile card (`profileKey`, `displayName`, `originHost`, status, TTL). One login lasts days until the site itself invalidates the cookie. |
| 4 | Bridge window visibility | **Hidden by default.** Assistant work runs in background — user never sees the automated tab / WebView. Window becomes visible only when the assistant explicitly asks the user to help (captcha, re-auth, payment confirmation) or when the user opens it from settings. |
| 5 | Browserless role | **Headless ephemeral only** — fast public `snapshot` / `screenshot` when **no** `profile` and no saved session. No persistent sessions, BQL profiles, stealth/proxy, live URLs. |
| 6 | Web desktop bridge | **Chrome extension**, Manifest V3 |
| 7 | Mobile bridge | **Production Capacitor native plugin** `persai-browser-bridge` (repo `persai-mobile`), WKWebView on iOS + WebView on Android |
| 8 | Web without extension | Model returns structured `bridge_unavailable`; assistant honestly explains and modal shows Chrome Web Store install CTA |
| 9 | Permissions | `optional_host_permissions` in extension manifest; native Chrome permission prompt per domain at first `login`. No universal `<all_urls>`. |
| 10 | Billing | Local bridge is **free** — no `billingFacts` emitted. Only headless Browserless is billed as today. |
| 11 | Telegram | Public page `persai.dev/link/browser-login/:oneTimeToken` — same UX as web modal, uses the same bridge (extension flow triggered inside the public page). |
| 12 | Existing DB profiles | Migrated to `status = expired`; rows kept (preserve `displayName` + `originHost` cards). `provider_session_id` and `live_url` columns dropped. |
| 13 | Delivery | **One direct cutover** — ordered slices without a compatibility window |

### Explicitly rejected

- Parallel execution paths (Browserless persistent **and** local bridge coexisting under a flag)
- Storing cookies in PersAI database or GCS
- Model-owned proxy / stealth / recovery narration (ADR-139 cloud policy model)
- Browserless live URL iframe proxy stack (`server.mjs` WS upstream to Browserless)
- `chrome.debugger` API (yellow "debugger attached" banner, Chrome Store friction)
- Universal `<all_urls>` extension permissions
- Second browser provider in this program
- Blocking chat when the bridge is unavailable — chat always works, `browser` returns structured error instead

## Orchestration model

- **Parent agent** owns ADR-140, audit, slice dispatch, diff review, verification gates, doc reconciliation (`ARCHITECTURE`, `API-BOUNDARY`, `DATA-MODEL`, `TEST-PLAN`, `AGENTS.md`, `CHANGELOG`, `SESSION-HANDOFF`).
- **Implementation subagents** (GPT-5.4): one slice per task; no scope expansion.
- Parent does not land implementation code except ADR + orchestration docs.
- Cycle: assign slice → implement → focused tests → parent audit → next slice.
- **Push = deploy** remains founder-controlled; slices commit locally per slice.

## Context

### Problem (why cut Browserless persistent sessions)

Cloud persistent Browserless introduced a class of non-product failures that no in-provider fix eliminates: residential proxy no-op behavior, datacenter IP leak, BQL 502 / schema drift, 429 queue pressure, SPA hydrate races in a foreign browser, stealth / User-Agent leaks, WebSocket fragility of `liveUrl` proxying, false "profile expired" narratives from transient transport errors. These are infrastructure tax on flows that inherently require the user's own browser context — logged-in shopping, CRM, portals.

The correct architecture: PersAI does not host the user's logged-in browser. PersAI uses the local browser as **execution runtime** and exposes a limited automation bridge (DOM / accessibility / whitelisted operations) to the model.

### Audit summary (2026-07-08, baseline `aa2ad2ef`)

Read-only inventory of the current stack:

| Layer | Dominant surface | Direction |
| --- | --- | --- |
| `provider-gateway/src/modules/providers/provider-browser.service.ts` | ~3,150 LOC; persistent BQL + session lifecycle ≈ 60% | Cut BQL + session methods; keep ephemeral `/function` + REST screenshot/pdf |
| `apps/api/src/modules/workspace-management/application/assistant-browser-profile.service.ts` | Full profile lifecycle, calls Browserless port | Rewrite: bridge handshake, drop Browserless port entirely |
| `apps/runtime/src/modules/turns/runtime-browser-tool.service.ts` | Persistent queue, transport retry, `capabilityPolicy` plumbing | Rewrite: bridge client, no queue for local (device serializes) |
| `apps/web/app/app/_components/browser-login-modal.tsx` | `<iframe src={liveUrl}>` from Browserless | Rewrite: local bridge view (extension-controlled window / Capacitor WebView) |
| `apps/web/server.mjs`, `browser-login-live/**` routes, `browser-login-live-proxy.ts` | Browserless WS proxy stack | Delete |
| `packages/runtime-contract` | `PersistentBrowserCapabilityPolicy`, PG session types | Delete Browserless-specific types |
| `apps/api/prisma/schema.prisma` `AssistantBrowserProfile` | `provider_session_id`, `live_url` fields | Migration drops both columns; adds `bridge_session_ref` |
| `scripts/browser-sites/` | Host scripts, registry | Keep — reused by bridge executor and headless path |
| Tests: 11 dedicated files | Persistent Browserless coverage | Rewrite against local bridge + headless-only |

**Reusable without change:**

- Host script registry and `lavka.yandex.ru.js`
- Interactive elements pipeline (visibility filter → rank → cap 200 → host script merge)
- DOM-ready wait heuristic (max 10s, early exit on body text or visible controls)
- Operation kinds (`goto`, `click`, `type`, `hover`, `extract`, `scroll`, `wait_for_selector`, `click_at`, etc.) — the executor logic today already lives in one JavaScript block `BROWSERLESS_FUNCTION_CODE` and ports directly to the bridge

## Decision

### D1 — Two execution backends, one tool

```
browser tool (model)
       │
       ▼
RuntimeBrowserToolService  ── router ──┬─► LocalBrowserBridgeClient  (profile set OR login/act needing session)
                                       │
                                       └─► HeadlessBrowserlessExecutor  (no profile, fast public read/screenshot)
```

Selection rule:

| Condition | Backend |
| --- | --- |
| `profile` present, or `action ∈ {login, open_live, list_profiles}`, or `act` / `snapshot` that requires assistant session | **Local bridge** |
| `profile` omitted, public URL, no cookies needed, one-shot snapshot / screenshot / PDF | **Browserless ephemeral** |

Model sees one `browser` tool. Runtime picks the backend; the model is not told to choose.

### D2 — Local bridge protocol (v1)

**Transport per client:**

- **Chrome extension (desktop web):** persistent WebSocket from extension service worker to API bridge relay. The port also keeps the MV3 service worker alive across long-running assistant sessions (standard MV3 pattern).
- **Capacitor plugin (mobile):** same WebSocket namespace from the app-side JavaScript, forwarded to the native plugin over Capacitor bridge, then executed inside WKWebView / WebView.

**Auth:**

- Extension: bound to the user's Clerk session; on install and on each Chrome launch the extension calls `POST /api/v1/assistant/browser-bridge/devices` with a Clerk-signed request to register a `bridgeDeviceId`.
- Capacitor: same endpoint, called from the native app on first launch.
- Bridge relay accepts a WebSocket connection only with a valid Clerk-signed device token; per-workspace rate limit; one active WebSocket per `(workspaceId, assistantId, deviceId)`.

**Command envelope (cloud → device):**

```typescript
type LocalBrowserCommand = {
  commandId: string;
  profileKey: string;
  action: "navigate" | "snapshot" | "act" | "open_view" | "close_view";
  url?: string;
  stayOnPage?: boolean;
  operations?: RuntimeBrowserOperation[];
  format?: "text" | "png" | "jpeg" | "webp" | "pdf";
  optimizeForSpeed?: boolean;
  timeoutMs?: number;
  showWindow?: boolean; // true only when assistant asks user to help
};
```

**Result envelope (device → cloud):**

```typescript
type LocalBrowserResult = {
  commandId: string;
  ok: boolean;
  finalUrl?: string;
  title?: string;
  content?: string;
  truncated?: boolean;
  elements?: RuntimeBrowserInteractiveElement[];
  extracted?: RuntimeBrowserExtractedItem[];
  warning?: string;
  artifact?: { mimeType: string; base64: string };
  errorReason?: string;
};
```

**Execution pipeline inside the device** (port of current `BROWSERLESS_FUNCTION_CODE`):

1. Resolve target: existing tab / WebView for `profileKey`, or new hidden one.
2. Navigate (or stay on page if `stayOnPage`).
3. Platform DOM-ready wait (max 10s, early exit on body text or visible controls).
4. Host script evaluate (`scripts/browser-sites/`).
5. Generic interactive elements collector with visibility filter + ranking + cap 200.
6. Merge host-script elements over generic when non-empty.
7. Operation loop, at most 12 operations, each in its own try/catch — per-operation warnings, not fatal.
8. Re-read page state (title / text / elements / artifact) after mutations.

**Window visibility rule:** default is hidden.

- **Chrome extension:** window opens with `chrome.windows.create({ state: "minimized" })`. When `showWindow: true` or the user opens it from settings, extension calls `chrome.windows.update({ state: "normal", focused: true })`.
- **Capacitor plugin:** WebView is created with `hidden = true`. On show, the plugin overlays it as a full-screen modal above the PersAI app content. On dismiss, WebView is hidden again but not destroyed — cookies stay resident.

### D3 — Assistant browser profiles (cookies on device, card in DB)

`AssistantBrowserProfile` table keeps its cards and lifecycle, with these field changes:

| Field | New truth |
| --- | --- |
| `id`, `assistantId`, `workspaceId`, `profileKey`, `displayName`, `loginUrl`, `originHost`, `status`, `lastUsedAt`, `expiresAt`, `originatingChatId`, `createdAt`, `updatedAt` | Keep unchanged |
| `providerSessionId` | **Drop column** |
| `liveUrl` | **Drop column** |
| `bridgeSessionRef` | **New column** — opaque handle returned by the device after successful `login` (e.g. extension window id + tab id + cookie store key on desktop; WebView instance id on mobile). PersAI never inspects the value beyond routing. |

**Where cookies live:**

- Chrome extension: cookies live in Chrome's cookie store for the isolated window opened by the extension. Chrome persists them between browser restarts by default. Extension does not export cookies to PersAI.
- Capacitor iOS: `WKWebsiteDataStore` persisted per `profileKey`. Cookies survive app restarts.
- Capacitor Android: WebView + `CookieManager` per-instance, backed by disk storage keyed on `profileKey`.

**One login lasts as long as the site itself keeps the cookie valid** — typically many days or weeks. PersAI does not re-login on every command.

TTL scheduler (`ExpireAssistantBrowserProfilesService`, lease `browser_profile_expiry`) keeps its role: profiles that go untouched for the plan TTL (30d default, 90d on higher plans) move to `expired` and require re-login. This is a PersAI product timer, not a Browserless timer.

### D4 — `login` / `open_live` / modal UX

| Step | Behavior |
| --- | --- |
| Model calls `browser({action:"login", loginUrl, displayName})` | API creates or updates `pending_login` row; runtime emits `pendingBrowserLogin` in the turn stream |
| Web chat SSE | Auto-opens `BrowserLoginModal` (trigger unchanged) |
| Modal (extension present) | Modal instructs Chrome to open the profile window visibly on `loginUrl`; user completes login and captchas manually |
| Modal (extension absent, desktop web) | Modal shows install CTA with Chrome Web Store link; after install, extension announces itself to the open PersAI tab through `externally_connectable`, modal transitions to normal login flow |
| Modal (Capacitor) | Native plugin overlays WebView visibly on `loginUrl`; user completes login |
| User presses **«Готово»** | Bridge verifies the domain is reachable and cookies are set (host-scripted check on `originHost`); API `completeLogin` → status `active`; `bridgeSessionRef` written; window / WebView goes back to hidden |
| Later `snapshot` / `act` with `profile` | Runs invisibly in the same hidden window / WebView; cookies already present |
| `open_view` action (assistant asks user to help) | Sets `showWindow: true`; window / WebView becomes visible over the app; user acts; presses «Готово» to return to background |
| Settings site card click | User-initiated `open_view` |

`pendingBrowserLogin` SSE shape keeps `profileKey`, `displayName`, `loginUrl`, `completionMode`. Drops `liveUrl`. Adds `bridgeClientKind` (`extension` / `capacitor`) so the modal can render the right instructions.

### D5 — Headless Browserless (retained, trimmed)

**Keep in `provider-gateway/src/modules/providers/provider-browser.service.ts`:**

- Ephemeral `browserAction` via `/function` when no profile is set
- `browserPdfViaRest` / `browserScreenshotViaRest` for headless artifacts without profile
- `HostBrowserScriptRegistryService` and host-script evaluate on the ephemeral path (optional for public hosts)

**Delete:**

- `runPersistentBrowserActionViaBql` and every BQL mutation builder
- `startLogin`, `openLiveSession`, `verifySession`, `deleteSession`
- `fetchPersistentSessionBqlJson`, `enqueuePersistentSessionBql`, `persistentSessionBqlTail`
- `buildBrowserlessCapabilityPolicyMutations`, stealth / proxy / userAgent BQL, `PersistentBrowserCapabilityPolicy`
- `resolveBrowserlessSessionCreateEndpoint`, `*BqlEndpoint`, `*StopEndpoint`, `persistingSessionPath`, `isPersistingSessionProviderSessionId`, `assertPersistingProfileSessionId`
- Controller routes: `browser-session/start-login`, `delete`, `verify`, `open-live`

Ephemeral path retains `stayOnPage`, `hostPageScript`, `reuseSession` because it uses the same `BROWSERLESS_FUNCTION_CODE` block; no rewrite of that block is required for headless.

### D6 — Runtime

Delete:

- `persistentBrowserActionTail`, `enqueuePersistentBrowserAction`
- `capabilityPolicy` field on outgoing `ProviderGatewayBrowserActionRequest`
- `browserActionWithTransportRetry` tuned for BQL 429

Add:

- `LocalBrowserBridgeClient` — sends `LocalBrowserCommand` over the API internal bridge, awaits `LocalBrowserResult`, converts to the runtime tool result shape.

Keep:

- `readOperations` and argument validation
- `writeRuntimeOutboundArtifact` for PDF / PNG
- `list_profiles` action (now reads DB only)
- Tool result sanitization (`redactBrowserLiveUrlFields` becomes a no-op removed with `liveUrl`)

### D7 — Web deletion list

| Path | Action |
| --- | --- |
| `apps/web/server.mjs` — Browserless WS upstream proxy | Delete the WS upstream block; server keeps its normal role |
| `apps/web/app/api/browser-login-live/**` | Delete |
| `apps/web/app/api/internal/browser-login-live-upstream/**` | Delete |
| `apps/web/app/lib/browser-login-live-proxy.ts` | Delete |
| `apps/web/app/app/browser-login-live-url.ts` | Delete |
| `apps/web/middleware.ts` public exceptions for the routes above | Delete |
| Related tests | Delete |
| `apps/web/app/app/_components/browser-login-modal.tsx` | Rewrite: no iframe, no `liveUrl`; show install CTA if extension absent, otherwise show status of the extension-controlled window |
| `apps/web/app/app/_components/assistant-settings.tsx` — site cards | Rewrite reconnect / open / delete actions to call the bridge |

### D8 — Mobile (Capacitor native plugin)

Repository: `C:\Users\alex\Documents\persai-mobile` (existing, hosts `apps/web` Capacitor build).

New plugin package inside that repo: `persai-browser-bridge`.

- **iOS:** Swift plugin. `WKWebView` per profile with `WKWebViewConfiguration.websiteDataStore` = a persistent store keyed on `profileKey`. `evaluateJavaScript` for command execution.
- **Android:** Kotlin plugin. `WebView` per profile with `CookieManager` and `WebStorage` scoped by an isolated app-directory subfolder keyed on `profileKey`. `evaluateJavascript` for command execution.
- Native side owns the WebView lifecycle: created hidden on first use, kept alive between commands, released when profile is deleted or explicitly cleaned.
- WebView is shown as a full-screen native overlay on `showWindow`; hidden again on «Готово» or dismiss.
- Same `LocalBrowserCommand` / `LocalBrowserResult` protocol as the extension — the API bridge relay does not distinguish clients beyond the `bridgeClientKind` string.

**Parity contract:** extension and mobile bridge produce identical `LocalBrowserResult` shape for the same command (differences only in timing).

### D9 — Desktop web (Chrome extension)

New repository / package: `persai-browser-extension` (inside PersAI monorepo under `extensions/` or as a peer to `apps/web`).

- **Manifest V3.**
- `background.js` service worker: WebSocket to bridge relay, keep-alive via long-lived port to popup / options page, command dispatch to content scripts.
- Content scripts injected on demand via `chrome.scripting.executeScript` per target tab — only after the user has granted the host permission for that origin.
- No `chrome.debugger` (avoids the "debugger attached" browser banner).
- No universal `<all_urls>` in the manifest — `optional_host_permissions` only.
- On first `login` for a new origin, extension calls `chrome.permissions.request({ origins: ["https://the-domain/*"] })` — the Chrome native permission prompt appears once, user approves the domain, and PersAI stores that approval as part of the profile card.
- One profile → one dedicated window (`chrome.windows.create({ type: "popup" })`), hidden by default. Window state is remembered by extension local storage keyed on `profileKey`.
- The extension links itself to the PersAI web tab through `externally_connectable` in the manifest listing PersAI web origins; PersAI web detects extension presence and drops the "install CTA" state.

### D10 — Telegram (public login page)

Telegram cannot host the extension flow. Instead:

- When Telegram-channel turn produces `pendingBrowserLogin`, the outbound message includes a link to `https://persai.dev/link/browser-login/:oneTimeToken`.
- The public page is a thin PersAI web route (no Clerk sign-in required for the initial land) that:
  1. Verifies the one-time token, resolves to `(assistantId, profileKey, loginUrl)`.
  2. Shows the same modal UX as the in-chat modal.
  3. Requires the extension (offers install CTA if absent).
  4. Completes the flow via the same `completeLogin` API.
- Token is single-use, short TTL (~15 minutes), and burns on first successful `completeLogin`.

Ordinary Telegram web chat replies never leak Browserless-style URLs — that class of URL no longer exists.

### D11 — Billing

- **Local bridge:** free. No `billingFacts` emitted. Runtime skips ledger emission when the bridge backend is chosen.
- **Headless Browserless:** billed per today (`buildToolPathTimeBillingFacts` with `providerKey = "browserless"`).
- Tool-path pricing catalog keeps its `browser` row; catalog value applies only to the headless path.

### D12 — DB migration

Single Prisma migration:

- Drop columns `provider_session_id`, `live_url` from `assistant_browser_profiles`.
- Add nullable text column `bridge_session_ref`.
- Add nullable text column `bridge_client_kind` (`extension` / `capacitor`).
- Update all existing rows: `status = 'expired'`, `bridge_session_ref = NULL`, `bridge_client_kind = NULL`.
- Add index `assistant_browser_profiles_bridge_session_ref_idx` (nullable, for future lookups).

Application-level: `AssistantBrowserProfileService` filters out profiles with `bridge_session_ref = NULL` when the runtime asks whether a profile is usable — model receives a structured "needs re-login" state, not a false-positive `active`.

### D13 — Contract changes (`packages/runtime-contract`)

Remove:

- `PersistentBrowserCapabilityPolicy`, `PersistentBrowserProfileIdentity`, proxy enums
- `ProviderGatewayBrowserActionRequest.profileSessionId`
- `ProviderGatewayBrowserActionRequest.capabilityPolicy`
- `ProviderGatewayBrowserSessionStartLoginRequest`, `*Delete`, `*Verify`, `*OpenLive` and their result types
- `PERSAI_RUNTIME_BROWSER_PROVIDER_IDS = ["browserless"]` — replace with `["browserless", "local_bridge"]` for the internal routing enum only; catalog and model contract stay one `browser` tool

Add:

- `LocalBrowserCommand`, `LocalBrowserResult`
- `LOCAL_BROWSER_BRIDGE_DEVICE_KINDS = ["extension", "capacitor"]`
- Bridge relay HTTP + WebSocket schemas (device register, WS connect, command dispatch endpoints)

Adjust:

- `PendingBrowserLoginState` — drop `liveUrl`, add `bridgeClientKind`
- `RuntimeBrowserLoginResult` — same

Regenerate OpenAPI and `packages/contracts` after the change.

## Implementation slices (direct cutover)

Ordered. Each slice compiles green; the program does not go through a state where `browser` with a profile "half works". The compile-green guarantee is achieved by landing bridge and cut together in slices S6–S8 as a single logical step across multiple commits.

### S0 — Contract freeze

Update `packages/runtime-contract` per D13. Regenerate contracts. Update `API-BOUNDARY.md` / `DATA-MODEL.md` stubs (full closure in S12).

**Gate:** `runtime-contract` typecheck; `packages/contracts` generate clean.

### S1 — Bridge relay (API)

New module `apps/api/src/modules/browser-bridge/`:

- Device registration endpoint (`POST /api/v1/assistant/browser-bridge/devices`)
- WebSocket relay endpoint (`/api/v1/assistant/browser-bridge/ws`)
- Internal command endpoints for runtime (`POST /api/v1/internal/runtime/browser-bridge/dispatch`, `GET .../result/:commandId`)
- Command correlation, timeouts, per-workspace / per-assistant rate limits

No Browserless imports anywhere in this module.

**Gate:** module unit tests, WS handshake and command echo covered.

### S2 — Chrome extension MVP

New workspace package (chosen path in this slice): either `extensions/persai-browser-extension/` or a sibling repo — parent decides based on repo hygiene review during slice kickoff.

- Manifest V3, `background.js` service worker, keep-alive port
- WebSocket client to S1 relay, authenticated with Clerk session token pulled through PersAI web page via `externally_connectable`
- Command executor porting `BROWSERLESS_FUNCTION_CODE` block (navigate, DOM-ready wait, host script, elements, operations, extract, snapshot, screenshot, PDF)
- Popup window per profile, hidden by default
- Host permission request flow (`chrome.permissions.request`)
- Local storage for `profileKey` → `windowId` / `tabId` / `cookieStoreId`

**Gate:** extension unit tests (executor + host permission logic); manual smoke check on Lavka login end-to-end.

### S3 — Capacitor native plugin

New plugin `persai-browser-bridge` in `C:\Users\alex\Documents\persai-mobile`:

- iOS Swift: WKWebView with persistent `WKWebsiteDataStore` per `profileKey`
- Android Kotlin: WebView + `CookieManager` scoped per `profileKey`
- Same executor as S2 (JavaScript block shared through a small NPM package or copy-in; parent decides in slice kickoff)
- Native overlay show / hide, hidden by default
- Same WebSocket protocol as extension

**Gate:** plugin unit tests; manual Android smoke check on Lavka login.

### S4 — Runtime rewrite

- Delete `persistentBrowserActionTail`, `enqueuePersistentBrowserAction`, `capabilityPolicy` from `runtime-browser-tool.service.ts`
- Add `LocalBrowserBridgeClient` and route `browser` calls per D1
- Update `native-tool-projection.ts` and `apps/api/prisma/tool-catalog-data.ts` — drop BQL / proxy / serialization guidance; add local-bridge semantics (hidden window, one login, host scripts, act chaining)
- Update `persai-internal-api.client.service.ts` browser profile methods

**Gate:** `runtime-browser-tool.service.test.ts`, `native-tool-projection.test.ts`, `seed-tool-catalog.test.ts`.

### S5 — API profile service rewrite + DB migration

- Prisma migration per D12
- Rewrite `AssistantBrowserProfileService` — no Browserless calls; `startLogin` / `completeLogin` / `openLive` orchestrate the bridge
- Rewrite controllers and internal runtime endpoints
- Rewrite `expire-assistant-browser-profiles.service.ts` — send bridge close command instead of Browserless `deleteSession`
- Delete `browserless-session.port.ts`, `browserless-provider-gateway.client.ts`, `provider-browserless-session.port.ts`
- Delete module wiring in `workspace-management.module.ts`

**Gate:** `assistant-browser-profile.service.test.ts`, `expire-assistant-browser-profiles.service.test.ts`, migration check.

### S6 — Provider-gateway cut

- Delete all persistent BQL code, session lifecycle methods, capability policy, BQL queue from `provider-browser.service.ts`
- Delete session routes from the controller
- Trim `provider-browser.service.test.ts` to headless-only + host registry coverage
- Delete `scripts/dev/browserless-residential-proxy-smoke.mjs`

**Gate:** `@persai/provider-gateway` full tests + typecheck; repo-wide grep confirms zero references to `runPersistentBrowserActionViaBql`, `startLogin`, `openLiveSession`, `PersistentBrowserCapabilityPolicy` outside the ADR archive.

### S7 — Web rewrite

- Delete all files listed in D7
- Rewrite `browser-login-modal.tsx` — no iframe; extension install CTA when absent; bridge-view controls when present
- Rewrite `use-chat.ts` — `pendingBrowserLogin` without `liveUrl`
- Rewrite `stream-web-chat-turn.service.ts` — same
- Rewrite site cards in `assistant-settings.tsx` — bridge reconnect / open / delete
- Update `assistant-api-client.ts` bridge endpoints

**Gate:** `browser-login-modal.test.tsx`, `chat-area.test.tsx`, `assistant-settings.test.tsx`, `use-chat.test.tsx`.

### S8 — Telegram public login page

- New route `apps/web/app/link/browser-login/[token]/page.tsx`
- Token issuance endpoint in API
- Reuse modal component
- Update `telegram-channel-adapter.service.ts` and `appendTelegramBrowserLoginLink` to emit the new link shape

**Gate:** public-page render test; token issuance / burn test.

### S9 — Doc closure + program gate

- Close ADR-138, ADR-139 in ADR headers ("**Superseded by ADR-140**")
- Update `AGENTS.md` active programs list
- Full workspace lint, format, typecheck, test, test:step2, build
- Live manual acceptance:
  - Desktop web + Chrome extension: login Lavka, hide window, chat drives `snapshot` and `act` in background, `open_view` opens window on demand
  - Android via `persai-mobile`: same flow
  - Telegram: link → public page → login → chat reply returns
- `CHANGELOG` and `SESSION-HANDOFF` updated

**Gate:** verification matrix (below) fully green.

## Verification matrix

| Scenario | Backend | Expected |
| --- | --- | --- |
| Public URL snapshot, no profile | Headless Browserless | Text + elements; no modal; billing recorded |
| Public URL screenshot / PDF, no profile | Headless Browserless REST | Artifact; no modal; billing recorded |
| `login` on desktop web with extension | Local bridge (extension) | Modal → visible profile window → user completes → status `active`, `bridge_session_ref` set |
| `login` on desktop web without extension | (no execution) | Modal shows install CTA; after install and refresh, login proceeds |
| `login` on Capacitor | Local bridge (Capacitor) | Modal → visible WebView overlay → user completes → status `active` |
| `snapshot` with active profile, background | Local bridge, hidden window | Text + elements from real logged-in page; no visible UI change |
| `act` chain with active profile, background | Local bridge, hidden window | Ops executed in real session; per-op warnings ok; no visible UI change |
| Assistant asks for user help mid-flow (captcha) | `open_view` | Window / WebView becomes visible; user acts; assistant continues |
| User opens site card from settings | User-initiated `open_view` | Window / WebView becomes visible; login state preserved |
| Existing DB profile after migration | (no execution) | Status `expired`; user prompted to re-login on next assistant use |
| Profile TTL expiry (30d idle) | Scheduler + bridge close | Row → `expired`; on-device cookies of that profile may be cleared by the bridge close command |
| Telegram `browser` with profile | Public login page | Message includes `persai.dev/link/browser-login/:token`; page completes on any device |
| `browser` with no headless option and no bridge | Structured error | Model receives `bridge_unavailable`; assistant explains without hallucinating |

## Risks and residuals

- **Extension install friction on desktop web.** Mitigated by never blocking chat and by clear install CTA in the modal. Users who refuse install still get honest structured errors.
- **Chrome Web Store review lead time.** Extension publishing may take days for the first submission. S2 lands the code; store publication is a separate operational step tracked in `SESSION-HANDOFF`.
- **iOS App Store review** for the new Capacitor plugin. Same operational note applies to `persai-mobile`.
- **Multi-device users** (one user, one assistant, extension on both work laptop and home laptop) are out of scope in v1 — the first device to register a `bridgeDeviceId` for a profile wins; second device gets a "profile in use elsewhere" state. Revisit in a later ADR if needed.
- **CI does not run the extension.** E2E remains a manual step after slice S9 until a follow-up ADR adds Playwright-with-extension coverage.

## References

- Superseded by: —
- Supersedes: `docs/ADR/138-browser-persistent-profiles-and-live-login.md`, `docs/ADR/139-browserless-capability-policy-stealth-proxy-elements-and-recovery.md`
- Audit baseline: commit `aa2ad2ef`; cluster logs 2026-07-08 (`hostPageElements` GraphQL stringify, `stayOnPage` unused `$url`)
- Reuse targets: `scripts/browser-sites/`, `BROWSERLESS_FUNCTION_CODE` operation executor, DOM-ready wait heuristic, interactive-elements ranking + visibility filter, `RuntimeBrowserOperation` schema
