import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {buildTenantAppPath} from "./tenant-paths.ts";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");
const shell=read("../components/savant/app-shell-v2.tsx");
const bubble=read("../components/savant/setup-status-bubble-v2.tsx");
const css=read("../components/savant/app-shell-v2.module.css");
test("PER-1614 setup bubble is above profile and links to tenant-owned Settings setup",()=>{
 const index=shell.indexOf("<SetupStatusBubbleV2 workspaceSlug={workspace.slug} />");
 const profile=shell.indexOf("className={styles.profile}");
 assert.ok(index>=0&&profile>index);
 assert.match(bubble,/buildTenantAppPath\(workspaceSlug,"\/settings\?section=setup"\)/);
 assert.equal(buildTenantAppPath("workspace-b","/settings?section=setup"),
   "/o/workspace-b/settings?section=setup");
 assert.match(bubble,/aria-label=\{\`Open workspace setup/);
 assert.match(css,/\.setupBubble:focus-visible/);
 assert.match(css,/@media\(max-width:900px\)/);
});
test("PER-1614 status is based on server-owned source data, never a browser-local fake checklist",()=>{
 for(const token of ["fetchRepositoryList","fetchSkillList","fetchAIConnections",
    "workspaceSlug,signal:controller.signal","describeWorkspaceSetup","AbortController",
    "report.steps.filter","prerequisites.filter","observed/prerequisites.length"]){
   assert.ok(bubble.includes(token),token);
 }
 assert.match(bubble,/status.scope===workspaceSlug/);
 assert.doesNotMatch(bubble,/localStorage|sessionStorage|mock|fake|setTimeout|Math\.random|successToast/);
 assert.match(bubble,/Verify saved cases and actual runs in Settings/);
});
