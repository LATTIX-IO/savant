import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EMPTY_SAVANT_SHELL_DATA } from "./shell-state.ts";
import {
  buildUiV2Crumbs, buildUiV2WorkspaceSwitchPath, getUiV2Navigation,
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
