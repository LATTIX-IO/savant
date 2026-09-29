import { GitProviderError } from "../errors.ts";
import { decodeCursor, encodeCursor, providerRequest, type ProviderRequestOptions } from "../http.ts";
import { readAzureEntraConfig, type AzureEntraConfig } from "../provider-config.ts";
import { redactString } from "../redaction.ts";
import type { Env } from "../secret-vault.ts";
import {
  createRuntimeCredential,
  type CompletedAuthorization,
  type GitProvider,
  type ProviderAccount,
  type ProviderCredential,
  type ProviderIdentity,
  type ProviderRepository,
  type ProviderRuntimeContext,
  type RepositoryLocator,
  type RepositoryTreeEntry,
  type RuntimeCredential,
} from "../types.ts";
import { parseAzureReposUrl } from "../url-parsing.ts";

/**
 * Azure DevOps Services / Azure Repos adapter.
 *
 * Authorization uses Microsoft Entra ID (Microsoft identity platform v2) with
 * the Azure DevOps resource's delegated `vso.code` scope — not the deprecated
 * Azure DevOps OAuth (app.vssps.visualstudio.com/oauth2). PATs are supported
 * as a manual fallback and are scoped to a single organization.
 *
 * Discovery hierarchy: Microsoft identity → organization → project → repository.
 */

const AZURE_API_BASE_URL = "https://dev.azure.com";
const AZURE_HOST = "dev.azure.com";
const AZURE_VSSPS_BASE_URL = "https://app.vssps.visualstudio.com";
const ENTRA_LOGIN_BASE_URL = "https://login.microsoftonline.com";
const API_VERSION = "7.1";

/** Organization names come from provider responses or cursors; validate before building URLs. */
const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_.]*$/;
const TENANT_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

/** Upper bound on organizations fetched while filling one repository page. */
const MAX_ORGANIZATIONS_PER_PAGE = 10;

type AzureTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

type AzureIdTokenClaims = {
  tid?: string;
  oid?: string;
  aud?: string;
  name?: string;
  preferred_username?: string;
};

type AzureProfile = {
  id?: string;
  displayName?: string;
  emailAddress?: string;
  publicAlias?: string;
};

type AzureConnectionData = {
  authenticatedUser?: {
    id?: string;
    providerDisplayName?: string;
    properties?: { Account?: { $value?: string } };
  };
};

type AzureRepository = {
  id: string;
  name: string;
  defaultBranch?: string | null;
  webUrl?: string | null;
  remoteUrl?: string | null;
  isDisabled?: boolean;
  project?: { id?: string; name?: string; visibility?: string } | null;
};

type AzureRef = { name?: string; objectId?: string; peeledObjectId?: string };

type AzureItem = { path?: string; isFolder?: boolean; gitObjectType?: string };

function azureError(code: ConstructorParameters<typeof GitProviderError>[0], message: string, status?: number): GitProviderError {
  return new GitProviderError(code, message, { provider: "azure", ...(status != null ? { status } : {}) });
}

export function isValidAzureOrganizationName(value: string): boolean {
  return value.length <= 256 && ORGANIZATION_NAME_PATTERN.test(value);
}

function assertOrganizationName(value: string | undefined | null): string {
  if (!value || !isValidAzureOrganizationName(value)) {
    throw azureError("PROVIDER_HOST_REJECTED", "The Azure DevOps organization name is invalid.", 400);
  }
  return value;
}

function organizationBase(credential: RuntimeCredential, organization: string): string {
  return `${credential.apiBaseUrl}/${encodeURIComponent(assertOrganizationName(organization))}`;
}

function stripHeadsPrefix(ref: string | null | undefined): string | null {
  if (!ref) {
    return null;
  }
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/** Removes control characters, redacts credential-looking material and caps provider error text. */
function sanitizeProviderText(value: string | null | undefined, maxLength = 300): string {
  if (!value) {
    return "";
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = redactString(value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim());
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

/**
 * Decodes (without verifying) the id_token payload. The token came directly
 * from the Entra token endpoint over TLS in the same request, so the
 * signature is not re-verified; only identifiers are read from it.
 */
export function decodeIdTokenClaims(idToken: string | undefined): AzureIdTokenClaims {
  if (!idToken) {
    return {};
  }
  const payload = idToken.split(".")[1];
  if (!payload) {
    return {};
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const claims: AzureIdTokenClaims = {};
    for (const key of ["tid", "oid", "aud", "name", "preferred_username"] as const) {
      const value = record[key];
      if (typeof value === "string" && value) {
        claims[key] = value;
      }
    }
    return claims;
  } catch {
    return {};
  }
}

/** Maps Entra errors that require the user to sign in again onto the revoked-grant path. */
function inspectEntraFailure(_response: Response, body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (parsed.error === "interaction_required" || parsed.error === "consent_required" || parsed.error === "login_required") {
      return { oauthError: "invalid_grant" };
    }
  } catch {
    // Non-JSON bodies fall through to status-based normalization.
  }
  return {};
}

function isPatCredential(credential: RuntimeCredential): boolean {
  return credential.scheme === "basic";
}

function azureHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    // Ask Azure DevOps to answer 401 instead of redirecting to an HTML sign-in page.
    "X-TFS-FedAuthRedirect": "Suppress",
    ...extra,
  };
}

/**
 * Azure DevOps sometimes answers a rejected credential with `203
 * Non-Authoritative Information` and an HTML sign-in page instead of a 401.
 */
function assertAuthoritative(response: Response): void {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 203 || (response.redirected && /text\/html/i.test(contentType))) {
    throw azureError("TOKEN_EXPIRED", "Azure Repos no longer accepts Savant's authorization. Reauthorize Azure Repos.", 401);
  }
}

async function azureRequest(url: string, options: ProviderRequestOptions): Promise<{ response: Response; body: Buffer }> {
  const result = await providerRequest(url, options);
  assertAuthoritative(result.response);
  return result;
}

async function azureJson<T>(url: string, options: ProviderRequestOptions): Promise<T> {
  const { body } = await azureRequest(url, { ...options, headers: azureHeaders(options.headers) });
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw azureError("INVALID_PROVIDER_RESPONSE", "Azure Repos returned a response that is not valid JSON.");
  }
}

function parseScopes(scope: string | undefined, fallback: string[]): string[] {
  const scopes = (scope ?? "").split(/\s+/).filter(Boolean);
  return scopes.length > 0 ? scopes : fallback;
}

function toProviderRepository(repo: AzureRepository, organization: string): ProviderRepository {
  const project = repo.project?.name ?? repo.name;
  return {
    providerRepositoryId: repo.id,
    provider: "azure",
    host: AZURE_HOST,
    owner: organization,
    project,
    name: repo.name,
    fullName: `${organization}/${project}/${repo.name}`,
    hierarchy: [organization, project],
    defaultBranch: stripHeadsPrefix(repo.defaultBranch),
    webUrl: repo.webUrl ?? null,
    cloneUrl: repo.remoteUrl ?? null,
    isPrivate: repo.project?.visibility ? repo.project.visibility.toLowerCase() !== "public" : true,
  };
}

function repositoryBase(credential: RuntimeCredential, locator: RepositoryLocator): string {
  const project = locator.project ?? locator.name;
  const repository = locator.providerRepositoryId || locator.name;
  return `${organizationBase(credential, locator.owner)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository)}`;
}

function normalizeItemPath(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

export type AzureReposProviderOptions = {
  env?: Env | undefined;
  config?: AzureEntraConfig | undefined;
  now?: (() => number) | undefined;
};

export function createAzureReposProvider(options?: AzureReposProviderOptions): GitProvider {
  const env = options?.env ?? process.env;
  const config = () => options?.config ?? readAzureEntraConfig(env);
  const now = options?.now ?? Date.now;

  /**
   * The tenant comes from configuration; a caller-supplied value is only
   * honored when it is a tenant GUID or an *.onmicrosoft.com domain.
   */
  function resolveTenant(requested?: string | undefined): string {
    const candidate = requested?.trim();
    if (candidate && (TENANT_GUID_PATTERN.test(candidate) || /^[A-Za-z0-9-]+\.onmicrosoft\.com$/i.test(candidate))) {
      return candidate;
    }
    const tenant = config().tenant;
    if (!TENANT_PATTERN.test(tenant)) {
      throw azureError("PROVIDER_NOT_CONFIGURED", "AZURE_DEVOPS_ENTRA_TENANT is invalid.");
    }
    return tenant;
  }

  function requireClient(): { clientId: string; clientSecret: string; scopes: string[] } {
    const cfg = config();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw azureError("PROVIDER_NOT_CONFIGURED", provider.configurationHint() ?? "Azure Repos is not configured.");
    }
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret, scopes: cfg.scopes };
  }

  async function requestToken(tenant: string, body: URLSearchParams, context?: ProviderRuntimeContext): Promise<AzureTokenResponse> {
    const { body: raw } = await providerRequest(`${ENTRA_LOGIN_BASE_URL}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      provider: "azure",
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
      maxRetries: 0,
      inspectFailure: inspectEntraFailure,
      ...context,
    });

    let token: AzureTokenResponse;
    try {
      token = JSON.parse(raw.toString("utf8")) as AzureTokenResponse;
    } catch {
      throw azureError("INVALID_PROVIDER_RESPONSE", "Microsoft Entra ID returned a token response that is not valid JSON.");
    }
    if (!token.access_token) {
      throw azureError("INVALID_PROVIDER_RESPONSE", "Microsoft Entra ID did not return an access token.");
    }
    return token;
  }

  function expiresAtFrom(expiresIn: number | string | undefined): string | undefined {
    const seconds = Number(expiresIn);
    return Number.isFinite(seconds) && seconds > 0 ? new Date(now() + seconds * 1000).toISOString() : undefined;
  }

  async function readProfile(credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<AzureProfile> {
    return azureJson<AzureProfile>(`${AZURE_VSSPS_BASE_URL}/_apis/profile/profiles/me?api-version=${API_VERSION}`, {
      provider: "azure",
      credential,
      subject: "the Azure DevOps profile",
      ...context,
    });
  }

  async function readConnectionData(credential: RuntimeCredential, organization: string, context?: ProviderRuntimeContext): Promise<ProviderIdentity> {
    const data = await azureJson<AzureConnectionData>(`${organizationBase(credential, organization)}/_apis/connectionData`, {
      provider: "azure",
      credential,
      subject: `organization ${organization}`,
      ...context,
    });
    const user = data.authenticatedUser;
    // Unauthenticated callers receive the anonymous identity rather than a 401.
    if (!user?.id || user.providerDisplayName === "Anonymous") {
      throw azureError("TOKEN_EXPIRED", "Azure Repos no longer accepts Savant's authorization. Reauthorize Azure Repos.", 401);
    }
    const account = user.properties?.Account?.$value;
    const displayName = user.providerDisplayName || account || user.id;
    return { id: user.id, login: account || displayName, displayName, attributes: { organization } };
  }

  async function listOrganizations(credential: RuntimeCredential, context?: ProviderRuntimeContext): Promise<ProviderAccount[]> {
    if (isPatCredential(credential)) {
      const organization = assertOrganizationName(credential.accountScope);
      return [{ id: organization, name: organization, kind: "azure_organization" }];
    }

    const profile = await readProfile(credential, context);
    if (!profile.id) {
      throw azureError("INVALID_PROVIDER_RESPONSE", "Azure DevOps did not return a profile id.");
    }
    const data = await azureJson<{ value?: Array<{ accountId?: string; accountName?: string }> }>(
      `${AZURE_VSSPS_BASE_URL}/_apis/accounts?memberId=${encodeURIComponent(profile.id)}&api-version=${API_VERSION}`,
      { provider: "azure", credential, subject: "Azure DevOps organizations", ...context },
    );

    const seen = new Set<string>();
    const accounts: ProviderAccount[] = [];
    for (const account of data.value ?? []) {
      const name = account.accountName;
      if (!name || !isValidAzureOrganizationName(name) || seen.has(name.toLowerCase())) {
        continue;
      }
      seen.add(name.toLowerCase());
      accounts.push({ id: account.accountId ?? name, name, kind: "azure_organization" });
    }
    return accounts.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function listOrganizationRepositories(
    credential: RuntimeCredential,
    organization: string,
    context?: ProviderRuntimeContext,
  ): Promise<ProviderRepository[]> {
    const data = await azureJson<{ value?: AzureRepository[] }>(
      `${organizationBase(credential, organization)}/_apis/git/repositories?api-version=${API_VERSION}`,
      { provider: "azure", credential, subject: `organization ${organization}`, ...context },
    );
    return (data.value ?? [])
      .filter((repo) => repo && typeof repo.id === "string" && typeof repo.name === "string" && !repo.isDisabled)
      .map((repo) => toProviderRepository(repo, organization))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async function findRef(
    credential: RuntimeCredential,
    locator: RepositoryLocator,
    fullRefName: string,
    context?: ProviderRuntimeContext,
  ): Promise<string | null> {
    const filter = fullRefName.replace(/^refs\//, "");
    const data = await azureJson<{ value?: AzureRef[] }>(
      `${repositoryBase(credential, locator)}/refs?filter=${encodeURIComponent(filter)}&peelTags=true&api-version=${API_VERSION}`,
      { provider: "azure", credential, repositoryKnown: true, subject: `${locator.fullName}@${fullRefName}`, ...context },
    );
    // `filter` is a prefix match; only accept the exact ref.
    const ref = (data.value ?? []).find((candidate) => candidate.name === fullRefName);
    const sha = ref?.peeledObjectId || ref?.objectId;
    return sha && COMMIT_SHA_PATTERN.test(sha) ? sha.toLowerCase() : null;
  }

  const provider: GitProvider = {
    type: "azure",
    label: "Azure Repos",
    hierarchy: ["Organization", "Project", "Repository"],
    requestedAccess: ["vso.code (Code: Read)", "offline_access"],
    capabilities: {
      primaryAuth: "oauth",
      supportsRefresh: true,
      supportsRevocation: false,
      supportsSelfManaged: false,
      supportsManualToken: true,
      usesPkce: true,
    },

    isConfigured() {
      const cfg = config();
      return Boolean(cfg.clientId && cfg.clientSecret);
    },

    configurationHint() {
      return provider.isConfigured()
        ? null
        : "Register a Microsoft Entra ID application with the Azure DevOps delegated permission `vso.code` (plus offline_access) and the redirect URI `<APP_BASE_URL>/api/git/connections/azure/callback`, then set AZURE_DEVOPS_ENTRA_CLIENT_ID, AZURE_DEVOPS_ENTRA_CLIENT_SECRET and optionally AZURE_DEVOPS_ENTRA_TENANT (defaults to \"organizations\").";
    },

    async getAuthorizationUrl(request) {
      const client = requireClient();
      if (!request.codeChallenge) {
        throw azureError("AUTHORIZATION_STATE_INVALID", "Azure Repos authorization requires a PKCE code challenge.");
      }

      const url = new URL(`${ENTRA_LOGIN_BASE_URL}/${encodeURIComponent(resolveTenant(request.host))}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", request.redirectUri);
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", client.scopes.join(" "));
      url.searchParams.set("state", request.state);
      url.searchParams.set("code_challenge", request.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async completeAuthorization(callback, exchange, context): Promise<CompletedAuthorization> {
      const error = callback.get("error");
      if (error) {
        const description = sanitizeProviderText(callback.get("error_description"));
        throw azureError(
          "AUTH_REQUIRED",
          `Microsoft Entra ID did not authorize Savant (${sanitizeProviderText(error, 64)})${description ? `: ${description}` : "."}`,
        );
      }

      const code = callback.get("code");
      if (!code) {
        throw azureError("AUTHORIZATION_STATE_INVALID", "Microsoft Entra ID did not return an authorization code.");
      }
      if (!exchange.codeVerifier) {
        throw azureError("AUTHORIZATION_STATE_INVALID", "The PKCE verifier for this Azure Repos authorization is missing. Try connecting again.");
      }

      const client = requireClient();
      let token: AzureTokenResponse;
      try {
        token = await requestToken(
          resolveTenant(exchange.host),
          new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: exchange.redirectUri,
            code_verifier: exchange.codeVerifier,
            scope: client.scopes.join(" "),
          }),
          context,
        );
      } catch (caught) {
        if (caught instanceof GitProviderError && caught.code === "TOKEN_REVOKED") {
          throw azureError("AUTHORIZATION_STATE_INVALID", "The Azure Repos authorization code expired or was already used. Try connecting again.");
        }
        throw caught;
      }

      const claims = decodeIdTokenClaims(token.id_token);
      if (claims.aud && claims.aud !== client.clientId) {
        throw azureError("AUTHORIZATION_STATE_INVALID", "The Microsoft Entra ID token was issued to a different application.");
      }

      const accessToken = token.access_token as string;
      const credential = createRuntimeCredential({
        provider: "azure",
        connectionId: null,
        organizationId: null,
        apiBaseUrl: AZURE_API_BASE_URL,
        host: AZURE_HOST,
        accessToken,
      });
      const profile = await readProfile(credential, context);
      const scopes = parseScopes(token.scope, client.scopes);
      const login = profile.emailAddress || claims.preferred_username || profile.id || "";
      const displayName = profile.displayName || claims.name || login;
      const profileId = profile.id ?? claims.oid ?? "";
      if (!profileId) {
        throw azureError("INVALID_PROVIDER_RESPONSE", "Azure DevOps did not return a profile id.");
      }

      const attributes: Record<string, string> = {};
      if (claims.tid) attributes.tenantId = claims.tid;
      if (claims.oid) attributes.objectId = claims.oid;

      const expiresAt = expiresAtFrom(token.expires_in);
      return {
        authType: "oauth",
        credential: {
          accessToken,
          ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          tokenType: token.token_type ?? "Bearer",
          scopes,
        },
        identity: { id: profileId, login, displayName, attributes },
        accountId: claims.tid && claims.oid ? `${claims.tid}:${claims.oid}` : profileId,
        accountName: displayName || login,
        host: AZURE_HOST,
        scopes,
      };
    },

    async refreshCredential(credential, context): Promise<ProviderCredential> {
      if (!credential.refreshToken) {
        throw azureError("TOKEN_EXPIRED", "This Azure Repos connection has no refresh token. Reauthorize Azure Repos.");
      }
      const client = requireClient();
      const { host, ...runtime } = context ?? {};
      const token = await requestToken(
        resolveTenant(host),
        new URLSearchParams({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
          scope: client.scopes.join(" "),
        }),
        runtime,
      );
      const expiresAt = expiresAtFrom(token.expires_in);
      return {
        accessToken: token.access_token as string,
        // Entra may rotate refresh tokens; keep the previous one when none is returned.
        refreshToken: token.refresh_token || credential.refreshToken,
        ...(expiresAt ? { expiresAt } : {}),
        tokenType: token.token_type ?? credential.tokenType ?? "Bearer",
        scopes: parseScopes(token.scope, credential.scopes ?? client.scopes),
      };
    },

    async createRuntimeCredential(input) {
      if (!input.credential?.accessToken) {
        throw azureError("AUTH_REQUIRED", "This Azure Repos connection has no stored credential. Reauthorize Azure Repos.");
      }

      if (input.authType === "pat" || input.authType === "access_token") {
        const organization = input.accountScope?.trim();
        if (!organization) {
          throw azureError("AUTH_REQUIRED", "Azure DevOps personal access tokens require the organization name they are scoped to.");
        }
        return createRuntimeCredential({
          provider: "azure",
          connectionId: input.connectionId,
          organizationId: input.organizationId,
          apiBaseUrl: AZURE_API_BASE_URL,
          host: AZURE_HOST,
          // Azure DevOps PATs use HTTP Basic with an empty username.
          scheme: "basic",
          accessToken: input.credential.accessToken,
          accountScope: assertOrganizationName(organization),
          expiresAt: input.credential.expiresAt,
        });
      }

      if (input.authType !== "oauth") {
        throw azureError("AUTH_REQUIRED", `Azure Repos does not support ${input.authType} connections. Reauthorize Azure Repos.`);
      }

      return createRuntimeCredential({
        provider: "azure",
        connectionId: input.connectionId,
        organizationId: input.organizationId,
        apiBaseUrl: AZURE_API_BASE_URL,
        host: AZURE_HOST,
        scheme: "bearer",
        accessToken: input.credential.accessToken,
        expiresAt: input.credential.expiresAt,
      });
    },

    async getIdentity(credential, context) {
      // Organization-scoped PATs cannot read the global profile; connectionData works for any PAT with access to the org.
      if (isPatCredential(credential) && credential.accountScope) {
        return readConnectionData(credential, credential.accountScope, context);
      }

      const profile = await readProfile(credential, context);
      if (!profile.id) {
        throw azureError("INVALID_PROVIDER_RESPONSE", "Azure DevOps did not return a profile id.");
      }
      const login = profile.emailAddress || profile.publicAlias || profile.id;
      return { id: profile.id, login, displayName: profile.displayName || login };
    },

    async listAccounts(credential, context) {
      return listOrganizations(credential, context);
    },

    async listRepositories(credential, options, context) {
      const pageSize = Math.min(Math.max(Math.floor(options?.pageSize ?? 50), 1), 100);
      const cursor = decodeCursor(options?.cursor, { orgIndex: 0, offset: 0 });
      let orgIndex = Number(cursor.orgIndex);
      let offset = Number(cursor.offset);
      if (!Number.isInteger(orgIndex) || orgIndex < 0 || !Number.isInteger(offset) || offset < 0) {
        throw azureError("INVALID_PROVIDER_RESPONSE", "The repository page cursor is invalid.", 400);
      }

      const search = options?.search?.trim().toLowerCase();
      const organizations = await listOrganizations(credential, context);
      const items: ProviderRepository[] = [];
      let fetched = 0;

      while (orgIndex < organizations.length && items.length < pageSize && fetched < MAX_ORGANIZATIONS_PER_PAGE) {
        const organization = organizations[orgIndex]?.name as string;
        fetched += 1;

        let repositories: ProviderRepository[];
        try {
          repositories = await listOrganizationRepositories(credential, organization, context);
        } catch (error) {
          // An OAuth identity can belong to organizations backed by other tenants or with
          // restrictive policies; the profile/accounts calls above already proved the token
          // is valid, so skip organizations that refuse it instead of failing discovery.
          if (!isPatCredential(credential) && error instanceof GitProviderError && !error.retryable) {
            orgIndex += 1;
            offset = 0;
            continue;
          }
          throw error;
        }

        const matching = search ? repositories.filter((repo) => repo.fullName.toLowerCase().includes(search)) : repositories;
        const slice = matching.slice(offset, offset + (pageSize - items.length));
        items.push(...slice);

        if (offset + slice.length < matching.length) {
          offset += slice.length;
        } else {
          orgIndex += 1;
          offset = 0;
        }
      }

      return {
        items,
        nextCursor: orgIndex < organizations.length ? encodeCursor({ orgIndex, offset }) : null,
      };
    },

    async getRepository(credential, locator, context) {
      const data = await azureJson<AzureRepository>(`${repositoryBase(credential, locator)}?api-version=${API_VERSION}`, {
        provider: "azure",
        credential,
        repositoryKnown: true,
        subject: locator.fullName,
        ...context,
      });
      if (typeof data.id !== "string" || typeof data.name !== "string") {
        throw azureError("INVALID_PROVIDER_RESPONSE", `Azure Repos returned an invalid repository for ${locator.fullName}.`);
      }
      return toProviderRepository(data, assertOrganizationName(locator.owner));
    },

    async validateRepositoryAccess(credential, locator, context) {
      try {
        const repository = await provider.getRepository(credential, locator, context);
        return { accessible: true, repository };
      } catch (error) {
        if (error instanceof GitProviderError && !error.retryable) {
          return { accessible: false, errorCode: error.code, message: error.message };
        }
        throw error;
      }
    },

    async listTree(credential, locator, revision, context) {
      const { maxEntries, maxDepth, ...runtime } = context ?? {};
      const params = new URLSearchParams({
        scopePath: "/",
        recursionLevel: "Full",
        "versionDescriptor.version": revision,
        "versionDescriptor.versionType": "commit",
        "api-version": API_VERSION,
      });
      const data = await azureJson<{ value?: AzureItem[] }>(`${repositoryBase(credential, locator)}/items?${params.toString()}`, {
        provider: "azure",
        credential,
        repositoryKnown: true,
        subject: `${locator.fullName}@${revision}`,
        ...runtime,
      });

      const entries: RepositoryTreeEntry[] = [];
      for (const item of data.value ?? []) {
        const path = normalizeItemPath(item.path ?? "");
        // Skip the root folder and submodule (commit) entries.
        if (!path || item.gitObjectType === "commit") {
          continue;
        }
        if (maxDepth != null && path.split("/").length > maxDepth) {
          continue;
        }
        const isFolder = item.isFolder === true || item.gitObjectType === "tree";
        entries.push({ path, kind: isFolder ? "dir" : "file" });
        if (maxEntries != null && entries.length > maxEntries) {
          throw azureError(
            "INDEX_FAILED",
            `${locator.fullName} has more than ${maxEntries} entries at ${revision}; the repository exceeds the indexing limit.`,
            413,
          );
        }
      }
      return entries;
    },

    async readFile(credential, locator, revision, path, context) {
      const normalized = normalizeItemPath(path);
      if (!normalized) {
        throw azureError("INDEX_FAILED", "A file path is required.", 400);
      }
      const params = new URLSearchParams({
        path: `/${normalized}`,
        "versionDescriptor.version": revision,
        "versionDescriptor.versionType": "commit",
        $format: "octetStream",
        download: "true",
        "api-version": API_VERSION,
      });
      const { maxBytes, ...runtime } = context ?? {};
      const { body } = await azureRequest(`${repositoryBase(credential, locator)}/items?${params.toString()}`, {
        provider: "azure",
        credential,
        headers: azureHeaders({ Accept: "application/octet-stream" }),
        repositoryKnown: true,
        subject: `${locator.fullName}:${normalized}`,
        maxBytes,
        ...runtime,
      });
      return body;
    },

    async getDefaultBranch(credential, locator, context) {
      const repository = await provider.getRepository(credential, locator, context);
      if (!repository.defaultBranch) {
        throw azureError("INVALID_PROVIDER_RESPONSE", `${locator.fullName} has no default branch (empty repository?).`);
      }
      return repository.defaultBranch;
    },

    async resolveRevision(credential, locator, ref, context) {
      const trimmed = ref.trim();
      if (COMMIT_SHA_PATTERN.test(trimmed)) {
        return trimmed.toLowerCase();
      }
      if (!trimmed) {
        throw azureError("INVALID_PROVIDER_RESPONSE", `Azure Repos could not resolve an empty revision in ${locator.fullName}.`);
      }

      const candidates = trimmed.startsWith("refs/")
        ? [trimmed]
        : [`refs/heads/${trimmed}`, `refs/tags/${trimmed}`];
      for (const candidate of candidates) {
        const sha = await findRef(credential, locator, candidate, context);
        if (sha) {
          return sha;
        }
      }

      // Fall back to commit lookup (e.g. an abbreviated SHA). A 404 here means the
      // revision is unknown, not that the repository is inaccessible.
      try {
        const commit = await azureJson<{ commitId?: string }>(
          `${repositoryBase(credential, locator)}/commits/${encodeURIComponent(trimmed)}?api-version=${API_VERSION}`,
          { provider: "azure", credential, subject: `${locator.fullName}@${trimmed}`, ...context },
        );
        if (commit.commitId && COMMIT_SHA_PATTERN.test(commit.commitId)) {
          return commit.commitId.toLowerCase();
        }
      } catch (error) {
        if (!(error instanceof GitProviderError) || (error.code !== "REPOSITORY_NOT_FOUND" && error.code !== "INVALID_PROVIDER_RESPONSE")) {
          throw error;
        }
      }

      throw azureError("INVALID_PROVIDER_RESPONSE", `Azure Repos could not resolve '${sanitizeProviderText(trimmed, 200)}' in ${locator.fullName}.`);
    },

    parseRepositoryUrl(url) {
      return parseAzureReposUrl(url);
    },

    async inspectTokenPrivileges(credential) {
      if (!isPatCredential(credential)) {
        return [];
      }
      return [
        "Azure DevOps does not let Savant read a personal access token's scopes. Use a PAT scoped to this single organization with only the \"Code (Read)\" scope, and a short expiry.",
      ];
    },
  };

  return provider;
}
