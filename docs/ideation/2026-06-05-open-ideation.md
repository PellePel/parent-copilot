---
date: 2026-06-05
topic: open-ideation
focus: open-ended ideation across the whole Copilot project
mode: repo-grounded
---

# Ideation: Copilot — open-ended

## Grounding Context

**Codebase Context.** Copilot is an AI anticipation engine for parenting mental load. V1 is single-user (Nick, the non-default parent). A TypeScript/Node scheduled pipeline (no web app): SQLite + Drizzle for append-only operational records; `family_context.json` as narrative state ("the spine"); Anthropic SDK for cross-products reasoning + prose polish; Google Calendar OAuth for absence detection. `npm run generate-brief` loads context → fetches calendar → runs 7 trigger engines per kid (outgrowing, developmental windows, well-visit absence, vaccine prep, allergen window, medication follow-up) → Claude cross-products reasoning → assembles/dedups/ranks (cap 3–7) → optional polish → persists a markdown brief + structured log.

Notable patterns: belt-and-suspenders suppression (deterministic + semantic against `things_we_already_know`); provenance discipline (every candidate cites exact data + KB source); append-only measurements (trajectory is the signal); unified `Candidate` shape; current_edges boost.

**Top gaps:** Phase 2 (delivery + feedback) NOT shipped — brief sits in a file, no channel, no feedback capture, no loop closure. Context maintenance is manual (hand-edit `family_context.json`). No learning loop yet.

**Strategy (STRATEGY.md).** Build a durable family-specific context layer (the spine) and forecast non-calendar items off it, surfaced as a short weekly brief. Compete on the bookends (anticipate/monitor), not the well-served middle (decide/do). Three tracks: the context layer (the spine), the engine surface (adding engines = highest-leverage expansion), the weekly loop (delivery → feedback → learning). North Star: delight moments (non-default parent anticipates before the primary planner raises it; 4 in 8 weeks). Counter-metric: zero factual errors about a kid. Not building: a tracker, task manager, calendar replacement, medical tool, or chat surface.

**External context (web research, value: high).** Family organizers (Cozi, FamilyWall) = zero prediction. Trackers (CDC, BabySparks) = logging-first. Huckleberry SweetSpot (narrow sleep prediction off a private log) proves parents pay for anticipation. Willo (35 dev phases, "heads up + a plan") is the closest ideological competitor but chat-based and excludes gear/medical logistics. **Confirmed white space:** no product crosses a private child biometric record + authoritative clinical schedules + physical-world anticipations into one anticipation layer. Clinical sources (CDC milestones, AAP periodicity/immunization, NHTSA car-seat thresholds) are authoritative but PDF-only/unstructured — structuring them is itself a moat. Cross-domain analogies in play: CRM next-best-action tiering, inventory reorder-point, predictive maintenance, behavioral-finance nudges, aircraft airworthiness directives, subscription-box phase sequencing, population-health early-warning.

**Past learnings (cross-domain engineering patterns; no parenting-domain learnings exist yet — Copilot has no docs/solutions/):** sample real evidence before accepting a model claim; confidence as anchored rubric not a float; pipeline-stage separation; script produces / model presents (deterministic math is also an accuracy guard); stateful workflows need explicit state machines re-checked at each transition.

## Topic Axes
- Spine capture & maintenance — getting the family record in and keeping it fresh; killing the manual-JSON burden.
- Engine breadth & forecasting — new anticipation types and better prediction (growth velocity, baseline-deviation, more KB domains).
- Trust & accuracy guardrails — provenance, suppression, confidence scoring, the zero-factual-error counter-metric.
- Delivery & feedback loop — channel, read-through ritual, low-friction reaction capture → context update (the unshipped Phase 2/3).
- Relationship & multi-actor dynamics — the non-default parent's behavior change, delight measurement, eventual primary-planner involvement.

## Ranked Ideas

### 1. Ship the weekly loop: delivery channel + deterministic reaction→spine-diff
**Description:** Ship the unbuilt Phase 2/3. Deliver the brief to a channel (Telegram planned) with a fixed reaction grammar per item (✓ handled / 🔕 already knew / ✗ wrong about my kid / "tell me more"); each token maps deterministically to a spine operation — no LLM on the loop-closure hot path. The brief annotation IS the spine update. Suppressions are re-validated at generation time ("does this still hold?") rather than carried forward as permanent state.
**Axis:** Delivery & feedback loop
**Basis:** `direct:` "Phase 2 (delivery + feedback) NOT shipped — brief sits in a file, no channel, no feedback capture, no loop closure" + learning #6 (annotation→spine-update→next-brief is a state machine; re-check at generation time).
**Rationale:** Without a channel the product is a file generator. This is the keystone — five of the other six survivors sharpen or only work once the loop exists. Converged in 7/8 raw clusters.
**Downsides:** Telegram dependency; the reaction grammar must be right early; state-machine discipline needed to avoid the dismissed-item-resurfacing bug class.
**Confidence:** 95%
**Complexity:** Medium
**Status:** Explored

### 2. Baseline-deviation engine + persisted per-kid baselines
**Description:** Add the one engine class no generic product can replicate: detect departures from each child's own established pattern (wake time drifted 90min, growth-velocity inflection, feeding-cadence change), framed as a watch-item ("unusual for him — a regression may be forming"), never a diagnosis. Persist each kid's learned "normal" as first-class spine fields so every future anomaly engine reuses the same baseline substrate.
**Axis:** Engine breadth & forecasting
**Basis:** `direct:` flagged leverage point "baseline-vs-deviation detection (wake time shifted 90min, unusual for his pattern)" + `external:` predictive-maintenance (growth data = the sensor) and Huckleberry SweetSpot (parents pay for anticipation off a private time series).
**Rationale:** Every current engine crosses public knowledge with the record; none mines the record against itself. Maximally defensible — impossible without the private spine.
**Downsides:** Needs enough history to define "normal"; false-anomaly risk; must stay strictly on the "watch item, not diagnosis" side of the medical-tool line.
**Confidence:** 80%
**Complexity:** Medium-High
**Status:** Unexplored

### 3. Reorder-point dated forecasting with lead time + compliance window
**Description:** Replace fuzzy "entering the window" booleans with auditable dated forecasts computed deterministically in TypeScript: fit velocity to the append-only measurement series, compute the threshold-crossing date, subtract a procurement lead time, surface as a window with a soft start ("hits the car-seat weight limit ~Aug 12 ±10d; order the next size in ~2 weeks"). Frame as a compliance window opening, not a panic deadline.
**Axis:** Engine breadth & forecasting
**Basis:** `external:` inventory reorder-point (ROP = forecast usage during lead time + safety stock) + aircraft airworthiness (threshold + compliance window) + behavioral-finance (surface 2–4 weeks ahead); `direct:` append-only "trajectory is the signal"; learning #5 (date/size math in code can't hallucinate).
**Rationale:** Turns the most concrete anticipations from population-average guesses into child-specific, defensibly precise forecasts — the "uncanny not generic" the strategy bets on.
**Downsides:** Sparse/noisy measurements make velocity unstable; safety margins need tuning; depends on a regular weigh-in cadence.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. Verify-before-ship accuracy gate + wrong-fact quarantine
**Description:** Make the zero-factual-error counter-metric an enforced pipeline stage. Before assembly, re-derive each candidate's cited fact from the current spine record + KB source named in its `reasoning` string; drop or downgrade anything whose citation can't re-bind. Make "✗ wrong about my kid" a first-class reaction that quarantines the source spine record across all engines (blast-radius containment), not just dismisses the one item.
**Axis:** Trust & accuracy guardrails
**Basis:** `direct:` counter-metric "zero factual errors… a single one is a permanent trust hit" + provenance discipline + learning #1 ("did you check?").
**Rationale:** The cheapest insurance against the single failure the product cannot survive.
**Downsides:** Brittle citation-binding could over-suppress valid items; adds a pipeline stage; quarantine needs a correction/un-quarantine path.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 5. Instrument delight → feed engine ranking
**Description:** Replace the hand-kept `delight_log.md` with a signal derived from the reaction stream: an item tapped "handled" before the next brief and never previously raised by Mika records a candidate delight moment tagged with the engine + spine records that produced it. Feed it back as a ranking boost for that engine class — the North Star becomes a per-family training signal, not just a scoreboard.
**Axis:** Relationship & multi-actor dynamics
**Basis:** `direct:` North Star definition; `delight_log.md` (4 / 8 weeks) is hand-tracked; assembler already ranks by rawScore+confidence and boosts current_edges.
**Rationale:** You can't optimize a metric measured by hand; this reveals which engines actually produce relational payoff for this couple.
**Downsides:** Delight is sparse (4 in 8 weeks) — thin signal, overfitting risk; requires idea #1 first.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 6. Self-maintaining spine: in-brief gap questions + staleness decay
**Description:** Kill the manual-JSON burden by routing capture through the weekly read. Each generation: (a) flag spine facts whose freshness has likely expired given the kid's age/velocity, degrading the confidence of forecasts built on them; (b) surface the 1–2 highest-value gap questions the engine most needs answered ("last weight is 6 weeks old — confirm?", "did peanut intro happen?"). The spine grows from one-tap confirms/corrections, never from remembering to log. Calendar-as-sensor and external-summary reconciliation are future capture sources feeding the same confirm-don't-author flow.
**Axis:** Spine capture & maintenance
**Basis:** `direct:` "context maintenance is manual (edit family_context.json by hand)" named as top pain + constraint "no logging burden on the primary planner."
**Rationale:** Maintenance becomes a byproduct of a ritual that already exists, and the system tells you what to refresh instead of asking you to remember everything.
**Downsides:** Question fatigue if uncapped (hold to 1–2, highest-value-first); staleness heuristics need tuning per fact type.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 7. Structured, versioned clinical-knowledge layer (the KB moat)
**Description:** Turn the authoritative-but-unstructured sources (CDC milestones, AAP periodicity/immunization, NHTSA car-seat thresholds — all PDF-only, no public API) into a structured, versioned, citable KB module every engine queries. A one-time data-engineering cost that lowers the marginal cost of every future engine and turns the annual schedule update into a version diff, not a code rewrite.
**Axis:** Engine breadth & forecasting
**Basis:** `external:` web research — "authoritative sources are largely unstructured/non-queryable — a moat opportunity in structuring them"; AAP schedule "updated annually"; `direct:` KB is hand-curated in `src/lib/kb/`.
**Rationale:** Shared infrastructure: structure once, every current and future engine benefits, and it's a defensible asset competitors must each rebuild.
**Downsides:** Upfront parsing/sourcing cost; ongoing maintenance when schedules change (mitigated by versioning); risk of over-investing in infra before the loop (#1) proves value.
**Confidence:** 80%
**Complexity:** Medium-High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | One-Sentence Brief | Pressure-test extreme, too austere as a standing change; better as a brainstorm variant on brief length. |
| 2 | Mika-as-Day-One-User / inverted brief | V1 is deliberately single-user (Nick); scope shift from stated V1. Strong brainstorm seed, not a now-improvement. |
| 3 | Start the loop from Mika (thin signal) | Premature for single-user V1; the measurable half is absorbed by survivor #5. |
| 4 | Diplomatic handoff protocol | Distinctive but overlaps the Relationship survivor; really a brief-voice brainstorm angle. |
| 5 | Adaptive cadence + foraging-theory brief budget | Lower-leverage tuning; partially folded into survivor #1's delivery design. |
| 6 | Calendar-as-sensor spine inference | Folded into survivor #6 as a future capture source. |
| 7 | External-summary reconciliation (portal/nanny texts) | Depends on integrations not yet built; premature. Folded into #6. |
| 8 | Spine fork-points (new engine backfills history) | An implementation principle for #2/#3/#7, not a discrete product idea. |
| 9 | Suppression-as-asset (negative-knowledge moat) | Absorbed into survivor #1 — suppressions are the loop's structured output. |
| 10 | Anchored confidence + tiered recall-pool/precision-brief | Partly absorbed into #3 (compliance window) and #4 (gate); standalone overlaps. |
| 11 | Logistical dependency chains (transition → research/buy/install/fit) | Genuinely interesting but edges toward the "not a task manager" identity line; flag as a careful brainstorm, not a default build. |
| 12 | $0 deterministic brief (LLM optional) | Valuable architecture principle, largely realized by #3 + #4's deterministic cores; cross-cutting, not standalone. |
| 13 | Subscription-box phase sequencing | Folded into #2/#3 (phase-relative, trajectory-driven timing). |
