import assert from "node:assert/strict";
import test from "node:test";

import { MAX_SKILL_SOURCE_LENGTH } from "../../lib/skill-builder.ts";

import { normalizeSkillSourceUpdateRequest } from "./skill-source.ts";

test("normalizeSkillSourceUpdateRequest preserves markdown structure while normalizing line endings", () => {
  const request = normalizeSkillSourceUpdateRequest({
    content: "# Title\r\n\r\n- item one\r\n- item two\r\n",
    commitMessage: "  chore(skill): update source  ",
  });

  assert.deepEqual(request, {
    content: "# Title\n\n- item one\n- item two\n",
    commitMessage: "chore(skill): update source",
  });
});

test("normalizeSkillSourceUpdateRequest rejects blank or oversized markdown payloads", () => {
  assert.equal(normalizeSkillSourceUpdateRequest({ content: "   \n\n" }), null);
  assert.equal(
    normalizeSkillSourceUpdateRequest({ content: "a".repeat(MAX_SKILL_SOURCE_LENGTH + 1) }),
    null,
  );
});
