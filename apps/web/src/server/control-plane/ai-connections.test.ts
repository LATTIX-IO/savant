import assert from "node:assert/strict";
import test from "node:test";

import {
  AIConnectionError,
  buildAIConnectionSummaryFromRecord,
  normalizeAIConnectionCreateRequest,
  normalizeAIConnectionRotateRequest,
} from "./ai-connections.ts";

test("normalizeAIConnectionCreateRequest dedupes allowed models and preserves explicit default flags", () => {
  const result = normalizeAIConnectionCreateRequest({
    provider: "openai",
    label: "Primary OpenAI",
    defaultModel: "gpt-5.1",
    purpose: "Baseline and candidate execution",
    usageScope: "Tier 2 and Tier 3 execution",
    apiKey: "sk-test-1234567890-abcdef",
    allowedModels: ["gpt-5.1", "gpt-5.1", "gpt-4.1"],
    supportsExecution: true,
    supportsJudging: false,
    isDefaultExecution: true,
    isDefaultJudge: false,
  });

  assert.deepEqual(result.allowedModels, ["gpt-5.1", "gpt-4.1"]);
  assert.equal(result.isDefaultExecution, true);
  assert.equal(result.supportsJudging, false);
  assert.equal(result.baseUrl, undefined);
});

test("normalizeAIConnectionCreateRequest requires a base URL for openai-compatible providers", () => {
  assert.throws(
    () => normalizeAIConnectionCreateRequest({
      provider: "openai-compatible",
      label: "Custom gateway",
      defaultModel: "my-model",
      purpose: "Custom endpoint execution",
      usageScope: "Internal workloads",
      apiKey: "sk-test-1234567890-abcdef",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AIConnectionError);
      assert.equal(error.code, "ai_connection_base_url_required");
      return true;
    },
  );
});

test("normalizeAIConnectionCreateRequest rejects connections with no enabled capabilities", () => {
  assert.throws(
    () => normalizeAIConnectionCreateRequest({
      provider: "anthropic",
      label: "Judge disabled",
      defaultModel: "claude-sonnet-4-5",
      purpose: "No-op connection",
      usageScope: "None",
      apiKey: "sk-test-1234567890-abcdef",
      supportsExecution: false,
      supportsJudging: false,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AIConnectionError);
      assert.equal(error.code, "ai_connection_capabilities_invalid");
      return true;
    },
  );
});

test("buildAIConnectionSummaryFromRecord marks aged keys for rotation and falls back to never-used", () => {
  const result = buildAIConnectionSummaryFromRecord({
    id: "767df343-f85a-49af-8cb3-38fd949f398d",
    providerType: "azure-openai",
    displayName: "Regulated Azure OpenAI",
    defaultModel: "gpt-4.1",
    purpose: "Tier 1 execution",
    usageScope: "Tier 1 only",
    supportsExecution: true,
    supportsJudging: true,
    isDefaultExecution: false,
    isDefaultJudge: true,
    status: "active",
    secretRef: "ai-connection:regulated-tier1-secret-ref",
    lastUsedAt: null,
    lastRotatedAt: "2026-01-01T00:00:00.000Z",
    config: {
      baseUrl: "https://example.openai.azure.com/openai/deployments/regulated",
    },
  }, new Date("2026-05-22T00:00:00.000Z"));

  assert.equal(result.status, "needs-rotation");
  assert.equal(result.lastUsed, "never");
  assert.equal(result.isDefaultJudge, true);
  assert.match(result.secretStore, /^Savant encrypted vault/);
});

test("normalizeAIConnectionRotateRequest trims optional metadata and dedupes allowed models", () => {
  const result = normalizeAIConnectionRotateRequest(
    {
      apiKey: "sk-rotated-1234567890-abcdef",
      defaultModel: "  gpt-4.1  ",
      purpose: "  Updated execution routing  ",
      usageScope: "  production evals  ",
      allowedModels: ["gpt-4.1", "gpt-4.1", "gpt-4.1-mini"],
      apiVersion: " 2024-10-21 ",
    },
    "openai",
  );

  assert.equal(result.defaultModel, "gpt-4.1");
  assert.equal(result.purpose, "Updated execution routing");
  assert.equal(result.usageScope, "production evals");
  assert.deepEqual(result.allowedModels, ["gpt-4.1", "gpt-4.1-mini"]);
  assert.equal(result.apiVersion, "2024-10-21");
});

test("normalizeAIConnectionRotateRequest validates replacement keys", () => {
  assert.throws(
    () => normalizeAIConnectionRotateRequest({ apiKey: "short" }, "openai"),
    (error: unknown) => {
      assert.ok(error instanceof AIConnectionError);
      assert.equal(error.code, "ai_connection_api_key_invalid");
      return true;
    },
  );
});
