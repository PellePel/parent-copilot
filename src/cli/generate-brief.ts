/**
 * generate-brief CLI — Phase 2a entrypoint.
 *
 * Runs every available trigger engine for every kid, hands the candidates
 * to the assembler, prints the result to console, and writes a markdown
 * mirror to briefs/YYYY-MM-DD.md.
 *
 * Phase 2a only has the outgrowing engine. Schedule, Seasonal, developmental
 * windows, and calendar context land in 2b–2c.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { listKids } from "../lib/kids.js";
import { outgrowingCandidatesFor } from "../lib/engine/outgrowing.js";
import { assembleBrief } from "../lib/engine/assembler.js";
import { renderConsole, renderMarkdown } from "../lib/engine/render.js";
import { isoDate, today } from "../lib/validators.js";
import type { Candidate } from "../lib/engine/types.js";

const program = new Command()
  .name("generate-brief")
  .description("Generate this week's brief and persist it to the DB + briefs/ dir.")
  .option("-d, --date <YYYY-MM-DD>", "date to generate the brief for (defaults to today)")
  .option(
    "-r, --recipient <email...>",
    "recipient(s) — repeat the flag for multiple. Defaults to LOCAL.",
  )
  .option("--dry-run", "skip DB persistence; print only", false)
  .parse(process.argv);

const opts = program.opts<{
  date?: string;
  recipient?: string[];
  dryRun: boolean;
}>();

const asOf = opts.date ?? today();
const dateCheck = isoDate.safeParse(asOf);
if (!dateCheck.success) {
  console.error(`Invalid --date "${asOf}": ${dateCheck.error.issues[0]?.message}`);
  process.exit(1);
}

const recipients = opts.recipient ?? ["LOCAL"];

// 1. Collect candidates from every engine, for every kid.
const kids = listKids();
if (kids.length === 0) {
  console.error("No kids in the database. Run `npm run seed` or `npm run add-kid` first.");
  process.exit(1);
}

const candidates: Candidate[] = [];
for (const kid of kids) {
  candidates.push(...outgrowingCandidatesFor(kid, asOf));
}

console.log(
  `Collected ${candidates.length} candidate(s) across ${kids.length} kid(s) for week of ${asOf}.`,
);

if (opts.dryRun) {
  // For dry-run we don't persist, but we still want to see the ranking.
  // Mimic the assembler's dedup + sort in-memory without writing rows.
  const winners = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${c.kidId ?? "family"}|${c.triggerDetail}`;
    const existing = winners.get(key);
    if (!existing || c.rawScore > existing.rawScore) winners.set(key, c);
  }
  const ranked = [...winners.values()].sort((a, b) => b.rawScore - a.rawScore);
  console.log("");
  console.log("--- DRY RUN — not persisted ---");
  for (const [i, c] of ranked.entries()) {
    console.log(`${i + 1}. [${c.triggerDetail}] ${c.headline} (score=${c.rawScore}, conf=${c.confidence})`);
  }
  process.exit(0);
}

// 2. Assemble + persist.
const assembled = assembleBrief(candidates, { weekOfIso: asOf, recipients });

// 3. Console output.
console.log("");
console.log(renderConsole(assembled));

// 4. Markdown mirror.
mkdirSync("briefs", { recursive: true });
const path = `briefs/${assembled.brief.weekOf}.md`;
writeFileSync(path, renderMarkdown(assembled), "utf8");
console.log("");
console.log(`Wrote ${path} (brief id=${assembled.brief.id}, ${assembled.items.length} items).`);
