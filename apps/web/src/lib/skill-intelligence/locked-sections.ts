// Protected SKILL.md regions.
//
//   <!-- SAVANT:LOCK security-policy -->
//   ## Mandatory Human Approval
//   ...
//   <!-- SAVANT:ENDLOCK -->
//
// Optimization candidates must leave every locked region byte-identical. The
// optimizer sandbox masks these regions so the engine never sees them; the
// control plane re-verifies independently here.

export type LockedRegion = {
  id: string;
  /** 0-based line index of the LOCK marker. */
  startLine: number;
  /** 0-based line index of the ENDLOCK marker. */
  endLine: number;
  text: string;
};

export type LockParseResult = {
  regions: LockedRegion[];
  errors: string[];
};

const LOCK_OPEN = /^\s*<!--\s*SAVANT:LOCK\s+([A-Za-z0-9._-]+)\s*-->\s*$/;
const LOCK_CLOSE = /^\s*<!--\s*SAVANT:ENDLOCK\s*-->\s*$/;

export function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

export function parseLockedRegions(content: string): LockParseResult {
  const lines = splitLines(content);
  const regions: LockedRegion[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let open: { id: string; startLine: number } | null = null;

  lines.forEach((line, index) => {
    const openMatch = line.match(LOCK_OPEN);
    if (openMatch) {
      if (open) {
        errors.push(`Nested lock "${openMatch[1]}" at line ${index + 1} inside "${open.id}".`);
        return;
      }
      const id = openMatch[1] ?? "";
      if (seen.has(id)) {
        errors.push(`Duplicate lock id "${id}" at line ${index + 1}.`);
      }
      seen.add(id);
      open = { id, startLine: index };
      return;
    }

    if (LOCK_CLOSE.test(line)) {
      if (!open) {
        errors.push(`ENDLOCK without matching LOCK at line ${index + 1}.`);
        return;
      }
      const current: { id: string; startLine: number } = open;
      regions.push({
        id: current.id,
        startLine: current.startLine,
        endLine: index,
        text: lines.slice(current.startLine, index + 1).join("\n"),
      });
      open = null;
    }
  });

  if (open) {
    const unterminated: { id: string; startLine: number } = open;
    errors.push(`Lock "${unterminated.id}" starting at line ${unterminated.startLine + 1} is never closed.`);
  }

  return { regions, errors };
}

export type LockVerification = {
  ok: boolean;
  violations: string[];
};

export function verifyLockedRegionsUnchanged(base: string, candidate: string): LockVerification {
  const baseLocks = parseLockedRegions(base);
  const candidateLocks = parseLockedRegions(candidate);
  const violations: string[] = [...candidateLocks.errors.map((error) => `Candidate: ${error}`)];
  const candidateById = new Map(candidateLocks.regions.map((region) => [region.id, region]));

  for (const region of baseLocks.regions) {
    const match = candidateById.get(region.id);
    if (!match) {
      violations.push(`Locked region "${region.id}" was removed.`);
      continue;
    }
    if (match.text !== region.text) {
      violations.push(`Locked region "${region.id}" was modified.`);
    }
    candidateById.delete(region.id);
  }

  for (const added of candidateById.values()) {
    violations.push(`Candidate introduced a new lock "${added.id}"; only humans may add locks.`);
  }

  return { ok: violations.length === 0, violations };
}

/** True if the base line range [start, start + length) touches a locked region. */
export function rangeTouchesLockedRegion(
  regions: readonly LockedRegion[],
  start: number,
  length: number,
): LockedRegion | null {
  // A pure insertion (length 0) at `start` lands between line start-1 and start;
  // it is inside a region only if strictly between its markers.
  for (const region of regions) {
    if (length === 0) {
      if (start > region.startLine && start <= region.endLine) {
        return region;
      }
      continue;
    }
    const end = start + length - 1;
    if (start <= region.endLine && end >= region.startLine) {
      return region;
    }
  }
  return null;
}
