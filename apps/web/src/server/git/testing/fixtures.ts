import { GitProviderError } from "../errors.ts";
import {
  createRuntimeCredential,
  type CompletedAuthorization,
  type GitProvider,
  type GitProviderType,
  type ProviderCredential,
  type ProviderRepository,
  type RepositoryLocator,
  type RuntimeCredential,
} from "../types.ts";

/**
 * Deterministic provider fixtures (spec §38). Every token literal contains
 * "sample" so the repository secret scanner treats it as a fixture.
 */

export const SAMPLE_TOKENS = {
  valid: "sample-access-token-valid-0001",
  otherTenant: "sample-access-token-tenant-b-0002",
  revoked: "sample-access-token-revoked-0003",
  expired: "sample-access-token-expired-0004",
  refreshed: "sample-access-token-refreshed-0005",
  refresh: "sample-refresh-token-0006",
  revokedRefresh: "sample-refresh-token-revoked-0007",
  insufficientScope: "sample-access-token-noscope-0008",
  clientSecret: "sample-client-secret-0009",
  authorizationCode: "sample-authorization-code-0010",
  manualPat: "sample-manual-pat-0011",
} as const;

export const ALL_SAMPLE_SECRETS: readonly string[] = Object.values(SAMPLE_TOKENS);

export const VALID_SKILL_FILES: Record<string, string> = {
  "registry/skills.yaml": [
    "version: 1",
    "skills:",
    '  - skill_id: "legal/contract-review-assistant"',
    '    display_name: "Contract Review Assistant"',
    '    package_path: "tier2/methodology/legal/contract-review-assistant"',
    "    tier: tier2",
    '    status: "draft"',
  ].join("\n") + "\n",
  "registry/dependencies.yaml": "version: 1\ndependencies: []\n",
  "registry/owners.yaml": [
    "version: 1",
    "owners:",
    '  - owner: "legal-ops"',
    "    skills:",
    '      - "legal/contract-review-assistant"',
  ].join("\n") + "\n",
  "registry/routing-policies.yaml": "version: 1\npolicies: []\n",
  "tier2/methodology/legal/contract-review-assistant/metadata.yaml": [
    'skill_id: "legal/contract-review-assistant"',
    'display_name: "Contract Review Assistant"',
    "tier: tier2",
    'owner: "legal-ops"',
    'version: "1.2.0"',
    'status: "draft"',
  ].join("\n") + "\n",
  "tier2/methodology/legal/contract-review-assistant/SKILL.md": "# Contract Review Assistant\n\nReview contracts.\n",
  "tier2/methodology/legal/contract-review-assistant/agents/reviewer.md": "# Reviewer\n",
  "tier2/methodology/legal/contract-review-assistant/eval/cases.yaml": "cases: []\n",
};

export const MALFORMED_SKILL_FILES: Record<string, string> = {
  ...VALID_SKILL_FILES,
  "registry/skills.yaml": "version: 1\nskills: [unclosed\n  - : :\n",
};

export type FakeRepository = {
  repository: ProviderRepository;
  files: Record<string, string>;
  /** Extra tree paths (directories implied by files are added automatically). */
  extraPaths?: string[] | undefined;
  commitSha?: string | undefined;
  /** Tokens allowed to read this repository. */
  readableBy: string[];
};

export function makeRepository(input: {
  provider?: GitProviderType | undefined;
  id: string;
  owner: string;
  name: string;
  isPrivate?: boolean | undefined;
  defaultBranch?: string | undefined;
  host?: string | undefined;
}): ProviderRepository {
  const provider = input.provider ?? "github";
  const host = input.host ?? "github.com";
  return {
    providerRepositoryId: input.id,
    provider,
    host,
    owner: input.owner,
    name: input.name,
    fullName: `${input.owner}/${input.name}`,
    hierarchy: [input.owner],
    defaultBranch: input.defaultBranch ?? "main",
    webUrl: `https://${host}/${input.owner}/${input.name}`,
    cloneUrl: `https://${host}/${input.owner}/${input.name}.git`,
    isPrivate: input.isPrivate ?? true,
  };
}

export type FakeProviderControls = {
  repositories: FakeRepository[];
  /** Queue of failures injected before the next provider calls: 429 / 500. */
  injectedFailures: Array<"rate_limited" | "unavailable">;
  refreshCalls: number;
  revokeCalls: number;
  calls: string[];
  identity: { id: string; login: string };
  /** Authorization result returned by completeAuthorization. */
  authorization: Partial<CompletedAuthorization>;
};

function tokenOf(credential: RuntimeCredential): string {
  return credential.accessToken ?? "";
}

export function createFakeGitProvider(options?: {
  type?: GitProviderType | undefined;
  repositories?: FakeRepository[] | undefined;
  authorization?: Partial<CompletedAuthorization> | undefined;
}): { provider: GitProvider; controls: FakeProviderControls } {
  const type = options?.type ?? "github";
  const controls: FakeProviderControls = {
    repositories: options?.repositories ?? [],
    injectedFailures: [],
    refreshCalls: 0,
    revokeCalls: 0,
    calls: [],
    identity: { id: "4242", login: "lattix-bot" },
    authorization: options?.authorization ?? {},
  };

  function checkToken(credential: RuntimeCredential, operation: string) {
    controls.calls.push(operation);
    const failure = controls.injectedFailures.shift();
    if (failure === "rate_limited") {
      throw new GitProviderError("PROVIDER_RATE_LIMITED", "Rate limited (fixture).", { provider: type });
    }
    if (failure === "unavailable") {
      throw new GitProviderError("PROVIDER_UNAVAILABLE", "Provider 500 (fixture).", { provider: type });
    }

    const token = tokenOf(credential);
    if (token === SAMPLE_TOKENS.revoked) {
      throw new GitProviderError("TOKEN_REVOKED", "Token revoked (fixture).", { provider: type });
    }
    if (token === SAMPLE_TOKENS.expired) {
      throw new GitProviderError("TOKEN_EXPIRED", "Token expired (fixture).", { provider: type });
    }
    if (token === SAMPLE_TOKENS.insufficientScope) {
      throw new GitProviderError("INSUFFICIENT_SCOPE", "Missing read scope (fixture).", { provider: type });
    }
  }

  function find(credential: RuntimeCredential, locator: RepositoryLocator): FakeRepository {
    const match = controls.repositories.find((entry) =>
      (locator.providerRepositoryId && entry.repository.providerRepositoryId === locator.providerRepositoryId)
      || entry.repository.fullName.toLowerCase() === locator.fullName.toLowerCase());

    if (!match || !match.readableBy.includes(tokenOf(credential))) {
      // A private repository the credential cannot see looks missing; known repositories normalize to access denied.
      throw new GitProviderError("REPOSITORY_ACCESS_DENIED", `No access to ${locator.fullName} (fixture).`, { provider: type });
    }
    return match;
  }

  function treeFor(entry: FakeRepository): string[] {
    const paths = new Set<string>(entry.extraPaths ?? []);
    for (const file of Object.keys(entry.files)) {
      paths.add(file);
      const parts = file.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        paths.add(parts.slice(0, index).join("/"));
      }
    }
    return [...paths].sort();
  }

  const provider: GitProvider = {
    type,
    label: type === "github" ? "GitHub" : type,
    hierarchy: ["Account", "Repository"],
    requestedAccess: ["Contents: Read"],
    capabilities: {
      primaryAuth: type === "github" ? "github_app_installation" : "oauth",
      supportsRefresh: true,
      supportsRevocation: true,
      supportsSelfManaged: type === "gitlab",
      supportsManualToken: true,
      usesPkce: type !== "github",
    },
    isConfigured: () => true,
    configurationHint: () => null,

    async getAuthorizationUrl(request) {
      const url = new URL(`https://provider.fixture/${type}/authorize`);
      url.searchParams.set("state", request.state);
      if (request.codeChallenge) {
        url.searchParams.set("code_challenge", request.codeChallenge);
      }
      return url.toString();
    },

    async completeAuthorization(callback, exchange) {
      if (callback.get("error")) {
        throw new GitProviderError("AUTH_REQUIRED", "Authorization declined (fixture).", { provider: type });
      }
      if (type !== "github" && callback.get("code") !== SAMPLE_TOKENS.authorizationCode) {
        throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "Bad code (fixture).", { provider: type });
      }
      if (type !== "github" && !exchange.codeVerifier) {
        throw new GitProviderError("AUTHORIZATION_STATE_INVALID", "PKCE verifier missing (fixture).", { provider: type });
      }

      const installationId = type === "github" ? callback.get("installation_id") ?? undefined : undefined;
      return {
        authType: type === "github" ? "github_app_installation" : "oauth",
        credential: type === "github"
          ? null
          : { accessToken: SAMPLE_TOKENS.valid, refreshToken: SAMPLE_TOKENS.refresh, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        identity: { id: controls.identity.id, login: controls.identity.login, displayName: controls.identity.login },
        accountId: installationId ? `acct-${installationId}` : controls.identity.id,
        accountName: "LATTIX-IO",
        ...(installationId ? { installationId } : {}),
        host: `${type}.fixture`,
        scopes: ["read"],
        ...controls.authorization,
      };
    },

    async refreshCredential(credential: ProviderCredential) {
      controls.refreshCalls += 1;
      if (credential.refreshToken === SAMPLE_TOKENS.revokedRefresh) {
        throw new GitProviderError("TOKEN_REVOKED", "invalid_grant (fixture).", { provider: type });
      }
      return {
        accessToken: SAMPLE_TOKENS.refreshed,
        refreshToken: `${SAMPLE_TOKENS.refresh}-rotated`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    },

    async revokeCredential() {
      controls.revokeCalls += 1;
    },

    async createRuntimeCredential(input) {
      const token = input.authType === "github_app_installation"
        ? (input.installationId === "revoked-installation" ? SAMPLE_TOKENS.revoked : SAMPLE_TOKENS.valid)
        : input.credential?.accessToken ?? null;
      if (!token) {
        throw new GitProviderError("AUTH_REQUIRED", "No credential (fixture).", { provider: type });
      }
      return createRuntimeCredential({
        provider: type,
        connectionId: input.connectionId,
        organizationId: input.organizationId,
        apiBaseUrl: `https://api.${type}.fixture`,
        host: input.host ?? `${type}.fixture`,
        accessToken: token,
        ...(input.installationId ? { installationId: input.installationId } : {}),
      });
    },

    async getIdentity(credential) {
      checkToken(credential, "getIdentity");
      return { id: controls.identity.id, login: controls.identity.login, displayName: controls.identity.login };
    },

    async listRepositories(credential, listOptions) {
      checkToken(credential, "listRepositories");
      const visible = controls.repositories
        .filter((entry) => entry.readableBy.includes(tokenOf(credential)))
        .map((entry) => entry.repository)
        .filter((repository) => !listOptions?.search || repository.fullName.includes(listOptions.search));
      const offset = Number(listOptions?.cursor ?? 0);
      const pageSize = listOptions?.pageSize ?? 50;
      const items = visible.slice(offset, offset + pageSize);
      return { items, nextCursor: offset + pageSize < visible.length ? String(offset + pageSize) : null };
    },

    async getRepository(credential, locator) {
      checkToken(credential, "getRepository");
      return find(credential, locator).repository;
    },

    async validateRepositoryAccess(credential, locator) {
      try {
        const repository = await provider.getRepository(credential, locator);
        return { accessible: true, repository };
      } catch (error) {
        if (error instanceof GitProviderError && !error.retryable) {
          return { accessible: false, errorCode: error.code, message: error.message };
        }
        throw error;
      }
    },

    async readFile(credential, locator, _revision, path) {
      checkToken(credential, `readFile:${path}`);
      const content = find(credential, locator).files[path];
      if (content === undefined) {
        throw new GitProviderError("REPOSITORY_NOT_FOUND", `${path} missing (fixture).`, { provider: type });
      }
      return Buffer.from(content, "utf8");
    },

    async listTree(credential, locator, _revision, context) {
      checkToken(credential, "listTree");
      const paths = treeFor(find(credential, locator));
      if (context?.maxEntries != null && paths.length > context.maxEntries) {
        throw new GitProviderError("INDEX_FAILED", "Too many entries (fixture).", { provider: type, status: 413 });
      }
      const files = new Set(Object.keys(find(credential, locator).files));
      return paths.map((path) => ({ path, kind: files.has(path) ? "file" as const : "dir" as const }));
    },

    async getDefaultBranch(credential, locator) {
      return (await provider.getRepository(credential, locator)).defaultBranch ?? "main";
    },

    async resolveRevision(credential, locator) {
      checkToken(credential, "resolveRevision");
      return find(credential, locator).commitSha ?? "0123456789abcdef0123456789abcdef01234567";
    },

    parseRepositoryUrl: () => null,
  };

  return { provider, controls };
}
