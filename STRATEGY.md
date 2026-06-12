---
name: Copilot
last_updated: 2026-06-10
---

# Copilot Strategy

## Target problem

In most families one parent carries the cognitive labor of raising kids — noticing what needs attention before it's a problem, and tracking it over time. Those two phases (anticipate and monitor) are the ones couples *don't* share, and the non-default parent stays stuck because they lack the longitudinal mental model needed to know what's even worth anticipating.

## Our approach

Build a durable, family-specific context layer — the spine — and forecast the *non-calendar* items off it (the outgrown shoe, the approaching car-seat limit, the likely sleep regression), surfaced as a short weekly brief. We compete on the bookends (anticipate/monitor) that calendars and task apps don't touch, not the well-served middle (decide/do).

## Who it's for

**Primary:** The non-default parent (V1: Nick, solo). They're hiring Copilot to become a proactive partner — to anticipate or handle something *before* the primary planner has to surface it. The primary planner (Mika) is deliberately not a user until the system has already changed how the primary user shows up.

## Key metrics

- **Delight moments (North Star)** — the user anticipated or handled something the primary planner would otherwise have had to raise. Target: 4 logged in 8 consecutive weeks. Measured: `delight_log.md`, later the feedback channel.
- **Factual errors about a kid (counter-metric)** — any published item containing a wrong fact about a child. Target: zero. A single one is a permanent trust hit. Measured: structured per-brief log, diffed against context.
- **Suppression-leak rate** — share of published items that duplicate a kid's `things_we_already_know` or already-cleared milestones. Target: trending to zero. Measured weekly from the structured log.
- **Weekly read-through (Phase 2+)** — the brief is read without prompting each week. Measured: delivery channel. A ritual that isn't opened is a dead loop.

## Tracks

### The context layer (the spine)

The durable, hand-maintained per-family record — milestones, medical history, current edges, suppressions, gear. Every signal is derived from it.

_Why it serves the approach:_ Private-record fidelity is what makes a forecast feel uncanny rather than generic; it's the artifact that compounds.

### The engine surface

The forecasting modules that cross the knowledge base with the context to produce candidate signals (outgrowing, developmental windows, well-visit absence, vaccine prep, calendar cross-products). Adding engines is the highest-leverage way to widen value.

_Why it serves the approach:_ This is where public knowledge meets the private record — the actual mechanism of anticipation.

### The weekly loop (delivery → feedback → learning)

Getting the brief to land in a channel the user checks, capturing low-friction reactions, and translating those reactions back into context updates.

_Why it serves the approach:_ Turns a one-shot read path into a system that compounds and corrects itself.

## Not working on

- A tracker — no logging burden on the primary planner; we capture only what prediction requires.
- A task manager — items are anticipations, not to-dos with assignments and completion. _(Amended 2026-06-10: one bounded exception — time-critical, one-shot actions, e.g. order-by-date or book-the-appt, may carry a light "done?" state. Tracking is a privilege the system grants per item, never the default state of every item.)_
- A calendar — we read the family calendar, we don't replace it.
- A medical tool — we surface facts and defer to the pediatrician; no diagnosis or dosing.
- A chat surface — the channel is a notebook the user annotates, not a destination app. _(Amended 2026-06-10: the brief moves to a push-triggered web "week view" — a destination the user pulls into once a week via a thin nudge, not a daily-open app and not a conversational surface to feed. Nudge-not-app is the discipline; see `docs/brainstorms/2026-06-10-web-weekly-surface-requirements.md`.)_

## Marketing

**One-liner:** An anticipation engine for parenting mental load.

**Key message:** Calendars predict appointments. Copilot predicts everything else — the things one parent has been holding in their head, alone, for the life of every kid.
