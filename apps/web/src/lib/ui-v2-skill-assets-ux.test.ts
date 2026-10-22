import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const workbench=readFileSync(fileURLToPath(new URL("../components/savant/screens/workbench-v2.tsx",import.meta.url)),"utf8");
const css=readFileSync(fileURLToPath(new URL("../components/savant/screens/workbench-v2.module.css",import.meta.url)),"utf8");
const api=readFileSync(fileURLToPath(new URL("../app/api/skills/[id]/assets/route.ts",import.meta.url)),"utf8");
const service=readFileSync(fileURLToPath(new URL("../server/control-plane/skill-assets.ts",import.meta.url)),"utf8");
const runtime=readFileSync(fileURLToPath(new URL("../server/control-plane/skill-assets-runtime.ts",import.meta.url)),"utf8");
const client=readFileSync(fileURLToPath(new URL("./control-plane-client.ts",import.meta.url)),"utf8");

test("PER-1610 Workbench reads and renders only ACL-filtered Git assets, not static fake files",()=>{
 assert.match(workbench,/fetchSkillAssets/);
 assert.match(workbench,/sourceData\.sourceCommitSha/);
 assert.match(workbench,/sourceData\.sourcePath/);
 assert.match(workbench,/assetData\.files\.map/);
 assert.match(workbench,/projectObservedSkillSourceGraph\(assetData\)/);
 assert.match(workbench,/sourceGraph\.unresolved\.map/);
 assert.match(workbench,/sourceGraph\.files\.map/);
 const projection=readFileSync(fileURLToPath(new URL("./ui-v2-workbench-source-graph.ts",import.meta.url)),"utf8");
 assert.match(projection,/for\(const link of inventory\.links\)/);
 assert.match(workbench,/openObservedFile/);
 assert.match(workbench,/currentPreview\.phase==="error"/);
 assert.match(workbench,/selectedPreview\.content/);
 assert.match(workbench,/read-only/i);
 assert.doesNotMatch(workbench,/localStorage|sessionStorage|fakeAsset|mockSource|dangerouslySetInnerHTML/);
});
test("PER-1610 source editor keeps reviewed proposals, dirty draft and ACL-gated editor",()=>{
 assert.match(workbench,/submitReviewedWorkbenchProposal/);
 assert.match(workbench,/proposeFileEdits/);
 assert.match(workbench,/getWorkbenchGate/);
 assert.match(workbench,/comparison\?\.changed/);
 assert.match(workbench,/guardNavigation/);
 assert.match(workbench,/controller\.abort\(\)/);
});
test("PER-1610 1150 and 780px layouts retain visible keyboard-usable source tree",()=>{
 assert.match(css,/@media \(max-width: 1150px\)/);
 assert.match(css,/@media \(max-width: 780px\)/);
 assert.match(css,/\.tree \{ display:block/);
 assert.doesNotMatch(css,/\.tree \{ display: none/);
 assert.match(css,/\.assetItem:focus-visible/);
 assert.match(workbench,/aria-pressed=\{chosenPath===file\.path/);
});
test("PER-1610 API refuses preview mutations and delegates to server tenant authorization",()=>{
 assert.match(api,/export async function GET/);
 assert.doesNotMatch(api,/export async function (POST|PUT|DELETE|PATCH)/);
 assert.match(api,/authorizeTenantRequest/);
 assert.match(api,/getSkillAssetResponse/);
 assert.match(api,/getAll\("path"\)\.length>1/);
 assert.match(api,/Cache-Control/);
 assert.match(client,/fetchSkillAssets/);
 assert.match(client,/encodeURIComponent\(id\)/);
 assert.match(client,/buildTenantScopedControlPlanePath/);
});
test("PER-1610 provider credentials only resolve AFTER repository and skill ACL",()=>{
 const read=service.indexOf("export async function readVerifiedSkillAssetSnapshot");
 assert.ok(read>=0);
 const body=service.slice(read);
 const ar=body.indexOf("await ports.authorizeRepository()");
 const aa=body.indexOf("await ports.authorizeArtifact()");
 const open=body.indexOf("await ports.openProvider()");
 assert.ok(ar>0&&aa>ar&&open>aa);
 assert.match(runtime,/validateRepositoryAccess/);
 assert.match(runtime,/repository_identity_mismatch/);
 assert.match(runtime,/getGitRuntime/);
 assert.match(service,/source_revision_unverified/);
 assert.match(service,/new TextDecoder\("utf-8",\{fatal:true\}\)/);
 assert.match(service,/sourceOfTruth:"git"/);
 assert.doesNotMatch(service,/production AI|eval run|unverifiedFallback/i);
});
