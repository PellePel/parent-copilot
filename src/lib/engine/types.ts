import type {
  ConfidenceLevel,
  TriggerSource,
} from "../db/schema.js";

/**
 * What a trigger engine emits: a candidate brief item, not yet attached to
 * a brief. The assembler is responsible for ranking, deduping, and assigning
 * the final `priority`. `triggerDetail` is the engine's sub-category (e.g.
 * "outgrowing:shoes") and is also used for cross-engine dedup.
 */
export type Candidate = {
  kidId: number | null;
  headline: string;
  body: string;
  suggestedAction?: string;
  triggerSource: TriggerSource;
  triggerDetail: string;
  reasoning: string;
  confidence: ConfidenceLevel;
  /**
   * Engine-relative ranking signal, higher = more important. The assembler
   * converts these into `priority` after combining candidates from all
   * sources. Use a 0-100 scale by convention.
   */
  rawScore: number;
};
