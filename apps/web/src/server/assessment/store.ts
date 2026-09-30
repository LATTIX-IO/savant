import { randomUUID } from "node:crypto";

import type {
  AssessmentFinding,
  AssessmentSummary,
  ChangeProposal,
  ChangeProposalFile,
  ChangeProposalStatus,
} from "@savant/types";

/**
 * Persistence for assessments, dismissals, and change proposals. Every method
 * is scoped by organization id (tenant isolation).
 */

export type StoredAssessment = {
  id: string;
  repositoryId: string;
  commitSha: string;
  createdAt: string;
  summary: AssessmentSummary;
  findings: AssessmentFinding[];
};

export type ProposalInsert = {
  repositoryId: string;
  connectionId: string | null;
  title: string;
  body: string;
  files: ChangeProposalFile[];
  findingFingerprints: string[];
  baseBranch: string;
  baseCommitSha: string | null;
  createdBy: string;
};

export type ProposalPatch = Partial<Pick<ChangeProposal, "status" | "headBranch" | "pullRequestNumber" | "pullRequestUrl" | "error" | "approvedBy">> & {
  approvedAt?: string | null | undefined;
};

export interface AssessmentStore {
  saveAssessment(organizationId: string, input: Omit<StoredAssessment, "id" | "createdAt">): Promise<StoredAssessment>;
  latestAssessment(organizationId: string, repositoryId: string): Promise<StoredAssessment | null>;
  /** Resolves a skill by its skill id or indexed-skill uuid. */
  resolveSkill(organizationId: string, identifier: string): Promise<{ repositoryId: string; skillId: string } | null>;
  listDismissals(organizationId: string, repositoryId: string): Promise<Set<string>>;
  setDismissed(organizationId: string, repositoryId: string, fingerprint: string, dismissed: { by: string; reason: string | null } | null): Promise<void>;

  createProposal(organizationId: string, input: ProposalInsert): Promise<ChangeProposal>;
  getProposal(organizationId: string, proposalId: string): Promise<ChangeProposal | null>;
  listProposals(organizationId: string, repositoryId: string, limit?: number): Promise<ChangeProposal[]>;
  updateProposal(organizationId: string, proposalId: string, patch: ProposalPatch): Promise<ChangeProposal | null>;
  /** Atomically moves a proposal between statuses; false when it is no longer in `from`. */
  transitionProposal(organizationId: string, proposalId: string, from: ChangeProposalStatus, to: ChangeProposalStatus, patch?: ProposalPatch): Promise<boolean>;
}

export function createMemoryAssessmentStore() {
  const assessments: Array<StoredAssessment & { organizationId: string }> = [];
  const dismissals = new Map<string, { organizationId: string; by: string; reason: string | null }>();
  const proposals: Array<ChangeProposal & { organizationId: string }> = [];
  const skillRepositories: Array<{ organizationId: string; skillId: string; repositoryId: string }> = [];
  const clone = <T>(value: T): T => structuredClone(value);
  const withoutOrganization = <T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> => {
    const copy: Partial<T> = clone(row);
    delete copy.organizationId;
    return copy as Omit<T, "organizationId">;
  };
  const strip = (proposal: ChangeProposal & { organizationId: string }): ChangeProposal => withoutOrganization(proposal);
  const fieldsOf = (patch: ProposalPatch) => {
    const fields = { ...patch };
    delete fields.approvedAt;
    return fields;
  };

  const store: AssessmentStore & { skillRepositories: typeof skillRepositories; proposals: typeof proposals } = {
    skillRepositories,
    proposals,

    async saveAssessment(organizationId, input) {
      const saved = { ...clone(input), id: randomUUID(), createdAt: new Date(Date.now() + assessments.length).toISOString(), organizationId };
      assessments.push(saved);
      return withoutOrganization(saved);
    },
    async latestAssessment(organizationId, repositoryId) {
      const found = assessments.filter((row) => row.organizationId === organizationId && row.repositoryId === repositoryId).at(-1);
      if (!found) return null;
      return withoutOrganization(found);
    },
    async resolveSkill(organizationId, identifier) {
      const found = skillRepositories.find((row) => row.organizationId === organizationId && row.skillId === identifier);
      return found ? { repositoryId: found.repositoryId, skillId: found.skillId } : null;
    },
    async listDismissals(organizationId, repositoryId) {
      return new Set([...dismissals.entries()]
        .filter(([key, value]) => value.organizationId === organizationId && key.startsWith(`${repositoryId}:`))
        .map(([key]) => key.slice(repositoryId.length + 1)));
    },
    async setDismissed(organizationId, repositoryId, fingerprint, dismissed) {
      const key = `${repositoryId}:${fingerprint}`;
      if (dismissed) dismissals.set(key, { organizationId, ...dismissed });
      else dismissals.delete(key);
    },
    async createProposal(organizationId, input) {
      const now = new Date().toISOString();
      const proposal: ChangeProposal & { organizationId: string } = {
        organizationId,
        id: randomUUID(),
        repositoryId: input.repositoryId,
        title: input.title,
        body: input.body,
        status: "pending_approval",
        files: clone(input.files),
        findingFingerprints: [...input.findingFingerprints],
        baseBranch: input.baseBranch,
        headBranch: null,
        pullRequestNumber: null,
        pullRequestUrl: null,
        error: null,
        createdBy: input.createdBy,
        approvedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      proposals.push(proposal);
      return strip(proposal);
    },
    async getProposal(organizationId, proposalId) {
      const found = proposals.find((row) => row.organizationId === organizationId && row.id === proposalId);
      return found ? strip(found) : null;
    },
    async listProposals(organizationId, repositoryId, limit = 20) {
      return proposals.filter((row) => row.organizationId === organizationId && row.repositoryId === repositoryId).slice(-limit).reverse().map(strip);
    },
    async updateProposal(organizationId, proposalId, patch) {
      const found = proposals.find((row) => row.organizationId === organizationId && row.id === proposalId);
      if (!found) return null;
      Object.assign(found, fieldsOf(patch), { updatedAt: new Date().toISOString() });
      return strip(found);
    },
    async transitionProposal(organizationId, proposalId, from, to, patch = {}) {
      const found = proposals.find((row) => row.organizationId === organizationId && row.id === proposalId);
      if (!found || found.status !== from) return false;
      Object.assign(found, fieldsOf(patch), { status: to, updatedAt: new Date().toISOString() });
      return true;
    },
  };

  return store;
}
