# ADR-103: One-flow interactive landing demo system

## Status

Completed / closed (2026-06-07). Slice A landed the frontend demo system with stubbed replies and is the completed ADR-103 product scope. Slice B (public demo LLM endpoint) is **cancelled/deferred indefinitely** and is no longer an active backlog item, because it introduces a public unauthenticated trust/cost surface. If PersAI later needs a real public LLM landing demo, that work requires a new ADR with explicit abuse/rate-limit/credential/cost boundaries.

## Date

2026-05-30

## Relates to

ADR-072 (PersAI-native multichannel runtime), ADR-076 (cold-start visual continuity
and theme resolution via `html.light` + cookie), ADR-100 (project chat mode / B2B),
ADR-079/ADR-080 (knowledge + skills), ADR-044 (abuse and rate-limit enforcement),
ADR-055 (per-request tool credential isolation), ADR-003 (API contract policy).

## Context

### Product goal

PersAI is a calm, premium, adult, trustworthy personal-AI platform. The product
promise is "one assistant, one continuous workflow": chat, files, knowledge,
actions, and memory in a single experience. The current public landing
(`apps/web/app/page.tsx`) communicates this only through static type and static
schematic illustrations. It does not let a first-time visitor *feel* the product.

Founder decision: build a **new, professional, premium landing** whose first screen
is a **single, coherent, interactive demo flow** — not a noisy gallery of 4–6
separate feature demos. The demo must hold attention, keep one narrative thread,
and drive to the CTA. The guiding constraint is **convert, do not overload**: every
second of the demo should move the visitor toward "I understand the value → I want
my own PersAI → CTA".

Explicit anti-goals (founder, reaffirmed): no flashy marketing tricks, no neon /
sci-fi visuals, no fake "AI magic", no 3D gimmicks, no feature overload, no
toy-like pseudo-3D tilt. The earlier `WorkflowSurface` pseudo-3D schematic reads as
a "demo/toy", not as a real product, and is explicitly rejected as the visual
language.

### Current codebase audit (confirmed from code)

- **Stack:** Next.js 16 (app router), React 19, TypeScript, Tailwind v4 with CSS
  custom-property tokens in `apps/web/app/globals.css`, `framer-motion@12` (already
  a dependency, currently used only inside the app, not the landing), `next-intl`
  for all copy (`apps/web/messages/en.json` under `landing`), Clerk, `lucide-react`,
  `geist`. No GSAP / Rive / Lottie.
- **Landing:** `apps/web/app/page.tsx` composes server components in
  `apps/web/app/_components/landing/`: `hero-section`, `workflow-section`,
  `system-section`, `finale-section`, `landing-footer`. The entire landing is
  **100% server-rendered with zero client interactivity**; there is no `"use client"`
  in the landing tree. Animations are pure CSS keyframes (`fade-in`, `fade-in-up`,
  `scroll-cue`) defined in `globals.css`, all gated by
  `@media (prefers-reduced-motion: reduce)` where relevant.
- **Theme model (ADR-076):** dark is the default; light is opt-in via `html.light`
  + cookie. Tailwind's `dark:` variant is **re-bound** in `globals.css` to
  `&:where(html:not(.light), html:not(.light) *)`, NOT to `prefers-color-scheme`.
  All colors are tokens: `--chrome`, `--bg`, `--surface`, `--surface-raised`,
  `--surface-hover`, `--border`, `--text`, `--text-muted`, `--text-subtle`,
  `--accent` (sage), `--accent-hover`, `--accent-glow`, plus warm/cool/sage tints.
- **Real chat UI (the product to replicate):** `apps/web/app/app/_components/`.
  - `chat-message.tsx`: assistant message = `AssistantAvatar` (size `md`,
    `h-10 w-10 rounded-full bg-accent/15`) + plain text, **no bubble**,
    `justify-start`. User message = right-aligned (`justify-end`) bubble
    `rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-text md:px-4 md:py-2.5`.
  - `CHAT_FILE_PILL_SURFACE_CLASS`: existing neumorphic file-pill style for document
    artifacts (PDF/PPTX) — reused, not reinvented.
  - `app-shell.tsx`: bento layout — outer `bg-chrome`, panels with `md:gap-2 md:p-2`,
    main panel `bg-bg md:rounded-2xl md:border md:border-border`; sidebar left,
    content right; full-bleed on mobile.
  - `sidebar.tsx`: assistant header with status dot, "New chat", date-grouped chat
    rows, user card at the bottom.
  - `chat-area.tsx` (1045 lines) and `chat-input.tsx` (1448 lines) are heavily
    coupled to Clerk auth, the assistant API client, voice, and attachments — they
    are **not reusable** on a public landing; only their visual language is.
- **Routing / access:** `/` is public; `middleware.ts` protects only `/app`,
  `/admin`, and a few `/api/*` routes. Authenticated users are redirected to `/app`
  from `page.tsx`. There is **no public, unauthenticated LLM endpoint**.
- **LLM path:** `web (/api/v1 passthrough) → @persai/api → @persai/runtime →
  provider-gateway (/api/v1/providers/generate-text | streamText) → OpenAI/Anthropic`.
  Every existing path is auth + session + credential + billing gated. The
  provider-gateway `generate-text` requires a `credential { secretId, providerId }`.

### Constraints

- C1: The landing is server-rendered. The interactive demo must be a single
  `"use client"` island mounted inside the server hero; CTA and marketing copy stay
  server-rendered (SEO/LCP unaffected).
- C2: No public LLM endpoint exists. Real LLM in the hero requires a new public,
  rate-limited, capped endpoint — a new trust/cost surface (Slice B).
- C3: All copy flows through `next-intl`; demo script strings live in
  `messages/en.json` under `landing.demo.*`, never hardcoded.
- C4: Dark/light must both be first-class. Per ADR-076, colors must use tokens and
  the re-bound `dark:` variant; no raw hex outside the token system; the demo must
  be visually verified in both themes.
- C5: `prefers-reduced-motion` and a no-JS / pre-hydration fallback are mandatory.

## Decision

Build a new premium landing whose structure is:

```
Header
Hero        — live, fully interactive one-flow demo (the only Tier-1 surface)
Block 1     — Project mode (Skill + documents, B2B angle)   — Tier 2
Block 2     — Your knowledge base (sources + attribution)    — Tier 2
Block 3     — Media before/after reveal                      — Tier 2
System      — pillars + channels (kept)
Finale      — narrative close + CTA (kept)
Footer
```

### D1 — One-flow interactive hero demo (Tier 1)

A single client island renders a **faithful live replica of the real PersAI UI**
(exact tokens and component classes from `chat-message.tsx` / `app-shell.tsx`):
assistant messages without a bubble + avatar, user messages in the sage
`bg-accent/15 rounded-2xl rounded-br-md` bubble, document artifacts as the real
`CHAT_FILE_PILL` style, a real composer (`"Напиши что-нибудь…"`, mic + paperclip),
and an adaptive shell (full window with sidebar on desktop, thread + composer only
on mobile).

The hero runs a scripted **autoplay narrative** as one continuous thread, which the
visitor can take over at any time.

Autoplay narrative (one thread, calm, ~fast-to-value):

1. **Setup (assistant customization trailer):** a card assembles Aurora (preset
   avatar, name, warm tone, one skill) in ~2–2.5s with a sequential fade and a
   subtle "being configured" cue (field highlight → ✓). It is a deterministic,
   identical-for-everyone visual; **no real onboarding, no API, no state**. Purpose:
   show in two seconds that "this assistant is yours and configured by you".
2. **What I can do:** short, calm self-introduction.
3. **Action = document (B2B/work proof):** user prompt "summarize this PDF" →
   "Готовлю…" → a real PDF pill and a generated PPTX/summary pill drop into the
   thread.
4. **Memory:** user asks to remember a preference → a memory chip surfaces.
5. **Telegram continuity beat:** one calm step — the same thread continues in a small
   Telegram frame (reusing the existing `/landing/channels/telegram.png` asset).
   Reinforces "one assistant, every channel", not a separate feature block.
6. **Soft CTA beat:** an inline assistant CTA ("continue with your own PersAI →"),
   then idle → soft reset back to step 2.

A blinking composer placeholder ("…or type your own") signals takeover is possible
at every step.

### D2 — User takeover + guided suggestions + limited LLM

- On focus/typing the autoplay pauses immediately (no input conflict); the user's
  message is appended as a real user bubble.
- **Guided mode (Cursor-inspired):** after autoplay, present 2–3 curated
  suggested-prompt chips (e.g. "Summarize this PDF", "Remember my preferences",
  "Continue in Telegram"). This lowers friction, keeps the narrative on rails, and
  makes replies reliable for both stubbed and real-LLM modes. Free typing is allowed
  but the chips are the primary, premium path.
- **Reply source is abstracted behind a single `getReply()` adapter:**
  - Slice A: **stubbed** intent→reply mapping from `demo-script.ts` (deterministic,
    zero-risk, zero-backend).
  - Slice B was originally considered as a **real, capped LLM** stream via
    `POST /api/demo/turn`, but is cancelled/deferred indefinitely as of 2026-06-07.
- **Hybrid by design:** autoplay and the first frame are always scripted; the LLM is
  only ever invoked during takeover. The takeover request carries the demo context
  *up to the current step* (compact transcript + assistant state: "Aurora, warm,
  skill X, remembered: warm tones"), so the visitor continues the same session, not
  an empty chat.
- **Limits:** ≤3 LLM replies per session → `limitReached` → inline CTA → soft reset.

### D3 — State machine

Implemented with `useReducer` (no new dependency, no XState):

```
states: idle → autoplay → takeover → thinking → reply → limitReached → softReset → (autoplay)
context: { stepIndex, replyCount, messages[], phase, lastInteractionAt }
events:  TICK · USER_FOCUS · USER_SEND · REPLY_DONE · IDLE_TIMEOUT · RESET
```

- `idle` starts autoplay after a short delay; `autoplay` plays `demo-script` steps.
- Any `USER_FOCUS`/`USER_SEND` → pause → `takeover` → `thinking` → `reply`.
- `replyCount >= 3` → `limitReached` (inline CTA).
- idle ≥ ~9s, or after the CTA, → `softReset` (fade) → `autoplay` from step 2.

### D4 — Lower blocks: Tier-2 micro-interactive on scroll

The old 6 pseudo-3D scenes are replaced by **3 premium product-window blocks**
(Cursor-style: a real product window on a calm in-brand backdrop, alternating
left/right with copy), each **flat and front-facing — no 3D tilt**. Depth comes from
soft shadows and layering only.

- **Block 1 — Project mode (Skill + documents, B2B):** a project-mode window (reusing
  the real `project-files-panel` visual language) showing skills + project files +
  a finished document artifact. Message: "the assistant works inside your project,
  with its own skills and files."
- **Block 2 — Your knowledge base:** a window with sidebar chats + a Sources panel,
  the reply highlighting which source it used. Message: "answers grounded in your
  knowledge, and you can see the source" (trust).
- **Block 3 — Media before/after reveal:** a real photo revealed before→after (calm
  warm edit). Message: "not only text — works with media, and you can see what is
  happening."

**Tier-2 = light interactivity on scroll** (plain Russian definition kept for the
team: the block comes alive when scrolled into view — a short one-shot
auto-animation, not a full live chat; play once, calm; subtle hover-parallax on
desktop only; autoplay-on-view via IntersectionObserver on mobile; reduced-motion →
final frame immediately).

### D5 — Tiered interactivity (performance + maintainability discipline)

- Tier 1 (Hero): one fully live surface (autoplay + takeover + LLM).
- Tier 2 (Blocks 1–3): scroll-triggered one-shot micro-interactions, lazy-mounted.
- Tier 3: static (backdrop, typography).

Only the in-view surface animates. Blocks lazy-mount via IntersectionObserver. This
prevents the "everything fully live like the hero" scope/perf blow-up while keeping
the whole page feeling alive.

### D6 — Dark / light premium discipline (mandatory)

- All colors MUST use existing tokens (`--accent`, `--surface-raised`, `--text*`,
  warm/cool/sage tints). No raw hex outside the token system.
- Use the re-bound `dark:` variant (`html:not(.light)`), never `prefers-color-scheme`
  (ADR-076).
- The demo replica must reuse the exact neumorphic shadow recipes already in the
  codebase (`SCHEMATIC_FRAME`/`SCHEMATIC_CARD` patterns, `CHAT_FILE_PILL`) so it
  reads identically premium in both themes.
- Every new surface is verified in both `dark` (default) and `html.light` before a
  slice is declared clean, including artifact pills, sidebar, composer, and backdrop.

### D7 — Slice B: public demo LLM endpoint (cancelled/deferred indefinitely)

This was the historical design for a narrow public endpoint that would bypass the runtime turn
stack and call provider-gateway directly:

```
web HeroDemo → POST /api/demo/turn (@persai/api, public, unauthenticated)
   → provider-gateway generate-text/streamText (dedicated demo credential, fixed system prompt)
```

Hard guardrails:

- Stateless text-in/text-out only: no session, memory, tools, files, or billing.
- IP rate-limit (reuse ADR-044 enforcement), ≤3 turns/session, small
  `maxOutputTokens`, a cheap model, and a fixed demo system prompt ("you are the
  demo PersAI on the landing page; brief and calm").
- Streaming via the existing gateway `streamText` for the premium "typing" feel.
- Graceful fallback to the scripted stub on any error/limit/timeout.

Because this would add a new public, unauthenticated trust surface and a new dedicated
credential, it is not active ADR-103 work. Reviving it requires a new ADR with
`docs/API-BOUNDARY.md` / `docs/DATA-MODEL.md` updates and abuse-surface review
against ADR-044/ADR-055 in the same slice.

## File structure

Add:

```
apps/web/app/_components/landing/demo/
  hero-demo.tsx          "use client" island shell (renders by state)
  demo-window.tsx        adaptive PersAI-replica shell (sidebar + thread + composer)
  chat-atoms.tsx         shared ChatBubble / AssistantRow / ArtifactPill / MemoryChip / ChannelFrame
  demo-script.ts         scripted steps + intent→stub-reply rules (i18n keys)
  use-demo-machine.ts    useReducer state machine + context
  use-idle-timer.ts      autoplay start + soft-reset on idle
  use-typewriter.ts      text typing (reduced-motion → instant)
  get-reply.ts           reply adapter: stub now → /api/demo/turn in Slice B
  block-project.tsx      Block 1 (Tier 2)
  block-knowledge.tsx    Block 2 (Tier 2)
  block-media.tsx        Block 3 (Tier 2)
  use-in-view-once.ts    IntersectionObserver one-shot trigger
  hero-demo.test.tsx     state-machine transition tests
```

Modify:

- `apps/web/app/_components/landing/hero-section.tsx` — mount `<HeroDemo strings={…} />`
  (server passes i18n strings as props).
- `apps/web/app/_components/landing/workflow-section.tsx` — replace the 6-scene
  gallery with the 3 Tier-2 blocks.
- `apps/web/app/_components/landing/workflow-surface.tsx` — retire pseudo-3D; extract
  reusable atoms into `demo/chat-atoms.tsx` (single source of truth) or remove.
- `apps/web/messages/en.json` — add `landing.demo.*` and `landing.blocks.*`.

Cancelled Slice B would have added an `/api/demo/turn` route (web BFF) + a public
demo-turn service in `@persai/api`, plus demo credential wiring. This is not active
work after the 2026-06-07 closure.

## Motion, accessibility, and mobile rules

- **Motion:** framer-motion for bubble/chip entrance (`AnimatePresence`); CSS/typing
  for text. All entrance offsets small (8–12px) and one-shot. No looping ambient
  motion. `prefers-reduced-motion` → instant final state everywhere.
- **A11y:** thread is `aria-live="polite"`; composer is focusable with a visible
  focus ring; a "pause demo" control is provided; suggested-prompt chips are real
  buttons; the autoplay never traps focus or hijacks scroll.
- **Mobile:** adaptive window (no sidebar); no hover — interactions are tap or
  autoplay-on-view; blocks lazy-mount on scroll; images via `next/image` with correct
  sizes; the hero demo does not open the mobile keyboard without an explicit tap.
- **No-JS / pre-hydration:** the hero renders a static first frame (a single
  assistant message + CTA) so the page is meaningful before/without hydration.

## Execution model (agent-orchestrated)

This ADR is executed by **subagents**, not by the orchestrator directly. The
working model mirrors the ADR-102 session:

- **Orchestrator (senior-engineer role): writes no production code.** It decomposes
  each slice into self-contained agent tasks, dispatches a coding subagent
  (`claude-4.6-sonnet-medium-thinking` or an equivalent) per task with a complete,
  context-bearing prompt (the subagent cannot see this chat), then **diff-reviews the
  result and runs the verification gate** before the task is accepted.
- **One task = one bounded agent prompt** with: explicit scope, exact files to
  add/modify, the real classes/tokens to reuse (cited from this ADR), acceptance
  criteria, and the verification commands to run.
- **Verification gate (per AGENTS.md), run/confirmed by the orchestrator after each
  task** that touches `apps/web`:
  1. `corepack pnpm -r --if-present run lint`
  2. `corepack pnpm run format:check`
  3. `corepack pnpm --filter @persai/web run typecheck`
  4. `corepack pnpm --filter @persai/web run test` (focused on the touched files)
  Cancelled Slice B would additionally have run `@persai/api` typecheck + focused tests.
- **Sequencing:** tasks run in the documented order; a task is dispatched only after
  its predecessor is accepted. Independent tasks (e.g. i18n copy authoring) may run in
  parallel subagents when they do not touch the same files.
- **Discipline carried into every subagent prompt:** reuse real tokens/classes (no raw
  hex), honor the re-bound `dark:` variant (ADR-076), verify both themes, keep
  `prefers-reduced-motion` + no-JS fallback, no dead stubs / TODO scaffolding, do not
  alter unrelated landing styling.

The orchestrator owns docs updates (`SESSION-HANDOFF`, `CHANGELOG`, and this ADR's
status/slice checkboxes) at slice boundaries.

## Slice plan (agent-executable tasks)

Each `A#`/`B#` below is a single dispatchable subagent task. Status legend:
`[ ]` not started · `[~]` in progress · `[x]` accepted.

- **Slice A — Frontend demo system (no backend, no risk): COMPLETE.**
  - `[x]` **A1 — Shared chat atoms + retire pseudo-3D.** Extracted `AssistantRow`,
    `UserBubble`, `ArtifactPill`, `MemoryChip`, `ChannelFrame` into
    `landing/demo/chat-atoms.tsx` using the real `chat-message.tsx` classes/tokens
    (+ `chat-atoms.test.tsx`). (Pseudo-3D `workflow-surface.tsx` was retired later in
    A5, once the 3 blocks replaced its only consumer.)
  - `[x]` **A2 — Adaptive `demo-window` replica.** Built the PersAI-replica shell
    (`DemoWindow`/`DemoSidebar`/`DemoComposer`, bento `bg-chrome`/`bg-bg`, sidebar
    desktop-only, thread, composer) on tokens (+ `demo-window.test.tsx`); verified dark
    + `html.light`.
  - `[x]` **A3 — State machine + script.** `demo-script.ts` (steps + `classifyIntent` →
    `getStubReply` rules, i18n keys) + `use-demo-machine.ts` (`useReducer`) +
    `use-idle-timer.ts` + `use-demo-machine.test.ts` (27 transition tests).
  - `[x]` **A4 — `HeroDemo` island.** Autoplay → takeover → stubbed reply →
    `limitReached` → soft reset; suggested-prompt chips; mounted in `hero-section.tsx`
    (responsive 2-col grid, copy → demo → CTAs) + static first-frame fallback
    (+ `hero-demo.test.tsx`).
  - `[x]` **A5 — Tier-2 blocks.** `block-project.tsx`, `block-knowledge.tsx`,
    `block-media.tsx` + `use-in-view-once.ts` (one-shot IntersectionObserver); replaced
    the 6-scene `workflow-section` gallery with the 3 blocks; **deleted**
    `workflow-surface.tsx` (grep-confirmed sole importer) (+ `blocks.test.tsx`).
  - `[x]` **A6 — Polish + i18n + fallbacks.** `landing.demo.*` / `landing.blocks.*`
    copy (en + ru); reduced-motion for ambient loops (scroll-cue + thinking pulse),
    no-JS static first frame (+ test), hardcoded aria-labels → i18n, mobile
    single-column pass, full both-theme browser pass (light + dark hero + all 3 blocks).

  **Slice A deviations from the original file plan (recorded honestly):**
  - `use-typewriter.ts` was **not created**; text reveal uses framer-motion entrance +
    a calm thinking indicator instead of a per-character typewriter (calmer; honors
    `prefers-reduced-motion`). The "…or type your own" affordance is the real composer
    placeholder, not a blinking typewriter.
  - `get-reply.ts` adapter was **not yet extracted**; Slice A calls `getStubReply()`
    from `demo-script.ts` directly inside `HeroDemo`. The previously planned Slice B
    `getReply()` seam is cancelled/deferred indefinitely and is not active work.
  - `block-media.tsx` uses a **token gradient before/after composition** (cool→warm
    clip-path wipe), not a real photo. The swap point is the named
    `PHOTO_AFTER_LAYER_CLASS` / `PHOTO_BASE_CLASS`; dropping in a real `next/image`
    asset is a follow-up visual-polish item.
  - The hero CTAs render **once** in the DOM (responsive grid `lg:row-span-2`), not
    duplicated per breakpoint.
  - `ChatBubble` was split into the more accurate `AssistantRow` (no bubble) +
    `UserBubble` (right-aligned bubble), matching `chat-message.tsx` exactly.
- **Slice B — Public demo LLM endpoint (cancelled/deferred indefinitely; no active follow-up):**
  - `[~]` **B1 — Endpoint + service.** `POST /api/demo/turn` (web BFF) + public
    demo-turn service in `@persai/api` → provider-gateway `generate-text`/`streamText`,
    dedicated demo credential, fixed system prompt, `maxOutputTokens` cap, ≤3 turns.
  - `[~]` **B2 — Abuse hardening.** IP rate-limit (ADR-044) + review against ADR-055;
    bot/origin guards.
  - `[~]` **B3 — Wire real reply.** Stream into `get-reply.ts` behind a feature flag,
    with stub fallback on error/limit/timeout.
  - `[~]` **B4 — Boundary docs.** Update `docs/API-BOUNDARY.md` + `docs/DATA-MODEL.md`.

  **Closure note (2026-06-07):** these items are intentionally not active work. The stubbed interactive landing demo is the accepted completed shape for ADR-103. A real public LLM endpoint would be a new public attack/cost surface and must be designed in a new ADR if the product later needs it.

## Consequences

### Positive

- A first-time visitor *experiences* "one assistant, one workflow" in seconds, using
  the real product UI — maximizing trust and conversion.
- One coherent narrative instead of a noisy feature gallery; calm/premium preserved.
- Clean seam: a single client island; SSR/SEO/LCP unaffected; copy stays in i18n.
- Stubbed replies let the landing demo ship with deterministic UX, zero backend cost,
  and no public unauthenticated LLM surface.
- Dark/light correctness is enforced by reusing tokens and existing shadow recipes.
- Tiered interactivity keeps performance high and the system maintainable by a small
  team (change data, not code, to evolve the script/blocks).

### Negative

- A new always-mounted client island on the landing increases hero JS weight
  (mitigated: small island, lazy-mounted blocks, no heavy deps beyond existing
  framer-motion).
- A future real public LLM demo would introduce a public, unauthenticated trust/cost
  surface; ADR-103 deliberately does not carry that work forward.
- Premium polish (typography rhythm, timings, artifact quality) needs a few visual
  iterations; "build once and forget" is explicitly not the bar.
- Replacing the 6-scene gallery removes some breadth; mitigated by the System section
  retaining pillars + channels.

## Alternatives considered

- **Keep static landing + a marketing video.** Rejected: video adds weight, drifts
  from light/dark theming, and is less honest/trust-building than the live UI.
- **Real LLM in the hero as MVP (no stub).** Rejected: no public
  endpoint exists; network latency/errors would damage the calm first impression and
  break the curated narrative. The real LLM Slice B path is cancelled/deferred
  indefinitely as of 2026-06-07.
- **Keep the pseudo-3D `WorkflowSurface` language.** Rejected: founder judges it
  toy-like and not premium; replaced by flat product-window blocks.
- **Make all lower blocks fully live like the hero.** Rejected: heavy and slow,
  especially on mobile; Tier-2 scroll-triggered micro-interactions deliver the
  "alive" feel at a fraction of the cost.
- **XState for the machine.** Rejected: `useReducer` is sufficient and avoids a new
  dependency.
