# ADR-075: Mobile delivery via Capacitor WebView shell over `persai.dev`

**Status:** Accepted (spike verified end-to-end on Android; live-verified by founder; production rollout pending)  
**Date:** 2026-04-23  
**Updated:** 2026-04-25 — rewrote Back-button section to match the shipped JS-driven `@capacitor/app` design (manual `MainActivity.onBackPressed` override and `pushState`-marker overlay-close were both abandoned post-spike on the same day); documented the Android `DownloadManager` attachment path that also landed post-spike.  
**Relates to:** ADR-072 (PersAI-native baseline), ADR-073/074 (UX polish program)

## Context

PersAI is live as a Next.js 16 (App Router, RSC, server middleware) web application served from `persai.dev` through the GKE ingress described in ADR-072. The user-facing surfaces — Skipper chat, voice input via `MediaRecorder`, file attachments, Clerk auth in proxy mode (`/clerk-proxy`), streaming assistant responses, settings/Telegram slide-overs — already work in mobile browsers because the web app is responsive.

The open question was: **what is the cheapest honest path from "responsive web on persai.dev" to "Android and iOS app stores", given the architectural realities of the active web stack?**

Three constraints made the answer non-obvious:

1. **SSR + Clerk middleware + same-origin BFF** — `apps/web` is heavily server-rendered with Clerk middleware on every protected route, and `/api/v1` plus `/clerk-proxy` are same-origin. A bundled SPA build would have to either re-implement that server boundary or break Clerk's same-origin assumption.
2. **Russian ISP blocking of Clerk FAPI** — production already runs Clerk in proxy mode through `/clerk-proxy/*` so user traffic stays on `persai.dev`. Any mobile build that bypasses that origin loses the workaround.
3. **Multichannel runtime parity** — Telegram and web chat both flow through the same native turn gateway (ADR-056/058). A mobile path that introduces a different request shape would fork that contract.

The answer with the smallest blast radius is to keep the deployed `persai.dev` as the single source of UI truth and ship a thin native shell that loads it.

## Decision

Adopt **Capacitor 8 as a thin WebView shell** that loads the live `persai.dev` origin via `server.url`, and host that shell in a **separate sibling repository** rather than as a workspace package inside `PersAI`.

Concretely:

- **Repository:** `persai-mobile` (private GitHub) lives next to `PersAI` on disk and as a separate remote. It owns `capacitor.config.ts`, `android/`, `ios/`, the placeholder `www/`, and a small `MainActivity.java` extension of `BridgeActivity` that wires native attachment downloads (see "Attachment download path" below) and otherwise delegates Back-button handling to the JavaScript layer.
- **Web origin:** the shell loads `https://persai.dev` directly. No assets are bundled into the app binary, so any web deploy reaches mobile users immediately on the next app launch — no app-store re-review.
- **`allowNavigation`:** restricted to `persai.dev`, `*.persai.dev`, `accounts.google.com`, `*.googleusercontent.com` so OAuth round-trips stay inside the WebView instead of bouncing to the system browser. (`accounts.google.com` is retained as forward-compatibility for when Google OAuth comes back online — it currently sits behind the email-only auth path resolved separately.)
- **Native permissions:**
  - Android `AndroidManifest.xml`: `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` for `MediaRecorder`-based voice input, plus `WRITE_EXTERNAL_STORAGE` (`android:maxSdkVersion="28"`) for legacy `DownloadManager` writes on API ≤ 28. A `FileProvider` (`${applicationId}.fileprovider`, `xml/file_paths.xml`) is declared for sharing downloaded attachments with external apps.
  - iOS `Info.plist`: `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`.
- **Hardware Back integration (JS-driven via `@capacitor/app`).** During the spike a manual `MainActivity.onBackPressed()` override that delegated to `WebView.goBack()` was tried first (commit `a77bc03`), but it stopped firing on Android 14+ where `Activity#onBackPressed` is deprecated and the new `OnBackPressedDispatcher` interacts unpredictably with Next.js App Router pushState entries inside a WebView, leaving the hardware Back button effectively dead. The shipped design instead delegates Back entirely to the JS layer:
  - `MainActivity` no longer overrides Back; it only attaches a `DownloadListener` for attachments.
  - `apps/web/app/app/_components/back-button-bridge.tsx` mounts once near the root of the App Router tree and subscribes to `@capacitor/app`'s `backButton` event. Resolution order on a press: (1) topmost overlay handler from the JS stack, (2) soft pop via `window.history.back()` when `canGoBack` is true so App Router handles the route change, (3) `App.exitApp()` at the root.
  - `apps/web/app/app/_components/back-handler-stack.ts` is a module-level LIFO stack; modals/lightboxes/sidebars push their close handler on open and pop it on close. There is one Capacitor listener per session.
  - This path is portable across Android 13/14/15 because it bypasses both the deprecated `onBackPressed` and the new dispatcher, and matches WebView history with App Router's pushState entries through pure JS.
- **Web-side overlay-close hooks for the same Back path.** `apps/web` ships two hooks under `apps/web/app/app/_components/`:
  - `useHistoryBackToClose(open, onClose)` — registers `onClose` on the back-handler stack while `open` is true. An earlier spike implementation pushed a marker history entry on open and listened for `popstate`; that worked for leaf modals but corrupted the history stack whenever the overlay also contained a `router.push` link (mobile sidebar tapping a chat). The stack approach has no history side effects, so it composes cleanly with router pushes inside an open overlay.
  - `useTouchDevice()` — `(hover: none) and (pointer: coarse)` media-query feature detection used by the chat composer and sidebar/chat row affordances; SSR-safe and hardened against jsdom's missing `matchMedia` for unit tests.
  - `SlideOver` and the mobile slide-out sidebar in `app-shell.tsx` consume `useHistoryBackToClose`, so hardware Back (and desktop browser Back on narrow widths) dismisses overlays instead of leaving the screen. Deep-link safety is preserved because no marker entries pollute the history stack.
- **Attachment download path (Android `DownloadManager`).** The WebView ignores the HTML5 `download` attribute and cannot natively render PDFs, so attachment links either did nothing visible (txt) or showed a blank page (pdf). `MainActivity#handleDownload` attaches a `DownloadListener` that re-issues every attachment URL through `DownloadManager` with the WebView's session cookie (so the proxy `/api/attachment/[id]` route can verify the user) and writes the file to the system Downloads folder. A last-resort `Intent.ACTION_VIEW` fallback covers cases where `DownloadManager` rejects the URL (e.g. `data:` URIs). This is shell-side only — the web app keeps emitting ordinary attachment URLs, no mobile-specific code lives in `apps/web`.
- **Touch-friendly UX corrections** in the same wave:
  - Sidebar chat row kebab is `opacity-70` on touch viewports and `md:opacity-0 md:group-hover:opacity-100` on desktop, matching the existing convention in `chat-area.tsx`.
  - Composer Enter handling is gated by `useTouchDevice()` — on phones/tablets Enter inserts a newline and the Send button is the only submit affordance; on desktop the existing Enter-to-send / Shift-Enter-to-newline behaviour is preserved.
  - Assistant message body now uses `min-w-0 max-w-full break-words [overflow-wrap:anywhere]`, and the chat scroll container adds `overflow-x-hidden`, eliminating the small horizontal scroll that appeared on long unbreakable strings.

## Verified spike outcome

The Android shell was built with Android Studio and run on a Samsung SM-F966B (Galaxy Z Fold 6, Android) over USB ADB. Verified end-to-end on the shipped JS-driven Back design:

- email sign-in completes through the Clerk proxy on `persai.dev`
- voice message: `MediaRecorder` records, uploads, transcribes, the assistant replies
- assistant response streams into the WebView in real time
- session persists across app cold-restart (cookies retained)
- system hardware Back: closes the topmost overlay (slide-over, lightbox, mobile sidebar) when one is open; otherwise navigates the App Router history (chat ↔ chat); exits the app at the root — same on Android 13/14/15 with no manual `onBackPressed` override
- attachment download: tapping a `pdf` / `txt` / image attachment surfaces a system Downloads notification, the file lands in `/Download`, and the user can open it with their installed viewer

This is sufficient to retire the "is the WebView shell viable for PersAI?" question with a clear yes.

## Consequences

### Positive

- **One UI codebase for web, Android, iOS.** Web fixes ship to mobile on next app open. No SSR re-implementation, no parallel mobile UI tree.
- **Clerk proxy mode keeps working unchanged.** Auth, FAPI traffic, cookies all behave like a normal browser visit because everything stays on `persai.dev`.
- **Russian ISP blocking workaround is preserved.** The shell inherits the same `/clerk-proxy` survival path as the web.
- **Mobile-specific UX bugs surfaced on the spike (Back, hover-only menus, Enter behaviour, horizontal overflow) became improvements to the shared web codebase**, so desktop browser users on narrow viewports also benefit.
- **No native release on every web deploy.** App store binaries change only when native shell changes (permissions, plugins, splash, icon), which is rare.
- **Separate `persai-mobile` repo means web CI is not coupled to Gradle/Xcode.** PersAI verification gates stay fast.

### Negative

- **WebView is not a native UI.** Animation feel, scroll inertia, keyboard handling, share sheets, and accessibility primitives are the platform WebView's, not native. For PersAI's chat-centric product this is acceptable.
- **App store review surface is wider than for a pure web app.** Apple in particular has historically scrutinized "browser wrapper" apps; we mitigate by adding genuinely native capabilities (microphone, push, possibly local notifications) and by having store-quality icon/splash/about content rather than shipping a literal `WebView({src:"persai.dev"})`.
- **Mobile users only get UI changes after re-opening the app, but they get backend/runtime changes immediately.** This is the same drift surface that any web origin already has and is easier to reason about than two parallel UI builds.
- **`server.url` is environment-specific.** Production rollout requires swapping it from `https://persai.dev` (current dev origin) to the eventual production origin without re-shipping a binary if possible — see Production rollout below.
- **Shell repository discipline matters.** `persai-mobile` is small but has its own dependencies (Capacitor, Android Gradle plugin, CocoaPods later). Keeping it in lockstep with PersAI runtime expectations is a small ongoing tax.

## Alternatives considered

- **React Native or Flutter rebuild.** Rejected. Reimplements every chat surface, loses Clerk proxy, loses the same-origin BFF assumption, and splits the team's UI work into two stacks for no functional gain on a chat-centric product.
- **Bundle the web app statically and ship as Capacitor's `webDir`.** Rejected. Next.js 16 App Router with RSC, server middleware, and Clerk's server-side flows is not statically buildable in a way that preserves the proxy-mode auth contract. Bundling would require either a separate "mobile-only" web build or breaking Clerk's same-origin assumption.
- **PWA only (no Capacitor, just `manifest.json` + service worker).** Rejected for now. PWA does not get into the App Store, has poorer push notification support on iOS, cannot grant `RECORD_AUDIO` without UI prompts that are weaker than native permission flows, and does not give us the hardware Back hook we need for parity with native chat apps.
- **Trusted Web Activity (Android-only Chrome wrapper).** Rejected because we need iOS too, and TWA does not solve the Back-into-overlay UX gap.

## Repo and ownership boundary

- **`PersAI` (this repo)** owns: web UI, server middleware, Clerk proxy, native runtime, provider gateway, ADRs, and the cross-platform UX fixes that ship to all clients.
- **`persai-mobile` (sibling repo)** owns: Capacitor config, Android project, iOS project, app icons/splash, native permission strings, store listings.
- **No mobile-specific business logic** lives in `persai-mobile`. If a feature requires mobile branching, it branches inside `apps/web` using `useTouchDevice()` or platform feature detection, not in the shell.

This boundary keeps PersAI's verification gates (`pnpm -r --if-present run lint`, `pnpm run format:check`, `pnpm --filter @persai/web run typecheck`, `pnpm --filter @persai/api run typecheck`) free of native toolchain dependencies and keeps `persai-mobile` free of business logic that must stay versioned with the runtime.

## Production rollout plan

The current spike points the shell at `https://persai.dev` (the dev origin). Production rollout requires:

1. Decide the production web origin (likely `https://app.persai.com` or similar) and confirm Clerk proxy mode is configured for it identically to dev.
2. Switch `server.url` in `persai-mobile/capacitor.config.ts` to that origin and re-run `npx cap sync`.
3. Tighten `allowNavigation` to only the hosts needed by the production OAuth round-trips.
4. Generate production-grade app icons and splash screens in `persai-mobile/`.
5. First Android internal/closed track release through Google Play Console, first TestFlight build for iOS once the Apple developer account is set up.
6. Decide whether to ship Capacitor `@capacitor/push-notifications` and `@capacitor/local-notifications` for parity with the Telegram channel; if yes, this is a follow-up shell change, not a web change.

## Open questions

- **Push notifications path.** PersAI currently delivers async assistant updates via Telegram. Whether we want APNs/FCM in the mobile shell or whether we keep Telegram as the async channel is a product call deferred to the production rollout slice.
- **Apple Developer account and signing identity.** iOS build is scaffolded but we need a real Apple Developer Program enrolment, an Apple ID, and a Mac (or cloud Mac) for the first archive/upload to TestFlight.
- **Camera attachments.** `Info.plist` already declares `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`, but the web app does not currently expose a camera-capture path beyond the standard `<input type="file" accept="image/*" capture>`. If we want a richer in-app camera UI we'll need `@capacitor/camera`; deferred until it becomes a real product ask.
- **Offline / poor-network behaviour.** A pure WebView shell with `server.url` becomes a blank screen if `persai.dev` is unreachable. A small offline placeholder served from `www/` is in place; richer offline behaviour is deferred until we see real user demand.
