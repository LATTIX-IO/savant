/** PER-1602: Pure authorization boundary for a future persisted provider-role grant.
 * Not a database lookup, token verifier, credential store or model invoker.
 * Call only with authoritative server-loaded actor, connection, and grant rows.
 * Until those rows exist, an absent grant always denies provider execution.
 */
export type ProviderInvocationRole =
  "evaluation-executor" | "evaluation-judge" | "production-serving";
export type ProviderCredentialMode =
  "api-key" | "workload-federation" | "approved-delegated-oauth";

export type ProviderRoleActor = Readonly<{
  organizationId: string;
  subject: string;
  status: "active" | "revoked";
  permittedRoles: readonly ProviderInvocationRole[];
}>;

export type ProviderRoleConnection = Readonly<{
  id: string;
  organizationId: string;
  provider: string;
  status: "active" | "revoked" | "needs-rotation";
  credentialMode: ProviderCredentialMode;
  secretFingerprint: string;
  keyVersion: number;
  allowedModels: readonly string[];
}>;

/** Separately persisted and administrator-approved grant; never synthesized
 * from legacy supportsExecution, supportsJudging, purpose or default fields.
 */
export type ProviderRoleGrant = Readonly<{
  id: string;
  organizationId: string;
  connectionId: string;
  provider: string;
  role: ProviderInvocationRole;
  model: string;
  credentialMode: ProviderCredentialMode;
  secretFingerprint: string;
  keyVersion: number;
  status: "active" | "revoked";
  verifiedAt: string | null;
  expiresAt: string | null;
  billingOwner: string;
  pricingRevision: string;
  maxTokensPerCall: number;
  maxEstimatedUsdPerCall: number;
}>;

export type ProviderRoleInvocation = Readonly<{
  organizationId: string;
  connectionId: string;
  provider: string;
  role: ProviderInvocationRole;
  model: string;
  secretFingerprint: string;
  keyVersion: number;
  pricingRevision: string;
  estimatedTokens: number;
  estimatedUsd: number;
}>;

export type ProviderAdmissionReceipt = Readonly<{
  grantId: string;
  organizationId: string;
  connectionId: string;
  provider: string;
  role: ProviderInvocationRole;
  model: string;
  secretFingerprint: string;
  keyVersion: number;
  billingOwner: string;
  pricingRevision: string;
  estimatedTokens: number;
  estimatedUsd: number;
}>;

export class ProviderRoleAdmissionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ProviderRoleAdmissionError";
    this.code = code;
  }
}

const refuse = (code: string): never => { throw new ProviderRoleAdmissionError(code); };
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
function instant(value: string): number {
  if (!ISO_INSTANT.test(value)) return refuse("provider_grant_timestamp_invalid");
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return refuse("provider_grant_timestamp_invalid");
  return t;
}
function nonempty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

/** Stateless admission. The server must re-read persisted state before every
 * billable external request, including each step of a multi-case evaluation.
 * Successful admission does NOT itself prove that the provider accepted a call.
 */
export function assertProviderRoleAdmission(input: {
  actor: ProviderRoleActor | null;
  connection: ProviderRoleConnection | null;
  grant: ProviderRoleGrant | null;
  intent: ProviderRoleInvocation;
  supportedCredentialModes: readonly ProviderCredentialMode[];
  now?: number;
}): ProviderAdmissionReceipt {
  const {actor, connection, grant, intent, supportedCredentialModes} = input;
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) return refuse("provider_grant_clock_invalid");
  if (!actor || actor.status !== "active" ||
      !nonempty(actor.subject) || actor.organizationId !== intent.organizationId ||
      !actor.permittedRoles.includes(intent.role))
    return refuse("provider_grant_actor_forbidden");
  if (!connection || connection.status !== "active" ||
      !nonempty(connection.id) || connection.id !== intent.connectionId ||
      connection.organizationId !== intent.organizationId ||
      connection.provider !== intent.provider)
    return refuse("provider_grant_connection_unavailable");
  // The old supports_execution/is_default_execution flags NEVER confer a role.
  if (!grant || grant.status !== "active" ||
      !nonempty(grant.id) || grant.organizationId !== intent.organizationId ||
      grant.connectionId !== connection.id || grant.provider !== intent.provider ||
      grant.role !== intent.role || grant.model !== intent.model)
    return refuse("provider_grant_role_unavailable");
  if (!supportedCredentialModes.includes(connection.credentialMode) ||
      connection.credentialMode !== grant.credentialMode)
    return refuse("provider_grant_credential_mode_unavailable");
  if (!nonempty(intent.model) || !connection.allowedModels.includes(intent.model))
    return refuse("provider_grant_model_denied");
  if (!FINGERPRINT.test(intent.secretFingerprint) ||
      grant.secretFingerprint !== intent.secretFingerprint ||
      connection.secretFingerprint !== intent.secretFingerprint ||
      !Number.isSafeInteger(intent.keyVersion) || intent.keyVersion <= 0 ||
      connection.keyVersion !== intent.keyVersion || grant.keyVersion !== intent.keyVersion)
    return refuse("provider_grant_credential_changed");
  if (!grant.verifiedAt || instant(grant.verifiedAt) > now ||
      (grant.expiresAt !== null && instant(grant.expiresAt) <= now))
    return refuse("provider_grant_not_verified_or_expired");
  if (!nonempty(grant.billingOwner) || !nonempty(grant.pricingRevision) ||
      intent.pricingRevision !== grant.pricingRevision ||
      !Number.isSafeInteger(grant.maxTokensPerCall) || grant.maxTokensPerCall <= 0 ||
      !Number.isFinite(grant.maxEstimatedUsdPerCall) || grant.maxEstimatedUsdPerCall <= 0 ||
      !Number.isSafeInteger(intent.estimatedTokens) || intent.estimatedTokens <= 0 ||
      !Number.isFinite(intent.estimatedUsd) || intent.estimatedUsd <= 0 ||
      intent.estimatedTokens > grant.maxTokensPerCall ||
      intent.estimatedUsd > grant.maxEstimatedUsdPerCall)
    return refuse("provider_grant_budget_unavailable_or_exceeded");
  return Object.freeze({
    grantId: grant.id, organizationId: intent.organizationId,
    connectionId: connection.id, provider: intent.provider, role: intent.role,
    model: intent.model, secretFingerprint: intent.secretFingerprint,
    keyVersion: intent.keyVersion, billingOwner: grant.billingOwner,
    pricingRevision: grant.pricingRevision,
    estimatedTokens: intent.estimatedTokens, estimatedUsd: intent.estimatedUsd,
  });
}
