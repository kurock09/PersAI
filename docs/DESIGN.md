# PersAI Design

## Purpose

This document defines the intended design language and product experience for PersAI.

It exists so implementation work does not drift into:
- generic dashboard UI,
- noisy “AI product” styling,
- overcomplicated enterprise admin visuals,
- raw engineering interfaces,
- or fragmented visual decisions across surfaces.

This is not only a visual guide.  
It is a product-experience guide for how PersAI should feel.

---

## Core Design Intent

PersAI should feel like:

- warm
- thoughtful
- calm
- premium
- human
- structured
- light
- trustworthy

PersAI should **not** feel like:

- a toy AI app
- a generic SaaS dashboard
- a raw prompt-engineering console
- a crypto-style “future UI”
- an overanimated Dribbble concept
- a dense enterprise backoffice
- a cold control panel
- a cluttered bot manager

### Short design formula

**Warm premium assistant SaaS**

### Even shorter internal anchor

**calm, warm, premium, human, uncluttered**

---

## Product Experience Goal

The user should feel:

- “I have my own assistant.”
- “This assistant is alive, but not chaotic.”
- “This product is thoughtful and reliable.”
- “I can understand what is happening.”
- “I can control important things without drowning in settings.”
- “This feels modern and premium, but not flashy.”

The interface should support:
- trust,
- continuity,
- clarity,
- and emotional comfort.

---

## Experience Principles

### 1. Assistant before interface chrome
The assistant should feel like the center of the product.  
Navigation, settings, status, and controls support that feeling.  
They should not overpower it.

### 2. Calm over noisy
The UI should breathe.  
Avoid cramped density, too many borders, too many cards, too many indicators, and too many competing highlights.

### 3. Warm over sterile
The product should not feel cold or purely mechanical.  
Use softness in spacing, rhythm, surface treatment, and tone.

### 4. Clear over clever
Do not optimize for novelty.  
Optimize for understanding.

### 5. Premium over decorative
The UI should feel high quality because it is disciplined, readable, and balanced.  
Not because it has visual gimmicks.

### 6. Truthful over magical
The product can feel smooth and elegant, but it must not hide important truth:
- publish/apply state,
- errors,
- limits,
- memory controls,
- delete semantics,
- assistant updates.

### 7. Consistency over one-off brilliance
A cohesive product is better than a few impressive screens and many mismatched ones.

---

## Visual Tone

### Target tone
- soft
- precise
- friendly
- adult
- composed
- capable
- slightly emotional
- not overly playful

### Emotional target
The product should feel like:
- a well-designed personal environment,
- not a loud tool,
- not a gaming interface,
- not a corporate intranet.

---

## Layout Philosophy

### Spacious, not empty
Use real breathing room.  
But do not make the product feel hollow or unfinished.

### Structured, not rigid
The layout should feel intentional and grid-aware.  
But it should not become stiff or bureaucratic.

### Clear hierarchy
Every screen should have an obvious reading order:
1. primary status or goal
2. main action area
3. supporting context
4. secondary details

### One main thing per screen
Each surface should have a dominant focal point.  
Avoid “everything important at once.”

---

## Typography

Typography should carry a lot of the premium feel.

### Principles
- strong hierarchy
- generous line-height
- avoid tiny dense text
- avoid too many font sizes
- use weight and spacing more than decoration

### Preferred feeling
- clean
- readable
- slightly refined
- stable
- not editorial-experimental
- not overly technical

### Rules
- headings should be clear and calm, not oversized for drama
- body text should remain highly readable
- helper text should be subtle but not weak
- status text should be concise and easy to scan
- avoid walls of small muted text

---

## Spacing

Spacing is one of the most important quality signals in PersAI.

### Rules
- prefer generous spacing over dense packing
- keep rhythm consistent
- similar component types should use similar spacing
- create calm through vertical rhythm
- avoid nested cramped containers

### What to avoid
- too many small stacked cards
- tiny gaps between unrelated blocks
- large random whitespace without hierarchy
- mixed spacing systems on different screens

---

## Surfaces and Containers

### Surface model
Surfaces should feel soft, quiet, and supportive.

### Desired qualities
- gentle layering
- subtle separation
- calm grouping
- not heavy boxed dashboards

### Rules
- do not overuse borders
- do not overuse shadows
- do not make everything a card if it does not need to be
- use containerization only when it improves comprehension
- surface hierarchy should remain simple

### Component feel
- rounded, but not cartoonish
- polished, but not glossy
- soft, but not vague

---

## Color Philosophy

This document does not lock exact colors, but it locks the behavior of color.

### Color should do these jobs
- establish warmth
- create hierarchy
- support meaning
- guide attention
- preserve calmness

### Color should not do these jobs
- create excitement for its own sake
- make the UI look “more AI”
- replace structure
- compensate for poor hierarchy

### Desired palette behavior
- quiet base
- restrained accents
- soft semantic states
- strong readability
- no harsh neon
- no over-saturated “AI gradients everywhere”

---

## Iconography

Icons should support clarity, not decorate emptiness.

### Rules
- use icons sparingly
- use icons consistently
- prefer meaningful icons over ornamental ones
- do not mix too many icon styles
- icons should not compete with text for attention

---

## Motion

Motion should be subtle and helpful.

### Motion should be used for
- transitions of state
- continuity
- reducing abruptness
- supporting streaming/chat flow
- clarifying expand/collapse or save/apply changes

### Motion should not be used for
- spectacle
- novelty
- attention farming
- making the product feel “more advanced”

### Desired motion feel
- soft
- fast enough
- unobtrusive
- reassuring
- never flashy

---

## Interaction Style

### General interaction tone
- clear
- predictable
- low-friction
- respectful

### Buttons and actions
- primary actions should be obvious
- dangerous actions should be unmistakable
- secondary actions should not visually fight primary ones
- repetitive small actions should feel light

### Confirmations
Use confirmations where the action is meaningfully destructive or state-changing:
- reset
- delete
- dangerous admin actions
- secret revoke
- ownership transfer

Do not over-confirm harmless interactions.

---

## Empty States

Empty states matter a lot in PersAI because they shape emotional trust early.

### Good empty states should be
- calm
- helpful
- forward-moving
- light

### Bad empty states are
- overly cute
- overexplained
- emotionally manipulative
- too technical

### Desired effect
The user should feel:
- “I know what to do next”
- not “the product is unfinished”
- not “I need to read a wall of guidance”

---

## Loading States

Loading should feel stable and intentional.

### Principles
- avoid sudden layout jumps
- keep hierarchy visible
- avoid flashing skeleton overload
- preserve user orientation

### Good loading behavior
- makes it clear what is loading
- keeps the screen coherent
- does not pretend finished content exists when it does not

---

## Error States

Error states must follow the product philosophy:
- human
- honest
- calm
- useful

### Error states should not be
- raw
- alarming without reason
- empty
- overly technical
- passive-aggressive

### The user should understand:
- roughly what failed
- whether it is temporary
- whether something still worked
- what they can do next

---

## Dashboard Design

The assistant dashboard is not just a dashboard.  
It is the home of the assistant.

### It should communicate
- assistant status
- current live condition
- assistant identity
- meaningful recent activity
- immediate actions
- product confidence

### It should not feel like
- a wall of widgets
- a chat app home page
- a metrics-first backoffice

### Layout priority
1. main assistant state/control block
2. assistant identity/summary block
3. meaningful supporting context
4. secondary data

---

## Editor Design

The assistant editor should feel powerful but not intimidating.

### The editor should be
- section-based
- readable
- calm
- progressive
- confidence-building

### It should not be
- one giant settings page
- a raw system prompt editor
- a wizard for everyday editing
- a maze of tiny toggles

### Important rule
Publish/apply truth must remain visible while editing.

---

## Chat Design

Web chat should feel:
- alive
- premium
- highly readable
- natural
- focused

### Chat should not feel like
- a terminal
- a developer console
- a generic support chat widget
- a cluttered sidebar-heavy messenger clone

### Priorities
- message readability
- composer clarity
- streaming smoothness
- stable rhythm
- clean action affordances
- strong but quiet list/sidebar model

---

## Memory and Tasks Design

Memory and Tasks surfaces should feel trustworthy and controllable.

### They should not feel like
- admin backoffice tools
- raw technical storage inspectors
- workflow engines

### They should feel like
- thoughtful assistant support panels
- understandable personal-control surfaces

### Design goal
The user should feel:
- “I can understand and control this”
- not “I’m operating a system internals console”

---

## Admin Design

Admin surfaces are allowed to be denser than user surfaces, but they still must remain calm and credible.

### Admin UI should feel
- serious
- reliable
- scanable
- intentional

### Admin UI should not feel
- visually punishing
- crowded
- color-shouting
- metric-chaotic

### Important distinction
Ops truth and business views should feel related, but not visually confused.

---

## Responsive Design

The product should stay elegant across screen sizes.

### Principles
- preserve hierarchy first
- collapse complexity gracefully
- do not cram full desktop density into smaller screens
- keep primary actions accessible
- keep assistant identity and state legible

---

## Accessibility Baseline

PersAI must feel premium through usability, not just aesthetics.

### Baseline requirements
- readable contrast
- visible focus states
- semantic structure
- keyboard accessibility where relevant
- no critical meaning conveyed only by subtle color differences
- no tiny unusable targets

---

## What Cursor Should Do

When working on frontend/design tasks, Cursor should aim for:

- warm premium assistant SaaS feel
- clean hierarchy
- generous spacing
- section clarity
- soft but disciplined surfaces
- subtle and meaningful motion
- minimal clutter
- visually calm state handling
- strong consistency across all screens

Cursor should improve:
- readability
- hierarchy
- cohesion
- trust
- polish

Cursor should preserve:
- lifecycle truth
- publish/apply truth
- product semantics
- architecture boundaries

---

## What Cursor Must Not Do

Cursor must not:

- turn the product into a flashy AI toy
- add decorative gradients everywhere
- overuse cards, shadows, and borders
- create dense dashboard walls
- expose raw runtime/bootstrap internals as UI
- make admin and user surfaces visually unrelated
- bury important state under aesthetic simplification
- replace clarity with trendy visual noise
- overanimate the interface
- invent new product features during design polish work
- break previous slices just to make the UI look different

---

## Design Checklist

Before considering a UI slice successful, check:

- Does it feel warm?
- Does it feel calm?
- Does it feel premium?
- Does it feel human?
- Is it readable?
- Is the main thing obvious?
- Is the spacing disciplined?
- Is it less cluttered than before?
- Does it preserve product truth?
- Does it still feel like one product?

If the answer is “no” to several of these, the slice is not done.

---

## Final Design Statement

PersAI should feel like a personal assistant product with emotional intelligence and operational maturity.

It should feel:
- elegant without showmanship,
- warm without cuteness,
- premium without arrogance,
- structured without stiffness,
- and human without losing system truth.

The interface should make users feel:
“I trust this assistant.”
“I understand what is happening.”
“This product was designed with care.”