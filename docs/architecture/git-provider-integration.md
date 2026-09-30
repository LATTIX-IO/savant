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
| GitHub | GitHub App installation | Contents: Read & write, Pull requests: Read & write, Metadata: Read. Installation tokens are down-scoped per request: read-only for syncs, write only to open an approved pull request | Installation id and account only. Installation tokens are minted on demand and never stored |
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

Legacy write operations (repository provisioning and scaffold apply) still use `legacy_env` credentials and commit directly. Managed connections only write through approved pull requests (see *Assessments and write-back*).

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

## Assessments and write-back

Every successful sync runs a deterministic **repository assessment** (`server/assessment/assess.ts`) after the index is committed. A failure here never fails the sync. It reports:

- **What is missing:** contract directories, registry files, and each required package file of a skipped skill, named exactly (`SKILL.md`, `metadata.yaml`, `agents/` or `eval/`).
- **What is inconsistent:** packages missing from the registry, registry entries without packages, unknown dependencies, owners, metadata fields, tier mismatches.
- **What limits quality:** thin or placeholder SKILL.md content, and no evaluation cases.

Findings are stored in `repository_assessments` (`0007`) with stable fingerprints, so dismissals survive later syncs. The sync response carries the summary, and the Repositories screen and the skill page show the findings with their next steps.

### Import-time evaluation (baseline)

Each sync also reads every package's `eval/dataset.yaml`, `eval/rubric.yaml` and `eval/baseline.json`.

- **Scored datasets.** Datasets with scored `samples` (the lattix-skills framework) are scored by `server/evaluation/scorecard.ts`, a port of the repository's own `scripts/run_eval.py`. It reproduces committed baselines exactly.
- **Where results go.** Results are written to `indexed_eval_assets` and `indexed_eval_results` (`0008`). Each result row holds `overall_score`, the full `scorecard`, per-case `case_results`, and `source = 'import'`, and is keyed on the indexed skill id. That id stays the same across syncs.
- **Who reads them.** These rows feed:
  - the Evaluations screen
  - the skill Evaluation tab (score, rubric breakdown, flagged cases)
  - version history
  - Skill Intelligence health (`evalBenchmark`, `regressionStability`, `authoredEvalCases`), which is SkillOpt's baseline
- **Findings.** A sync can raise these findings:
  - `EVAL_BASELINE_MISSING` or `EVAL_BASELINE_STALE`, fixable by a PR that updates `baseline.json`
  - `EVAL_BELOW_THRESHOLD` or `EVAL_BELOW_PASS`, which are reported but don't lower the readiness score
  - `EVAL_DATASET_INVALID`
  - `EVAL_REQUIRES_EXECUTION`, for unscored `cases`, which need a live run on the workspace's AI provider
- **What is not ingested.** Import evaluations are not ingested as `skill_runs`, so they don't blend into production telemetry.

**Write-back** always goes through a change proposal:

1. A fixable finding, or an edit made in the skill Builder, becomes a `repository_change_proposals` row with the full file contents and a diff. Nothing is written to the repository yet.
2. One Savant admin or repository manager approves it.
3. Savant re-reads the base branch and refuses to continue if any affected file changed since the proposal was made.
4. Savant resolves a write-scoped token, creates a `savant/<id>` branch, commits, and opens a pull request against the default branch. It never pushes to the default branch, so the repository's branch protection, required reviews and status checks decide whether and when it merges.
5. The pull request's state (open, merged or closed) is refreshed on every sync and whenever the assessment is viewed.

Opening pull requests is currently implemented for GitHub. Other providers' proposals fail with a clear message until their adapters implement `createChangeRequest`.

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

### Evaluation generation (LLM ↔ Jev) and skill safety (SkillSpector)

Many repositories don't have an answer key. For those, Savant generates one after sync, as a background job (`background_jobs`, `0009`). By default it does this for up to `EVAL_GENERATION_AUTO_LIMIT` skills per sync, and it can also be started from the skill's Evaluation tab. The loop is `server/evaluation/eval-generation.ts`.

1. **Draft.** NVIDIA NIM (`NIM_GENERATION_MODEL`) drafts positive, edge, negative and escalation cases from SKILL.md.
2. **Validate.** Jev checks each draft with typed questions:
   - in scope
   - which behaviour it tests
   - expected behaviour grounded in SKILL.md
   - clear
   - discriminating

   Code applies the thresholds. Rejected drafts go back to the LLM with their reasons, and borderline ones are held for review. Near-duplicates are dropped.
3. **Execute.** NIM runs the skill (SKILL.md as the system prompt) on each accepted case.
4. **Score.** Jev scores each output: quality, format and policy compliance, grounding, actionability, expected behaviour met, and revisions needed. Verdicts use the rubric's thresholds.
5. **Record.**
   - The output is `dataset.yaml`, `rubric.yaml` and `baseline.json` in the repository's scored-sample format. It round-trips through the import-time scorer.
   - The result is stored as a provisional baseline (`indexed_eval_results.source = 'generated'`) and proposed as a pull request.
   - Skills that already have a scored dataset get an **alignment** run instead. It compares the generated scorecard, and how many committed cases the generated set covers, with the committed answer key, and it never overwrites the committed dataset.
   - Run metrics include how many drafts Jev accepted. Without Jev, every draft would ship, which gives the with/without comparison.

**Safety.** NVIDIA SkillSpector scans every changed package after sync, inside a named, persistent Vercel Sandbox (`server/safety/skillspector.ts`).
- The static scan covers every package. Packages it flags get the LLM pass via NIM (`SKILLSPECTOR_LLM`).
- Results (`skill_safety_scans`) are merged into the repository assessment: `SAFETY_DO_NOT_INSTALL` is a blocker, and `SAFETY_CAUTION` is a warning.
- Package files are copied into the sandbox; repository credentials never enter it.

**Timing.** Jobs run in `after()` with a time budget. Work that doesn't fit is released back to the queue, and continues on the next sync, a skill-page poll, or `/api/internal/jobs/run` (Bearer `SAVANT_WORKER_TOKEN` or `CRON_SECRET`).

### Public skill catalog

Savant keeps a platform-level catalog of skills from reputable hubs. The tables are `skill_hub_sources`, `hub_skills`, `hub_skill_files` and `hub_skill_analyses` (`0010`). Sources:

| Source | How it's read |
|---|---|
| Anthropic `anthropics/skills` | GitHub tree + raw files |
| OpenAI `openai/skills` and `openai/plugins` | GitHub tree + raw files |
| Karpathy guidelines (community) | GitHub tree + raw files |
| skills.sh | `/api/v1` with the deployment's Vercel OIDC token; includes partner audits |
| ClawHub | Public API, `nonSuspiciousOnly`; includes its security status |
| SkillsMP | Search API; files come from the linked GitHub folder |

The same upstream skill listed by several hubs shares a `canonical_key`. The catalog shows it once and notes where else it's listed.

Pipeline (platform `background_jobs` with a null organization):

1. **`hub_sync`** (daily cron, `/api/internal/hub/sync`) fetches each source. It runs the static checks: frontmatter, thin instructions, placeholders, referenced files missing, executable scripts, license, and upstream security flags.
2. **`hub_safety`** runs SkillSpector over new or changed packages in the sandbox.
3. **`hub_eval`** runs the LLM↔Jev live evaluation. These skills have no answer key, so this gives them a starting baseline. It runs for the top `HUB_AUTO_EVAL_LIMIT` per source, or on demand from a workspace.

**Verdicts:**
- `unsafe`: SkillSpector says do not install.
- `caution`: SkillSpector says caution, or the upstream hub flagged it.
- `validated`: safe, and a live score of 70 or more.
- `analyzed`: scanned or evaluated, but not both passing.
- `unverified`: still in progress.

**Public read-only surfaces:** `/catalog` and `/catalog/[id]`, plus the JSON API `/api/public/catalog`.

**In the app:** `/o/<workspace>/catalog`. From there a workspace can run a live analysis, or **import** a skill into a connected repository. An import proposes the package under `tier2/imported/<source>/<slug>`. The proposal includes:
- contract `metadata.yaml` recording provenance and Savant's analysis
- an agent overlay
- the generated evaluations (or starter scaffolds)
- a registry entry

Approval opens a pull request. Unsafe skills can't be imported.

**Job runner.** It responds immediately and works in `after()`. When work remains, it hands the queue to a fresh invocation, authenticated with an internal token derived from `GIT_CREDENTIAL_ENCRYPTION_KEY`. This lets backlogs drain on the Hobby plan's daily crons.
