/**
 * Google Calendar fetcher.
 *
 * Returns a structured status response so the brief degrades gracefully when
 * OAuth isn't configured (instead of crashing or false-positively reporting
 * an empty calendar — that would cause every absence detection to fire).
 *
 * Fixture mode: set COPILOT_CALENDAR_FIXTURE=/path/to/events.json to bypass
 * the real API. The JSON file should be an array of CalendarEvent objects.
 * Used by the engineering check to validate the absence engine without
 * requiring real OAuth.
 */

import { existsSync, readFileSync } from "node:fs";
import { google } from "googleapis";
import {
  GoogleNotConfiguredError,
  getAuthorizedClient,
} from "./google.js";

export type CalendarEvent = {
  id: string;
  /** Human-readable event title (Google's `summary`). */
  summary: string;
  /** ISO date or datetime. All-day events use YYYY-MM-DD; timed events ISO datetime. */
  start: string;
  end: string;
  description?: string;
  /** Google Calendar's `location` field, if set. */
  location?: string;
};

export type FetchResult =
  | { status: "ok"; events: CalendarEvent[] }
  | { status: "not_configured"; reason: string }
  | { status: "error"; reason: string };

/**
 * Default calendar lookahead window. Set to 30 days to catch trips and
 * larger planned events 2–4 weeks out, when there's still time to prep
 * (e.g. swim diapers for an upcoming beach trip). Smaller windows miss
 * those signals; larger windows add noise.
 */
export const CALENDAR_LOOKAHEAD_DAYS = 30;

/**
 * Fetch upcoming events from the user's primary Google Calendar.
 * @param days how many days ahead to look (default CALENDAR_LOOKAHEAD_DAYS)
 * @param asOf base date for "now" — defaults to current time
 */
export async function fetchUpcomingEvents(
  days = CALENDAR_LOOKAHEAD_DAYS,
  asOf: Date = new Date(),
): Promise<FetchResult> {
  const fixturePath = process.env.COPILOT_CALENDAR_FIXTURE;
  if (fixturePath) {
    return loadFixture(fixturePath);
  }

  let auth;
  try {
    auth = getAuthorizedClient();
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) {
      return { status: "not_configured", reason: err.message };
    }
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }

  try {
    const cal = google.calendar({ version: "v3", auth });
    const timeMin = asOf.toISOString();
    const timeMax = new Date(asOf.getTime() + days * 86_400_000).toISOString();
    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });
    const items = resp.data.items ?? [];
    const events: CalendarEvent[] = items
      .filter((e) => e.id && e.start)
      .map((e) => ({
        id: e.id!,
        summary: e.summary ?? "(no title)",
        start: e.start?.date ?? e.start?.dateTime ?? "",
        end: e.end?.date ?? e.end?.dateTime ?? "",
        description: e.description ?? undefined,
        location: e.location ?? undefined,
      }))
      .filter((e) => e.start && e.end);
    return { status: "ok", events };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

function loadFixture(path: string): FetchResult {
  if (!existsSync(path)) {
    return { status: "error", reason: `Fixture file not found: ${path}` };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) {
      return { status: "error", reason: `Fixture file is not a JSON array: ${path}` };
    }
    return { status: "ok", events: raw as CalendarEvent[] };
  } catch (err) {
    return {
      status: "error",
      reason: `Failed to parse fixture ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Naive keyword filter: does an event look like a pediatric well-visit for
 * the given kid? Matches the kid's name, the pediatrician's name (if known),
 * and a handful of generic well-visit keywords. False positives are cheap
 * here (we just suppress an absence item); false negatives are worse (we'd
 * false-positively flag an absence).
 */
export function looksLikeWellVisit(
  event: CalendarEvent,
  kidName: string,
  pediatrician?: string | null,
): boolean {
  const text = `${event.summary} ${event.description ?? ""} ${event.location ?? ""}`.toLowerCase();
  if (!text.trim()) return false;

  const keywords = ["pediatrician", "ped.", "well visit", "well-visit", "wellvisit", "checkup", "check-up", "well child"];
  if (keywords.some((k) => text.includes(k))) return true;

  // If the kid's name appears together with a clinical hint, count it.
  const hasKid = text.includes(kidName.toLowerCase());
  const clinicalHints = ["dr.", "doctor", "appt", "appointment", "visit", "clinic"];
  if (hasKid && clinicalHints.some((h) => text.includes(h))) return true;

  // Pediatrician name match (if set on the kid).
  if (pediatrician && text.includes(pediatrician.toLowerCase())) return true;

  return false;
}
