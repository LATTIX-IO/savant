import assert from "node:assert/strict";
import test from "node:test";

const AUTH0_ENV_KEYS = [
  "APP_BASE_URL",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

type ManagedEnvKey = (typeof AUTH0_ENV_KEYS)[number] | "NODE_ENV";

function getMutableEnv(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

function snapshotEnv(): Record<ManagedEnvKey, string | undefined> {
  const env = getMutableEnv();

  return {
    NODE_ENV: env.NODE_ENV,
    APP_BASE_URL: env.APP_BASE_URL,
    AUTH0_DOMAIN: env.AUTH0_DOMAIN,
    AUTH0_CLIENT_ID: env.AUTH0_CLIENT_ID,
    AUTH0_CLIENT_SECRET: env.AUTH0_CLIENT_SECRET,
    AUTH0_SECRET: env.AUTH0_SECRET,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: env.VERCEL_URL,
  };
}

function restoreEnv(snapshot: Record<ManagedEnvKey, string | undefined>) {
  const env = getMutableEnv();

  for (const [key, value] of Object.entries(snapshot) as Array<[ManagedEnvKey, string | undefined]>) {
    if (typeof value === "undefined") {
      delete env[key];
      continue;
    }

    env[key] = value;
  }
}

async function importProxyModule() {
  return import(`./proxy.ts?case=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("proxy returns an unavailable HTML response instead of throwing when Auth0 is missing in production", async () => {
  const envSnapshot = snapshotEnv();
  const env = getMutableEnv();

  env.NODE_ENV = "production";

  for (const key of AUTH0_ENV_KEYS) {
    delete env[key];
  }

  try {
    const { proxy } = await importProxyModule();
    const response = await proxy(new Request("https://savantrepo.com/settings"));

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-savant-error-code"), "auth_service_unavailable");

    const html = await response.text();
    assert.match(html, /Authentication is required before this deployment can serve Savant\./);
  } finally {
    restoreEnv(envSnapshot);
  }
});

test("proxy returns a structured JSON unavailable response for API requests when Auth0 is missing", async () => {
  const envSnapshot = snapshotEnv();
  const env = getMutableEnv();

  env.NODE_ENV = "production";

  for (const key of AUTH0_ENV_KEYS) {
    delete env[key];
  }

  try {
    const { proxy } = await importProxyModule();
    const response = await proxy(new Request("https://savantrepo.com/api/overview"));

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-savant-error-code"), "auth_service_unavailable");
    assert.deepEqual(await response.json(), {
      error: {
        code: "auth_service_unavailable",
        message: "Authentication service is unavailable for this deployment.",
      },
    });
  } finally {
    restoreEnv(envSnapshot);
  }
});