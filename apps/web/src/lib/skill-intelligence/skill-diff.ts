// Line diff, unified patch rendering, bounded-edit derivation, and partial edit
// application for SKILL.md candidates.

import type { ChangeBudget, EditOperation, RecommendationEdit } from "@savant/types";

import { parseLockedRegions, rangeTouchesLockedRegion, splitLines } from "./locked-sections.ts";
import { hashStringToSeed } from "./statistics.ts";

export type DiffOp = { type: "equal" | "add" | "del"; line: string };

/** LCS line diff. SKILL.md files are small enough that O(n·m) is fine. */
export function diffLines(baseText: string, candidateText: string): DiffOp[] {
  const a = splitLines(baseText);
  const b = splitLines(candidateText);
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * (m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ type: "del", line: a[i] ?? "" });
      i += 1;
    } else {
      ops.push({ type: "add", line: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", line: a[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", line: b[j] ?? "" });
    j += 1;
  }

  return ops;
}

export type DiffHunk = {
  baseStart: number;
  removed: string[];
  added: string[];
};

export function computeHunks(baseText: string, candidateText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let baseIndex = 0;
  let current: DiffHunk | null = null;

  for (const op of diffLines(baseText, candidateText)) {
    if (op.type === "equal") {
      if (current) {
        hunks.push(current);
        current = null;
      }
      baseIndex += 1;
      continue;
    }

    current ??= { baseStart: baseIndex, removed: [], added: [] };
    if (op.type === "del") {
      current.removed.push(op.line);
      baseIndex += 1;
    } else {
      current.added.push(op.line);
    }
  }

  if (current) {
    hunks.push(current);
  }

  return hunks;
}

export function renderUnifiedDiff(
  baseText: string,
  candidateText: string,
  options: { fromLabel?: string; toLabel?: string; context?: number } = {},
): string {
  const context = options.context ?? 3;
  const ops = diffLines(baseText, candidateText);
  const lines: string[] = [
    `--- ${options.fromLabel ?? "a/SKILL.md"}`,
    `+++ ${options.toLabel ?? "b/SKILL.md"}`,
  ];

  const changeIndexes = ops.flatMap((op, index) => (op.type === "equal" ? [] : [index]));
  if (changeIndexes.length === 0) {
    return lines.join("\n");
  }

  // Group changes whose context windows overlap into one @@ block.
  const groups: Array<[number, number]> = [];
  for (const index of changeIndexes) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = groups[groups.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = end;
    } else {
      groups.push([start, end]);
    }
  }

  for (const [start, end] of groups) {
    let baseLine = 1;
    let candidateLine = 1;
    for (let index = 0; index < start; index += 1) {
      if (ops[index]?.type !== "add") baseLine += 1;
      if (ops[index]?.type !== "del") candidateLine += 1;
    }
    const slice = ops.slice(start, end + 1);
    const baseCount = slice.filter((op) => op.type !== "add").length;
    const candidateCount = slice.filter((op) => op.type !== "del").length;
    lines.push(`@@ -${baseLine},${baseCount} +${candidateLine},${candidateCount} @@`);
    for (const op of slice) {
      lines.push(`${op.type === "equal" ? " " : op.type === "add" ? "+" : "-"}${op.line}`);
    }
  }

  return lines.join("\n");
}

function nearestHeading(lines: readonly string[], index: number): string | null {
  for (let cursor = Math.min(index, lines.length - 1); cursor >= 0; cursor -= 1) {
    const match = lines[cursor]?.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) {
      return match[1] ?? null;
    }
  }
  return null;
}

function buildEditId(index: number, hunk: DiffHunk): string {
  const digest = hashStringToSeed(`${hunk.baseStart}|${hunk.removed.join("\n")}|${hunk.added.join("\n")}`)
    .toString(16)
    .padStart(8, "0");
  return `edit-${index + 1}-${digest}`;
}

export function operationForHunk(hunk: Pick<DiffHunk, "removed" | "added">): EditOperation {
  if (hunk.removed.length === 0) {
    return "add";
  }
  if (hunk.added.length === 0) {
    return "delete";
  }
  return "replace";
}

/**
 * Derive bounded edits from base → candidate. `rationales` lets the worker's
 * per-edit reasoning be attached by matching base position.
 */
export function deriveEdits(
  baseText: string,
  candidateText: string,
  rationales: ReadonlyArray<{ baseStart: number; rationale: string }> = [],
): RecommendationEdit[] {
  const baseLines = splitLines(baseText);
  return computeHunks(baseText, candidateText).map((hunk, index) => ({
    editId: buildEditId(index, hunk),
    op: operationForHunk(hunk),
    section: nearestHeading(baseLines, hunk.baseStart),
    baseStart: hunk.baseStart,
    baseLength: hunk.removed.length,
    before: hunk.removed.join("\n"),
    after: hunk.added.join("\n"),
    anchor: hunk.baseStart > 0 ? baseLines[hunk.baseStart - 1] ?? "" : "",
    rationale: rationales.find((entry) => entry.baseStart === hunk.baseStart)?.rationale ?? "",
    status: "proposed",
  }));
}

export class EditApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditApplicationError";
  }
}

/** Apply a subset of edits (derived against `baseText`) to produce a candidate. */
export function applyEdits(baseText: string, edits: readonly RecommendationEdit[]): string {
  const lines = splitLines(baseText);
  const ordered = [...edits].sort((left, right) => right.baseStart - left.baseStart);

  for (const edit of ordered) {
    const current = lines.slice(edit.baseStart, edit.baseStart + edit.baseLength).join("\n");
    if (edit.baseLength > 0 && current !== edit.before) {
      throw new EditApplicationError(`Edit ${edit.editId} no longer matches the base content.`);
    }
    lines.splice(edit.baseStart, edit.baseLength, ...(edit.op === "delete" ? [] : splitLines(edit.after)));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Change budget enforcement
// ---------------------------------------------------------------------------

export type BudgetUsage = {
  changedLines: number;
  changedTokens: number;
  operations: EditOperation[];
  sections: string[];
};

export type BudgetVerification = {
  ok: boolean;
  usage: BudgetUsage;
  violations: string[];
};

function countTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function measureEdits(edits: readonly RecommendationEdit[]): BudgetUsage {
  return {
    changedLines: edits.reduce(
      (sum, edit) => sum + edit.baseLength + (edit.op === "delete" ? 0 : splitLines(edit.after).length),
      0,
    ),
    changedTokens: edits.reduce((sum, edit) => sum + countTokens(edit.before) + countTokens(edit.after), 0),
    operations: [...new Set(edits.map((edit) => edit.op))],
    sections: [...new Set(edits.map((edit) => edit.section ?? "(preamble)"))],
  };
}

/** Every candidate is re-checked here regardless of what the worker reported. */
export function verifyChangeBudget(
  baseText: string,
  edits: readonly RecommendationEdit[],
  budget: ChangeBudget,
): BudgetVerification {
  const usage = measureEdits(edits);
  const violations: string[] = [];

  if (usage.changedLines > budget.maxChangedLines) {
    violations.push(`Changes ${usage.changedLines} lines; ${budget.aggressiveness} budget allows ${budget.maxChangedLines}.`);
  }
  if (usage.changedTokens > budget.maxChangedTokens) {
    violations.push(`Changes ~${usage.changedTokens} tokens; budget allows ${budget.maxChangedTokens}.`);
  }
  for (const operation of usage.operations) {
    if (!budget.allowedOperations.includes(operation)) {
      violations.push(`"${operation}" edits are not permitted at ${budget.aggressiveness} aggressiveness.`);
    }
  }
  if (budget.permittedSections !== "all") {
    const permitted = new Set(budget.permittedSections.map((section) => section.toLowerCase()));
    for (const edit of edits) {
      if (!permitted.has((edit.section ?? "").toLowerCase())) {
        violations.push(`Edit ${edit.editId} touches section "${edit.section ?? "(preamble)"}", which is not permitted.`);
      }
    }
  }

  const { regions } = parseLockedRegions(baseText);
  for (const edit of edits) {
    const region = rangeTouchesLockedRegion(regions, edit.baseStart, edit.baseLength);
    if (region) {
      violations.push(`Edit ${edit.editId} touches locked region "${region.id}".`);
    }
  }

  return { ok: violations.length === 0, usage, violations };
}
