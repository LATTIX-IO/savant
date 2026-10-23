/** PER-1602: Conservative, explicitly sourced per-call monetary authorization.
 * Integers represent micro-USD; no floating-point currency arithmetic.
 * These are upper-bound *estimates*, not actual vendor invoicing.
 */
export type ApprovedRoleRate = Readonly<{
  provider: string;
  model: string;
  revision: string;
  status: "approved" | "draft" | "revoked";
  sourceSha256: string;
  approvedAt: string | null;
  validFrom: string;
  validUntil: string | null;
  inputMicroUsdPerMillion: string | bigint;
  cacheWriteMicroUsdPerMillion: string | bigint;
  cacheReadMicroUsdPerMillion: string | bigint;
  outputMicroUsdPerMillion: string | bigint;
  fixedMicroUsdPerCall: string | bigint;
}>;

export class ProviderRolePricingError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ProviderRolePricingError";
  }
}
const MAX = 1_000_000_000_000n;
const MILLION = 1_000_000n;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw new ProviderRolePricingError(code); };
function amount(value: unknown): bigint {
  if ((typeof value !== "bigint" || value < 0n) &&
      (typeof value !== "string" || !/^(0|[1-9]\d{0,12})$/.test(value)))
    return fail("provider_role_price_invalid");
  const parsed = BigInt(value as bigint | string);
  if (parsed > MAX) return fail("provider_role_price_invalid");
  return parsed;
}
function instant(value: string | null): number {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
    return fail("provider_role_price_unverified");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return fail("provider_role_price_unverified");
  return time;
}
export function quoteProviderCallMicroUsd(input: {
  rate: ApprovedRoleRate;
  provider: string;
  model: string;
  revision: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  nowMs?: number;
}): bigint {
  const {rate, provider, model, revision, maxInputTokens, maxOutputTokens} = input;
  const now = input.nowMs ?? Date.now();
  if (!Number.isFinite(now) || now < 0 || !rate || rate.status !== "approved" ||
      !rate.approvedAt || !HASH.test(rate.sourceSha256) ||
      rate.provider !== provider || rate.model !== model || rate.revision !== revision)
    return fail("provider_role_price_unverified");
  if (instant(rate.approvedAt) > now || instant(rate.validFrom) > now ||
      (rate.validUntil !== null && instant(rate.validUntil) <= now))
    return fail("provider_role_price_unverified");
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 ||
      maxInputTokens + maxOutputTokens > 1_000_000)
    return fail("provider_role_price_tokens_invalid");
  // Cache write prices can exceed ordinary input prices. Reserve against the
  // maximum of all input modes; never assume favorable caching discounts.
  const highestInput = [rate.inputMicroUsdPerMillion,
    rate.cacheWriteMicroUsdPerMillion, rate.cacheReadMicroUsdPerMillion]
    .map(amount).reduce((a, b) => a > b ? a : b);
  const output = amount(rate.outputMicroUsdPerMillion);
  const fixed = amount(rate.fixedMicroUsdPerCall);
  const numerator = highestInput * BigInt(maxInputTokens) + output * BigInt(maxOutputTokens);
  const quote = (numerator + MILLION - 1n) / MILLION + fixed;
  if (quote < 1n || quote > MAX) return fail("provider_role_price_invalid");
  return quote;
}

/** Conservative conversion for *admission comparison only*. No output of this
 * method should be displayed as an invoice or exact provider spend.
 */
export function microUsdAsAdmissionNumber(microUsd: bigint): number {
  if (microUsd <= 0n || microUsd > MAX) return fail("provider_role_price_invalid");
  return Number(microUsd) / Number(MILLION);
}
