import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workflowIdValid, workflowDocumentPath, workflowSaveGate, layoutWorkflowGraph } from "./ui-v2-workflow-model.ts";

test("Workflow Studio uses only the server's restricted workflow IDs, never a user path", () => {
  for (const id of ["a","triage","incident-response","workflow_1.2","workflow-7"]) {
    assert.equal(workflowIdValid(id),true);
    assert.equal(workflowDocumentPath(id),"/api/workflows/"+id);
  }
  for (const id of ["","..",".","foo..bar","../secrets","Foo","../../admin","%2e%2e","abc/def","abc\\def","hello world","a".repeat(81)]) {
    assert.equal(workflowIdValid(id),false,id);
    assert.throws(()=>workflowDocumentPath(id));
  }
});

test("Save requires a real repository, existence check, valid spec, and changed content", () => {
  const ready = {hasRecord:true,canCreate:false,valid:true,dirty:true,repositorySupported:true};
  assert.equal(workflowSaveGate(ready).allowed,true);
  assert.equal(workflowSaveGate({...ready,hasRecord:false,canCreate:true}).allowed,true);
  for (const change of [
    {repositorySupported:false},{hasRecord:false,canCreate:false},
    {valid:false},{dirty:false},
  ]) {
    const denied=workflowSaveGate({...ready,...change});
    assert.equal(denied.allowed,false,JSON.stringify(change));
    assert.ok(denied.reason.length>8);
  }
});

test("Workflow Studio is a version-pinned Git read/write UI, not a fake runtime", () => {
  const source=readFileSync(fileURLToPath(new URL("../components/savant/screens/workflow-studio-v2.tsx", import.meta.url)),"utf8");
  const route=readFileSync(fileURLToPath(new URL("../app/o/[workspaceSlug]/workflows/page.tsx", import.meta.url)),"utf8");
  assert.match(source,/fetchRepositoryList/);
  assert.match(source,/requestWorkflow\(slug,repositoryId,workflowId/);
  assert.match(source,/proposeFileEdits\(repositoryId/);
  assert.doesNotMatch(source,/requestWorkflow\("PUT"/);
  assert.match(source,/current\.blobSha!==baselineRecord\.blobSha/);
  assert.match(source,/parseWorkflowSpecification/);
  assert.match(source,/workflowSaveGate/);
  assert.match(source,/sourceOfTruth/);
  assert.match(source,/Proposal.*created/);
  assert.match(source,/workflow_not_found/);
  assert.match(route,/WorkflowStudioEntry/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|dangerouslySetInnerHTML|fakeWorkflow|mockRun/);
});

test("directed graph layout reflects only authored nodes and exact edges",()=>{
  const graph=layoutWorkflowGraph({
    nodes:[{id:"first"},{id:"second"},{id:"third"}],
    edges:[{id:"a",from:{nodeId:"first"},to:{nodeId:"second"}},
      {id:"b",from:{nodeId:"second"},to:{nodeId:"third"}}],
  });
  assert.deepEqual(graph.nodes.map(x=>x.id),["first","second","third"]);
  assert.equal(graph.edges.length,2);
  assert.ok(graph.nodes[1]!.x>graph.nodes[0]!.x);
  assert.ok(graph.nodes[2]!.x>graph.nodes[1]!.x);
  assert.match(graph.edges[0]!.path,/^M /);
  assert.equal(graph.truncated,false);
  const capped=layoutWorkflowGraph({
    nodes:Array.from({length:230},(_,n)=>({id:"n-"+n})),edges:[],
  });
  assert.equal(capped.nodes.length,200);
  assert.equal(capped.truncated,true);
});
test("workflow source UI has active rev-pinned Git save and no browser-only persistence",()=>{
  const source=readFileSync(fileURLToPath(new URL("../components/savant/screens/workflow-studio-v2.tsx",import.meta.url)),"utf8");
  assert.match(source,/incompatibleWorkflowConnection/);
  assert.match(source,/addWorkflowConnection/);
  assert.match(source,/removeWorkflowPort/);
  assert.match(source,/Create a reviewed Git change proposal/);
  assert.match(source,/savingRef\.current/);
  assert.match(source,/liveScopeRef\.current!==originalKey/);
  assert.doesNotMatch(source,/Commit this workflow directly|Saved to Git revision/);
  assert.match(source,/readRef\.current\?\.abort/);
  assert.match(source,/document\.addEventListener\("click",guardClientLink,true\)/);
  assert.match(source,/beforeunload/);
  assert.match(source,/workflowSaveGate/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|dangerouslySetInnerHTML|faker|mockWorkflow/);
});
test("backend workflow routes authorize tenant and explicit repository/artifact policy before content",()=>{
  const route=readFileSync(fileURLToPath(new URL("../app/api/workflows/[workflowId]/route.ts",import.meta.url)),"utf8");
  const list=readFileSync(fileURLToPath(new URL("../server/workflows/inventory.ts",import.meta.url)),"utf8");
  const idx=route.indexOf("authorizeCapabilityArtifact");
  const read=route.indexOf("workflowArtifacts.get(");
  assert.ok(idx>0&&read>idx,"Artifact checks must precede any workflow Git GET");
  const put=route.indexOf("workflowArtifacts.save(");
  const second=route.lastIndexOf("authorizeCapabilityArtifact");
  assert.ok(put>second&&second>read,"Mutation authorization must precede any Git PUT");
  assert.match(list,/authorizeCapabilityRepository/);
  assert.match(list,/authorizeCapabilityArtifact/);
  assert.match(list,/organization_id=\$\{actor\.organizationId\}/);
});
