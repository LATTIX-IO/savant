import "server-only";

import { getControlPlaneDatabase } from "../control-plane/database.ts";
import { tryRecordAuditEvent } from "../control-plane/audit-events.ts";
import { getGitRuntime } from "../git/runtime.ts";
import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import type { ConnectedRepositoryRecord } from "../git/types.ts";

import { createWorkflowArtifactService, WorkflowArtifactError, type WorkflowRepository } from "./workflow-artifacts.ts";
import { createWorkflowGitHubClient } from "./workflow-github-client.ts";

/** Source ownership, repo identity and provider permissions are checked before any Git IO. */
async function resolveRepositoryClient(repo: WorkflowRepository, access: "read" | "write") {
  const git = await getGitRuntime();
  const connected: ConnectedRepositoryRecord | null = await git.stores.repositories.getRepository(repo.organizationId, repo.id);
  if (!connected || connected.organizationId !== repo.organizationId) throw new WorkflowArtifactError("repository_not_found", 404);
  if (connected.provider !== "github") throw new WorkflowArtifactError("provider_unsupported", 409);

  const resolved = await resolveRepositoryConnection(
    { connections: git.stores.connections, repositories: git.stores.repositories },
    { organizationId: repo.organizationId, repository: connected },
  );
  const token = await git.broker.resolve({
    organizationId: repo.organizationId, connectionId: resolved.connection.id, access,
  });
  if (!token.credential.accessToken) throw new WorkflowArtifactError("git_credential_unavailable", 503);
  if (!connected.providerRepositoryId) throw new WorkflowArtifactError("repository_identity_unverified", 409);
  const locator = {
    provider: "github" as const, host: "github.com",
    owner: connected.owner, name: connected.name,
    fullName: connected.fullName, providerRepositoryId: connected.providerRepositoryId,
  };
  const result = await token.provider.validateRepositoryAccess(token.credential, locator);
  if (!result.accessible || result.repository?.providerRepositoryId !== connected.providerRepositoryId) {
    throw new WorkflowArtifactError("repository_identity_unverified", 409);
  }
  return createWorkflowGitHubClient({
    owner: connected.owner, repository: connected.name,
    branch: repo.branch, accessToken: token.credential.accessToken,
  });
}

export const workflowArtifacts = createWorkflowArtifactService({
  async repository(organizationId, repositoryId) {
    const git = await getGitRuntime();
    const repo = await git.stores.repositories.getRepository(organizationId, repositoryId);
    if (!repo || repo.organizationId !== organizationId) return null;
    const sql = getControlPlaneDatabase();
    const rows = await sql<{ status: string }[]>`
      select status from repositories where organization_id = ${organizationId}
      and id = ${repositoryId} limit 1
    `;
    if (!rows[0]) throw new WorkflowArtifactError("repository_not_found", 404);
    if (rows[0].status === "disabled") throw new WorkflowArtifactError("repository_disabled", 409);
    return { id: repo.id, organizationId: repo.organizationId, provider: repo.provider, branch: repo.defaultBranch };
  },
  async authorizeWrite(subject, organizationId) {
    const git = await getGitRuntime();
    const member = await git.membership.resolveMember({ organizationId, subject });
    if (!member || !(member.isFirstMember || member.groups.some(group => group.toLowerCase() === "platform-admins"))) {
      throw new WorkflowArtifactError("forbidden", 403);
    }
  },
  async read(repo, path, revision) {
    return (await resolveRepositoryClient(repo, "read")).read(path, revision);
  },
  async write(repo, path, content, expectedBlobSha) {
    return (await resolveRepositoryClient(repo, "write")).write(path, content, expectedBlobSha);
  },
  async recordVersion(data) {
    const sql = getControlPlaneDatabase();
    await sql`
      insert into workflow_artifact_versions
        (organization_id, repository_id, workflow_id, specification_version,
         source_commit_sha, content_blob_sha, canonical_digest, actor_subject)
      values
        (${data.organizationId}, ${data.repositoryId}, ${data.workflowId},
         ${data.version}, ${data.commitSha}, ${data.blobSha}, ${data.digest}, ${data.actor})
      on conflict (organization_id, repository_id, workflow_id, source_commit_sha) do nothing
    `;
  },
  async audit(data) {
    await tryRecordAuditEvent({
      organizationId: data.organizationId, actorSubject: data.actor,
      category: "repo", action: data.action, targetType: "workflow",
      targetRef: `${data.repositoryId}:${data.workflowId}`,
      payload: { repositoryId: data.repositoryId, workflowId: data.workflowId, commitSha: data.commitSha ?? null },
    });
  },
});
