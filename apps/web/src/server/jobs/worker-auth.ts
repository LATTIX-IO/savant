import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

/**
 * Tokens accepted by the background-job endpoints:
 *
 * - SAVANT_WORKER_TOKEN: for external workers and manual runs
 * - CRON_SECRET: sent by Vercel Cron as a Bearer token
 * - an internal token derived from GIT_CREDENTIAL_ENCRYPTION_KEY, used when a
 *   job runner hands the rest of the queue to a fresh invocation. It never
 *   leaves the deployment, and works before the other two are configured.
 */
export function internalWorkerToken(env: Env = process.env): string | null {
  const key = env.GIT_CREDENTIAL_ENCRYPTION_KEY?.trim();
  return key ? createHmac("sha256", key).update("savant-internal-job-runner-v1").digest("base64url") : null;
}

export function isAuthorizedWorker(request: Request, env: Env = process.env): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;
  return [env.SAVANT_WORKER_TOKEN?.trim(), env.CRON_SECRET?.trim(), internalWorkerToken(env)].some((secret) => {
    if (!secret || secret.length < 16 || presented.length !== secret.length) return false;
    return timingSafeEqual(Buffer.from(presented), Buffer.from(secret));
  });
}

export function selfBaseUrl(env: Env = process.env): string | null {
  const explicit = env.SAVANT_INTERNAL_BASE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return production ? `https://${production}` : null;
}
