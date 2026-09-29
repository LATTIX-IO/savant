import assert from "node:assert/strict";
import test from "node:test";

import { clamp01, nextLoopStep, resolveScrollProgress, resolveStageIndex } from "./marketing-motion.ts";

test("clamp01 bounds values and treats non-finite input as zero", () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(4), 1);
  assert.equal(clamp01(Number.NaN), 0);
});

test("resolveScrollProgress starts at the trigger line and completes after the span", () => {
  assert.equal(resolveScrollProgress(900, 1000), 0);
  assert.equal(resolveScrollProgress(800, 1000), 0);
  assert.equal(resolveScrollProgress(250, 1000), 1);
  assert.ok(Math.abs(resolveScrollProgress(525, 1000) - 0.5) < 1e-9);
  assert.equal(resolveScrollProgress(0, 0), 0);
});

test("resolveStageIndex walks every stage and holds on the last one", () => {
  assert.equal(resolveStageIndex(0, 6), 0);
  assert.equal(resolveStageIndex(0.17, 6), 1);
  assert.equal(resolveStageIndex(0.99, 6), 5);
  assert.equal(resolveStageIndex(1, 6), 5);
  assert.equal(resolveStageIndex(0.5, 0), 0);
});

test("nextLoopStep wraps back to the first step", () => {
  assert.equal(nextLoopStep(0, 8), 1);
  assert.equal(nextLoopStep(7, 8), 0);
  assert.equal(nextLoopStep(3, 0), 0);
});
