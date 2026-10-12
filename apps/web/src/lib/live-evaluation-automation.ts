/**
 * Verified, tenant-scoped read model for real server-side evaluation generation.
 * Synthetic Test Bench previews must never pass through this API.
 */
export type LiveEvalStatus = "queued" | "running" | "complete" | "needs_review" | "failed";
export type LiveEvalRun = {
  id: string;
  skillId: string;
  status: LiveEvalStatus;
  commitSha: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  rounds: number;
  score: number | null;
};
export type LiveEvalAutomation = {
  skillId: string;
  canGenerate: boolean;
  services: { nim: boolean; jev: boolean };
  runs: LiveEvalRun[];
};

export class LiveEvaluationUnavailable extends Error {
  constructor(message = "Live evaluation service is unavailable.") {
    super(message);
    this.name = "LiveEvaluationUnavailable";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LiveEvaluationUnavailable("Invalid live evaluation response.");
  }
  return value as Record<string, unknown>;
}
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const STATUSES = new Set<LiveEvalStatus>(["queued", "running", "complete", "needs_review", "failed"]);
function runFromServer(value: unknown, expectedSkillId: string): LiveEvalRun {
  const run = record(value);
  if (typeof run.id !== "string" || run.id.length === 0 || run.id.length > 128 ||
      run.skillId !== expectedSkillId || !STATUSES.has(run.status as LiveEvalStatus)) {
    throw new LiveEvaluationUnavailable("Invalid live evaluation run identity or status.");
  }
  const commitSha = run.commitSha === null ? null : run.commitSha;
  if (commitSha !== null && (typeof commitSha !== "string" || !SHA.test(commitSha))) {
    throw new LiveEvaluationUnavailable("Invalid live evaluation source provenance.");
  }
  const score = recordOrNull(run.scorecard)?.overallScore;
  return {
    id: run.id,
    skillId: expectedSkillId,
    status: run.status as LiveEvalStatus,
    commitSha,
    createdAt: typeof run.createdAt === "string" ? run.createdAt : "",
    completedAt: typeof run.completedAt === "string" ? run.completedAt : null,
    error: typeof run.error === "string" && run.error.length > 0 ? "Evaluation failed; inspect sanitized job diagnostics." : null,
    rounds: typeof run.rounds === "number" && Number.isSafeInteger(run.rounds) && run.rounds >= 0 ? run.rounds : 0,
    score: typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100 ? score : null,
  };
}
function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function unwrap(response: unknown): Record<string, unknown> {
  return record(record(response).data);
}
export function parseLiveEvalAutomation(response: unknown, expectedSkillId: string): LiveEvalAutomation {
  const data = unwrap(response);
  if (data.skillId !== expectedSkillId || typeof data.canGenerate !== "boolean" ||
      !Array.isArray(data.runs) || data.runs.length > 20) {
    throw new LiveEvaluationUnavailable("Invalid live evaluation workspace response.");
  }
  const services = record(data.services);
  if (typeof services.nim !== "boolean" || typeof services.jev !== "boolean") {
    throw new LiveEvaluationUnavailable("Invalid live evaluation provider state.");
  }
  return {
    skillId: expectedSkillId,
    canGenerate: data.canGenerate,
    services: {nim: services.nim, jev: services.jev},
    runs: data.runs.map((run) => runFromServer(run, expectedSkillId)),
  };
}
export function parseLiveEvalAccepted(response: unknown, expectedSkillId: string): LiveEvalRun {
  return runFromServer(unwrap(response), expectedSkillId);
}
export function isActiveLiveEvaluation(status: LiveEvalStatus): boolean {
  return status === "queued" || status === "running";
}

function endpoint(skillId: string, start: boolean): string {
  if (!skillId || skillId.length > 300 || skillId.trim() !== skillId) {
    throw new LiveEvaluationUnavailable("Invalid skill identifier.");
  }
  const encoded = encodeURIComponent(skillId);
  return `/api/skills/${encoded}/automation${start ? "/generate" : ""}?skillId=${encoded}`;
}

export async function loadLiveEvalAutomation(
  skillId: string,
  options: {signal?: AbortSignal; fetcher?: typeof fetch} = {},
): Promise<LiveEvalAutomation> {
  const response = await (options.fetcher ?? fetch)(endpoint(skillId, false), {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: {Accept: "application/json"}, signal: options.signal ?? null,
  });
  if (!response.ok) throw new LiveEvaluationUnavailable(`Live evaluation unavailable (HTTP ${response.status}).`);
  try { return parseLiveEvalAutomation(await response.json(), skillId); }
  catch (error) {
    if (error instanceof LiveEvaluationUnavailable) throw error;
    throw new LiveEvaluationUnavailable("Invalid live evaluation JSON response.");
  }
}

export async function startLiveEvalAutomation(
  skillId: string,
  options: {signal?: AbortSignal; fetcher?: typeof fetch} = {},
): Promise<LiveEvalRun> {
  const response = await (options.fetcher ?? fetch)(endpoint(skillId, true), {
    method: "POST", mode: "same-origin", credentials: "same-origin", cache: "no-store",
    headers: {Accept: "application/json"}, signal: options.signal ?? null,
  });
  if (response.status !== 202) throw new LiveEvaluationUnavailable(`Evaluation was not queued (HTTP ${response.status}).`);
  try { return parseLiveEvalAccepted(await response.json(), skillId); }
  catch (error) {
    if (error instanceof LiveEvaluationUnavailable) throw error;
    throw new LiveEvaluationUnavailable("Invalid queued evaluation response.");
  }
}
