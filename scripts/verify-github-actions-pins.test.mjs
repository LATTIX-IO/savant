import assert from "node:assert/strict";
import test from "node:test";
import {inspectWorkflowPins} from "./verify-github-actions-pins.mjs";

const pinned="actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1";
const pnpm="pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86";
test("PER-1557: immutable exact SHA is accepted, local project action is separate",()=>{
  const result=inspectWorkflowPins("good.yml",[
    "steps:","  - uses: "+pinned+" # v7.1.0",
    "  - uses: "+pnpm,
    "  - uses: ./.github/actions/internal",
    "# - uses: actions/setup-node@v7",
  ].join("\n"));
  assert.equal(result.total,2);
  assert.deepEqual(result.findings,[]);
});
test("PER-1557: mutable tags, abbreviated digests, branches and Docker tags fail closed",()=>{
  const lines=[
    "  - uses: actions/setup-node@v7",
    "  - uses: pnpm/action-setup@main",
    "  - uses: actions/setup-node@1234567",
    "  - uses: docker://alpine:latest",
    "  - uses: $"+"{{ secrets.DYNAMIC_ACTION }}",
    "  - uses: actions/upload-artifact@deadbeef # unverified",
  ];
  const got=inspectWorkflowPins("bad.yml",lines.join("\n"));
  assert.equal(got.total,lines.length);
  assert.deepEqual(got.findings.map(x=>x.line),[1,2,3,4,5,6]);
  assert.ok(got.findings.every(x=>x.file==="bad.yml"));
});
test("PER-1557: nested action path requires SHA, not tag",()=>{
  const value="github/codeql-action/upload-sarif@24c54180a607b1449ed407dd24f251e4e9147c8d";
  assert.deepEqual(inspectWorkflowPins("nested.yaml","      uses: "+value).findings,[]);
  assert.equal(inspectWorkflowPins("nested.yaml","      uses: github/codeql-action/upload-sarif@v4").findings.length,1);
});
test("PER-1557: shell text, plain comments and non-workflow output cannot grant an exception",()=>{
  const good="# uses: actions/checkout@v4\n"+"  run: echo 'uses: actions/checkout@v4'\n";
  assert.equal(inspectWorkflowPins("comment.yml",good).total,0);
  assert.equal(inspectWorkflowPins("quoted.yml","    uses: 'actions/setup-node@v7'").findings.length,1);
  assert.equal(inspectWorkflowPins("empty.yml","    uses:").findings.length,1);
});


import {readFileSync} from "node:fs";
import {inspectCheckoutCredentials,inspectAgentStandardsBoundary,inspectSeoOriginBoundary} from "./verify-github-actions-pins.mjs";
const agentFixture=readFileSync(new URL("../.github/workflows/agent-standards-sync.yml",import.meta.url),"utf8");
const seoFixture=readFileSync(new URL("../.github/workflows/seo-verify.yml",import.meta.url),"utf8");
test("PER-1557: checkout must not retain even read-only git credentials",()=>{
  const checkout="actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5";
  const good="steps:\n  - uses: "+checkout+"\n    with:\n      persist-credentials: false\n  - run: pnpm install";
  const bad=good.replace("persist-credentials: false","persist-credentials: true");
  assert.deepEqual(inspectCheckoutCredentials("safe.yml",good),[]);
  assert.equal(inspectCheckoutCredentials("leaky.yml",bad)[0].action,"checkout_persisted_credentials");
  assert.equal(inspectCheckoutCredentials("missing.yml","steps:\n  - uses: "+checkout).length,1);
});
test("PER-1557: agent preview cannot receive bot credentials and apply is manually protected",()=>{
  assert.deepEqual(inspectAgentStandardsBoundary(agentFixture),[]);
  const replacements=[
    ["token: \${{ github.token }}","token: \${{ secrets.LATTIX_BOT_PAT }}"],
    ["permissions:\n  contents: read","permissions:\n  contents: write"],
    ["github.ref == 'refs/heads/main'","github.ref != 'refs/heads/main'"],
    ["github.repository == 'LATTIX-IO/savant'","github.repository == 'other/repository'"],
    ["vars.SAVANT_AGENT_STANDARDS_SYNC_ENABLED == 'true'","vars.SAVANT_AGENT_STANDARDS_SYNC_ENABLED == 'false'"],
    ["environment: savant-release","environment: unreviewed"],
    ["default: 'false'","default: 'true'"],
  ];
  for(const [before,after] of replacements){
    assert.ok(agentFixture.includes(before),"Fixture missing "+before);
    assert.ok(inspectAgentStandardsBoundary(agentFixture.replace(before,after)).length>0,before);
  }
  assert.ok(inspectAgentStandardsBoundary(agentFixture.replace("  workflow_dispatch:","  push:\n    branches:\n      - main\n  workflow_dispatch:")).length>0);
});
test("PER-1557: caller-provided SEO origin cannot be interpolated into shell code",()=>{
  assert.deepEqual(inspectSeoOriginBoundary(seoFixture),[]);
  const bad=seoFixture.replace(
    'run: node ./scripts/seo/verify-live.mjs --origin "$SEO_VERIFY_ORIGIN"',
    'run: node ./scripts/seo/verify-live.mjs --origin "\${{ inputs.origin }}"');
  assert.equal(inspectSeoOriginBoundary(bad)[0].action,"seo_dispatch_shell_injection");
});
