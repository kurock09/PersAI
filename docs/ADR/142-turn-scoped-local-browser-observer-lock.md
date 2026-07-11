# ADR-142: Turn-scoped local-browser observer lock

Status: **implemented and pushed 2026-07-11; Android 1.0.37 built/exported/installed; web + extension deploy and live acceptance pending**

Baseline SHAs: PersAI `3f99dce1`; `persai-mobile` `83e5bb2`.

## Context

The browser ownership overlay was command-scoped. It disappeared after each
`snapshot` or `act`, even while the same assistant turn was still running.
Opening the retained mobile view from its miniature, or focusing the desktop
bridge window between commands, therefore allowed user input to race the
assistant against the same authenticated page.

## Decision

- The first profile-backed `snapshot` or `act` in a turn makes that local
  profile observer-only. The state survives individual command completion.
- While observer-only, trusted user click, pointer, touch, wheel, context-menu,
  and keyboard interaction is blocked. Document scrolling is frozen.
- Assistant-generated page events continue to run. Native pointer injection
  remains allowed while the packaged runner temporarily removes the ownership
  host.
- Tapping the Capacitor miniature opens the retained page with
  `observerOnly: true`; it does not transfer ownership.
- The web app releases retained observer locks when that assistant has no
  streaming thread.
- An explicit model-owned `request_user_action` still transfers ownership:
  its existing `open_view` command is interactive by default and clears the
  turn observer state.
- Android, iOS, and the Chrome extension implement the same lifecycle.

## Contract

`LocalBrowserCommand` adds optional `observerOnly` and the internal
`set_observer_lock` action. The latter is a local lifecycle command, bypasses
the native page-execution queue, and does not navigate or reveal a surface.

## Consequences

- User interaction cannot mutate the browser page while the assistant owns the
  current turn.
- Browser state remains device-local; no observer state is persisted server-side.
- A crashed/restarted local bridge may lose the in-memory turn marker. The next
  assistant command re-establishes it.

## Acceptance

1. During a running browser turn, mobile and desktop reject click, scroll,
   swipe, wheel, and keyboard page interaction.
2. Mobile miniature open remains read-only.
3. Normal interaction returns when streaming ends.
4. `request_user_action` opens the same retained profile interactively before
   the turn is resumed.
5. Assistant pointer and DOM actions continue to complete under the lock.
