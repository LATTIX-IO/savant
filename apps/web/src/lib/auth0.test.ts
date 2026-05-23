import assert from "node:assert/strict";
import test from "node:test";

const PADDED_HEX_TEST_VALUE =
  '  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"  ';

const MANAGED_ENV_KEYS = [
  "APP_BASE_URL",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_DOMAIN",
  "AUTH0_SECRET",
] as const;

type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

function getMutableEnv(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

function snapshotEnv(): Record<ManagedEnvKey, string | undefined> {
  const env = getMutableEnv();

  return Object.fromEntries(
    MANAGED_ENV_KEYS.map((key) => [key, env[key]]),
  ) as Record<ManagedEnvKey, string | undefined>;
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

async function importAuth0Module() {
  return import(`./auth0.ts?case=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("auth0 module trims and dequotes configured secrets before creating the SDK client", async () => {
  const envSnapshot = snapshotEnv();
  const env = getMutableEnv();

  env.APP_BASE_URL = "https://savantrepo.com";
  env.AUTH0_CLIENT_ID = "client-id";
  env.AUTH0_CLIENT_SECRET = '  "client-secret"\n';
  env.AUTH0_DOMAIN = "dev-tenant.us.auth0.com";
  env.AUTH0_SECRET = PADDED_HEX_TEST_VALUE;

  try {
    const auth0Module = await importAuth0Module();

    assert.equal(env.AUTH0_CLIENT_SECRET, "client-secret");
    assert.equal(
      env.AUTH0_SECRET,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    assert.equal(auth0Module.isAuth0Configured, true);
    assert.notEqual(auth0Module.auth0, null);
  } finally {
    restoreEnv(envSnapshot);
  }
});