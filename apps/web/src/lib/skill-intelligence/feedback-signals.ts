// Passive and explicit feedback → weak labels.
//
// Raw events are stored as-is; these scores are a derived, versioned view so the
// weighting model can evolve without rewriting history. None of these labels is
// treated as ground truth.

import type {
  ExplicitFeedbackCategory,
  PassiveSignalType,
  SkillFeedbackRequest,
  SkillRunFeedbackSummary,
} from "@savant/types";

export const FEEDBACK_WEIGHTING_VERSION = 1;

const PASSIVE_SIGNAL_SCORES: Record<Exclude<PassiveSignalType, "accepted-after-edit">, number> = {
  "accepted-untouched": 1,
  discarded: -0.8,
  regenerated: -0.5,
  retried: -0.4,
  "alternate-skill-selected": -0.6,
  "human-override": -0.7,
  copied: 0.3,
  exported: 0.4,
  "downstream-completed": 0.8,
  "downstream-failed": -0.8,
};

const NEGATIVE_CATEGORY_SCORES: Record<Exclude<ExplicitFeedbackCategory, "good-result">, number> = {
  "bad-result": -0.7,
  "missing-knowledge": -0.6,
  "incorrect-procedure": -0.7,
  "too-verbose": -0.3,
  "insufficient-detail": -0.4,
  "obsolete-information": -0.6,
  "format-failure": -0.5,
  "tool-use-failure": -0.6,
  "unsafe-recommendation": -1,
  "should-have-done": -0.5,
};

/** Categories that describe what went wrong, used for failure clustering. */
export const FAILURE_CATEGORIES: readonly ExplicitFeedbackCategory[] = Object.keys(
  NEGATIVE_CATEGORY_SCORES,
) as ExplicitFeedbackCategory[];

export const FEEDBACK_CATEGORY_LABELS: Record<ExplicitFeedbackCategory, string> = {
  "good-result": "Good result",
  "bad-result": "Bad result",
  "missing-knowledge": "Missing knowledge",
  "incorrect-procedure": "Incorrect procedure",
  "too-verbose": "Too verbose",
  "insufficient-detail": "Insufficient detail",
  "obsolete-information": "Obsolete information",
  "format-failure": "Format failure",
  "tool-use-failure": "Tool-use failure",
  "unsafe-recommendation": "Unsafe recommendation",
  "should-have-done": "Skill should have done something else",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * accepted untouched       → +1.0  strong positive
 * accepted after 5% edit   → ~+0.7 positive
 * accepted after 40% edit  → ~-0.2 weak/negative
 */
export function scoreEditRatio(editRatio: number): number {
  return clamp(0.8 - 2.5 * clamp(editRatio, 0, 1), -0.6, 0.8);
}

export function scoreRating(rating: number): number {
  return clamp((rating - 3) / 2, -1, 1);
}

export function scoreFeedbackEvent(event: SkillFeedbackRequest): number {
  const components: number[] = [];

  if (event.kind === "passive" && event.signal) {
    if (event.signal === "accepted-after-edit") {
      components.push(scoreEditRatio(event.editRatio ?? 0.2));
    } else {
      components.push(PASSIVE_SIGNAL_SCORES[event.signal]);
    }
  }

  if (typeof event.rating === "number") {
    components.push(scoreRating(event.rating));
  }

  for (const category of event.categories ?? []) {
    components.push(category === "good-result" ? 0.8 : NEGATIVE_CATEGORY_SCORES[category]);
  }

  if (components.length === 0) {
    return 0;
  }

  // The most negative explicit category dominates: an "unsafe" flag must not be
  // averaged away by an otherwise positive rating.
  const minimum = Math.min(...components);
  const mean = components.reduce((sum, value) => sum + value, 0) / components.length;
  return Math.round(clamp(minimum <= -0.9 ? minimum : mean, -1, 1) * 10_000) / 10_000;
}

/** Converts the compact summary adapters may attach to a run into a weak label. */
export function scoreRunFeedbackSummary(summary: SkillRunFeedbackSummary | undefined): number | null {
  if (!summary) {
    return null;
  }

  const components: number[] = [];

  if (typeof summary.rating === "number") {
    components.push(scoreRating(summary.rating));
  }

  if (summary.accepted === true) {
    components.push(
      typeof summary.editDistance === "number" && summary.editDistance > 0
        ? scoreEditRatio(summary.editDistance)
        : summary.revisionRequired ? 0.2 : 1,
    );
  } else if (summary.accepted === false) {
    components.push(-0.8);
  }

  if (components.length === 0) {
    return null;
  }

  return components.reduce((sum, value) => sum + value, 0) / components.length;
}

export type WeightedFeedback = {
  derivedScore: number;
  reporterRole?: "user" | "sme" | "system" | undefined;
};

/** SME feedback carries more weight than passive user signals. */
export function aggregateWeakLabel(
  feedback: readonly WeightedFeedback[],
  summaryScore: number | null = null,
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const entry of feedback) {
    const weight = entry.reporterRole === "sme" ? 2 : 1;
    weightedSum += entry.derivedScore * weight;
    totalWeight += weight;
  }

  if (summaryScore != null) {
    weightedSum += summaryScore;
    totalWeight += 1;
  }

  if (totalWeight === 0) {
    return null;
  }

  return Math.round((weightedSum / totalWeight) * 10_000) / 10_000;
}
