// Human approval workflow for improvement recommendations.
//
//   GENERATED → EVALUATING → READY FOR REVIEW → { REJECT | MODIFY | APPROVE }
//                                                         MODIFY → EVALUATING
//                                                         APPROVE → STAGING (release rail)
//
// This is the only path by which an optimizer candidate can move forward, and
// it ends at a staging release request — never at production directly.

import { createHash } from "node:crypto";

import type {
  EvidenceStrength,
  RecommendationEdit,
  RecommendationEditStatus,
  RecommendationReview,
  RecommendationReviewRequest,
  SkillImprovementRecommendation,
} from "@savant/types";

import { verifyLockedRegionsUnchanged } from "./locked-sections.ts";
import { withHumanApprovalCheck } from "./regression-gate.ts";
import { applyEdits, deriveEdits, renderUnifiedDiff } from "./skill-diff.ts";

export class RecommendationWorkflowError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "RecommendationWorkflowError";
    this.code = code;
    this.status = status;
  }
}

export function hashSkillContent(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Reviewer authorization
// ---------------------------------------------------------------------------

export type ReviewActor = {
  userRef: string;
  displayName: string;
  role: "Owner" | "Admin" | "Reviewer" | "Skill owner" | "Development";
};

export const REVIEWER_GROUPS = ["platform-admins", "skill-reviewers"];

export function resolveReviewerRole(input: {
  isFirstMember: boolean;
  groups: readonly string[];
  email: string;
  skillOwner: string | null;
}): ReviewActor["role"] | null {
  const groups = input.groups.map((group) => group.trim().toLowerCase());
  if (input.isFirstMember) {
    return "Owner";
  }
  if (groups.includes("platform-admins")) {
    return "Admin";
  }
  if (groups.includes("skill-reviewers")) {
    return "Reviewer";
  }
  if (input.skillOwner) {
    const owner = input.skillOwner.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    if (owner === email || owner === email.split("@")[0]) {
      return "Skill owner";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prioritization
// ---------------------------------------------------------------------------

const CONFIDENCE_WEIGHT: Record<EvidenceStrength, number> = {
  high: 1,
  medium: 0.7,
  low: 0.35,
  insufficient: 0.1,
};

/** impact × confidence × usage — never impact alone. */
export function computePriorityScore(input: {
  delta: number;
  evidenceStrength: EvidenceStrength;
  runCount: number;
}): number {
  const impact = Math.max(0, input.delta);
  const usage = Math.log10(1 + Math.max(0, input.runCount));
  return Math.round(impact * CONFIDENCE_WEIGHT[input.evidenceStrength] * usage * 10_000) / 10_000;
}

export function priorityBand(score: number): "high" | "medium" | "low" {
  if (score >= 10) {
    return "high";
  }
  if (score >= 3) {
    return "medium";
  }
  return "low";
}

export function nextCandidateVersion(baseVersion: string): string {
  const match = baseVersion.match(/^(v?)(\d+)\.(\d+)\.(\d+)/);
  if (match) {
    return `${match[1]}${match[2]}.${Number(match[3]) + 1}.0`;
  }
  return /[A-Za-z0-9]/.test(baseVersion) ? `${baseVersion}-opt.1` : "v0.1.0";
}

// ---------------------------------------------------------------------------
// Review transitions
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["approved", "rejected", "superseded"]);

export type ReviewEffect =
  | { type: "reevaluate"; reason: "modified" | "more-testing" }
  | { type: "release-to-staging"; candidateVersion: string };

export type ReviewOutcome = {
  recommendation: SkillImprovementRecommendation;
  review: RecommendationReview;
  effects: ReviewEffect[];
  auditAction: "recommendation.reviewed" | "candidate.approved" | "candidate.rejected";
};

function rebuildCandidate(
  recommendation: SkillImprovementRecommendation,
  candidateContent: string,
  editDecisions: Record<string, RecommendationEditStatus>,
): Pick<SkillImprovementRecommendation, "candidateContent" | "edits" | "proposedPatch"> {
  const locks = verifyLockedRegionsUnchanged(recommendation.baseContent, candidateContent);
  if (!locks.ok) {
    throw new RecommendationWorkflowError(
      "locked_region_modified",
      `Modified candidates must leave locked regions unchanged: ${locks.violations.join(" ")}`,
      422,
    );
  }

  const rationales = recommendation.edits.map((edit) => ({ baseStart: edit.baseStart, rationale: edit.rationale }));
  const edits: RecommendationEdit[] = deriveEdits(recommendation.baseContent, candidateContent, rationales).map((edit) => ({
    ...edit,
    status: editDecisions[edit.editId] ?? "accepted",
  }));

  return {
    candidateContent,
    edits,
    proposedPatch: renderUnifiedDiff(recommendation.baseContent, candidateContent, {
      fromLabel: `a/SKILL.md (${recommendation.baseVersion})`,
      toLabel: `b/SKILL.md (${recommendation.candidateVersion ?? "candidate"})`,
    }),
  };
}

export function applyReviewDecision(input: {
  recommendation: SkillImprovementRecommendation;
  request: RecommendationReviewRequest;
  actor: ReviewActor;
  reviewId: string;
  now?: Date;
}): ReviewOutcome {
  const { recommendation, request, actor } = input;
  const now = (input.now ?? new Date()).toISOString();

  if (TERMINAL_STATUSES.has(recommendation.status)) {
    throw new RecommendationWorkflowError(
      "recommendation_closed",
      `This recommendation is already ${recommendation.status}.`,
    );
  }

  const review: RecommendationReview = {
    reviewId: input.reviewId,
    reviewer: actor.displayName,
    reviewerRole: actor.role,
    decision: request.decision,
    reasons: request.reasons ?? [],
    comment: request.comment?.trim() || null,
    editDecisions: request.editDecisions ?? {},
    createdAt: now,
  };

  const base: SkillImprovementRecommendation = {
    ...recommendation,
    reviews: [...recommendation.reviews, review],
    updatedAt: now,
    reviewer: actor.displayName,
  };

  switch (request.decision) {
    case "reject": {
      if (!request.reasons || request.reasons.length === 0) {
        throw new RecommendationWorkflowError(
          "rejection_reason_required",
          "Select at least one rejection reason so future optimization runs can learn from it.",
          422,
        );
      }
      return {
        recommendation: { ...base, status: "rejected" },
        review,
        effects: [],
        auditAction: "candidate.rejected",
      };
    }

    case "request-more-testing": {
      return {
        recommendation: { ...base, status: "evaluating" },
        review,
        effects: [{ type: "reevaluate", reason: "more-testing" }],
        auditAction: "recommendation.reviewed",
      };
    }

    case "modify": {
      const decisions = request.editDecisions ?? {};
      let candidateContent: string;

      if (typeof request.candidateContent === "string") {
        candidateContent = request.candidateContent.replace(/\r\n/g, "\n");
      } else if (Object.keys(decisions).length > 0) {
        const kept = recommendation.edits.filter((edit) => (decisions[edit.editId] ?? edit.status) !== "rejected");
        candidateContent = applyEdits(recommendation.baseContent, kept);
      } else {
        throw new RecommendationWorkflowError(
          "modification_required",
          "Provide per-edit decisions or a modified candidate.",
          422,
        );
      }

      if (hashSkillContent(candidateContent) === hashSkillContent(recommendation.baseContent)) {
        throw new RecommendationWorkflowError(
          "modification_empty",
          "The modified candidate is identical to the base version. Reject the recommendation instead.",
          422,
        );
      }

      const rebuilt = rebuildCandidate(recommendation, candidateContent, typeof request.candidateContent === "string" ? {} : decisions);

      // The candidate is no longer the validated artifact: approvals are void
      // and the full evaluation must run again.
      return {
        recommendation: {
          ...base,
          ...rebuilt,
          status: "evaluating",
          requiresReevaluation: true,
          approvals: [],
        },
        review,
        effects: [{ type: "reevaluate", reason: "modified" }],
        auditAction: "recommendation.reviewed",
      };
    }

    case "approve": {
      if (recommendation.status !== "ready-for-review") {
        throw new RecommendationWorkflowError(
          "recommendation_not_ready",
          `Only recommendations that are ready for review can be approved (current: ${recommendation.status}).`,
        );
      }
      if (recommendation.requiresReevaluation) {
        throw new RecommendationWorkflowError(
          "reevaluation_required",
          "The candidate was modified after validation and must be re-evaluated before approval.",
        );
      }
      if (recommendation.validation.candidateContentHash !== hashSkillContent(recommendation.candidateContent)) {
        throw new RecommendationWorkflowError(
          "validation_stale",
          "Validation results do not match the current candidate content.",
        );
      }
      if (!recommendation.validation.passed) {
        throw new RecommendationWorkflowError(
          "validation_gate_failed",
          "The candidate did not pass the validation gate. Request more testing or reject it.",
          422,
        );
      }
      if (recommendation.approvals.includes(actor.userRef)) {
        throw new RecommendationWorkflowError(
          "duplicate_approval",
          "You have already approved this candidate; a different reviewer must provide the next approval.",
        );
      }

      const approvals = [...recommendation.approvals, actor.userRef];
      const fullyApproved = approvals.length >= recommendation.requiredApprovals;
      const candidateVersion = recommendation.candidateVersion ?? nextCandidateVersion(recommendation.baseVersion);

      return {
        recommendation: {
          ...base,
          approvals,
          candidateVersion,
          status: fullyApproved ? "approved" : "ready-for-review",
          validation: {
            ...recommendation.validation,
            gate: withHumanApprovalCheck(recommendation.validation, approvals.length, recommendation.requiredApprovals),
          },
        },
        review,
        effects: fullyApproved ? [{ type: "release-to-staging", candidateVersion }] : [],
        auditAction: fullyApproved ? "candidate.approved" : "recommendation.reviewed",
      };
    }

    default:
      throw new RecommendationWorkflowError("invalid_decision", "Unknown review decision.", 400);
  }
}
