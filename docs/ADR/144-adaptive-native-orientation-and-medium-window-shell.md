# ADR-144: Adaptive native orientation and medium-window shell

## Status

**Implemented locally 2026-07-12.** Android `1.0.39` / versionCode `41` is
built and exported. Fold device and iOS Xcode acceptance remain pending.

## Context

The Capacitor shell currently permits portrait and landscape on ordinary
phones:

- Android declares no orientation restriction.
- iOS lists portrait plus both landscape orientations for iPhone and all four
  orientations for iPad.

That is uncomfortable on a handheld phone, but a global portrait lock would be
wrong for tablets and unfolded book-style foldables. Those larger windows need
rotation and the same list/detail desktop shell used by Telegram.

The web shell currently switches at Tailwind's default `md` breakpoint
(768 CSS px). Android's adaptive large-window boundary is 600dp, which also
covers tablets and most unfolded inner displays. Keeping 768px would therefore
unlock native rotation while still leaving some valid medium windows in the
single-pane phone shell.

## Decision

1. **Ordinary phones stay portrait in the native apps.**
   - iPhone supports portrait only through both the plist ceiling and the
     Capacitor bridge-controller runtime mask.
   - Android compact displays request portrait.
2. **Large native displays keep user-controlled rotation.**
   - iPad supports portrait, upside-down portrait, and both landscape
     orientations. The custom bridge controller and app delegate explicitly
     restore this idiom-specific mask because Capacitor reads the phone plist
     key for its controller defaults.
   - Android permits the user's orientations when maximum window metrics have
     a smallest dimension of at least 600dp.
   - An Android inner foldable display reported by Jetpack WindowManager as a
     `FoldingFeature` also permits rotation. The outer compact display remains
     portrait.
3. Android classification is recomputed when window layout/configuration
   changes so folding, unfolding, rotation, display moves, and resizing do not
   retain stale policy. It uses WindowManager metrics/posture only—never model
   names, manufacturer lists, user agent, or hard-coded Fold products.
4. The web UI remains native-agnostic and responds only to its actual CSS
   viewport. Tailwind `md` becomes 600px:
   - `<600px`: phone/full-bleed single-pane shell
   - `>=600px`: persistent sidebar + chat list/detail desktop shell
5. At medium width the persistent sidebar is 240px; at 1024px and above it is
   280px. This protects the chat pane on unfolded Fold and small-tablet
   windows.
6. The desktop sidebar and main surface use matching 22px outer rounding with
   the existing 8px chrome gutter, matching the Telegram two-zone silhouette.
   Mobile remains full-bleed and unrounded.
7. Orientation policy is shell behavior only. No chat/business state and no
   server contract are added.

## Why this boundary

- Android 16 already ignores orientation restrictions on displays whose
  smallest width is at least 600dp when targeting API 36. The explicit runtime
  policy preserves the same contract on supported older releases and adds
  fold-posture handling for inner displays near the boundary.
- Apple provides device-family-specific Info.plist keys, so iPhone and iPad do
  not need runtime model detection.
- CSS viewport width is the honest owner of web layout. Native code owns only
  whether a compact phone may rotate.

## Rejected

- locking every Android/iOS device to portrait
- enabling rotation on every phone
- device model/manufacturer or user-agent allowlists
- Fold-specific CSS or a native form-factor flag injected into React
- keeping the 768px shell breakpoint after large-window rotation is enabled
- changing chat data/state as part of orientation transitions

## Verification

### Android

- unit-test compact/large/folding-feature policy
- compile and release-build the shell
- folded/outer Fold: portrait only, single-pane shell
- unfolded Fold: rotation allowed; medium/landscape window uses persistent
  sidebar and rounded two-zone shell
- ordinary phone: rotating the device does not rotate PersAI
- tablet: portrait/landscape transitions preserve WebView/chat state and use
  the desktop shell at `>=600px`

### iOS/iPadOS

- source-check iPhone plist mask = portrait only
- source-check iPad plist mask = all four orientations
- Xcode simulator/device: iPhone remains portrait; iPad rotates without
  recreating or losing the active chat and uses desktop shell at `>=600px`

### Web

- focused shell/sidebar tests and web typecheck
- viewport checks at 599px, 600px, 767px, 768px, and 1024px
- no horizontal clipping at 600px with 240px sidebar

## Rollout

- The web breakpoint/rounding ships with the normal web rollout.
- Android requires a new APK/versionCode.
- iOS requires a new Xcode archive/TestFlight build; source parity alone is
  not live acceptance.
