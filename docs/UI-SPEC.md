# UI-SPEC

## Status

Approved baseline for product UI redesign. Replaces current test-shell in `app-flow.client.tsx`.

---

## Product feeling

The assistant is not a tool. It is a companion.

The user should feel emotional attachment, not utility satisfaction. Think Tamagotchi, not calculator.

### Three pillars of the product feeling

1. **Attachment** — the assistant feels alive. It greets you, remembers, has personality and mood. You care about it. It is not a blank prompt window.
2. **Ritual** — the user comes back daily not because they "need to" but because they want to check in. Daily digest, proactive messages, continuity signals ("We've been working together for 47 days").
3. **Show others** — viral by design. Share card for social ("Meet my assistant"), "Powered by PersAI" in messenger bots, invite flow for friends.

### Long-term product direction

One assistant, everywhere. Not separate apps for food/home/calendar — one personality, one memory, one interface. Each new capability (food ordering, smart home, calendar) is a tool governed through the existing tool catalog and capability envelope. The user says "tell your assistant" — the assistant figures out the rest.

---

## Design direction

- **References:** ChatGPT (chat UX), SpaceX (density, dark, engineered), Apple (cleanliness, premium)
- **Theme:** dark mode default, light mode backup (user toggle)
- **Target:** open launch for strangers — UI must explain itself in 30 seconds
- **Mobile:** responsive web (sidebar collapses to hamburger), not native app in MVP
- **Emotional design:** assistant card shows subtle state (active/thinking/resting), greeting on open, memory continuity signals, personality visible at all times

## Tech stack

- Tailwind CSS — utility-first styling, dark/light theme support
- shadcn/ui — component library on top of Radix UI, full code ownership
- Framer Motion — animations (typing, slide-over, transitions, streaming text)
- react-markdown + rehype/remark plugins — markdown rendering in chat (code highlighting, tables, math)

---

## Routes

```
/                         → auth screen (sign in/up + motivational tagline)
/app                      → main layout: sidebar + chat area (default: new chat)
/app/chat/[threadId]      → specific web chat thread
/app/setup                → assistant creation (character builder)
/admin                    → admin layout (separate premium layout, role-gated)
/admin/plans              → plan management
/admin/ops                → ops cockpit
/admin/business           → business cockpit
/admin/rollouts           → rollout controls
/admin/notifications      → notification channels
/admin/runtime            → runtime provider settings
```

Modal windows: integration settings (Telegram/WhatsApp/MAX), confirm dialogs (delete, reset, rollback).

---

## Auth screen (`/`)

- No landing page
- Centered auth form (Clerk)
- Short motivational text above: platform tagline + 1-2 lines about the product
- Dark, premium, minimal elements

---

## Assistant creation (`/app/setup`)

First-time flow after auth when no assistant exists. This is the "wow moment".

### Flow: guided conversation + character builder

1. **Name** — text field, placeholder "Name your assistant"
2. **Avatar** — preset gallery (12-16 stylish abstract/human-like options) + upload own image
3. **Guided personality** — 2-3 questions from the platform:
   - "What should your assistant help you with?"
   - "How should it communicate?"
   - Answers are used to generate draft persona (`instructions`)
4. **Character traits** — 4-5 sliders:
   - Formal ↔ Casual
   - Concise ↔ Detailed
   - Serious ↔ Playful
   - Reactive ↔ Proactive
   - Neutral ↔ Warm
5. **Live preview** — sample phrase from the assistant based on current trait settings
6. **Create** → creates assistant + auto-publish + redirect to `/app` with first chat

### Backend notes

- Traits stored as structured JSON in assistant draft (new fields or structured prefix in `draft_instructions`)
- Avatar stored as URL reference (upload target TBD: local or object storage)
- Guided answers converted into `instructions` text by frontend before `PATCH /assistant/draft`
- Backend field additions for traits/avatar are expected but not blocking — frontend can store locally until backend catches up

---

## Main layout (`/app`)

### Sidebar (left, ~280px, collapsible on mobile via hamburger)

Top to bottom:

#### 1. Assistant card
- Small round avatar, name, status indicator (Live / Draft / Failed)
- Click → opens settings slide-over on the right

#### 2. New chat button
- Prominent, above chat list

#### 3. Web chats
- Grouped by date: Today / Yesterday / Previous 7 days / Older (ChatGPT style)
- Three-dot menu on hover: Rename, Archive, Delete
- Active chats visually emphasized

#### 4. Messenger history (below web chats)
- Visually muted section
- Readonly — cannot compose messages here
- Messenger icon + preview per item
- For viewing chat history from Telegram/WhatsApp channels

#### 5. Integrations
- Mini cards for each messenger:
  - Telegram: icon + status (Connected / Not connected)
  - WhatsApp: icon + "Coming soon"
  - MAX: icon + "Coming soon"
- Click → modal window for integration settings

#### 6. Limits
- Compact line: usage bar or percentage (token budget, active chats)
- Minimal, non-intrusive

#### 7. User
- Avatar, display name, logout button
- Anchored at sidebar bottom

---

### Chat area (main, right side)

#### Header
- Current chat title (editable inline) or "New chat"
- Small assistant avatar

#### Message stream
- Streaming with character-by-character typing animation
- Markdown rendering:
  - Code blocks with syntax highlighting + copy button
  - Tables
  - Bold, italic, inline code, lists
  - LaTeX/math
  - Collapsible long outputs

#### User messages
- Right-aligned, dark bubble

#### Assistant messages
- Left-aligned, with assistant avatar
- Action icons below message (subtle, appear on hover):
  - Copy
  - "Don't remember this" — delicate icon (crossed-out brain or similar), tooltip explains
  - Regenerate (UI-ready; backend endpoint is follow-up work)
  - Like/dislike feedback (UI-ready; backend is follow-up work)

#### Activity badges
- Compact inline badges between or below messages:
  - Tool usage: "Used web search", "Ran code" (icon + text, expandable)
  - System: "Assistant updated", "Platform update applied"

#### Input area
- Bottom-anchored, multi-line textarea with auto-resize
- Send button (or Enter to send)
- Stop button visible during streaming
- Attach button (UI-ready, no backend yet)

#### Error/degradation
- Inline in chat: human-friendly messages (from existing `toWebChatUxIssue` classifier)
- No raw stack traces or technical internals

---

## Assistant settings (slide-over, right side)

Opens on click of assistant card in sidebar. On mobile: fullscreen.

### Sections (ordered by "humanization" priority)

#### 1. Character (hero section, top)
- Large editable avatar, name, status badge
- "Edit personality" button → expands character trait sliders + instructions textarea

#### 2. Quick actions
- Publish / Rollback / Reset buttons with confirmation dialogs
- Current version number + apply status indicator

#### 3. Memory
- Memory Center: list of remembered items, forget button, search/filter
- Visually muted — important but not the hero

#### 4. Tasks
- Tasks Center: active/inactive items, pause/stop/enable controls
- Compact layout

#### 5. Channels
- Links to integration modal windows (same as sidebar integrations)

#### 6. Limits & Plan
- Usage bars, plan name, upgrade CTA placeholder

#### 7. Publish history
- Compact version list with timestamps

---

## Admin (`/admin`)

- Separate layout, same design system, denser/more compact
- Own sidebar with admin section navigation
- Access gated by admin role (hidden entirely if no admin role)
- Premium but functional — a working tool, not a showcase
- Sections:
  - Plans (create/edit/manage)
  - Ops Cockpit (runtime/health/apply status)
  - Business Cockpit (usage/commercial signals)
  - Rollouts (progressive rollout/rollback controls)
  - Notifications (webhook channel management)
  - Runtime Settings (provider keys, models — H1b surface)
  - Abuse Controls (unblock/override)

---

## Theme

### Dark mode (default)
- Background: deep dark (#0a0a0f / #111118 range)
- Accent color: TBD at implementation (blue/purple/teal candidates)
- Text: white/light gray hierarchy
- Cards/surfaces: subtle elevation with very light borders

### Light mode (backup)
- Toggle in user menu
- Clean white/gray palette
- Same component structure, inverted color tokens

---

## Future product features (post-UI-redesign)

### In-character upsell (plan/quota hints through assistant personality)

When the user hits a quota limit, capability gate, or active chat cap, the assistant responds in-character instead of showing a dry system error.

Example (playful persona): "I'd love to keep going, but I'm running low on energy this month. Want to unlock more of my abilities? I could do so much more for you..."

Implementation path:
- New message kind: `author=assistant, kind=upsell_hint` (governance-triggered, not a normal chat turn)
- Personality-flavored text generation: denial reason + persona traits → in-character message (template engine or one cheap LLM call)
- Works in web chat and Telegram/WhatsApp channels — assistant stays in-character everywhere
- Backend needs: new message type in chat domain, integration with existing enforcement denial responses, traits-aware text generation service

### Admin assistant (platform management companion)

Admin gets their own assistant with extended tool access for platform operations. User assistants remain sandboxed.

- **User assistant scope:** chat, memory, tasks, personal tools only — never sees beyond own workspace sandbox
- **Admin assistant scope:** ops cockpit queries, business cockpit insights, rollout suggestions, proactive alerts ("3 assistants have failed apply, want to reapply?", "Quota pressure is high, time to review plans?")
- Architecture fit: same assistant entity, different tool catalog scope — admin tools are allowed only for admin role codes via existing per-tool allow/deny in capability envelope
- Backend needs: admin-scoped tool definitions in tool catalog, admin API read tools for OpenClaw consumption, role-gated tool activation rules

---



- Native mobile app
- Full landing page / marketing site
- Billing/payment integration UI
- Collaborative/shared assistant UX
- Multi-assistant UX
- Advanced transparency / chain-of-thought viewer
- Full admin audit log viewer (list-only is acceptable)

---

## Relation to existing backend

All user-facing API endpoints already exist. The UI redesign is a frontend-only effort that consumes the same backend contracts:

- Auth: Clerk (existing)
- Assistant lifecycle: `POST/GET/PATCH /assistant/*` (existing)
- Chat: `POST /assistant/chat/web/stream`, `GET /assistant/chats/web`, etc. (existing)
- Memory: `GET /assistant/memory/items`, `POST .../forget`, `POST .../do-not-remember` (existing)
- Tasks: `GET /assistant/tasks/items`, `POST .../disable|enable|cancel` (existing)
- Integrations: `GET/POST/PATCH /assistant/integrations/telegram/*` (existing)
- Plan visibility: `GET /assistant/plan-visibility` (existing)
- Admin: all `/admin/*` endpoints (existing)

New backend fields needed (follow-up):
- `assistant.draft_avatar_url` or equivalent for avatar persistence
- `assistant.draft_traits` or structured JSON for character trait sliders
- Regenerate endpoint (retry last assistant turn)
- Like/dislike feedback endpoint
