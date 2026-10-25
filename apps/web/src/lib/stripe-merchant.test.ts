import assert from "node:assert/strict";
import test from "node:test";

import { verifyStripeMerchant } from "./stripe-merchant.ts";

test("valid merchant and enabled charges are required", async () => {
  let requestedUrl = "";
  const result = await verifyStripeMerchant({
    secretKey: "rk_live_fixture",
    expectedAccountId: "acct_savant",
    request: async (url, init) => {
      requestedUrl = url;
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Authorization"), "Bearer rk_live_fixture");
      assert.equal(init.cache, "no-store");
      return Response.json({ id: "acct_savant", charges_enabled: true });
    },
  });
  assert.equal(requestedUrl, "https://api.stripe.com/v1/account");
  assert.equal(result, "verified");
});

test("wrong merchant and unavailable charges fail closed", async () => {
  const wrong = await verifyStripeMerchant({
    secretKey: "rk_live_fixture",
    expectedAccountId: "acct_savant",
    request: async () => Response.json({ id: "acct_other", charges_enabled: true }),
  });
  assert.equal(wrong, "merchant_mismatch");
  const disabled = await verifyStripeMerchant({
    secretKey: "rk_live_fixture",
    expectedAccountId: "acct_savant",
    request: async () => Response.json({ id: "acct_savant", charges_enabled: false }),
  });
  assert.equal(disabled, "charges_disabled");
});

test("insufficient restricted-key permissions, failures and malformed bodies fail closed", async () => {
  const cases: Array<{ response: Response; expected: string }> = [
    { response: new Response(null, { status: 403 }), expected: "credential_or_permission_denied" },
    { response: new Response(null, { status: 401 }), expected: "credential_or_permission_denied" },
    { response: new Response(null, { status: 503 }), expected: "stripe_unavailable" },
    { response: Response.json({ id: "acct_savant" }), expected: "charges_disabled" },
    { response: Response.json(null), expected: "stripe_unavailable" },
  ];
  for (const { response, expected } of cases) {
    assert.equal(
      await verifyStripeMerchant({
        secretKey: "rk_live_fixture",
        expectedAccountId: "acct_savant",
        request: async () => response,
      }),
      expected,
    );
  }
  assert.equal(
    await verifyStripeMerchant({
      secretKey: "rk_live_fixture",
      expectedAccountId: "acct_savant",
      request: async () => { throw new Error("request failed"); },
    }),
    "stripe_unavailable",
  );
});
