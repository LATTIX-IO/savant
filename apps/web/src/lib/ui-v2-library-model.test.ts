import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OverviewPayload, RepositoryListItem, SkillListItem } from "@savant/types";
import { buildTenantScopedControlPlanePath } from "./control-plane-client.ts";

import {
  filterUiV2Repositories, filterUiV2Skills, getUiV2Kpi, getUiV2RepositoryHealth,
  safeUiV2Count, uiV2ProvenanceNote,
} from "./ui-v2-library-model.ts";

const baseSkill = {
  id: "server-id", skillUuid: "skill-123", name: "<script>Attack</script>", description: "Index policy",
  owner: "Owner", team: "Platform", repo: "repo-a", channel: "production", status: "active",
} as SkillListItem;

const baseRepository = {
  id: "repo-1", name: "secure-repo", provider: "github", branch: "main",
  status: "ok", projection: { indexedAt: null, lastSuccessfulSyncAt: null, lastWebhookAt: null },
} as RepositoryListItem;

test("filtering handles names, owners, repositories and status without modifying source", () => {
  const a = baseSkill;
  const b = { ...a, id: "second", skillUuid: "skill-456", name: "Parser", channel: "draft", status: "candidate-review" };
  const originals = [a, b];
  assert.deepEqual(filterUiV2Skills(originals, "  platform ", "all"), originals);
  assert.deepEqual(filterUiV2Skills(originals, "PARSer", "draft"), [b]);
  assert.deepEqual(filterUiV2Skills(originals, "repo-a", "candidate"), [b]);
  assert.deepEqual(filterUiV2Skills(originals, "no such record", "all"), []);
  assert.equal(originals.length, 2);
});

test("repository list is filtered without modifying tenant source data", () => {
  const items = [baseRepository, { ...baseRepository, id: "repo-2", name: "other", branch: "release" }];
  assert.deepEqual(filterUiV2Repositories(items, " GITHUB "), items);
  assert.deepEqual(filterUiV2Repositories(items, "release"), [items[1]]);
  assert.equal(items[0]?.name, "secure-repo");
});

test("a connected but never-indexed repository cannot be shown as ready", () => {
  assert.equal(getUiV2RepositoryHealth(baseRepository), "not-indexed");
  assert.equal(uiV2ProvenanceNote(baseRepository), "Not indexed");
  assert.equal(getUiV2RepositoryHealth({ ...baseRepository, syncState: "ready" }), "not-indexed");
  assert.equal(getUiV2RepositoryHealth({ ...baseRepository, syncState: "indexing" }), "indexing");
  assert.equal(getUiV2RepositoryHealth({ ...baseRepository, syncState: "auth_required" }), "action-required");
  assert.equal(getUiV2RepositoryHealth({ ...baseRepository, syncState: "access_revoked" }), "action-required");
  assert.equal(getUiV2RepositoryHealth({ ...baseRepository, status: "warn" }), "action-required");
  assert.equal(getUiV2RepositoryHealth({
    ...baseRepository, syncState: "ready",
    projection: { ...baseRepository.projection, indexedAt: "2026-10-13T00:00:00Z" }
  }), "ready");
});

test("missing KPI is not made up as success or zero", () => {
  const overview = { counts: {skillsUnderGovernance: 8}, kpis: [{
    key: "eval-coverage", value: 82, unit: "%", label: "Coverage",
    deltaLabel: "Based on live evaluations", trend: "flat",
  }] } as OverviewPayload;
  assert.equal(getUiV2Kpi(overview, "skills-in-production"), null);
  assert.equal(getUiV2Kpi(overview, "eval-coverage")?.value, 82);
  assert.equal(getUiV2Kpi({ ...overview, kpis: [{ ...overview.kpis[0], value: NaN }] } as OverviewPayload, "eval-coverage"), null);
  assert.equal(getUiV2Kpi({ ...overview, counts: {skillsUnderGovernance: 0} } as OverviewPayload, "eval-coverage"), null);
  const noReviews = { ...overview, kpis: [{ key: "first-pass-acceptance", value: 0, deltaLabel: "0 completed reviews" }] } as OverviewPayload;
  assert.equal(getUiV2Kpi(noReviews, "first-pass-acceptance"), null);
  const noReleases = { ...overview, kpis: [{ key: "release-turnaround", value: 0, deltaLabel: "0 completed releases" }] } as OverviewPayload;
  assert.equal(getUiV2Kpi(noReleases, "release-turnaround"), null);
});

test("unknown counts never become zero, negative or infinite metrics", () => {
  for (const v of [null, undefined, NaN, Infinity, -1, 1.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(safeUiV2Count(v), null);
  }
  assert.equal(safeUiV2Count(0), 0);
  assert.equal(safeUiV2Count(45), 45);
});

test("production screen wiring is scoped to authorized server shell, not client storage", () => {
  const root = new URL("../components/savant/", import.meta.url);
  const overview = readFileSync(fileURLToPath(new URL("screens/overview-v2.tsx", root)), "utf8");
  const library = readFileSync(fileURLToPath(new URL("screens/library-v2.tsx", root)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("app-shell-v2.tsx", root)), "utf8");
  const mode = readFileSync(fileURLToPath(new URL("ui-v2/mode.tsx", root)), "utf8");
  assert.match(shell, /<UiV2ModeProvider workspaceSlug=\{workspace.slug\}>/);
  assert.match(mode, /createContext<UiV2Context>\(\{ enabled: false, workspaceSlug: null \}\)/);
  assert.match(library, /fetchSkillList/);
  assert.match(library, /fetchRepositoryList/);
  assert.match(library, /workspaceSlug: scope/);
  assert.match(library, /AbortController/);
  for (const source of [overview, library]) {
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML\s*=|localStorage|sessionStorage|Math\.random|fixture/i);
  }
});

test("tenant-scoped live API paths carry explicit workspace selector, not the browser's current page", () => {
  const a = buildTenantScopedControlPlanePath("/api/skills", { workspaceSlug: "ws alpha" });
  const b = buildTenantScopedControlPlanePath("/api/repositories", { workspaceSlug: "ws beta" });
  assert.equal(a, "/api/skills?workspaceSlug=ws+alpha");
  assert.equal(b, "/api/repositories?workspaceSlug=ws+beta");
  assert.ok(!a.includes("ws+beta"));
  assert.ok(!b.includes("ws+alpha"));
});
