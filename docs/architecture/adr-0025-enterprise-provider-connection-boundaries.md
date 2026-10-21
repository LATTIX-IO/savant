# ADR-0025 — Enterprise provider connection boundaries and UI handoff

**Status:** Proposed / parked for future connector development.
**Decision date:** 2026-10-21.
**Request owner:** Savant founder and sole operator.
**Current implementation increment:** PER-1607 (UI only).
**Deferred execution:** PER-1602 (server-enforced evaluation/production profiles), PER-1603 (provider-specific authorization), PER-1592 (recoverable production database and managed keys), PER-1421 (observed provider-backed tests, bills and cost evidence).

## Captured product direction

Savant should make it possible for a workspace owner to connect a provider using its official supported identity or enterprise authorization methods, without forcing every end user to copy an API key. The intended use cases are distinct:

1. **Test inference:** a dedicated model/executor for actual evaluation cases, separate from its scoring judge, with explicit budgets and source-pinned results.
2. **Production inference:** the organization's chosen execution provider for end-user skills and workflows, with an independently enforced default, model policy, quota, budget, audit, and credentials.
3. **Enterprise workspace integration:** organization-level access between Savant and ChatGPT/Codex or Claude/Claude Code for authorized actions, data visibility, plugins/MCP connections, and governance telemetry.

Requested user experience: a visible, organization-aware connection entry for OpenAI and Anthropic, including a sign-in method if approved. A connection at enterprise scope should apply to authorized organization members according to permissions. **This expresses intended Savant behavior; it is not evidence that any provider exposes one global OAuth grant for all three uses.**

Per the 2026-10-21 user direction, **focus on the UI first and defer connector implementation**. This ADR is a durable technical handoff, not approval to launch OAuth.

## Direction and authority matrix

| Integration direction | Intended service | Who authorizes it | Capabilities actually granted |
|---|---|---|---|
| Savant → AI provider | Evaluation executor, judge, or independently governed production inference | Provider API/project service owner, supported workload federation, or vendor-approved user delegation | Only specifically consented model calls for the stated purpose and billing scope |
| ChatGPT/Codex or Claude → Savant | Savant MCP/plugin connector for tools and governed skill data | Savant tenant admin/user plus provider plugin enrollment | Only Savant tools, resources and methods allowed by the Savant resource server |
| Provider workspace → Savant | Enterprise compliance, usage/operational visibility, events and administrator evidence | Provider organization owner with separate admin/compliance scopes | Only the provider's authorized telemetry and data; no model inference implied |

For any future connection persist or securely derive: Savant tenant ID; external provider product and organization/workspace/project IDs; direction; runtime purpose; authorized user, group or service principal; consent and grant scope; token/credential kind and issuer; model, budget, billing owner and cost basis; independent expiration, refresh and revoke; and observed data provenance. Do not infer tenant/project access from the email domain alone. No client-supplied tenant override, hidden fallback, cross-tenant token reuse, or silent Test Bench/production interchange.

## Provider findings and assumptions needing validation

### OpenAI: ChatGPT Enterprise is not the same boundary as OpenAI API Platform

- ChatGPT Enterprise grants access to a managed ChatGPT product/workspace subject to its own SSO, membership, plan and administrator policies. API Platform organization and project membership are separate. ChatGPT Enterprise billing and API Platform billing are separately administered; an Enterprise seat by itself does not authorize Savant inference or prove API spend is covered.
- Official **Sign in with ChatGPT** offers OIDC/OAuth Authorization Code + PKCE for identity and additional eligible inference scopes in participating integrations. It is currently limited for commercial clients. For Savant, request an approved client/partner integration and confirm whether desired commercial enterprise workspaces have any applicable plan-backed inference entitlement, rather than assuming all Enterprise seats do.
- The current Savant Test Bench directly calls the permitted OpenAI API via tenant-owned OpenAI credentials, not ChatGPT subscription tokens. Future no-pasted-key execution could use provider-approved account delegation where granted or a separately managed API Platform project/service principal.
- A **Savant plugin/MCP server inside ChatGPT or Codex** is the opposite direction: the user's ChatGPT session authorizes a scoped Savant resource. Savant must verify each JWT/session and tool grant and cannot treat plugin installation as inference entitlement.
- A **ChatGPT Enterprise Compliance Platform connector** is a separate admin-consented ingestion channel for audit/usage/authorized conversations, with distinct log permissions, privacy and retention requirements. It is not a general inference credential.

### Anthropic: distinguish Claude's workspace connectors, service workloads, and CLI auth

- Claude Enterprise supports organization-managed MCP connector authorization; admins may make an approved connector available to eligible organizational roles. Installing Savant as a connector permits *Claude to call Savant*, not Savant to consume Claude inference.
- For Savant-hosted **Claude API inference**, the supported enterprise no-static-key approach includes Anthropic Workload Identity Federation. A trusted OIDC identity from the customer's workload/IdP exchanges for a short-lived service-account token scoped to an Anthropic workspace and subject to API billing/limits. Static API credentials remain a separate option where authorized.
- An unmodified **Claude Code CLI** can have the human authenticate directly under applicable vendor terms. Savant must not extract browser credentials, subscription OAuth files or relay user Pro/Max session tokens to a hosted multi-tenant inference service. Do not show a working hosted “Sign in with Claude” OAuth button without explicit Anthropic permission.
- The **Claude Enterprise Compliance API** is an independent, permissioned activity/conversation/session evidence feed and must not be implemented through a Claude inference token.

## Required separation of inference roles

| Runtime role | Tenant binding | Authentication and execution | Retention and billing |
|---|---|---|---|
| Evaluation executor | Workspace or explicit permitted suite | Pin connection ID, model, credential version/fingerprint, suite SHA and source revision per run | Provider usage receipt, independent QA quota, provider budget and source accounting |
| Evaluation judge | Workspace independent of executor | Pin rubric/judge model/config; platform JEV remains current accepted judge | Independent judge receipts; never describe a BYO judge metadata default as active routing |
| Production inference | Workspace organization and authorized users | Separate production connection/allowlist/default, scopes, model and key; no test fallback | Distinct usage quotas, cost allocation, anomaly controls, live SLO and policy |
| Enterprise connector / compliance | Organization/admin consent and user roles | OAuth-protected Savant MCP resource OR separately permitted provider compliance source | Per-actor audit, retention, role rechecks, least privilege and revocation |

Current server-side provider contract remains narrower: workspace default OpenAI API execution OR platform NIM, with platform JEV judgment. The existing AI connection fields isDefaultExecution and isDefaultJudge and free-text purpose are **not independently enforced production-serving permissions**. Do not implement only a UI choice for production; PER-1602 must bind and authorize every provider call server-side. If legacy connection metadata is ambiguous, fail closed.

### Credential and consent policy

- Treat authentication, inference authorization, enterprise telemetry permission, and provider-side plugin consent as **four different grant types**; all must have distinct lifecycle and audience validation.
- OAuth state/nonce, PKCE, exact issuer/audience, replay protection, callback allowlisting, secure server-side token vaulting, short-lived sessions and explicit user/admin revocation are mandatory if approved OAuth is added.
- Workload identity federation requires trust rules bound to issuer, subject, workspace and audience; no arbitrary tenant-controlled URLs at model egress.
- Enterprise operator may authorize connector enrollment, but this does not bypass per-user Savant membership/role and tool permissions. Authenticate and authorize on every request.
- Test and production credentials have separate key ownership, provider project identifiers and cost caps. A revoked/expired test authorization must never silently fall back to production billing.
- Actual provider/model usage evidence cannot be manufactured from imported evaluations, dashboard fixtures or user-facing planned connection status.

## Immediate UI contract — PER-1607

- In **Integrations → Model providers**, preserve existing read-only provider metadata, and add **Test inference provider**, **Production / enterprise inference provider**, plus **Enterprise connectors and organization telemetry** areas.
- Add the same entry to **Settings → AI providers** using the shared Savant v2 design system.
- The real **Configure existing test API provider** link/button reaches the existing role-gated AI credential editor. It does not claim a successful provider-backed run.
- **Continue with ChatGPT**, **Connect Claude Code runtime**, **Connect enterprise inference**, and **Authorize enterprise workspace** remain **disabled** with explicit explanation and no OAuth endpoints or token requests.
- A collapsed **Developer notes** region links to this source ADR and the deferred Linear issues. The UI must not claim a live enterprise inference connection or that Enterprise SSO includes provider API entitlements.
- No new database migration, encryption key, authenticated server route, runtime selection, provider charge, or production flag occurs in PER-1607.

## Deferred delivery sequence

1. **Vendor eligibility and surface mapping** (PER-1603): obtain OpenAI commercial approval/scopes; validate OpenAI Enterprise versus API organization permission and compliance routes; confirm Anthropic managed MCP, WIF and unmodified Claude Code terms. Record unsupported/unknown instead of speculative OAuth.
2. **Typed provider connection/auth contract** (PER-1602): tenant/org scope, direction, explicit test/judge/production roles, auth type, enterprise metadata and independent accounting policies. Prepare schema and backward-compatibility rules.
3. **Provider invocation guardrail**: enforce server-side role binding and secrets, pin versions, budgets, idempotency, no retry after uncertain external provider receipt, no provider fallback between roles.
4. **Provider→Savant connectors**: protected Savant MCP/OAuth 2.1 authorization server/resource, scoped tools, grants, admin enrollment, role restrictions and audit.
5. **Provider enterprise visibility**: separate Compliance/usage ingestion adapters with least-privilege admin approval, cursoring, tenancy and retention.
6. **Operational validation** (PER-1592, PER-1421, PER-1585, PER-1586): database restore and key activation, genuine test/production provider use, cross-tenant denial, expired/revoked tokens, role/group changes, measured cost attribution, rollout and rollback.

## Official sources — checked 2026-10-21

- OpenAI Sign in with ChatGPT: https://developers.openai.com/siwc/quickstart
- OpenAI approved commercial OAuth: https://developers.openai.com/siwc/website
- OpenAI plugin/MCP OAuth: https://developers.openai.com/plugins/build/auth
- OpenAI billing separation: https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- OpenAI managed workspace SSO: https://help.openai.com/en/articles/9534785-configuring-sso-for-chatgpt
- OpenAI Enterprise Compliance Platform: https://help.openai.com/en/articles/9261474
- Claude managed enterprise MCP authorization: https://support.claude.com/en/articles/15537633-authorize-mcp-connectors-for-your-entire-organization
- Claude workload identity federation: https://platform.claude.com/docs/en/manage-claude/workload-identity-federation
- Claude Enterprise compliance: https://support.claude.com/en/articles/15167101-get-started-with-claude-compliance-api-integrations
- Claude Code legal/compliance (recheck before implementation): https://code.claude.com/docs/en/legal-and-compliance

**ADR review state:** Requirements and publicly documented vendor behavior are captured. Enterprise partner eligibility, scopes, plan entitlements, connector permissions and commercial terms remain to be confirmed with each provider before implementing OAuth or enterprise API access.
