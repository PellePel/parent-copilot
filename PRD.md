# Co-Pilot

*An anticipation engine for parenting mental load*

**Product Requirements Document — V1**
May 2026 • Author: Nick

---

## TL;DR

Co-Pilot is a weekly anticipation engine that surfaces what a family's kids will need attention on in the coming days — especially the things that aren't on any calendar. It targets the bookends of cognitive labor (anticipating and monitoring), which is where the mental load actually lives, rather than the middle (deciding and doing), which is already well-served by calendars and task apps.

V1 ships as a Sunday-morning briefing emailed to both parents, driven by a trigger engine over each kid's age, recent measurements, and the family calendar. Of the three trigger sources, **Lookahead is the wedge** — it cross-references the longitudinal record we're building against developmental knowledge and the family calendar (including notable *absences* from the calendar), surfacing items a parent couldn't get from Lucie's List + Google Calendar.

Success looks like: each weekly brief contains at least one item that genuinely surprises the non-default parent — something they hadn't thought to think about — every week, for four weeks running.

---

## The problem

### What we're solving

In most families, one parent (statistically usually the mother) carries the majority of the cognitive labor of raising children: noticing what needs attention, tracking what's been done, holding the longitudinal model of each child in their head. Research from Daminger (2019) breaks this cognitive labor into four phases: anticipate, identify options, decide, monitor. The imbalance isn't uniform across phases. Couples tend to share "decide" and partially share "identify options." They do not share "anticipate" and "monitor." Those phases — the bookends — are where the invisible load lives.

The non-default parent is usually willing to help, but lacks the mental model required to know what needs anticipating. They become reactive to delegation rather than proactive partners. The default parent stays exhausted; the non-default parent stays uninformed; both feel some version of stuck.

### Why existing tools don't solve it

- **Shared calendars** (Cozi, Google Calendar): solve the "decide / do" phase. They don't generate the things that go on the calendar.
- **Trackers** (Huckleberry, Hatch, Nara): log data passively but don't synthesize. They tell you what happened, not what's coming.
- **Task apps** (Todoist, Things): still require the default parent to identify and assign the task. The cognitive load is unchanged.
- **General-purpose AI** (ChatGPT, Claude): can answer questions, but doesn't hold longitudinal context about your specific kids. Requires the user to know what to ask.

The gap is a system that holds the model of your family and proactively surfaces the next things worth thinking about — to the parent who would otherwise not think of them.

### Who this is for

- **Primary user:** the non-default parent. Wants to be a more proactive partner. Has bandwidth and willingness but not the mental model. A 2-minute Sunday read is the right form factor.
- **Secondary user:** the default parent. Doesn't need the system for themselves — they already know what's coming. They benefit by being able to externalize what they're holding, and by their partner showing up more proactively.
- **V1 user:** me. Two kids, ages ~2.5 and ~6 months. I am the non-default parent. My wife is the default parent. We are the validation case.

---

## The insight

Calendars predict appointments. Almost no system predicts the non-calendar items: when a toddler will outgrow her shoes; when an infant is approaching the weight limit of his car seat; when a child is entering a developmental window where a sleep regression is statistically likely; when the season is about to require sunscreen, swimwear, or rain gear that doesn't fit anymore.

Those non-calendar items are the hook. They are what make the system feel like it knows the family. They are also what the default parent has been holding in their head, alone, for the entire life of every kid.

And most of them are forecastable. The mental load that feels uniquely human is, in large part, predictable from two inputs: each kid's age and the date on the calendar. Pediatric guidance, developmental milestones, vaccine schedules, seasonal needs, and growth-driven gear replacement are all derivable from those variables alone. What's left — the family-specific context, the temperament of each kid, what the pediatrician said last visit — is the long tail, capturable in a small amount of structured data plus a free-form notes field per kid.

The system isn't magic. It's structured knowledge applied to a longitudinal record. But applied to the right phase of the cognitive labor cycle (anticipate), it removes the load the default parent has been carrying alone.

---

## V1 scope

### What V1 is

A weekly briefing, delivered Sunday morning by email to both parents, with 3–7 items per brief. Each item names the kid it concerns, gives one-line context, and suggests an action when relevant. Items come from three trigger sources, each clearly labeled internally for evaluation purposes.

### The trigger sources

V1 has three trigger sources, but they are not equal. **Lookahead is the wedge** — it's the only trigger that cross-references the longitudinal record we're building against developmental knowledge and the family calendar (including notable *absences* from the calendar). It's the only one that surfaces items a parent couldn't get from Lucie's List + Google Calendar. The other two give the brief breadth, but they are not the reason this product exists.

| Source | Role | What it surfaces | Examples |
|---|---|---|---|
| **Lookahead** | **The wedge** | Non-calendar predictions for this specific family: outgrowing forecasts, developmental windows opening, calendar-cross-products, and notable calendar absences | "Clem's shoes were purchased 11 weeks ago; toddlers her age typically need new shoes every 2–3 months"; "Maine trip in 3 weeks — Jude has outgrown last summer's swim diapers"; "Jude is in the 6–9 month window where stranger anxiety often starts"; "Jude is age-due for a 6-month well-visit but nothing is on the calendar" |
| Schedule | Supporting | Upcoming items from AAP well-visit schedule, CDC vaccine schedule, and Google Calendar — with relevant context | "Jude's 6-month well-visit Tuesday: expect DTaP, polio, PCV, Hib" |
| Seasonal | Supporting | Month-indexed and weather-driven needs | "Heading into June — last year's sunscreen and swimwear no longer fit either kid" |

If Lookahead fails — false positives, low surprise, items the default parent already knew — V1 fails, regardless of how well the other two perform. Note that Lookahead is multi-source by design (outgrowing record + developmental KB + calendar events + calendar absences); each input alone is too sparse to grade weekly, which is why we ship them together (see Build plan, Phase 2).

### What V1 is not

Permanent positioning (we will not become these things):

- **Not a tracker.** We don't want logging burden on the default parent. We capture only what's required for prediction: ages, periodic measurements, gear-purchase dates.
- **Not a task manager.** No assignments, no to-dos, no completion tracking. Items are anticipations, not tasks.
- **Not a calendar.** We read from the family calendar; we don't replace it.
- **Not a medical tool.** We don't diagnose, dose medication, or interpret growth percentiles. We surface facts and suggest talking to the pediatrician.

Deferred to post-validation (added later if validated):

- Mobile app. Email + browser is enough for V1. React Native is a V2 decision once the weekly brief is proven.
- Real-time / push notifications. Weekly cadence proves the model first.
- Voice input. Want it eventually; not required to prove the concept.
- Accounts and auth. V1 is config-file based: kids and recipients in YAML.
- Photo extraction of pediatrician after-visit summaries. Manual data entry for V1 — Claude vision over photos is the obvious next capture-flow improvement, but not required to prove the brief works.
- Multi-family / sharing with extended family, nannies, daycare. Single-couple scope.

---

## Architecture

### System shape

Co-Pilot is a Python-based pipeline, not a web app. It runs on a schedule (Sunday 7am), reads from a SQLite database and a few external sources, assembles a brief via Claude, and emails it to the recipients. The "frontend" in V1 is the user's inbox.

#### Components

- **Longitudinal record (SQLite).** Kids, measurements over time, events (well-visits, illnesses, gear purchases), past briefs, feedback. Measurements are append-only — we never overwrite — because trajectory is the signal.
- **Knowledge base (YAML).** Age-indexed milestones, AAP well-visit schedule, CDC vaccine schedule, seasonal triggers, outgrowing model parameters. Hand-curated and version-controlled. The accuracy of the system rests on this.
- **Trigger engines.** Three modules — Lookahead (multi-input: outgrowing record + developmental KB + calendar events + calendar absences), Schedule (AAP/CDC schedules + Google Calendar pass-through), Seasonal (month-indexed) — each producing candidate brief items independently. Each item carries provenance (which trigger fired, what reasoning, what data informed it).
- **Brief assembler.** Ranks candidates by priority and confidence, drops duplicates, asks Claude to rewrite into clean parent-readable prose. Outputs a structured Brief object.
- **Delivery.** Resend (or similar) for HTML email to both parents. One-tap feedback links per item.
- **Feedback / eval.** Each brief item is rateable: hit / already-handled / irrelevant / surprise. Feedback goes back into the database and feeds eval metrics.

### Tech choices

- TypeScript on Node.js (latest LTS). `tsx` for running scripts directly. No web framework — this is a scheduled pipeline, not a web app.
- SQLite via `better-sqlite3`. File on disk, no server.
- Drizzle ORM for schema and queries. Type-safe, lightweight, good DX for the small number of tables we have.
- Zod for runtime validation of LLM outputs and external inputs.
- Anthropic SDK (`@anthropic-ai/sdk`) for Claude. Structured output for the assembler.
- Resend for email.
- Cron (Mac) for early scheduling; GitHub Actions when we move to cloud.
- Private GitHub repo for source (`PellePel/parent-copilot`). No public exposure during validation.

### Data model

The model is intentionally small. Six tables: kids, measurements, events, briefs, brief_items, feedback. Detailed schema lives in the repo (`src/db/schema.ts`); the high-level shape:

- **Kid:** id, name, dob, pediatrician, daycare, notes (free-form context fed into prompts).
- **Measurement:** kid_id, type (weight_kg, shoe_size_us, clothing_size, etc.), value, measured_on, source. Append-only.
- **Event:** kid_id, type (well_visit, vaccine, milestone, gear_purchase, illness, note), occurred_on, description, JSON metadata.
- **Brief:** id, generated_at, week_of, recipients.
- **BriefItem:** id, headline, body, suggested_action, trigger_source, trigger_detail, reasoning, confidence, priority. Provenance is mandatory; that's how we eval.
- **Feedback:** brief_item_id, rating, optional note.

---

## Success metrics

Validation happens in two stages with different bars, because the brief itself isn't measurable per-week (Lookahead signal is too sparse to grade weekly) and adding the partner is gated on the system working for the non-default parent first.

### Stage 1 — MVP done bar (solo, 8 weeks)

> Over 8 consecutive weeks of solo briefs, log at least **4 delight moments**: situations where the brief surfaced an upcoming need for Clem, Jude, or the family; I acted on it or raised it proactively with my wife; and she responded with delight, relief, or surprise.

This measures **behavior change**, not engine output. The brief is doing its job if it consistently turns me into a more proactive partner in ways my wife notices. The bar can be hit before my wife is ever added as a recipient — she's reacting to me, not to an email.

**Capture mechanism:** `delight_log.md` in the repo. One entry per moment:
- Date
- What the brief surfaced (item headline + trigger source)
- What I did
- What my wife said or did

No entry, no count. If the bar feels like vibes, it'll dissolve. Four entries in 8 weeks is the gate to Phase 5+ (cloud, feedback infrastructure, wife as recipient).

### Stage 2 — V1 north star (post-MVP, after wife joins)

> Each weekly brief contains at least one item my wife rates as a "surprise" — something she would not have otherwise been thinking about — every week, for four weeks running.

This measures the **brief as an artifact** for the non-default parent's direct experience. It requires her as a recipient, structured rating capture (Phase 6), and enough runway for cross-source signal density to emerge (likely 8-12 weeks of total runway including misses).

If the system can't hit this, we don't have a product, we have a calendar. If it can, we have something genuinely new.

### Supporting metrics (Stage 2, once ratings are captured)

At n=2 users, percentages are theater. V1 tracks two counts:

- **Surprise count** — items rated "surprise" per brief. Target: **≥1 per brief**, every brief.
- **False-positive count** — items rated "irrelevant" or that contained a factual error about the kids. Target: **0 per brief** ideally; **≤1 per brief** as a soft ceiling. False positives kill trust faster than misses bore the user.

Percentage-based metrics (hit rate, false-positive rate, open rate) come back when N > ~30, not before.

### Behavioral metrics (qualitative, both stages)

- Did I initiate any planning conversation this week that was triggered by the brief?
- Did my wife feel less burdened with reminding me this week?
- Was anything in the brief wrong or misleading?

### What we are NOT measuring in V1

- Engagement minutes, session length, DAU/MAU — wrong vocabulary for a weekly ritual.
- Number of items completed — not a task manager.
- NPS — not enough users, premature.
- Per-brief surprise rate during MVP — Lookahead signal is too sparse to grade weekly; the delight log is the MVP measurement.

---

## Build plan

Phases are ordered, not time-boxed. The Lookahead engine is multi-source by design — outgrowing alone fires too rarely (multi-month cycles) to be validated on its own. The whole engine ships in Phase 2 and runs together. Per-phase gates are engineering checks, not product validation. Real validation happens in Phase 4+ against the Stage 1 bar (4 delight moments over 8 weeks).

### MVP (Phases 1–4)

Goal: a weekly brief I can read in my own inbox, generated manually, that drives enough behavior change to log 4 delight moments over 8 weeks.

#### Phase 1 — Foundation

- Repo, Python env, SQLite schema, Pydantic models.
- `add_kid`, `log_measurement`, `log_event` CLIs.
- Add Clem and Jude with current sizes, recent measurements, and gear-purchase dates.

*Engineering check:* data round-trips correctly through the CLIs.

#### Phase 2 — Lookahead engine (full)

Build incrementally, but the phase doesn't ship until all three signal sources feed the brief together. Outgrowing alone is too sparse to grade; calendar context is where weekly density comes from.

- **Outgrowing predictions:** shoes (Clem), clothing sizes (both), carseat weight limit (Jude). Each driven by event log + measurements + outgrowing KB.
- **Google Calendar integration:** OAuth read-only setup, fetch upcoming 14 days, detect age-due milestones that are *absent* from the calendar.
- **Developmental windows:** hand-curated YAML KB (~20–30 items, 0–36 months) covering sleep regressions, separation/stranger anxiety, motor and language milestones.
- **Brief assembler:** ranks candidates from all three sources, drops duplicates, asks Claude to rewrite into clean prose with provenance attached.
- Run locally; print to console + write to `briefs/YYYY-MM-DD.md`.

*Engineering check:* each source fires correctly on test data with no hallucinated items; provenance is attached to every brief item; the Maine-trip and missed-appointment patterns from the trigger-source examples both produce items when their conditions are met.

#### Phase 3 — Schedule + Seasonal supporting triggers

- Schedule trigger: AAP well-visit cadence + CDC vaccine schedule, surfaced as upcoming items based on each kid's age (deduped against Google Calendar).
- Seasonal YAML knowledge base (month-indexed).
- Brief now draws from all three trigger sources.

*Engineering check:* same as Phase 2 — sources fire correctly, no dupes against Calendar items.

#### Phase 4 — Email delivery

- Resend setup, HTML template.
- Send to self only. Manual weekly run.
- Iterate on layout until a brief reads cleanly on phone and desktop.

**MVP done bar:** run weekly for 8 weeks. Maintain `delight_log.md`. Phase 5+ unlocks when ≥4 delight moments are logged (see Success metrics, Stage 1).

### Post-MVP (Phases 5–7)

Gated on hitting the Stage 1 bar. If MVP doesn't produce enough delight moments, the answer isn't to add more infrastructure — it's to fix the engine.

#### Phase 5 — Cloud + scheduling

- GitHub Actions cron job, environment variables, secrets.
- First Sunday brief lands in my inbox without me running anything.

#### Phase 6 — Feedback loop + eval

- Per-item feedback links (hit / handled / irrelevant / surprise).
- Webhook or reply-to parsing to capture feedback.
- `eval/score.py`: surprise count and false-positive count per brief, broken down by trigger source.

#### Phase 7 — Add my wife + run against the north star

- Pre-launch conversation with her (see R4 protocol).
- Add second recipient. Identical brief initially; diverge based on her feedback.
- Run against the Stage 2 north star (≥1 surprise per brief, 4 consecutive weeks) — likely 8–12 weeks of total runway including misses and recalibration.

---

## Risks and how we're managing them

#### R1: The brief is right but boring

If V1 only surfaces what we already knew (well-visit Tuesday, summer is coming), it fails both bars — Stage 1 (no delight moments to log) and Stage 2 (no surprises for the non-default parent to rate). *Mitigation:* delight count is the early eval (MVP). If MVP ends with fewer than 4 logged delight moments, the assembler prompt or the trigger ranking is wrong — not the data layer. Don't paper over it by moving into Phase 5+.

#### R2: The brief is surprising but wrong

Worse failure mode. If we tell someone Clem needs new shoes when she doesn't, or that Jude has a developmental concern when he doesn't, we lose trust permanently. *Mitigation:* every brief item must carry its reasoning ("we said this because X, Y, Z"). Anything in the medical/developmental space must explicitly defer to the pediatrician. No diagnostic claims. No dosing. False-positive count is the second metric for a reason.

#### R3: We end up building another tracker

The temptation to add "log Jude's naps" creeps in quickly. *Mitigation:* when scoping any new feature, ask — does this require the default parent to do new work? If yes, the answer is no.

#### R4: The default parent gets a system that surveils her instead of supports her

This is the most likely failure mode and the one with the highest cost. If my wife experiences this as another thing demanding her attention, or as me tracking her parenting, the project ends — and possibly causes harm beyond the project. The validation needs a real protocol, not a vibe check.

*Pre-launch (before any brief is sent to her).* A 30-minute conversation. Share the one-page summary, not the full PRD. Explicit agreement on three things: (1) all data entry is mine — she has no homework, no logging, no rating obligation; (2) she sees the brief, not the database; (3) she has unilateral veto over any item or the entire project, at any time, with no justification required.

*Week 1 check-in (15 minutes).* Three questions, in this order:
1. Did this feel like a tool helping me, or a tool tracking you?
2. Did anything in the brief feel wrong or off about our kids?
3. Was anything in the brief actually useful to you, or is it just for me?

*Week 4 check-in (15 minutes).* Same three questions, plus:
4. If I asked you whether to keep going, what would you say?
5. What's the one thing that would make this better — or worth stopping?

*Kill conditions.* Any one of these ends the project, no debate: (a) she says any version of "this feels weird" or "this is too much"; (b) she corrects a brief item as factually wrong about our kids on two consecutive weeks; (c) she stops opening the email. Don't ship more features through these conditions. The point of the kill conditions is to act on them, not catalog them.

#### R5: I get bored before validation

Real risk: this is a side project and there's no external pressure. *Mitigation:* ship the phase milestones publicly (blog or notes), and don't add scope until two consecutive briefs hit the north star metric.

---

## Open questions

Only the ones that affect near-term decisions. Cadence A/B-ing, auto-suppression of trigger categories, and multi-family expansion all depend on feedback volume we won't have for months — those go to a backlog, not this doc.

1. **Should the default parent get a different brief than the non-default parent?** Probably yes, but how different? Start identical, diverge based on Week 1 and Week 4 feedback. Decision needed in Phase 7, when wife is added as a recipient.
2. **How much family context should be free-form text vs. structured fields?** Bias is toward free-form notes per kid, pulled into prompts as raw context. Revisit if we see specific cases where structure would have improved a brief item.

---

## Appendix: research foundation

### Daminger's four phases of cognitive labor

From Daminger, A. (2019). "The Cognitive Dimension of Household Labor." *American Sociological Review*, 84(4):609–633.

1. **Anticipate** — noticing a need before it becomes a problem.
2. **Identify options** — researching alternatives.
3. **Decide** — making the call.
4. **Monitor** — tracking outcomes.

Phases 1 and 4 are almost entirely carried by the default parent. Phases 2 and 3 are shared. The bookends are the load.

### Why "anticipate" is forecastable

Most anticipation in early childhood follows from age + time. Pediatric well-visit schedules, vaccine schedules, motor milestones, language milestones, gear weight/height limits, growth-driven clothing/shoe outgrowing, and seasonal needs are all predictable from public knowledge applied to a private record.

### Foot growth rates (outgrowing engine reference)

- 12–30 months: ~1.5mm/month; new shoes every 2–3 months.
- 30 months–4 years: ~1mm/month; new shoes every ~4 months.
- 4–6 years: ~1mm/month; new shoes every ~6 months.

Source: Wenger et al., 1983; corroborated by Softstar, Little Treads, and Zig and Star data.
