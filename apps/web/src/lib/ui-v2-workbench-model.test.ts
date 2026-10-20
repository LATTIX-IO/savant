import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildTenantScopedControlPlanePath } from "./control-plane-client.ts";
import type { SkillSourcePayload } from "@savant/types";
import {
  getWorkbenchGate, matchesWorkbenchSourceSnapshot,
  submitReviewedWorkbenchProposal, sourceRevisionLabel, workbenchChangeStats,
} from "./ui-v2-workbench-model.ts";

const source: SkillSourcePayload = {
  skillId: "internal-id", skillUuid: "uuid-id", name: "<script>label</script>",
  repository: "org/repo", repoProvider: "github", branch: "main", sourcePath: "skill/SKILL.md",
  sourceCommitSha: "abc123", contentSha: null, content: "# Original",
  mode: "repository", canSave: true, saveMode: "proposal", repositoryId: "repo-uuid"
};

test("managed repository requires a substantive, bounded draft and valid proposal capability", () => {
  assert.equal(getWorkbenchGate(source, source.content).kind, "unchanged");
  assert.equal(getWorkbenchGate(source, "# New\nBody").kind, "ready");
  assert.equal(getWorkbenchGate(source, " \n ").kind, "invalid");
  assert.equal(getWorkbenchGate(source, "x".repeat(200001)).kind, "invalid");
  assert.equal(getWorkbenchGate(null, "# Replacement").kind, "not-loaded");
});
test("legacy commits, fallback sources, unavailable connection and missing repository IDs fail closed", () => {
  for (const candidate of [
    {...source, saveMode: "commit" as const},
    {...source, saveMode: undefined},
    {...source, repositoryId: undefined},
    {...source, canSave: false},
    {...source, mode: "fallback" as const},
  ]) assert.equal(getWorkbenchGate(candidate, "# changed").kind, "read-only");
});
test("stale Git read, branch, path, tenant-scoped repository ID or content are rejected before proposal", () => {
  assert.equal(matchesWorkbenchSourceSnapshot(source, {...source}), true);
  for (const change of [
    {content:"# concurrent",sourceCommitSha:"new"},
    {branch:"other"}, {sourcePath:"other.md"}, {repositoryId:"other-tenant-repo"},
    {skillId:"other"}, {contentSha:"other-sha"}, {canSave:false},
  ]) assert.equal(matchesWorkbenchSourceSnapshot(source, {...source,...change}), false);
});
test("workbench provenance and comparison never substitute an invented source revision", () => {
  assert.equal(sourceRevisionLabel(null), "Source not verified");
  assert.equal(sourceRevisionLabel({...source, sourceCommitSha:null}), "Commit not reported");
  assert.equal(sourceRevisionLabel(source), "abc123");
  assert.deepEqual(workbenchChangeStats("a\nb","a\nb\nc"),
    {originalLines:2,proposedLines:3,changed:true});
});
test("Workbench mode buttons expose pressed states and reload protects invalid unsent drafts", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/savant/screens/workbench-v2.tsx", import.meta.url)), "utf8");
  for (const mode of ["edit", "preview", "review"]) {
    assert.ok(src.includes('aria-pressed={mode === "' + mode + '"}'));
  }
  assert.match(src, /comparison\?\.changed && !window\.confirm/);
});

test("workbench has no direct commit, fake success or unsafe HTML rendering", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/savant/screens/workbench-v2.tsx", import.meta.url)), "utf8");
  assert.match(src,/proposeFileEdits/);
  assert.match(src,/submitReviewedWorkbenchProposal/);
  assert.match(src,/const options = \{ workspaceSlug, signal: controller.signal \}/);
  assert.match(src,/proposeFileEdits[\s\S]*?\}, \{ workspaceSlug \}\)/);
  assert.match(src,/AbortController/);
  assert.match(src,/useUiV2Mode/);
  assert.doesNotMatch(src,/updateSkillSource\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|localStorage|sessionStorage|Math\.random/);
  assert.doesNotMatch(src,/approveChangeProposal\s*\(|eval\s*\(/);
});

test("proposal targets the explicit authorized workspace rather than whichever tenant is last used", () => {
  const pathA = buildTenantScopedControlPlanePath("/api/repositories/repo-a/proposals", { workspaceSlug:"tenant-a" });
  const pathB = buildTenantScopedControlPlanePath("/api/repositories/repo-b/proposals", { workspaceSlug:"tenant-b" });
  assert.equal(pathA, "/api/repositories/repo-a/proposals?workspaceSlug=tenant-a");
  assert.equal(pathB, "/api/repositories/repo-b/proposals?workspaceSlug=tenant-b");
  const client = readFileSync(fileURLToPath(new URL("./git-connections-client.ts", import.meta.url)), "utf8");
  assert.match(client, /proposeFileEdits[\s\S]*?buildTenantScopedControlPlanePath\(/);
});

test("v2 editor cannot turn a managed proposal into a direct mutation or repeat a saved result", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/savant/screens/workbench-v2.tsx", import.meta.url)), "utf8");
  assert.match(src, /submitReviewedWorkbenchProposal/);
  assert.match(src, /getWorkbenchGate\(sourceData, editorText\)/);
  assert.match(src, /pending \|\| savingRef\.current/);
  assert.match(src, /reviewed\.text === editorText/);
  assert.match(src, /outcome\.status/);
  assert.match(src, /Source was not committed or merged/);
  assert.match(src, /currentSource\.phase === "ready"/);
});

test("actual proposal transaction never posts when source has become stale", async () => {
  let submissions = 0;
  const outcome = await submitReviewedWorkbenchProposal({
    source, draft:"# edit", isCurrent:() => true,
    readCurrentSource:async () => ({...source, content:"# remote edit"}),
    createProposal:async () => { submissions++; return {id:"fake",status:"pending_approval"}; },
  });
  assert.deepEqual(outcome.kind, "blocked");
  assert.equal(submissions, 0);
});

test("navigation or tenant switch cancels in-flight transaction before mutation", async () => {
  let active = true;
  let submissions = 0;
  const outcome = await submitReviewedWorkbenchProposal({
    source, draft:"# edit", isCurrent:() => active,
    readCurrentSource:async () => {active=false;return {...source};},
    createProposal:async () => {submissions++;return {id:"fake",status:"pending_approval"};},
  });
  assert.equal(outcome.kind, "blocked");
  assert.equal(submissions, 0);
});

test("source without proposal capability does not even attempt a fresh read", async () => {
  let reads = 0;
  const outcome = await submitReviewedWorkbenchProposal({
    source:{...source, saveMode:"commit"}, draft:"# edit", isCurrent:() => true,
    readCurrentSource:async () => {reads++;return {...source};},
    createProposal:async () => {throw Error("must not call");},
  });
  assert.equal(outcome.kind, "blocked");
  assert.equal(reads, 0);
});

test("eligible reviewed change submits exactly one server-side proposal, never a Git commit", async () => {
  let submissions = 0;
  let input: unknown;
  const outcome = await submitReviewedWorkbenchProposal({
    source, draft:"# Revised", isCurrent:() => true,
    readCurrentSource:async () => ({...source}),
    createProposal:async value => {
      input = value;
      submissions++;
      return {id:"proposal-1",status:"pending_approval"};
    },
  });
  assert.deepEqual(outcome,{kind:"created",proposalId:"proposal-1",status:"pending_approval"});
  assert.deepEqual(input,{repositoryId:"repo-uuid",name:"<script>label</script>",
    path:"skill/SKILL.md",content:"# Revised"});
  assert.equal(submissions,1);
});
