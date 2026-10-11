import assert from "node:assert/strict";
import test from "node:test";

import {
  ArtifactPolicyClientError,
  buildArtifactPolicyEndpoint,
  describeArtifactPolicy,
  listArtifactPolicies,
  makeArtifactPolicyScope,
  postArtifactPolicyMutation,
} from "./artifact-policy-client.ts";

const repositoryId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const scope = () => makeArtifactPolicyScope(repositoryId, "workflow_spec", "triage/quality");
const code = (value: string) => (e: unknown) =>
  e instanceof ArtifactPolicyClientError && e.code === value;

test("PER-1205: bound repository/kind/artifact identifiers and scoped path", () => {
  const s = scope();
  assert.equal(s.artifactId, "triage/quality");
  const path = buildArtifactPolicyEndpoint(s, "my-workspace");
  assert.match(path, /^\/api\/capabilities\/policies\/v1\?/);
  const url = new URL(path, "https://savant.test");
  assert.equal(url.searchParams.get("workspaceSlug"), "my-workspace");
  assert.equal(url.searchParams.get("repositoryId"), repositoryId);
  assert.equal(url.searchParams.get("kind"), "workflow_spec");
  assert.equal(url.searchParams.get("artifactId"), "triage/quality");
  for (const artifact of ["", "../secrets", "a..b", "x?z", "x#y", "a".repeat(129)]) {
    assert.throws(() => makeArtifactPolicyScope(repositoryId, "skill", artifact), code("invalid_policy_scope"));
  }
  assert.throws(() => makeArtifactPolicyScope("not-a-uuid", "skill", "test"), code("invalid_policy_scope"));
  assert.throws(() => buildArtifactPolicyEndpoint(s, ""), code("workspace_slug_required"));
});

test("PER-1205: GET reads ETag, checks response schema and never caches", async () => {
  let requested = 0;
  const fetcher: typeof fetch = async (url, init) => {
    requested++;
    assert.match(String(url), /workspaceSlug=my-workspace/);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    return new Response(JSON.stringify({ data: { revision: 1, rules: [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", effect: "deny",
      principalType: "user", principalRef: memberId,
    }] } }), { status: 200, headers: { ETag: '"v1"', "Content-Type": "application/json" } });
  };
  const result = await listArtifactPolicies(scope(), "my-workspace", fetcher);
  assert.equal(result.revision, 1);
  assert.equal(result.rules[0]?.effect, "deny");
  assert.equal(requested, 1);
});

test("PER-1205: malformed revision or unexpected backend data fails closed", async () => {
  const stale: typeof fetch = async () =>
    new Response(JSON.stringify({data:{revision:1,rules:[]}}),
      {status:200,headers:{ETag:'"v0"'}});
  await assert.rejects(listArtifactPolicies(scope(), "my-workspace", stale), code("invalid_policy_response"));
  const poisoned: typeof fetch = async () =>
    new Response(JSON.stringify({data:{revision:0,rules:[{id:"x",effect:"permit",principalType:"role",principalRef:"member"}]}}),
      {status:200,headers:{ETag:'"v0"'}});
  await assert.rejects(listArtifactPolicies(scope(), "my-workspace", poisoned), code("invalid_policy_response"));
});

test("PER-1205: denied tenants do not expose server error bodies", async () => {
  const denied: typeof fetch = async () => new Response(JSON.stringify({
    error: { code: "not_found", message: "secret private identifier here" },
  }), {status:404});
  await assert.rejects(listArtifactPolicies(scope(), "my-workspace", denied), code("not_found"));
});

test("PER-1205: POST requires matching revision, safe user/group/role and same-origin JSON", async () => {
  let requested = 0;
  const fetcher: typeof fetch = async (_, init) => {
    requested++;
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("If-Match"), '"v3"');
    assert.equal(headers.get("Content-Type"), "application/json");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), [
      "artifactId", "effect", "kind", "operation", "principalRef",
      "principalType", "repositoryId", "requestId",
    ].sort());
    assert.equal(body.operation, "grant");
    assert.equal(body.principalRef, memberId);
    return new Response(JSON.stringify({data:{revision:4,changed:true,replayed:false}}),
      {status:201,headers:{ETag:'"v4"'}});
  };
  const result = await postArtifactPolicyMutation(scope(), {
    operation: "grant", effect: "allow", principalType: "user",
    principalRef: memberId, requestId,
  }, 3, "my-workspace", fetcher);
  assert.deepEqual(result, {revision:4,changed:true,replayed:false});
  assert.equal(requested, 1);
  for (const input of [
    {operation:"grant",effect:"allow",principalType:"user",principalRef:"admin@example.test",requestId},
    {operation:"grant",effect:"allow",principalType:"role",principalRef:"admin",requestId},
    {operation:"grant",effect:"allow",principalType:"user",principalRef:memberId,requestId:"bad"},
  ]) {
    await assert.rejects(postArtifactPolicyMutation(scope(), input as never, 3, "my-workspace", fetcher),
      code("invalid_policy_mutation"));
  }
  await assert.rejects(postArtifactPolicyMutation(scope(), {
    operation:"grant",effect:"allow",principalType:"user",principalRef:memberId,requestId,
  }, -1, "my-workspace", fetcher), code("policy_precondition_required"));
  assert.equal(requested,1,"Invalid mutation must never issue a request");
});

test("PER-1205: 409 stale write is explicit and does not retry unsafely", async () => {
  let requests = 0;
  const conflict: typeof fetch = async () => {
    requests++;
    return new Response(JSON.stringify({error:{code:"policy_revision_conflict"}}),{status:409});
  };
  await assert.rejects(postArtifactPolicyMutation(scope(), {
    operation:"revoke",effect:"deny",principalType:"role",principalRef:"member",requestId,
  }, 8, "my-workspace", conflict),code("policy_revision_conflict"));
  assert.equal(requests,1);
});

test("PER-1205: denial precedence never implies an unproven principal decision", () => {
  assert.match(describeArtifactPolicy([]), /repository access remains required/i);
  assert.match(describeArtifactPolicy([{
    id: requestId, effect:"deny",principalType:"role",principalRef:"member",
  }]), /denies override allows/i);
  assert.doesNotMatch(describeArtifactPolicy([]), /access granted/i);
});
