import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {ReleaseQueueItem,OrganizationIntelligencePayload} from "@savant/types";
import {observedPortfolio,releaseProgress} from "./ui-v2-insights-model.ts";
test("unknown telemetry and 90d deltas stay unknown",()=>{
 assert.deepEqual(observedPortfolio(null),{active:null,runs:null,improving:null,degrading:null,
   coverage:null,improvement:null,telemetry:null});
 assert.equal(observedPortfolio({activeSkills:3,runsThisMonth:5,skillsImproving:0,
  skillsDegrading:1,evalCoveredSkillsPct:null,medianQualityImprovement90d:null,
  telemetrySufficientPct:null} as OrganizationIntelligencePayload).coverage,null);
});
test("release approval readiness does not imply automatic promotion",()=>{
 assert.deepEqual(releaseProgress({approvalsDone:1,approvalsRequired:3,
   approvalsBlocked:"Owner required"} as ReleaseQueueItem),
   {approved:1,required:3,blocked:true});
});
test("v2 Insights consumes immutable observed comparison and restores legacy policy editor",()=>{
 const ui=readFileSync(fileURLToPath(new URL("../components/savant/screens/insights-v2.tsx",import.meta.url)),"utf8");
 const classic=readFileSync(fileURLToPath(new URL("../components/savant/screens/intelligence.tsx",import.meta.url)),"utf8");
 for(const field of ["ObservedRunComparisonPanel","fetchReleaseDashboard",
    "fetchOrganizationIntelligence","fetchSkillDetail","workspaceSlug:slug,signal:controller.signal"])
   assert.ok(ui.includes(field),field);
 assert.match(ui,/advanced/);
 assert.match(classic,/ClassicIntelligenceScreen/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|dangerouslySetInnerHTML|Math\.random|approveRelease\(/);
});
