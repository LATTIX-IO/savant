// Skill Intelligence governance policy: tenant settings, tier-aware
// optimization rules, change budgets, and optimizer provider governance.

import type {
  AutoOptimizationMode,
  ChangeBudget,
  EvidenceThresholds,
  OptimizationAggressiveness,
  OptimizerProviderId,
  RetentionClass,
  SkillClassification,
  SkillIntelligenceSettings,
  SkillTier,
  TelemetryCaptureMode,
  TelemetryLevel,
} from "@savant/types";

import { ALL_PII_CLASSES, type PiiClass } from "./redaction.ts";

export const DEFAULT_EVIDENCE_THRESHOLDS: EvidenceThresholds = {
  minRuns: 30,
  minDistinctTasks: 10,
  minFailureExamples: 5,
  minHeldOutCases: 10,
};

export const ALL_OPTIMIZER_PROVIDERS: readonly OptimizerProviderId[] = [
  "azure-openai",
  "openai-enterprise",
  "openai-public",
  "anthropic-enterprise",
  "anthropic-public",
  "local-approved",
  "local-unknown",
];

export const OPTIMIZER_PROVIDER_LABELS: Record<OptimizerProviderId, string> = {
  "azure-openai": "Azure OpenAI",
  "openai-enterprise": "OpenAI Enterprise",
  "openai-public": "Public OpenAI API",
  "anthropic-enterprise": "Anthropic Enterprise",
  "anthropic-public": "Public Anthropic API",
  "local-approved": "Approved local endpoint",
  "local-unknown": "Local unknown endpoint",
};

export const DEFAULT_SKILL_INTELLIGENCE_SETTINGS: SkillIntelligenceSettings = {
  telemetryMode: "inputs-outputs",
  retention: "90d",
  retentionCustomDays: null,
  autoOptimizationMode: "recommend",
  aggressiveness: "conservative",
  thresholds: DEFAULT_EVIDENCE_THRESHOLDS,
  allowedOptimizerProviders: ["azure-openai", "openai-enterprise", "anthropic-enterprise"],
  optimizationDisabledSkills: [],
  redactPiiClasses: ["email", "phone", "ssn", "credit-card"],
  retainUserIdentity: false,
};

// ---------------------------------------------------------------------------
// Telemetry capture
// ---------------------------------------------------------------------------

const LEVEL_RANK: Record<TelemetryLevel, number> = { outcome: 0, io: 1, full: 2 };

const CAPTURE_MODE_MAX_LEVEL: Record<TelemetryCaptureMode, TelemetryLevel> = {
  "metrics-only": "outcome",
  "inputs-outputs": "io",
  "full-trajectories": "full",
};

/** The stored level is the lower of what was sent and what the tenant allows. */
export function resolveStoredTelemetryLevel(
  requested: TelemetryLevel,
  captureMode: TelemetryCaptureMode,
): TelemetryLevel {
  const allowed = CAPTURE_MODE_MAX_LEVEL[captureMode];
  return LEVEL_RANK[requested] <= LEVEL_RANK[allowed] ? requested : allowed;
}

export function resolveRetentionDays(settings: Pick<SkillIntelligenceSettings, "retention" | "retentionCustomDays">): number {
  switch (settings.retention) {
    case "30d":
      return 30;
    case "1y":
      return 365;
    case "custom":
      return Math.min(3650, Math.max(1, settings.retentionCustomDays ?? 90));
    default:
      return 90;
  }
}

export function isOptimizationTelemetryDisabled(settings: SkillIntelligenceSettings, skillId: string): boolean {
  return settings.optimizationDisabledSkills.includes(skillId);
}

// ---------------------------------------------------------------------------
// Tier policy
// ---------------------------------------------------------------------------

export type TierOptimizationPolicy = {
  tier: SkillTier;
  label: string;
  recommendationGeneration: boolean;
  requiredApprovals: number;
  /** Tier 1 changes fan out to dependents; their suites must run before approval. */
  crossSkillRegressionRequired: boolean;
  thresholdMultiplier: number;
  maxAggressiveness: OptimizationAggressiveness;
  notes: string;
};

export const TIER_OPTIMIZATION_POLICIES: Record<SkillTier, TierOptimizationPolicy> = {
  1: {
    tier: 1,
    label: "Standards",
    recommendationGeneration: true,
    requiredApprovals: 2,
    crossSkillRegressionRequired: true,
    thresholdMultiplier: 2,
    maxAggressiveness: "conservative",
    notes: "Extremely conservative. A Tier 1 change can affect hundreds of downstream skills.",
  },
  2: {
    tier: 2,
    label: "Methodology",
    recommendationGeneration: true,
    requiredApprovals: 2,
    crossSkillRegressionRequired: false,
    thresholdMultiplier: 1,
    maxAggressiveness: "balanced",
    notes: "Primary optimization target. Requires the skill owner plus a domain SME reviewer.",
  },
  3: {
    tier: 3,
    label: "Personal / workflow",
    recommendationGeneration: true,
    requiredApprovals: 1,
    crossSkillRegressionRequired: false,
    thresholdMultiplier: 1,
    maxAggressiveness: "exploratory",
    notes: "Higher experimentation tolerance. Never alters a shared Tier 2 skill directly.",
  },
};

export function resolveTierThresholds(thresholds: EvidenceThresholds, tier: SkillTier): EvidenceThresholds {
  const multiplier = TIER_OPTIMIZATION_POLICIES[tier].thresholdMultiplier;
  return {
    minRuns: Math.ceil(thresholds.minRuns * multiplier),
    minDistinctTasks: Math.ceil(thresholds.minDistinctTasks * multiplier),
    minFailureExamples: Math.ceil(thresholds.minFailureExamples * multiplier),
    minHeldOutCases: Math.ceil(thresholds.minHeldOutCases * multiplier),
  };
}

// ---------------------------------------------------------------------------
// Change budget
// ---------------------------------------------------------------------------

const AGGRESSIVENESS_ORDER: OptimizationAggressiveness[] = ["conservative", "balanced", "exploratory"];

const CHANGE_BUDGETS: Record<OptimizationAggressiveness, Omit<ChangeBudget, "permittedSections">> = {
  conservative: {
    aggressiveness: "conservative",
    maxChangedLines: 12,
    maxChangedTokens: 300,
    allowedOperations: ["add", "replace"],
    maxIterations: 3,
    learningRate: 1,
  },
  balanced: {
    aggressiveness: "balanced",
    maxChangedLines: 40,
    maxChangedTokens: 1000,
    allowedOperations: ["add", "replace", "delete"],
    maxIterations: 6,
    learningRate: 2,
  },
  exploratory: {
    aggressiveness: "exploratory",
    maxChangedLines: 120,
    maxChangedTokens: 3000,
    allowedOperations: ["add", "replace", "delete"],
    maxIterations: 12,
    learningRate: 4,
  },
};

/** Clamp the requested aggressiveness to what the skill's tier allows. */
export function resolveChangeBudget(
  requested: OptimizationAggressiveness,
  tier: SkillTier,
  permittedSections: string[] | "all" = "all",
): ChangeBudget {
  const ceiling = TIER_OPTIMIZATION_POLICIES[tier].maxAggressiveness;
  const effective = AGGRESSIVENESS_ORDER.indexOf(requested) > AGGRESSIVENESS_ORDER.indexOf(ceiling)
    ? ceiling
    : requested;
  return { ...CHANGE_BUDGETS[effective], permittedSections };
}

// ---------------------------------------------------------------------------
// Optimizer provider governance
// ---------------------------------------------------------------------------

const CLASSIFICATION_PROVIDER_CEILING: Record<SkillClassification, readonly OptimizerProviderId[]> = {
  public: ALL_OPTIMIZER_PROVIDERS,
  internal: ["azure-openai", "openai-enterprise", "anthropic-enterprise", "local-approved"],
  confidential: ["azure-openai"],
  restricted: [],
};

export type ProviderDecision =
  | { allowed: true; provider: OptimizerProviderId }
  | { allowed: false; reason: string };

export function listPermittedOptimizerProviders(
  settings: Pick<SkillIntelligenceSettings, "allowedOptimizerProviders">,
  classification: SkillClassification,
): OptimizerProviderId[] {
  const ceiling = new Set(CLASSIFICATION_PROVIDER_CEILING[classification]);
  return settings.allowedOptimizerProviders.filter(
    (provider) => ceiling.has(provider) && provider !== "local-unknown",
  );
}

export function selectOptimizerProvider(
  settings: Pick<SkillIntelligenceSettings, "allowedOptimizerProviders">,
  classification: SkillClassification,
  preferred?: OptimizerProviderId,
): ProviderDecision {
  const permitted = listPermittedOptimizerProviders(settings, classification);

  if (permitted.length === 0) {
    return {
      allowed: false,
      reason: classification === "restricted"
        ? "Restricted skills cannot be sent to any optimization provider."
        : `No tenant-approved optimizer provider is permitted for ${classification} skills.`,
    };
  }

  if (preferred) {
    return permitted.includes(preferred)
      ? { allowed: true, provider: preferred }
      : { allowed: false, reason: `${OPTIMIZER_PROVIDER_LABELS[preferred]} is not permitted for ${classification} skills.` };
  }

  return { allowed: true, provider: permitted[0] as OptimizerProviderId };
}

export function readSkillClassification(manifest: unknown): SkillClassification {
  if (typeof manifest === "object" && manifest !== null) {
    const record = manifest as Record<string, unknown>;
    const raw = record.classification ?? (record.governance as Record<string, unknown> | undefined)?.classification;
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "public" || normalized === "internal" || normalized === "confidential" || normalized === "restricted") {
        return normalized;
      }
    }
  }
  return "internal";
}

// ---------------------------------------------------------------------------
// Settings normalization (PUT /api/intelligence/settings)
// ---------------------------------------------------------------------------

const TELEMETRY_MODES: readonly TelemetryCaptureMode[] = ["metrics-only", "inputs-outputs", "full-trajectories"];
const RETENTION_CLASSES: readonly RetentionClass[] = ["30d", "90d", "1y", "custom"];
// "Autonomous production deployment" is intentionally not a representable mode.
const AUTO_MODES: readonly AutoOptimizationMode[] = ["off", "observe", "recommend", "continuous-evaluation"];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function readPositiveInt(value: unknown, fallback: number, max = 100_000): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
}

export function normalizeSkillIntelligenceSettings(
  input: unknown,
  base: SkillIntelligenceSettings = DEFAULT_SKILL_INTELLIGENCE_SETTINGS,
): SkillIntelligenceSettings {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const thresholds = typeof record.thresholds === "object" && record.thresholds !== null
    ? record.thresholds as Record<string, unknown>
    : {};

  const providers = Array.isArray(record.allowedOptimizerProviders)
    ? record.allowedOptimizerProviders.filter(
        (value): value is OptimizerProviderId => typeof value === "string" && (ALL_OPTIMIZER_PROVIDERS as readonly string[]).includes(value),
      )
    : base.allowedOptimizerProviders;

  const piiClasses = Array.isArray(record.redactPiiClasses)
    ? record.redactPiiClasses.filter(
        (value): value is PiiClass => typeof value === "string" && (ALL_PII_CLASSES as readonly string[]).includes(value),
      )
    : base.redactPiiClasses;

  const disabledSkills = Array.isArray(record.optimizationDisabledSkills)
    ? record.optimizationDisabledSkills
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 200)
        .map((value) => value.trim())
    : base.optimizationDisabledSkills;

  const retention = pickEnum(record.retention, RETENTION_CLASSES, base.retention);

  return {
    telemetryMode: pickEnum(record.telemetryMode, TELEMETRY_MODES, base.telemetryMode),
    retention,
    retentionCustomDays: retention === "custom"
      ? readPositiveInt(record.retentionCustomDays, base.retentionCustomDays ?? 90, 3650)
      : null,
    autoOptimizationMode: pickEnum(record.autoOptimizationMode, AUTO_MODES, base.autoOptimizationMode),
    aggressiveness: pickEnum(record.aggressiveness, AGGRESSIVENESS_ORDER, base.aggressiveness),
    thresholds: {
      minRuns: readPositiveInt(thresholds.minRuns, base.thresholds.minRuns),
      minDistinctTasks: readPositiveInt(thresholds.minDistinctTasks, base.thresholds.minDistinctTasks),
      minFailureExamples: readPositiveInt(thresholds.minFailureExamples, base.thresholds.minFailureExamples),
      minHeldOutCases: readPositiveInt(thresholds.minHeldOutCases, base.thresholds.minHeldOutCases),
    },
    allowedOptimizerProviders: [...new Set(providers)],
    optimizationDisabledSkills: [...new Set(disabledSkills)],
    redactPiiClasses: [...new Set(piiClasses)],
    retainUserIdentity: typeof record.retainUserIdentity === "boolean" ? record.retainUserIdentity : base.retainUserIdentity,
  };
}
