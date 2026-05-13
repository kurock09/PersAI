# ADR-096: Admin UI density, hierarchy, and page-by-page redesign discipline

**Status:** Proposed  
**Date:** 2026-05-13  
**Relates to:** [ADR-038](038-admin-rbac-and-stepup-f2.md) (admin surface authority), [ADR-039](039-ops-cockpit-baseline-f3.md) (Ops Cockpit baseline), [ADR-040](040-business-cockpit-baseline-f4.md) (Business cockpit baseline), [ADR-080](080-admin-controlled-knowledge-authoring-and-skill-curation.md) (admin knowledge surface), [ADR-088](088-unified-notification-platform-control-plane-and-delivery.md) (Admin Notifications), [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md) (bounded-slice execution discipline)

## Context

The current PersAI admin UI has grown feature-by-feature across `System Overview`, `Runtime`, `Tools`, `Prompt Constructor`, `Knowledge`, `Skills`, `Plans`, `Billing Settings`, `Ops Cockpit`, `Business`, `Rollouts`, `Abuse Controls`, and `Notifications`.

The backend truth is increasingly solid, but the operator surface is visually inconsistent:

1. different pages use different density and spacing rules
2. too many blocks compete at the same visual importance
3. nested cards and inner borders create noise instead of structure
4. important operational controls are mixed with diagnostics and rarely-used fields
5. some UI rows appear to survive as historical or low-value presentation even when their backend importance is secondary

This is now a product quality issue, not a cosmetic afterthought. PersAI is founder-facing; admin screens should feel calm, dense enough to be efficient, and consistent enough that operators can trust what they are seeing.

## Goals

1. Make the admin UI feel like one coherent product, not several different internal tools.
2. Keep pages information-dense enough for fast operator work without becoming cramped or noisy.
3. Preserve backend truth while reducing presentation noise.
4. Separate primary operator actions from secondary settings and raw diagnostics.
5. Execute redesign safely, page by page, with explicit audit and user alignment before each slice.

## Non-goals

- A one-shot rewrite of the whole admin UI in one slice.
- Removing valid backend-backed functionality just because it looks visually heavy.
- Introducing fake marketing whitespace or oversized “dashboard” chrome that reduces usable density.
- Silent IA or workflow changes without first checking the affected page with the user.

## Decision

### 1. One admin visual system becomes explicit product truth

All admin pages must converge on one shared visual language:

- moderate density, not airy marketing spacing
- calm surfaces with fewer nested cards
- clear hierarchy between page summary, primary controls, secondary settings, and diagnostics
- one consistent rhythm for section spacing, headers, form rows, table rows, badges, and actions

Target feeling:

> compact, quiet, readable, operator-first

Not target feeling:

- sparse
- decorative
- “everything is highlighted”
- form-in-form-in-card-in-card noise

### 2. Preserve backend truth, compress presentation

The redesign rule is:

> preserve truth, compress presentation, hide rare controls, delete only dead backend seams

This means:

- if backend truth is active and useful, keep it
- if backend truth is active but rare, move it into `Advanced`, `Diagnostics`, or a collapsed section
- if backend truth is read-only, present it as compact operator status rather than a full control block
- if UI is only a leftover of no-longer-relevant backend behavior, remove it

### 3. Deletion rule: remove only backend-dead or operator-useless seams

UI may be removed only when at least one of these is true:

1. the backend no longer supports the field/workflow
2. the state is not actually actionable or observable in a meaningful way
3. the UI is only preserving historical implementation noise rather than current operator value

If the backend still owns real truth, the default is **not delete** but **repackage**.

### 4. Every page must be split into importance tiers

Each admin page should be restructured into these layers where applicable:

1. **Primary control**
   The few actions/settings operators need most often.

2. **Secondary settings**
   Real settings that matter, but not every visit.

3. **Diagnostics / backend truth**
   Logs, IDs, counters, health signals, provider refs, internal status, raw operator evidence.

4. **Danger zone**
   Destructive or irreversible actions only.

These layers must not all look equally loud.

### 5. Nested card noise should be reduced aggressively

The default page structure should be:

- a compact top summary or page intro
- a small number of strong sections
- fewer inner borders
- fewer repeated label/help-text wrappers

Avoid:

- card inside card inside card
- repeated miniature headers for every small control group
- many equally styled boxes that flatten visual hierarchy

### 6. Dense does not mean cramped

The target density rule is:

- less empty space than current “panel-heavy” admin pages
- tighter rows and shorter vertical rhythm where scanning matters
- enough spacing to preserve grouping and readability

The system should prefer:

- tighter tables
- shorter metadata rows
- smaller helper text
- less repeated explanatory copy

It should not prefer:

- giant section padding
- oversized form fields with little information value
- excessive blank area between small controls

### 7. Tables and lists are primary on operational pages

For operational pages, tables/lists are the main product surface and must dominate the layout.

This applies especially to `Admin > Ops`.

Specific current-direction decision for `Admin > Ops`:

- the user table is the primary surface
- row density should be increased
- the secondary name line under email should be removed from the default row presentation
- row height should be reduced so more rows fit on screen
- default page size target is 10 visible rows
- an explicit `online` status should be shown in the table
- sandbox-related blocks should be shortened and visually demoted relative to the user table

These are accepted direction anchors for the future Ops slice unless the backend audit proves a particular field is missing or named differently.

### 8. Page-by-page audit protocol is mandatory

Before touching any admin page, the agent must perform a bounded audit for that page:

1. inspect the live UI when access is available, otherwise inspect current page code and any supplied screenshots
2. inspect backend truth for the page’s controls, statuses, and workflows
3. identify:
   - what is primary
   - what is secondary
   - what is diagnostic only
   - what may be backend-dead or low-value
4. produce a short proposed layout/change summary
5. ask the user the unresolved trade-off questions
6. wait for alignment before editing

No page redesign should start from styling instinct alone.

### 9. Slice discipline

Admin redesign work must stay bounded:

- **large pages**: one page per slice
- **small pages**: several related pages may share one slice

For this ADR:

- `Plans`, `Ops Cockpit`, `Knowledge`, and likely `Skills` should be treated as large pages
- smaller or simpler pages may be grouped only when their interaction model is clearly similar and the user agrees

No “whole admin refresh” slice is allowed.

### 10. Workflow changes require explicit user alignment

If a redesign changes any of these, the agent must ask first:

- operator workflow order
- default visible fields
- action placement
- navigation grouping
- destructive-action exposure

Pure visual cleanup can proceed only after the page audit is shared and agreed.

## Execution order

Current recommended order:

1. `Admin > Ops Cockpit`
2. `Admin > Plans`
3. `Admin > Skills`
4. `Admin > Knowledge`
5. `Admin > Runtime` / `Admin > Tools`
6. remaining admin pages in grouped small slices only where safe

Rationale:

- `Ops` has the clearest primary surface and the strongest immediate usability pain
- `Plans` is the densest and noisiest page
- `Skills` and `Knowledge` are structurally rich and need hierarchy cleanup
- `Runtime` and `Tools` need consistency cleanup after the system is established

## Acceptance criteria

A page redesign under this ADR is acceptable only when:

1. the page feels visibly calmer and more ordered
2. primary controls are easier to find than before
3. active backend truth is preserved unless explicitly proven dead
4. diagnostics are still reachable without dominating the default view
5. spacing and row density match the shared admin system
6. the user agreed to the page’s proposed changes before implementation

## Consequences

### Positive

- Admin UI becomes consistent without losing operational power.
- Important operator workflows become faster because hierarchy is clearer.
- The team gets a repeatable redesign protocol instead of ad hoc visual tweaks.
- Backend truth remains protected while presentation becomes quieter.

### Negative

- Progress is intentionally slower because each page requires audit and alignment first.
- Some pages may keep legacy-looking sections temporarily until their dedicated slice arrives.
- The agent must stop and ask more often before editing page workflows.

## Alternatives considered

- **One large admin redesign in one slice.** Rejected: too risky, too easy to lose backend-backed truth.
- **Pure CSS polish without page audits.** Rejected: would reduce consistency problems only superficially and risks preserving bad hierarchy.
- **Aggressive removal of low-signal UI before backend audit.** Rejected: too likely to delete real operator value.
