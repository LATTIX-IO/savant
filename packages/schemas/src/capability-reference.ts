import type {
  CapabilityArtifactKind, CapabilityLinkV1, CapabilityLossEntry, CapabilityProjection,
  CapabilityReferenceV1, CapabilityRelation, LegacySkillMigration,
} from "@savant/types/capability-reference";

/** A pure reference contract, not an executor, authorization grant or provider connector. */
export class CapabilityReferenceError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    super(`${code}: ${path}`);
    this.name = "CapabilityReferenceError";
    this.code = code;
    this.path = path;
  }
}
const KINDS: readonly CapabilityArtifactKind[] = [
  "skill", "plugin", "agent", "tool", "model", "mcp", "knowledge", "instruction",
  "workflow_spec", "test_suite", "eval_run", "experiment", "scorecard", "quality_gate", "runtime_observation",
];
const RELATIONS: readonly CapabilityRelation[] = ["depends_on", "evaluates", "observes", "derived_from"];
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** JSON Schema 2020-12; runtime parser additionally enforces bounded JSON and safe prototypes. */
export const capabilityReferenceJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/capability-reference/v1.json",
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "kind", "organizationId", "artifactId", "version", "locator"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { enum: KINDS },
    organizationId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$", not: {pattern: "\\.\\."} },
    artifactId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$", not: {pattern: "\\.\\."} },
    version: {type:"string", maxLength:128, pattern:"^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$"},
    contentHash: {type:"string", pattern:"^sha256:[0-9a-fA-F]{64}$"},
    locator: {oneOf:[
      {type:"object", additionalProperties:false, required:["source","repositoryId","path","commitSha"],properties:{
        source:{const:"git"},repositoryId:{type:"string",minLength:1,maxLength:128},
        path:{type:"string",pattern:"^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$",not:{pattern:"(?:^|/)\\.\\.(?:/|$)"}},
        commitSha:{type:"string",pattern:"^[0-9a-fA-F]{40}$"},
      }},
      {type:"object",additionalProperties:false,required:["source","recordId"],properties:{
        source:{const:"database"},recordId:{type:"string",minLength:1,maxLength:128},
      }},
    ]},
    extensions:{type:"object"},
  },
  allOf:[{if:{properties:{kind:{enum:["workflow_spec","test_suite","skill"]}},required:["kind"]},
    then:{properties:{locator:{properties:{source:{const:"git"}},required:["source"]}}}}],
} as const;

function fail(code: string, path: string): never { throw new CapabilityReferenceError(code, path); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("unknown_field", path + "." + key);
}
function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID.test(value) || value.includes("..")) fail("identity_invalid", path);
  return value as string;
}
function semver(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128) return false;
  const match = SEMVER.exec(value);
  if (!match) return false;
  return !match[4]?.split(".").some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"));
}
/** Avoid invoking supplied getters, toJSON functions or prototype pollution before making a snapshot. */
function safeJson(value: unknown, path = "$", depth = 0): void {
  if (depth > 16) fail("size_limit", path);
  if (Array.isArray(value)) {
    if (value.length > 2000) fail("size_limit", path);
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !("value" in descriptor)) fail("invalid_json", path);
      safeJson(descriptor.value, `${path}[${i}]`, depth + 1);
    }
    for (const key of Object.keys(value)) if (!/^(0|[1-9]\d*)$/.test(key)) fail("invalid_json", path);
  } else if (isRecord(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail("invalid_json", path);
    if (Object.keys(value).length > 1000) fail("size_limit", path);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("invalid_json", path);
      if (!("value" in descriptor)) fail("invalid_json", path);
      safeJson(descriptor.value, path + "." + key, depth + 1);
    }
  } else if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))) {
    fail("invalid_json", path);
  }
}
function snapshot(input: unknown): unknown {
  safeJson(input);
  const wire = JSON.stringify(input);
  if (!wire || wire.length > 400_000) fail("size_limit", "$");
  return JSON.parse(wire) as unknown;
}
function validate(input: unknown): CapabilityReferenceV1 {
  if (!isRecord(input)) fail("invalid_reference", "$");
  fields(input, ["schemaVersion", "kind", "organizationId", "artifactId", "version", "contentHash", "locator", "extensions"], "$");
  if (input.schemaVersion !== 1) fail("unsupported_version", "$.schemaVersion");
  if (!KINDS.includes(input.kind as CapabilityArtifactKind)) fail("kind_invalid", "$.kind");
  id(input.organizationId, "$.organizationId");
  id(input.artifactId, "$.artifactId");
  if (!semver(input.version)) fail("version_invalid", "$.version");
  if (input.contentHash !== undefined && (typeof input.contentHash !== "string" || !SHA256.test(input.contentHash))) {
    fail("digest_invalid", "$.contentHash");
  }
  const locator = input.locator;
  if (!isRecord(locator)) fail("locator_invalid", "$.locator");
  if (locator.source === "git") {
    fields(locator, ["source", "repositoryId", "path", "commitSha"], "$.locator");
    id(locator.repositoryId, "$.locator.repositoryId");
    if (typeof locator.path !== "string" || !PATH.test(locator.path) || locator.path.split("/").some(p => p === "." || p === "..")) fail("locator_invalid", "$.locator.path");
    if (typeof locator.commitSha !== "string" || !SHA1.test(locator.commitSha)) fail("locator_invalid", "$.locator.commitSha");
  } else if (locator.source === "database") {
    fields(locator, ["source", "recordId"], "$.locator");
    id(locator.recordId, "$.locator.recordId");
    if (input.kind === "workflow_spec" || input.kind === "test_suite" || input.kind === "skill") fail("locator_invalid", "$.locator.source");
  } else fail("locator_invalid", "$.locator.source");
  if (input.extensions !== undefined && !isRecord(input.extensions)) fail("extensions_invalid", "$.extensions");
  return input as unknown as CapabilityReferenceV1;
}
export function parseCapabilityReference(input: unknown): CapabilityReferenceV1 {
  return validate(snapshot(input));
}
export function parseCapabilityLink(input: unknown): CapabilityLinkV1 {
  const copy = snapshot(input);
  if (!isRecord(copy)) fail("invalid_link", "$");
  fields(copy, ["relation", "from", "to"], "$");
  if (!RELATIONS.includes(copy.relation as CapabilityRelation)) fail("relation_invalid", "$.relation");
  const from = validate(copy.from);
  const to = validate(copy.to);
  if (from.organizationId !== to.organizationId) fail("cross_tenant_link", "$.to.organizationId");
  return { relation: copy.relation as CapabilityRelation, from, to };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, val]) => [key, canonical(val)]));
  return value;
}
export function canonicalizeCapabilityReference(ref: CapabilityReferenceV1): string {
  return JSON.stringify(canonical(parseCapabilityReference(ref)));
}
/** Derived exclusively from authenticated tenant + resolved repository + verified Git provenance. */
export function makeWorkflowCapabilityProjection(input: {
  organizationId: string; repositoryId: string; workflowId: string;
  version: string; commitSha: string; digest: string;
}): CapabilityProjection {
  if (!semver(input.version)) return { status: "unavailable", reason: "version_invalid" };
  if (!SHA1.test(input.commitSha)) return { status: "unavailable", reason: "revision_invalid" };
  if (!/^[0-9a-f]{64}$/i.test(input.digest)) return { status: "unavailable", reason: "digest_invalid" };
  try {
    return { status: "ready", reference: parseCapabilityReference({
      schemaVersion: 1, kind: "workflow_spec",
      organizationId: input.organizationId, artifactId: input.workflowId,
      version: input.version, contentHash: "sha256:" + input.digest.toLowerCase(),
      locator: { source: "git", repositoryId: input.repositoryId, path: `workflows/${input.workflowId}.json`, commitSha: input.commitSha },
    }), lossReport: [] };
  } catch (error) {
    if (error instanceof CapabilityReferenceError) return { status: "unavailable", reason: "identity_invalid" };
    throw error;
  }
}
function loss(code: CapabilityLossEntry["code"], description: string): CapabilityLossEntry { return { code, description }; }
/** Additive migration view: retain the original legacy record verbatim, never invent a SHA/version. */
export function migrateLegacySkillReference(input: {
  organizationId: string; repositoryId?: string;
  skill: Record<string, unknown>;
}): LegacySkillMigration {
  const original = snapshot(input.skill);
  if (!isRecord(original)) fail("invalid_json", "$.skill");
  const losses: CapabilityLossEntry[] = [];
  if (!semver(original.version)) losses.push(loss("version_unrecognized", "Legacy version does not comply with SemVer; no synthetic version was assigned."));
  if (!input.repositoryId) losses.push(loss("repository_missing", "No tenant-scoped repository identifier was supplied."));
  const projection = isRecord(original.projection) ? original.projection : null;
  if (typeof projection?.sourcePath !== "string" || !PATH.test(projection.sourcePath)) losses.push(loss("path_missing", "No valid Git-relative source path was indexed."));
  if (typeof projection?.sourceCommitSha !== "string" || !SHA1.test(projection.sourceCommitSha)) losses.push(loss("commit_missing", "No immutable source commit was indexed."));
  const hash = original.contentHash;
  if (typeof hash !== "string" || !SHA256.test(hash)) losses.push(loss("digest_missing", "The legacy index had no canonical SHA-256 digest; integrity is revision-only."));
  if (losses.some(entry => entry.code !== "digest_missing") || typeof original.id !== "string") {
    return { status: "unresolved", original, lossReport: losses };
  }
  const obj: Record<string, unknown> = {
    schemaVersion: 1, kind: "skill", organizationId: input.organizationId,
    artifactId: original.id, version: original.version,
    locator: { source: "git", repositoryId: input.repositoryId, path: projection!.sourcePath, commitSha: projection!.sourceCommitSha },
    extensions: { legacy: original },
  };
  if (typeof hash === "string" && SHA256.test(hash)) obj.contentHash = hash;
  return { status: "ready", reference: parseCapabilityReference(obj), lossReport: losses };
}
