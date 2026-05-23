import assert from "node:assert/strict";
import test from "node:test";

import { getRepositoryProviderReadiness } from "@savant/types";
import {
  canUseTenantDatabaseReadModel,
  isDevelopmentReadModelFallbackAllowed,
} from "./read-model-policy.ts";
import {
  FALLBACK_OVERVIEW_SOURCE_OF_TRUTH,
  FALLBACK_REPOSITORY_DETAIL_SOURCE_OF_TRUTH,
  FALLBACK_REPOSITORY_LIST_SOURCE_OF_TRUTH,
  FALLBACK_SKILL_DETAIL_SOURCE_OF_TRUTH,
  FALLBACK_SKILL_LIST_SOURCE_OF_TRUTH,
  emptyRepositoryProjection,
  emptySkillProjection,
  mapFallbackRepository,
  mapFallbackSkill,
} from "./read-model-fallback.ts";

import { buildRepositoryWebUrl } from "../../lib/repository-links.ts";
import { REPOS, SKILLS } from "../../lib/savant-data.ts";

test("fallback repository responses do not claim canonical database ownership", () => {
  assert.equal(FALLBACK_REPOSITORY_LIST_SOURCE_OF_TRUTH, "mixed");
  assert.deepEqual(emptyRepositoryProjection(), {
    indexedAt: null,
    lastSuccessfulSyncAt: null,
    lastWebhookAt: null,
  });

  assert.deepEqual(mapFallbackRepository(REPOS[0]!), {
    ...REPOS[0],
    providerReadiness: getRepositoryProviderReadiness(REPOS[0]!.provider),
    webUrl: buildRepositoryWebUrl({
      provider: REPOS[0]!.provider,
      name: REPOS[0]!.name,
    }),
    projection: emptyRepositoryProjection(),
  });
});

test("fallback skill responses expose null projection provenance instead of invented Git pointers", () => {
  assert.equal(FALLBACK_SKILL_LIST_SOURCE_OF_TRUTH, "derived-index");
  assert.deepEqual(emptySkillProjection(), {
    sourcePath: null,
    sourceCommitSha: null,
    indexedAt: null,
  });

  assert.deepEqual(mapFallbackSkill(SKILLS[0]!), {
    ...SKILLS[0],
    projection: emptySkillProjection(),
  });
});

test("fallback detail surfaces keep mixed source-of-truth semantics", () => {
  assert.equal(FALLBACK_REPOSITORY_DETAIL_SOURCE_OF_TRUTH, "mixed");
  assert.equal(FALLBACK_SKILL_DETAIL_SOURCE_OF_TRUTH, "mixed");
});

test("fallback overview uses mixed source-of-truth metadata for static control-plane fixtures", () => {
  assert.equal(FALLBACK_OVERVIEW_SOURCE_OF_TRUTH, "mixed");
});

test("canUseTenantDatabaseReadModel only allows tenant-backed non-fallback contexts", () => {
  assert.equal(
    canUseTenantDatabaseReadModel({
      context: undefined,
      isDatabaseConfigured: true,
    }),
    false,
  );

  assert.equal(
    canUseTenantDatabaseReadModel({
      context: { isDevelopmentFallback: true },
      isDatabaseConfigured: true,
    }),
    false,
  );

  assert.equal(
    canUseTenantDatabaseReadModel({
      context: { isDevelopmentFallback: false },
      isDatabaseConfigured: false,
    }),
    false,
  );

  assert.equal(
    canUseTenantDatabaseReadModel({
      context: { isDevelopmentFallback: false },
      isDatabaseConfigured: true,
    }),
    true,
  );
});

test("isDevelopmentReadModelFallbackAllowed only allows local dev fallback paths", () => {
  assert.equal(
    isDevelopmentReadModelFallbackAllowed({
      context: undefined,
      nodeEnv: "development",
    }),
    true,
  );

  assert.equal(
    isDevelopmentReadModelFallbackAllowed({
      context: { isDevelopmentFallback: true },
      nodeEnv: "development",
    }),
    true,
  );

  assert.equal(
    isDevelopmentReadModelFallbackAllowed({
      context: { isDevelopmentFallback: false },
      nodeEnv: "development",
    }),
    false,
  );

  assert.equal(
    isDevelopmentReadModelFallbackAllowed({
      context: undefined,
      nodeEnv: "production",
    }),
    false,
  );
});