# PER-1602 — Explicit grants, independent defaults and budget reservations

**Status:** Implementation proposal and isolated tests, 2026-10-22. Not production-admitted. A stacked increment on PR #145.

## Security boundaries

1. `db/proposed/0036_provider_role_grants_and_reservations.sql` is **not** under the automatic schema path. It adds explicit grants for `evaluation-executor`, `evaluation-judge` and `production-serving` with independent default pointers, tenant-scoped actor allowlists, a separately approved pricing revision, immutable activated grants/rates, and conservative per-grant daily/monthly micro-USD ledgers. No defaults or authorizations are seeded.
2. `provider-role-pricing.ts` computes a worst-case quote from approved rate evidence using BigInt; it reserves the highest applicable input/cached-input rate plus output and fixed charges. This is **not** a settled cost, a vendor invoice, or a guaranteed actual billing ceiling.
3. `provider-role-store.ts` operates in one PostgreSQL transaction. It first locks active same-tenant membership, scoped grant, connection secret fingerprint, rate and default; it then verifies an independently approved role and model. A unique `(organization, run, role, callIndex)` reservation is inserted before conditional atomic daily/monthly ledger increments. Conflict, capacity exhaustion or DB outage fail closed and rollback the transaction; no duplicate paid model call is authorized.
4. `provider-role-dispatch.ts` separately reloads actor-to-grant binding, default, connection, secret version and rate, then atomically transitions the specific reservation from `reserved` to `dispatching`. The original actor is pinned via an explicit `actor_user_id` on the reservation. A changed fingerprint, revoked grant, offboarded user or replay denies dispatch.
5. All SQL access is server-only and accepts org/actor identity that the calling service must derive from authenticated session/job state. **Neither service is connected to an HTTP route, existing Test Bench worker, or paid vendor transport in this increment.** It cannot be invoked by an unauthenticated browser.

## Migration and operational gates

- Witness a real encrypted backup and restore to a separate Neon/PostgreSQL database, independently recover managed AI/Test Bench keys, then run the staged migration on that isolated recovered DB with the signed schema tooling.
- Add admin-authorized grant/rate/actor approval mutations with audit and versioned revocation. Existing `supports_execution`, `is_default_execution`, and free-text connection purpose must not become implicit role grants.
- Wire the guarded transport to the reserved/dispatching path only after initial `PER-1592` runtime/key readiness and a separately approved rate revision. The network invoker must verify the **actual decrypted key** against the dispatch fingerprint and consume the reservation once. A reservation with no provider ACK remains a conservative spend hold, not zero cost.
- Establish price-source verification, real provider-token receipts/invoice reconciliation, concurrent PostgreSQL tests, cancellation/crash handling, multiple provider workloads sharing an organization budget, and authenticated A/B/C negative UAT. Provider billing may exceed an estimate; fail closed on unknown costs.
- Anthropic identity-backed service keys and multi-workspace API keys differ: an unscoped service key needs an explicit `anthropic-workspace-id` header. Do not declare broad-organization Claude support until the external workspace pin and response organization/workspace reconciliation are implemented. Source: https://platform.claude.com/docs/en/manage-claude/authentication
- OpenAI API Platform inference, ChatGPT Enterprise MCP, Anthropic/Claude managed connectors and Microsoft Graph Copilot permissions remain separate authorization boundaries. No external registration or token request is enabled here.

## Accepted test scope

Local deterministic tests cover role separation, foreign tenants and actors, immutable credential version, absence/revocation, conservative pricing, missing price data, duplicate reservations, daily/monthly spend retention, single-use dispatch, key drift, and sanitized DB failures. See `docs/evidence/per-1602-next-isolated-2026-10-22.md`.

**Not accepted:** real PostgreSQL migration/execution and concurrent row locks, complete monorepo typecheck, authenticated browser test, signed security review, production deploy, live vendor usage or invoice/telemetry. Those remain tracked before merge or activation.
