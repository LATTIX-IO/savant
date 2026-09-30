import assert from "node:assert/strict";
import test from "node:test";

import {
  MutationRequestSecurityError,
  assertSameOriginMutationRequest,
} from "./request-security.ts";

test("assertSameOriginMutationRequest accepts matching origin headers", () => {
  const request = new Request("https://app.savantskills.app/api/ai-connections", {
    method: "POST",
    headers: {
      origin: "https://app.savantskills.app",
      host: "app.savantskills.app",
      "x-forwarded-host": "app.savantskills.app",
      "x-forwarded-proto": "https",
    },
  });

  assert.doesNotThrow(() => assertSameOriginMutationRequest(request));
});

test("assertSameOriginMutationRequest accepts referer when origin is absent", () => {
  const request = new Request("https://app.savantskills.app/api/ai-connections", {
    method: "POST",
    headers: {
      referer: "https://app.savantskills.app/o/finance-ops/settings",
      host: "app.savantskills.app",
      "x-forwarded-host": "app.savantskills.app",
      "x-forwarded-proto": "https",
    },
  });

  assert.doesNotThrow(() => assertSameOriginMutationRequest(request));
});

test("assertSameOriginMutationRequest rejects missing mutation origins", () => {
  const request = new Request("https://app.savantskills.app/api/ai-connections", {
    method: "POST",
    headers: {
      host: "app.savantskills.app",
      "x-forwarded-host": "app.savantskills.app",
      "x-forwarded-proto": "https",
    },
  });

  assert.throws(
    () => assertSameOriginMutationRequest(request),
    (error: unknown) => {
      assert.ok(error instanceof MutationRequestSecurityError);
      assert.equal(error.code, "mutation_origin_required");
      return true;
    },
  );
});

test("assertSameOriginMutationRequest rejects mismatched origins", () => {
  const request = new Request("https://app.savantskills.app/api/ai-connections", {
    method: "POST",
    headers: {
      origin: "https://evil.example.com",
      host: "app.savantskills.app",
      "x-forwarded-host": "app.savantskills.app",
      "x-forwarded-proto": "https",
    },
  });

  assert.throws(
    () => assertSameOriginMutationRequest(request),
    (error: unknown) => {
      assert.ok(error instanceof MutationRequestSecurityError);
      assert.equal(error.code, "mutation_origin_mismatch");
      return true;
    },
  );
});
