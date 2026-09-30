import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { GitProviderError } from "../errors.ts";
import type { FetchLike } from "../types.ts";
import { clearGitHubInstallationTokenCache, createGitHubProvider } from "./github.ts";

const locator = { provider: "github" as const, host: "github.com", owner: "LATTIX-IO", name: "lattix-skills", fullName: "LATTIX-IO/lattix-skills" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function scripted(options?: { branchExists?: boolean; forbidden?: boolean }) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let refAttempts = 0;
  const fetcher: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, body });
    const base = "/repos/LATTIX-IO/lattix-skills";

    if (url.pathname.endsWith("/access_tokens")) return json({ token: "ghs_sampleWriteToken000000000001", expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
    if (options?.forbidden && method === "POST") return json({ message: "Resource not accessible by integration" }, 403);
    if (url.pathname === `${base}/git/ref/heads/main`) return json({ object: { sha: "a".repeat(40) } });
    if (url.pathname === `${base}/git/commits/${"a".repeat(40)}`) return json({ tree: { sha: "t".repeat(40) } });
    if (url.pathname === `${base}/git/trees` && method === "POST") return json({ sha: "n".repeat(40) }, 201);
    if (url.pathname === `${base}/git/commits` && method === "POST") return json({ sha: "c".repeat(40) }, 201);
    if (url.pathname === `${base}/git/refs` && method === "POST") {
      refAttempts += 1;
      return options?.branchExists && refAttempts === 1 ? json({ message: "Reference already exists" }, 422) : json({ ref: body.ref }, 201);
    }
    if (url.pathname === `${base}/pulls` && method === "POST") return json({ number: 42, html_url: "https://github.com/LATTIX-IO/lattix-skills/pull/42" }, 201);
    if (url.pathname === `${base}/pulls/42`) return json({ state: "closed", merged: true, html_url: "https://github.com/LATTIX-IO/lattix-skills/pull/42" });
    return json({ message: "Not Found" }, 404);
  };
  return { fetcher, calls };
}

async function patCredential() {
  const provider = createGitHubProvider({ env: { NODE_ENV: "test" } });
  const credential = await provider.createRuntimeCredential({ connectionId: "c", organizationId: "o", authType: "pat", host: null, installationId: null, credential: { accessToken: "sample-github-pat-for-tests" } });
  return { provider, credential };
}

const input = {
  baseBranch: "main",
  headBranch: "savant/abc12345",
  title: "Savant: scaffold agents/",
  body: "Proposed by Savant.",
  commitMessage: "Savant: scaffold agents/",
  files: [{ path: "tier2/methodology/legal/x/agents/openai.yaml", content: "version: 1\n" }],
};

test("opens a pull request on a new branch from the base head without touching the base branch", async () => {
  const { provider, credential } = await patCredential();
  const { fetcher, calls } = scripted();
  const result = await provider.createChangeRequest!(credential, locator, input, { fetcher });

  assert.deepEqual(result, { number: 42, url: "https://github.com/LATTIX-IO/lattix-skills/pull/42", headBranch: "savant/abc12345", baseCommitSha: "a".repeat(40) });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path.replace("/repos/LATTIX-IO/lattix-skills", "")}`), [
    "GET /git/ref/heads/main",
    `GET /git/commits/${"a".repeat(40)}`,
    "POST /git/trees",
    "POST /git/commits",
    "POST /git/refs",
    "POST /pulls",
  ]);
  const refCall = calls.find((call) => call.path.endsWith("/git/refs"));
  assert.equal((refCall?.body as { ref: string }).ref, "refs/heads/savant/abc12345");
  // The base branch ref is never updated (no PATCH to refs/heads/main).
  assert.ok(!calls.some((call) => call.method === "PATCH"));
  const pull = calls.find((call) => call.path.endsWith("/pulls"))?.body as { head: string; base: string };
  assert.deepEqual([pull.head, pull.base], ["savant/abc12345", "main"]);
});

test("picks a fresh branch name when the branch already exists", async () => {
  const { provider, credential } = await patCredential();
  const { fetcher } = scripted({ branchExists: true });
  const result = await provider.createChangeRequest!(credential, locator, input, { fetcher });
  assert.match(result.headBranch, /^savant\/abc12345-/);
});

test("a read-only installation reports exactly which permissions are missing", async () => {
  const { provider, credential } = await patCredential();
  const { fetcher } = scripted({ forbidden: true });
  await assert.rejects(
    () => provider.createChangeRequest!(credential, locator, input, { fetcher }),
    (error: unknown) => error instanceof GitProviderError && error.code === "INSUFFICIENT_SCOPE" && /Contents and Pull requests write/.test(error.message),
  );
});

test("reports merged pull requests", async () => {
  const { provider, credential } = await patCredential();
  const { fetcher } = scripted();
  assert.equal((await provider.getChangeRequest!(credential, locator, 42, { fetcher })).state, "merged");
});

test("installation tokens are read-only by default and write-scoped only on request", async () => {
  clearGitHubInstallationTokenCache();
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const provider = createGitHubProvider({
    env: { NODE_ENV: "test" },
    config: { appId: "1", appSlug: "savant-skills", privateKey: pem, clientId: null, clientSecret: null, webBaseUrl: "https://github.com", apiBaseUrl: "https://api.github.com" },
  });
  const { fetcher, calls } = scripted();
  const base = { connectionId: "c", organizationId: "o", authType: "github_app_installation" as const, host: null, installationId: "777", credential: null };

  await provider.createRuntimeCredential(base, { fetcher });
  await provider.createRuntimeCredential({ ...base, access: "write" }, { fetcher });
  const permissions = calls.filter((call) => call.path.endsWith("/access_tokens")).map((call) => (call.body as { permissions: unknown }).permissions);
  assert.deepEqual(permissions, [
    { contents: "read", metadata: "read" },
    { contents: "write", pull_requests: "write", metadata: "read" },
  ]);
  clearGitHubInstallationTokenCache();
});
