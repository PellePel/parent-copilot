/**
 * Allergen-introduction window engine (v2.1 spec).
 *
 * AAP/NIAID guidance: introduce nine common allergens (peanut, tree nuts,
 * egg, wheat, dairy, soy, fish, shellfish, sesame) one at a time, separated
 * by days, between 4-6 months. The window narrows quickly — kids who pass
 * 12 months without exposure have higher lifetime allergy risk.
 *
 * Two firing modes from the spec:
 *   - "Start rollout — narrowing window": kid 4-6 months AND introduced
 *     list is empty.
 *   - "Continue allergen rollout": kid 4-7 months AND introduced is
 *     non-empty but missing at least one standard allergen.
 *
 * Reads exclusively from context.patterns.eating.allergen_introduction_status.
 * No calendar, no DB measurements. If the field is missing, the engine is
 * silent (this isn't a "we don't know" inference — it's a "no data, no
 * signal").
 */

import { z } from "zod";
import { ageInMonths, formatAge, todayIso } from "../age.js";
import { type Kid as DbKid } from "../db/schema.js";
import { type Kid as ContextKid } from "../context.js";
import type { Candidate } from "./types.js";

const STANDARD_ALLERGENS = [
  "peanut",
  "tree_nuts",
  "egg",
  "wheat",
  "dairy",
  "soy",
  "fish",
  "shellfish",
  "sesame",
] as const;

const AllergenStatusSchema = z.object({
  approach: z.string().optional(),
  introduced: z.array(z.string()).optional(),
  not_yet_introduced: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

function getAllergenStatus(
  contextKid: ContextKid,
): z.infer<typeof AllergenStatusSchema> | null {
  const patterns = (contextKid as Record<string, unknown>)["patterns"];
  if (!patterns || typeof patterns !== "object") return null;
  const eating = (patterns as Record<string, unknown>)["eating"];
  if (!eating || typeof eating !== "object") return null;
  const status = (eating as Record<string, unknown>)["allergen_introduction_status"];
  const parsed = AllergenStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : null;
}

export function allergenWindowCandidatesFor(
  kid: DbKid,
  contextKid: ContextKid | undefined,
  asOf: string = todayIso(),
): Candidate[] {
  if (!contextKid) return [];

  const ageMonths = ageInMonths(kid.dob, asOf);
  if (ageMonths < 4 || ageMonths > 7) return [];

  const status = getAllergenStatus(contextKid);
  if (!status) return [];

  const introduced = (status.introduced ?? []).map((s) => s.toLowerCase());
  const missing = STANDARD_ALLERGENS.filter((a) => !introduced.includes(a));
  if (missing.length === 0) return []; // all done

  const ageStr = formatAge(kid.dob, asOf);
  const startMode = introduced.length === 0;

  if (startMode && (ageMonths < 4 || ageMonths > 6)) return []; // narrow start window

  const headline = startMode
    ? `${kid.name}'s allergen-introduction window is narrowing — nothing started yet`
    : `${kid.name}'s allergen rollout: ${missing.length} of ${STANDARD_ALLERGENS.length} still to go`;

  const introducedLine =
    introduced.length > 0
      ? `Introduced so far: ${introduced.join(", ")}. `
      : "Nothing started yet. ";
  const remainingLine = `Still to introduce: ${missing.join(", ").replace(/_/g, " ")}.`;
  const bodyLead = startMode
    ? `${kid.name} is ${ageStr}. AAP/NIAID guidance: introduce the 9 common allergens between 4-6 months, one at a time, separated by days.`
    : `${kid.name} is ${ageStr} and the AAP/NIAID rollout window goes until ~12 months.`;
  const body = `${bodyLead} ${introducedLine}${remainingLine}`;

  const suggestedAction = startMode
    ? "Peanut is a reasonable first introduction (peanut puff or thinned peanut butter on a spoon). Have children's Benadryl on hand before starting. If severe eczema is present, talk to the pediatrician about peanut intro first."
    : "Continue one allergen at a time, separated by 2-3 days so you can attribute any reaction. Track in context.patterns.eating.allergen_introduction_status.introduced as you go.";

  const reasoning =
    `kid age=${ageMonths}mo (${ageStr}). Mode=${startMode ? "start" : "continue"}. ` +
    `introduced=[${introduced.join(", ")}], missing=[${missing.join(", ")}]. ` +
    `KB source: AAP/NIAID early-allergen-introduction guidance; family_context.json (patterns.eating).`;

  // Higher priority in start mode (window narrowing fast).
  const rawScore = startMode ? 82 : 70;

  return [
    {
      kidId: kid.id,
      headline,
      body,
      suggestedAction,
      triggerSource: "lookahead",
      triggerDetail: startMode ? "allergen:start" : "allergen:continue",
      reasoning,
      confidence: "high",
      rawScore,
    },
  ];
}
