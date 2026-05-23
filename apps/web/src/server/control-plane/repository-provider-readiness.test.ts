import assert from "node:assert/strict";
import test from "node:test";

import {
  getRepositoryProviderReadiness,
  supportsRepositorySyncMode,
} from "@savant/types";

import { hasRegisteredRepositoryReadAdapter } from "./repository-provider-read-adapter.ts";
import {
  supportsRepositoryProvisioningWrites,
  supportsRepositoryWebhookRegistration,
} from "./repository-provider-write-adapter.ts";

test("shared provider readiness matches the currently registered GitHub and GitLab adapter surface", () => {
  const github = getRepositoryProviderReadiness("github");
  const gitlab = getRepositoryProviderReadiness("gitlab");

  assert.equal(github.supportsLiveTreePreview, hasRegisteredRepositoryReadAdapter("github"));
  assert.equal(github.indexingSupported, hasRegisteredRepositoryReadAdapter("github"));
  assert.equal(github.supportsProvisioningWrites, supportsRepositoryProvisioningWrites("github"));
  assert.equal(github.supportsWebhookRegistration, supportsRepositoryWebhookRegistration("github"));
  assert.equal(supportsRepositorySyncMode(github, "webhook"), false);
  assert.equal(supportsRepositorySyncMode(github, "poll"), true);
  assert.equal(supportsRepositorySyncMode(github, "manual"), true);

  assert.equal(gitlab.supportsLiveTreePreview, hasRegisteredRepositoryReadAdapter("gitlab"));
  assert.equal(gitlab.indexingSupported, hasRegisteredRepositoryReadAdapter("gitlab"));
  assert.equal(gitlab.supportsProvisioningWrites, supportsRepositoryProvisioningWrites("gitlab"));
  assert.equal(gitlab.supportsWebhookRegistration, supportsRepositoryWebhookRegistration("gitlab"));
  assert.equal(supportsRepositorySyncMode(gitlab, "webhook"), false);
  assert.equal(supportsRepositorySyncMode(gitlab, "poll"), true);
  assert.equal(supportsRepositorySyncMode(gitlab, "manual"), true);
});

test("shared provider readiness keeps unsupported providers in manual-preview mode", () => {
  const azure = getRepositoryProviderReadiness("azure");

  assert.equal(azure.supportsLiveTreePreview, false);
  assert.equal(azure.indexingSupported, false);
  assert.deepEqual(azure.supportedSyncModes, ["manual"]);
  assert.match(azure.liveTreePreview.message, /snapshot/i);
  assert.match(azure.immediateIndexing.message, /not wired/i);
});
