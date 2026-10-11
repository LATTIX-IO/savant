import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityLinkService } from "./capability-links.ts";
import { CapabilityResolveError, createCapabilityResolver } from "./capability-resolver.ts";

const tenant = { organizationId: "tenant-a", subject: "alice" };
const sha = "a".repeat(40), digest = "b".repeat(64);
const reference = (id: string, repo = "repo-a") => ({
  schemaVersion: 1, kind: "workflow_spec", organizationId: "tenant-a",
  artifactId: id, version: "1.0.0", contentHash: "sha256:" + digest,
  locator: { source: "git", repositoryId: repo, path: `workflows/${id}.json`, commitSha: sha },
});
const link = (from = reference("first"), to = reference("second")) => ({
  relation: "depends_on", from, to,
});
const denied = (code: string) => (error: unknown) =>
  error instanceof CapabilityResolveError && error.code === code;

function fixture(blockedRepo?: string, failAt?: string) {
  const calls: string[] = [];
  const resolver = createCapabilityResolver({
    async authorize(_actor, ref) {
      const repositoryId = ref.locator.source === "git" ? ref.locator.repositoryId : "";
      calls.push("auth:" + repositoryId + ":" + ref.artifactId);
      if (repositoryId === blockedRepo) throw new CapabilityResolveError("not_found", 404);
    },
    async workflow(_actor, ref) {
      calls.push("read:" + ref.artifactId);
      if (ref.artifactId === failAt) throw new Error("provider token MUST_NOT_LEAK");
      return {
        specification: { workflowId: ref.artifactId, version: ref.version },
        digest, commitSha: sha,
      };
    },
    async skill() {
      throw new Error("unexpected skill fetch");
    },
  });
  return { service: createCapabilityLinkService(resolver), calls };
}
test("PER-1173: authorized link resolves pinned nodes with only provenance metadata returned", async () => {
  const { service, calls } = fixture();
  const result = await service.resolve(tenant, { links: [link()] });
  assert.equal(result.links.length, 1);
  assert.equal(result.nodeCount, 2);
  assert.equal(result.links[0]?.from.verifiedDigest, "sha256:" + digest);
  assert.equal(result.links[0]?.to.reference.artifactId, "second");
  assert.equal(JSON.stringify(result).includes("specification"), false);
  assert.deepEqual(calls.slice(0,2), ["auth:repo-a:first", "auth:repo-a:second"]);
  assert.ok(calls.indexOf("read:first") > calls.indexOf("auth:repo-a:second"));
});
test("PER-1173: deny second repository before ANY provider read or partial link return", async () => {
  const { service, calls } = fixture("repo-denied");
  await assert.rejects(service.resolve(tenant, { links: [
    link(reference("first"), reference("second", "repo-denied")),
  ] }), denied("not_found"));
  assert.deepEqual(calls, ["auth:repo-a:first", "auth:repo-denied:second"]);
});
test("PER-1173: mixed tenant link denies before authorization or provider IO", async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.resolve(tenant, { links: [
    link(reference("first"), { ...reference("second"), organizationId: "tenant-b" }),
  ] }), denied("not_found"));
  assert.deepEqual(calls, []);
});
test("PER-1173: all links preflight before reads; failure in later edge cannot leak earlier content", async () => {
  const { service, calls } = fixture("repo-denied");
  await assert.rejects(service.resolve(tenant, { links: [
    link(reference("first"), reference("second")),
    link(reference("second"), reference("third", "repo-denied")),
  ] }), denied("not_found"));
  assert.equal(calls.filter(x=>x.startsWith("read:")).length, 0);
});
test("PER-1173: shared graph nodes are authorized and read once per request", async () => {
  const { service, calls } = fixture();
  const result = await service.resolve(tenant, { links: [
    link(reference("first"), reference("second")),
    link(reference("second"), reference("third")),
  ] });
  assert.equal(result.links.length, 2);
  assert.equal(result.nodeCount, 3);
  assert.equal(calls.filter(x=>x==="read:second").length, 1);
});
test("PER-1173: unknown kinds, missing SHA-256, invalid links and self-relations fail before network", async () => {
  const { service, calls } = fixture();
  for (const bad of [
    link({ ...reference("first"), kind: "model" }, reference("second")),
    link(reference("first"), Object.fromEntries(Object.entries(reference("second")).filter(([k])=>k!=="contentHash"))),
    { ...link(), relation: "deploys" },
    link(reference("first"), reference("first")),
  ]) {
    await assert.rejects(service.resolve(tenant, {links:[bad]}), (e: unknown) => e instanceof CapabilityResolveError);
  }
  assert.deepEqual(calls, []);
});
test("PER-1173: bounds number of relationships and rejects empty/malformed input", async () => {
  const { service, calls } = fixture();
  for (const bad of [undefined, null, {}, {links:[]}, {links:"x"},
    {links:Array.from({length:9},()=>link())}, {links:[link()], extra:true}]) {
    await assert.rejects(service.resolve(tenant, bad), denied("invalid_link_batch"));
  }
  assert.deepEqual(calls, []);
});
test("PER-1173: unexpected getter and malicious prototype never execute", async () => {
  const { service, calls } = fixture();
  const input = {links:[link()]};
  Object.defineProperty(input.links, "0", {enumerable:true,get(){throw new Error("getter executed");}});
  await assert.rejects(service.resolve(tenant, input), denied("invalid_link_batch"));
  await assert.rejects(service.resolve(tenant, {links:[JSON.parse('{"__proto__":{"polluted":true}}')]}), denied("invalid_link_batch"));
  assert.deepEqual(calls, []);
});
test("PER-1173: provider fault yields no partial output or secret-bearing errors", async () => {
  const { service } = fixture(undefined, "second");
  await assert.rejects(service.resolve(tenant, {links:[link()]}), (e: unknown) =>
    denied("provider_unavailable")(e) && !String(e).includes("MUST_NOT_LEAK"));
});
test("PER-1173: foreign actor denied before provider/SQL", async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.resolve({organizationId:"tenant-b",subject:"alice"}, {links:[link()]}), denied("not_found"));
  assert.deepEqual(calls, []);
});
