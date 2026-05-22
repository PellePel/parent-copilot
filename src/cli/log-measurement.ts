import { Command } from "commander";
import { z } from "zod";
import { db } from "../lib/db/index.js";
import { measurements, MEASUREMENT_TYPES, type MeasurementType } from "../lib/db/schema.js";
import { findKid } from "../lib/kids.js";
import { isoDate, today } from "../lib/validators.js";

const measurementType = z.enum(MEASUREMENT_TYPES);

const TYPE_UNITS: Record<MeasurementType, string> = {
  weight_kg: "kg",
  height_cm: "cm",
  head_circ_cm: "cm",
  shoe_size_us: "us_shoe",
  clothing_size_months: "months",
};

const program = new Command()
  .name("log-measurement")
  .description(
    `Log an append-only measurement for a kid. Types: ${MEASUREMENT_TYPES.join(", ")}.`,
  )
  .requiredOption("-k, --kid <name-or-id>", "kid identifier (name or numeric id)")
  .requiredOption("-t, --type <type>", "measurement type")
  .requiredOption("-v, --value <number>", "numeric value")
  .option("-d, --date <YYYY-MM-DD>", "measurement date (defaults to today)")
  .option("--unit <unit>", "unit override (defaults to the type's canonical unit)")
  .option("--source <source>", "where the measurement came from (pediatrician/home/manual)")
  .parse(process.argv);

const opts = program.opts<{
  kid: string;
  type: string;
  value: string;
  date?: string;
  unit?: string;
  source?: string;
}>();

const typeParsed = measurementType.safeParse(opts.type);
if (!typeParsed.success) {
  console.error(
    `Invalid --type "${opts.type}". Must be one of: ${MEASUREMENT_TYPES.join(", ")}`,
  );
  process.exit(1);
}

const value = Number.parseFloat(opts.value);
if (!Number.isFinite(value)) {
  console.error(`Invalid --value "${opts.value}". Must be numeric.`);
  process.exit(1);
}

const date = opts.date ?? today();
const dateParsed = isoDate.safeParse(date);
if (!dateParsed.success) {
  console.error(`Invalid --date "${date}": ${dateParsed.error.issues[0]?.message}`);
  process.exit(1);
}

let kid;
try {
  kid = findKid(opts.kid);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const inserted = db
  .insert(measurements)
  .values({
    kidId: kid.id,
    type: typeParsed.data,
    value,
    unit: opts.unit ?? TYPE_UNITS[typeParsed.data],
    measuredOn: date,
    source: opts.source,
  })
  .returning()
  .get();

console.log(
  `Logged ${inserted.type}=${inserted.value}${inserted.unit} for ${kid.name} on ${inserted.measuredOn} (id=${inserted.id}).`,
);
