// Ports the Skill Intelligence service depends on. The runtime wiring
// (runtime.ts) binds these to the existing control-plane read model, Git
// provider adapters, release tables, and audit log; tests bind fakes.

import type {
  SkillClassification,
  SkillImprovementRecommendation,
  SkillTier,
} from "@savant/types";

import type { SkillIntelligenceStore } from "./store.ts";

export type CatalogSkill = {
  skillId: string;
  /** Stable UUID used in app URLs; lookups accept either identifier. */
  skillUuid?: string;
  name: string;
  tier: SkillTier;
  owner: string | null;
  /** Current production (baseline) version ref. */
  baseVersion: string;
  classification: SkillClassification;
  /** Latest indexed evaluation pass rate, 0..100. */
  evalBenchmark: number | null;
  /** Share of recent eval runs without regressions, 0..100. */
  regressionStability: number | null;
  authoredEvalCases: number;
  versionHistory: Array<{ ref: string; releasedAt: string | null; score: number | null; delta: number | null }>;
};

export interface SkillCatalogPort {
  listSkills(organizationId: string): Promise<CatalogSkill[]>;
  getSkill(organizationId: string, identifier: string): Promise<CatalogSkill | null>;
  /** Production SKILL.md. `live` is false for generated fallback drafts. */
  getSkillContent(organizationId: string, skillId: string): Promise<{ content: string; live: boolean } | null>;
  getDependents(organizationId: string, skillId: string): Promise<{ direct: number; transitive: number; suiteSkillIds: string[] }>;
}

export type StageResult =
  | { staged: true; releaseRequestId: string; commitSha: string | null }
  | { staged: false; reason: string };

export interface ReleasePort {
  /**
   * Commit the approved candidate as a new skill version and open a
   * draft → staging release request. Production promotion stays with the
   * existing release policy and is never performed here.
   */
  stageCandidate(input: {
    organizationId: string;
    recommendation: SkillImprovementRecommendation;
    actor: { subject: string; userId: string | null };
  }): Promise<StageResult>;
}

export type IntelligenceEvent = {
  organizationId: string;
  actorRef: string;
  category: "evaluation" | "review" | "approval" | "release" | "policy";
  /** Normalized event name, e.g. "optimization.triggered", "candidate.approved". */
  action: string;
  targetType: "skill" | "recommendation" | "optimization_job" | "workspace";
  targetRef: string;
  payload?: Record<string, unknown>;
};

export interface EventPort {
  emit(event: IntelligenceEvent): Promise<void>;
}

export type SkillIntelligenceDeps = {
  store: SkillIntelligenceStore;
  catalog: SkillCatalogPort;
  releases: ReleasePort;
  events: EventPort;
  /** False when the store cannot persist encrypted artifacts (no key configured). */
  artifactsEnabled: boolean;
  now?: () => Date;
};
