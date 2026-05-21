import assert from "node:assert/strict";
import test from "node:test";

import { generateSkillScaffold } from "./skill-scaffold.ts";

test("generateSkillScaffold creates a tier 2 scaffold with registry updates", () => {
  const scaffold = generateSkillScaffold({
    category: "contracts",
    dependencies: ["shared/legal-style", "shared/risk-taxonomy"],
    displayName: "Contract Review Assistant",
    domain: "legal",
    owner: "ari.chen",
    status: "draft",
    summary: "Review commercial contracts and flag material risk language.",
    tier: "tier2",
  });

  assert.match(
    scaffold.skillUuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(scaffold.skillId, "legal/contract-review-assistant");
  assert.equal(scaffold.packagePath, "tier2/methodology/legal/contract-review-assistant");
  assert.equal(scaffold.files.length, 6);
  assert.equal(scaffold.registryUpdates.length, 4);
  assert.ok(scaffold.files.some((file) => file.path.endsWith("/SKILL.md")));
  assert.ok(
    scaffold.registryUpdates.some(
      (update) =>
        update.path === "registry/skills.yaml" &&
        update.preview.includes("legal/contract-review-assistant"),
    ),
  );
  assert.ok(
    scaffold.registryUpdates.some(
      (update) =>
        update.path === "registry/dependencies.yaml" &&
        update.preview.includes("shared/legal-style"),
    ),
  );
});

test("generateSkillScaffold derives a personal tier 3 path from the owner slug", () => {
  const scaffold = generateSkillScaffold({
    displayName: "Executive Brief Prep",
    owner: "Sasha Green",
    personSlug: "sasha-green",
    summary: "Prepare a concise executive-ready brief with open questions and next steps.",
    tier: "tier3",
    tier3Kind: "personal",
  });

  assert.equal(scaffold.skillId, "personal/sasha-green/executive-brief-prep");
  assert.equal(scaffold.packagePath, "tier3/personal/sasha-green/executive-brief-prep");
  assert.ok(scaffold.files.some((file) => file.path.endsWith("/metadata.yaml")));
  assert.ok(
    scaffold.registryUpdates.some(
      (update) =>
        update.path === "registry/owners.yaml" && update.preview.includes("Sasha Green"),
    ),
  );
});