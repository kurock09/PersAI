# ADR-140: Local browser bridge execution plane and Browserless headless-only cutover

## Status

**Implemented locally through S8; closed locally 2026-07-08.** Parent-orchestrated implementation is complete, ADR-138/139 are superseded archive only, and deploy/live acceptance remain pending.

**Final local gate result:** focused browser/Telegram suites passed; repo-wide lint, format check, API/web/provider-gateway/runtime typechecks, and provider-gateway full tests passed. No push.

**Direct cutover, no transitional path.** No feature flags, no parallel `useLocalBridge` mode, no dual code branches. Platform has no external commercial users at cutover time; one clean pull-request series replaces the persistent Browserless plane with the local bridge in a single ordered set of slices.

**Supersedes and closes:** ADR-138 (persistent Browserless profiles / live login) and ADR-139 (Browserless capability policy, stealth/proxy, persistent BQL elements, recovery) for all persistent cloud session truth. ADR-138/139 remain archive references only after this program closes.

### Post-closure defect fixes (in-scope, no new ADR)

- **2026-07-09 — cross-pod bridge relay (local, not pushed).** The local browser-bridge relay held the connection registry and command lifecycle (`connectionsByKey`, `scopeToConnectionKeys`, `pendingCommands`) in per-pod memory, but `api` runs with ≥2 replicas and the GCLB round-robins HTTP. A device WebSocket owned by pod A was therefore invisible to `open-live` / `complete-login` / browser-tool `dispatch`+`result` handled by pod B, surfacing as a permanent `bridge_unavailable` → 409 for both desktop and mobile even after a successful socket connect. Live probing confirmed `api.persai.dev` health, TLS, and the WebSocket upgrade (`101 Switching Protocols` via the GCE LB) were all healthy, isolating the fault to the relay rather than ingress or the client. Fix: a Redis-backed coordinator (`BROWSER_BRIDGE_REDIS_URL`, reusing the runtime Redis) now shares the connection registry + command state across replicas and forwards each dispatch to the pod that owns the socket via pub/sub, so `getCommandResult` resolves from any pod. Sockets and their local timeouts still live on the owning pod. When `BROWSER_BRIDGE_REDIS_URL` is unset (local dev / single process) the relay keeps the previous in-memory behavior. This is a defect fix inside ADR-140 scope; no new ADR.

- **2026-07-09 — login completion truth (local, not pushed).** Even with the relay fixed, `complete-login` could never succeed on desktop: verification dispatched `snapshot`, which requires `chrome.permissions.request` host grants that a WebSocket-dispatched service-worker command cannot obtain (no user gesture) → permanent `permission_denied` 409. A new permission-free `check_view` action (window/tab liveness + last-known URL, no DOM) is now the extension-kind verification; capacitor keeps `snapshot`. Two adjacent defects fixed in the same slice: (a) with mobile + desktop both registered, dispatch targeting used the stale/last `bridgeSessionRef` — the web modal now sends its own connected `bridgeDeviceId` on `open-live`/`complete-login` and the API prefers it; (b) the modal's 3s status poll re-registered a fresh device id each tick and orphaned the extension's live socket — registration is throttled (15s/scope) and the extension force-reconnects when a newer device id supersedes the authenticated one. After activation the API fire-and-forgets `close_view` to hide the bridge surface. Desktop `open_view` popup sizes to ~70% of the screen at 16:9. Mobile: hardware Back locally hides the native overlay (client-side `close_view`) so the Done button is reachable, with a "show site again" action. Defect fixes inside ADR-140 scope; no new ADR.

## Date

2026-07-08

## Baseline SHA

`aa2ad2ef` on `main` (post ADR-139 host-script + stayOnPage fixes). Implementation subagents start only from a **clean git tree** on the orchestrator branch.

## Founder-locked decisions

| # | Decision | Locked answer |
| --- | --- | --- |
| 1 | Tool surface | **Single** model-facing `browser` tool — same actions, same catalog vocabulary; execution plane changes under the hood |
| 2 | Session ownership | **Per-assistant** `(assistantId, profileKey)` — unchanged product model |
| 3 | Where cookies live | **On the user's device** — Chrome cookie store for the extension window; Capacitor v1 stores a per-`profileKey`, per-origin cookie jar and swaps those cookies into the platform WebView cookie store before commands/navigation. PersAI database stores only the profile card (`profileKey`, `displayName`, `originHost`, status, TTL). One login lasts days until the site itself invalidates the cookie. Non-cookie WebView state is not fully isolated per profile in v1. |
| 4 | Bridge window visibility | **Hidden by default.** Assistant work runs in background — user never sees the automated tab / WebView. Window becomes visible only when the assistant explicitly asks the user to help (captcha, re-auth, payment confirmation) or when the user opens it from settings. |
| 5 | Browserless role | **Headless ephemeral only** — fast public `snapshot` / `screenshot` when **no** `profile` and no saved session. No persistent sessions, BQL profiles, stealth/proxy, live URLs. |
| 6 | Web desktop bridge | **Chrome extension**, Manifest V3 |
| 7 | Mobile bridge | **Production Capacitor native plugin** `persai-browser-bridge` (repo `persai-mobile`), WKWebView on iOS + WebView on Android |
| 8 | Web without extension | Model returns structured `bridge_unavailable`; assistant honestly explains and modal shows Chrome Web Store install CTA |
| 9 | Permissions | `optional_host_permissions` in extension manifest; native Chrome permission prompt per domain at first `login`. No universal `<all_urls>`. |
| 10 | Billing | Local bridge is **free** — no `billingFacts` emitted. Only headless Browserless is billed as today. |
| 11 | Telegram | Logged-in browser automation is **not supported directly in Telegram**. Telegram can still use public headless reads; logged-in browser actions return a structured `bridge_unavailable` / `open_in_app` state telling the user to continue in PersAI web/app. |
| 12 | Existing DB profiles | Migrated to `status = expired`; rows kept (preserve `displayName` + `originHost` cards). `provider_session_id` and `live_url` columns dropped. |
| 13 | Multi-device v1 | **Per-device cookies (Variant A)**. Each device has its own logged-in cookie store. A user re-logs in on each device; a profile card can reference multiple `bridgeDeviceId`s but cookie state is not synced between devices. |
| 14 | Web release | Extension is built and tested locally in **developer mode**, then submitted to Chrome Web Store. Public web cutover starts only after Chrome Store approval. Mobile Capacitor bridge works immediately in the app. |
| 15 | MV3 background | The Chrome extension WebSocket lives only while a PersAI tab is open or the extension popup is active. Background work after closing the browser is out of scope; user keeps the tab open for long-running tasks. |
| 16 | Trust boundary | The bridge may not click captcha, payment, or anti-bot guarded elements. For those cases the model returns `needs_user_action`, the hidden window becomes visible, and the user performs the action. |
| 17 | Privacy | PersAI does not persist page content, DOM snapshots, or element lists. Only URL, status, structured operation result, warnings, and error reason are retained. |
| 18 | Delivery | **One direct cutover** — ordered slices without a compatibility window |

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

### D2a — Trusted user action boundary

The bridge is **not** a generic anti-bot bypass. It performs normal DOM interactions (click, type, scroll, select, wait). Some sites mark sensitive events as `isTrusted` or present captcha/payment challenges. In those cases the bridge returns a structured `needs_user_action` state and shows the browser window. The user completes the action, clicks **Готово**, and the model resumes. The model does not narrate or guess around these boundaries; the product UX is explicit: "Пожалуйста, выполни это действие в открывшемся окне, а я продолжу."

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
- Capacitor iOS: per-`profileKey`, per-origin cookie jar stored by the plugin and swapped through `WKHTTPCookieStore`. Cookies survive app restarts.
- Capacitor Android: per-`profileKey`, per-origin cookie jar stored by the plugin and swapped through `CookieManager`. Cookies survive app restarts.
- Capacitor v1 does **not** guarantee full isolation for non-cookie WebView storage. DOM storage, IndexedDB, and service worker caches may remain platform-owned per origin across profiles on the same device.

**One login lasts as long as the site itself keeps the cookie valid** — typically many days or weeks. PersAI does not re-login on every command.

**Multi-device v1 (Variant A):** Cookies are stored on each device separately. The same user with the same assistant must log in on each device where they want the bridge to work. The profile card in the database can reference multiple `bridgeDeviceId`s; runtime routes to the active device. This is a v1 simplification; a later ADR can introduce encrypted cookie sync if needed.

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

- **iOS:** Swift plugin. `WKWebView` per profile with a per-`profileKey`, per-origin cookie jar swapped through `WKHTTPCookieStore`. `evaluateJavaScript` for command execution.
- **Android:** Kotlin plugin. `WebView` per profile with a per-`profileKey`, per-origin cookie jar swapped through `CookieManager`. `evaluateJavascript` for command execution.
- Non-cookie WebView storage such as DOM storage, IndexedDB, and service worker caches is not guaranteed isolated per profile in v1.
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

### D10 — Telegram boundary

Telegram remains a normal chat channel, not a local browser runtime. It cannot host the extension, a hidden desktop window, or the Capacitor WebView. Therefore:

- Public, no-profile `snapshot` / `screenshot` may still use headless Browserless.
- Logged-in browser actions return a structured `bridge_unavailable` / `open_in_app` result.
- The assistant tells the user to continue the action in PersAI web/app where the local bridge exists.
- No public browser-login page, one-time login token, or Browserless-style live URL is introduced for Telegram.

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

Ordered. Each slice compiles green; the program does not go through a state where `browser` with a profile "half works". The compile-green guarantee is achieved by landing bridge and cut together in slices S6–S7 as a single logical step across multiple commits.

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

**Gate:** extension unit tests (executor + host permission logic); manual smoke check on Lavka login end-to-end in developer mode.

**Release:** After the gate, the extension is submitted to Chrome Web Store. The web cutover in S7 starts only after store approval. The mobile Capacitor bridge in S3 works immediately in the app without store dependency.

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

### S8 — Channel boundary cleanup + doc closure + program gate

- Update Telegram/browser channel handling so logged-in browser actions return structured `bridge_unavailable` / `open_in_app`, not login links or live URLs.
- Close ADR-138, ADR-139 in ADR headers ("**Superseded by ADR-140**")
- Update `AGENTS.md` active programs list
- Full workspace lint, format, typecheck, test, test:step2, build
- Live manual acceptance:
  - Desktop web + Chrome extension: login Lavka, hide window, chat drives `snapshot` and `act` in background, `open_view` opens window on demand
  - Android via `persai-mobile`: same flow
  - Telegram: public no-profile read still works via headless; logged-in browser request returns `open_in_app`
- `CHANGELOG` and `SESSION-HANDOFF` updated

**Local completion:** implemented. Telegram/browser handoff now preserves public headless reads while directing logged-in/profile-backed work to PersAI web/app with structured `open_in_app` / `bridge_unavailable` semantics and no login/live links.

**Gate result:** verification matrix is code-complete locally. Focused browser suites, repo-wide lint, format check, required typechecks, and provider-gateway full tests are green.

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
| Telegram `browser` with profile | No local bridge | Structured `open_in_app` / `bridge_unavailable`; no login link, no live URL |
| `browser` with no headless option and no bridge | Structured error | Model receives `bridge_unavailable`; assistant explains without hallucinating |

## Risks and residuals

- **Extension install friction on desktop web.** Mitigated by never blocking chat and by clear install CTA in the modal. Users who refuse install still get honest structured errors.
- **Chrome Web Store review lead time.** S2 lands the code and the extension is tested locally in developer mode. Public web cutover starts only after Chrome Web Store approval. Store publication is a separate operational step tracked in `SESSION-HANDOFF`.
- **iOS App Store review** for the new Capacitor plugin. Same operational note applies to `persai-mobile`.
- **Multi-device v1.** Each device stores its own cookies. A user must log in on each device where they want the bridge to work. The profile card can reference multiple `bridgeDeviceId`s; runtime routes to the active device. Encrypted cookie sync across devices is intentionally out of scope for this program.
- **MV3 service worker lifetime.** The Chrome extension WebSocket is kept alive while a PersAI tab is open or the extension popup is active. Long-running tasks require the browser to remain open. Background execution after the browser closes is out of scope.
- **Trusted action boundary.** Some sites will reject programmatic clicks on captchas, payments, or protected controls. The bridge delegates those steps to the user via `showWindow` mode. The model does not pretend to bypass them.
- **Privacy scope.** Page content, DOM snapshots, and element lists are not persisted in PersAI logs or database. Only URL, status, structured result, warnings, and error reason are retained.
- **CI does not run the extension.** E2E remains a manual step after slice S8 until a follow-up ADR adds Playwright-with-extension coverage.
- **Deploy/manual acceptance remains.** The final local gate is green, but Chrome extension publication, rollout, and live manual acceptance remain operational steps before declaring production acceptance complete.

## References

- Superseded by: —
- Supersedes: `docs/ADR/138-browser-persistent-profiles-and-live-login.md`, `docs/ADR/139-browserless-capability-policy-stealth-proxy-elements-and-recovery.md`
- Audit baseline: commit `aa2ad2ef`; cluster logs 2026-07-08 (`hostPageElements` GraphQL stringify, `stayOnPage` unused `$url`)
- Reuse targets: `scripts/browser-sites/`, `BROWSERLESS_FUNCTION_CODE` operation executor, DOM-ready wait heuristic, interactive-elements ranking + visibility filter, `RuntimeBrowserOperation` schema
