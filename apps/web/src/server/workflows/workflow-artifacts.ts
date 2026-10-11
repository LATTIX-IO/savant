import type { WorkflowSpecification } from "@savant/types/workflow-specification";
import { canonicalizeWorkflowSpecification, digestWorkflowSpecification, parseWorkflowSpecification, WorkflowSpecError } from "@savant/schemas/workflow-specification";

/** Git is canonical. Operational SQL indexes are optional, rebuildable projections. */
export class WorkflowArtifactError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message = code) {
    super(message);
    this.name = "WorkflowArtifactError";
    this.code = code;
    this.status = status;
  }
}
export interface WorkflowActor { organizationId: string; actor: string }
export interface WorkflowRepository { id: string; organizationId: string; provider: string; branch: string }
export interface WorkflowGitFile { content: string; blobSha: string; commitSha: string }
export interface WorkflowGitCommit { blobSha: string; commitSha: string }
export interface WorkflowArtifactPort {
  repository(organizationId: string, repositoryId: string): Promise<WorkflowRepository | null>;
  authorizeWrite(actor: string, organizationId: string): Promise<void>;
  read(repo: WorkflowRepository, path: string, revision?: string): Promise<WorkflowGitFile | null>;
  /** Must enforce an atomic create/update comparison in the Git provider. */
  write(repo: WorkflowRepository, path: string, content: string, expectedBlobSha: string | null): Promise<WorkflowGitCommit>;
  recordVersion(data: { organizationId: string; repositoryId: string; workflowId: string; version: string; blobSha: string; commitSha: string; digest: string; actor: string }): Promise<void>;
  audit(data: { organizationId: string; actor: string; action: string; repositoryId: string; workflowId: string; commitSha?: string }): Promise<void>;
}
export type WorkflowArtifactResult = {
  sourceOfTruth: "git";
  repositoryId: string;
  workflowId: string;
  commitSha: string;
  blobSha: string;
  digest: string;
  specification: WorkflowSpecification;
};
export type WorkflowSaveResult = WorkflowArtifactResult & {
  replayed: boolean;
  indexed: boolean;
  reconciliationRequired: boolean;
};

const WORKFLOW_ID = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;
const REPO_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/;
const SHA = /^[a-fA-F0-9]{40,64}$/;
function validId(id: string): string {
  if (!WORKFLOW_ID.test(id) || id === "." || id === ".." || id.includes("..")) {
    throw new WorkflowArtifactError("workflow_id_invalid", 400);
  }
  return id;
}
export function workflowArtifactPath(id: string): string { return `workflows/${validId(id)}.json`; }
function normalizeSpec(payload: unknown, id: string): WorkflowSpecification {
  try {
    const spec = parseWorkflowSpecification(payload);
    if (spec.workflowId !== id) throw new WorkflowArtifactError("workflow_id_mismatch", 422);
    return spec;
  } catch (error) {
    if (error instanceof WorkflowArtifactError) throw error;
    if (error instanceof WorkflowSpecError) throw new WorkflowArtifactError("invalid_workflow", 422);
    throw error;
  }
}
async function fromGit(repoId: string, workflowId: string, file: WorkflowGitFile): Promise<WorkflowArtifactResult> {
  let spec: WorkflowSpecification;
  try {
    spec = parseWorkflowSpecification(JSON.parse(file.content) as unknown);
  } catch {
    throw new WorkflowArtifactError("workflow_integrity_failed", 409);
  }
  if (spec.workflowId !== workflowId) throw new WorkflowArtifactError("workflow_integrity_failed", 409);
  return {
    sourceOfTruth: "git", repositoryId: repoId, workflowId,
    specification: spec, blobSha: file.blobSha, commitSha: file.commitSha,
    digest: await digestWorkflowSpecification(spec),
  };
}
export function createWorkflowArtifactService(port: WorkflowArtifactPort) {
  async function findRepo(tenant: WorkflowActor, repositoryId: string): Promise<WorkflowRepository> {
    if (!tenant.organizationId || !tenant.actor) throw new WorkflowArtifactError("auth_required", 401);
    if (!REPO_ID.test(repositoryId)) throw new WorkflowArtifactError("repository_not_found", 404);
    const repo = await port.repository(tenant.organizationId, repositoryId);
    if (!repo || repo.organizationId !== tenant.organizationId) {
      throw new WorkflowArtifactError("repository_not_found", 404);
    }
    if (repo.provider !== "github") throw new WorkflowArtifactError("provider_unsupported", 409);
    return repo;
  }
  return {
    async get(tenant: WorkflowActor, repositoryId: string, workflowId: string, revision?: string): Promise<WorkflowArtifactResult> {
      const path = workflowArtifactPath(workflowId);
      if (revision !== undefined && !SHA.test(revision)) throw new WorkflowArtifactError("revision_invalid", 400);
      const repo = await findRepo(tenant, repositoryId);
      const file = await port.read(repo, path, revision);
      if (!file) throw new WorkflowArtifactError("workflow_not_found", 404);
      return fromGit(repo.id, workflowId, file);
    },
    async save(
      tenant: WorkflowActor,
      repositoryId: string,
      workflowId: string,
      payload: unknown,
      expectedBlobSha: string | null | undefined,
    ): Promise<WorkflowSaveResult> {
      const path = workflowArtifactPath(workflowId);
      const repo = await findRepo(tenant, repositoryId);
      // Fail closed before Git access, and never accept an omitted revision precondition.
      await port.authorizeWrite(tenant.actor, tenant.organizationId);
      if (expectedBlobSha === undefined || (expectedBlobSha !== null && !SHA.test(expectedBlobSha) && !/^blob\d+$/.test(expectedBlobSha))) {
        throw new WorkflowArtifactError("revision_precondition_required", 428);
      }
      const spec = normalizeSpec(payload, workflowId);
      const content = canonicalizeWorkflowSpecification(spec);
      const digest = await digestWorkflowSpecification(spec);
      const current = await port.read(repo, path);

      if (current) {
        const previous = await fromGit(repo.id, workflowId, current);
        // Exactly equal content is a no-op even after a response was lost.
        if (previous.digest === digest) {
          return { ...previous, replayed: true, indexed: true, reconciliationRequired: false };
        }
      }
      if (expectedBlobSha !== (current?.blobSha ?? null)) throw new WorkflowArtifactError("revision_conflict", 409);
      const commit = await port.write(repo, path, content, expectedBlobSha);
      let indexed = true;
      try {
        await port.recordVersion({
          organizationId: tenant.organizationId, repositoryId: repo.id,
          workflowId, version: spec.version, blobSha: commit.blobSha,
          commitSha: commit.commitSha, digest, actor: tenant.actor,
        });
      } catch {
        // Git succeeded. Never report failure as if the client could retry the write safely.
        indexed = false;
      }
      await port.audit({
        organizationId: tenant.organizationId, actor: tenant.actor,
        action: "workflow_saved", repositoryId: repo.id, workflowId,
        commitSha: commit.commitSha,
      }).catch(() => undefined);
      return {
        sourceOfTruth: "git", repositoryId: repo.id, workflowId,
        specification: spec, blobSha: commit.blobSha, commitSha: commit.commitSha,
        digest, replayed: false, indexed, reconciliationRequired: !indexed,
      };
    },
  };
}
