import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {AIConnectionSummary} from "@savant/types";
import {inspectUiV2ProviderLanes} from "./ui-v2-provider-lanes.ts";

const record=(provider:string,overrides:Partial<AIConnectionSummary>={}):AIConnectionSummary=>({
  aiConnectionUuid:"1234",provider,label:"Synthetic test-only",
  defaultModel:"synthetic-model",purpose:"QA",status:"active",
  lastUsed:"never",lastRotated:"never",secretStore:"managed",
  usageScope:"quality",supportsExecution:true,supportsJudging:true,
  isDefaultExecution:false,isDefaultJudge:false,...overrides,
});
test("PER-1605: no records, tenant model metadata or imported evaluations prove production",()=>{
 const empty=inspectUiV2ProviderLanes(null);
 assert.equal(empty.workspaceOpenAiExecutor,null);
 assert.equal(empty.productionServing,null);
 assert.equal(empty.firstObservedTestBenchRun,"unverified");
 const other=inspectUiV2ProviderLanes([record("anthropic",{isDefaultExecution:true,
   isDefaultJudge:true})]);
 assert.equal(other.workspaceOpenAiExecutor,null);
 assert.equal(other.defaultJudgeCount,1);
 assert.equal(other.productionServing,null);
});
test("PER-1605: only active default workspace OpenAI can be described as eligible metadata",()=>{
 assert.equal(inspectUiV2ProviderLanes([record("openai",{isDefaultExecution:true})])
   .workspaceOpenAiExecutor?.provider,"openai");
 for(const entry of [
   record("openai",{isDefaultExecution:false}),
   record("openai",{isDefaultExecution:true,status:"revoked"}),
   record("openai",{isDefaultExecution:true,supportsExecution:false}),
   record("azure-openai",{isDefaultExecution:true}),
   record("openai-compatible",{isDefaultExecution:true}),
 ])assert.equal(inspectUiV2ProviderLanes([entry]).workspaceOpenAiExecutor,null);
});
test("PER-1605: UI has no fake OAuth callback or misleading first-run verification",()=>{
 const ui=readFileSync(fileURLToPath(new URL("../components/savant/screens/integrations-v2.tsx",
   import.meta.url)),"utf8");
 const guide=readFileSync(fileURLToPath(new URL("../components/savant/screens/provider-connection-guide.tsx",
   import.meta.url)),"utf8");
 assert.match(ui,/independent production routing not configured/i);
 assert.match(guide,/commercial partner/);
 assert.match(guide,/unmodified Claude Code runtime/);
 assert.match(guide,/cannot proxy Claude.ai subscription OAuth/);
 assert.match(ui,/Not verified by this integration inventory/);
 assert.doesNotMatch(ui,/fetchEvaluationDashboard|firstEvaluation/);
 assert.doesNotMatch(ui,/oauth\/callback|window\.location\.assign\(|localStorage|sessionStorage/);
 for(const f of ["fetchRepositoryList","fetchAIConnections","fetchConnectorDashboard",
  "workspaceSlug:slug,signal:controller.signal"])assert.ok(ui.includes(f),f);
});
