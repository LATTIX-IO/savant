/**
 * Pure helpers behind the landing page's system motion, kept framework-free so
 * the sequencing rules are testable.
 */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Scroll progress through a section: 0 when its top reaches `startRatio` of the
 * viewport, 1 once it has travelled `span` viewport heights further up.
 */
export function resolveScrollProgress(
  sectionTop: number,
  viewportHeight: number,
  startRatio = 0.8,
  span = 0.55,
): number {
  if (viewportHeight <= 0) return 0;
  const start = viewportHeight * startRatio;
  return clamp01((start - sectionTop) / (viewportHeight * span));
}

/** Maps 0–1 progress onto the index of the stage currently in focus. */
export function resolveStageIndex(progress: number, stageCount: number): number {
  if (stageCount <= 0) return 0;
  return Math.min(stageCount - 1, Math.floor(clamp01(progress) * stageCount));
}

/** Next step of a looping sequence of `stepCount` steps. */
export function nextLoopStep(step: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return (step + 1) % stepCount;
}
