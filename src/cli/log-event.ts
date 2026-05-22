import { Command } from "commander";
import { z } from "zod";
import { db } from "../lib/db/index.js";
import { events, EVENT_TYPES } from "../lib/db/schema.js";
import { findKid } from "../lib/kids.js";
import { isoDate, today } from "../lib/validators.js";

const eventType = z.enum(EVENT_TYPES);

const program = new Command()
  .name("log-event")
  .description(
    `Log an event in the family record. Types: ${EVENT_TYPES.join(", ")}. For gear_purchase, include item details via --metadata (JSON), e.g. --metadata '{"item":"shoes","brand":"Stride Rite","size":8}'.`,
  )
  .requiredOption("-k, --kid <name-or-id>", "kid identifier (name or numeric id)")
  .requiredOption("-t, --type <type>", "event type")
  .option("-d, --date <YYYY-MM-DD>", "date the event occurred (defaults to today)")
  .option("--desc <text>", "free-form description")
  .option("--metadata <json>", "structured metadata as a JSON object")
  .parse(process.argv);

const opts = program.opts<{
  kid: string;
  type: string;
  date?: string;
  desc?: string;
  metadata?: string;
}>();

const typeParsed = eventType.safeParse(opts.type);
if (!typeParsed.success) {
  console.error(
    `Invalid --type "${opts.type}". Must be one of: ${EVENT_TYPES.join(", ")}`,
  );
  process.exit(1);
}

const date = opts.date ?? today();
const dateParsed = isoDate.safeParse(date);
if (!dateParsed.success) {
  console.error(`Invalid --date "${date}": ${dateParsed.error.issues[0]?.message}`);
  process.exit(1);
}

let metadata: Record<string, unknown> | undefined;
if (opts.metadata) {
  try {
    const parsed = JSON.parse(opts.metadata);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    metadata = parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Invalid --metadata: ${message}`);
    process.exit(1);
  }
}

let kid;
try {
  kid = findKid(opts.kid);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const inserted = db
  .insert(events)
  .values({
    kidId: kid.id,
    type: typeParsed.data,
    occurredOn: date,
    description: opts.desc,
    metadata,
  })
  .returning()
  .get();

const detail = inserted.description ? ` — ${inserted.description}` : "";
console.log(
  `Logged ${inserted.type} for ${kid.name} on ${inserted.occurredOn}${detail} (id=${inserted.id}).`,
);
