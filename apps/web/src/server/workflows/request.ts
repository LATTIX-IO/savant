import { WorkflowArtifactError } from "./workflow-artifacts.ts";

const MAX_WORKFLOW_REQUEST_BYTES = 750_000;

/** Read an untrusted request with an enforced byte budget before JSON decoding. */
export async function readWorkflowRequestObject(request: Request): Promise<Record<string, unknown>> {
  const advertised = request.headers.get("content-length");
  if (advertised !== null && Number(advertised) > MAX_WORKFLOW_REQUEST_BYTES) {
    throw new WorkflowArtifactError("workflow_request_oversized", 413);
  }
  if (!request.body) throw new WorkflowArtifactError("invalid_json_body", 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_WORKFLOW_REQUEST_BYTES) {
        await reader.cancel("Workflow request body limit reached");
        throw new WorkflowArtifactError("workflow_request_oversized", 413);
      }
      parts.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new WorkflowArtifactError("invalid_json_body", 400);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowArtifactError("invalid_json_body", 400);
  }
  return parsed as Record<string, unknown>;
}
