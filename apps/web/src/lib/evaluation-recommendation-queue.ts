export type RecommendationDecision = "queue-next" | "needs-review" | "hold";

export interface RecommendationQueueSkillScopeInput {
  id: string;
  name: string;
  team: string;
  repo: string;
  branch: string;
}

export interface RecommendationQueueRecommendationInput {
  id: string;
  category: string;
  title: string;
  effort: string;
  impact: string;
  rationale: string;
  actions: string[];
}

export interface RecommendationQueueSyncInput {
  skill: RecommendationQueueSkillScopeInput;
  evaluation: {
    uuid: string;
    ref: string;
    dataset: string;
    started: string;
  };
  recommendations: RecommendationQueueRecommendationInput[];
  decisions: Record<string, RecommendationDecision>;
}

export interface QueuedSkillRecommendation {
  queueId: string;
  recommendationId: string;
  skillId: string;
  skillName: string;
  skillTeam: string;
  skillRepo: string;
  skillBranch: string;
  evaluationUuid: string;
  evaluationRef: string;
  evaluationDataset: string;
  evaluationStarted: string;
  title: string;
  category: string;
  effort: string;
  impact: string;
  rationale: string;
  actions: string[];
  queuedAt: string;
}

export const EVAL_RECOMMENDATION_DECISIONS_STORAGE_PREFIX = "savant:eval-recommendation-decisions:v1";
export const SKILL_RECOMMENDATION_QUEUE_STORAGE_PREFIX = "savant:skill-recommendation-queue:v1";

function isRecommendationDecision(value: unknown): value is RecommendationDecision {
  return value === "queue-next" || value === "needs-review" || value === "hold";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isQueuedSkillRecommendation(value: unknown): value is QueuedSkillRecommendation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<QueuedSkillRecommendation>;

  return typeof candidate.queueId === "string"
    && typeof candidate.recommendationId === "string"
    && typeof candidate.skillId === "string"
    && typeof candidate.skillName === "string"
    && typeof candidate.skillTeam === "string"
    && typeof candidate.skillRepo === "string"
    && typeof candidate.skillBranch === "string"
    && typeof candidate.evaluationUuid === "string"
    && typeof candidate.evaluationRef === "string"
    && typeof candidate.evaluationDataset === "string"
    && typeof candidate.evaluationStarted === "string"
    && typeof candidate.title === "string"
    && typeof candidate.category === "string"
    && typeof candidate.effort === "string"
    && typeof candidate.impact === "string"
    && typeof candidate.rationale === "string"
    && isStringArray(candidate.actions)
    && typeof candidate.queuedAt === "string";
}

function buildQueueId(evaluationUuid: string, recommendationId: string): string {
  return `${evaluationUuid}:${recommendationId}`;
}

function normalizeScopePart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function sortQueuedRecommendations(recommendations: QueuedSkillRecommendation[]): QueuedSkillRecommendation[] {
  return [...recommendations].sort((left, right) => {
    const timeDelta = Date.parse(right.queuedAt) - Date.parse(left.queuedAt);
    if (!Number.isNaN(timeDelta) && timeDelta !== 0) {
      return timeDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

export function buildRecommendationDecisionStorageKey(evaluationUuid: string): string {
  return `${EVAL_RECOMMENDATION_DECISIONS_STORAGE_PREFIX}:${evaluationUuid}`;
}

export function buildSkillRecommendationQueueScope(skill: RecommendationQueueSkillScopeInput): string {
  return [skill.id, skill.team, skill.repo, skill.branch]
    .map((part) => normalizeScopePart(part))
    .join("|");
}

export function buildSkillRecommendationQueueStorageKey(skillScope: string): string {
  return `${SKILL_RECOMMENDATION_QUEUE_STORAGE_PREFIX}:${skillScope}`;
}

export function parseRecommendationDecisions(rawValue: string | null): Record<string, RecommendationDecision> {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isRecommendationDecision(value)),
    ) as Record<string, RecommendationDecision>;
  } catch {
    return {};
  }
}

export function parseQueuedSkillRecommendations(rawValue: string | null): QueuedSkillRecommendation[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortQueuedRecommendations(parsed.filter(isQueuedSkillRecommendation));
  } catch {
    return [];
  }
}

export function syncQueuedSkillRecommendations(
  existing: QueuedSkillRecommendation[],
  input: RecommendationQueueSyncInput,
  options?: { now?: () => string },
): QueuedSkillRecommendation[] {
  const nextQueuedAt = options?.now ?? (() => new Date().toISOString());
  const currentEntries = existing.filter((entry) => entry.skillId === input.skill.id && entry.evaluationUuid === input.evaluation.uuid);
  const currentEntriesByRecommendationId = new Map(
    currentEntries.map((entry) => [entry.recommendationId, entry] as const),
  );
  const retainedEntries = existing.filter(
    (entry) => !(entry.skillId === input.skill.id && entry.evaluationUuid === input.evaluation.uuid),
  );

  const queuedEntries = input.recommendations
    .filter((recommendation) => input.decisions[recommendation.id] === "queue-next")
    .map((recommendation) => {
      const existingEntry = currentEntriesByRecommendationId.get(recommendation.id);

      return {
        queueId: buildQueueId(input.evaluation.uuid, recommendation.id),
        recommendationId: recommendation.id,
        skillId: input.skill.id,
        skillName: input.skill.name,
        skillTeam: input.skill.team,
        skillRepo: input.skill.repo,
        skillBranch: input.skill.branch,
        evaluationUuid: input.evaluation.uuid,
        evaluationRef: input.evaluation.ref,
        evaluationDataset: input.evaluation.dataset,
        evaluationStarted: input.evaluation.started,
        title: recommendation.title,
        category: recommendation.category,
        effort: recommendation.effort,
        impact: recommendation.impact,
        rationale: recommendation.rationale,
        actions: [...recommendation.actions],
        queuedAt: existingEntry?.queuedAt ?? nextQueuedAt(),
      } satisfies QueuedSkillRecommendation;
    });

  return sortQueuedRecommendations([...retainedEntries, ...queuedEntries]);
}
