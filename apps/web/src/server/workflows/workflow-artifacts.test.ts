import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowArtifactService, WorkflowArtifactError } from "./workflow-artifacts.ts";

const specification = () => ({
  schemaVersion: 1, workflowId: "triage", version: "1.0.0",
  source: { runtime: "external-harness" },
  nodes: [{ id: "agent", kind: "agent" }], edges: [],
  extensions: { native: { x: 7 } },
});
type TestState = { files: Map<string, { content: string; blobSha: string; commitSha: string }>; writes: number; indexes: number; audits: string[]; denied: boolean; failWrite: boolean; failIndex: boolean; provider: string };
function harness() {
  const state: TestState = { files: new Map(), writes: 0, indexes: 0, audits: [], denied: false, failWrite: false, failIndex: false, provider: "github" };
  const service = createWorkflowArtifactService({
    async repository(tenantId, repositoryId) {
      if (tenantId !== "tenant-a" || repositoryId !== "repo-a") return null;
      return { id: repositoryId, organizationId: tenantId, provider: state.provider, branch: "main" };
    },
    async authorizeWrite(actor) { if (actor !== "owner" || state.denied) throw new WorkflowArtifactError("forbidden", 403); },
    async read(_repo, path, revision) {
      const file = state.files.get(path);
      if (!file) return null;
      if (revision && revision !== file.commitSha) throw new WorkflowArtifactError("revision_not_found", 404);
      return { ...file };
    },
    async write(_repo, path, content, expectedBlobSha) {
      if (state.failWrite) throw new WorkflowArtifactError("git_unavailable", 502);
      const current = state.files.get(path);
      if (expectedBlobSha !== (current?.blobSha ?? null)) throw new WorkflowArtifactError("revision_conflict", 409);
      state.writes++;
      const file = { content, blobSha: String(state.writes).repeat(40), commitSha: String(state.writes).repeat(40) };
      state.files.set(path, file);
      return { blobSha: file.blobSha, commitSha: file.commitSha };
    },
    async recordVersion() { if (state.failIndex) throw new Error("sql unavailable"); state.indexes++; },
    async audit(data) { state.audits.push(data.action); },
  });
  return { service, state };
}
const owner = { organizationId: "tenant-a", actor: "owner" };
const read = { organizationId: "tenant-a", actor: "member" };
const repo = "repo-a";
function error(code: string) { return (e: unknown) => e instanceof WorkflowArtifactError && e.code === code; }

test("PER-1082: tenant owner saves canonical version, reads it, then repeat is idempotent", async () => {
  const { service, state } = harness();
  const saved = await service.save(owner, repo, "triage", specification(), null);
  assert.equal(saved.sourceOfTruth, "git");
  assert.equal(saved.commitSha, "1".repeat(40));
  assert.match(saved.digest, /^[a-f0-9]{64}$/);
  const loaded = await service.get(read, repo, "triage");
  assert.deepEqual(loaded.specification, specification());
  assert.equal(loaded.commitSha, saved.commitSha);
  const repeated = await service.save(owner, repo, "triage", specification(), null);
  assert.equal(repeated.commitSha, saved.commitSha);
  assert.equal(repeated.replayed, true);
  assert.equal(state.writes, 1);
  assert.equal(state.indexes, 2);
});

test("PER-1082: writer denied before Git and foreign tenant cannot read or mutate", async () => {
  const { service, state } = harness();
  await assert.rejects(service.get({ organizationId: "tenant-b", actor: "owner" }, repo, "triage"), error("repository_not_found"));
  await assert.rejects(service.save({ organizationId: "tenant-b", actor: "owner" }, repo, "triage", specification(), null), error("repository_not_found"));
  state.denied = true;
  await assert.rejects(service.save(owner, repo, "triage", specification(), null), error("forbidden"));
  assert.equal(state.writes, 0);
});

test("PER-1082: optimistic concurrency and Git errors fail without partial indexes", async () => {
  const { service, state } = harness();
  const first = await service.save(owner, repo, "triage", specification(), null);
  const updated = { ...specification(), version: "1.0.1" };
  await assert.rejects(service.save(owner, repo, "triage", updated, null), error("revision_conflict"));
  await assert.rejects(service.save(owner, repo, "triage", updated, "f".repeat(40)), error("revision_conflict"));
  state.failWrite = true;
  await assert.rejects(service.save(owner, repo, "triage", updated, first.blobSha), error("git_unavailable"));
  assert.equal(state.indexes, 1);
  state.failWrite = false;
  const next = await service.save(owner, repo, "triage", updated, first.blobSha);
  assert.equal(next.commitSha, "2".repeat(40));
  assert.equal(state.indexes, 2);
});

test("PER-1082: invalid graph, mismatched ID and unsupported provider cannot touch Git", async () => {
  const { service, state } = harness();
  await assert.rejects(service.save(owner, repo, "other", specification(), null), error("workflow_id_mismatch"));
  await assert.rejects(service.save(owner, repo, "triage", { ...specification(), schemaVersion: 99 }, null), error("invalid_workflow"));
  state.provider = "bitbucket";
  await assert.rejects(service.save(owner, repo, "triage", specification(), null), error("provider_unsupported"));
  assert.equal(state.writes, 0);
});

test("PER-1082: index outages return explicit reconcile-needed state after durable Git write", async () => {
  const { service, state } = harness();
  state.failIndex = true;
  const result = await service.save(owner, repo, "triage", specification(), null);
  assert.equal(result.indexed, false);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(state.writes, 1);
  assert.ok(state.audits.includes("workflow_saved"));
});

test("PER-1082: corrupted or mismatched repository content fails closed", async () => {
  const { service, state } = harness();
  await service.save(owner, repo, "triage", specification(), null);
  state.files.set("workflows/triage.json", { content: JSON.stringify({ ...specification(), workflowId: "other" }), blobSha: "tampered", commitSha: "commit2" });
  await assert.rejects(service.get(read, repo, "triage"), error("workflow_integrity_failed"));
});

test("PER-1082: malformed path identifiers rejected before read", async () => {
  const { service } = harness();
  await assert.rejects(service.get(read, repo, "../other"), error("workflow_id_invalid"));
  await assert.rejects(service.get(read, repo, "a/b"), error("workflow_id_invalid"));
});

test("PER-1082: replay after SQL recovery repairs the missing index without creating a second commit", async () => {
  const { service, state } = harness();
  state.failIndex = true;
  const first = await service.save(owner, repo, "triage", specification(), null);
  assert.equal(first.reconciliationRequired, true);
  state.failIndex = false;
  const second = await service.save(owner, repo, "triage", specification(), null);
  assert.equal(second.replayed, true);
  assert.equal(second.indexed, true);
  assert.equal(second.commitSha, first.commitSha);
  assert.equal(state.writes, 1);
  assert.equal(state.indexes, 1);
});

test("SAV-14: authenticated workflow read and save expose an immutable tenant-derived capability IR ref", async () => {
  const { service } = harness();
  const created = await service.save(owner, repo, "triage", specification(), null);
  assert.equal(created.capabilityProjection?.status, "ready");
  if (created.capabilityProjection?.status !== "ready") return;
  const ref = created.capabilityProjection.reference;
  assert.equal(ref.organizationId, owner.organizationId);
  assert.equal(ref.kind, "workflow_spec");
  assert.equal(ref.artifactId, "triage");
  assert.equal(ref.contentHash, "sha256:" + created.digest);
  assert.deepEqual(ref.locator, {
    source: "git", repositoryId: repo,
    path: "workflows/triage.json", commitSha: created.commitSha,
  });
  const retrieved = await service.get(read, repo, "triage");
  assert.deepEqual(retrieved.capabilityProjection, created.capabilityProjection);
  await assert.rejects(service.get({organizationId: "foreign", actor: "owner"},repo,"triage"), error("repository_not_found"));
});

test("SAV-14: pre-existing non-SemVer workflow remains accessible with truthful unavailable projection", async () => {
  const {service,state} = harness();
  const raw = { ...specification(), version: "legacy-label" };
  const saved = await service.save(owner, repo, "triage", raw, null);
  assert.deepEqual(saved.capabilityProjection, { status:"unavailable", reason:"version_invalid" });
  assert.equal(state.writes, 1);
  const existing = await service.get(read, repo, "triage");
  assert.equal(existing.specification.version, "legacy-label");
  assert.deepEqual(existing.capabilityProjection, { status:"unavailable", reason:"version_invalid" });
});
