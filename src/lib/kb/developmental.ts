/**
 * Developmental windows — the second half of the Lookahead engine.
 *
 * Each window is an age band when a behavioral or developmental phase is
 * likely to start, peak, or be active for a kid. The engine fires a candidate
 * when the kid's current age falls within `[onsetMin, onsetMax + duration]`,
 * with recently-fired suppression to avoid weekly repetition.
 *
 * Tone discipline (R2): every body uses "often," "typically," or "may" —
 * never "will." Developmental timing varies widely and a confident-but-wrong
 * claim kills trust. Most windows are MEDIUM confidence; HIGH is reserved for
 * narrow, well-established bands; LOW for wide bands with high individual
 * variance.
 *
 * Sources: AAP "Bright Futures" developmental milestones; CDC "Learn the
 * Signs. Act Early." milestone tracker; Ferber/Weissbluth on sleep
 * regressions; pediatric developmental literature (general).
 */

import type { ConfidenceLevel } from "../db/schema.js";

export type DevelopmentalCategory =
  | "sleep"
  | "social"
  | "motor"
  | "language"
  | "feeding"
  | "cognition";

export type DevelopmentalWindow = {
  /** Stable slug used as part of triggerDetail. Never rename without thinking
   *  about historical brief_items. */
  id: string;
  category: DevelopmentalCategory;
  title: string;
  /** Inclusive lower bound of the typical onset age in months. */
  onsetAgeMonthsMin: number;
  /** Exclusive upper bound of the typical onset age in months. */
  onsetAgeMonthsMax: number;
  /** How long the phase typically lasts after onset, in months. Used to
   *  compute the suppress-after age. */
  durationMonths: number;
  /** Default confidence at firing time. */
  confidence: ConfidenceLevel;
  /** Headline template. {name} is replaced with the kid's name. */
  headlineTemplate: string;
  /** Body template. {name}, {age_str} are replaced. */
  bodyTemplate: string;
  /** Suggested action template. {name} is replaced. */
  suggestedActionTemplate?: string;
  source: string;
};

// =============================================================================
// Sleep regressions
// =============================================================================
const SLEEP: DevelopmentalWindow[] = [
  {
    id: "sleep_regression_4mo",
    category: "sleep",
    title: "4-month sleep regression",
    onsetAgeMonthsMin: 3.5,
    onsetAgeMonthsMax: 5,
    durationMonths: 1.5,
    confidence: "high",
    headlineTemplate: "{name} may be in the 4-month sleep regression window",
    bodyTemplate:
      "Around {age_str}, many babies' sleep cycles mature and night wakings often increase for a few weeks. It usually settles within 4–6 weeks.",
    suggestedActionTemplate:
      "If sleep has gotten rougher, this is likely why. Hold the bedtime routine steady rather than introducing new sleep associations you'll need to undo later.",
    source: "Pediatric sleep literature (Ferber, Weissbluth); AAP guidance",
  },
  {
    id: "sleep_regression_8_10mo",
    category: "sleep",
    title: "8-10 month sleep regression",
    onsetAgeMonthsMin: 8,
    onsetAgeMonthsMax: 10,
    durationMonths: 2,
    confidence: "medium",
    headlineTemplate: "{name} is in the 8–10 month sleep regression window",
    bodyTemplate:
      "Around {age_str}, regressions often coincide with crawling, pulling up, separation anxiety, and new molars — wakings can cluster for a few weeks.",
    suggestedActionTemplate:
      "Practice new motor skills during the day (kids will try to crawl in the crib otherwise). Keep night responses brief and predictable.",
    source: "Pediatric sleep literature; common parent-tracker data",
  },
  {
    id: "sleep_regression_12mo",
    category: "sleep",
    title: "12-month sleep regression",
    onsetAgeMonthsMin: 11,
    onsetAgeMonthsMax: 13,
    durationMonths: 2,
    confidence: "medium",
    headlineTemplate: "{name} may hit the 12-month sleep regression",
    bodyTemplate:
      "Around {age_str}, walking, separation anxiety, and the nap transition (3 → 2 or 2 → 1) often pile up. Sleep can wobble for 2–4 weeks.",
    source: "Pediatric sleep literature",
  },
  {
    id: "sleep_regression_18mo",
    category: "sleep",
    title: "18-month sleep regression",
    onsetAgeMonthsMin: 17,
    onsetAgeMonthsMax: 19,
    durationMonths: 2,
    confidence: "medium",
    headlineTemplate: "{name} may hit the 18-month sleep regression",
    bodyTemplate:
      "Around {age_str}, the regression often shows up as bedtime resistance and middle-of-night wakings — driven by autonomy push, molars, and language explosion.",
    suggestedActionTemplate:
      "Limit-set early at bedtime; don't bargain in the middle of the night. The wobble usually resolves in 2–4 weeks.",
    source: "Pediatric sleep literature",
  },
  {
    id: "sleep_regression_2y",
    category: "sleep",
    title: "2-year sleep regression",
    onsetAgeMonthsMin: 23,
    onsetAgeMonthsMax: 25,
    durationMonths: 2,
    confidence: "medium",
    headlineTemplate: "{name} may hit the 2-year sleep regression",
    bodyTemplate:
      "Around {age_str}, sleep often gets rough thanks to nightmares starting, new fears (dark, monsters), molars, and the nap potentially dropping.",
    source: "Pediatric sleep literature",
  },
];

// =============================================================================
// Social / emotional
// =============================================================================
const SOCIAL: DevelopmentalWindow[] = [
  {
    id: "stranger_anxiety_onset",
    category: "social",
    title: "Stranger anxiety onset",
    onsetAgeMonthsMin: 6,
    onsetAgeMonthsMax: 9,
    durationMonths: 9,
    confidence: "high",
    headlineTemplate: "{name} is in the window when stranger anxiety often starts",
    bodyTemplate:
      "Around {age_str}, kids often start showing wariness of new people — clinging, crying when handed off, hiding their face. It typically peaks around 12–18 months and fades by 2.",
    suggestedActionTemplate:
      "Give a heads-up to anyone meeting {name} for the first time — it's not 'shy with you,' it's developmental. Slow approaches and letting {name} initiate help.",
    source: "AAP developmental milestones; CDC 'Learn the Signs'",
  },
  {
    id: "separation_anxiety_onset",
    category: "social",
    title: "Separation anxiety onset",
    onsetAgeMonthsMin: 8,
    onsetAgeMonthsMax: 12,
    durationMonths: 8,
    confidence: "high",
    headlineTemplate: "{name} is entering the separation-anxiety window",
    bodyTemplate:
      "Around {age_str}, kids develop object permanence enough to know you've left, but not enough to know you'll come back. Drop-offs and bedtimes get harder; peaks 10–18 months, eases by 2.",
    suggestedActionTemplate:
      "Short, warm, consistent goodbye ritual beats a quick sneak-out. 'Bye, see you after nap, I love you' — every time.",
    source: "AAP; pediatric developmental literature",
  },
  {
    id: "tantrum_onset",
    category: "social",
    title: "Toddler tantrum onset",
    onsetAgeMonthsMin: 15,
    onsetAgeMonthsMax: 18,
    durationMonths: 18,
    confidence: "high",
    headlineTemplate: "{name} is entering the prime tantrum window",
    bodyTemplate:
      "Around {age_str}, big feelings outpace the language to express them. Tantrums often peak 18–30 months. Frequency drops as language develops.",
    suggestedActionTemplate:
      "Name the feeling out loud ('you're so frustrated'), keep yourself calm, hold limits without bargaining. Most tantrums end faster when not negotiated with.",
    source: "AAP; common developmental guidance",
  },
  {
    id: "parallel_to_cooperative_play",
    category: "social",
    title: "Parallel → cooperative play transition",
    onsetAgeMonthsMin: 24,
    onsetAgeMonthsMax: 36,
    durationMonths: 12,
    confidence: "low",
    headlineTemplate: "{name} may be moving from parallel to cooperative play",
    bodyTemplate:
      "Around {age_str}, kids start engaging WITH playmates instead of just alongside them. Sharing is still hard; turn-taking starts to click.",
    source: "CDC milestone tracker; Parten's stages of play",
  },
];

// =============================================================================
// Motor
// =============================================================================
const MOTOR: DevelopmentalWindow[] = [
  {
    id: "rolling_window",
    category: "motor",
    title: "Rolling over",
    onsetAgeMonthsMin: 3,
    onsetAgeMonthsMax: 5,
    durationMonths: 2,
    confidence: "high",
    headlineTemplate: "{name} is in the rolling-over window",
    bodyTemplate:
      "Around {age_str}, kids often start rolling — usually belly-to-back first, back-to-belly a few weeks later. Most have it by 6 months.",
    suggestedActionTemplate:
      "Never leave {name} unattended on couches or changing tables — first rolls usually happen when you're not expecting them.",
    source: "CDC milestones; AAP",
  },
  {
    id: "sitting_unassisted_window",
    category: "motor",
    title: "Sitting unassisted",
    onsetAgeMonthsMin: 5,
    onsetAgeMonthsMax: 7,
    durationMonths: 2,
    confidence: "high",
    headlineTemplate: "{name} is in the sitting-up window",
    bodyTemplate:
      "Around {age_str}, kids usually start sitting with hands for support, then unsupported. Most can sit unassisted by 7–8 months.",
    source: "CDC milestones; AAP",
  },
  {
    id: "crawling_window",
    category: "motor",
    title: "Crawling",
    onsetAgeMonthsMin: 7,
    onsetAgeMonthsMax: 10,
    durationMonths: 3,
    confidence: "medium",
    headlineTemplate: "{name} is in the crawling window",
    bodyTemplate:
      "Around {age_str}, many kids start crawling. Wide individual variance — some skip crawling entirely and go to pulling-up. Babyproofing payoff: now.",
    suggestedActionTemplate:
      "Walk through the house on your knees: outlets, cords, sharp corners, toilet paper rolls, dog food bowls — anything below 24\" is fair game.",
    source: "CDC milestones; AAP",
  },
  {
    id: "pulling_to_stand_window",
    category: "motor",
    title: "Pulling to stand",
    onsetAgeMonthsMin: 8,
    onsetAgeMonthsMax: 11,
    durationMonths: 3,
    confidence: "medium",
    headlineTemplate: "{name} is in the pulling-to-stand window",
    bodyTemplate:
      "Around {age_str}, kids often pull up on furniture and start cruising along it. Coffee tables, couches, anything stable becomes equipment.",
    suggestedActionTemplate:
      "Anchor unstable furniture (bookcases, dressers) NOW — kids overestimate their balance and use anything to pull up.",
    source: "CDC milestones; AAP",
  },
  {
    id: "first_steps_window",
    category: "motor",
    title: "First steps",
    onsetAgeMonthsMin: 10,
    onsetAgeMonthsMax: 15,
    durationMonths: 4,
    confidence: "medium",
    headlineTemplate: "{name} is in the first-steps window",
    bodyTemplate:
      "Around {age_str}, kids often take their first independent steps. Wide range — averages around 12 months but anywhere from 9 to 16 is typical.",
    source: "AAP; CDC milestones",
  },
  {
    id: "running_window",
    category: "motor",
    title: "Running",
    onsetAgeMonthsMin: 18,
    onsetAgeMonthsMax: 24,
    durationMonths: 6,
    confidence: "medium",
    headlineTemplate: "{name} is in the running window",
    bodyTemplate:
      "Around {age_str}, walking turns into a fast wobble-run. Falls increase. Stair gates and outdoor supervision get more important.",
    source: "CDC milestones; AAP",
  },
  {
    id: "jumping_window",
    category: "motor",
    title: "Jumping with both feet",
    onsetAgeMonthsMin: 22,
    onsetAgeMonthsMax: 30,
    durationMonths: 6,
    confidence: "medium",
    headlineTemplate: "{name} may start jumping with both feet",
    bodyTemplate:
      "Around {age_str}, kids gain the coordination to jump with both feet leaving the ground. Furniture jumping starts shortly after.",
    source: "CDC milestones",
  },
];

// =============================================================================
// Language
// =============================================================================
const LANGUAGE: DevelopmentalWindow[] = [
  {
    id: "babbling_consonants_window",
    category: "language",
    title: "Babbling with consonants",
    onsetAgeMonthsMin: 4,
    onsetAgeMonthsMax: 6,
    durationMonths: 3,
    confidence: "high",
    headlineTemplate: "{name} is in the consonant-babbling window",
    bodyTemplate:
      "Around {age_str}, vowels turn into consonant-vowel chains ('ba,' 'da,' 'ga'). It's the precursor to first words — narrate everything you do.",
    suggestedActionTemplate:
      "Respond like it's a conversation, even if it isn't yet — pausing and reacting to {name}'s sounds builds turn-taking that becomes real language.",
    source: "ASHA; AAP; CDC milestones",
  },
  {
    id: "first_words_window",
    category: "language",
    title: "First words",
    onsetAgeMonthsMin: 10,
    onsetAgeMonthsMax: 14,
    durationMonths: 4,
    confidence: "high",
    headlineTemplate: "{name} is in the first-words window",
    bodyTemplate:
      "Around {age_str}, most kids say a few real words besides 'mama'/'dada' — often a favorite food, animal, or person. By 18 months, AAP expects ~10–20 words.",
    source: "AAP; CDC milestones; ASHA",
  },
  {
    id: "word_explosion_window",
    category: "language",
    title: "Word explosion",
    onsetAgeMonthsMin: 17,
    onsetAgeMonthsMax: 21,
    durationMonths: 3,
    confidence: "medium",
    headlineTemplate: "{name} may be in the language-explosion window",
    bodyTemplate:
      "Around {age_str}, many kids jump from ~20 to 50+ words in a few weeks. It usually overlaps with a sleep regression and tantrum spike — language outpaces self-regulation.",
    source: "ASHA; pediatric developmental literature",
  },
  {
    id: "two_word_phrases_window",
    category: "language",
    title: "Two-word phrases",
    onsetAgeMonthsMin: 18,
    onsetAgeMonthsMax: 24,
    durationMonths: 4,
    confidence: "high",
    headlineTemplate: "{name} should be combining two words by the end of this window",
    bodyTemplate:
      "Around {age_str}, kids typically start putting two words together ('more milk,' 'mommy go'). AAP flag: by 24 months, no two-word phrases warrants a chat with the pediatrician.",
    suggestedActionTemplate:
      "If {name} isn't combining two words by 24 months, raise it at the next well-visit. Not necessarily a problem, but worth a screening.",
    source: "AAP; ASHA; CDC milestones",
  },
  {
    id: "simple_sentences_window",
    category: "language",
    title: "Simple sentences",
    onsetAgeMonthsMin: 24,
    onsetAgeMonthsMax: 30,
    durationMonths: 6,
    confidence: "medium",
    headlineTemplate: "{name} may start using simple sentences",
    bodyTemplate:
      "Around {age_str}, kids start stringing 3–4 word sentences and asking 'why?' relentlessly. Strangers should be able to understand about half of what they say.",
    source: "ASHA; CDC milestones",
  },
];

// =============================================================================
// Feeding
// =============================================================================
const FEEDING: DevelopmentalWindow[] = [
  {
    id: "solids_introduction_window",
    category: "feeding",
    title: "Solids introduction window",
    onsetAgeMonthsMin: 4,
    onsetAgeMonthsMax: 6,
    durationMonths: 2,
    confidence: "high",
    headlineTemplate: "{name} is in the solids-introduction window",
    bodyTemplate:
      "AAP recommends starting solids around 6 months when {name} can sit with support, has lost the tongue-thrust reflex, and shows interest in food. Iron-rich first foods (meats, iron-fortified cereals, beans) are recommended.",
    suggestedActionTemplate:
      "Talk to the pediatrician at the 4- or 6-month visit about timing. Plan for early-allergen introduction (peanut, egg, dairy) per current AAP guidance.",
    source: "AAP Section on Breastfeeding; AAP allergy guidance",
  },
  {
    id: "self_feeding_window",
    category: "feeding",
    title: "Self-feeding window",
    onsetAgeMonthsMin: 8,
    onsetAgeMonthsMax: 12,
    durationMonths: 4,
    confidence: "medium",
    headlineTemplate: "{name} is in the self-feeding window",
    bodyTemplate:
      "Around {age_str}, the pincer grasp develops and kids start feeding themselves. Mess is the point — it's how they learn texture, weight, and self-regulation.",
    source: "AAP; CDC milestones",
  },
  {
    id: "cup_transition_window",
    category: "feeding",
    title: "Bottle/breast → open or straw cup",
    onsetAgeMonthsMin: 12,
    onsetAgeMonthsMax: 18,
    durationMonths: 6,
    confidence: "medium",
    headlineTemplate: "{name} is in the cup-transition window",
    bodyTemplate:
      "AAP recommends weaning off bottles by 18 months and skipping sippy cups (which encourage bottle-like sucking) for open or straw cups. Pediatric dentists especially flag prolonged bottle use.",
    source: "AAP; AAPD (pediatric dentistry)",
  },
  {
    id: "picky_eating_onset",
    category: "feeding",
    title: "Picky-eating onset",
    onsetAgeMonthsMin: 15,
    onsetAgeMonthsMax: 24,
    durationMonths: 24,
    confidence: "medium",
    headlineTemplate: "{name} may enter the picky-eating phase",
    bodyTemplate:
      "Around {age_str}, food refusal often spikes as autonomy develops. Old favorites get rejected. Growth slows compared to year one, so appetites drop too.",
    suggestedActionTemplate:
      "Keep offering rejected foods without pressure — kids often need 10–15 neutral exposures. Don't make alternate meals; trust their hunger cues.",
    source: "Ellyn Satter Division of Responsibility; AAP nutrition guidance",
  },
];

// =============================================================================
// Cognition
// =============================================================================
const COGNITION: DevelopmentalWindow[] = [
  {
    id: "object_permanence_window",
    category: "cognition",
    title: "Object permanence",
    onsetAgeMonthsMin: 4,
    onsetAgeMonthsMax: 7,
    durationMonths: 4,
    confidence: "high",
    headlineTemplate: "{name} is developing object permanence",
    bodyTemplate:
      "Around {age_str}, kids start understanding that hidden things still exist — which is why peekaboo gets fun and why separation anxiety starts shortly after.",
    suggestedActionTemplate:
      "Peekaboo, hidden-toy games, and 'where did it go?' play directly support this milestone.",
    source: "Piaget; pediatric developmental literature",
  },
];

// =============================================================================
// All windows (single source of truth for the engine)
// =============================================================================
export const DEVELOPMENTAL_WINDOWS: DevelopmentalWindow[] = [
  ...SLEEP,
  ...SOCIAL,
  ...MOTOR,
  ...LANGUAGE,
  ...FEEDING,
  ...COGNITION,
];

/**
 * All windows whose active range (onsetMin to onsetMax + durationMonths)
 * includes the given age. Used by the engine.
 */
export function activeDevelopmentalWindows(ageMonths: number): DevelopmentalWindow[] {
  return DEVELOPMENTAL_WINDOWS.filter(
    (w) =>
      ageMonths >= w.onsetAgeMonthsMin &&
      ageMonths < w.onsetAgeMonthsMax + w.durationMonths,
  );
}
