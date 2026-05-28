/**
 * Vaccine pre-visit prep engine (v2.1 spec).
 *
 * Fires when a well-visit is within ~2 weeks AND the kid's medical history
 * has anything mentioning vaccines or fever — the marquee Jude case from the
 * spec: "Jude had a 104°F post-vaccine fever and ER visit in Jan 2026 — his
 * next vaccine appointment is June 9, and nothing in the current brief flags
 * this."
 *
 * Reads exclusively from `family_context.json` (medical.next_well_visit and
 * medical.notable_history). The calendar is NOT consulted here — if the
 * visit isn't in context, the engine doesn't fire. Phase 3c can add a fallback
 * to read from calendar when context's next_well_visit is missing.
 *
 * Score is intentionally high (90 base). Pre-medication decisions and ER
 * thresholds are exactly the kind of "Mika carries this in her head" content
 * the brief exists to externalize.
 */

import { z } from "zod";
import { daysBetween, formatAge, todayIso } from "../age.js";
import { type Kid as DbKid } from "../db/schema.js";
import { type Kid as ContextKid } from "../context.js";
import type { Candidate } from "./types.js";

const FLAG_WITHIN_DAYS = 14; // spec: "well-visit is within 2 weeks"

const NextWellVisitSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  type: z.string().optional(),
  time: z.string().optional(),
  notes: z.string().optional(),
});

const NotableHistoryEntrySchema = z.object({
  event: z.string(),
  date: z.string().optional(),
  details: z.string().optional(),
  implication: z.string().optional(),
  confidence: z.string().optional(),
  source: z.string().optional(),
});

function getNextWellVisit(
  contextKid: ContextKid,
): z.infer<typeof NextWellVisitSchema> | null {
  const medical = (contextKid as Record<string, unknown>)["medical"];
  if (!medical || typeof medical !== "object") return null;
  const next = (medical as Record<string, unknown>)["next_well_visit"];
  const parsed = NextWellVisitSchema.safeParse(next);
  return parsed.success ? parsed.data : null;
}

function getNotableHistory(
  contextKid: ContextKid,
): Array<z.infer<typeof NotableHistoryEntrySchema>> {
  const medical = (contextKid as Record<string, unknown>)["medical"];
  if (!medical || typeof medical !== "object") return [];
  const list = (medical as Record<string, unknown>)["notable_history"];
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => NotableHistoryEntrySchema.safeParse(e))
    .filter((r): r is { success: true; data: z.infer<typeof NotableHistoryEntrySchema> } => r.success)
    .map((r) => r.data);
}

function relevantToVaccineVisit(
  entry: z.infer<typeof NotableHistoryEntrySchema>,
): boolean {
  const text = `${entry.event} ${entry.details ?? ""}`.toLowerCase();
  return text.includes("vaccine") || text.includes("fever") || text.includes("reaction");
}

export function vaccinePrepCandidatesFor(
  kid: DbKid,
  contextKid: ContextKid | undefined,
  asOf: string = todayIso(),
): Candidate[] {
  if (!contextKid) return [];
  const visit = getNextWellVisit(contextKid);
  if (!visit) return [];

  const daysAway = daysBetween(asOf, visit.date);
  if (daysAway < 0 || daysAway > FLAG_WITHIN_DAYS) return [];

  const history = getNotableHistory(contextKid);
  const relevant = history.filter(relevantToVaccineVisit);
  if (relevant.length === 0) return [];

  // Use the most recent relevant entry (sort by date descending if dates exist).
  const sorted = [...relevant].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const primary = sorted[0]!;

  const visitLabel = visit.type ? `${visit.type} visit` : "well-visit";
  const ageStr = formatAge(kid.dob, asOf);

  const headline = `${kid.name}'s ${visitLabel} ${visit.date}: prep given prior ${primary.event.toLowerCase().includes("fever") ? "fever reaction" : "history"}`;

  const detailsLine = primary.details ? ` ${primary.details}` : "";
  const body =
    `${kid.name} is ${ageStr}; ${visitLabel} is in ${daysAway} day${daysAway === 1 ? "" : "s"} (${visit.date}). ` +
    `Notable history: ${primary.event}${primary.date ? ` (${primary.date})` : ""}.${detailsLine}`;

  const suggestedAction =
    primary.implication ??
    "Talk to the pediatrician ahead of the visit about pre-medicating with acetaminophen, the fever threshold/symptoms that warrant calling vs. ER, and whether vaccines can be spaced across multiple visits.";

  const reasoning =
    `kid age=${ageStr}, dob=${kid.dob}. context.medical.next_well_visit.date=${visit.date} ` +
    `(${daysAway}d away, within FLAG_WITHIN_DAYS=${FLAG_WITHIN_DAYS}). ` +
    `Matched notable_history entry: "${primary.event}"${primary.date ? ` (${primary.date})` : ""} ` +
    `(matched keywords: vaccine/fever/reaction). KB source: family_context.json (medical).`;

  return [
    {
      kidId: kid.id,
      headline,
      body,
      suggestedAction,
      triggerSource: "lookahead",
      triggerDetail: "vaccine_prep",
      reasoning,
      confidence: "high",
      rawScore: 90,
    },
  ];
}
