import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_SERVICE_UNAVAILABLE_CODE,
  AUTH_SERVICE_UNAVAILABLE_STATUS,
  createAuthServiceUnavailableApiBody,
  isApiRequestPath,
  renderAuthServiceUnavailableHtml,
} from "./auth0-unavailable.ts";

test("isApiRequestPath only treats the API namespace as JSON surface area", () => {
  assert.equal(isApiRequestPath("/api"), true);
  assert.equal(isApiRequestPath("/api/settings/workspace"), true);
  assert.equal(isApiRequestPath("/settings"), false);
});

test("createAuthServiceUnavailableApiBody returns a stable public error payload", () => {
  assert.deepEqual(createAuthServiceUnavailableApiBody(), {
    error: {
      code: AUTH_SERVICE_UNAVAILABLE_CODE,
      message: "Authentication service is unavailable for this deployment.",
    },
  });

  assert.equal(AUTH_SERVICE_UNAVAILABLE_STATUS, 503);
});

test("renderAuthServiceUnavailableHtml contains a generic message without leaking env variable names", () => {
  const html = renderAuthServiceUnavailableHtml();

  assert.match(html, /Authentication is required before this deployment can serve Savant\./);
  assert.match(html, /href="\/auth-status"/);
  assert.match(html, /auth_service_unavailable/);
  assert.doesNotMatch(html, /APP_BASE_URL|AUTH0_CLIENT_SECRET|AUTH0_SECRET/);
});