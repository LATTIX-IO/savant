import test from "node:test";
import assert from "node:assert/strict";
import type { ControlPlaneSql } from "../control-plane/database.ts";
import { listReadableIndexedWorkflows } from "./inventory.ts";
import { CapabilityResolveError } from "./capability-resolver.ts";

type Flags={repoExists:boolean;explicitDeny:boolean;indexRows:number};
function harness(flags:Flags){
 const calls={repository:0,index:0,artifact:0};
 const sql=((parts:TemplateStringsArray)=>{
   const query=parts.join("?");
   if(query.includes("repository_permissions")){
     calls.repository++;
     return Promise.resolve(flags.repoExists?[{status:"active",permission_count:0,allowed:false}]:[]);
   }
   if(query.includes("workflow_artifact_versions")){
     calls.index++;
     return Promise.resolve(Array.from({length:flags.indexRows},(_,i)=>({
       workflow_id:"wf-"+i,specification_version:"1.0.0",
       source_commit_sha:"1".repeat(40),indexed_at:new Date("2026-10-20T00:00:00Z"),
     })));
   }
   if(query.includes("capability_artifact_permissions")){
     calls.artifact++;
     return Promise.resolve([{status:"active",rule_count:flags.explicitDeny?1:0,
       has_allow:false,has_deny:flags.explicitDeny}]);
   }
   throw Error("Unexpected query in workflow index test");
 }) as unknown as ControlPlaneSql;
 return {sql,calls};
}
const actor={organizationId:"tenant-a",subject:"owner"};
test("indexed workflow discovery checks repository authorization before any listing",async()=>{
 const h=harness({repoExists:false,explicitDeny:false,indexRows:2});
 await assert.rejects(listReadableIndexedWorkflows(h.sql,actor,"repo-foreign"),
   (e:unknown)=>e instanceof CapabilityResolveError&&e.code==="not_found");
 assert.equal(h.calls.index,0);
 assert.equal(h.calls.artifact,0);
 assert.equal(h.calls.repository,1);
});
test("per-artifact ACL denies individual workflow names without disclosing their metadata",async()=>{
 const h=harness({repoExists:true,explicitDeny:true,indexRows:3});
 const result=await listReadableIndexedWorkflows(h.sql,actor,"repo-owned");
 assert.deepEqual(result,[]);
 assert.equal(h.calls.repository,1);
 assert.equal(h.calls.index,1);
 assert.equal(h.calls.artifact,3);
});
test("legible indexed metadata retains Git provenance but never invents full graph content",async()=>{
 const h=harness({repoExists:true,explicitDeny:false,indexRows:2});
 const result=await listReadableIndexedWorkflows(h.sql,actor,"repo-owned");
 assert.equal(result.length,2);
 assert.deepEqual(Object.keys(result[0]!).sort(),["indexedAt","sourceCommitSha","version","workflowId"]);
 assert.equal(result[0]?.workflowId,"wf-0");
 assert.equal(result[0]?.sourceCommitSha,"1".repeat(40));
 assert.equal(h.calls.artifact,2);
});
test("missing authenticated identity fails before even checking repository metadata",async()=>{
 const h=harness({repoExists:true,explicitDeny:false,indexRows:2});
 await assert.rejects(listReadableIndexedWorkflows(h.sql,{...actor,subject:""},"repo-owned"),
  (e:unknown)=>e instanceof CapabilityResolveError&&e.status===404);
 assert.deepEqual(h.calls,{repository:0,index:0,artifact:0});
});
