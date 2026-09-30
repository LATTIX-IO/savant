import type { AssessmentFinding, AssessmentSummary, ChangeProposal, ChangeProposalFile, RepositoryAssessment } from "@savant/types";

import { assertGitPermission, type GitActor } from "../git/access-control.ts";
import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import type { GitCredentialBroker } from "../git/credential-broker.ts";
import { GitProviderError, providerLabel } from "../git/errors.ts";
import { logGitEvent } from "../git/redaction.ts";
import { readRepositorySnapshot } from "../git/repository-reader.ts";
import { toLocator } from "../git/repository-sync-service.ts";
import type { GitStores } from "../git/stores.ts";
import type { ProviderRuntimeContext } from "../git/types.ts";
import { assessRepositorySnapshot } from "./assess.ts";
import { buildFixChanges, FixGenerationError } from "./fixes.ts";
import type { AssessmentStore } from "./store.ts";

/**
 * Assessments run after every successful sync; their findings are what the
 * user sees as "next steps". Fixes become change proposals that write nothing
 * until a Savant admin or repository manager approves — and approval opens a
 * pull request on a new branch, so repository protection and review still apply.
 */

const MAX_PROPOSAL_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;

export type AssessmentServiceDeps = {
  store: AssessmentStore;
  git: GitStores;
  broker: GitCredentialBroker;
  context?: ProviderRuntimeContext | undefined;
};

function withStatuses(findings: AssessmentFinding[], dismissed: Set<string>, proposed: Set<string>): AssessmentFinding[] {
  return findings.map((finding) => ({
    ...finding,
    status: dismissed.has(finding.fingerprint) ? "dismissed" : proposed.has(finding.fingerprint) ? "proposed" : "open",
  }));
}

export function describeAssessmentSummary(summary: AssessmentSummary): string {
  if (summary.blockers === 0 && summary.warnings === 0) {
    return `Assessment score ${summary.score}/100 — no issues found.`;
  }
  const parts = [
    summary.blockers ? `${summary.blockers} blocker${summary.blockers === 1 ? "" : "s"}` : null,
    summary.warnings ? `${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const skipped = summary.skillsSkipped ? ` ${summary.skillsSkipped} skill${summary.skillsSkipped === 1 ? " was" : "s were"} not imported.` : "";
  const fixable = summary.fixable ? ` ${summary.fixable} can be fixed automatically.` : "";
  return `Assessment score ${summary.score}/100 — ${parts.join(", ")}.${skipped}${fixable}`;
}

export function createAssessmentService(deps: AssessmentServiceDeps) {
  const { store, git, broker } = deps;

  async function requireRepository(organizationId: string, repositoryId: string) {
    const repository = await git.repositories.getRepository(organizationId, repositoryId);
    if (!repository) {
      throw new GitProviderError("REPOSITORY_NOT_FOUND", "The repository was not found in this workspace.", { status: 404 });
    }
    return repository;
  }

  async function audit(actor: { organizationId: string; subject: string }, action: string, repositoryId: string, payload: Record<string, unknown>) {
    await git.audit.record({
      organizationId: actor.organizationId,
      actorType: "user",
      actorRef: actor.subject,
      action,
      targetType: "repository",
      targetRef: repositoryId,
      payload: { repository_id: repositoryId, ...payload },
    }).catch(() => undefined);
  }

  /** Reads the repository's current state with a read-only credential. */
  async function readCurrent(organizationId: string, repositoryId: string) {
    const repository = await requireRepository(organizationId, repositoryId);
    const resolution = await resolveRepositoryConnection(git, { organizationId, repository });
    const resolved = await broker.resolve({ organizationId, connectionId: resolution.connection.id }, deps.context);
    const snapshot = await readRepositorySnapshot({
      provider: resolved.provider,
      credential: resolved.credential,
      locator: toLocator(repository),
      ref: repository.defaultBranch,
      context: deps.context,
    });
    return { repository, resolution, resolved, snapshot };
  }

  async function refreshProposals(organizationId: string, repositoryId: string): Promise<void> {
    const open = (await store.listProposals(organizationId, repositoryId)).filter((proposal) => proposal.status === "pr_open" && proposal.pullRequestNumber);
    if (open.length === 0) {
      return;
    }
    const repository = await requireRepository(organizationId, repositoryId);
    const resolution = await resolveRepositoryConnection(git, { organizationId, repository });
    const resolved = await broker.resolve({ organizationId, connectionId: resolution.connection.id }, deps.context);
    if (!resolved.provider.getChangeRequest) {
      return;
    }
    for (const proposal of open) {
      try {
        const state = await resolved.provider.getChangeRequest(resolved.credential, toLocator(repository), proposal.pullRequestNumber as number, deps.context);
        if (state.state !== "open") {
          await store.updateProposal(organizationId, proposal.id, { status: state.state === "merged" ? "merged" : "closed" });
        }
      } catch (error) {
        logGitEvent("warn", "proposal_refresh_failed", { repository_id: repositoryId, error });
      }
    }
  }

  const service = {
    /** Called by the sync pipeline after the index is committed. */
    async recordAssessment(input: {
      organizationId: string;
      repositoryId: string;
      commitSha: string;
      observedPaths: readonly string[];
      files: Readonly<Record<string, string>>;
    }): Promise<AssessmentSummary> {
      const result = assessRepositorySnapshot({ observedPaths: input.observedPaths, files: input.files });
      await store.saveAssessment(input.organizationId, {
        repositoryId: input.repositoryId,
        commitSha: input.commitSha,
        summary: result.summary,
        findings: result.findings,
      });
      await git.audit.record({
        organizationId: input.organizationId,
        actorType: "system",
        actorRef: "savant-assessment",
        action: "repository_assessment_completed",
        targetType: "repository",
        targetRef: input.repositoryId,
        payload: { repository_id: input.repositoryId, commit_sha: input.commitSha, skill_count: result.summary.skillsIndexed, status: String(result.summary.score) },
      }).catch(() => undefined);
      await refreshProposals(input.organizationId, input.repositoryId).catch((error: unknown) => logGitEvent("warn", "proposal_refresh_failed", { error }));
      return result.summary;
    },

    async getRepositoryAssessment(actor: GitActor, repositoryId: string): Promise<{ assessment: RepositoryAssessment | null; proposals: ChangeProposal[] }> {
      assertGitPermission(actor, "view");
      await requireRepository(actor.organizationId, repositoryId);
      await refreshProposals(actor.organizationId, repositoryId).catch(() => undefined);
      const [latest, dismissed, proposals] = await Promise.all([
        store.latestAssessment(actor.organizationId, repositoryId),
        store.listDismissals(actor.organizationId, repositoryId),
        store.listProposals(actor.organizationId, repositoryId),
      ]);
      const proposed = new Set(proposals.filter((proposal) => ["pending_approval", "opening_pr", "pr_open"].includes(proposal.status)).flatMap((proposal) => proposal.findingFingerprints));
      return {
        assessment: latest ? { ...latest, findings: withStatuses(latest.findings, dismissed, proposed) } : null,
        proposals,
      };
    },

    async getSkillFindings(actor: GitActor, skillId: string): Promise<{ repositoryId: string | null; findings: AssessmentFinding[] }> {
      assertGitPermission(actor, "view");
      const skill = await store.resolveSkill(actor.organizationId, skillId);
      if (!skill) {
        return { repositoryId: null, findings: [] };
      }
      const { assessment } = await service.getRepositoryAssessment(actor, skill.repositoryId);
      return { repositoryId: skill.repositoryId, findings: (assessment?.findings ?? []).filter((finding) => finding.skillId === skill.skillId) };
    },

    async setFindingDismissed(actor: GitActor, repositoryId: string, fingerprint: string, dismissed: boolean, reason?: string | null): Promise<void> {
      assertGitPermission(actor, "connect_repository");
      await requireRepository(actor.organizationId, repositoryId);
      await store.setDismissed(actor.organizationId, repositoryId, fingerprint, dismissed ? { by: actor.subject, reason: reason?.slice(0, 500) ?? null } : null);
      await audit(actor, dismissed ? "assessment_finding_dismissed" : "assessment_finding_restored", repositoryId, { reason: fingerprint });
    },

    /**
     * Builds a proposal for selected fixable findings from a fresh read of the
     * repository, so the change is based on what's there now.
     */
    async proposeFixes(actor: GitActor, repositoryId: string, fingerprints: string[]): Promise<ChangeProposal> {
      assertGitPermission(actor, "connect_repository");
      if (fingerprints.length === 0) {
        throw new GitProviderError("INVALID_REQUEST", "Select at least one finding to fix.");
      }
      const { repository, resolution, snapshot } = await readCurrent(actor.organizationId, repositoryId);
      const current = assessRepositorySnapshot({ observedPaths: snapshot.observedPaths, files: snapshot.files });
      const selected = current.findings.filter((finding) => fingerprints.includes(finding.fingerprint) && finding.fix);
      if (selected.length === 0) {
        throw new GitProviderError("INVALID_REQUEST", "None of the selected findings still apply or can be fixed automatically. Sync to refresh the assessment.");
      }

      let files: ChangeProposalFile[];
      try {
        files = buildFixChanges({ findings: selected, roots: current.roots, files: snapshot.files });
      } catch (error) {
        throw new GitProviderError("INVALID_REQUEST", error instanceof FixGenerationError ? error.message : "The fix could not be generated.");
      }
      if (files.length === 0) {
        throw new GitProviderError("INVALID_REQUEST", "The selected fixes don't change any files.");
      }

      const title = selected.length === 1
        ? `Savant: ${selected[0]?.fix?.description ?? selected[0]?.title}`
        : `Savant: fix ${selected.length} assessment findings`;
      const body = [
        "Proposed by Savant from the repository assessment.",
        "",
        "Findings addressed:",
        ...selected.map((finding) => `- **${finding.title}** (${finding.code}) — ${finding.fix?.description ?? finding.remediation}`),
        "",
        "Files:",
        ...files.map((file) => `- \`${file.path}\` (${file.action})`),
      ].join("\n");

      const proposal = await store.createProposal(actor.organizationId, {
        repositoryId,
        connectionId: resolution.connection.id,
        title,
        body,
        files,
        findingFingerprints: selected.map((finding) => finding.fingerprint),
        baseBranch: repository.defaultBranch,
        baseCommitSha: snapshot.commitSha,
        createdBy: actor.subject,
      });
      await audit(actor, "change_proposal_created", repositoryId, { reason: proposal.id, skill_count: selected.length });
      return proposal;
    },

    /** Proposes explicit file edits (e.g. SKILL.md changes from the skill editor). */
    async proposeFileEdits(actor: GitActor, repositoryId: string, input: { title: string; body?: string | undefined; files: Array<{ path: string; content: string }> }): Promise<ChangeProposal> {
      assertGitPermission(actor, "connect_repository");
      if (input.files.length === 0 || input.files.length > MAX_PROPOSAL_FILES) {
        throw new GitProviderError("INVALID_REQUEST", `A proposal must change between 1 and ${MAX_PROPOSAL_FILES} files.`);
      }
      for (const file of input.files) {
        if (!/^[^/\\][^\\]*$/.test(file.path) || file.path.split("/").some((segment) => segment === ".." || segment === "" || segment === ".git")) {
          throw new GitProviderError("INVALID_REQUEST", `Invalid file path: ${file.path}`);
        }
        if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) {
          throw new GitProviderError("INVALID_REQUEST", `${file.path} is larger than ${MAX_FILE_BYTES} bytes.`);
        }
      }

      const { repository, resolution, resolved, snapshot } = await readCurrent(actor.organizationId, repositoryId);
      const observed = new Set(snapshot.observedPaths);
      const files: ChangeProposalFile[] = [];
      for (const file of input.files) {
        let previous: string | null = snapshot.files[file.path] ?? null;
        if (previous === null && observed.has(file.path)) {
          previous = (await resolved.provider.readFile(resolved.credential, toLocator(repository), snapshot.commitSha, file.path, deps.context)).toString("utf8");
        }
        if (previous !== file.content) {
          files.push({ path: file.path, action: previous === null ? "create" : "update", previousContent: previous, content: file.content });
        }
      }
      if (files.length === 0) {
        throw new GitProviderError("INVALID_REQUEST", "The edits match what's already in the repository.");
      }

      const proposal = await store.createProposal(actor.organizationId, {
        repositoryId,
        connectionId: resolution.connection.id,
        title: input.title.slice(0, 200),
        body: input.body ?? "Proposed in Savant.",
        files,
        findingFingerprints: [],
        baseBranch: repository.defaultBranch,
        baseCommitSha: snapshot.commitSha,
        createdBy: actor.subject,
      });
      await audit(actor, "change_proposal_created", repositoryId, { reason: proposal.id });
      return proposal;
    },

    async getProposal(actor: GitActor, proposalId: string): Promise<ChangeProposal> {
      assertGitPermission(actor, "view");
      const proposal = await store.getProposal(actor.organizationId, proposalId);
      if (!proposal) {
        throw new GitProviderError("REPOSITORY_NOT_FOUND", "The change proposal was not found.", { status: 404 });
      }
      return proposal;
    },

    async rejectProposal(actor: GitActor, proposalId: string): Promise<ChangeProposal> {
      assertGitPermission(actor, "connect_repository");
      const proposal = await service.getProposal(actor, proposalId);
      if (!(await store.transitionProposal(actor.organizationId, proposalId, "pending_approval", "rejected"))) {
        throw new GitProviderError("INVALID_REQUEST", `The proposal is ${proposal.status.replace(/_/g, " ")} and can't be rejected.`, { status: 409 });
      }
      await audit(actor, "change_proposal_rejected", proposal.repositoryId, { reason: proposalId });
      return service.getProposal(actor, proposalId);
    },

    /**
     * Approval opens the pull request. The files are re-checked against the
     * base branch first; if someone changed them since the proposal was made,
     * nothing is written and the user is asked to regenerate it.
     */
    async approveProposal(actor: GitActor, proposalId: string): Promise<ChangeProposal> {
      assertGitPermission(actor, "connect_repository");
      const proposal = await service.getProposal(actor, proposalId);
      const approval = { approvedBy: actor.subject, approvedAt: new Date().toISOString(), error: null };
      // A failed attempt (e.g. before write permission was granted) can be retried.
      const claimed = await store.transitionProposal(actor.organizationId, proposalId, "pending_approval", "opening_pr", approval)
        || await store.transitionProposal(actor.organizationId, proposalId, "failed", "opening_pr", approval);
      if (!claimed) {
        throw new GitProviderError("INVALID_REQUEST", `The proposal is ${proposal.status.replace(/_/g, " ")} and can't be approved again.`, { status: 409 });
      }
      await audit(actor, "change_proposal_approved", proposal.repositoryId, { reason: proposalId });

      try {
        const { repository, resolution, resolved, snapshot } = await readCurrent(actor.organizationId, proposal.repositoryId);
        if (!resolved.provider.createChangeRequest) {
          throw new GitProviderError(
            "PROVIDER_NOT_CONFIGURED",
            `Opening pull requests isn't available for ${providerLabel(repository.provider)} yet. Export the changes from the proposal instead.`,
          );
        }

        const observed = new Set(snapshot.observedPaths);
        for (const file of proposal.files) {
          const current = file.action === "create"
            ? (observed.has(file.path) ? "exists" : null)
            : snapshot.files[file.path] ?? (observed.has(file.path)
              ? (await resolved.provider.readFile(resolved.credential, toLocator(repository), snapshot.commitSha, file.path, deps.context)).toString("utf8")
              : null);
          const conflict = file.action === "create" ? current !== null : current !== file.previousContent;
          if (conflict) {
            throw new GitProviderError(
              "INVALID_REQUEST",
              `${file.path} changed in ${repository.defaultBranch} after this proposal was created. Sync and create a new proposal.`,
              { status: 409 },
            );
          }
        }

        const writer = await broker.resolve({ organizationId: actor.organizationId, connectionId: resolution.connection.id, access: "write" }, deps.context);
        const result = await resolved.provider.createChangeRequest(writer.credential, toLocator(repository), {
          baseBranch: proposal.baseBranch,
          headBranch: `savant/${proposal.id.slice(0, 8)}`,
          title: proposal.title,
          body: `${proposal.body}\n\n---\nApproved in Savant by ${actor.subject}. This pull request follows the repository's normal review and branch protection rules.`,
          commitMessage: proposal.title,
          files: proposal.files.map((file) => ({ path: file.path, content: file.content })),
        }, deps.context);

        const updated = await store.updateProposal(actor.organizationId, proposalId, {
          status: "pr_open",
          headBranch: result.headBranch,
          pullRequestNumber: result.number,
          pullRequestUrl: result.url,
          error: null,
        });
        await audit(actor, "change_proposal_pull_request_opened", proposal.repositoryId, { reason: result.url, commit_sha: result.baseCommitSha });
        return updated as ChangeProposal;
      } catch (error) {
        const message = error instanceof GitProviderError ? error.message : "The pull request could not be opened.";
        await store.updateProposal(actor.organizationId, proposalId, { status: "failed", error: message });
        await audit(actor, "change_proposal_failed", proposal.repositoryId, { reason: proposalId, error_code: error instanceof GitProviderError ? error.code : "INDEX_FAILED" });
        throw error instanceof GitProviderError ? error : new GitProviderError("PROVIDER_UNAVAILABLE", message);
      }
    },

    refreshProposals,
  };

  return service;
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
