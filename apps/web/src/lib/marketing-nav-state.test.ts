import assert from "node:assert/strict";
import test from "node:test";

import {
  isMarketingNavSolid,
  MARKETING_NAV_SOLID_SCROLL_TOP,
} from "./marketing-nav-state.ts";

test("isMarketingNavSolid stays transparent at the top of the page", () => {
  assert.equal(isMarketingNavSolid(0), false);
  assert.equal(isMarketingNavSolid(MARKETING_NAV_SOLID_SCROLL_TOP), false);
});

test("isMarketingNavSolid flips once the reader scrolls past the hero threshold", () => {
  assert.equal(isMarketingNavSolid(MARKETING_NAV_SOLID_SCROLL_TOP + 1), true);
  assert.equal(isMarketingNavSolid(480), true);
});