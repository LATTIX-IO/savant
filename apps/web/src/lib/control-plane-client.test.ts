import assert from "node:assert/strict";
import test from "node:test";

import {
  applySkillScaffold,
  buildTenantScopedControlPlanePath,
  buildControlPlaneQuery,
  createAIConnection,
  ControlPlaneClientError,
  fetchAuditEvents,
  fetchConnectorDashboard,
  fetchEvaluationDetail,
  fetchEvaluationDashboard,
  fetchPolicies,
  fetchReleaseDashboard,
  fetchRepositoryDetail,
  fetchAIConnections,
  fetchSkillList,
  provisionRepository,
  revokeAIConnection,
  rotateAIConnection,
  setAIConnectionDefaults,
  triggerRepositorySync,
} from "./control-plane-client.ts";

test("buildControlPlaneQuery omits empty values and encodes filters", () => {
  assert.equal(
    buildControlPlaneQuery({
      channel: "production",
      query: "contract review",
      status: "",
      team: undefined,
      tier: 2,
    }),
    "?channel=production&query=contract+review&tier=2",
  );
});

test("buildTenantScopedControlPlanePath appends workspaceSlug without dropping existing query params", () => {
  assert.equal(
    buildTenantScopedControlPlanePath("/api/skills?query=legal", { workspaceSlug: "finance-ops" }),
    "/api/skills?query=legal&workspaceSlug=finance-ops",
  );
});

test("fetchSkillList requests the skills API with encoded filters", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/skills?query=legal+ops&tier=2");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "derived-index",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchSkillList({ query: "legal ops", tier: 2 });
  assert.equal(response.meta.count, 0);
  assert.deepEqual(response.data, []);
});

test("fetchSkillList appends the workspace slug when tenant context is provided", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/skills?query=legal+ops&workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "derived-index",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchSkillList(
    { query: "legal ops" },
    { workspaceSlug: "finance-ops" },
  );
  assert.equal(response.meta.count, 0);
});

test("fetchRepositoryDetail throws a typed error when the API responds with an error payload", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "repository_not_found",
            message: "Repository 'missing' was not found.",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 404,
        },
      ),
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  await assert.rejects(
    () => fetchRepositoryDetail("missing"),
    (error: unknown) => {
      assert.ok(error instanceof ControlPlaneClientError);
      assert.equal(error.code, "repository_not_found");
      assert.equal(error.status, 404);
      assert.match(error.message, /missing/);
      return true;
    },
  );
});

test("triggerRepositorySync posts a typed sync request to the repository sync endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "/api/repositories/repo_123/sync?workspaceSlug=finance-ops",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ reason: "manual" }));

      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Accept"), "application/json");
      assert.equal(headers.get("Content-Type"), "application/json");

      return new Response(
        JSON.stringify({
          data: {
            accepted: true,
            repository: {
              id: "repo_123",
              provider: "github",
              name: "acme/finance-skills",
              branch: "main",
              skills: 0,
              lastSync: "just now",
              status: "ok",
              projection: {
                indexedAt: null,
                lastSuccessfulSyncAt: null,
                lastWebhookAt: null,
              },
            },
            syncMode: "poll",
            requestedAt: "2026-05-22T10:00:00.000Z",
            nextPollAt: "2026-05-22T10:00:00.000Z",
            indexedSkillCount: 1,
            warnings: [],
            message: "Repository sync requested.",
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 202,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await triggerRepositorySync(
    "repo_123",
    { reason: "manual" },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.accepted, true);
  assert.equal(response.data.repository.id, "repo_123");
  assert.equal(response.data.syncMode, "poll");
  assert.equal(response.data.nextPollAt, "2026-05-22T10:00:00.000Z");
  assert.equal(response.data.indexedSkillCount, 1);
  assert.deepEqual(response.data.warnings, []);
});

test("provisionRepository posts the provisioning request to the repository provision endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "/api/repositories/provision?workspaceSlug=finance-ops",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.body,
        JSON.stringify({
          provider: "github",
          repoUrl: "https://github.com/acme/finance-skills",
          defaultBranch: "main",
          displayName: "Finance Skills",
          connectionId: "conn_123",
          visibility: "private",
        }),
      );

      return new Response(
        JSON.stringify({
          data: {
            repository: {
              id: "repo_456",
              provider: "github",
              name: "acme/finance-skills",
              branch: "main",
              skills: 0,
              lastSync: "just now",
              status: "syncing",
              projection: {
                indexedAt: null,
                lastSuccessfulSyncAt: null,
                lastWebhookAt: null,
              },
            },
            commit: {
              sha: "abc123",
              committedAt: "2026-05-22T10:00:00.000Z",
              url: null,
              changedPaths: ["README.md", "registry/skills.yaml"],
            },
            indexedSkillCount: 0,
            warnings: [],
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "mixed",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 201,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await provisionRepository(
    {
      provider: "github",
      repoUrl: "https://github.com/acme/finance-skills",
      defaultBranch: "main",
      displayName: "Finance Skills",
      connectionId: "conn_123",
      visibility: "private",
    },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.repository.id, "repo_456");
  assert.equal(response.data.commit.sha, "abc123");
  assert.deepEqual(response.data.warnings, []);
});

test("applySkillScaffold posts scaffold apply requests to the skill apply endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "/api/skills/scaffold/apply?workspaceSlug=finance-ops",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.body,
        JSON.stringify({
          repositoryId: "repo_456",
          displayName: "Contract Review Assistant",
          tier: "tier2",
          owner: "platform-team",
          summary: "Review commercial contracts and flag material risk language.",
          dependencies: ["shared/legal-style"],
        }),
      );

      return new Response(
        JSON.stringify({
          data: {
            repository: {
              id: "repo_456",
              provider: "github",
              name: "acme/finance-skills",
              branch: "main",
              skills: 1,
              lastSync: "just now",
              status: "ok",
              projection: {
                indexedAt: "2026-05-22T10:00:00.000Z",
                lastSuccessfulSyncAt: "2026-05-22T10:00:00.000Z",
                lastWebhookAt: null,
              },
            },
            skillUuid: "33333333-3333-4333-8333-333333333333",
            skillId: "legal/contract-review-assistant",
            packagePath: "tier2/methodology/legal/contract-review-assistant",
            commit: {
              sha: "def456",
              committedAt: "2026-05-22T10:05:00.000Z",
              url: null,
              changedPaths: [
                "tier2/methodology/legal/contract-review-assistant/SKILL.md",
                "registry/skills.yaml",
              ],
            },
            indexedSkillCount: 1,
            warnings: [],
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "mixed",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 201,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await applySkillScaffold(
    {
      repositoryId: "repo_456",
      displayName: "Contract Review Assistant",
      tier: "tier2",
      owner: "platform-team",
      summary: "Review commercial contracts and flag material risk language.",
      dependencies: ["shared/legal-style"],
    },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.repository.id, "repo_456");
  assert.equal(response.data.skillId, "legal/contract-review-assistant");
  assert.equal(response.data.commit.sha, "def456");
});

test("fetchAIConnections requests the tenant-scoped AI connections list", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/ai-connections?workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchAIConnections({ workspaceSlug: "finance-ops" });
  assert.equal(response.meta.count, 0);
});

test("fetchAuditEvents requests the tenant-scoped audit endpoint with range filters", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/audit?range=30d&workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchAuditEvents(
    { range: "30d" },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.meta.count, 0);
});

test("fetchPolicies requests the tenant-scoped policies endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/policies?workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: [],
          meta: {
            count: 0,
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchPolicies({ workspaceSlug: "finance-ops" });
  assert.equal(response.meta.count, 0);
});

test("fetchReleaseDashboard requests the tenant-scoped releases endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/releases?workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: {
            kpis: [],
            inMotion: [],
            history: [],
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchReleaseDashboard({ workspaceSlug: "finance-ops" });
  assert.equal(response.data.kpis.length, 0);
  assert.equal(response.data.inMotion.length, 0);
  assert.equal(response.data.history.length, 0);
});

test("fetchConnectorDashboard requests the tenant-scoped connectors endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/connectors?workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: {
            kpis: [],
            connectors: [],
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchConnectorDashboard({ workspaceSlug: "finance-ops" });
  assert.equal(response.data.kpis.length, 0);
  assert.equal(response.data.connectors.length, 0);
});

test("fetchEvaluationDashboard requests the tenant-scoped evaluations endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(String(input), "/api/evaluations?workspaceSlug=finance-ops");

      return new Response(
        JSON.stringify({
          data: {
            kpis: [],
            runs: [],
            coverageByTier: [],
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "derived-index",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchEvaluationDashboard({ workspaceSlug: "finance-ops" });
  assert.equal(response.data.kpis.length, 0);
  assert.equal(response.data.runs.length, 0);
  assert.equal(response.data.coverageByTier.length, 0);
});

test("fetchEvaluationDetail requests the tenant-scoped evaluation detail endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      assert.equal(
        String(input),
        "/api/evaluations/11111111-1111-4111-8111-111111111111?workspaceSlug=finance-ops",
      );

      return new Response(
        JSON.stringify({
          data: {
            uuid: "11111111-1111-4111-8111-111111111111",
            run: {
              id: "11111111-1111-4111-8111-111111111111",
              ref: "v2.4.0-rc.2",
              dataset: "contract-corpus-v9",
              cases: 120,
              passed: 114,
              failed: 6,
              started: "1 hour ago",
              duration: "—",
              delta: -1.2,
              status: "complete-with-regressions",
            },
            skill: {
              id: "skl_ccr",
              skillUuid: "skill-uuid",
              name: "Contract Clause Reviewer",
              description: "Reviews contract clauses.",
              tier: 1,
              owner: "ari.chen",
              team: "Legal Ops",
              repo: "acme/legal-skills",
              repoProvider: "github",
              ref: "v2.3.7",
              commit: "abc1234",
              branch: "main",
              candidateRef: "v2.4.0-rc.2",
              candidateCommit: "def5678",
              versionCount: 8,
              prodEnv: "production",
              channel: "production",
              score: 94.2,
              trend: [91.2, 92.6, 94.2],
              accessGroup: "legal-readers",
              lastEval: "1 hour ago",
              status: "candidate-awaiting-approval",
              projection: {
                sourcePath: "tier2/methodology/legal/contract-review/SKILL.md",
                sourceCommitSha: "def5678",
                indexedAt: "2026-05-23T12:00:00.000Z",
              },
            },
            baselineRun: null,
            release: null,
            executedBy: "control-plane index",
            executionEnvironment: "Indexed benchmark run",
            candidateModel: "Not indexed",
            judgeModel: "Not indexed · balanced rubric judge",
            focus: "contract benchmark regressions",
            readOnly: false,
            publishedRef: "v2.3.7",
            metrics: [],
            metricAlignment: [],
            failureClusters: [],
            recommendations: [],
            customTestPresets: [],
            reviewerNotes: [],
            historicalRuns: [],
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "derived-index",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await fetchEvaluationDetail("11111111-1111-4111-8111-111111111111", {
    workspaceSlug: "finance-ops",
  });
  assert.equal(response.data.uuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(response.data.run.dataset, "contract-corpus-v9");
  assert.equal(response.data.skill.name, "Contract Clause Reviewer");
});

test("createAIConnection posts the new connection payload to the AI connections endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "/api/ai-connections?workspaceSlug=finance-ops");
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.body,
        JSON.stringify({
          provider: "openai",
          label: "Production GPT-4.1",
          defaultModel: "gpt-4.1",
          purpose: "Execution model",
          usageScope: "production evaluations",
          apiKey: "sk-prod-1234567890",
          allowedModels: ["gpt-4.1", "gpt-4.1-mini"],
          supportsExecution: true,
          supportsJudging: true,
          isDefaultExecution: true,
          isDefaultJudge: false,
        }),
      );

      return new Response(
        JSON.stringify({
          data: {
            aiConnectionUuid: "11111111-1111-4111-8111-111111111111",
            provider: "openai",
            label: "Production GPT-4.1",
            defaultModel: "gpt-4.1",
            purpose: "Execution model",
            usageScope: "production evaluations",
            supportsExecution: true,
            supportsJudging: true,
            isDefaultExecution: true,
            isDefaultJudge: false,
            status: "active",
            lastUsed: "never",
            lastRotated: "never",
            secretStore: "Savant encrypted vault · ai/openai-prod",
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 201,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await createAIConnection(
    {
      provider: "openai",
      label: "Production GPT-4.1",
      defaultModel: "gpt-4.1",
      purpose: "Execution model",
      usageScope: "production evaluations",
      apiKey: "sk-prod-1234567890",
      allowedModels: ["gpt-4.1", "gpt-4.1-mini"],
      supportsExecution: true,
      supportsJudging: true,
      isDefaultExecution: true,
      isDefaultJudge: false,
    },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.aiConnectionUuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(response.data.provider, "openai");
});

test("rotateAIConnection posts the secret rotation payload to the AI connection route", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "/api/ai-connections/11111111-1111-4111-8111-111111111111/rotate?workspaceSlug=finance-ops",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.body,
        JSON.stringify({
          apiKey: "sk-rotated-1234567890",
          defaultModel: "gpt-4.1",
          allowedModels: ["gpt-4.1", "gpt-4.1-mini"],
        }),
      );

      return new Response(
        JSON.stringify({
          data: {
            aiConnectionUuid: "11111111-1111-4111-8111-111111111111",
            provider: "openai",
            label: "Production GPT-4.1",
            defaultModel: "gpt-4.1",
            purpose: "Execution model",
            usageScope: "production evaluations",
            supportsExecution: true,
            supportsJudging: true,
            isDefaultExecution: true,
            isDefaultJudge: false,
            status: "active",
            lastUsed: "never",
            lastRotated: "just now",
            secretStore: "Savant encrypted vault · ai/openai-prod",
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await rotateAIConnection(
    "11111111-1111-4111-8111-111111111111",
    {
      apiKey: "sk-rotated-1234567890",
      defaultModel: "gpt-4.1",
      allowedModels: ["gpt-4.1", "gpt-4.1-mini"],
    },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.lastRotated, "just now");
});

test("setAIConnectionDefaults posts default flags to the AI default route", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "/api/ai-connections/11111111-1111-4111-8111-111111111111/default?workspaceSlug=finance-ops",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.body,
        JSON.stringify({
          setAsExecutionDefault: true,
          setAsJudgeDefault: true,
        }),
      );

      return new Response(
        JSON.stringify({
          data: {
            aiConnectionUuid: "11111111-1111-4111-8111-111111111111",
            provider: "openai",
            label: "Production GPT-4.1",
            defaultModel: "gpt-4.1",
            purpose: "Execution model",
            usageScope: "production evaluations",
            supportsExecution: true,
            supportsJudging: true,
            isDefaultExecution: true,
            isDefaultJudge: true,
            status: "active",
            lastUsed: "never",
            lastRotated: "just now",
            secretStore: "Savant encrypted vault · ai/openai-prod",
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await setAIConnectionDefaults(
    "11111111-1111-4111-8111-111111111111",
    {
      setAsExecutionDefault: true,
      setAsJudgeDefault: true,
    },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.isDefaultExecution, true);
  assert.equal(response.data.isDefaultJudge, true);
});

test("revokeAIConnection posts the revoke reason to the AI revoke route", async (t) => {
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "/api/ai-connections/11111111-1111-4111-8111-111111111111/revoke?workspaceSlug=finance-ops",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.body,
        JSON.stringify({
          reason: "Rotated into a new production key slot.",
        }),
      );

      return new Response(
        JSON.stringify({
          data: {
            aiConnectionUuid: "11111111-1111-4111-8111-111111111111",
            provider: "openai",
            label: "Production GPT-4.1",
            defaultModel: "gpt-4.1",
            purpose: "Execution model",
            usageScope: "production evaluations",
            supportsExecution: true,
            supportsJudging: true,
            isDefaultExecution: false,
            isDefaultJudge: false,
            status: "revoked",
            lastUsed: "never",
            lastRotated: "just now",
            secretStore: "Savant encrypted vault · ai/openai-prod",
          },
          meta: {
            generatedAt: new Date().toISOString(),
            schemaVersion: 1,
            sourceOfTruth: "database",
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      );
    },
  });

  t.after(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  });

  const response = await revokeAIConnection(
    "11111111-1111-4111-8111-111111111111",
    { reason: "Rotated into a new production key slot." },
    { workspaceSlug: "finance-ops" },
  );

  assert.equal(response.data.status, "revoked");
});