/**
 * generate-brief CLI — Phase 2a entrypoint.
 *
 * Runs every available trigger engine for every kid, hands the candidates
 * to the assembler, prints the result to console, and writes a markdown
 * mirror to briefs/YYYY-MM-DD.md plus a structured log to .log.json.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { listKids } from "../lib/kids.js";
import { outgrowingCandidatesFor } from "../lib/engine/outgrowing.js";
import { developmentalCandidatesFor } from "../lib/engine/developmental.js";
import { absenceCandidatesFor } from "../lib/engine/absence.js";
import { vaccinePrepCandidatesFor } from "../lib/engine/vaccine_prep.js";
import { allergenWindowCandidatesFor } from "../lib/engine/allergen_window.js";
import { medicationFollowupCandidatesFor } from "../lib/engine/medication_followup.js";
import { crossProductCandidatesFor } from "../lib/engine/cross_products.js";
import { annotateWithEdges } from "../lib/engine/current_edges.js";
import { polishCandidates } from "../lib/engine/polish.js";
import { assembleBrief } from "../lib/engine/assembler.js";
import { renderConsole, renderMarkdown } from "../lib/engine/render.js";
import {
  buildBriefLog,
  writeBriefLog,
  type TokenUsage,
  type BriefLog,
} from "../lib/engine/brief_log.js";
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
import { deliverBrief } from "../lib/deliver.js";
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

const startedAtMs = Date.now();
const polishUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
const crossProductsUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

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
let contextLogMeta: { path: string; sha256: string } | null = null;
const ctxResult = loadFamilyContext();
if (ctxResult.status === "ok") {
  familyContext = ctxResult.context;
  contextLogMeta = { path: ctxResult.path, sha256: ctxResult.sha256 };
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
const calendarLogMeta: BriefLog["calendar"] = {
  status: "skipped",
  lookahead_days: CALENDAR_LOOKAHEAD_DAYS,
  events_count: 0,
};
if (calResult.status === "ok") {
  upcomingEvents = calResult.events;
  calendarLogMeta.status = "ok";
  calendarLogMeta.events_count = upcomingEvents.length;
  console.log(
    `Calendar: fetched ${upcomingEvents.length} event(s) over the next ${CALENDAR_LOOKAHEAD_DAYS} days.`,
  );
} else if (calResult.status === "not_configured") {
  calendarLogMeta.status = "not_configured";
  calendarLogMeta.reason = calResult.reason;
  console.warn(`Calendar: ${calResult.reason}`);
  console.warn(`Calendar: absence detection will be skipped. Run \`npm run auth:google\` to enable.`);
} else {
  calendarLogMeta.status = "error";
  calendarLogMeta.reason = calResult.reason;
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
  candidates.push(...medicationFollowupCandidatesFor(kid, contextKid, asOf));
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
    usage: crossProductsUsage,
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
// Wrap polishCandidates so we can capture usage even though the assembler
// owns when it's invoked.
const wrappedPolish = opts.polish
  ? (cs: Candidate[]) => polishCandidates(cs, { usage: polishUsage })
  : undefined;
const assembled = await assembleBrief(candidates, {
  weekOfIso: asOf,
  recipients,
  polish: wrappedPolish,
});

// 3. Console output.
console.log("");
console.log(renderConsole(assembled));

// 4. Markdown mirror.
mkdirSync("briefs", { recursive: true });
const markdownPath = `briefs/${assembled.brief.weekOf}.md`;
writeFileSync(markdownPath, renderMarkdown(assembled), "utf8");

// 5. Structured per-brief JSON log (v2.1 spec).
const log = buildBriefLog({
  asOf,
  weekOf: assembled.brief.weekOf,
  startedAtMs,
  contextLoaded: contextLogMeta,
  calendar: calendarLogMeta,
  allCandidates: candidates,
  assembled,
  polishUsage,
  crossProductsUsage,
});
const logPath = `briefs/${assembled.brief.weekOf}.log.json`;
writeBriefLog(logPath, log);

console.log("");
console.log(`Wrote ${markdownPath} (brief id=${assembled.brief.id}, ${assembled.items.length} items).`);
console.log(`Wrote ${logPath} (latency=${log.latency_ms}ms, polish_tokens=${polishUsage.input_tokens}+${polishUsage.output_tokens}, cross_tokens=${crossProductsUsage.input_tokens}+${crossProductsUsage.output_tokens}).`);

// 6. Deliver to Telegram. Skipped under --dry-run (which already exited above,
// but guard anyway). Degrades gracefully when the bot isn't configured —
// mirrors the calendar not_configured branch.
if (!opts.dryRun) {
  const total = assembled.items.length;
  const delivery = await deliverBrief(assembled.items);
  if (delivery.notConfigured) {
    console.warn(
      "Telegram not configured — skipping delivery (set TELEGRAM_BOT_TOKEN/CHAT_ID/CALLBACK_SECRET in .env).",
    );
  } else {
    console.log(
      `Delivered ${delivery.delivered}/${total} items to Telegram (${delivery.failed} failed).`,
    );
  }
}
