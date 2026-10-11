import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityReferenceError,
  capabilityReferenceJsonSchema,
  canonicalizeCapabilityReference,
  makeWorkflowCapabilityProjection,
  migrateLegacySkillReference,
  parseCapabilityLink,
  parseCapabilityReference,
} from "./capability-reference.ts";

const SHA = "a".repeat(40);
const HASH = "b".repeat(64);
function reference() {
  return {
    schemaVersion: 1, kind: "workflow_spec", organizationId: "tenant-a",
    artifactId: "triage", version: "1.2.3",
    contentHash: "sha256:" + HASH,
    locator: { source: "git", repositoryId: "repo-a", path: "workflows/triage.json", commitSha: SHA },
    extensions: { native: { z: 2, arbitrary: ["λ", { kept: true }] } },
  };
}
const fails = (code: string) => (e: unknown) => e instanceof CapabilityReferenceError && e.code === code;

test("SAV-14: canonical, versioned workflow ref roundtrip preserves unknown opaque extensions", () => {
  const parsed = parseCapabilityReference(reference());
  assert.deepEqual(parsed, reference());
  assert.deepEqual(parseCapabilityReference(JSON.parse(canonicalizeCapabilityReference(parsed))), parsed);
  const reordered = { ...reference(), locator: { commitSha: SHA, path: "workflows/triage.json", source: "git", repositoryId: "repo-a" } };
  assert.equal(canonicalizeCapabilityReference(parsed), canonicalizeCapabilityReference(parseCapabilityReference(reordered)));
});
test("SAV-14: invalid versions, hashes, paths, input sizes and missing tenant fail closed", () => {
  for (const version of ["latest", "v1", "1.0", "1.0.0-foo..bar", "01.1.1"]) {
    assert.throws(() => parseCapabilityReference({ ...reference(), version }), fails("version_invalid"));
  }
  assert.throws(() => parseCapabilityReference({ ...reference(), contentHash: "sha256:bad" }), fails("digest_invalid"));
  assert.throws(() => parseCapabilityReference({ ...reference(), organizationId: "" }), fails("identity_invalid"));
  assert.throws(() => parseCapabilityReference({ ...reference(), locator: { ...reference().locator, path: "../secrets" } }), fails("locator_invalid"));
  assert.throws(() => parseCapabilityReference({ ...reference(), extensions: { text: "x".repeat(600_000) } }), fails("size_limit"));
  assert.throws(() => parseCapabilityReference({ ...reference(), unexpected: "executable" }), fails("unknown_field"));
});
test("SAV-14: cross-tenant or mismatched artifact revision link is not accepted", () => {
  const from = reference();
  const to = { ...reference(), kind: "test_suite", artifactId: "quality-suite", version: "2.0.0" };
  assert.deepEqual(parseCapabilityLink({ relation: "evaluates", from: to, to: from }).relation, "evaluates");
  assert.throws(() => parseCapabilityLink({ relation: "evaluates", from, to: { ...to, organizationId: "tenant-b" } }), fails("cross_tenant_link"));
  assert.throws(() => parseCapabilityLink({ relation: "depends_on", from, to: { ...to, version: "bad" } }), fails("version_invalid"));
  assert.throws(() => parseCapabilityLink({ relation: "runs", from, to }), fails("relation_invalid"));
});
test("SAV-14: legacy skill conversion retains raw old fields without fabricating a Git commit", () => {
  const legacy = {
    id: "legacy/skill", name: "Review", version: "1.0.0",
    projection: { sourcePath: "tier3/workflow/review/SKILL.md", sourceCommitSha: SHA, indexedAt: null },
    custom: { providerTag: "keep-me" },
  };
  const migrated = migrateLegacySkillReference({ organizationId: "tenant-a", skill: legacy, repositoryId: "repo-a" });
  assert.equal(migrated.status, "ready");
  if (migrated.status !== "ready") return;
  assert.equal(migrated.reference.kind, "skill");
  assert.equal(migrated.reference.locator.source, "git");
  assert.deepEqual(migrated.reference.extensions?.legacy, legacy);
  assert.deepEqual(migrated.lossReport.map(x => x.code), ["digest_missing"]);
  const missing = migrateLegacySkillReference({ organizationId: "tenant-a", skill: { id: "old", version: "latest", arbitrary: 9 } });
  assert.equal(missing.status, "unresolved");
  assert.deepEqual(missing.lossReport.map(x => x.code).sort(), ["commit_missing", "repository_missing", "version_unrecognized", "path_missing", "digest_missing"].sort());
  assert.deepEqual(missing.original, { id: "old", version: "latest", arbitrary: 9 });
});
test("SAV-14: workflow projection is derived from trusted control-plane identities and stable git digest", () => {
  const output = makeWorkflowCapabilityProjection({
    organizationId: "tenant-a", repositoryId: "repo-a", workflowId: "triage",
    version: "1.2.3", commitSha: SHA, digest: HASH,
  });
  assert.equal(output.status, "ready");
  if (output.status !== "ready") return;
  assert.deepEqual(output.reference.locator, reference().locator);
  assert.equal(output.reference.organizationId, "tenant-a");
  assert.equal(output.reference.contentHash, "sha256:" + HASH);
  const unsupported = makeWorkflowCapabilityProjection({
    organizationId: "tenant-a", repositoryId: "repo-a", workflowId: "triage",
    version: "latest", commitSha: SHA, digest: HASH,
  });
  assert.deepEqual(unsupported, { status: "unavailable", reason: "version_invalid" });
});

test("SAV-14: JSON Schema v1 major and SemVer constraints agree with runtime parser", () => {
  assert.equal(capabilityReferenceJsonSchema.$id, "https://savant.dev/schemas/capability-reference/v1.json");
  assert.deepEqual(capabilityReferenceJsonSchema.properties.locator.oneOf[0].required, ["source", "repositoryId", "path", "commitSha"]);
  const versionPattern = new RegExp(capabilityReferenceJsonSchema.properties.version.pattern);
  for (const version of ["1.0.0", "3.22.9-rc.1+build.18", "0.0.0-legacy"]) assert.equal(versionPattern.test(version), true, version);
  for (const version of ["latest", "1.2", "01.2.3", "1.0.0-foo..bar", "1.0.0-01"]) assert.equal(versionPattern.test(version), false, version);
});
test("SAV-14: hostile object prototypes, getters, unsafe extension keys and non-JSON values never execute", () => {
  const input = reference();
  Object.defineProperty(input, "secret", { enumerable: true, get() { throw Error("must never execute"); } });
  assert.throws(() => parseCapabilityReference(input), fails("invalid_json"));
  assert.throws(() => parseCapabilityReference({ ...reference(), extensions: JSON.parse('{"__proto__":{"root":true}}') }), fails("invalid_json"));
  assert.throws(() => parseCapabilityReference({ ...reference(), extensions: { value: Number.NaN } }), fails("invalid_json"));
  assert.throws(() => parseCapabilityReference({ ...reference(), extensions: { date: new Date("2026-01-01T00:00:00Z") } }), fails("invalid_json"));
});
test("SAV-14: organizational scope and revision remain immutable in the original input", () => {
  const input = reference();
  const parsed = parseCapabilityReference(input);
  input.organizationId = "tenant-elsewhere";
  input.locator.repositoryId = "foreign";
  assert.equal(parsed.organizationId, "tenant-a");
  assert.equal(parsed.locator.source, "git");
  if (parsed.locator.source === "git") assert.equal(parsed.locator.repositoryId, "repo-a");
});
