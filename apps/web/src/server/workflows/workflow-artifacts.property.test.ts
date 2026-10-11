import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { canonicalizeWorkflowSpecification, digestWorkflowSpecification, parseWorkflowSpecification, WorkflowSpecError } from "@savant/schemas/workflow-specification";

function seedRng(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}
function graph(size: number, seed: number) {
  const rnd = seedRng(seed);
  return {
    schemaVersion: 1, workflowId: "generated", version: "1.0.0",
    source: { runtime: "imported-harness" },
    nodes: Array.from({ length: size }, (_, i) => ({
      id: "n" + i, kind: i % 4 ? "tool" : "opaque",
      ...(i % 4 ? {} : {native: {kind:"vendor.custom", payload:{ threshold:rnd(), raw:[null,true,{ nested:"retain" }]}}}),
      ...(i ? { inputs: [{id: "in", dataType: "application/json"}] } : {}),
      ...(i + 1 < size ? { outputs: [{id: "out", dataType: "application/json"}] } : {}),
    })),
    edges: Array.from({length:Math.max(0,size-1)},(_,i)=>({
      id:"edge"+i,from:{nodeId:"n"+i,portId:"out"},to:{nodeId:"n"+(i+1),portId:"in"},
    })),
    extensions: { trust: "untrusted", source: { recorded: true } },
  };
}
test("PER-1087: deterministic generated graph corpus round-trips native metadata and canonical digest", async () => {
  for (let n = 1; n <= 80; n++) {
    const seed = n * 31337;
    const payload = graph(n,seed);
    const parsed = parseWorkflowSpecification(payload);
    const canonical = canonicalizeWorkflowSpecification(parsed);
    assert.deepEqual(parseWorkflowSpecification(JSON.parse(canonical)), parsed);
    assert.equal(await digestWorkflowSpecification(parsed), await digestWorkflowSpecification(parseWorkflowSpecification(JSON.parse(canonical))));
  }
});
test("PER-1087: randomized malformed references, duplicates and cycles fail closed", () => {
  for (let n = 2; n <= 65; n++) {
    const original = graph(n,n);
    const broken = JSON.parse(JSON.stringify(original));
    broken.edges[0].to.nodeId = "unknown-"+n;
    assert.throws(() => parseWorkflowSpecification(broken),(e:unknown)=>e instanceof WorkflowSpecError && e.code==="missing-node");
    const duplicate = JSON.parse(JSON.stringify(original));
    duplicate.nodes[1].id = duplicate.nodes[0].id;
    assert.throws(() => parseWorkflowSpecification(duplicate),(e:unknown)=>e instanceof WorkflowSpecError && e.code==="duplicate-node");
    const cyclic = JSON.parse(JSON.stringify(original));
    cyclic.nodes[n-1].outputs = [{id:"back",dataType:"application/json"}];
    cyclic.nodes[0].inputs = [{id:"back",dataType:"application/json"}];
    cyclic.edges.push({id:"back",from:{nodeId:"n"+(n-1),portId:"back"},to:{nodeId:"n0",portId:"back"}});
    assert.throws(() => parseWorkflowSpecification(cyclic),(e:unknown)=>e instanceof WorkflowSpecError && e.code==="cycle");
  }
});
test("PER-1087: bounded graph validation benchmark prints measured p95; enforces generous regression budget", () => {
  const payload = graph(350, 1234);
  const observed: number[] = [];
  for (let iteration=0; iteration<32; iteration++){
    const t0=performance.now();
    parseWorkflowSpecification(payload);
    observed.push(performance.now()-t0);
  }
  observed.sort((a,b)=>a-b);
  const p95=observed[Math.ceil(0.95*observed.length)-1]!;
  console.log(JSON.stringify({metric:"workflow_graph_validation",nodes:350,edges:349,p95Ms:Number(p95.toFixed(3)),samples:observed.length}));
  assert.ok(p95 < 2000, "Validation must remain bounded; 2s is a generous CI regression ceiling, not an SLO");
});
