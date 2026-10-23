import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describeSafetyDecision} from "../server/safety/policy.ts";
import {safetyFindings} from "../server/safety/findings.ts";
const paths=[
 "../components/catalog/catalog-labels.ts",
 "../components/catalog/safety-breakdown.tsx",
 "../components/savant/screens/skill-automation-panel.tsx",
 "../app/(marketing)/catalog/page.tsx",
 "../app/(marketing)/catalog/[id]/page.tsx",
 "../lib/seo.ts",
 "../server/safety/policy.ts",
 "../server/safety/findings.ts",
 "../server/hub/import.ts",
] as const;
test("PER-1624 Savant user-facing copy and generated review proposals do not reveal safety provider names",()=>{
 for(const path of paths){
  const source=readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
  assert.doesNotMatch(source,/SkillSpector|NVIDIA SkillSpector|Jev\s+(?:accepted|validated)|NVIDIA NIM/,path);
 }
});
test("PER-1624 safety verdict semantics remain intact and vendor-neutral",()=>{
 const cases=["pass","pass_low_risk","caution","block","unknown"] as const;
 for(const verdict of cases){
  const summary=describeSafetyDecision(verdict);
  assert.ok(summary.length>12,verdict);
  assert.doesNotMatch(summary,/NVIDIA|SkillSpector|Jev/,verdict);
 }
 const unsafe=safetyFindings([{
  skillId:"skill-a",sourcePath:"tier2/safety/skill-a",commitSha:"a".repeat(40),
  status:"complete",riskScore:90,severity:"CRITICAL",
  recommendation:"DO_NOT_INSTALL",issues:[],llmUsed:false,scannerVersion:"2",error:null,scannedAt:"2026-10-22",
 }]);
 assert.equal(unsafe[0]?.code,"SAFETY_DO_NOT_INSTALL");
 assert.equal(unsafe[0]?.severity,"blocker");
 assert.doesNotMatch(JSON.stringify(unsafe),/NVIDIA|SkillSpector|Jev/);
});
test("PER-1624 failing scanner exceptions do not expose raw vendor exception messages",()=>{
 const failed=safetyFindings([{
  skillId:"x",sourcePath:"tier2/example",commitSha:"a".repeat(40),
  status:"failed",riskScore:null,severity:null,recommendation:null,
  issues:[],llmUsed:false,scannerVersion:null,error:"SkillSpector proprietary backend failed",
  scannedAt:"2026-10-22",
 }]);
 assert.equal(failed[0]?.code,"SAFETY_SCAN_FAILED");
 assert.doesNotMatch(JSON.stringify(failed),/NVIDIA|SkillSpector/);
});
