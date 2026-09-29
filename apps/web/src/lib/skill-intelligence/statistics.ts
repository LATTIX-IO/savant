// Small, dependency-free statistics used for health scores and candidate
// validation. Bootstrap resampling is seeded so the same paired results always
// produce the same interval (auditable, reproducible).

import type { EvidenceStrength } from "@savant/types";

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
}

export function variance(values: readonly number[]): number | null {
  const average = mean(values);
  if (average == null || values.length < 2) {
    return null;
  }
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** mulberry32 — tiny deterministic PRNG. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hashStringToSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export type PairedScore = { baseline: number; candidate: number };

export type BootstrapInterval = {
  mean: number;
  low: number;
  high: number;
  confidence: number;
  samples: number;
};

/** Percentile bootstrap over paired (candidate − baseline) differences. */
export function pairedBootstrapInterval(
  pairs: readonly PairedScore[],
  options: { iterations?: number; confidence?: number; seed?: number } = {},
): BootstrapInterval | null {
  if (pairs.length < 2) {
    return null;
  }

  const iterations = options.iterations ?? 2000;
  const confidence = options.confidence ?? 0.95;
  const random = createSeededRandom(options.seed ?? 1);
  const differences = pairs.map((pair) => pair.candidate - pair.baseline);
  const observedMean = mean(differences) ?? 0;
  const resampledMeans: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let draw = 0; draw < differences.length; draw += 1) {
      sum += differences[Math.floor(random() * differences.length)] ?? 0;
    }
    resampledMeans.push(sum / differences.length);
  }

  resampledMeans.sort((left, right) => left - right);
  const tail = (1 - confidence) / 2;
  const lowIndex = Math.max(0, Math.floor(tail * iterations));
  const highIndex = Math.min(iterations - 1, Math.ceil((1 - tail) * iterations) - 1);

  return {
    mean: observedMean,
    low: resampledMeans[lowIndex] ?? observedMean,
    high: resampledMeans[highIndex] ?? observedMean,
    confidence,
    samples: pairs.length,
  };
}

/**
 * A +0.3 delta on 8 noisy cases is not evidence. Strength requires both enough
 * samples and an interval that excludes zero.
 */
export function classifyEvidenceStrength(
  interval: BootstrapInterval | null,
  minimumSamples: number,
): EvidenceStrength {
  if (!interval || interval.samples < minimumSamples) {
    return "insufficient";
  }

  if (interval.low > 0) {
    return interval.samples >= minimumSamples * 3 ? "high" : "medium";
  }

  if (interval.mean > 0) {
    return "low";
  }

  return "insufficient";
}
