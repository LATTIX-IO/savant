# PER-1608 — Enterprise AI provider preflight (2026-10-22)

Scope: authenticated tenant-scoped **read-only** provider capability catalog for OpenAI/ChatGPT/Codex, Anthropic/Claude, Microsoft 365 Copilot. The UI displays unconfigured/grant-unverified for every ecosystem; no external OAuth app, billing permissions, tenant inventory, provider health, compliance feed, model routing or skill deployment is inferred.

API: GET /api/enterprise-ai/providers, using existing authorizeTenantRequest. Any authenticated tenant gets public capability prerequisites for that selected tenant; no secret, external organization identifier or other tenant's grant is returned. POST and state mutation intentionally absent.

Client: existing IntegrationsV2 Models tab embeds EnterpriseAIProviderPreflight. It does not replace Settings, the existing AI connection encrypted credential editor, or the disabled PER-1607 enterprise authorization controls.

The catalog is a product support matrix, not grant discovery. Individual feature coverage is **unknown** until appropriate provider consent and entitlement. Capability state remains explicitly unconfigured even if an OpenAI API key exists in the separate ai_connections store.

Registration is postponed until:
1. PER-1602 independently enforces evaluation executor/judge/production roles and budgets.
2. PER-1603 establishes secure redirect, CSRF/PKCE, server-side vaulting, revoke and consent scope checks where provider-approved OAuth is available.
3. PER-1592 verifies dedicated recoverable AI_CONNECTION and TEST_BENCH keys, schema and database restore.
4. PER-693 implements provider-specific publishing; PER-982 implements authorized telemetry with provenance and limited retention.
5. PER-1421 records real cost/usage acceptance.

Vendor portals later: OpenAI API Platform for service credentials (ChatGPT managed MCP is separate); Anthropic Console for Claude API workspace, with federation preferable where supported; Microsoft Entra for Graph app registration and Copilot administration via Microsoft 365 admin center/Copilot Studio. Never harvest consumer chat/CLI tokens or treat a ChatGPT/Claude subscription as API billing.

Tests: catalog has three independent ecosystems and never produces affirmative grants. API rejects unauthenticated/development-fallback tenants. Frontend isolates tenant request scope and cannot present a success state from static capability metadata. No production configuration or schema changes in this increment.
