import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProviderRoleAdmission, ProviderRoleAdmissionError,
  type ProviderRoleActor, type ProviderRoleConnection,
  type ProviderRoleGrant, type ProviderRoleInvocation,
} from "./provider-role-admission.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const fp = "a".repeat(64);
const now = Date.parse("2026-10-22T20:00:00Z");
const actor: ProviderRoleActor = {
  organizationId, subject: "auth0|member", status: "active",
  permittedRoles: ["evaluation-executor"],
};
const connection: ProviderRoleConnection = {
  id: connectionId, organizationId, provider: "anthropic", status: "active",
  credentialMode: "api-key", secretFingerprint: fp, keyVersion: 2,
  allowedModels: ["claude-haiku-5-5"],
};
const grant: ProviderRoleGrant = {
  id: "grant-qa-1", organizationId, connectionId, provider: "anthropic",
  role: "evaluation-executor", model: "claude-haiku-5-5", credentialMode: "api-key",
  secretFingerprint: fp, keyVersion: 2, status: "active",
  verifiedAt: "2026-10-22T19:00:00Z", expiresAt: "2026-10-23T20:00:00Z",
  billingOwner: "org-qa-budget", pricingRevision: "pricing-v1",
  maxTokensPerCall: 10_000, maxEstimatedUsdPerCall: 0.25,
};
const intent: ProviderRoleInvocation = {
  organizationId, connectionId, provider: "anthropic",
  role: "evaluation-executor", model: "claude-haiku-5-5", secretFingerprint: fp,
  keyVersion: 2, pricingRevision: "pricing-v1", estimatedTokens: 1500,
  estimatedUsd: 0.08,
};
const allowed = ["api-key"] as const;
const admit = (overrides: Partial<Parameters<typeof assertProviderRoleAdmission>[0]> = {}) =>
  assertProviderRoleAdmission({actor, connection, grant, intent,
    supportedCredentialModes: allowed, now, ...overrides});
const denied = (code: string) => (error: unknown): boolean =>
  error instanceof ProviderRoleAdmissionError && error.code === code;

test("PER-1602 grants are explicit, pinned and content-minimal", () => {
  const receipt = admit();
  assert.deepEqual(receipt, {
    grantId: grant.id, organizationId, connectionId, provider: "anthropic",
    role: "evaluation-executor", model: intent.model, secretFingerprint: fp,
    keyVersion: 2, billingOwner: "org-qa-budget", pricingRevision: "pricing-v1",
    estimatedTokens: 1500, estimatedUsd: 0.08,
  });
  assert.ok(Object.isFrozen(receipt));
  assert.ok(!("apiKey" in receipt));
});
test("PER-1602 legacy metadata and absent grants never authorize production", () => {
  assert.throws(() => admit({grant: null}), denied("provider_grant_role_unavailable"));
  const production = {...intent, role: "production-serving" as const};
  assert.throws(() => admit({intent: production}), denied("provider_grant_actor_forbidden"));
  assert.throws(() => admit({intent: production,
    actor: {...actor, permittedRoles: ["production-serving"]}}),
    denied("provider_grant_role_unavailable"));
  assert.throws(() => admit({grant: {...grant, status: "revoked"}}),
    denied("provider_grant_role_unavailable"));
});
test("PER-1602 deny foreign tenants, revoked principals and mismatched providers", () => {
  for (const candidate of [null, {...actor, status: "revoked" as const},
    {...actor, organizationId: "foreign"}, {...actor, permittedRoles: []},
    {...actor, subject: ""}])
    assert.throws(() => admit({actor: candidate}), denied("provider_grant_actor_forbidden"));
  for (const candidate of [null, {...connection, status: "revoked" as const},
    {...connection, organizationId: "foreign"},
    {...connection, provider: "openai"}, {...connection, id: "foreign"}])
    assert.throws(() => admit({connection: candidate}), denied("provider_grant_connection_unavailable"));
  for (const candidate of [{...grant, organizationId: "foreign"},
    {...grant, connectionId: "foreign"}, {...grant, role: "evaluation-judge" as const},
    {...grant, provider: "openai"}, {...grant, model: "wrong"}])
    assert.throws(() => admit({grant: candidate}), denied("provider_grant_role_unavailable"));
});
test("PER-1602 enforce model allowlist, secret fingerprint and version pin", () => {
  assert.throws(() => admit({connection: {...connection, allowedModels: []}}),
    denied("provider_grant_model_denied"));
  assert.throws(() => admit({connection: {...connection, allowedModels: ["different"]}}),
    denied("provider_grant_model_denied"));
  for (const params of [
    {intent: {...intent, secretFingerprint: "b".repeat(64)}},
    {intent: {...intent, keyVersion: 1}},
    {connection: {...connection, keyVersion: 3}},
    {grant: {...grant, secretFingerprint: "b".repeat(64)}},
  ]) assert.throws(() => admit(params), denied("provider_grant_credential_changed"));
});
test("PER-1602 require a supported auth method; reject OAuth/WIF without adapter", () => {
  const federated = {...connection, credentialMode: "workload-federation" as const};
  assert.throws(() => admit({connection: federated}),
    denied("provider_grant_credential_mode_unavailable"));
  assert.throws(() => admit({supportedCredentialModes: []}),
    denied("provider_grant_credential_mode_unavailable"));
});
test("PER-1602 deny unverified, expired and future-dated grants", () => {
  for (const candidate of [
    {...grant, verifiedAt: null}, {...grant, verifiedAt: "tomorrow"},
    {...grant, verifiedAt: "2026-10-24T20:00:00Z"},
    {...grant, expiresAt: "2026-10-22T20:00:00Z"},
    {...grant, expiresAt: "2026-10-22T19:59:59Z"},
  ]) assert.throws(() => admit({grant: candidate}), ProviderRoleAdmissionError);
  assert.throws(() => admit({now: Number.NaN}),
    denied("provider_grant_clock_invalid"));
});
test("PER-1602 deny missing pricing, unknown cost, budget and token overrun", () => {
  for (const candidate of [
    {...intent, estimatedUsd: 0}, {...intent, estimatedUsd: Number.NaN},
    {...intent, estimatedUsd: 0.26}, {...intent, estimatedTokens: 10_001},
    {...intent, estimatedTokens: -1}, {...intent, pricingRevision: "unknown"},
  ]) assert.throws(() => admit({intent: candidate}),
    denied("provider_grant_budget_unavailable_or_exceeded"));
  assert.throws(() => admit({grant: {...grant, billingOwner: ""}}),
    denied("provider_grant_budget_unavailable_or_exceeded"));
});
