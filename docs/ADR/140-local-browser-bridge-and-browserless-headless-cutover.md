# ADR-140: Local browser bridge execution plane and Browserless headless-only cutover

## Status

**Implemented locally through S8; closed locally 2026-07-08.** Parent-orchestrated implementation is complete, ADR-138/139 are superseded archive only, and deploy/live acceptance remain pending.

**Final local gate result:** focused browser/Telegram suites passed; repo-wide lint, format check, API/web/provider-gateway/runtime typechecks, and provider-gateway full tests passed. No push.

**Direct cutover, no transitional path.** No feature flags, no parallel `useLocalBridge` mode, no dual code branches. Platform has no external commercial users at cutover time; one clean pull-request series replaces the persistent Browserless plane with the local bridge in a single ordered set of slices.

**Supersedes and closes:** ADR-138 (persistent Browserless profiles / live login) and ADR-139 (Browserless capability policy, stealth/proxy, persistent BQL elements, recovery) for all persistent cloud session truth. ADR-138/139 remain archive references only after this program closes.

### Post-closure defect fixes (in-scope, no new ADR)

- **2026-07-10 — quiet login handoff + deterministic desktop bounds (local).** The login surface accumulated implementation-status and repeated-instruction cards that obscured its one user action. Desktop and mobile now share a compact hierarchy: completion title, centered Open pill, one concise explanation, on-demand `?` help, and standard pill Done/Cancel actions. A connected bridge is an inline indicator; only unavailable/disconnected desktop extension state uses a restrained install/retry warning. Mobile no longer reveals the native browser before the user presses Open, while Back still returns to the compact completion surface. The assistant-triggered desktop popup could still retain a tiny mobile-like size because Chrome may ignore geometry when restoring `state: normal` and setting dimensions in one `windows.update`; the extension now restores state/focus and applies the 70%/16:9 centered bounds in a second call on every visible open.
- **2026-07-10 — shared DOM-stability snapshot gate (local).** Desktop extension and Capacitor page runners no longer treat 40 characters of text or two visible controls as evidence that a document is ready. One bounded pre-read gate now requires an interactive document with a body and 750 ms without DOM mutation, capped by the existing 10-second deadline; timeout still captures the current DOM and returns `loadStatus: "partial"`, while a quiet document returns `"stable"`. The status is preserved through extension/native bridge results and the runtime's model-facing browser page. There is no second wait, network-idle dependency, site-specific parser, spinner rule, or checkpoint heuristic. Android 1.0.22 (`versionCode 24`) carries the native result propagation.
- **2026-07-10 — Capacitor canonical main-frame redirect completion (local).** Two live Lavka search commands each waited exactly 30.4 seconds: `/search` was canonicalized by Yandex to `/` before the first accepted page callback, so the strict requested-path gate ignored the real redirect chain until its navigation deadline. Valid main-frame navigation actions now mark the pending navigation as started on Android/iOS; stale previous-document commit callbacks still cannot complete a request. Android release becomes 1.0.15 (`versionCode 17`). This is an ADR-140 navigation-lifecycle defect repair.
- **2026-07-10 — Capacitor absent-navigation decoding (local).** Mail.ru live acceptance passed after the declarative anchor handoff, but fresh Lavka ordinary actions failed immediately although runtime dispatched a valid HTTPS command URL. The runner emitted `navigationUrl: null` for non-anchor operations, and Android `JSONObject.optString` surfaced JSON null as the string `"null"`; native consequently attempted invalid navigation. Shared runners now omit absent navigation targets, while Android treats JSON null defensively. Android release becomes 1.0.14 (`versionCode 16`). This is an ADR-140 bridge-contract defect repair.
- **2026-07-10 — Capacitor cross-origin/click navigation completion (local).** Strict current-surface logs proved Mail.ru calls executed on Capacitor, not Chrome. Repairs now reject stale page commits, preserve cross-origin completion while swapping cookie jars, tolerate URL canonicalization, skip stale pre-goto URLs, and accept SPA/history commitment. Live 1.0.12 then isolated the 109.8-second blocker: page-runner `element.click()` on `<a href>` began navigation and destroyed that ephemeral JavaScript context before its native callback, so native waited until execution timeout and never reached the next goto. HTTP(S) anchor clicks are now declarative: runner returns `navigationUrl` first; Android/iOS navigate natively after callback and continue remaining segments, skipping equivalent goto reloads. Profiles/cookies are preserved. Android release becomes 1.0.13 (`versionCode 15`); shared web runner deploy is required. This remains an ADR-140 defect repair.
- **2026-07-10 — strict current-surface chat-turn affinity (local).** The current-surface `open-live` repair did not cover ordinary assistant browser calls. Live mobile acceptance proved this directly: Android received no command while runtime used the profile's persisted extension ref and Chrome executed/timed out the actions. Every interactive web/app send now declares extension versus Capacitor and carries that installation's connected ID through stream/sync runtime channel context. A current-turn dispatch is strict: relay may not apply remembered-ref fallback to a different installation, and a declared but disconnected surface fails before dispatch. Successful profile commands and `open_live` atomically persist relay-authenticated ref + kind. This supports switching one logical profile between device-local sessions while guaranteeing phone turns never execute in Chrome and desktop turns never execute on the phone. Cookies are intentionally not synchronized between devices. No native/APK change.

- **2026-07-10 — current-surface profile affinity repair (local).** A mobile Mail.ru attempt returned extension-only host-permission denial. Live database truth showed the profile still persisted an extension kind and Chrome device ref because configured-session and chat-assist Open calls omitted the current surface's bridge ID; API consequently used the old stored affinity. Those UI paths now require the current connected surface and send its device ID. Relay selection returns the device kind authenticated by its signed registration/socket descriptor, and successful `open-live` atomically updates profile ref + kind from that server truth. The response also returns the selected kind, preserving the correct mobile Back handler. This is an ADR-140 cross-device routing defect, not a new profile architecture.

- **2026-07-10 — mobile priority view lifecycle + committed-navigation completion (local).** Live Mail.ru login acceptance isolated a second deterministic lifecycle failure after runner compilation was repaired. Command `d462865d-d90a-43b2-b8e9-0425b152a9f8` remained pending for the full 120-second outer lifetime and its Android result reached API only 402ms after cleanup; a settings `open-live` submitted behind it waited `98.65s`, then revealed the WebView after the turn and after an earlier Back had cleared the handler. Capacitor now gives `open_view`, `close_view`, and `check_view` the same priority bypass as the extension instead of serializing them behind `snapshot`/`act`. Android begins page execution at `onPageCommitVisible`, caps navigation wait at 30 seconds, and reserves transport time inside the outer deadline. This preserves the prior Back contract because a delayed stale open can no longer recreate the overlay after its handler is gone. Android release becomes 1.0.9 (`versionCode 11`). This is an ADR-140 defect repair, not new architecture.

- **2026-07-10 — generated mobile runner compile repair (local).** Post-deploy live acceptance produced a deterministic 120-second `bridge_command_timeout`. Dispatch/result polling stayed healthy and the Android WebView entered background rendering, isolating the loss to native execution. Compiling the exact deployed `PAGE_RUNNER_SOURCE` reproduced `SyntaxError: await is only valid in async functions`: the string declared a synchronous arrow while containing top-level awaits. PersAI and packaged mobile sources now emit an async runner, and both suites compile the final generated string as an invariant. Android/iOS wrappers additionally catch synchronous eval/setup failures and report them through the runner callback immediately instead of degrading into an outer timeout. Android release becomes 1.0.8 (`versionCode 10`). This is an ADR-140 implementation defect, not a new program.

- **2026-07-10 — retained-session navigation latency + native Back ordering (local).** Connected-phone and cluster timestamps disproved a fresh transport failure: a profile snapshot dispatched successfully, remained pending for 31 seconds, then returned and completed the turn. The bridge was navigating to the same already-loaded document on every URL-bearing snapshot, paying navigation timeout plus DOM readiness before reading. Android, iOS, and the extension now compare normalized scheme/host/port/path/query and reuse an equivalent current document without navigation. Mobile browser Back handlers receive explicit priority over settings/navigation handlers so the first press hides the browser instead of closing the hidden settings surface or exiting the app; configured-session list reconciliation is background-only so cards remain mounted while open state refreshes. Android release becomes 1.0.7 (`versionCode 9`). This is lifecycle/latency repair within ADR-140, not a new architecture program.

- **2026-07-10 — live Mail.ru desktop permission/window + Android hidden-runner repair (local).** Founder live acceptance separated three defects. (1) Assistant-driven `open_view` could retain the old tiny popup size when the stored profile record already said `visible`; the existing-window path now reapplies the canonical 70%/16:9 bounds on every visible open. (2) A background MV3 WebSocket command cannot legally invoke `chrome.permissions.request` without a user gesture, so correct `permission_denied` results still left DOM automation unusable. The first DOM/screenshot command now opens a focused, non-technical PersAI browser-access window, waits up to 90 seconds for its explicit click, and resumes the same command after approval. Live PNG acceptance additionally proved `captureVisibleTab` rejects a per-origin host grant: Chrome requires `activeTab` on the exact target tab or `<all_urls>`. `activeTab` would require a manual extension click before every autonomous screenshot, so `<all_urls>` is now declared as optional-only and requested once from that dedicated window; it is neither install-time access nor required for login/open-view. Concurrent commands share one pending grant. (3) Live cluster polling plus connected-phone logcat proved the reported mobile `bridge_connection_closed` followed an earlier native `Timed out waiting for page execution`, not a server/socket loss. Android had changed the retained WebView to `INVISIBLE` and its overlay host to `GONE` before evaluating hidden snapshot/act work, allowing third-party page Promise/timers to suspend. Background execution now keeps the renderer attached and technically visible but transparent while a custom host passes all touches to the underlying PersAI WebView, then restores the hidden state. A debug APK installed over the connected phone completed a real hidden Capacitor snapshot of `https://mail.ru/` in about 11 seconds with title/content returned. An instrumented 10-second hidden command plus a real Android tap focused the underlying PersAI composer `TEXTAREA`, proving the UI remains interactive. Android release becomes 1.0.5 (`versionCode 7`). Defect repairs remain inside ADR-140; no new architecture program.

- **2026-07-10 — mobile safe area + bounded login completion (local).** Live mobile acceptance exposed two native defects after the site finally opened. The overlay was attached to edge-to-edge `android.R.id.content` without system-bar/display-cutout insets, putting site controls behind the top/bottom bars; Android now applies those insets to the overlay, with iOS parity constraining its host to the root safe area. Pressing Done also invoked a full native page-runner snapshot and could hang until the HTTP request surfaced `Failed to fetch`; `adb logcat` captured `Timed out waiting for page execution`, while cluster requests returned 409 after 8–83 seconds. Human-confirmed completion now uses `check_view` for both bridge kinds. Android/iOS implement it as immediate liveness + cookie persistence without DOM execution. Rebuilt APK live proof: native result returned immediately for `https://mail.ru/`; `complete-login` returned 200 in 548 ms. Defect fixes inside ADR-140 scope; no new ADR.

- **2026-07-10 — bridge connection durability + stable installation identity (local).** Live cluster timestamps showed the connected mobile bridge successfully completing commands at 21:32Z, then `open-live` failing immediately with `bridge_unavailable` at 21:39Z while the same Android process remained alive. Three defects composed the failure: the API public WebSocket emitted no ping frames and could be reaped by an idle intermediary; the Capacitor web client nulled a closed socket without reconnecting; and every authenticated credential renewal minted a new `bridgeDeviceId`, orphaning the profile's saved device affinity and becoming ambiguous with two Chrome installations. The server now emits a 20s WebSocket ping, Capacitor retries transient closes while the current credential is valid, registration may renew the same authenticated installation id, and extension/mobile clients reuse their persisted id. A global authenticated app-shell maintainer now heals or renews desktop/mobile bridge connections outside the one-time login modal on app load, foreground, network recovery, and a 30s health tick. Clicking an active configured-session card is now a direct assist action: desktop opens only the extension window, mobile opens only the native browser overlay with Back returning to the app, and the web modal appears only on open failure; login/reconnect still use the modal. Extension windows recalculate the same 70% 16:9 bounds from the largest normal Chrome window on every show, rather than inheriting a previously focused popup's size. Profile-backed requests intentionally do **not** fall back to Browserless: the authenticated cookie session exists only in the selected local installation, so a cloud fallback would be a different unauthenticated browser and would violate profile truth. Desktop `snapshot`/`act` host grants now have a valid MV3 user-gesture path in the extension popup. Defect repair inside ADR-140 scope; no new ADR.

- **2026-07-09 — cross-pod bridge relay (local, not pushed).** The local browser-bridge relay held the connection registry and command lifecycle (`connectionsByKey`, `scopeToConnectionKeys`, `pendingCommands`) in per-pod memory, but `api` runs with ≥2 replicas and the GCLB round-robins HTTP. A device WebSocket owned by pod A was therefore invisible to `open-live` / `complete-login` / browser-tool `dispatch`+`result` handled by pod B, surfacing as a permanent `bridge_unavailable` → 409 for both desktop and mobile even after a successful socket connect. Live probing confirmed `api.persai.dev` health, TLS, and the WebSocket upgrade (`101 Switching Protocols` via the GCE LB) were all healthy, isolating the fault to the relay rather than ingress or the client. Fix: a Redis-backed coordinator (`BROWSER_BRIDGE_REDIS_URL`, reusing the runtime Redis) now shares the connection registry + command state across replicas and forwards each dispatch to the pod that owns the socket via pub/sub, so `getCommandResult` resolves from any pod. Sockets and their local timeouts still live on the owning pod. When `BROWSER_BRIDGE_REDIS_URL` is unset (local dev / single process) the relay keeps the previous in-memory behavior. This is a defect fix inside ADR-140 scope; no new ADR.

- **2026-07-09 — login completion truth (local, not pushed).** Even with the relay fixed, `complete-login` could never succeed on desktop: verification dispatched `snapshot`, which requires `chrome.permissions.request` host grants that a WebSocket-dispatched service-worker command cannot obtain (no user gesture) → permanent `permission_denied` 409. A new permission-free `check_view` action (window/tab liveness + last-known URL, no DOM) is now the extension-kind verification; capacitor keeps `snapshot`. Two adjacent defects fixed in the same slice: (a) with mobile + desktop both registered, dispatch targeting used the stale/last `bridgeSessionRef` — the web modal now sends its own connected `bridgeDeviceId` on `open-live`/`complete-login` and the API prefers it; (b) the modal's 3s status poll re-registered a fresh device id each tick and orphaned the extension's live socket — registration is throttled (15s/scope) and the extension force-reconnects when a newer device id supersedes the authenticated one. After activation the API fire-and-forgets `close_view` to hide the bridge surface. Desktop `open_view` popup sizes to ~70% of the screen at 16:9. Mobile: hardware Back locally hides the native overlay (client-side `close_view`) so the Done button is reachable, with a "show site again" action. Defect fixes inside ADR-140 scope; no new ADR.

- **2026-07-09 — expired-token re-registration + native request storm (pushed as `32718a0f`).** Cluster logs showed the modal skipped re-registration whenever the extension already knew the current assistant scope even if disconnected, but device tokens expire after 15 min — the extension redialed forever with the dead token. The modal now re-registers (throttled) on a disconnected same-scope status, and the extension stops dialing once its stored registration is older than 14 min. The mobile modal's 3s poll also stacked register/`open-live` calls while priors were still pending server-side, tripping the relay's dispatch rate limit; added an in-flight guard plus a singleton native connect promise. No new ADR.

- **2026-07-09 — web channel truth, assist-modal compact style, honest extension permission denial (pushed as `9fe39f1b`).** Runtime developer instructions only named the channel for Telegram turns, so assistants in ordinary web chats assumed Telegram; web turns now get an explicit `Channel: PersAI web app chat … NOT Telegram` developer section. The compact desktop modal style was gated to `completionMode === "login"`, so clicking a browser-session card in assistant settings (assist mode) still showed the old full-screen modal behind the extension window; desktop is now always compact regardless of mode. The extension's `ensureOriginPermission` leaked the raw "must be called during a user gesture" error as `browser_failed` when the runtime dispatched `snapshot`/`act` without a host grant; it now returns the structured `permission_denied` result. No new ADR.

- **2026-07-09 — live triage: mobile native-plugin thenable hang, cross-tab register storm, stale bridgeDeviceId hard-fail (local, not pushed).** Live-tested with a connected phone (`adb logcat`) and live cluster/Redis inspection after the previous fixes still left mobile never loading the site and desktop failing to open the window. (1) `browser-bridge-client.ts`'s native plugin getter returned Capacitor's `registerPlugin` proxy as an async function's resolved value; the proxy answers every property access — including `then` — with a native wrapper, so promise resolution invoked `proxy.then()`, which Capacitor rejects with `"PersaiBrowserBridge.then()" is not implemented on android` (confirmed verbatim in live logcat), leaving every native command hung until the server-side dispatch timeout. Fixed by caching the plugin proxy in a module-level variable, never letting it flow through a promise resolution. (2) The 15s registration throttle lived in a React ref scoped to one tab; multiple open PersAI tabs (the founder's actual test setup) each ran independent throttle windows, so combined registrations churned the extension's socket far faster than 15s, killing in-flight commands with `bridge_connection_closed` (confirmed live in cluster logs). Moved the throttle into `registerExtensionBridgeDevice` itself, backed by `localStorage` so all tabs share one cooldown. (3) The relay's connection selector treated a caller-supplied `bridgeDeviceId` (often a stale DB-stored `bridgeSessionRef`) as a hard requirement, hard-failing dispatch with `bridge_device_not_connected`/`bridge_unavailable` even when exactly one live connection existed — directly reproduced by a live assistant `browser.open_live` tool call against an `active` profile. A stale/unmatched id now falls through to the same auto-selection used when no id is supplied. Defect fixes inside ADR-140 scope; no new ADR.

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
| 9 | Permissions | No install-time host access. The manifest declares optional-only `<all_urls>` because Chrome `captureVisibleTab` cannot use a per-origin grant; the first DOM/screenshot command opens a PersAI explanation window and requests it from an explicit user click. Login/open-view need no host permission. |
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
- Mandatory/install-time universal `<all_urls>` extension permission (optional explicit browser-agent access is allowed)
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

**2026-07-10 ownership clarification (founder acceptance):** visibility and ownership are independent. A window/WebView may be visible because the user opened a configured session to observe it while the assistant still owns an active `snapshot`/`act`. In that state, bridge clients install an input-blocking observer layer and reveal `Работает ассистент!` / `Assistant is working!` on hover/tap; the assistant's programmatic DOM/coordinate operations continue underneath. Desktop visibility controls are not serialized behind page work, and mobile Back hides the overlay without clearing the retained profile session. Only a structured user checkpoint transfers ownership and removes that observer lock.

Checkpoint detection must not be based on generic commerce vocabulary. Cart pages routinely contain `payment`, `оплат`, or `карта` while remaining safe to inspect and manipulate. Automatic handoff is limited to strong CAPTCHA/anti-bot/OTP contours and preflighted sensitive payment/verification target controls. A real checkpoint carries `completionMode: "assist"` through the runtime stream; PersAI renders a compact action banner, and Done creates the semantic continuation turn so the assistant resumes. A visible view by itself never justifies `needs_user_action`, `open_live`, or a retry loop.

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
- Content scripts injected on demand via `chrome.scripting.executeScript` per target tab — only after the user has explicitly granted optional browser-agent access.
- No `chrome.debugger` (avoids the "debugger attached" browser banner).
- `<all_urls>` is declared only under `optional_host_permissions`; it is not granted at install time. Chrome requires this breadth for background `captureVisibleTab`, while `activeTab` would require a manual toolbar click on the target tab before every screenshot.
- On the first DOM/screenshot command, the extension opens a dedicated PersAI explanation window. Its button calls `chrome.permissions.request({ origins: ["<all_urls>"] })` under a real user gesture, and the pending command resumes after approval. `login` / `open_view` do not request it.
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

## 2026-07-10 repair — explicit model-owned user handoff

This repair corrects the earlier post-closure ownership addendum: browser clients must not infer a user checkpoint from page text, selector names, form attributes, or operation values. That inference mixed safety policy with execution control, produced false positives, changed window state without a model decision, and could loop indefinitely.

The durable contract is:

- `snapshot` and `act` execute normally and never emit `needs_user_action` from client-side content parsing.
- CAPTCHA, OTP/verification, payment, and irreversible actions remain forbidden for autonomous execution by model/tool guidance.
- When manual work is genuinely required, the model explicitly calls `browser.request_user_action` with the saved `profile` and a concise `userActionPrompt`.
- The runtime resolves the profile and returns `completionMode: "assist"` plus that prompt without dispatching `open_view`.
- PersAI renders the chat handoff card before any browser surface is revealed. Open is a user gesture that reveals the current extension/Capacitor surface; Done dispatches `close_view`, clears the handoff, and starts the continuation turn.
- `open_live` remains a separate explicit-view action for cases where the user asked to see a saved session; it is not the completion protocol.
- Assistant-owned observer locking remains unchanged during ordinary commands.

Desktop cancellation is also side-effect-free across the full lifecycle:

- `close_view` first reconciles an existing profile window and succeeds without creating one when no window exists.
- Cancel clears pending UI state before network cleanup and aborts any unsettled browser-open fetch.
- Profile deletion accepts the authenticated caller's current bridge ID, allowing targeted `close_view` even before `bridgeSessionRef` has been persisted.
- Extension `open_view`, `close_view`, and `check_view` retain their priority over page work but are serialized with each other, so Close received after an in-flight Open is the terminal visibility action.

A pending login cancelled before Open, or while Open is still settling, therefore cannot manufacture or reveal a late small popup.

## 2026-07-10 repair — Capacitor strict-CSP packaged runner

Live profile acceptance exposed a content-independent failure at `https://ya.ru`: the mobile bridge reported that indirect `eval` violated the page's `script-src` policy because `unsafe-eval` was absent. The failure occurred in the native wrapper before `snapshot` operations ran; it was not caused by Mail.ru cookies or user login state.

Android `WebView.evaluateJavascript` and iOS `WKWebView.evaluateJavaScript` already inject PersAI's trusted wrapper. The wrapper now embeds the packaged `PAGE_RUNNER_SOURCE` directly as a function expression rather than parsing it through an indirect `eval`, so ordinary runner execution does not require a target page to permit `unsafe-eval`. Optional host-page scripts remain a distinct, intentionally constrained mechanism. Android release becomes `1.0.17` (`versionCode 19`); bridge source regression tests inspect both wrappers, Android unit/release compilation passes, and live `ya.ru` acceptance remains required.

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
| Assistant asks for user help mid-flow (captcha/OTP) | `request_user_action` → user clicks Open | Chat card appears first; window / WebView becomes visible only from the user's action; Done hides it and starts continuation |
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
