/**
 * Absence-detection engine — the calendar-aware half of Lookahead.
 *
 * For each kid, iterates the AAP well-visit schedule in age order and surfaces
 * the FIRST visit (past or upcoming) that's actionable AND not already handled.
 * A visit is "handled" if either:
 *   1. A `well_visit` event is logged in our `events` table within ±windowWeeks
 *      of the target date, OR
 *   2. An upcoming Google Calendar event in the next 14 days looks like a
 *      well-visit for this kid (keyword match — see calendar.ts).
 *
 * Suppression: like the developmental engine, skips a (kidId, triggerDetail)
 * that fired in any brief within the last 4 weeks.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { ageInMonths, daysBetween, formatAge, todayIso } from "../age.js";
import { db } from "../db/index.js";
import { events, type Kid } from "../db/schema.js";
import {
  WELL_VISIT_KB,
  WELL_VISIT_SCHEDULE,
  type WellVisitMilestone,
} from "../kb/well_visits.js";
import { looksLikeWellVisit, type CalendarEvent } from "../calendar.js";
import { firedInLast } from "./suppression.js";
import type { Candidate } from "./types.js";

const SUPPRESSION_WINDOW_WEEKS = 4;
const FLAG_WITHIN_WEEKS = 6; // start nudging this far out
const PAST_HORIZON_WEEKS = 8; // look back this far for missed visits
const OVERDUE_WEEKS_PAST_TARGET = 2; // past target by this much → overdue framing

/** Has a well_visit event been logged within ±toleranceWeeks of targetDateIso? */
function isWellVisitHandledByEvent(
  kidId: number,
  targetDateIso: string,
  toleranceWeeks: number,
): boolean {
  const targetMs = new Date(`${targetDateIso}T00:00:00Z`).getTime();
  const lo = new Date(targetMs - toleranceWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const hi = new Date(targetMs + toleranceWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const row = db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.kidId, kidId),
        eq(events.type, "well_visit"),
        gte(events.occurredOn, lo),
        lte(events.occurredOn, hi),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

/** ISO date that's `months` months after `dob` (anniversary-safe). */
function dobPlusMonths(dob: string, months: number): string {
  const d = new Date(`${dob}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.floor(months));
  const frac = months - Math.floor(months);
  if (frac > 0) d.setUTCDate(d.getUTCDate() + Math.round(frac * 30));
  return d.toISOString().slice(0, 10);
}

/** Find the first unhandled well-visit in the actionable window. */
function findUnhandledVisit(
  kid: Kid,
  upcomingEvents: CalendarEvent[],
  asOf: string,
): { visit: WellVisitMilestone; targetIso: string; weeksToTarget: number } | null {
  // Pre-compute whether ANY upcoming calendar event looks like a well-visit
  // for this kid. If so, every visit milestone is considered handled (we
  // assume one upcoming visit covers whichever milestone is due).
  const calendarCovers = upcomingEvents.some((e) =>
    looksLikeWellVisit(e, kid.name, kid.pediatrician ?? undefined),
  );

  for (const visit of WELL_VISIT_SCHEDULE) {
    const targetIso = dobPlusMonths(kid.dob, visit.ageMonths);
    const weeksToTarget = daysBetween(asOf, targetIso) / 7;

    // Past the actionable horizon: skip ancient visits, stop iterating once
    // we hit a future visit beyond the flag window (schedule is sorted by age).
    if (weeksToTarget < -PAST_HORIZON_WEEKS) continue;
    if (weeksToTarget > FLAG_WITHIN_WEEKS) break;

    if (isWellVisitHandledByEvent(kid.id, targetIso, visit.windowWeeks)) continue;
    if (calendarCovers) continue;
    return { visit, targetIso, weeksToTarget };
  }
  return null;
}

export function absenceCandidatesFor(
  kid: Kid,
  upcomingEvents: CalendarEvent[],
  asOf: string = todayIso(),
): Candidate[] {
  const ageMonths = ageInMonths(kid.dob, asOf);
  const found = findUnhandledVisit(kid, upcomingEvents, asOf);
  if (!found) return [];

  const { visit, targetIso, weeksToTarget } = found;
  const triggerDetail = `absence:well_visit:${visit.id}`;
  if (firedInLast(kid.id, triggerDetail, SUPPRESSION_WINDOW_WEEKS, asOf)) return [];

  const isOverdue = weeksToTarget < -OVERDUE_WEEKS_PAST_TARGET;
  const isImminent = weeksToTarget >= 0 && weeksToTarget <= 3;
  const confidence = isOverdue || isImminent ? "high" : "medium";
  const rawScore = isOverdue ? 88 : isImminent ? 78 : 60;

  const ageStr = formatAge(kid.dob, asOf);
  const vaccinesLine =
    visit.expectedVaccines && visit.expectedVaccines.length > 0
      ? ` Typical vaccines at this visit: ${visit.expectedVaccines.join(", ")}.`
      : "";

  let headline: string;
  let body: string;
  let suggestedAction: string;

  if (isOverdue) {
    const weeksLate = Math.abs(Math.round(weeksToTarget));
    headline = `${kid.name}'s ${visit.label} appears overdue and isn't on the calendar`;
    body =
      `${kid.name} is ${ageStr}; the ${visit.label} is typically around ${visit.ageMonths} months ` +
      `(${weeksLate} weeks ago by now). Nothing matching a well-visit shows up in the next 14 days, and ` +
      `no well_visit event has been logged for ${kid.name} in the relevant window.${vaccinesLine}`;
    suggestedAction = `Call the pediatrician's office to schedule. If it was done elsewhere, log it with \`npm run log-event -- --kid ${kid.name} --type well_visit --date YYYY-MM-DD\` so the brief stops flagging it.`;
  } else if (isImminent) {
    headline = `${kid.name}'s ${visit.label} is due in ~${Math.max(1, Math.round(weeksToTarget))} weeks — nothing on the calendar yet`;
    body =
      `${kid.name} is ${ageStr} and the AAP schedule has the ${visit.label} around ${visit.ageMonths} months. ` +
      `Nothing matching a well-visit appears in the next 14 days of your calendar.${vaccinesLine}`;
    suggestedAction = `Get this on the calendar this week — pediatric scheduling lead times are usually 4–6 weeks.`;
  } else {
    const weeksAway = Math.round(weeksToTarget);
    headline = `${kid.name}'s ${visit.label} is coming up in ~${weeksAway} weeks`;
    body =
      `${kid.name} is ${ageStr}; the ${visit.label} typically lands around ${visit.ageMonths} months. ` +
      `Nothing matching a well-visit is on the next 14 days of your calendar, so worth getting on the schedule before slots get tight.${vaccinesLine}`;
    suggestedAction = `Call the pediatrician to book — ${weeksAway} weeks out is a comfortable lead time.`;
  }

  const reasoning =
    `Kid age=${ageMonths}mo. First unhandled AAP visit in actionable range = ${visit.label} ` +
    `(target ${visit.ageMonths}mo on ${targetIso}, ±${visit.windowWeeks}wk handled-window). ` +
    `weeksToTarget=${weeksToTarget.toFixed(1)} (horizon: -${PAST_HORIZON_WEEKS} to +${FLAG_WITHIN_WEEKS} weeks). ` +
    `No well_visit event in target ±${visit.windowWeeks}wk; no matching calendar event among ${upcomingEvents.length} upcoming. ` +
    `KB source: ${WELL_VISIT_KB.source}`;

  return [
    {
      kidId: kid.id,
      headline,
      body,
      suggestedAction,
      triggerSource: "lookahead",
      triggerDetail,
      reasoning,
      confidence,
      rawScore,
    },
  ];
}
