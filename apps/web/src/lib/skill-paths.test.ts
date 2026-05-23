import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSkillDetailPath,
  findSkillByIdentifier,
  matchesSkillIdentifier,
} from "./skill-paths.ts";

const CONTRACT_REVIEWER = {
  id: "skl_ccr",
  skillUuid: "11111111-1111-4111-8111-111111111111",
};

const RFC_REVIEWER = {
  id: "skl_erfc",
  skillUuid: "77777777-7777-4777-8777-777777777777",
};

test("buildSkillDetailPath keeps skill detail routes on UUID segments", () => {
  assert.equal(
    buildSkillDetailPath("/skills", CONTRACT_REVIEWER),
    "/skills/11111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    buildSkillDetailPath("/o/finance-ops/skills", CONTRACT_REVIEWER),
    "/o/finance-ops/skills/11111111-1111-4111-8111-111111111111",
  );
});

test("findSkillByIdentifier resolves both UUID and legacy skill identifiers", () => {
  const skills = [CONTRACT_REVIEWER, RFC_REVIEWER] as const;

  assert.equal(findSkillByIdentifier(skills, CONTRACT_REVIEWER.skillUuid), CONTRACT_REVIEWER);
  assert.equal(findSkillByIdentifier(skills, CONTRACT_REVIEWER.id), CONTRACT_REVIEWER);
  assert.equal(findSkillByIdentifier(skills, "missing-skill"), undefined);
});

test("matchesSkillIdentifier accepts UUID routes without dropping legacy compatibility", () => {
  assert.equal(matchesSkillIdentifier(CONTRACT_REVIEWER, CONTRACT_REVIEWER.skillUuid), true);
  assert.equal(matchesSkillIdentifier(CONTRACT_REVIEWER, CONTRACT_REVIEWER.id), true);
  assert.equal(matchesSkillIdentifier(CONTRACT_REVIEWER, RFC_REVIEWER.skillUuid), false);
});
