import assert from "node:assert/strict";
import test from "node:test";

import { GitProviderError } from "../git/errors.ts";
import { syncRepository } from "../git/repository-sync-service.ts";
import { createFakeGitProvider, makeRepository, SAMPLE_TOKENS, VALID_SKILL_FILES } from "../git/testing/fixtures.ts";
import { createGitTestHarness, ORG_A, ORG_B } from "../git/testing/harness.ts";
import { createAssessmentService } from "./service.ts";
import { createMemoryAssessmentStore } from "./store.ts";

const REPO = makeRepository({ id: "901", owner: "LATTIX-IO", name: "lattix-skills" });
const AGENTS = "tier2/methodology/legal/contract-review-assistant/agents/reviewer.md";

function setup(files: Record<string, string> = { ...VALID_SKILL_FILES }) {
  const fake = createFakeGitProvider({ repositories: [{ repository: REPO, files, readableBy: [SAMPLE_TOKENS.valid] }] });
  const harness = createGitTestHarness({ providers: [fake.provider] });
  const connection = harness.seedConnection({ organizationId: ORG_A, provider: "github", authType: "github_app_installation", providerInstallationId: "777" });
  const repository = harness.seedRepository({ organizationId: ORG_A, owner: "LATTIX-IO", name: "lattix-skills", providerConnectionId: connection.id, providerRepositoryId: "901" });
  const store = createMemoryAssessmentStore();
  const service = createAssessmentService({ store, git: harness.stores, broker: harness.broker });
  const sync = () => syncRepository({
    connections: harness.stores.connections,
    repositories: harness.stores.repositories,
    broker: harness.broker,
    audit: harness.stores.audit,
    writer: harness.writer,
    afterCommit: (commit) => service.recordAssessment({ ...commit, observedPaths: commit.snapshot.observedPaths, files: commit.snapshot.files }),
  }, { organizationId: ORG_A, repositoryId: repository.id, actor: { type: "system", ref: "test" }, trigger: "manual" });
  return { ...fake, harness, store, service, repository, sync, admin: harness.actor(ORG_A), manager: harness.actor(ORG_A, "repository_manager", "auth0|mgr"), member: harness.actor(ORG_A, "member", "auth0|member") };
}

function dropAgents(files: Record<string, string>) {
  const copy = { ...files };
  delete copy[AGENTS];
  return copy;
}

test("every sync runs the assessment and returns its summary with the sync result", async () => {
  const { sync, service, admin, repository } = setup(dropAgents(VALID_SKILL_FILES));
  const result = await sync();

  assert.ok(result.assessment);
  assert.equal(result.assessment.skillsSkipped, 1);
  assert.ok(result.assessment.blockers >= 1);
  const { assessment } = await service.getRepositoryAssessment(admin, repository.id);
  const missing = assessment?.findings.find((finding) => finding.code === "SKILL_FILE_MISSING");
  assert.equal(missing?.path, "tier2/methodology/legal/contract-review-assistant/agents/");
  assert.equal(missing?.status, "open");
});

test("an assessment failure never fails the sync", async () => {
  const { harness, repository } = setup();
  const result = await syncRepository({
    connections: harness.stores.connections,
    repositories: harness.stores.repositories,
    broker: harness.broker,
    audit: harness.stores.audit,
    writer: harness.writer,
    afterCommit: async () => {
      throw new Error("assessment store unavailable");
    },
  }, { organizationId: ORG_A, repositoryId: repository.id, actor: { type: "system", ref: "test" }, trigger: "manual" });
  assert.equal(result.skillCount, 1);
  assert.equal(result.assessment, null);
});

test("fix → proposal → approval opens a pull request on a new branch; nothing is written before approval", async () => {
  const { sync, service, admin, manager, member, repository, controls } = setup(dropAgents(VALID_SKILL_FILES));
  await sync();
  const { assessment } = await service.getRepositoryAssessment(admin, repository.id);
  const fixable = assessment!.findings.filter((finding) => finding.fix && finding.code === "SKILL_FILE_MISSING");

  const proposal = await service.proposeFixes(manager, repository.id, fixable.map((finding) => finding.fingerprint));
  assert.equal(proposal.status, "pending_approval");
  assert.deepEqual(proposal.files.map((file) => file.path), ["tier2/methodology/legal/contract-review-assistant/agents/openai.yaml"]);
  assert.equal(controls.changeRequests.length, 0, "no write before approval");

  // Findings covered by a pending proposal are marked, so they aren't proposed twice.
  const pending = await service.getRepositoryAssessment(admin, repository.id);
  assert.equal(pending.assessment?.findings.find((finding) => finding.fingerprint === fixable[0]?.fingerprint)?.status, "proposed");

  await assert.rejects(() => service.approveProposal(member, proposal.id), (error: unknown) => error instanceof GitProviderError && error.code === "PERMISSION_DENIED");

  const opened = await service.approveProposal(manager, proposal.id);
  assert.equal(opened.status, "pr_open");
  assert.equal(opened.pullRequestNumber, 1);
  assert.match(opened.pullRequestUrl ?? "", /pull\/1$/);
  assert.equal(controls.changeRequests[0]?.baseBranch, "main");
  assert.match(controls.changeRequests[0]?.headBranch ?? "", /^savant\//);
  assert.equal(controls.changeRequests[0]?.files[0]?.path, "tier2/methodology/legal/contract-review-assistant/agents/openai.yaml");

  await assert.rejects(() => service.approveProposal(manager, proposal.id), (error: unknown) => error instanceof GitProviderError && error.status === 409);
  assert.equal(controls.changeRequests.length, 1, "approving twice doesn't open a second PR");

  // Merging the PR on the provider is picked up on the next sync.
  controls.changeRequests[0]!.state = "merged";
  controls.repositories[0]!.files[AGENTS] = "# Reviewer\n";
  const after = await sync();
  assert.equal(after.assessment?.skillsSkipped, 0);
  const [refreshed] = (await service.getRepositoryAssessment(admin, repository.id)).proposals;
  assert.equal(refreshed?.status, "merged");
});

test("approval refuses to overwrite changes made after the proposal", async () => {
  const files = { ...VALID_SKILL_FILES, "tier2/methodology/legal/contract-review-assistant/metadata.yaml": "skill_id: \"legal/contract-review-assistant\"\ntier: tier2\n" };
  const { sync, service, admin, repository, controls } = setup(files);
  await sync();
  const finding = (await service.getRepositoryAssessment(admin, repository.id)).assessment!.findings.find((entry) => entry.code === "METADATA_FIELDS_MISSING");
  const proposal = await service.proposeFixes(admin, repository.id, [finding!.fingerprint]);
  assert.equal(proposal.files[0]?.action, "update");

  controls.repositories[0]!.files["tier2/methodology/legal/contract-review-assistant/metadata.yaml"] = "skill_id: \"legal/contract-review-assistant\"\ntier: tier2\nowner: someone-else\n";
  await assert.rejects(() => service.approveProposal(admin, proposal.id), /changed in main after this proposal/);
  assert.equal(controls.changeRequests.length, 0);
  assert.equal((await service.getProposal(admin, proposal.id)).status, "failed");
});

test("without write permission the proposal fails with remediation and can be retried once granted", async () => {
  const { sync, service, admin, repository, controls } = setup(dropAgents(VALID_SKILL_FILES));
  await sync();
  const finding = (await service.getRepositoryAssessment(admin, repository.id)).assessment!.findings.find((entry) => entry.code === "SKILL_FILE_MISSING");
  const proposal = await service.proposeFixes(admin, repository.id, [finding!.fingerprint]);

  controls.writeGranted = false;
  await assert.rejects(() => service.approveProposal(admin, proposal.id), (error: unknown) => error instanceof GitProviderError && error.code === "INSUFFICIENT_SCOPE");
  assert.equal((await service.getProposal(admin, proposal.id)).status, "failed");

  controls.writeGranted = true;
  assert.equal((await service.approveProposal(admin, proposal.id)).status, "pr_open");
});

test("explicit edits (e.g. SKILL.md from the editor) go through the same proposal and PR flow", async () => {
  const { sync, service, admin, repository, controls } = setup();
  await sync();
  const path = "tier2/methodology/legal/contract-review-assistant/SKILL.md";
  const proposal = await service.proposeFileEdits(admin, repository.id, { title: "Tighten review instructions", files: [{ path, content: "# Contract Review Assistant\n\nBetter guidance.\n" }] });
  assert.equal(proposal.files[0]?.action, "update");
  assert.equal(proposal.files[0]?.previousContent, VALID_SKILL_FILES[path]);

  await assert.rejects(() => service.proposeFileEdits(admin, repository.id, { title: "x", files: [{ path: "../etc/passwd", content: "x" }] }), /Invalid file path/);
  await assert.rejects(() => service.proposeFileEdits(admin, repository.id, { title: "x", files: [{ path, content: VALID_SKILL_FILES[path] as string }] }), /already in the repository/);

  await service.approveProposal(admin, proposal.id);
  assert.equal(controls.changeRequests[0]?.title, "Tighten review instructions");
});

test("dismissed findings stay dismissed across syncs and rejected proposals free their findings", async () => {
  const { sync, service, admin, repository } = setup(dropAgents(VALID_SKILL_FILES));
  await sync();
  const [finding] = (await service.getRepositoryAssessment(admin, repository.id)).assessment!.findings;
  await service.setFindingDismissed(admin, repository.id, finding!.fingerprint, true, "tracked elsewhere");
  await sync();
  assert.equal((await service.getRepositoryAssessment(admin, repository.id)).assessment?.findings.find((entry) => entry.fingerprint === finding!.fingerprint)?.status, "dismissed");

  const fix = (await service.getRepositoryAssessment(admin, repository.id)).assessment!.findings.find((entry) => entry.code === "SKILL_FILE_MISSING")!;
  const proposal = await service.proposeFixes(admin, repository.id, [fix.fingerprint]);
  await service.rejectProposal(admin, proposal.id);
  assert.equal((await service.getRepositoryAssessment(admin, repository.id)).assessment?.findings.find((entry) => entry.fingerprint === fix.fingerprint)?.status, "open");
});

test("another organization cannot read, propose on, or approve this repository's changes", async () => {
  const { sync, service, admin, repository, harness } = setup(dropAgents(VALID_SKILL_FILES));
  await sync();
  const fix = (await service.getRepositoryAssessment(admin, repository.id)).assessment!.findings.find((entry) => entry.fix)!;
  const proposal = await service.proposeFixes(admin, repository.id, [fix.fingerprint]);
  const outsider = harness.actor(ORG_B);

  await assert.rejects(() => service.getRepositoryAssessment(outsider, repository.id), /not found/);
  await assert.rejects(() => service.proposeFixes(outsider, repository.id, [fix.fingerprint]), /not found/);
  await assert.rejects(() => service.approveProposal(outsider, proposal.id), /not found/);
  await assert.rejects(() => service.setFindingDismissed(outsider, repository.id, fix.fingerprint, true), /not found/);
});
