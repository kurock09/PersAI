# ADR-145: Telegram-like chat-list archive and mobile row actions

## Status

**Implemented locally 2026-07-12.** Automated web/API verification is green;
logged-in mobile and desktop visual acceptance remains pending.

## Context

The web chat list already supported rename, archive, and hard delete, but every
viewport used a small portal menu and archived rows were filtered out entirely.
That made the touch target too small on phones, provided no native-feeling
archive gesture, and left no user path for browsing or restoring archived
history.

The mobile sidebar also owns pull-to-refresh. A Telegram-like hidden Archive
group therefore needs an explicit gesture order so archive reveal and refresh
do not compete.

## Decision

1. Chat-list interaction capability is pointer/hover based, not viewport width:
   - `(hover: hover) and (pointer: fine)` keeps the compact desktop portal menu
   - all other surfaces (phone, tablet, touch-first) use touch-first row actions
   - no user-agent or device-model classification is introduced
   - shell layout may still switch by viewport width; only chat-row actions follow
     pointer capability
2. Mobile active rows support an axis-locked left swipe. Crossing the threshold
   archives the chat through the existing archive API; vertical movement
   remains list scrolling.
3. Mobile archived rows support the inverse right swipe. Crossing the threshold
   restores the chat through
   `POST /api/v1/assistant/chats/web/{chatId}/unarchive`.
4. Restore is an explicit operation, not a toggle on the archive endpoint. The
   repository restores under a serializable transaction with the active-chat
   plan limit checked in the same transaction. A full limit returns HTTP 409.
5. On mobile, the enlarged three-dot target slides the row left to expose a
   premium inline `Delete | Rename` strip: no block fills, soft rounded chip,
   vertical divider, content-width padding. Delete uses bolder reddish text and
   still requires a second confirmation. Inline actions close on a second
   three-dot tap, outside tap, or 10 seconds without interaction. Opening
   another row naturally closes the previous row through the outside-pointer
   boundary. Desktop three-dot keeps opacity reveal without a hover circle
   (list rows are not pills).
6. Archived chats render as one collapsible group:
   - mobile hides the group until the first qualifying pull at scroll top;
     later pulls retain normal refresh behavior
   - desktop shows the compact group whenever it is non-empty
   - the group is absent when no archived rows exist
7. Archive, restore, rename, and delete continue to reload canonical chat-list
   truth after success. Gesture animation does not become a second data owner.
8. Mobile assistant name and New chat copy use 16px type. Mobile chat rows use a
   44px minimum height; desktop density remains unchanged.
9. Account-footer theme and language switchers use composer-height quiet
   icon/code-only pills on mobile (`h-11`, full half-width, `rounded-full`) and
   denser `md:h-9` on desktop — no under-pill “Theme/Language” captions. Active
   state stays near-white `surface-raised` without accent weight so hit targets
   improve without competing with the chat list.

## Consequences

- Archive history is now visible and reversible without weakening hard-delete
  confirmation.
- The pull gesture has deterministic ownership: hidden Archive reveal first,
  refresh afterward.
- Restore adds one public API route and quota-accounting source but no schema
  migration.
- A restore can fail with 409 when the active-chat cap is full; the row remains
  archived.

## Verification

- focused sidebar and pull-gesture tests cover typography, density, inline
  actions, delete confirmation, idle collapse, archive/restore swipes, archive
  group expansion, and reveal-before-refresh ordering
- API service tests cover successful restore quota refresh and active-cap
  rejection
- API and web typechecks
- full repository lint, format, and API/web typecheck gate before close

## Manual acceptance

1. On a phone, swipe an active row left and confirm the Archive action tracks
   the finger without triggering navigation or refresh.
2. Pull down at list top: Archive appears; tap it to expand archived chats.
3. Swipe an archived row right and confirm it returns to the active list.
4. Open row actions, verify only one row is open, delete confirmation is
   two-step, and timeout/outside tap closes the actions.
5. On a tablet/touch surface with width `>=600px`, verify ⋯ stays visible and
   opens inline Delete|Rename / swipe archive — not the hover-only desktop menu.
6. On a mouse/trackpad desktop, verify Archive is persistently available and
   row actions still use the compact popup menu.
