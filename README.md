# parent-copilot

A weekly anticipation engine for parenting mental load. See [PRD.md](./PRD.md) for the full spec.

V1 ships as a Sunday-morning briefing emailed to both parents, driven by a Lookahead engine that cross-references each kid's age, recent measurements, gear-purchase events, developmental knowledge, and the family calendar.

This repo is currently at **Phase 1 — Foundation**: schema, CLIs to enter data, and seed values. No brief generation yet.

## Stack

- TypeScript on Node.js (run via `tsx`)
- SQLite via `better-sqlite3`, schema managed with Drizzle ORM
- Zod for runtime validation
- Anthropic SDK (added in Phase 2 for the brief assembler)

## Setup

```bash
npm install
npm run db:push   # create the SQLite file and tables at ./data/copilot.db
npm run seed      # add Clem and Jude with placeholder starter data
```

## CLIs

All write to `./data/copilot.db`. Re-runnable; data is append-only for measurements and events.

```bash
# Add a kid
npm run add-kid -- --name Clem --dob 2023-11-22 --notes "Toddler. 3T clothes."

# Log a measurement (types: weight_kg, height_cm, head_circ_cm, shoe_size_us, clothing_size_months)
npm run log-measurement -- --kid Clem --type shoe_size_us --value 8 --date 2026-03-08

# Log an event (types: well_visit, vaccine, milestone, gear_purchase, illness, note)
npm run log-event -- \
  --kid Clem \
  --type gear_purchase \
  --date 2026-03-08 \
  --desc "Stride Rite size 8M" \
  --metadata '{"item":"shoes","brand":"Stride Rite","size":8}'
```

## Conventions

- **Clothing sizes** are stored as months: `12` = 12-month, `24` = "2T", `36` = "3T", etc. Lets the outgrowing engine treat them numerically.
- **All dates** are ISO `YYYY-MM-DD` strings.
- **Measurements are append-only**. We never overwrite — trajectory is the signal for the Lookahead engine.
- **Events** capture facts. `gear_purchase` events should include item details in `metadata` so the Lookahead engine knows what to count against (e.g. shoes vs. winter coat).

## Repo layout

```
src/
  lib/
    db/
      index.ts         # better-sqlite3 + drizzle bootstrap
      schema.ts        # six tables: kids, measurements, events, briefs, brief_items, feedback
    kids.ts            # kid lookup helper (id or name)
  cli/
    add-kid.ts
    log-measurement.ts
    log-event.ts
    seed.ts            # placeholder data for Clem and Jude
data/
  copilot.db           # gitignored; created by npm run db:push
drizzle/               # generated migrations (after npm run db:generate)
```

## Build phases

See [PRD.md](./PRD.md) for the full plan. MVP is Phases 1–4 (Foundation → Lookahead engine → Schedule + Seasonal → Email delivery), gated on logging 4 delight moments over 8 weeks of solo use.
