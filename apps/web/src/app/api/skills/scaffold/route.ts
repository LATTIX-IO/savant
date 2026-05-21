import { NextResponse } from "next/server";

import type { SkillScaffoldRequest, SkillScaffoldResponse } from "@savant/types";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import {
  readJsonObject,
  readOptionalString,
  readOptionalStringArray,
  readRequiredString,
} from "@/server/control-plane/request-validation";
import { generateSkillScaffold } from "@/server/control-plane/skill-scaffold";

export async function POST(request: Request) {
  const body = await readJsonObject(request);

  if (!body) {
    return NextResponse.json(
      createApiErrorResponse(
        "invalid_json_body",
        "Expected a JSON object payload for skill scaffold generation.",
      ),
      { status: 400 },
    );
  }

  const displayName = readRequiredString(body, "displayName", 160);
  const tier = readRequiredString(body, "tier", 20);
  const owner = readRequiredString(body, "owner", 120);
  const summary = readRequiredString(body, "summary", 400);
  const tier3Kind = readOptionalString(body, "tier3Kind", 40);
  const status = readOptionalString(body, "status", 30);

  if (!displayName || !owner || !summary || !tier) {
    return NextResponse.json(
      createApiErrorResponse(
        "invalid_skill_scaffold_request",
        "Skill scaffold generation requires displayName, tier, owner, and summary.",
      ),
      { status: 400 },
    );
  }

  if (tier !== "tier1" && tier !== "tier2" && tier !== "tier3") {
    return NextResponse.json(
      createApiErrorResponse(
        "invalid_skill_tier",
        "Skill scaffold generation requires tier1, tier2, or tier3.",
      ),
      { status: 400 },
    );
  }

  if (tier3Kind && tier3Kind !== "personal" && tier3Kind !== "workflow") {
    return NextResponse.json(
      createApiErrorResponse(
        "invalid_tier3_kind",
        "Skill scaffold generation tier3Kind must be personal or workflow.",
      ),
      { status: 400 },
    );
  }

  if (status && status !== "draft" && status !== "active" && status !== "deprecated") {
    return NextResponse.json(
      createApiErrorResponse(
        "invalid_skill_status",
        "Skill scaffold generation status must be draft, active, or deprecated.",
      ),
      { status: 400 },
    );
  }

  const validatedTier3Kind: SkillScaffoldRequest["tier3Kind"] =
    tier3Kind === "personal" || tier3Kind === "workflow" ? tier3Kind : undefined;
  const validatedStatus: SkillScaffoldRequest["status"] =
    status === "draft" || status === "active" || status === "deprecated"
      ? status
      : undefined;

  const requestBody: SkillScaffoldRequest = {
    displayName,
    tier,
    owner,
    summary,
    skillId: readOptionalString(body, "skillId", 200),
    packagePath: readOptionalString(body, "packagePath", 240),
    domain: readOptionalString(body, "domain", 100),
    category: readOptionalString(body, "category", 100),
    personSlug: readOptionalString(body, "personSlug", 100),
    tier3Kind: validatedTier3Kind,
    version: readOptionalString(body, "version", 30),
    status: validatedStatus,
    dependencies: readOptionalStringArray(body, "dependencies"),
  };

  const response: SkillScaffoldResponse = {
    data: generateSkillScaffold(requestBody),
    meta: createControlPlaneMeta("git"),
  };

  return NextResponse.json(response);
}