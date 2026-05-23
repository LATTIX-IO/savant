import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthCallbackFailureHref,
  extractAuthCallbackFailure,
  getAuthCallbackFailureHint,
  readAuthCallbackFailureParams,
} from "./auth0-callback.ts";

test("extractAuthCallbackFailure reads the SDK and OAuth error codes", () => {
  assert.deepEqual(
    extractAuthCallbackFailure({
      code: "authorization_code_grant_error",
      cause: {
        code: "invalid_client",
        message: "Unauthorized",
      },
    }),
    {
      sdkErrorCode: "authorization_code_grant_error",
      oauthErrorCode: "invalid_client",
      oauthErrorDescription: "Unauthorized",
    },
  );
});

test("readAuthCallbackFailureParams ignores unsafe query-string values", () => {
  assert.deepEqual(
    readAuthCallbackFailureParams({
      callbackError: "authorization_code_grant_error",
      oauthError: "<script>alert(1)</script>",
      oauthMessage: "<script>alert(1)</script>",
    }),
    {
      sdkErrorCode: "authorization_code_grant_error",
      oauthErrorCode: null,
      oauthErrorDescription: null,
    },
  );

  assert.equal(readAuthCallbackFailureParams({}), null);
});

test("buildAuthCallbackFailureHref keeps safe return targets and codes", () => {
  assert.equal(
    buildAuthCallbackFailureHref({
      returnTo: "https://evil.example/phish",
      sdkErrorCode: "authorization_code_grant_error",
      oauthErrorCode: "invalid_client",
      oauthErrorDescription: "Unauthorized",
    }),
    "/auth-status?source=signin&returnTo=%2Fdashboard&callbackError=authorization_code_grant_error&oauthError=invalid_client&oauthMessage=Unauthorized",
  );
});

test("getAuthCallbackFailureHint maps invalid_client to a deployment-secret action", () => {
  assert.match(
    getAuthCallbackFailureHint({
      sdkErrorCode: "authorization_code_grant_error",
      oauthErrorCode: "invalid_client",
      oauthErrorDescription: "Unauthorized",
    }) ?? "",
    /AUTH0_CLIENT_SECRET/,
  );

  assert.match(
    getAuthCallbackFailureHint({
      sdkErrorCode: "invalid_state",
      oauthErrorCode: null,
      oauthErrorDescription: null,
    }) ?? "",
    /transaction cookie/i,
  );

  assert.match(
    getAuthCallbackFailureHint({
      sdkErrorCode: "authorization_code_grant_error",
      oauthErrorCode: "invalid_request",
      oauthErrorDescription: "Grant type 'authorization_code' not allowed for the client.",
    }) ?? "",
    /Authorization Code grant/i,
  );
});