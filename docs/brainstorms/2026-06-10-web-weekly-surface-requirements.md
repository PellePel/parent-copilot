---
date: 2026-06-10
topic: web-weekly-surface
---

# Copilot Web Weekly Surface — Requirements

## Summary

Replace the Telegram-broadcast brief with a solo, web-based weekly surface. A thin Sunday push nudge links into a web "week view" that leads with a single high-novelty *non-calendar* forecast (the "oh man" item), shows critical upcoming events as a secondary strip, and lets Nick leave notes that compound into forecasts-with-actions rather than getting stored as receipts.

## Problem Frame

After ~2 weeks of real use, the intelligence layer is winning and the delivery layer is failing. The wins were all the same shape — Copilot surfaced something Nick didn't know *at the moment it mattered* (Jude's 6-month appt and Clem's 2.5-year appt that Mika hadn't raised, the peanut-allergen window timed right before the visit, age-based developmental and regression heads-up). The failures were all packaging: Telegram is buggy, the four reaction buttons are confusing and produce no visible result, the brief arrives as seven separately-long messages, and week-over-week the content barely changes. One real miss exposed a content gap too — Jude needs a larger sleep sack at 18 lb, and Mika caught it and texted rather than Copilot forecasting it.

The cost is that the product produces no *delight*. Nick named the feeling he's chasing precisely: **"I'm a better father / partner."** It has three flavors — blind-spot coverage ("I hadn't thought of that"), stress mitigation (a forecast that defuses something before it's a fire), and connection enablement (preparing him to engage his kids differently). The current surface actively suppresses those moments by burying them in noise and offering no way to engage so the system visibly compounds.

## Key Decisions

- **Push-triggered, web-engaged (not a destination app, not a pure broadcast).** A thin weekly nudge stays the ritual trigger; the web week view is where engagement and learning happen. This amends `STRATEGY.md`'s "not a destination app" non-goal: the discipline that keeps it from becoming an app is *nudge-not-app* — pull happens once a week via the nudge, not by daily self-initiated opens.

- **Lead with the non-calendar forecast; demote critical events to a strip.** Delight lives in what the calendar *doesn't* already tell you. A week view headlined by upcoming appointments would be a prettier calendar and risk landing as "interesting, so what." The single hero item each week is the highest-novelty non-calendar forecast; events sit below it as a glanceable strip.

- **Inputs compound into anticipations, never receipts.** A note must return forward value — a forecast plus a recommended action — not an echo ("you taught me this"). The sleep-sack note should come back as "Jude's gaining ~0.4 lb/week → he'll cross 18 lb around July 1; resurface the size to order two weeks before," not as a stored fact replayed.

- **Selective tracking cracks the "not a task manager" non-goal, deliberately.** Recommended actions are self-timed nudges that resurface and then auto-clear by default. The exception: time-critical / one-shot actions (order-by-date, RSVP, book-the-appt) get a light "done?" state so they don't slip. Tracking is a privilege the system grants per item, never the default state of every item — that discipline is what keeps it from sprawling into a to-do app.

- **Content leads with the delta.** Standing facts ("Clem is in a language-explosion window") produce the "oh man" once, then become wallpaper. The week view ranks by what's *newly true or newly relevant this week*, which is also the fix for week-over-week staleness.

- **Cheapest viable infra until product-market fit.** The nudge stays on Telegram (it already works as a one-line poke; "buggy" was about the seven-message brief and the four buttons, not the transport) and the web surface is hosted locally — both deliberately cheap, provisional choices to prove the bet. Expected to change once there's PMF (real push channel, hosted + multi-user-ready). This keeps build cost down and avoids over-investing in delivery before the experience earns it.

- **Reuse the existing machinery; this is mostly a new surface.** The feedback infrastructure the engagement loop needs already exists in the schema — `reactions` (the four-token grammar), `suppressions` (notably the `measurement_band` revalidation kind, which is exactly "watch his weight, resurface when it crosses"), `quarantines`, `factual_errors`, `delight_candidates`, and the per-item provenance on `brief_items` (`citedRecord`, `factTarget`, `triggerSource`, `confidence`, `priority`). The web app is largely a better surface over engine + spine + reactions that already ship.

## Key Flows

- F1. **Weekly loop.** Sunday: the brief engine generates the week's candidates → a thin nudge is pushed (one line, e.g. "This week: 2 new things for Jude & Clem") → Nick taps through to the web week view → he reads the hero forecast, glances the events strip, optionally leaves notes / grades items → engagement writes back to the spine and feedback tables → next week's ranking reflects it.

- F2. **Note → forecast → action loop.** Nick leaves a note (free-form fact or context, e.g. "bigger sleep sack at 18 lb") → the system reasons off it against the spine + measurements + knowledge base to derive a forecast and a recommended action → the action is held with a revalidation condition (e.g. `measurement_band` on weight) → it resurfaces in the week view at the right moment, then auto-clears, unless it's a time-critical one-shot, in which case it carries a "done?" state.

## Requirements

**Week view (the surface)**

- R1. The primary surface is a web page showing the current week, reachable by tapping the weekly push nudge.
- R2. The view leads with exactly one hero item: the highest-novelty *non-calendar* forecast for the week, drawn from the engine's candidates.
- R3. Critical upcoming events (appointments, well-visits, allergen/vaccine windows) render as a secondary, glanceable strip below the hero — never as the headline.
- R4. Items are ranked by novelty/delta — what is newly true or newly relevant this week — so a standing fact already surfaced in a prior week does not re-headline unchanged.
- R5. The view exposes a notes affordance for leaving free-form context against a kid or the family.
- R6. The view lets Nick grade / react to items, replacing the confusing four-button Telegram interaction with a web-native equivalent.

**The nudge**

- R7. A weekly push nudge fires (timing inherits the current Sunday-morning brief schedule) carrying a one-line teaser and a link into the week view — it is a poke, not the content itself.

**Compounding engagement**

- R8. A note compounds into a forecast plus a recommended action; it is never stored-and-echoed back as a bare fact.
- R9. A recommended action resurfaces at the moment it becomes relevant (via a revalidation condition such as a measurement band, milestone change, or date) and auto-clears when no longer relevant.
- R10. Time-critical / one-shot actions (order-by-date, RSVP, book-the-appt) carry a light completion ("done?") state; all other actions do not.
- R11. Grading and notes write back to the spine and feedback tables such that the following week's view reflects the engagement (item suppressed, corrected, or a new forecast appears).

**New content**

- R12. Add a weight/gear-threshold trigger class that forecasts gear transitions keyed to a measurement crossing (e.g. sleep-sack size at a weight, car-seat stage), not just to age.

## Acceptance Examples

- AE1. **Covers R2, R4.** Given a week where the only "new" things are two upcoming appointments and an unchanged developmental window already surfaced last week, the hero slot still shows a non-calendar forecast (e.g. the gear-threshold or a newly-relevant regression), and the unchanged window does not re-headline.
- AE2. **Covers R8, R9, R12.** Given Nick notes "Jude needs a bigger sleep sack at 18 lb" while Jude is 17.2 lb, the system returns a forecast with a projected crossing date and holds an "order size X" action that surfaces ~2 weeks before the projected date, then clears once logged/crossed — it does not replay "sleep sack (you told me)" the next week.
- AE3. **Covers R10.** Given a recommended action that is a dated one-shot (e.g. "order before July 1"), the item shows a "done?" affordance; given a recurring/ambient nudge (e.g. "Clem's in a peekaboo phase — try X"), no completion state is shown and it simply re-evaluates next week.
- AE4. **Covers R11.** Given Nick marks a hero item "already knew / irrelevant," that item (or its cited spine record) is suppressed so it does not re-headline next week.

## Scope Boundaries

**Deferred for later (eventually, not v1):**
- Mika / shared / multi-user access. The solo version must produce delight before the second user is brought in — this is the documented strategy sequence, not a hedge.
- Growth/gear *trend charts* as a hero feature (the gear-threshold *trigger* is in scope per R12; longitudinal visualization is not).
- The "Living Kid Card" framing (a per-kid persistent state surface) — the natural evolution once the loop is proven, but a larger build than v1.

**Outside this product's identity:**
- A full task manager. Selective tracking (R10) is a deliberate, bounded exception; general assignment, completion tracking, and to-do lists are not the product.
- A calendar replacement. Copilot reads the family calendar and competes on the non-calendar bookends; the events strip surfaces, it does not manage.
- A chat surface Nick has to feed. Notes seed forecasts; the surface is not a conversational assistant to converse with.

## Outstanding Questions

**Resolved (see Key Decisions — recorded here as the questions they answered):**
- **Nudge channel** → keep Telegram as the link-carrier. Revisit at PMF.
- **Hosting & auth** → host locally; the local-only deployment is its own gate (no public surface), so no auth model is built for v1. Revisit at PMF, when hosted + multi-user makes auth load-bearing.

**Deferred to planning:**
- The exact web-native interaction vocabulary that replaces the four reaction buttons (R6) — the engagement *intent* is decided; the specific affordances are a planning/design concern.
- How "novelty/delta" ranking (R4) is computed against prior-week briefs given the existing `briefs` / `brief_items` history.

## Sources / Research

- `STRATEGY.md` — target problem, the anticipate/monitor bookends, the "not working on" list (this doc amends the "destination app" and "task manager" lines, deliberately and explicitly).
- `src/lib/db/schema.ts` — existing feedback machinery the engagement loop reuses: `reactions`, `suppressions` (`measurement_band` revalidation), `quarantines`, `factual_errors`, `delight_candidates`, and `brief_items` provenance fields.
- `src/lib/engine/` — the candidate engines (outgrowing, developmental, vaccine_prep, allergen_window, cross_products, etc.) that produce hero-item candidates; R12 adds a weight/gear-threshold engine alongside these.
- North-star metric in `STRATEGY.md` ("Delight moments") is the direct success signal for this surface.
