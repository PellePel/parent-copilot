/**
 * Seed Clem and Jude with placeholder data so the engineering check has
 * something to round-trip. The DOBs and measurements below are PLACEHOLDERS
 * loosely calibrated to the PRD ("Clem ~2.5 years, Jude ~6 months"); update
 * them with real numbers before relying on the brief.
 *
 * Idempotent on re-run: if any kids exist, this script no-ops with a notice.
 */
import { db } from "../lib/db/index.js";
import { kids, measurements, events } from "../lib/db/schema.js";

const existing = db.select().from(kids).all();
if (existing.length > 0) {
  console.log(
    `Seed skipped — ${existing.length} kid(s) already exist:\n  ` +
      existing.map((k) => `${k.name} (id=${k.id}, dob=${k.dob})`).join("\n  "),
  );
  process.exit(0);
}

const clem = db
  .insert(kids)
  .values({
    name: "Clem",
    dob: "2023-11-22", // PLACEHOLDER — replace with real DOB
    notes: "Toddler. Currently in 3T clothes.",
  })
  .returning()
  .get();

const jude = db
  .insert(kids)
  .values({
    name: "Jude",
    dob: "2025-11-22", // PLACEHOLDER — replace with real DOB
    notes: "Infant. Approaching 6-month well-visit window.",
  })
  .returning()
  .get();

// Recent measurements (PLACEHOLDERS — replace with real numbers)
db.insert(measurements)
  .values([
    {
      kidId: clem.id,
      type: "shoe_size_us",
      value: 8,
      unit: "us_shoe",
      measuredOn: "2026-03-08",
      source: "manual",
    },
    {
      kidId: clem.id,
      type: "clothing_size_months",
      value: 36,
      unit: "months",
      measuredOn: "2026-03-08",
      source: "manual",
    },
    {
      kidId: jude.id,
      type: "weight_kg",
      value: 7.8,
      unit: "kg",
      measuredOn: "2026-03-22",
      source: "pediatrician",
    },
    {
      kidId: jude.id,
      type: "height_cm",
      value: 67,
      unit: "cm",
      measuredOn: "2026-03-22",
      source: "pediatrician",
    },
    {
      kidId: jude.id,
      type: "clothing_size_months",
      value: 9,
      unit: "months",
      measuredOn: "2026-03-22",
      source: "manual",
    },
  ])
  .run();

// Gear-purchase event — anchors the outgrowing prediction for Clem's shoes
db.insert(events)
  .values({
    kidId: clem.id,
    type: "gear_purchase",
    occurredOn: "2026-03-08",
    description: "Stride Rite size 8M",
    metadata: { item: "shoes", brand: "Stride Rite", size: 8 },
  })
  .run();

// Last well-visit for Jude
db.insert(events)
  .values({
    kidId: jude.id,
    type: "well_visit",
    occurredOn: "2026-03-22",
    description: "4-month well-visit",
    metadata: { age_months: 4 },
  })
  .run();

console.log(`Seeded:
  - ${clem.name} (id=${clem.id}, dob=${clem.dob})
  - ${jude.name} (id=${jude.id}, dob=${jude.dob})
  with starter measurements and one gear-purchase event each.

These are PLACEHOLDER values — update DOBs and measurements with real numbers
before the brief becomes meaningful.`);
