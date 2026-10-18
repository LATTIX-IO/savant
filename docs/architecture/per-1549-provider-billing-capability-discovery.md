# PER-1549 — Vendor billing-interface discovery and fail-closed eligibility

Status: evidence collection and unsupported-export enforcement. This is **NOT** completion of PER-1548 provider reconciliation.

## Actual Savant endpoints and sources (verified 2026-10-16)

### NVIDIA-hosted NIM

- Actual application defaults from `apps/web/src/server/ai/clients.ts`: `https://integrate.api.nvidia.com/v1/chat/completions`; model `nvidia/nemotron-3-super-120b-a12b`.
- NVIDIA's official [LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis) describes hosted inference, model usage and OpenAI-compatible completion behavior. [NIM developer FAQ](https://docs.api.nvidia.com/nim/docs/product) distinguishes hosted preview/developer access from production AI Enterprise licensing and describes **GPU-based** NIM licensing for production/self-hosted. This does **not** prove a contracted provider token charge or per-request invoice source for the Savant account.
- NVIDIA public materials consulted did not establish an authenticated account-level invoice/rated export endpoint, signed export format, billable request identifier, or immutable account identity for the configured hosted catalog origin. Status: **NOT VERIFIED**. Do not derive actual platform charges from the `usage` token counts or public price sheets.
- NIM can be self-hosted or hosted; a future change of `NIM_BASE_URL` must reclassify its commercial model. A self-hosted/NVIDIA Enterprise deployment is NOT a synonym for a hosted token-priced provider.

### TypeSafe Jev

- Actual default: `https://api.typesafe.ai/v1/systemone`; default model alias `jev-latest`. Verified against [first-party public OpenAPI](https://api.typesafe.ai/openapi.json), whose documented routes are **POST /v1/systemone** and **GET /v1/models**. The response includes model, answers, and `usage.input_tokens` / `usage.output_tokens`. The public API specification does **not** describe an authenticated billing export, per-request invoice/transaction ID, or account-ledger read endpoint.
- [TypeSafe master customer agreement](https://typesafe.ai/legal/mca) documents account credits and variable order-specific fees. Its public price is not necessarily the Savant contract. The product may report usage counts without giving a provider-issued billing reference that can be joined to a statement.
- Status: account balance, invoice export, request identity and contracted micro-USD rate are all **NOT VERIFIED** for Savant. Do not mistake unrelated Jev-branded gateways/domains for TypeSafe; their credentials, rates and APIs are not interchangeable.
- `jev-latest` is a moving alias. When reconciling, require the returned concrete model version and the approved rate card effective at call time. Do not assume account-level exports can be mapped to Test Bench run IDs without a documented provider-issued join key.

### Tenant-owned OpenAI

Tenant-owned OpenAI API calls are **externally billed**. Savant must not import tenant-account statements into a shared platform ledger; any future integration requires explicit per-tenant consent and account-scoped finance authorization.

## PER-1549 implementation

`provider-billing-capabilities.ts` holds a readonly, first-party-origin discovery table. It does not create a production billing client, issue a paid call, fetch credentials or let callers assert settlement. The inspector hashes the exact bytes of a bounded TypeSafe public OpenAPI JSON. It only reports paths; **an arbitrary JSON property or even a hypothetical billing route in source bytes cannot authorize billing reconciliation**. The NIM human-readable API page is not falsely parsed as a machine-readable billing schema. `denyUnsupportedProviderSettlement` must always throw until a separate independently reviewed adapter verifies genuine provider artifacts. Only PER-1547's `unverified` source data and PER-1447's receipt-side tokens are available.

## Proof required for 7B.2 (not yet obtained)

1. Verify commercial entitlement and hosting mode with the actual NVIDIA developer/Enterprise contract and TypeSafe order, plus account/project/key scopes. Supply written approval of rate cards and effective dates from platform finance and security.
2. Obtain genuine **platform account** rated usage/invoice export examples through authenticated provider console/API, with source timestamp, account ID, currency, usage units, billing discounts/credits, statement corrections and export-document authentication. Redact credentials before storing documentation.
3. Determine whether each provider supplies a stable, unambiguous per-request billing ID. If it does not, future settlement is **account-level only**, while per-run amounts remain unknown or estimated.
4. Securely stage provider access using PER-1426 managed encryption keys, Auth0 tenants and a protected release branch (PER-1455). No downloads of privileged invoices to Git, CI artifacts or this chat.
5. Add versioned adapter implementation **only** for a verified supplier format, strict origin pinning, account/period bound, replay/overcredit and signature/authenticated-pull negative tests, financial reviewer approval and immutable evidence chain. Keep unsupported providers fail-closed.

## QA / release gates

Unit tests assert fixed first-party origins, wrong-provider and lookalike domains rejected, unsupported invoice/settlement always denied, untrusted OpenAPI bytes cannot self-declare financial verification, malformed schema/doc size rejection and exact SHA-256 source evidence.

CI must run Node tests, TypeScript, lint, Next production build, security:secrets, two-pass migrations with predecessor PostgreSQL test suites, production high/critical dependency audit, and Vercel preview. No PR merge to main or production release without independent security/finance approval and authenticated provider evidence.
