import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackSkillSourceContent,
  insertQueuedSkillRecommendationsIntoDraft,
  parseMarkdownPreviewBlocks,
} from "./skill-builder.ts";

test("buildFallbackSkillSourceContent creates a reviewable markdown draft from indexed skill metadata", () => {
  const draft = buildFallbackSkillSourceContent({
    skillId: "skl_contract_reviewer",
    skillUuid: "11111111-1111-4111-8111-111111111111",
    name: "Contract Reviewer",
    description: "Reviews contracts for clause deviations and missing approvals.",
    tier: 1,
    owner: "ari.chen",
    team: "Legal Ops",
    repo: "acme/legal-skills",
    repoProvider: "github",
    branch: "main",
    ref: "v2.3.7",
    candidateRef: "v2.4.0-rc.2",
  });

  assert.match(draft, /^# Contract Reviewer/m);
  assert.match(draft, /## Metadata/);
  assert.match(draft, /- Repository: acme\/legal-skills/);
  assert.match(draft, /- Candidate ref: v2\.4\.0-rc\.2/);
  assert.match(draft, /## Responsibilities/);
});

test("parseMarkdownPreviewBlocks groups headings, lists, blockquotes, and fenced code blocks", () => {
  const blocks = parseMarkdownPreviewBlocks([
    "# Builder",
    "<!-- savant:queued-recommendations:start -->",
    "",
    "Intro paragraph that explains the skill.",
    "",
    "- First action",
    "- Second action",
    "",
    "> Keep guardrails explicit.",
    "",
    "```yaml",
    "version: 1",
    "kind: skill",
    "```",
  ].join("\n"));

  assert.deepEqual(blocks, [
    { type: "heading", level: 1, text: "Builder" },
    { type: "paragraph", text: "Intro paragraph that explains the skill." },
    { type: "list", ordered: false, items: ["First action", "Second action"] },
    { type: "blockquote", text: "Keep guardrails explicit." },
    { type: "code", language: "yaml", content: "version: 1\nkind: skill" },
  ]);
});

test("insertQueuedSkillRecommendationsIntoDraft appends a stable queued-recommendations section without duplicating entries", () => {
  const queuedRecommendations = [
    {
      queueId: "eval-001:rec-001",
      recommendationId: "rec-001",
      skillId: "skl_contract_reviewer",
      skillName: "Contract Reviewer",
      skillTeam: "Legal Ops",
      skillRepo: "acme/legal-skills",
      skillBranch: "main",
      evaluationUuid: "eval-001",
      evaluationRef: "eval-2026-05-20",
      evaluationDataset: "nda-edge-cases",
      evaluationStarted: "May 20, 9:00 AM",
      title: "Split prompt paths by agreement family",
      category: "prompt",
      effort: "medium",
      impact: "Improves mutual-indemnity recall on the current regression slice.",
      rationale: "The same failure shape appears across NDA and MSA variants, so specialized instructions are cheaper than a rubric rewrite.",
      actions: [
        "Route NDAs and MSAs through separate extraction prompts.",
        "Require explicit carve-out language before low-risk recommendations.",
      ],
      queuedAt: "2026-05-20T09:00:00.000Z",
    },
  ];

  const firstInsert = insertQueuedSkillRecommendationsIntoDraft("# Contract Reviewer\n\n## Responsibilities\n- Review legal clauses.", queuedRecommendations);
  const secondInsert = insertQueuedSkillRecommendationsIntoDraft(firstInsert.draft, queuedRecommendations);

  assert.equal(firstInsert.insertedCount, 1);
  assert.equal(firstInsert.skippedCount, 0);
  assert.match(firstInsert.draft, /## Queued evaluation recommendations/);
  assert.match(firstInsert.draft, /### Split prompt paths by agreement family/);
  assert.match(firstInsert.draft, /Source evaluation: eval-2026-05-20 · nda-edge-cases · May 20, 9:00 AM/);
  assert.match(firstInsert.draft, /Recommended actions:\n- Route NDAs and MSAs through separate extraction prompts\./);

  assert.equal(secondInsert.insertedCount, 0);
  assert.equal(secondInsert.skippedCount, 1);
  assert.equal(secondInsert.draft, firstInsert.draft);
});
