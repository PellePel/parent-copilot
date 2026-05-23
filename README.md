# parent-copilot

A weekly anticipation engine for parenting mental load. See [PRD.md](./PRD.md) for the full spec.

V1 ships as a Sunday-morning briefing emailed to both parents, driven by a Lookahead engine that cross-references each kid's age, recent measurements, gear-purchase events, developmental knowledge, and the family calendar.

Current status: **Phase 2c** — Lookahead engine with three signal sources (outgrowing, developmental windows, calendar-absence detection) feeding a brief. No email yet; brief prints to console + writes to `briefs/YYYY-MM-DD.md`.

## Stack

- TypeScript on Node.js (run via `tsx`)
- SQLite via `better-sqlite3`, schema managed with Drizzle ORM
- Zod for runtime validation
- `googleapis` for read-only Google Calendar access (Phase 2c+)
- Anthropic SDK (Phase 2d for the brief assembler prose-rewrite)

## Setup

```bash
npm install
npm run db:push   # create the SQLite file and tables at ./data/copilot.db
npm run seed      # add Clem and Jude with starter data
```

Then optionally set up Google Calendar (see below).

## Generating a brief

```bash
npm run generate-brief                          # for today
npm run generate-brief -- --date 2026-06-30     # for a specific Sunday
npm run generate-brief -- --dry-run             # rank candidates without persisting
```

Briefs are persisted to the `briefs` and `brief_items` tables, and a markdown mirror is written to `briefs/YYYY-MM-DD.md` (gitignored — DB is the canonical record).

## Google Calendar setup (one-time, ~5 minutes)

The brief uses your Google Calendar to detect age-due well-visits that aren't scheduled yet. Without OAuth set up, the brief still works — it just skips calendar-aware items and logs a warning.

1. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com/) (free tier is fine).
2. **Enable the Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable.
3. **Configure OAuth consent screen**: APIs & Services → OAuth consent screen → "External" → fill in app name (anything) and your email. Add the scope `https://www.googleapis.com/auth/calendar.readonly`. Add yourself as a test user.
4. **Create OAuth credentials**: APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type **"Desktop app"** → name it → Create. Click "Download JSON" on the new client.
5. **Save the file** as `./credentials.json` at the repo root. It's gitignored.
6. **Run the auth flow**:
   ```bash
   npm run auth:google
   ```
   It'll print an authorization URL. Open it, grant read-only calendar access, and you'll be redirected to a local server which captures the token. The refresh token is saved to `./data/google-token.json` (also gitignored).
7. **Done**. From now on `npm run generate-brief` will include calendar-aware items.

## CLIs

All write to `./data/copilot.db`. Re-runnable; data is append-only for measurements and events.

```bash
# Add a kid
npm run add-kid -- --name Clem --dob 2024-01-18 --notes "Toddler. 3T clothes."

# Log a measurement (types: weight_kg, height_cm, head_circ_cm, shoe_size_us, clothing_size_months)
npm run log-measurement -- --kid Clem --type shoe_size_us --value 8 --date 2026-03-08

# Log an event (types: well_visit, vaccine, milestone, gear_purchase, illness, note)
npm run log-event -- \
  --kid Clem \
  --type gear_purchase \
  --date 2026-03-08 \
  --desc "Stride Rite size 8M" \
  --metadata '{"item":"shoes","brand":"Stride Rite","size":8}'

# Generate the weekly brief
npm run generate-brief

# Google Calendar one-time auth
npm run auth:google
```

## Conventions

- **Clothing sizes** are stored as months: `12` = 12-month, `24` = "2T", `36` = "3T", etc. Lets the outgrowing engine treat them numerically.
- **All dates** are ISO `YYYY-MM-DD` strings.
- **Measurements are append-only**. We never overwrite — trajectory is the signal for the Lookahead engine.
- **Events** capture facts. `gear_purchase` events should include item details in `metadata` so the Lookahead engine knows what to count against (e.g. shoes vs. winter coat). Carseats use `metadata.item="carseat"` and `metadata.weight_limit_kg`.
- **Calendar absence detection** matches well-visits in your Google Calendar by keyword (pediatrician name, "well visit," "checkup," etc.). To suppress a stale absence flag after the visit, run `log-event ... --type well_visit --date <date>`.

## Calendar fixture mode (for testing)

Set `COPILOT_CALENDAR_FIXTURE=path/to/events.json` to bypass the real Google API and use a JSON file of fake events. Useful for testing the absence engine without setting up OAuth. See `tests/fixtures/` for examples.

## Repo layout

```
src/
  lib/
    db/
      index.ts         # better-sqlite3 + drizzle bootstrap
      schema.ts        # six tables: kids, measurements, events, briefs, brief_items, feedback
    kb/
      outgrowing.ts    # shoe/clothing/carseat KB + weight-gain projection
      developmental.ts # ~25 age-banded developmental windows
      well_visits.ts   # AAP Bright Futures schedule
    engine/
      types.ts         # shared Candidate type
      outgrowing.ts    # shoes, clothing, carseat outgrowing predictions
      developmental.ts # developmental-window candidates
      absence.ts       # calendar-absence detection for well-visits
      assembler.ts     # rank + dedup + persist
      render.ts        # markdown + console output
      suppression.ts   # "recently fired in any brief" helper
    age.ts             # age + date helpers
    calendar.ts        # Google Calendar fetcher with fixture mode
    google.ts          # OAuth client + token storage
    kids.ts            # kid lookup helper (id or name)
    validators.ts      # shared zod schemas
  cli/
    add-kid.ts
    log-measurement.ts
    log-event.ts
    generate-brief.ts
    auth-google.ts     # one-time Google Calendar OAuth
    seed.ts            # starter data for Clem and Jude
tests/
  fixtures/            # calendar JSON fixtures for engineering checks
data/
  copilot.db           # gitignored; created by npm run db:push
  google-token.json    # gitignored; created by npm run auth:google
credentials.json       # gitignored; downloaded from Google Cloud Console
briefs/                # gitignored; markdown mirrors of generated briefs
```

## Build phases

See [PRD.md](./PRD.md) for the full plan. MVP is Phases 1–4 (Foundation → Lookahead engine → Schedule + Seasonal → Email delivery), gated on logging 4 delight moments over 8 weeks of solo use.
