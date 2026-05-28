# Copilot

*An anticipation engine for parenting mental load*

**Product Requirements Document — V1**
May 2026 • Author: Nick

---

## TL;DR

Copilot is a weekly anticipation engine that surfaces what a family's kids will need attention on in the coming days — especially the things that aren't on any calendar. It targets the bookends of cognitive labor (anticipating and monitoring), which is where the mental load actually lives, rather than the middle (deciding and doing), which is already well-served by calendars and task apps.

The product is a Sunday-morning brief generated from a rich, hand-maintained context layer per family. The context layer — not the brief — is the spine: it's the durable artifact that compounds over time, and every signal we surface is derived from it. The brief is one output.

V1 ships solo. The user is the non-default parent (me). The default parent is not yet a recipient; she becomes a user only after the system has demonstrably changed how I show up. The near-term success bar is behavioral: **did the user anticipate or handle something the primary planner would otherwise have had to surface?**

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

- **The user (V1):** the non-default parent. Me. Two kids, Clem (~2.5 years) and Jude (~6 months). I want to anticipate more and need a mental model I don't currently have. A 2-minute Sunday read in a channel I already check is the right form factor.
- **The primary planner (not yet a user):** my wife Mika. She carries the mental load today. The whole point of Copilot is to redistribute this *without* making her do more work to delegate. She becomes a user only after the system has changed how I show up — see Phase 5+ in the roadmap below.

---

## The insight

Calendars predict appointments. Almost no system predicts the non-calendar items: when a toddler will outgrow her shoes; when an infant is approaching the weight limit of his car seat; when a child is entering a developmental window where a sleep regression is statistically likely; when the season is about to require sunscreen, swimwear, or rain gear that doesn't fit anymore.

Those non-calendar items are the hook. They are what make the system feel like it knows the family. They are also what the default parent has been holding in their head, alone, for the entire life of every kid.

And most of them are forecastable, but only when applied to *this* family's actual record — not a generic age-based template. The mental load that feels uniquely human is, in large part, structured knowledge applied to a longitudinal, family-specific record. Pediatric guidance, developmental milestones, vaccine schedules, seasonal needs, and growth-driven gear replacement are derivable from age + time alone. What makes a brief feel uncanny is the long tail: the kid's prior vaccine reactions, what the pediatrician said last visit, what's currently being worked on, what the family already knows and doesn't need surfaced again. That long tail lives in the **context layer**, which is the architectural spine of the system. The brief is one read off it; every future feature (feedback, learning, delivery) compounds from the same source.

---

## V1 scope

### What V1 is

A weekly briefing generated from the family's `family_context.json` plus a hand-curated knowledge base. The brief contains 4–7 items, each naming the kid it concerns, giving one-line context, and suggesting an action when relevant. Each item carries provenance — every fact in the brief is traceable back to a specific entry in the context or a cited KB source.

The brief is delivered to a channel the user actually checks (V1 path: a Telegram bot — see roadmap Phase 2). The same channel will, in subsequent phases, be how the user reacts to items and how those reactions update the context.

### What goes into a brief

The brief draws from a set of engines, all of which read from the same context layer. The engines aren't taxonomically "trigger sources" — they're cooperating modules that produce candidate signals, which a brief assembler ranks, dedups, and polishes into prose.

| Engine | What it surfaces |
|---|---|
| **Outgrowing** | Predicted physical outgrowing of shoes, clothes, carseat (from age + measurement record + gear-purchase events). |
| **Developmental windows** | Age-banded heads-ups (sleep regressions, social/emotional onset, motor/language milestones, feeding transitions), filtered by what the context already marks as cleared/ongoing/emerging. |
| **Well-visit absence** | AAP-scheduled visits that are age-due but aren't on the family calendar or in the context's logged visits. |
| **Vaccine prep** | Upcoming vaccine visits + relevant medical history (e.g. a prior post-vaccine fever event) — prompts the user to raise pre-medication, fever thresholds, vaccine spacing with the pediatrician. |
| **Allergen window** | The 4–7 month allergen-introduction window, surfaced when the context shows incomplete introduction. |
| **Medication follow-up** | Medications in the context with TBD/unknown status that have aged out — "is this prescription still in use?" |
| **Calendar cross-products** | LLM-reasoned items combining upcoming calendar events with family state — the canonical example: "trip to Maine next week + Jude's swim diapers from last summer were size 6m, but he's in 9m clothes now → get new swim diapers." |
| **Polish** | A final LLM pass for voice consistency, with discipline around preserving every fact and safety-critical instruction verbatim. |

A small number of engine outputs would feel uncanny on their own. Their combined output is meant to feel like a knowledgeable friend who has read both the medical literature and your specific family's record. This is the read path. Everything in the roadmap compounds on it.

### Belt-and-suspenders filtering

Two mechanisms enforce the don't-tell-me-what-I-already-know discipline:

- **Belt (deterministic):** Each kid's context carries explicit `things_we_already_know` entries (e.g. "language_milestones_through_30mo") and milestone-status fields ("cleared", "ongoing", "emerging"). The rule engine filters candidates against these before they ever leave the engine.
- **Suspenders (semantic):** The polish/cross-products LLM prompts also enforce the same suppression list, catching semantic equivalents the rule engine can't match deterministically.

Either layer alone leaks. Both together is the trust floor.

### What V1 is not

**Permanent positioning** (we will not become these things):

- **Not a tracker.** No logging burden on the primary planner. We capture only what's required for prediction: ages, periodic measurements, gear-purchase dates, medical/developmental notes.
- **Not a task manager.** No assignments, no to-dos, no completion tracking. Items are anticipations, not tasks.
- **Not a calendar.** We read from the family calendar; we don't replace it.
- **Not a medical tool.** We don't diagnose, dose medication, or interpret growth percentiles. We surface facts and suggest talking to the pediatrician.
- **Not a chat surface.** The delivery + feedback channel is a notebook the user annotates, not a destination chat app. The brief is the unit of value; the channel is infrastructure.
- **Not relationship counseling.** Mental-load redistribution is the goal; the brief is the lever. We don't frame this as advice about the marriage.

**Deferred** (added later if validated):

- Mobile app. The delivery channel (Telegram, see roadmap Phase 2) covers V1 needs without a dedicated app.
- Accounts and auth. V1 is a config-file-based system: kids, recipients, and context are local files.
- Photo extraction of pediatrician after-visit summaries. The Lucy/Epic exports we get are already structured enough to parse, but manual data entry is fine for V1.
- Multi-family / sharing with extended family, nannies, daycare. Single-family scope until the loop is proven.
- Email delivery. Tested mentally and rejected: one-way, non-actionable, no place for feedback to land. See roadmap Phase 2.

---

## Architecture

### System shape

Copilot is a TypeScript pipeline, not a web app. It runs on a schedule (Sunday morning), reads from the **family context layer** (the spine) and a few external sources (Google Calendar, the AAP/CDC knowledge base, the Anthropic API), assembles a brief, and writes it both to a markdown file and a structured log. Delivery and feedback are the next roadmap phase.

### Components

- **Family context layer (`data/family_context.json`).** The single source of truth for narrative family state — per-kid developmental milestones with status, medical history, current_edges (what each kid is actively working on), things_we_already_know (suppression entries), gear, patterns, allergen rollout status, medications. Loaded with loose-inside / strict-outside validation: the loader only requires the top-level shape (kids[] with id/name/dob); everything inside a kid is free-form so the schema can grow without code changes. This file is gitignored — it contains PII and medical history.
- **Operational record (SQLite via Drizzle).** Append-only tables for measurements, events, briefs, and brief_items. The context layer holds narrative state; the SQLite DB holds the audit log of what was produced and when.
- **Knowledge base (TypeScript modules).** Hand-curated, version-controlled: AAP well-visit schedule, CDC vaccine schedule, developmental windows by age, foot-growth-rate parameters, weight-gain curves, allergen list, seasonal triggers. Lives in code so it's type-checked alongside the engines that read from it.
- **Engines.** The set of modules that produce candidate brief items (see "What goes into a brief" above). Each engine is small, focused, and reads only the slice of context it needs. Adding an engine is the highest-leverage way to expand the surface.
- **Brief assembler.** Ranks candidates by raw score, applies a current_edges priority boost, dedups by (kid, trigger_detail), caps at 7 items, and runs the LLM polish pass.
- **Structured per-brief log (`briefs/YYYY-MM-DD.log.json`).** Every brief writes a sibling log with: context hash at generation time, model + prompt version, every candidate signal (with `selected` true/false), published headlines, token usage per Claude call, total latency. This is the debugging substrate — it answers "why didn't last week's brief mention X" without rerunning anything.
- **Delivery + feedback (Phase 2).** Not yet shipped. The roadmap covers this.

### Tech choices

- TypeScript on Node.js (latest LTS). `tsx` for running scripts directly. No web framework — this is a scheduled pipeline, not a web app.
- SQLite via `better-sqlite3`. File on disk, no server.
- Drizzle ORM for the operational schema.
- Zod for runtime validation of the context, LLM outputs, and external inputs.
- Anthropic SDK (`@anthropic-ai/sdk`) for Claude (Sonnet 4.5). Structured output via tool-use for the polish + cross-products steps.
- Cron (Mac) for early scheduling; GitHub Actions when we move to cloud (Phase 5+).
- Private GitHub repo (`PellePel/parent-copilot`).
- (Phase 2) Telegram Bot API for delivery and feedback capture.

---

## Success metrics

The brief itself can't be graded per-week — many engines fire on multi-week cycles, and the only honest signal of value is whether the user shows up differently because of it.

### Near-term North Star

> **Did the user anticipate or handle something the primary planner would otherwise have had to surface?**

This measures behavior change, not engine output. The brief is doing its job if it reliably converts the user into a more proactive partner — in ways the primary planner notices.

**Capture mechanism (V1 — before Phase 2):** a `delight_log.md` file in the repo. One entry per moment:
- Date
- What the brief surfaced (item headline + engine)
- What I did
- What my wife said or did

**Capture mechanism (Phase 2+):** the same loop, but the feedback channel makes it lower-friction to log a "this one mattered" reaction in-flow.

**Target:** four logged moments in eight consecutive weeks. Below that, the engine isn't producing actionable signal; the cure is fixing the engine, not adding infrastructure.

### Counter-metric: false positives

A wrong claim about a kid is a permanent trust hit. The structured per-brief log makes false positives visible — every published headline can be diffed against the kid's `things_we_already_know` and against the context entries we cited. Target: **zero** items in the brief that contain a factual error about a kid; **zero** items the user reacts to with "this is wrong about my kid."

### What we are NOT measuring

- Per-brief surprise rate during the solo phase. Engine signal is sparse on a weekly grain; the delight log is the appropriate denominator until ~Phase 5 brings the partner in.
- Engagement minutes, DAU/MAU. Wrong vocabulary for a weekly ritual.
- NPS. Premature.
- Items "completed." Not a task manager.

### Later: the two-parent North Star (Phase 5+)

When the partner joins as a user, the original two-parent success measure returns: **proactive planning conversations initiated by the less-informed parent**, surfaced in the brief, recognized as useful by both. Adding it now is putting the cart before the horse.

---

## Development roadmap

Phases are ordered, not time-boxed. They replace the original week-by-week build plan, which has either shipped or been overtaken by what we learned building it.

### Phase 1 — Calibrated Brief Engine **(SHIPPED)**

**Goal:** Prove that a family-specific context layer produces meaningfully better briefs than age-based generic milestones.

**What's in it:**

- `family_context.json` — structured per-kid and family context (the spine).
- KB rule engine — generates candidate signals (well-visit lookahead, vaccine-prep, developmental windows, allergen rollout, gear outgrowing, medication follow-up).
- Belt-and-suspenders suppression — deterministic filtering in the rule engine plus semantic filtering in the LLM prompts, enforced against each kid's `things_we_already_know`.
- Brief generator — composes context + signals + prompt, calls Claude, outputs markdown.
- Structured logging — every run records candidate signals, selections, suppressions, model/prompt version, token usage, latency.

**Exit criteria (met):** The brief surfaces family-specific high-value items (e.g. vaccine-appointment prep informed by prior reaction history) and suppresses stale items the user already knows (e.g. long-cleared language milestones). Context layer is the single source of truth for narrative state.

**Maintenance for now:** Context is updated manually — the user edits `family_context.json` directly or by conversing with Claude in the project, which proposes edits. This is an adequate v0 of context maintenance and defers the need for dedicated tooling (see Phase 4).

### Phase 2 — Make It Land: Delivery + Feedback Capture

**Goal:** Turn a script that writes a file into a habit-forming weekly loop, and start collecting the signal needed to make the system learn.

**Why now:** A brief sitting in a markdown file forms no habit and generates no learning signal. Two coupled gaps need closing together: the brief needs to arrive somewhere the user actually sees it, and the user needs a low-friction way to react to it.

**What's in it:**

- **Delivery:** The weekly brief is pushed to a channel the user checks without effort. *Recommended: a Telegram bot* — fastest path to a working two-way loop for a solo user, zero cost, excellent API, supports inline buttons and reply-to-message. (Alternatives considered: email — rejected as not actionable; minimal web app — viable but slower to ship; staying in the Claude project — works but isn't push-based. Telegram is the cheapest way to test whether the loop forms.)
- **Lightweight feedback:** Each brief item carries one-tap signal — *useful / already knew this / not relevant*.
- **Optional "why":** When the user marks an item negatively, an optional free-text field captures the reason ("Clem cleared this months ago"). Not mandatory — most reactions stay one-tap; the free-text is an outlet for the cases that matter.
- Feedback events are logged (not yet acted on — that's Phase 3).

**What's explicitly NOT in it:**

- Acting on feedback / mutating the context (Phase 3).
- Multi-user (partner) flows.
- Rich conversational context teaching (Phase 4).

**Exit criteria:** The user receives and reads the brief weekly without prompting, and reacts to most items. After ~3 briefs, the accumulated feedback reveals what *kind* of updates the learning loop will need to support — which directly informs Phase 3.

**Design note:** The bot is infrastructure for the brief, not a place where planning conversations happen. It should feel like a notebook the user annotates, not a chatroom. This guards against the trap of the chat surface becoming the product.

### Phase 3 — Close the Learning Loop: Feedback → Context

**Goal:** Make the system improve itself. Feedback on briefs translates into proposed updates to the context layer, which the user approves.

**Why after Phase 2:** Phase 2 collects feedback for a few weeks first. The vocabulary and patterns in that feedback tell us what updates the loop must support — so we build the loop informed by real signal rather than guessing. ("Already knew this" is the dominant negative signal? Then the loop's primary job is moving milestones into `things_we_already_know` / marking them cleared.)

**What's in it:**

- A translation step: a feedback event ("already knew this — she cleared it months ago") becomes a proposed context diff ("mark `simple_sentences` cleared; add `language_milestones_through_30mo` to suppressions").
- **Agent proposes, user approves.** Every context mutation goes through a confirmation step. This is non-negotiable for high-stakes fields (medical, developmental clearings) — a hallucinated fact about a kid is a serious failure. Low-stakes fields (gear sizes) can relax this later once inference quality is trusted.
- Applied diffs update `family_context.json`; the next brief reflects them automatically.

**What's explicitly NOT in it:**

- Unsupervised context mutation (always gated by approval at this stage).
- Conversational, free-form context teaching (Phase 4) — this phase only handles updates *derived from brief feedback*.

**Exit criteria:** A negatively-flagged brief item reliably produces a sensible proposed context update, and once approved, the same item stops appearing in future briefs without manual JSON editing. The system measurably reduces its own miss rate over a few cycles.

### Phase 4 — Conversational Context Maintenance

**Goal:** Productize the "teach the agent about my family" interaction that's currently happening ad hoc in the Claude project.

**Why this late:** Manual maintenance via the Claude project is working adequately, so this is lower urgency than it first appeared. It's also higher-effort-per-interaction and lower-frequency than brief feedback, so it earns its place behind the weekly loop.

**What's in it:**

- A dedicated interaction (separate from the brief feedback flow) where the user can dump context conversationally and the agent maintains the structured context — proposing structured updates from free-form input ("Clem's been asking 'why' constantly and started a swim class on Saturdays").
- A periodic "calibrate this kid" ritual — a light, occasional check-in where the agent asks targeted questions to refresh each kid's developmental edges and current state.
- Kept deliberately separate from the brief surface: the brief is quick consumption; calibration is a thoughtful conversation. Smushing them together degrades both.

**Exit criteria:** The user can keep the context current entirely through conversation, with no direct JSON editing required.

### Phase 5+ — The Horizon

Not scheduled. Sequenced by what proves valuable and what the user pulls toward. Listed to ensure the architecture doesn't preclude them.

- **Bring my wife in (multi-user).** Only after the system is demonstrably valuable for one user. At that point the pitch is "this already changed how I show up — want in?" rather than "try this experiment with me." Reintroduces the original two-parent North Star (proactive planning conversations between partners) as the real success measure. Requires rethinking shared-vs-private context, per-user views, and the privacy/threat model. The R4 protocol below applies here, not in V1.
- **Baseline-vs-change detection.** The context layer encodes baselines (e.g. a kid's normal sleep schedule). A future brief should detect deviation from baseline and surface it as signal ("wake time has shifted 90 minutes earlier over 10 days — unusual for his pattern") rather than reporting raw state. Architectural note: don't let current-state reporting overwrite stored baselines.
- **Data-source integrations.** Medical portal (auto-ingest clinical notes after visits — the Lucy/Epic export is already structured enough to parse), calendar (already partially integrated), and potentially the nanny as a high-signal observer of weekday routines and milestones (lowest-friction path: ingest the daily-update texts she may already send, rather than asking her to use an app).
- **Public build-in-progress content.** Blog posts and progress updates documenting the build.

### Sequencing rationale

**Build the read path, then make it land, then close the write path, then productize the write path.**

- Phase 1 built the *read* path (context → brief). Done.
- Phase 2 makes the brief *land* and starts capturing *reactions* — but doesn't act on them yet.
- Phase 3 closes the *write* path for the high-frequency case (brief feedback → context), informed by the reactions Phase 2 collected.
- Phase 4 productizes the *write* path for the low-frequency case (conversational teaching), which manual workarounds have made non-urgent.
- Phase 5+ expands scope (more users, more data sources, smarter signals) only once the single-user loop is genuinely good.

The one near-term decision worth re-examining as we go: **the delivery channel (Phase 2)**. Telegram is the right call for shipping fast and testing the habit loop solo. But the eventual home for delivery, feedback, and conversational maintenance is plausibly a single unified surface (a minimal web app). If we find ourselves wanting all three in one place sooner rather than later, it may be worth jumping straight to that web surface instead of investing heavily in the Telegram bot. See Open Questions.

---

## Risks and how we're managing them

### R1: The brief is right but boring

If V1 only surfaces things we already knew (well-visit Tuesday, summer is coming), it fails the near-term North Star — no delight moments to log. *Mitigation:* the delight log is the eval. If MVP ends with fewer than 4 logged moments, the engine isn't producing actionable signal — the cure is fixing the engine prompt, the context, or the engine ranking, not adding more infrastructure.

### R2: The brief is surprising but wrong

The worst failure mode. If we tell the user Clem needs new shoes when she doesn't, or that Jude has a developmental concern when he doesn't, we lose trust permanently. *Mitigation:* every brief item carries explicit reasoning citing the data and KB band that fired it. Anything in the medical/developmental space defers to the pediatrician — no diagnostic claims, no dosing. The structured per-brief log makes every published headline diffable against the context's `things_we_already_know`; suppression leaks are visible.

### R3: We end up building another tracker

The temptation to add "log Jude's naps" creeps in quickly. *Mitigation:* when scoping any feature, ask — does this require the primary planner to do new work? If yes, the answer is no. The context layer is updated by *me*, by conversation with the agent, or by Phase 3's feedback loop. Not by adding logging surfaces.

### R4: The default parent gets a system that surveils her instead of supports her (deferred, not gone)

V1 sidesteps this risk by going solo first: the primary planner is not a user, not a recipient, and has no homework. There's no pre-launch conversation required for V1 because she isn't receiving anything.

The risk returns in full force at Phase 5+, when she becomes a recipient. The protocol below is the gate to that phase. The kill conditions, especially, are non-negotiable.

*Pre-launch (before any brief is sent to her, Phase 5+).* A 30-minute conversation. Share the one-page summary, not the full PRD. Explicit agreement on three things: (1) all data entry remains mine — she has no homework, no logging, no rating obligation; (2) she sees the brief, not the database; (3) she has unilateral veto over any item or the entire project, at any time, with no justification required.

*Week 1 check-in (15 minutes).*
1. Did this feel like a tool helping me, or a tool tracking you?
2. Did anything in the brief feel wrong or off about our kids?
3. Was anything in the brief actually useful to you, or is it just for me?

*Week 4 check-in (15 minutes).* Same three questions, plus:
4. If I asked you whether to keep going, what would you say?
5. What's the one thing that would make this better — or worth stopping?

*Kill conditions.* Any one of these ends the project, no debate: (a) she says any version of "this feels weird" or "this is too much"; (b) she corrects a brief item as factually wrong about our kids on two consecutive weeks; (c) she stops opening the brief. The point of the kill conditions is to act on them, not catalog them.

### R5: I get bored before validation

Real risk: this is a side project and there's no external pressure. *Mitigation:* ship phase milestones with structured logs that show progress, document the build (Phase 5+ public content), and don't add scope until the near-term North Star is consistently hit.

---

## Open questions

Limited to ones that affect current-phase decisions. Items dependent on feedback volume we don't yet have go to a backlog, not this doc.

1. **Telegram bot vs minimal web app (Phase 2 delivery channel).** Telegram is the cheapest path to a working push + feedback loop, and the right call for solo validation. But Phases 2–4 plausibly all live in a single unified surface eventually. The question: do we ship Telegram now and migrate later (likely simpler) or jump to a minimal web app now (potentially less throwaway work)? Decision needed before Phase 2 build starts.
2. **Free-form text vs structured fields in the context.** The schema is already a hybrid — narrative summaries plus structured milestones, gear, medications. Where new context lands (free-form notes versus a new structured field) is a per-decision call. Bias: free-form first, structure when a specific engine needs to read it.
3. **Should the partner eventually get a different brief than the primary user?** Probably yes, but the answer is downstream of how Phase 5+ actually goes. Start identical when she joins; diverge based on her feedback.

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

Most anticipation in early childhood follows from age + time, *when applied to a private record*. Pediatric well-visit schedules, vaccine schedules, motor milestones, language milestones, gear weight/height limits, growth-driven clothing/shoe outgrowing, and seasonal needs are all derivable from public knowledge applied to a family-specific context. The context layer is where private-record fidelity lives; the KB is where public-knowledge fidelity lives; the engines are where they cross.

### Foot growth rates (outgrowing engine reference)

- 12–30 months: ~1.5 mm/month; new shoes every 2–3 months.
- 30 months–4 years: ~1 mm/month; new shoes every ~4 months.
- 4–6 years: ~1 mm/month; new shoes every ~6 months.

Source: Wenger et al., 1983; corroborated by Softstar, Little Treads, and Zig and Star data.
