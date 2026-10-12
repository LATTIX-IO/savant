/** Immutable source revision for queued evaluations. No branch/tag fallback. */
const FULL_COMMIT_SHA=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export class UnpinnedEvaluationSourceError extends Error {
  constructor() {
    super("Evaluation requires an indexed immutable Git commit. Sync the repository and retry.");
    this.name="UnpinnedEvaluationSourceError";
  }
}
export function requirePinnedEvaluationCommit(value:unknown):string {
  if(typeof value!=="string"||!FULL_COMMIT_SHA.test(value))
    throw new UnpinnedEvaluationSourceError();
  return value;
}
