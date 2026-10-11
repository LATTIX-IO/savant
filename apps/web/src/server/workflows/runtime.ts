import "server-only";

import { getControlPlaneDatabase } from "../control-plane/database.ts";
import { tryRecordAuditEvent } from "../control-plane/audit-events.ts";
import { getGitRuntime } from "../git/runtime.ts";
import { resolveRepositoryConnection } from "../git/connection-resolver.ts";
import type { ConnectedRepositoryRecord, RuntimeCredential } from "../git/types.ts";

import { createWorkflowArtifactService, WorkflowArtifactError, type WorkflowRepository } from "./workflow-artifacts.ts";

const GITHUB_TIMEOUT_MS = 10_000;
const GITHUB_SHA = /^[a-fA-F0-9]{40}$/;

type GitHubContent = { type?: string; encoding?: string; content?: string; sha?: string };
type GitHubWritten = { content?: { sha?: string }; commit?: { sha?: string } };

async function resolveRepositoryRecord(repo: WorkflowRepository): Promise<{
  connected: ConnectedRepositoryRecord;
  credential: RuntimeCredential;
  apiUrl: string;
}> {
  const git = await getGitRuntime();
  const connected = await git.stores.repositories.getRepository(repo.organizationId, repo.id);
  if (!connected || connected.organizationId !== repo.organizationId) throw new WorkflowArtifactError("repository_not_found", 404);
  if (connected.provider !== "github") throw new WorkflowArtifactError("provider_unsupported", 409);
  const resolved = await resolveRepositoryConnection(
    { connections: git.stores.connections, repositories: git.stores.repositories },
    { organizationId: repo.organizationId, repository: connected },
  );
  const token = await git.broker.resolve({
    organizationId: repo.organizationId, connectionId: resolved.connection.id,
    access: "repository_read",
  });
  if (!token.credential.accessToken) throw new WorkflowArtifactError("git_credential_unavailable", 503);
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(connected.owner)}/${encodeURIComponent(connected.name)}`;
  return { connected, credential: token.credential, apiUrl };
}
async function githubCall<T>(url: string, credential: RuntimeCredential, method: "GET" | "PUT", body?: unknown): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "savant-workflow-quality",
        "Authorization": `Bearer ${credential.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    throw new WorkflowArtifactError("git_unavailable", 503);
  }
  if (response.status === 404 && method === "GET") return null;
  if (!response.ok) {
    if ([409, 412, 422].includes(response.status)) throw new WorkflowArtifactError("revision_conflict", 409);
    if ([401, 403].includes(response.status)) throw new WorkflowArtifactError("git_access_denied", 403);
    if (response.status === 429) throw new WorkflowArtifactError("git_rate_limited", 503);
    throw new WorkflowArtifactError("git_unavailable", 502);
  }
  const size = Number(response.headers.get("content-length") ?? "0");
  if (size > 1_500_000) throw new WorkflowArtifactError("git_response_oversized", 502);
  try { return await response.json() as T; } catch { throw new WorkflowArtifactError("git_invalid_response", 502); }
}
function pathUrl(root: string, path: string): string {
  return `${root}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
}
async function headRevision(root: string, credential: RuntimeCredential, branch: string): Promise<string> {
  const data = await githubCall<{ object?: { sha?: string } }>(
    `${root}/git/ref/heads/${encodeURIComponent(branch)}`, credential, "GET",
  );
  const sha = data?.object?.sha;
  if (!sha || !GITHUB_SHA.test(sha)) throw new WorkflowArtifactError("git_revision_unavailable", 503);
  return sha;
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
    if (rows[0]?.status === "disabled") throw new WorkflowArtifactError("repository_disabled", 409);
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
    const { credential, apiUrl } = await resolveRepositoryRecord(repo);
    const sha = revision ?? await headRevision(apiUrl, credential, repo.branch);
    if (!GITHUB_SHA.test(sha)) throw new WorkflowArtifactError("revision_invalid", 400);
    const data = await githubCall<GitHubContent>(
      `${pathUrl(apiUrl, path)}?ref=${encodeURIComponent(sha)}`, credential, "GET",
    );
    if (!data) return null;
    if (data.type !== "file" || data.encoding !== "base64" || !data.content || !data.sha || !GITHUB_SHA.test(data.sha)) {
      throw new WorkflowArtifactError("git_invalid_response", 502);
    }
    const bytes = Buffer.from(data.content.replace(/\s/g, ""), "base64");
    if (bytes.length > 512_000) throw new WorkflowArtifactError("git_response_oversized", 413);
    return { content: bytes.toString("utf8"), blobSha: data.sha, commitSha: sha };
  },
  async write(repo, path, content, expectedBlobSha) {
    const { credential, apiUrl } = await resolveRepositoryRecord(repo);
    const result = await githubCall<GitHubWritten>(pathUrl(apiUrl, path), credential, "PUT", {
      message: `chore(workflow): update ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: repo.branch,
      ...(expectedBlobSha ? { sha: expectedBlobSha } : {}),
    });
    if (!result?.commit?.sha || !GITHUB_SHA.test(result.commit.sha) || !result.content?.sha || !GITHUB_SHA.test(result.content.sha)) {
      throw new WorkflowArtifactError("git_invalid_response", 502);
    }
    return { commitSha: result.commit.sha, blobSha: result.content.sha };
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
