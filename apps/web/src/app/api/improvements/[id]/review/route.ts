import {
  REJECTION_REASONS,
  type RecommendationEditStatus,
  type RecommendationReviewRequest,
  type RejectionReason,
  type ReviewDecision,
} from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { requireReviewer, resolveIntelligenceActor } from "@/server/skill-intelligence/actors";
import { handleSkillIntelligenceRoute, jsonResource, readJsonBody } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { getRecommendation, reviewRecommendation, SkillIntelligenceError } from "@/server/skill-intelligence/service";

const DECISIONS: readonly ReviewDecision[] = ["approve", "reject", "modify", "request-more-testing"];
const EDIT_STATUSES: readonly RecommendationEditStatus[] = ["proposed", "accepted", "rejected"];
const MAX_CANDIDATE_LENGTH = 200_000;

function parseReviewRequest(record: Record<string, unknown>): RecommendationReviewRequest {
  if (typeof record.decision !== "string" || !DECISIONS.includes(record.decision as ReviewDecision)) {
    throw new SkillIntelligenceError("invalid_review_decision", `decision must be one of: ${DECISIONS.join(", ")}.`, 400);
  }

  const request: RecommendationReviewRequest = { decision: record.decision as ReviewDecision };

  if (Array.isArray(record.reasons)) {
    request.reasons = record.reasons.filter(
      (value): value is RejectionReason => typeof value === "string" && REJECTION_REASONS.includes(value as RejectionReason),
    );
  }
  if (typeof record.comment === "string" && record.comment.trim()) {
    request.comment = record.comment.trim().slice(0, 4000);
  }
  if (typeof record.editDecisions === "object" && record.editDecisions !== null) {
    const decisions: Record<string, RecommendationEditStatus> = {};
    for (const [editId, value] of Object.entries(record.editDecisions as Record<string, unknown>)) {
      if (typeof value === "string" && EDIT_STATUSES.includes(value as RecommendationEditStatus) && editId.length <= 80) {
        decisions[editId] = value as RecommendationEditStatus;
      }
    }
    request.editDecisions = decisions;
  }
  if (typeof record.candidateContent === "string") {
    if (record.candidateContent.length > MAX_CANDIDATE_LENGTH) {
      throw new SkillIntelligenceError("candidate_too_large", "The modified candidate is too large.", 413);
    }
    request.candidateContent = record.candidateContent;
  }
  return request;
}

/** Approve, reject (with structured reasons), modify, or request more testing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    const { id } = await params;
    const raw = await readJsonBody(request);
    const body = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};

    const current = await getRecommendation(deps, { organizationId: context.tenant.organizationId, recommendationId: id });
    const skill = await deps.catalog.getSkill(context.tenant.organizationId, current.skillId);
    const actor = await resolveIntelligenceActor(context);
    const reviewer = requireReviewer(actor, skill?.owner ?? null, {
      isDevelopmentFallback: context.isDevelopmentFallback,
      devAlias: typeof body.devReviewerAlias === "string" ? body.devReviewerAlias : undefined,
    });

    return jsonResource(await reviewRecommendation(deps, {
      organizationId: context.tenant.organizationId,
      recommendationId: id,
      request: parseReviewRequest(body),
      actor: reviewer,
    }));
  });
}
