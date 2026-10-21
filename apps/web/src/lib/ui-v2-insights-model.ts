import type { ReleaseQueueItem,ReleaseHistoryItem } from "@savant/types";
import type { OrganizationIntelligencePayload } from "@savant/types";
export function releaseProgress(record:ReleaseQueueItem){
 const total=record.approvalsRequired,done=record.approvalsDone;
 return {approved:Math.min(total,Math.max(0,done)),
  required:Math.max(0,total),blocked:!!record.approvalsBlocked};
}
export function observedPortfolio(payload:OrganizationIntelligencePayload|null){
 if(!payload)return {active:null,runs:null,improving:null,degrading:null,coverage:null,
   improvement:null,telemetry:null};
 return {active:payload.activeSkills,runs:payload.runsThisMonth,
  improving:payload.skillsImproving,degrading:payload.skillsDegrading,
  coverage:payload.evalCoveredSkillsPct,improvement:payload.medianQualityImprovement90d,
  telemetry:payload.telemetrySufficientPct};
}
export function chronologicalReleaseHistory(items:readonly ReleaseHistoryItem[]){
 return [...items].sort((a,b)=>Date.parse(b.when)-Date.parse(a.when));
}
