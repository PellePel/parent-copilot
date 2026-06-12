/**
 * Week-view read model (U3) — the structured data the web page renders.
 *
 * Reads the latest persisted brief and splits its items into:
 *   - hero:  the single highest-novelty NON-calendar forecast (the "oh man")
 *   - more:  the remaining non-calendar items, novelty-desc
 *   - strip: the calendar-derived items (appointments, well-visits, vaccine
 *            prep) — never eligible to headline
 *
 * Novelty ranking (U2) demotes items that headlined recent weeks so standing
 * facts stop re-leading. Note-derived actions (U6) are passed IN rather than
 * queried here — keeping this read model decoupled from the note_actions table.
 */

import { desc, eq, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { briefs, briefItems, kids as kidsTable, type CitedRecord } from "../db/schema.js";
import { todayIso } from "../age.js";
import { noveltyScoreFor } from "./novelty.js";

/** triggerDetail family prefixes that belong in the events strip, never the hero. */
const CALENDAR_FAMILIES = new Set(["crossproduct", "absence", "vaccine_prep"]);

function familyOf(triggerDetail: string | null): string {
  return triggerDetail ? (triggerDetail.split(":")[0] ?? "") : "";
}

export type WeekViewItem = {
  briefItemId: number;
  kidId: number | null;
  kidName: string | null;
  headline: string;
  body: string;
  suggestedAction: string | null;
  triggerSource: string;
  triggerDetail: string | null;
  reasoning: string;
  confidence: string;
  priority: number;
  citedRecord: CitedRecord | null;
  novelty: number;
};

/** A note-derived recommended action, surfaced alongside the brief (U6 supplies these). */
export type NoteActionView = {
  id: number;
  kidSpineId: string;
  forecastText: string;
  actionText: string;
  /** one_shot actions carry a "done?" affordance; ambient ones do not. */
  actionKind: "ambient" | "one_shot";
};

/** A kid the note form can attach a note to. */
export type KidRef = { spineId: string; name: string };

export type WeekView = {
  weekOf: string | null;
  hero: WeekViewItem | null;
  more: WeekViewItem[];
  strip: WeekViewItem[];
  actions: NoteActionView[];
  kids: KidRef[];
};

function rankByNoveltyThenPriority(a: WeekViewItem, b: WeekViewItem): number {
  if (b.novelty !== a.novelty) return b.novelty - a.novelty; // higher novelty first
  return a.priority - b.priority; // tiebreak: assembler rank (lower = higher)
}

export function buildWeekView(
  asOf: string = todayIso(),
  opts: { actions?: NoteActionView[] } = {},
): WeekView {
  const actions = opts.actions ?? [];

  const kidRows = db
    .select({ id: kidsTable.id, name: kidsTable.name, spineId: kidsTable.spineId })
    .from(kidsTable)
    .all();
  const kids: KidRef[] = kidRows
    .filter((k): k is typeof k & { spineId: string } => k.spineId !== null)
    .map((k) => ({ spineId: k.spineId, name: k.name }));

  // Most recent brief at or before asOf.
  const brief = db
    .select()
    .from(briefs)
    .where(lte(briefs.weekOf, asOf))
    .orderBy(desc(briefs.weekOf))
    .get();

  if (!brief) {
    return { weekOf: null, hero: null, more: [], strip: [], actions, kids };
  }

  const rows = db.select().from(briefItems).where(eq(briefItems.briefId, brief.id)).all();
  const kidName = new Map(kidRows.map((k) => [k.id, k.name]));

  const items: WeekViewItem[] = rows.map((r) => ({
    briefItemId: r.id,
    kidId: r.kidId,
    kidName: r.kidId !== null ? kidName.get(r.kidId) ?? null : null,
    headline: r.headline,
    body: r.body,
    suggestedAction: r.suggestedAction,
    triggerSource: r.triggerSource,
    triggerDetail: r.triggerDetail,
    reasoning: r.reasoning,
    confidence: r.confidence,
    priority: r.priority,
    citedRecord: r.citedRecord,
    novelty: noveltyScoreFor(r.kidId, r.triggerDetail, brief.weekOf),
  }));

  const calendar: WeekViewItem[] = [];
  const nonCalendar: WeekViewItem[] = [];
  for (const it of items) {
    (CALENDAR_FAMILIES.has(familyOf(it.triggerDetail)) ? calendar : nonCalendar).push(it);
  }

  nonCalendar.sort(rankByNoveltyThenPriority);
  calendar.sort((a, b) => a.priority - b.priority);

  const [hero, ...more] = nonCalendar;

  return {
    weekOf: brief.weekOf,
    hero: hero ?? null,
    more,
    strip: calendar,
    actions,
    kids,
  };
}
