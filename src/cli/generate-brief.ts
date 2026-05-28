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
import { developmentalCandidatesFor } from "../lib/engine/developmental.js";
import { absenceCandidatesFor } from "../lib/engine/absence.js";
import { vaccinePrepCandidatesFor } from "../lib/engine/vaccine_prep.js";
import { allergenWindowCandidatesFor } from "../lib/engine/allergen_window.js";
import { crossProductCandidatesFor } from "../lib/engine/cross_products.js";
import { annotateWithEdges } from "../lib/engine/current_edges.js";
import { polishCandidates } from "../lib/engine/polish.js";
import { assembleBrief } from "../lib/engine/assembler.js";
import { renderConsole, renderMarkdown } from "../lib/engine/render.js";
import {
  CALENDAR_LOOKAHEAD_DAYS,
  fetchUpcomingEvents,
  type CalendarEvent,
} from "../lib/calendar.js";
import {
  loadFamilyContext,
  getKidByName,
  type FamilyContext,
  type Kid as ContextKid,
} from "../lib/context.js";
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
  .option("--no-polish", "skip the Claude prose-rewrite step")
  .parse(process.argv);

const opts = program.opts<{
  date?: string;
  recipient?: string[];
  dryRun: boolean;
  polish: boolean;
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

// Load the family context layer if present (spec v2.1). Engines that
// benefit from rich context (developmental's `things_we_already_know`
// belt filter; later phases: vaccine-prep, allergen window, etc.)
// receive the matching kid's context. Without the file, behavior falls
// back to the v2.0 engines.
let familyContext: FamilyContext | null = null;
const ctxResult = loadFamilyContext();
if (ctxResult.status === "ok") {
  familyContext = ctxResult.context;
  console.log(
    `Context: loaded ${ctxResult.path} (${familyContext.kids.length} kid(s)).`,
  );
} else if (ctxResult.status === "not_found") {
  console.warn(
    `Context: ${ctxResult.path} not found — running without v2.1 context. See data/family_context.example.json for the shape.`,
  );
} else {
  console.warn(`Context: failed to load ${ctxResult.path} (${ctxResult.reason}).`);
}

function contextKidFor(dbKidName: string): ContextKid | undefined {
  if (!familyContext) return undefined;
  return getKidByName(familyContext, dbKidName) ?? undefined;
}

// Fetch calendar events once for the whole brief — feeds the absence engine
// and cross-products. Degrade gracefully when OAuth isn't set up yet.
const calResult = await fetchUpcomingEvents(
  CALENDAR_LOOKAHEAD_DAYS,
  new Date(`${asOf}T00:00:00Z`),
);
let upcomingEvents: CalendarEvent[] = [];
if (calResult.status === "ok") {
  upcomingEvents = calResult.events;
  console.log(
    `Calendar: fetched ${upcomingEvents.length} event(s) over the next ${CALENDAR_LOOKAHEAD_DAYS} days.`,
  );
} else if (calResult.status === "not_configured") {
  console.warn(`Calendar: ${calResult.reason}`);
  console.warn(`Calendar: absence detection will be skipped. Run \`npm run auth:google\` to enable.`);
} else {
  console.warn(`Calendar: error fetching events (${calResult.reason}). Absence detection skipped.`);
}

const candidates: Candidate[] = [];
for (const kid of kids) {
  const contextKid = contextKidFor(kid.name);
  candidates.push(...outgrowingCandidatesFor(kid, asOf));
  candidates.push(...developmentalCandidatesFor(kid, asOf, { contextKid }));
  // Context-driven engines (silent if no context kid matched)
  candidates.push(...vaccinePrepCandidatesFor(kid, contextKid, asOf));
  candidates.push(...allergenWindowCandidatesFor(kid, contextKid, asOf));
  if (calResult.status === "ok") {
    candidates.push(...absenceCandidatesFor(kid, upcomingEvents, asOf, contextKid));
  }
}

// Cross-products are one Claude call per brief, not per kid (Claude sees the
// whole family + all upcoming events together). Skipped silently when there
// are no events to reason about. Skipped with a warning when no API key.
if (calResult.status === "ok" && upcomingEvents.length > 0) {
  const cps = await crossProductCandidatesFor(kids, upcomingEvents, asOf, {
    familyContext: familyContext ?? undefined,
  });
  if (cps.length > 0) {
    console.log(`Cross-products: Claude surfaced ${cps.length} item(s) from the calendar.`);
  }
  candidates.push(...cps);
}

// Annotate every candidate with the current_edge it relates to (if any),
// per v2.1 spec. The assembler then applies a score boost so edge-related
// items rank higher within their tier.
annotateWithEdges(candidates, (kidId) => {
  if (kidId === null) return undefined;
  const dbKid = kids.find((k) => k.id === kidId);
  return dbKid ? contextKidFor(dbKid.name) : undefined;
});
const edgeAnnotated = candidates.filter((c) => c.relatedToCurrentEdge).length;
if (edgeAnnotated > 0) {
  console.log(`Current edges: ${edgeAnnotated} candidate(s) tagged for priority boost.`);
}

console.log(
  `Collected ${candidates.length} candidate(s) across ${kids.length} kid(s) for week of ${asOf}.`,
);

if (opts.dryRun) {
  // For dry-run we don't persist, but we want the preview to match what the
  // assembler would actually pick. Mirror its dedup + edge-boosted ranking.
  const winners = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${c.kidId ?? "family"}|${c.triggerDetail}`;
    const existing = winners.get(key);
    if (!existing || c.rawScore > existing.rawScore) winners.set(key, c);
  }
  const EDGE_BOOST_DRY = 10;
  const effective = (c: Candidate): number =>
    c.rawScore + (c.relatedToCurrentEdge ? EDGE_BOOST_DRY : 0);
  const ranked = [...winners.values()].sort((a, b) => effective(b) - effective(a));
  console.log("");
  console.log("--- DRY RUN — not persisted ---");
  for (const [i, c] of ranked.entries()) {
    const boostTag = c.relatedToCurrentEdge ? ` +edge` : "";
    const edgeNote = c.relatedToCurrentEdge ? ` · edge: ${c.relatedToCurrentEdge}` : "";
    console.log(
      `${i + 1}. [${c.triggerDetail}] ${c.headline} (score=${c.rawScore}${boostTag}, conf=${c.confidence}${edgeNote})`,
    );
  }
  process.exit(0);
}

// 2. Assemble (select + optionally polish via Claude + persist).
const assembled = await assembleBrief(candidates, {
  weekOfIso: asOf,
  recipients,
  polish: opts.polish ? polishCandidates : undefined,
});

// 3. Console output.
console.log("");
console.log(renderConsole(assembled));

// 4. Markdown mirror.
mkdirSync("briefs", { recursive: true });
const path = `briefs/${assembled.brief.weekOf}.md`;
writeFileSync(path, renderMarkdown(assembled), "utf8");
console.log("");
console.log(`Wrote ${path} (brief id=${assembled.brief.id}, ${assembled.items.length} items).`);
