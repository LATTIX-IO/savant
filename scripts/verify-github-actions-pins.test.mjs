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
