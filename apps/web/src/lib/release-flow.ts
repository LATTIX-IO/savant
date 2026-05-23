import type {
  ReleaseEnvironment,
  ReleaseQueueItem,
  ReleaseReadinessItem,
} from "@savant/types";

export const RELEASE_STAGE_ORDER = [
  "draft",
  "staging",
  "production",
] as const satisfies readonly ReleaseEnvironment[];

export type ReleaseReadinessState = "passed" | "pending" | "blocked";
export type ReleaseStageVisualState = "completed" | "current" | "target" | "future";

export interface ReleaseReadinessSegment {
  label: string;
  meta: string;
  state: ReleaseReadinessState;
}

export interface ReleaseReadinessSummary {
  completion: number;
  passedCount: number;
  pendingCount: number;
  blockedCount: number;
  total: number;
  segments: ReleaseReadinessSegment[];
}

export interface ReleaseStageVisual {
  stage: ReleaseEnvironment;
  state: ReleaseStageVisualState;
  statusLabel: string;
  meta: string;
}

export interface ReleaseApprovalVisual {
  label: string;
  meta: string;
  state: ReleaseReadinessState;
}

type ReleaseFlowRecord = Omit<
  Pick<
    ReleaseQueueItem,
    | "approvalsDone"
    | "approvalsRequired"
    | "candidateRef"
    | "fromEnv"
    | "readiness"
    | "readinessPct"
    | "targets"
    | "toEnv"
  >,
  "readiness" | "targets"
> & {
  readonly readiness: readonly ReleaseReadinessItem[];
  readonly targets: readonly string[];
};

const APPROVAL_LABEL_PATTERN = /(approval|review)/i;
const BUNDLE_LABEL_PATTERN = /(bundle|build)/i;

export function normalizeReleaseProgress(readinessPct: number): number {
  if (!Number.isFinite(readinessPct)) {
    return 0;
  }

  const normalized = readinessPct > 1 ? readinessPct / 100 : readinessPct;
  return Math.max(0, Math.min(normalized, 1));
}

export function getReleaseReadinessState(
  item: Pick<ReleaseReadinessItem, "ok">,
): ReleaseReadinessState {
  if (item.ok === true) {
    return "passed";
  }

  if (item.ok === false) {
    return "blocked";
  }

  return "pending";
}

export function summarizeReleaseReadiness(
  readiness: readonly ReleaseReadinessItem[],
  readinessPct?: number,
): ReleaseReadinessSummary {
  const segments = readiness.map((item) => ({
    label: item.label,
    meta: item.meta,
    state: getReleaseReadinessState(item),
  }));

  let passedCount = 0;
  let pendingCount = 0;
  let blockedCount = 0;

  for (const segment of segments) {
    if (segment.state === "passed") {
      passedCount += 1;
    } else if (segment.state === "blocked") {
      blockedCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  const completion = readinessPct === undefined
    ? (segments.length === 0 ? 0 : passedCount / segments.length)
    : normalizeReleaseProgress(readinessPct);

  return {
    completion,
    passedCount,
    pendingCount,
    blockedCount,
    total: segments.length,
    segments,
  };
}

function humanizeReleaseStage(stage: ReleaseEnvironment): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function buildReleaseStageVisuals(release: ReleaseFlowRecord): ReleaseStageVisual[] {
  const readiness = summarizeReleaseReadiness(release.readiness, release.readinessPct);
  const fromIndex = RELEASE_STAGE_ORDER.indexOf(release.fromEnv);
  const toIndex = RELEASE_STAGE_ORDER.indexOf(release.toEnv);
  const readinessLabel = `${Math.round(readiness.completion * 100)}% release ready`;

  return RELEASE_STAGE_ORDER.map((stage, index) => {
    if (index < fromIndex) {
      return {
        stage,
        state: "completed",
        statusLabel: "Completed",
        meta: "Cleared earlier in this promotion.",
      };
    }

    if (stage === release.fromEnv) {
      const sourceMeta = release.fromEnv === "draft"
        ? `Candidate ${release.candidateRef}`
        : `${release.approvalsDone}/${release.approvalsRequired} approvals recorded.`;

      return {
        stage,
        state: "current",
        statusLabel: "Current",
        meta: sourceMeta,
      };
    }

    if (stage === release.toEnv) {
      const targetMeta = readiness.total > 0
        ? readinessLabel
        : `${release.targets.length} deployment target${release.targets.length === 1 ? "" : "s"} configured.`;

      return {
        stage,
        state: "target",
        statusLabel: "Target",
        meta: targetMeta,
      };
    }

    return {
      stage,
      state: "future",
      statusLabel: index > toIndex ? "Queued" : humanizeReleaseStage(stage),
      meta: "Awaiting earlier promotion gates.",
    };
  });
}

export function buildReleaseApprovalVisuals(
  release: Pick<ReleaseQueueItem, "approvalsDone" | "approvalsRequired"> & {
    readonly readiness: readonly ReleaseReadinessItem[];
  },
): ReleaseApprovalVisual[] {
  const explicitApprovals = release.readiness
    .filter((item) => APPROVAL_LABEL_PATTERN.test(item.label))
    .map((item) => ({
      label: item.label,
      meta: item.meta,
      state: getReleaseReadinessState(item),
    }));

  if (explicitApprovals.length > 0) {
    return explicitApprovals;
  }

  return Array.from({ length: release.approvalsRequired }, (_, index) => ({
    label: `Approval ${index + 1}`,
    meta: index < release.approvalsDone ? "Recorded" : "Awaiting approver",
    state: index < release.approvalsDone ? "passed" : "pending",
  }));
}

export function findReleaseBundleSignal(
  readiness: readonly ReleaseReadinessItem[],
): ReleaseReadinessSegment | null {
  const bundle = readiness.find((item) => BUNDLE_LABEL_PATTERN.test(item.label));

  if (!bundle) {
    return null;
  }

  return {
    label: bundle.label,
    meta: bundle.meta,
    state: getReleaseReadinessState(bundle),
  };
}
