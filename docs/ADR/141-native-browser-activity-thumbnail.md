# ADR-141: Native browser activity thumbnail

## Status

**Implemented locally and closed 2026-07-11.** Android `1.0.24` / `versionCode 26` is built and exported; deploy/install/live acceptance and iOS Xcode/device acceptance remain pending.

## Context

ADR-140 keeps assistant-owned authenticated browser work inside a retained Android WebView or iOS WKWebView and hides that surface by default. Chat already reports assistant activity, but a user cannot visually confirm that the retained page is changing unless they open the full browser overlay.

The product needs a quiet visual companion in the Capacitor app only: a small live-like page miniature that updates as browser operations complete and opens the existing retained browser when tapped. Repeating textual status in this surface would duplicate chat. A continuous video stream, server upload, duplicated WebView, device-category branch, or Fold/tablet heuristic would add cost and architectural drift without improving this contract.

## Decision

1. Android and iOS capture a bounded high-quality JPEG snapshot from the existing retained browser view while assistant-owned `snapshot` or `act` work executes.
   This refines ADR-140 decision 4 only for a derived, non-interactive preview; the actual assistant-owned browser surface remains hidden by default.
2. The packaged page runner invokes an optional native preview hook after each operation. The hook is best-effort and cannot change operation execution or result truth.
3. The Capacitor plugin emits local `browserPreview` events with phase, profile key, current page URL, and an in-memory data URL. Preview bytes are not sent to the PersAI API, GCS, runtime, chat persistence, or telemetry.
4. `apps/web` subscribes only when `Capacitor.isNativePlatform()` is true and renders a small floating image with a favicon treatment. It contains no duplicate activity copy.
5. Tapping the miniature invokes the existing local `open_view` behavior for the same `profileKey`; no new session or browser surface is created.
6. Layout uses only the actual available CSS/native viewport and safe-area insets. There is no Fold, tablet, model, user-agent, orientation, or device-class detection.
7. Desktop Chrome extension behavior and its canonical 16:9 window geometry are unchanged. Native browser overlays continue to fill their available safe-area host.
8. Preview events are optional for rollout compatibility: an older installed app simply renders no miniature while browser execution remains functional.

## Consequences

- Users get visual progress without opening or interacting with the assistant-owned browser.
- Event images consume transient native-to-web bridge bandwidth, so capture width and JPEG quality are bounded.
- The image is a viewport snapshot, not a remote stream. It updates at operation boundaries and briefly lingers after command completion.
- No persistence or data-model migration is introduced.

## Rejected

- text status, step logs, or completion/error labels inside the miniature
- continuous screen recording/video streaming
- reparenting or cloning the retained WebView/WKWebView
- server-side screenshot storage or polling
- Fold/tablet/user-agent heuristics
- changing desktop extension sizing or behavior

## Verification

- page runner calls the optional preview hook after every operation without affecting warnings/results
- native plugin emits start/update/end events on Android and iOS and bounds image size
- app miniature renders only in Capacitor, preserves source viewport proportions, and opens the matching retained profile on tap
- absent preview support and capture failures leave browser commands unchanged
- Android build/tests and iOS source-parity review
