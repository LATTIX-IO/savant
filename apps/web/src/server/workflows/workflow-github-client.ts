import { createHash } from "node:crypto";

import { WorkflowArtifactError, type WorkflowGitCommit, type WorkflowGitFile } from "./workflow-artifacts.ts";

/**
 * Bounded, testable GitHub Contents transport. Credential and repository
 * ownership must be verified by the managed broker BEFORE constructing this client.
 */
export type WorkflowGitHubOptions = {
  owner: string;
  repository: string;
  branch: string;
  accessToken: string;
  fetcher?: typeof fetch;
};
const SHA = /^[a-f0-9]{40}$/i;
const PATH = /^workflows\/[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?\.json$/;
const MAX_HTTP_BYTES = 1_500_000;
const MAX_ARTIFACT_BYTES = 512_000;

function checkPath(path: string): void {
  if (!PATH.test(path) || path.includes("..")) throw new WorkflowArtifactError("workflow_id_invalid", 400);
}
function checkSha(sha: unknown, code = "git_invalid_response"): string {
  if (typeof sha !== "string" || !SHA.test(sha)) throw new WorkflowArtifactError(code, 502);
  return sha;
}
function blobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8")).update(bytes).digest("hex");
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new WorkflowArtifactError("git_invalid_response", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytesRead += item.value.byteLength;
      if (bytesRead > MAX_HTTP_BYTES) {
        await reader.cancel("response too large");
        throw new WorkflowArtifactError("git_response_oversized", 502);
      }
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof WorkflowArtifactError) throw error;
    throw new WorkflowArtifactError("git_unavailable", 503);
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), bytesRead);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new WorkflowArtifactError("git_invalid_response", 502); }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function child(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}
export function createWorkflowGitHubClient(options: WorkflowGitHubOptions) {
  const fetcher = options.fetcher ?? fetch;
  if (!/^[\w.-]+$/.test(options.owner) || !/^[\w.-]+$/.test(options.repository) || !/^[A-Za-z0-9._/-]+$/.test(options.branch) || !options.accessToken.trim()) {
    throw new WorkflowArtifactError("git_configuration_invalid", 409);
  }
  const root = `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repository)}`;
  async function request(path: string, method: "GET" | "PUT", payload?: unknown): Promise<unknown | null> {
    let response: Response;
    try {
      response = await fetcher(root + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "savant-workflow-quality",
          Authorization: `Bearer ${options.accessToken}`,
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new WorkflowArtifactError("git_unavailable", 503); }
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) {
      if ([409, 412, 422].includes(response.status)) throw new WorkflowArtifactError("revision_conflict", 409);
      if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
        throw new WorkflowArtifactError("git_rate_limited", 503);
      }
      if ([401, 403, 404].includes(response.status)) throw new WorkflowArtifactError("git_access_denied", 403);
      throw new WorkflowArtifactError("git_unavailable", 502);
    }
    if (Number(response.headers.get("content-length") ?? "0") > MAX_HTTP_BYTES) throw new WorkflowArtifactError("git_response_oversized", 502);
    return boundedJson(response);
  }
  async function head(): Promise<string> {
    const data = await request(`/git/ref/heads/${encodeURIComponent(options.branch)}`, "GET");
    return checkSha(child(child(data, "object"), "sha"));
  }
  function filePath(path: string): string {
    checkPath(path);
    return "/contents/" + path.split("/").map(encodeURIComponent).join("/");
  }
  return {
    async read(path: string, revision?: string): Promise<WorkflowGitFile | null> {
      const pathname = filePath(path);
      if (revision && !SHA.test(revision)) throw new WorkflowArtifactError("revision_invalid", 400);
      const commitSha = revision ?? await head();
      const payload = await request(`${pathname}?ref=${encodeURIComponent(commitSha)}`, "GET");
      if (payload === null) return null;
      if (child(payload, "type") !== "file" || child(payload, "encoding") !== "base64") throw new WorkflowArtifactError("git_invalid_response", 502);
      const source = child(payload, "content");
      if (typeof source !== "string") throw new WorkflowArtifactError("git_invalid_response", 502);
      const encoded = source.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4) throw new WorkflowArtifactError("git_invalid_response", 502);
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > MAX_ARTIFACT_BYTES) throw new WorkflowArtifactError("git_response_oversized", 413);
      const expected = checkSha(child(payload, "sha"));
      if (blobSha(bytes) !== expected.toLowerCase()) throw new WorkflowArtifactError("workflow_integrity_failed", 409);
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new WorkflowArtifactError("workflow_integrity_failed", 409); }
      return { content, blobSha: expected, commitSha };
    },
    async write(path: string, content: string, expectedBlobSha: string | null): Promise<WorkflowGitCommit> {
      const pathname = filePath(path);
      if (expectedBlobSha !== null && !SHA.test(expectedBlobSha)) throw new WorkflowArtifactError("revision_precondition_required", 428);
      const bytes = Buffer.from(content, "utf8");
      if (bytes.length > MAX_ARTIFACT_BYTES) throw new WorkflowArtifactError("workflow_request_oversized", 413);
      const payload = await request(pathname, "PUT", {
        message: `chore(workflow): update ${path}`,
        content: bytes.toString("base64"),
        branch: options.branch,
        ...(expectedBlobSha ? { sha: expectedBlobSha } : {}),
      });
      const commitSha = checkSha(child(child(payload, "commit"), "sha"));
      const contentSha = checkSha(child(child(payload, "content"), "sha"));
      if (contentSha.toLowerCase() !== blobSha(bytes)) throw new WorkflowArtifactError("git_invalid_response", 502);
      return { commitSha, blobSha: contentSha };
    },
  };
}
