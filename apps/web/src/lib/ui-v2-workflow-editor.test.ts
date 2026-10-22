import test from "node:test";
import assert from "node:assert/strict";
import type { WorkflowSpecification } from "@savant/types/workflow-specification";
import { parseWorkflowSpecification } from "@savant/schemas/workflow-specification";
import {
 addWorkflowConnection,addWorkflowPort,editWorkflowPortType,
 removeWorkflowNode,removeWorkflowPort,workflowConnectionWouldCycle,incompatibleWorkflowConnection,
} from "./ui-v2-workflow-editor.ts";

function seed():WorkflowSpecification {
 return {schemaVersion:1,workflowId:"triage",version:"1.0.0",source:{runtime:"external"},
 nodes:[
  {id:"a",kind:"skill",outputs:[{id:"out",dataType:"incident"}]},
  {id:"b",kind:"tool",inputs:[{id:"in",dataType:"incident"}],outputs:[{id:"out",dataType:"incident"}]},
  {id:"c",kind:"model",inputs:[{id:"in",dataType:"incident"}]},
 ],edges:[]};
}
function valid(result:ReturnType<typeof addWorkflowConnection>):WorkflowSpecification{
 if(!result.ok)assert.fail("Graph operation rejected: "+result.reason);
 return parseWorkflowSpecification(result.document);
}
test("typed compatible connections serialize and graph cycles fail before persisting",()=>{
 let spec=seed();
 spec=valid(addWorkflowConnection(spec,"a","out","b","in"));
 spec=valid(addWorkflowConnection(spec,"b","out","c","in"));
 assert.equal(spec.edges.length,2);
 assert.equal(workflowConnectionWouldCycle(spec,"c","a"),true);
 assert.equal(addWorkflowConnection(spec,"a","out","b","in").ok,false);
 assert.equal(addWorkflowConnection(spec,"c","in","a","out").ok,false);
});
test("port type mismatches, missing IDs and self-connections fail without mutation",()=>{
 const spec=seed();
 for(const [from,fp,to,tp] of [
  ["a","out","z","in"],["a","bad","b","in"],["b","in","c","in"],
  ["a","out","a","out"],
 ] as const){
  const result=addWorkflowConnection(spec,from,fp,to,tp);
  assert.equal(result.ok,false);
  assert.deepEqual(spec,seed());
 }
 const altered=editWorkflowPortType(spec,"b","inputs","in","other");
 assert.equal(altered.ok,true);
 if(altered.ok)assert.equal(addWorkflowConnection(altered.document,"a","out","b","in").ok,false);
});
test("ports remain schema-valid and removing a referenced port drops its edge",()=>{
 let spec=valid(addWorkflowConnection(seed(),"a","out","b","in"));
 const added=addWorkflowPort(spec,"b","inputs");
 assert.equal(added.ok,true);
 if(!added.ok)return;
 spec=parseWorkflowSpecification(added.document);
 assert.equal(spec.nodes[1]?.inputs?.length,2);
 const result=removeWorkflowPort(spec,"b","inputs","in");
 assert.equal(result.ok,true);
 if(!result.ok)return;
 spec=parseWorkflowSpecification(result.document);
 assert.equal(spec.edges.length,0);
 assert.equal(spec.nodes[1]?.inputs?.length,1);
 assert.equal(removeWorkflowPort(spec,"b","inputs","missing").ok,false);
});
test("deleting node removes dependent edges and preserves unrelated graph",()=>{
 let spec=valid(addWorkflowConnection(seed(),"a","out","b","in"));
 spec=valid(addWorkflowConnection(spec,"b","out","c","in"));
 spec=removeWorkflowNode(spec,"b");
 parseWorkflowSpecification(spec);
 assert.deepEqual(spec.nodes.map(n=>n.id),["a","c"]);
 assert.equal(spec.edges.length,0);
});

test("JSON-edited incompatible port types fail the same gate as UI connections",()=>{
 const spec=valid(addWorkflowConnection(seed(),"a","out","b","in"));
 assert.equal(incompatibleWorkflowConnection(spec),null);
 const changed=editWorkflowPortType(spec,"b","inputs","in","unrelated");
 assert.equal(changed.ok,true);
 if(changed.ok)assert.equal(incompatibleWorkflowConnection(changed.document),spec.edges[0]?.id);
});
test("human port editing may temporarily clear a type, but schema rejects unsaved empties",()=>{
 const altered=editWorkflowPortType(seed(),"b","inputs","in","");
 assert.equal(altered.ok,true);
 if(altered.ok)assert.throws(()=>parseWorkflowSpecification(altered.document));
});
