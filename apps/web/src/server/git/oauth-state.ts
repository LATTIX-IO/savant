import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { GitProviderError } from "./errors.ts";
import { decryptGitSecret, encryptGitSecret, type Env } from "./secret-vault.ts";
import type { OAuthStateRecord, OAuthStateStore } from "./stores.ts";
import type { GitProviderType } from "./types.ts";

/**
 * Cryptographically random, single-use, expiring authorization state (spec §12).
 * Only a hash of the state is persisted. The PKCE verifier and any per-instance
 * OAuth client credentials are encrypted and bound to the state hash.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export type AuthorizationStatePayload = {
  codeVerifier?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
};

export type CreatedAuthorizationState = {
  state: string;
  codeChallenge: string | undefined;
  expiresAt: string;
};

export type ConsumedAuthorizationState = OAuthStateRecord & { payload: AuthorizationStatePayload };

export function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Only same-application relative paths are accepted as post-authorization destinations. */
export function sanitizeReturnPath(value: string | null | undefined, fallback: string): string {
  const candidate = value?.trim();

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f]/.test(candidate)) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://savant.invalid");
    if (parsed.origin !== "https://savant.invalid") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

export async function createAuthorizationState(
  store: OAuthStateStore,
  input: {
    organizationId: string;
    userSubject: string;
    provider: GitProviderType;
    providerHost?: string | null | undefined;
    returnPath: string;
    usePkce: boolean;
    clientId?: string | undefined;
    clientSecret?: string | undefined;
    reauthorizeConnectionId?: string | null | undefined;
    now?: Date | undefined;
    env?: Env | undefined;
  },
): Promise<CreatedAuthorizationState> {
  const state = randomBytes(32).toString("base64url");
  const stateHash = hashState(state);
  const pkce = input.usePkce ? createPkcePair() : null;
  const expiresAt = new Date((input.now ?? new Date()).getTime() + STATE_TTL_MS).toISOString();
  const payload: AuthorizationStatePayload = {
    ...(pkce ? { codeVerifier: pkce.verifier } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
  };
  const hasPayload = Object.keys(payload).length > 0;

  await store.insert({
    stateHash,
    organizationId: input.organizationId,
    userSubject: input.userSubject,
    provider: input.provider,
    providerHost: input.providerHost ?? null,
    returnPath: input.returnPath,
    encryptedPayload: hasPayload
      ? encryptGitSecret(JSON.stringify(payload), { purpose: "oauth_state", organizationId: input.organizationId, stateHash }, input.env).encryptedPayload
      : null,
    reauthorizeConnectionId: input.reauthorizeConnectionId ?? null,
    expiresAt,
  });

  return { state, codeChallenge: pkce?.challenge, expiresAt };
}

function subjectsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Consumes state exactly once and verifies it belongs to the same Savant
 * user and provider, and has not expired. The organization is taken from the
 * stored state — never from callback query parameters.
 */
export async function consumeAuthorizationState(
  store: OAuthStateStore,
  input: {
    state: string | null | undefined;
    provider: GitProviderType;
    userSubject: string | null | undefined;
    now?: Date | undefined;
    env?: Env | undefined;
  },
): Promise<ConsumedAuthorizationState> {
  if (!input.state || input.state.length < 20 || input.state.length > 200) {
    throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "The authorization request is missing or malformed. Start the connection again.");
  }

  const now = input.now ?? new Date();
  const stateHash = hashState(input.state);
  // Consumption happens first, so a state is burned even if a later check fails.
  const record = await store.consume(stateHash, now.toISOString());

  if (!record) {
    throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "This authorization link was already used or is unknown. Start the connection again.");
  }

  if (Date.parse(record.expiresAt) <= now.getTime()) {
    throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "This authorization request expired. Start the connection again.");
  }

  if (record.provider !== input.provider) {
    throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "The authorization response does not match the provider that was requested.");
  }

  if (!input.userSubject || !subjectsMatch(record.userSubject, input.userSubject)) {
    throw new GitProviderError(
      "AUTHORIZATION_STATE_INVALID",
      "The authorization was started by a different Savant session. Sign in as the user who started it and try again.",
      { status: 403 },
    );
  }

  const payload: AuthorizationStatePayload = record.encryptedPayload
    ? (JSON.parse(decryptGitSecret(record.encryptedPayload, { purpose: "oauth_state", organizationId: record.organizationId, stateHash }, input.env)) as AuthorizationStatePayload)
    : {};

  return { ...record, payload };
}
