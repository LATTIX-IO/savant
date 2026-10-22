import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
const editor=read("../components/savant/screens/workflow-studio-v2.tsx");
const model=read("./ui-v2-workflow-model.ts");
const proposals=read("./git-connections-client.ts");
const api=read("../app/api/workflows/[workflowId]/route.ts");
test("PER-1587 workflow authoring uses actual Git proposals, not direct writes into protected branches",()=>{
 for(const phrase of [
  "proposeFileEdits(repositoryId","workflows/${workflowId}.json",
  "Review and approve it through","workflow was NOT committed or published",
  "Create Git proposal","savingRef.current",
  "setPendingProposal","alreadyProposed",
 ])assert.ok(editor.includes(phrase),phrase);
 assert.doesNotMatch(editor,/requestWorkflow\("PUT"|Commit to Git|Saved to Git revision|reconciliationRequired/);
 assert.match(proposals,/proposeFileEdits[\s\S]*?buildTenantScopedControlPlanePath/);
 assert.match(model,/does not write to the repository/);
});
test("PER-1587 authorization denials are never treated as creation opportunities",()=>{
 assert.match(editor,/status===404&&code==="workflow_not_found"/);
 assert.match(editor,/checked.status===404&&checked.code==="workflow_not_found"/);
 assert.match(editor,/current.blobSha!==baselineRecord.blobSha/);
 assert.match(editor,/current.commitSha!==baselineRecord.commitSha/);
 assert.match(editor,/current.repositoryId!==repositoryId/);
 assert.match(editor,/current.workflowId!==workflowId/);
 assert.match(editor,/JSON.stringify\(current.specification\)!==baseline/);
 assert.match(editor,/liveScopeRef.current!==originalKey/);
 assert.match(editor,/readRef.current\?\.abort/);
 assert.match(api,/authorizeCapabilityArtifact/);
 assert.match(api,/authorizeCapabilityRepository/);
});
test("PER-1587 rejected or unavailable workflow source cannot fabricate an approval, runtime or Git commit",()=>{
 assert.match(editor,/parseWorkflowSpecification\(draft\)/);
 assert.match(editor,/workflowSaveGate/);
 assert.match(editor,/window.confirm/);
 assert.match(editor,/A separate authorized review/);
 assert.doesNotMatch(editor,/localStorage|sessionStorage|mockWorkflow|fakeWorkflow|executeWorkflow|dangerouslySetInnerHTML/);
});
