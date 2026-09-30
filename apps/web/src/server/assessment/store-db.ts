import type { AssessmentFinding, AssessmentSummary, ChangeProposal, ChangeProposalFile } from "@savant/types";

import type { ControlPlaneSql } from "../control-plane/database.ts";
import type { AssessmentStore, StoredAssessment } from "./store.ts";

type ProposalRow = {
  id: string;
  repository_id: string;
  title: string;
  body: string;
  status: ChangeProposal["status"];
  files: ChangeProposalFile[];
  finding_fingerprints: string[];
  base_branch: string;
  head_branch: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
  error: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const PROPOSAL_COLUMNS = `
  id, repository_id, title, body, status, files, finding_fingerprints, base_branch, head_branch,
  pull_request_number, pull_request_url, error, created_by, approved_by, created_at, updated_at
`;

function mapProposal(row: ProposalRow): ChangeProposal {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    title: row.title,
    body: row.body,
    status: row.status,
    files: row.files,
    findingFingerprints: row.finding_fingerprints,
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    error: row.error,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function createDatabaseAssessmentStore(sql: ControlPlaneSql): AssessmentStore {
  return {
    async saveAssessment(organizationId, input) {
      const [row] = await sql<{ id: string; created_at: Date }[]>`
        insert into repository_assessments (organization_id, repository_id, commit_sha, summary, findings)
        select ${organizationId}, id, ${input.commitSha}, ${sql.json(input.summary as never)}, ${sql.json(input.findings as never)}
        from repositories where organization_id = ${organizationId} and id = ${input.repositoryId}
        returning id, created_at
      `;
      if (!row) {
        throw new Error("Repository not found for assessment.");
      }
      // Keep a bounded history per repository.
      await sql`
        delete from repository_assessments
        where organization_id = ${organizationId} and repository_id = ${input.repositoryId}
          and id not in (
            select id from repository_assessments
            where organization_id = ${organizationId} and repository_id = ${input.repositoryId}
            order by created_at desc limit 20
          )
      `;
      return { ...input, id: row.id, createdAt: new Date(row.created_at).toISOString() };
    },

    async latestAssessment(organizationId, repositoryId) {
      if (!isUuid(repositoryId)) return null;
      const [row] = await sql<{ id: string; repository_id: string; commit_sha: string; created_at: Date; summary: AssessmentSummary; findings: AssessmentFinding[] }[]>`
        select id, repository_id, commit_sha, created_at, summary, findings
        from repository_assessments
        where organization_id = ${organizationId} and repository_id = ${repositoryId}
        order by created_at desc limit 1
      `;
      return row
        ? ({ id: row.id, repositoryId: row.repository_id, commitSha: row.commit_sha, createdAt: new Date(row.created_at).toISOString(), summary: row.summary, findings: row.findings } satisfies StoredAssessment)
        : null;
    },

    async resolveSkill(organizationId, identifier) {
      const [row] = await sql<{ repository_id: string; skill_id: string }[]>`
        select repository_id, skill_id from indexed_skills
        where organization_id = ${organizationId} and (skill_id = ${identifier} or id::text = ${identifier})
        order by last_indexed_at desc
        limit 1
      `;
      return row ? { repositoryId: row.repository_id, skillId: row.skill_id } : null;
    },

    async listDismissals(organizationId, repositoryId) {
      if (!isUuid(repositoryId)) return new Set();
      const rows = await sql<{ fingerprint: string }[]>`
        select fingerprint from assessment_finding_dismissals
        where organization_id = ${organizationId} and repository_id = ${repositoryId}
      `;
      return new Set(rows.map((row) => row.fingerprint));
    },

    async setDismissed(organizationId, repositoryId, fingerprint, dismissed) {
      if (dismissed) {
        await sql`
          insert into assessment_finding_dismissals (organization_id, repository_id, fingerprint, dismissed_by, reason)
          select ${organizationId}, id, ${fingerprint}, ${dismissed.by}, ${dismissed.reason}
          from repositories where organization_id = ${organizationId} and id = ${repositoryId}
          on conflict (repository_id, fingerprint) do update set dismissed_by = excluded.dismissed_by, reason = excluded.reason, created_at = now()
        `;
      } else {
        await sql`
          delete from assessment_finding_dismissals
          where organization_id = ${organizationId} and repository_id = ${repositoryId} and fingerprint = ${fingerprint}
        `;
      }
    },

    async createProposal(organizationId, input) {
      const [row] = await sql<ProposalRow[]>`
        insert into repository_change_proposals (
          organization_id, repository_id, connection_id, title, body, files, finding_fingerprints, base_branch, base_commit_sha, created_by
        )
        select ${organizationId}, id, ${input.connectionId}, ${input.title}, ${input.body}, ${sql.json(input.files as never)},
          ${sql.json(input.findingFingerprints)}, ${input.baseBranch}, ${input.baseCommitSha}, ${input.createdBy}
        from repositories where organization_id = ${organizationId} and id = ${input.repositoryId}
        returning ${sql.unsafe(PROPOSAL_COLUMNS)}
      `;
      if (!row) {
        throw new Error("Repository not found for proposal.");
      }
      return mapProposal(row);
    },

    async getProposal(organizationId, proposalId) {
      if (!isUuid(proposalId)) return null;
      const [row] = await sql<ProposalRow[]>`
        select ${sql.unsafe(PROPOSAL_COLUMNS)} from repository_change_proposals
        where organization_id = ${organizationId} and id = ${proposalId}
      `;
      return row ? mapProposal(row) : null;
    },

    async listProposals(organizationId, repositoryId, limit = 20) {
      if (!isUuid(repositoryId)) return [];
      const rows = await sql<ProposalRow[]>`
        select ${sql.unsafe(PROPOSAL_COLUMNS)} from repository_change_proposals
        where organization_id = ${organizationId} and repository_id = ${repositoryId}
        order by created_at desc limit ${limit}
      `;
      return rows.map(mapProposal);
    },

    async updateProposal(organizationId, proposalId, patch) {
      const [row] = await sql<ProposalRow[]>`
        update repository_change_proposals set
          status = coalesce(${patch.status ?? null}, status),
          head_branch = case when ${patch.headBranch !== undefined} then ${patch.headBranch ?? null} else head_branch end,
          pull_request_number = case when ${patch.pullRequestNumber !== undefined} then ${patch.pullRequestNumber ?? null}::int else pull_request_number end,
          pull_request_url = case when ${patch.pullRequestUrl !== undefined} then ${patch.pullRequestUrl ?? null} else pull_request_url end,
          error = case when ${patch.error !== undefined} then ${patch.error ?? null} else error end,
          approved_by = case when ${patch.approvedBy !== undefined} then ${patch.approvedBy ?? null} else approved_by end,
          approved_at = case when ${patch.approvedAt !== undefined} then ${patch.approvedAt ?? null}::timestamptz else approved_at end,
          updated_at = now()
        where organization_id = ${organizationId} and id = ${proposalId}
        returning ${sql.unsafe(PROPOSAL_COLUMNS)}
      `;
      return row ? mapProposal(row) : null;
    },

    async transitionProposal(organizationId, proposalId, from, to, patch = {}) {
      const rows = await sql<{ id: string }[]>`
        update repository_change_proposals set
          status = ${to},
          approved_by = case when ${patch.approvedBy !== undefined} then ${patch.approvedBy ?? null} else approved_by end,
          approved_at = case when ${patch.approvedAt !== undefined} then ${patch.approvedAt ?? null}::timestamptz else approved_at end,
          error = case when ${patch.error !== undefined} then ${patch.error ?? null} else error end,
          updated_at = now()
        where organization_id = ${organizationId} and id = ${proposalId} and status = ${from}
        returning id
      `;
      return rows.length > 0;
    },
  };
}
