import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workflowIdValid, workflowDocumentPath, workflowSaveGate } from "./ui-v2-workflow-model.ts";

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
  assert.match(source,/requestWorkflow\("GET"/);
  assert.match(source,/requestWorkflow\("PUT"/);
  assert.match(source,/expectedBlobSha/);
  assert.match(source,/parseWorkflowSpecification/);
  assert.match(source,/workflowSaveGate/);
  assert.match(source,/sourceOfTruth/);
  assert.match(source,/reconciliationRequired/);
  assert.match(route,/WorkflowStudioEntry/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|dangerouslySetInnerHTML|fakeWorkflow|mockRun/);
});
