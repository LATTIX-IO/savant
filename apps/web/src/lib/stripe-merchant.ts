/**
 * Verify the merchant bound to a server-side Stripe API key.
 *
 * Stripe's /v1/account endpoint returns the authenticated merchant. Do not use
 * /v1/accounts/{id}: that endpoint addresses connected accounts and may require
 * unrelated Connect permissions on restricted API keys.
 */
export type MerchantVerificationResult =
  | "verified"
  | "credential_or_permission_denied"
  | "merchant_mismatch"
  | "charges_disabled"
  | "stripe_unavailable";

type MerchantRequest = (url: string, init: RequestInit) => Promise<Response>;

export async function verifyStripeMerchant(
  input: {
    secretKey: string;
    expectedAccountId: string;
    request?: MerchantRequest;
  },
): Promise<MerchantVerificationResult> {
  const request: MerchantRequest = input.request ?? ((url, init) => fetch(url, init));
  try {
    const response = await request("https://api.stripe.com/v1/account", {
      method: "GET",
      headers: { Authorization: `Bearer ${input.secretKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 || response.status === 403) {
      return "credential_or_permission_denied";
    }
    if (!response.ok) {
      return "stripe_unavailable";
    }
    const account: unknown = await response.json();
    if (!account || typeof account !== "object") {
      return "stripe_unavailable";
    }
    const record = account as Record<string, unknown>;
    if (record.id !== input.expectedAccountId) {
      return "merchant_mismatch";
    }
    return record.charges_enabled === true ? "verified" : "charges_disabled";
  } catch {
    return "stripe_unavailable";
  }
}
