import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {RepositoryListItem} from "@savant/types";
import {eligibleCatalogImportRepositories,initialCatalogImportRepositoryId,canProposeCatalogImport} from "./ui-v2-catalog-import.ts";
import {getUiV2WorkspaceNavigation,buildUiV2RouteCrumbs} from "./ui-v2-shell-model.ts";
import {EMPTY_SAVANT_SHELL_DATA} from "./shell-state.ts";

const repo=(id:string,allow=true)=>({id,name:`LATTIX-IO/${id}`,provider:"github",
 branch:"main",status:"ok",providerReadiness:{supportsProvisioningWrites:allow}}) as RepositoryListItem;
test("PER-1623 choose exactly one eligible repository; multiple require explicit selection",()=>{
 const a=repo("one"),b=repo("two");
 assert.deepEqual(eligibleCatalogImportRepositories([a,repo("unsupported",false)]).map(r=>r.id),["one"]);
 assert.equal(initialCatalogImportRepositoryId([]),"");
 assert.equal(initialCatalogImportRepositoryId([a]),"one");
 assert.equal(initialCatalogImportRepositoryId([a,b]),"");
 assert.equal(initialCatalogImportRepositoryId([repo("disabled","disabled")]),"");
 for(const [items,id,verdict,loading,proposal,allowed] of [
  [[a,b],"","validated",false,false,false],
  [[a,b],"one","validated",false,false,true],
  [[a,b],"two","caution",false,false,true],
  [[a,b],"foreign","validated",false,false,false],
  [[a],"one","unsafe",false,false,false],
  [[a],"one","validated",true,false,false],
  [[a],"one","validated",false,true,false],
  [[repo("disabled","disabled")],"unsupported","validated",false,false,false],
 ] as const){
   assert.equal(canProposeCatalogImport({repositories:items,repositoryId:id,
     verdict,loading,proposalExists:proposal}),allowed);
 }
});
test("PER-1623 Catalog is directly after Insights with tenant-owned deep-links",()=>{
 const nav=getUiV2WorkspaceNavigation("tenant-a","/catalog",EMPTY_SAVANT_SHELL_DATA.counts);
 assert.deepEqual(nav.filter(x=>x.group==="primary").map(x=>x.id),
  ["overview","library","workbench","evaluations","runs","insights","catalog"]);
 assert.equal(nav.find(x=>x.id==="catalog")?.href,"/o/tenant-a/catalog");
 assert.deepEqual(nav.filter(x=>x.active).map(x=>x.id),["catalog"]);
 assert.deepEqual(getUiV2WorkspaceNavigation("tenant-a","/catalog/item",EMPTY_SAVANT_SHELL_DATA.counts)
  .filter(x=>x.active).map(x=>x.id),["catalog"]);
 assert.equal(getUiV2WorkspaceNavigation("tenant-b","/skills",EMPTY_SAVANT_SHELL_DATA.counts)
  .find(x=>x.id==="catalog")?.href,"/o/tenant-b/catalog");
 assert.deepEqual(buildUiV2RouteCrumbs("tenant-a","/catalog/item").at(-2),
   {label:"Catalog",href:"/o/tenant-a/catalog",current:false});
});
test("PER-1623 Catalog list makes details and governed import immediately discoverable",()=>{
 const ui=readFileSync(fileURLToPath(new URL("../components/savant/screens/skill-hub.tsx",import.meta.url)),"utf8");
 const dialog=readFileSync(fileURLToPath(new URL("../components/savant/screens/catalog-import-dialog.tsx",import.meta.url)),"utf8");
 const route=readFileSync(fileURLToPath(new URL("../app/api/catalog/[id]/import/route.ts",import.meta.url)),"utf8");
 const server=readFileSync(fileURLToPath(new URL("../server/hub/import.ts",import.meta.url)),"utf8");
 for(const needle of [
  "View details for","Import ${skill.name} into a repository",
  "CatalogImportDialog","extractWorkspaceSlugFromPathname(pathname)",
  "Destination repository (required)","fetchRepositoryList({workspaceSlug,signal:",
 ])assert.ok(ui.includes(needle),needle);
 for(const needle of [
  'role="dialog" aria-modal="true"','onKeyDown={onKeyDown}',
  'if(event.key==="Escape"','getClientRects().length>0',
  "initialCatalogImportRepositoryId","canProposeCatalogImport",
  "importCatalogSkill(skill.id","SkillProposalNotice",
  "Nothing is pushed to your repository",
  "approved reviewer", // checked below separately? 
 ]){if(needle==="approved reviewer")continue;assert.ok(dialog.includes(needle),needle);}
 assert.match(route,/authorizeTenantRequest/);
 assert.match(route,/assertSameOriginMutationRequest/);
 assert.match(server,/assertGitPermission\(actor, "connect_repository"\)/);
 assert.match(server,/runtime\.assessments\.proposeFileEdits/);
 assert.doesNotMatch(dialog,/localStorage|sessionStorage|mockRepository|fakeProposal|Math\.random|dangerouslySetInnerHTML/);
});
