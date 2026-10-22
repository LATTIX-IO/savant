import type { WorkflowEdge, WorkflowNode, WorkflowSpecification } from "@savant/types/workflow-specification";

/** Deterministic edit operations. No effects, model inference, execution or browser storage. */
export type WorkflowEditResult =
  | { ok:true; document:WorkflowSpecification }
  | { ok:false; reason:string };

function nextUnique(prefix:string, values:readonly {id:string}[], limit:number):string|null{
  const used=new Set(values.map(v=>v.id));
  for(let i=1;i<=limit;i++)if(!used.has(`${prefix}-${i}`))return `${prefix}-${i}`;
  return null;
}
export function addWorkflowPort(
  spec:WorkflowSpecification,nodeId:string,direction:"inputs"|"outputs",
):WorkflowEditResult{
  const node=spec.nodes.find(n=>n.id===nodeId);
  if(!node)return {ok:false,reason:"Selected node no longer exists."};
  const ports=node[direction]??[];
  if(ports.length>=100)return {ok:false,reason:"At most 100 ports per direction are supported."};
  const id=nextUnique(direction==="inputs"?"input":"output",ports,200);
  if(!id)return {ok:false,reason:"No unique port identifier available."};
  return {ok:true,document:{...spec,nodes:spec.nodes.map(n=>n.id===nodeId
    ?{...n,[direction]:[...ports,{id,dataType:"any"}]}:n)}};
}
export function editWorkflowPortType(
  spec:WorkflowSpecification,nodeId:string,direction:"inputs"|"outputs",portId:string,value:string,
):WorkflowEditResult{
  if(value.length>128)return {ok:false,reason:"Port types cannot exceed 128 characters."};
  const node=spec.nodes.find(n=>n.id===nodeId);
  if(!node||!node[direction]?.some(p=>p.id===portId))
    return {ok:false,reason:"Port not found."};
  return {ok:true,document:{...spec,nodes:spec.nodes.map(n=>n.id===nodeId
    ?{...n,[direction]:n[direction]?.map(p=>p.id===portId?{...p,dataType:value}:p)}:n)}};
}
export function removeWorkflowPort(
  spec:WorkflowSpecification,nodeId:string,direction:"inputs"|"outputs",portId:string,
):WorkflowEditResult{
  const node=spec.nodes.find(n=>n.id===nodeId);
  if(!node||!node[direction]?.some(p=>p.id===portId))
    return {ok:false,reason:"Port not found."};
  const nodes=spec.nodes.map(n=>n.id===nodeId
    ?{...n,[direction]:n[direction]?.filter(p=>p.id!==portId)}:n);
  const edges=spec.edges.filter(edge=>direction==="inputs"
    ?!(edge.to.nodeId===nodeId&&edge.to.portId===portId)
    :!(edge.from.nodeId===nodeId&&edge.from.portId===portId));
  return {ok:true,document:{...spec,nodes,edges}};
}
export function workflowConnectionWouldCycle(
  spec:WorkflowSpecification,fromNode:string,toNode:string,
):boolean{
  if(fromNode===toNode)return true;
  const seen=new Set<string>();
  const stack=[toNode];
  while(stack.length){
    const id=stack.pop()!;
    if(id===fromNode)return true;
    if(seen.has(id))continue;
    seen.add(id);
    if(seen.size>1000)return true;
    for(const edge of spec.edges)if(edge.from.nodeId===id)stack.push(edge.to.nodeId);
  }
  return false;
}
export function addWorkflowConnection(
  spec:WorkflowSpecification,fromNode:string,fromPort:string,toNode:string,toPort:string,
):WorkflowEditResult{
  const source=spec.nodes.find(n=>n.id===fromNode);
  const target=spec.nodes.find(n=>n.id===toNode);
  const output=source?.outputs?.find(p=>p.id===fromPort);
  const input=target?.inputs?.find(p=>p.id===toPort);
  if(!output||!input)return {ok:false,reason:"Choose existing input and output ports."};
  if(output.dataType!=="any"&&input.dataType!=="any"&&output.dataType!==input.dataType)
    return {ok:false,reason:"The selected ports have incompatible data types."};
  if(spec.edges.some(edge=>edge.from.nodeId===fromNode&&edge.from.portId===fromPort
    &&edge.to.nodeId===toNode&&edge.to.portId===toPort))
    return {ok:false,reason:"This connection already exists."};
  if(workflowConnectionWouldCycle(spec,fromNode,toNode))
    return {ok:false,reason:"This edge would create a cycle. WorkflowSpecification v1 requires a DAG."};
  if(spec.edges.length>=5000)return {ok:false,reason:"At most 5000 edges are supported."};
  const id=nextUnique("edge",spec.edges,10000);
  if(!id)return {ok:false,reason:"No unique edge identifier available."};
  const next:WorkflowEdge={id,
    from:{nodeId:fromNode,portId:fromPort},to:{nodeId:toNode,portId:toPort}};
  return {ok:true,document:{...spec,edges:[...spec.edges,next]}};
}
export function removeWorkflowNode(spec:WorkflowSpecification,nodeId:string):WorkflowSpecification {
  return {...spec,nodes:spec.nodes.filter((n:WorkflowNode)=>n.id!==nodeId),
    edges:spec.edges.filter(e=>e.from.nodeId!==nodeId&&e.to.nodeId!==nodeId)};
}

/** A typed data-flow mismatch cannot be promoted even through JSON source edits. */
export function incompatibleWorkflowConnection(spec:WorkflowSpecification):string|null{
  const nodes=new Map(spec.nodes.map(node=>[node.id,node]));
  for(const edge of spec.edges){
    const source=nodes.get(edge.from.nodeId)?.outputs?.find(p=>p.id===edge.from.portId);
    const target=nodes.get(edge.to.nodeId)?.inputs?.find(p=>p.id===edge.to.portId);
    if(!source||!target)return edge.id;
    if(source.dataType!=="any"&&target.dataType!=="any"&&source.dataType!==target.dataType)
      return edge.id;
  }
  return null;
}
