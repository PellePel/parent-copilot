import { Command } from "commander";
import { db } from "../lib/db/index.js";
import { kids } from "../lib/db/schema.js";
import { isoDate } from "../lib/validators.js";

const program = new Command()
  .name("add-kid")
  .description("Add a kid to the longitudinal record.")
  .requiredOption("-n, --name <name>", "kid's first name")
  .requiredOption("-d, --dob <YYYY-MM-DD>", "date of birth")
  .option("--pediatrician <name>", "pediatrician name")
  .option("--daycare <name>", "daycare name")
  .option("--notes <text>", "free-form context the LLM should know about")
  .parse(process.argv);

const opts = program.opts<{
  name: string;
  dob: string;
  pediatrician?: string;
  daycare?: string;
  notes?: string;
}>();

const parsed = isoDate.safeParse(opts.dob);
if (!parsed.success) {
  console.error(`Invalid --dob "${opts.dob}": ${parsed.error.issues[0]?.message}`);
  process.exit(1);
}

const inserted = db
  .insert(kids)
  .values({
    name: opts.name,
    dob: opts.dob,
    pediatrician: opts.pediatrician,
    daycare: opts.daycare,
    notes: opts.notes,
  })
  .returning()
  .get();

console.log(`Added ${inserted.name} (id=${inserted.id}, dob=${inserted.dob}).`);
