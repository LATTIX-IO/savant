import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRunListItem, OverviewPayload, SkillListItem } from "@savant/types";
import { buildUiV2Attention, medianObservedQuality, observedInFlight } from "./ui-v2-overview-model.ts";

test("reference attention queue preserves server severity, without fabricated alerts", () => {
  const overview = {
    regressions: [{skill:"Incident triage",metric:"Quality",from:88,to:82,severity:"critical"}],
    approvals: [{id:"A1",skill:"Clause review",blocking:"Reviewer required"}],
    repositories: [{
      id:"R1",name:"repo",syncMessage:"Authorization revoked",
      syncState:"access_revoked",status:"error",projection:{indexedAt:null},
    }],
  } as unknown as OverviewPayload;
  const q = buildUiV2Attention(overview);
  assert.deepEqual(q.map(i=>i.kind), ["regression","repository","approval"]);
  assert.deepEqual(q.map(i=>i.priority), ["P1","P2","Decision"]);
  assert.equal(q[1]?.detail, "Authorization revoked");
  assert.deepEqual(buildUiV2Attention({
    ...overview, regressions:[], approvals:[], repositories:[],
  }),[]);
});

test("median quality and in-flight counts require actual provider/control-plane evidence", () => {
  const skills = [
    {score:null},{score:82.3},{score:90.1},{score:Number.NaN},{score:87.6},
  ] as SkillListItem[];
  assert.equal(medianObservedQuality(skills),87.6);
  assert.equal(medianObservedQuality([]),null);
  assert.equal(medianObservedQuality([{score:null}] as SkillListItem[]),null);
  const runs=[{id:"1",status:"running"},{id:"2",status:"complete"},
    {id:"3",status:"failed"}] as EvaluationRunListItem[];
  assert.deepEqual(observedInFlight(runs).map(r=>r.id),["1"]);
  assert.deepEqual(observedInFlight([]),[]);
});
