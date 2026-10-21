import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EMPTY_SAVANT_SHELL_DATA } from "./shell-state.ts";
import {
  buildUiV2Crumbs, buildUiV2RouteCrumbs, buildUiV2WorkspaceSwitchPath,
  getUiV2Navigation, getUiV2WorkspaceNavigation, resolveUiV2Route,
  isUiV2EnabledForWorkspace, UI_V2_NAV_GROUPS,
} from "./ui-v2-shell-model.ts";

test("opt-in rollout denies by default, whitespace aliases and unauthorized workspaces", () => {
  assert.equal(isUiV2EnabledForWorkspace("alpha", {}), false);
  assert.equal(isUiV2EnabledForWorkspace("alpha", {enabled:"false",workspaces:"*"}), false);
  assert.equal(isUiV2EnabledForWorkspace("alpha", {enabled:"TRUE",workspaces:"*"}), false);
  assert.equal(isUiV2EnabledForWorkspace("alpha", {enabled:"true",workspaces:"alph"}), false);
  assert.equal(isUiV2EnabledForWorkspace("alpha", {enabled:"true",workspaces:"alph, beta"}), false);
  assert.equal(isUiV2EnabledForWorkspace("alpha", {enabled:"true",workspaces:"beta, alpha"}), true);
  assert.equal(isUiV2EnabledForWorkspace("alpha", {enabled:"true",workspaces:"*"}), true);
  assert.equal(isUiV2EnabledForWorkspace("", {enabled:"true",workspaces:"*"}), false);
});

test("every existing production destination remains reachable via authorized workspace links", () => {
  const nav = getUiV2Navigation("team alpha", "/skills/skill-123", EMPTY_SAVANT_SHELL_DATA.counts, true);
  assert.deepEqual(nav.map(n => n.id), [
    "overview","skills","repositories","catalog","evaluations","intelligence",
    "releases","router","connectors","policies","audit","settings"
  ]);
  for (const n of nav) {
    assert.match(n.href, /^\/o\/team%20alpha\//);
    assert.equal(n.count, null, "unknown metrics must not be fabricated");
  }
  assert.equal(nav.find(n => n.id === "skills")?.active, true);
  assert.equal(nav.find(n => n.id === "repositories")?.active, false);
  assert.equal(Object.values(UI_V2_NAV_GROUPS).includes("Governance"), true);
});

test("production governance gating preserves existing restricted feature visibility", () => {
  const nav = getUiV2Navigation("tenant", "/audit", EMPTY_SAVANT_SHELL_DATA.counts, false);
  assert.equal(nav.some(n => ["audit","policies","connectors"].includes(n.id)), false);
  assert.equal(nav.some(n => n.id === "settings"), true);
  assert.equal(nav.some(n => n.id === "router"), true);
});

test("navigation uses only server-provided counts; zero remains zero", () => {
  const counts = {...EMPTY_SAVANT_SHELL_DATA.counts, skills: 0, evaluations: 7};
  const nav = getUiV2Navigation("ws", "/evaluations/EV-2418", counts, false);
  assert.equal(nav.find(n => n.id === "skills")?.count, 0);
  assert.equal(nav.find(n => n.id === "evaluations")?.count, 7);
  assert.equal(nav.find(n => n.id === "evaluations")?.active, true);
});

test("switching workspaces preserves only safe collection routes, never resource ID, query or a hostile URL", () => {
  assert.equal(buildUiV2WorkspaceSwitchPath("other ws","/skills"),"/o/other%20ws/skills");
  for(const unsafe of ["/skills/private-id","/evaluations/secret-uuid","/skills?private=1","//host","/../admin","/not-real"]){
    assert.equal(buildUiV2WorkspaceSwitchPath("other",unsafe),"/o/other/dashboard");
  }
  assert.equal(buildUiV2WorkspaceSwitchPath("other","/settings"),"/o/other/settings");
});

test("breadcrumb links stay in the current tenant, names remain plain text", () => {
  assert.deepEqual(buildUiV2Crumbs("mine",[
    ["Workspace",null],["Skills","/skills"],["<unsafe>","current"]
  ]),[
    {label:"Workspace",href:null,current:false},
    {label:"Skills",href:"/o/mine/skills",current:false},
    {label:"<unsafe>",href:null,current:true},
  ]);
});

test("rollout remains server-owned and the new client shell cannot grant entitlements", () => {
  const layout=readFileSync(fileURLToPath(new URL("../app/o/[workspaceSlug]/layout.tsx",import.meta.url)),"utf8");
  const shell=readFileSync(fileURLToPath(new URL("../components/savant/app-shell-v2.tsx",import.meta.url)),"utf8");
  assert.ok(layout.indexOf("await resolveTenantMembershipForUser(") < layout.indexOf("const useV2 = isUiV2EnabledForWorkspace("), "membership must be checked before rollout");
  assert.doesNotMatch(shell,/process\.env|localStorage|sessionStorage|dangerouslySetInnerHTML|\.innerHTML\s*=/);
  assert.match(shell,/isGovernanceFeatureEnabled/);
  assert.doesNotMatch(shell, /href=\{[^}]*(?:user|input)/i);
});

test("UX-02 canonical navigation is backed by existing tenant page files, never prototype-only routes", () => {
  const routes = getUiV2Navigation("workspace", "/dashboard", EMPTY_SAVANT_SHELL_DATA.counts, true);
  for (const route of routes) {
    const appPath = route.href.slice("/o/workspace".length);
    assert.equal(resolveUiV2Route(appPath).kind, "collection", route.id);
    const file = fileURLToPath(new URL("../app/o/[workspaceSlug]" + appPath + "/page.tsx", import.meta.url));
    assert.equal(existsSync(file), true, route.id + " must resolve to an implemented Next.js page");
  }
  assert.deepEqual(["/skills/[id]", "/evaluations/[uuid]", "/catalog/[id]"].map(path => {
    const file = fileURLToPath(new URL("../app/o/[workspaceSlug]" + path + "/page.tsx", import.meta.url));
    return existsSync(file);
  }), [true,true,true]);
  assert.equal(routes.some(route => route.href.endsWith("/runs") ||
    route.href.endsWith("/workflows") || route.href.endsWith("/discovery")), false);
});

test("UX-02 detail routes remain associated with their parent destination and preserve server-owned IDs", () => {
  for (const [url,navId,id] of [
    ["/skills/skill-123", "skills", "skill-123"],
    ["/evaluations/123e4567-e89b-12d3-a456-426614174000", "evaluations", "123e4567-e89b-12d3-a456-426614174000"],
    ["/catalog/portable-tool", "catalog", "portable-tool"],
  ] as const) {
    assert.deepEqual(resolveUiV2Route(url), {kind:"detail",navId,appPath:url,resourceId:id});
    const items=getUiV2Navigation("authorized",url,EMPTY_SAVANT_SHELL_DATA.counts,false);
    assert.deepEqual(items.filter(item=>item.active).map(item=>item.id),[navId]);
    assert.equal(buildUiV2WorkspaceSwitchPath("other",url),"/o/other/dashboard");
  }
  assert.equal(resolveUiV2Route("/").navId, "overview");
  assert.equal(buildUiV2WorkspaceSwitchPath("other","/"),"/o/other/dashboard");
});

test("UX-02 unknown and hostile tenant paths never spoof an active section or redirect breadcrumbs", () => {
  for(const path of [
    "/skills/a/b", "/evaluations/a/edit", "/catalog/../audit", "/skills/.",
    "/skills/..", "/skills/%2e%2e", "/skills/%2Fsecret", "/skills/a%00b",
    "/skills/one?tab=private", "/settings#secret", "/settings/../skills",
    "//evil.test/x", "https://evil.test/skills", "/\\evil.test/skills",
    "/workflows", "/discovery", "/reports", "/not-real",
  ]) {
    assert.equal(resolveUiV2Route(path).kind, "unavailable", path);
    assert.equal(getUiV2Navigation("a",path,EMPTY_SAVANT_SHELL_DATA.counts,true)
      .some(item=>item.active),false,path);
    assert.equal(buildUiV2WorkspaceSwitchPath("b",path),"/o/b/dashboard",path);
    assert.deepEqual(buildUiV2RouteCrumbs("a",path),[
      {label:"Workspace",href:null,current:false},
      {label:"Page unavailable",href:null,current:true},
    ]);
  }
  assert.deepEqual(buildUiV2Crumbs("mine",[
    ["Workspace",null],["untrusted","//other.example/evil" as never],["bad-query","/skills?foreign=1" as never],
  ]).map(x=>x.href),[null,null,null]);
});

test("UX-02 detail breadcrumbs remain tenant-owned and never mislabel marketplace as Overview", () => {
  assert.deepEqual(buildUiV2RouteCrumbs("org-a","/catalog/demo"),[
    {label:"Workspace",href:null,current:false},
    {label:"Marketplace",href:"/o/org-a/catalog",current:false},
    {label:"Skill",href:null,current:true},
  ]);
  assert.deepEqual(buildUiV2RouteCrumbs("org-a","/skills/skill-id",{skillTitle:"Verified skill"}),[
    {label:"Workspace",href:null,current:false},
    {label:"Skills",href:"/o/org-a/skills",current:false},
    {label:"Verified skill",href:null,current:true},
  ]);
  const evalCrumbs=buildUiV2RouteCrumbs("org-b","/evaluations/uuid-1");
  assert.equal(evalCrumbs[1]?.href,"/o/org-b/evaluations");
  assert.equal(evalCrumbs[2]?.label,"uuid-1");
});

test("UX-02 route changes restore content focus, with keyboard-closable workspace switch and no authority client-side",()=>{
  const source=readFileSync(fileURLToPath(new URL("../components/savant/app-shell-v2.tsx",import.meta.url)),"utf8");
  assert.match(source,/buildUiV2RouteCrumbs/);
  assert.match(source,/mainRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source,/previousLocation\.current/);
  assert.match(source,/event\.key === "Escape"/);
  assert.match(source,/aria-current=\{it\.active \? "page" : undefined\}/);
  assert.doesNotMatch(source,/router\.push\(|history\.replaceState\(|dangerouslySetInnerHTML|sessionStorage|localStorage/);
});

test("F1 reference IA has six primary workspaces, two admin areas and no invented route", () => {
  const list = getUiV2WorkspaceNavigation("tenant one", "/skills", EMPTY_SAVANT_SHELL_DATA.counts);
  assert.deepEqual(list.filter(x => x.group === "primary").map(x => x.label),
    ["Overview","Library","Workbench","Evaluations","Runs","Insights"]);
  assert.deepEqual(list.filter(x => x.group === "admin").map(x => x.label),
    ["Integrations","Settings"]);
  assert.equal(list.find(x => x.id === "workbench")?.picker, "workbench");
  assert.equal(list.find(x => x.id === "runs")?.picker, null);
  assert.equal(list.find(x => x.id === "runs")?.href, "/o/tenant%20one/runs");
  for (const item of list) {
    if (item.href) {
      assert.match(item.href, /^\/o\/tenant%20one\//);
      assert.equal(resolveUiV2Route(item.href.replace(/^\/o\/tenant%20one/, "")).kind, "collection");
    } else {
      assert.equal(item.picker, "workbench");
    }
  }
});
test("F1 active state reflects detail modes and preserves legacy contextual admin routes", () => {
  for (const [path, id] of [
    ["/skills", "library"], ["/repositories", "library"], ["/catalog/example", "library"],
    ["/skills/source-id", "workbench"], ["/evaluations", "evaluations"], ["/runs","runs"],
    ["/evaluations/run-id", "runs"], ["/releases", "insights"],
    ["/connectors", "integrations"], ["/policies", "settings"],
  ] as const) {
    const items = getUiV2WorkspaceNavigation("org", path, EMPTY_SAVANT_SHELL_DATA.counts);
    assert.deepEqual(items.filter(x => x.active).map(x => x.id), [id], path);
  }
  for (const invalid of ["/runs/run-private", "/workflows/unknown", "//evil", "/skills/%2e%2e"]) {
    assert.equal(getUiV2WorkspaceNavigation("org", invalid, EMPTY_SAVANT_SHELL_DATA.counts)
      .filter(x => x.active).length, 0);
  }
  const counts = { ...EMPTY_SAVANT_SHELL_DATA.counts, skills: 0, evaluations: 3 };
  assert.equal(getUiV2WorkspaceNavigation("org","/skills",counts).find(x=>x.id==="library")?.count,0);
  assert.equal(getUiV2WorkspaceNavigation("org","/evaluations",counts).find(x=>x.id==="evaluations")?.count,3);
});
test("F1 keyboard palette may show only real navigable, tenant-owned URLs and does not create mock runs", () => {
  const source = readFileSync(fileURLToPath(new URL("../components/savant/savant-command-palette.tsx", import.meta.url)), "utf8");
  assert.match(source, /fetchSkillList/);
  assert.match(source, /fetchEvaluationDashboard/);
  assert.match(source, /buildTenantAppPath/);
  assert.match(source, /getUiV2Navigation/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|dangerouslySetInnerHTML|\.innerHTML\s*=|fake|mockRun|window\.location/);
});

test("UX-04 Runs path is real, tenant-owned and preserves hostile path denial", () => {
  assert.equal(resolveUiV2Route("/runs").kind,"collection");
  assert.equal(buildUiV2WorkspaceSwitchPath("tenant-b","/runs"),"/o/tenant-b/runs");
  assert.deepEqual(getUiV2WorkspaceNavigation("mine","/runs",EMPTY_SAVANT_SHELL_DATA.counts)
    .filter(x=>x.active).map(x=>x.id),["runs"]);
  for(const unsafe of ["/runs/private-id", "/runs/../skills", "/runs?run=foreign",
    "/runs%2fother", "//evil/runs"]) {
    assert.equal(resolveUiV2Route(unsafe).kind,"unavailable",unsafe);
    assert.equal(buildUiV2WorkspaceSwitchPath("other",unsafe),"/o/other/dashboard");
  }
  assert.equal(existsSync(fileURLToPath(new URL("../app/o/[workspaceSlug]/runs/page.tsx",
    import.meta.url))),true);
  assert.deepEqual(buildUiV2RouteCrumbs("mine","/runs"),[
    {label:"Workspace",href:null,current:false},{label:"Runs",href:null,current:true},
  ]);
});

test("PER-1609 workflows preserve the six-workspace shell and tenant-owned deep links",()=>{
  assert.equal(resolveUiV2Route("/workflows").kind,"collection");
  assert.equal(resolveUiV2Route("/workflows/unknown").kind,"unavailable");
  assert.equal(buildUiV2WorkspaceSwitchPath("org-b","/workflows"),"/o/org-b/workflows");
  const nav=getUiV2WorkspaceNavigation("org-a","/workflows",EMPTY_SAVANT_SHELL_DATA.counts);
  assert.deepEqual(nav.filter(item=>item.active).map(item=>item.id),["workbench"]);
  assert.equal(nav.filter(item=>item.group==="primary").length,6);
  const crumbs=buildUiV2RouteCrumbs("org-a","/workflows");
  assert.equal(crumbs.at(-1)?.label,"Workflows");
  assert.equal(crumbs.at(-1)?.current,true);
});
