/**
 * Medication follow-up engine (v2.1 spec).
 *
 * For every entry in `context.medical.medications[]` whose `status` is
 * missing or contains a TBD-style placeholder ("<TBD>", "TBD — still in
 * use?", "unknown") AND was `started` more than 30 days ago, fires an
 * "is this still active?" follow-up signal.
 *
 * This is the spec's "catches the nystatin / saline neb situation" case:
 * Jude has a saline neb prescribed in January and a nystatin ointment from
 * March, both with TBD status because no one confirmed whether they were
 * still in use. The brief should surface these so Nick can check in with
 * Mika and update context.
 *
 * Scoring scales with staleness — a med pending 4 months of TBD is harder
 * to ignore than one pending 5 weeks.
 *
 * Reasoning carries the original context entry so the brief item can cite
 * exactly what's open and why.
 */

import { ageInMonths, daysBetween, formatAge, todayIso } from "../age.js";
import { type Kid as DbKid } from "../db/schema.js";
import {
  type Kid as ContextKid,
  type ContextMedication,
  getKidMedications,
  spineIdFromName,
} from "../context.js";
import type { Candidate } from "./types.js";

const FLAG_AFTER_DAYS = 30;
const STALE_BOOST_DAYS = 60; // status TBD past this is "really stale"
const VERY_STALE_DAYS = 120;

const TBD_MARKERS = [
  "tbd",
  "<tbd>",
  "unknown",
  "unclear",
  "to be determined",
  "?",
];

/** True if the status string is missing or names a TBD-style placeholder. */
function isStatusTBD(status: string | undefined): boolean {
  if (!status) return true;
  const lower = status.toLowerCase();
  if (lower.trim() === "") return true;
  return TBD_MARKERS.some((m) => lower.includes(m));
}

function safeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function scoreForStaleness(daysSinceStart: number): {
  rawScore: number;
  confidence: "high" | "medium" | "low";
  framing: "fresh" | "stale" | "very_stale";
} {
  if (daysSinceStart >= VERY_STALE_DAYS) {
    return { rawScore: 72, confidence: "high", framing: "very_stale" };
  }
  if (daysSinceStart >= STALE_BOOST_DAYS) {
    return { rawScore: 60, confidence: "medium", framing: "stale" };
  }
  return { rawScore: 50, confidence: "medium", framing: "fresh" };
}

function describeMed(med: ContextMedication): string {
  // "nystatin (MYCOSTATIN) 100,000 unit/gram ointment" → "nystatin ointment"
  // Keep it natural; strip parenthetical brand names for the headline.
  const stripped = med.name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return stripped.length > 60 ? `${stripped.slice(0, 57)}…` : stripped;
}

export function medicationFollowupCandidatesFor(
  kid: DbKid,
  contextKid: ContextKid | undefined,
  asOf: string = todayIso(),
): Candidate[] {
  if (!contextKid) return [];
  const medications = getKidMedications(contextKid);
  if (medications.length === 0) return [];

  const ageStr = formatAge(kid.dob, asOf);
  const ageMonths = ageInMonths(kid.dob, asOf);
  const kidSpineId = contextKid.id ?? kid.spineId ?? spineIdFromName(kid.name);
  const candidates: Candidate[] = [];

  for (const med of medications) {
    if (!isStatusTBD(med.status)) continue;
    if (!med.started || !/^\d{4}-\d{2}-\d{2}$/.test(med.started)) continue;

    const daysSinceStart = daysBetween(med.started, asOf);
    if (daysSinceStart < FLAG_AFTER_DAYS) continue;

    const { rawScore, confidence, framing } = scoreForStaleness(daysSinceStart);
    const slug = safeSlug(med.name);
    const triggerDetail = `medication_followup:${slug}`;

    const shortName = describeMed(med);
    const weeksSince = Math.round(daysSinceStart / 7);
    const startedClause = `started ${med.started} (~${weeksSince} weeks ago)`;
    const contextLine = med.context ? ` Context: ${med.context}` : "";
    const instructionsLine = med.instructions ? ` Instructions: ${med.instructions}` : "";

    let headline: string;
    if (framing === "very_stale") {
      headline = `${kid.name} still on ${shortName}? Status untracked for ${Math.round(daysSinceStart / 30)} months`;
    } else if (framing === "stale") {
      headline = `Is ${kid.name} still using ${shortName}?`;
    } else {
      headline = `Check in: is ${kid.name} still using ${shortName}?`;
    }

    const body =
      `${kid.name} is ${ageStr}. ${med.name} ${startedClause}, but the context still has it as ${med.status ? `"${med.status}"` : "no status set"}.${contextLine}${instructionsLine}`;

    const suggestedAction =
      `Check with Mika whether ${shortName} is still in use, then update ` +
      `context.medical.medications.status to active / resolved / discontinued. ` +
      `If active, note current dose and any prescriber follow-up needed.`;

    const reasoning =
      `kid age=${ageStr} (${ageMonths}mo). medication entry "${med.name}" ` +
      `with status="${med.status ?? "<undefined>"}" matched TBD pattern. ` +
      `started=${med.started}, daysSinceStart=${daysSinceStart} (>= FLAG_AFTER_DAYS=${FLAG_AFTER_DAYS}). ` +
      `staleness=${framing}. KB source: family_context.json (medical.medications).`;

    candidates.push({
      kidId: kid.id,
      headline,
      body,
      suggestedAction,
      triggerSource: "lookahead",
      triggerDetail,
      citedRecord: { kidSpineId, path: `medical.medications[${slug}]` },
      reasoning,
      confidence,
      rawScore,
    });
  }

  return candidates;
}
