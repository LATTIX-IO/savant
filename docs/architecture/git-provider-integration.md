# Git provider integration

Savant reads private skill repositories from GitHub (including GitHub Enterprise Cloud), GitLab.com and GitLab Self-Managed, Bitbucket Cloud, and Azure DevOps / Azure Repos. Users connect providers from **Settings → Source control**. No per-tenant tokens, deployment environment variables, or hand-written `git_provider_connections` rows are needed.

```
Settings → Source control → Connect → provider authorization → choose repositories
        → repository + explicit connection association → initial index → skills
```

## Layout

All provider-specific code sits behind the `GitProvider` contract in `apps/web/src/server/git/`:

| Module | Responsibility |
| --- | --- |
| `types.ts` | Domain model, `GitProvider` contract, self-redacting `RuntimeCredential` |
| `providers/{github,gitlab,bitbucket,azure-repos}.ts` | Provider adapters (auth, discovery, tree/file reads, error translation) |
| `providers/registry.ts` | The only place that maps a provider type to an adapter |
| `credential-broker.ts` | Connection id → tenant check → decrypt/mint → refresh → ephemeral credential |
| `secret-vault.ts` | AES-256-GCM credential encryption; key from `GIT_CREDENTIAL_ENCRYPTION_KEY` |
| `oauth-state.ts` | Single-use, expiring, hashed OAuth state with PKCE |
| `connection-service.ts` | Authorize/callback, discovery, validation, disconnect, manual tokens, reconciliation |
| `connection-resolver.ts` | Deterministic repository → connection resolution |
| `repository-service.ts` | Idempotent connect-selected transaction, removal, sync status |
| `repository-reader.ts` | Provider-independent tree + skill-file reader with size limits |
| `repository-sync-service.ts` | Sync pipeline, coalescing, failure semantics, audit, metrics |
| `stores*.ts` | Tenant-scoped persistence contracts, Postgres and in-memory implementations |
| `errors.ts`, `http.ts` | Standardized error codes, retry with jittered backoff, remediation text |
| `redaction.ts`, `host-validation.ts`, `observability.ts` | Log/audit redaction, SSRF guard, metrics and spans |

`indexRepositoryById` in `server/control-plane/repository-index.ts` delegates to the sync pipeline, so the Sync button, polling, webhooks, and connect-time indexing all use the same path. The pipeline is: resolve the exact connection → `CredentialBroker.resolve()` → `validateRepositoryAccess` → resolve the ref → read the tree → discover skills → validate definitions → atomically replace the index → set `indexedAt`. A failed sync only updates `repository_sync_state`, so the previous index stays intact.

## Provider authentication

| Provider | Primary flow | Access requested | Persisted |
| --- | --- | --- | --- |
| GitHub | GitHub App installation | Contents: Read, Metadata: Read. Installation tokens are also down-scoped per request | Installation id and account only. Installation tokens are minted on demand and never stored |
| GitLab | OAuth 2.0 + PKCE; self-managed via an instance OAuth app | `read_repository`, `read_api` (project discovery), `read_user` | Encrypted access and refresh tokens, plus the instance client for self-managed |
| Bitbucket Cloud | OAuth 2.0 client | Repositories: Read, Account: Read, Workspace membership: Read | Encrypted access and refresh tokens |
| Azure Repos | Microsoft Entra ID OAuth v2 + PKCE (not the deprecated Azure DevOps OAuth) | `499b84ac-1321-427f-aa17-267ca6975798/vso.code`, `offline_access` | Encrypted tokens, tenant id and object id |

Manual access tokens (Settings → Source control → Advanced) are an escape hatch for cases like GitHub Enterprise or troubleshooting. They are validated before they are saved, encrypted immediately, and never shown again. Savant warns when a token carries write or admin scopes that the provider reports.

### GitHub App callback security

The installation id arrives as a query parameter. Savant only accepts it after it has proven that the user who completed the flow can access that installation. It does this with the App's user-authorization code and `GET /user/installations`. Enable **Request user authorization (OAuth) during installation** on the app. Production refuses unverified installations unless `GITHUB_APP_ALLOW_UNVERIFIED_INSTALLATIONS=true` is set.

## Setup runbook

1. Apply `db/schema/0006_git_provider_integration.sql` (`pnpm db:migrate`).
2. Set `GIT_CREDENTIAL_ENCRYPTION_KEY` in the deployment secret store (`openssl rand -base64 32`). Never put it in the database.
3. Register an app with each provider. The callback URL is `<APP_BASE_URL>/api/git/connections/<provider>/callback`, where provider is one of `github`, `gitlab`, `bitbucket` or `azure`. Callback URLs are built from configuration and never from request headers.
   - **GitHub App:** repository permissions Contents: Read and Metadata: Read, with no write permissions. Set both the Setup URL and the user-authorization Callback URL to the GitHub callback, and enable user authorization during installation (with it enabled, GitHub returns to the Callback URL with `code`, `installation_id` and `state`; confirm `state` round-trips on your GitHub plan before rollout). Configure `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`.
   - **GitLab.com:** an OAuth application with scopes `read_repository read_api read_user`. Configure `GITLAB_OAUTH_CLIENT_ID` and `GITLAB_OAUTH_CLIENT_SECRET`.
   - **Bitbucket:** Workspace settings → OAuth clients, grant types Authorization code and Refresh token, scopes Account: Read, Workspace membership: Read and Repositories: Read. Configure `BITBUCKET_OAUTH_CLIENT_ID` and `BITBUCKET_OAUTH_CLIENT_SECRET`.
   - **Azure:** a Microsoft Entra app registration with the Azure DevOps delegated `vso.code` permission. Configure `AZURE_DEVOPS_ENTRA_CLIENT_ID`, `AZURE_DEVOPS_ENTRA_CLIENT_SECRET` and, optionally, `AZURE_DEVOPS_ENTRA_TENANT`.

Settings shows a provider as configured only when both its app configuration and the encryption key are present.

## Repository → connection resolution

1. `repositories.connection_id`
2. the `repository_connections` association
3. migration fallback: exactly one active, compatible connection in the organization. After a successful read, Savant writes this association so it becomes explicit.
4. otherwise `CONNECTION_REQUIRED` if there are no candidates, or `CONNECTION_AMBIGUOUS` if there are several. Savant never picks one of several credentials. Choose one with `PUT /api/repositories/:id/connection`.

A public repository with no connection may still be read anonymously. A repository is never read anonymously while it has a resolvable connection.

## Migration from `credentials_ref`

- **Phase A (this migration):** existing rows become `auth_type = 'legacy_env'`. `credentials_ref` becomes nullable and is kept.
- **Phase B:** resolution uses the explicit association first, then the unique-connection fallback. The broker still resolves `legacy_env` credentials from the environment.
- **Phase C:** the UI labels legacy connections ("Legacy credential — reauthorize using the Savant integration"). Reauthorizing a legacy connection converts its reads in place to the managed credential; its `credentials_ref` is kept so repository write operations continue to work.
- **Phase D:** nothing in the application creates `legacy_env` rows. Deployment secrets are not deleted automatically.

Repository write operations (provisioning, scaffold commits) still use `legacy_env` credentials, because managed connections are read-only (INV-GIT-09).

### LATTIX-IO/lattix-skills recovery

After the Savant GitHub App is authorized, reconciliation looks for repositories of the same provider that have no connection. For each one it checks read access with the new installation and associates it only when the match is unique. The repository is then re-indexed, with no deletion, reconnection, `GITHUB_WRITE_TOKEN` or SQL. This whole flow is covered by `server/git/acceptance.test.ts`.

## API

```
GET    /api/git/providers
GET    /api/git/connections                     POST (manual token)
POST   /api/git/connections/:provider/authorize
GET    /api/git/connections/:provider/callback
GET    /api/git/connections/:id                 DELETE (disconnect)
POST   /api/git/connections/:id/validate
POST   /api/git/connections/:id/reauthorize
GET    /api/git/connections/:id/repositories    (?cursor=&search=, server-side pagination)
GET    /api/repositories                        POST (connect selected)
GET    /api/repositories/:id                    DELETE (remove repository)
POST   /api/repositories/:id/sync
GET    /api/repositories/:id/sync-status
PUT    /api/repositories/:id/connection
```

`:provider` and `:id` share the `[id]` route segment. Every tenant route takes the organization from the authenticated context (`workspaceSlug` plus session membership). The OAuth callback takes it only from the stored state, and that state must belong to the same signed-in user.

**Roles:**

| Role | Who | Can |
| --- | --- | --- |
| Admin | workspace owner, `platform-admins` | connect, disconnect and reauthorize providers; assign connections |
| Repository manager | `repository-managers` | connect, sync and remove repositories; validate connections |
| Member | everyone else | view |

## Error model and states

Adapters translate native failures into the codes in `@savant/types` (`GitProviderErrorCode`). A 404 for a repository Savant already knows about is reported as `REPOSITORY_ACCESS_DENIED`, not as a missing repository. Responses 429, 5xx and network errors are retried with jittered exponential backoff and never invalidate authorization. A 401 or `invalid_grant` marks the connection `needs_reauthorization` or `revoked`.

Connection state (`active`, `needs_reauthorization`, `revoked`, `error`, `disconnected`) is tracked separately from repository indexing state (`pending`, `indexing`, `ready`, `failed`, `auth_required`, `access_revoked`).

Disconnecting a provider deletes its credential and marks its repositories `auth_required`. Repository metadata and indexed skills are kept. Removing a repository deletes its skills and leaves the provider connection alone.

## Security controls

- **Encryption:** credentials are encrypted at rest with AES-256-GCM. The additional authenticated data binds each ciphertext to its organization and connection, and the key is held outside the database.
- **No credential in serialized output:** `RuntimeCredential` has a non-enumerable token and redacts itself in `toJSON` and `inspect`. Index jobs carry ids only.
- **Audit allowlist:** audit payloads keep only allowlisted keys (`sanitizeGitAuditPayload`). Logs pass through `redactString` and `redactValue`, which cover bearer tokens, the GitHub, GitLab and Atlassian token formats, JWTs, PEM keys, `code`/`token` query parameters, and credentials in URLs.
- **SSRF:** self-managed hosts must use HTTPS, and Savant rejects them if they resolve to loopback, link-local, metadata or private addresses. An exception needs an explicit `GIT_PROVIDER_ALLOWED_PRIVATE_HOSTS` entry. Pagination cursors never contain URLs. Bitbucket and GitLab `next` links are only followed on the provider's API origin.
- **Tenant isolation:** every store query is constrained by organization id, and ids from another organization behave as not found. This is covered by `server/git/security.test.ts`.

## Observability

- **Metrics:** `git_connection_total`, `git_repository_sync_total`, `git_repository_sync_duration_seconds`, `git_provider_request_total`, `git_provider_auth_failure_total` and `git_repository_indexed_skills` (see `observability.ts`).
- **Spans:** `repository.sync` → `git.connection.resolve`, `git.credential.resolve`, `provider.repository.validate`, `provider.tree.read`, `skill.discovery`, `skill.validation` and `skill.index.commit`. Span attributes are restricted to an allowlist.

## Tests

The CI tests are deterministic and need no network (`pnpm test`):

| Suite | Covers |
| --- | --- |
| `server/git/core.test.ts` | vault, redaction, SSRF, URL parsing, HTTP retry, OAuth state |
| `server/git/provider-contract.test.ts` | every adapter against the same contract |
| `server/git/connection-lifecycle.test.ts` | callback binding, encryption, refresh, validation, disconnect, legacy |
| `server/git/repository-sync.test.ts` | connect, initial index, failure retention, resolution order, coalescing, limits |
| `server/git/security.test.ts` | tenant isolation and credential leakage |
| `server/git/acceptance.test.ts` | the spec §43 scenario against the real GitHub adapter with RS256 JWT verification |
| `server/git/providers/*.test.ts` | adapter-specific behaviour |

Tests against live providers should live in a separate, opt-in suite.

## Known limitations

- Indexing runs after the response through `after()`, bounded by `maxDuration`. Jobs carry identifiers only, so a queue-backed scheduler can replace `createAfterResponseIndexScheduler` without changing callers.
- GitHub Enterprise Server needs `GITHUB_WEB_BASE_URL` and `GITHUB_API_BASE_URL` overrides and is untested.
- A GitLab instance served under a relative URL root (such as `/gitlab`) loses the path after the first exchange.
- Some Bitbucket and Azure API details are still unconfirmed against the live APIs: Bitbucket's post-CHANGE-2770 workspace listing and its `max_depth` recursion, and the Azure accounts and items API versions. Their adapter tests encode the assumptions.
- Host validation resolves DNS before each request, but it does not pin the resolved address for the connection itself.
