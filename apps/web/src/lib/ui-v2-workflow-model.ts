/** PER-1609: UI-only workflow identity and persistence gates. Server remains authoritative. */
const WORKFLOW_ID=/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;
export function workflowIdValid(id:string):boolean{
  return WORKFLOW_ID.test(id)&&id!=="."&&id!==".."&&!id.includes("..");
}
export function workflowDocumentPath(id:string):string{
  if(!workflowIdValid(id))throw new Error("Invalid workflow identifier.");
  return `/api/workflows/${encodeURIComponent(id)}`;
}
export type WorkflowSaveGate={
  allowed:boolean;
  reason:string;
};
export function workflowSaveGate(state:{
  hasRecord:boolean;
  canCreate:boolean;
  valid:boolean;
  dirty:boolean;
  repositorySupported:boolean|undefined;
}):WorkflowSaveGate{
  if(!state.repositorySupported)return {allowed:false,reason:"Select an authorized GitHub repository."};
  if(!state.hasRecord&&!state.canCreate)return {allowed:false,reason:"Open the Git artifact or verify that a new workflow does not exist."};
  if(!state.valid)return {allowed:false,reason:"Fix graph/JSON validation errors before saving."};
  if(!state.dirty)return {allowed:false,reason:"No unsaved workflow changes."};
  return {allowed:true,reason:"Git compares the expected file revision before a write."};
}

/** Read-only deterministic DAG placement. It is a view of explicit edges, not execution evidence. */
export function layoutWorkflowGraph(input:{
  nodes:readonly {id:string}[];
  edges:readonly {id:string;from:{nodeId:string};to:{nodeId:string}}[];
}, maxVisible=200):{
  width:number;height:number;truncated:boolean;
  nodes:{id:string;x:number;y:number}[];
  edges:{id:string;path:string}[];
}{
  const nodes=input.nodes.slice(0,maxVisible);
  const ids=new Set(nodes.map(n=>n.id));
  const indegree=new Map(nodes.map(n=>[n.id,0]));
  const successors=new Map(nodes.map(n=>[n.id,[] as string[]]));
  for(const edge of input.edges){
    if(ids.has(edge.from.nodeId)&&ids.has(edge.to.nodeId)){
      indegree.set(edge.to.nodeId,(indegree.get(edge.to.nodeId)??0)+1);
      successors.get(edge.from.nodeId)?.push(edge.to.nodeId);
    }
  }
  const layer=new Map<string,number>();
  const ready=nodes.filter(n=>indegree.get(n.id)===0).map(n=>n.id);
  while(ready.length){
    const id=ready.shift()!;
    const at=layer.get(id)??0;
    for(const next of successors.get(id)??[]){
      layer.set(next,Math.max(layer.get(next)??0,at+1));
      indegree.set(next,(indegree.get(next)??0)-1);
      if(indegree.get(next)===0)ready.push(next);
    }
  }
  // A cycle is invalid at the schema layer. Still render every node safely
  // so the operator can locate and repair it.
  for(const node of nodes)if(!layer.has(node.id))layer.set(node.id,0);
  const rows=new Map<number,number>();
  const positions=nodes.map(node=>{
    const column=layer.get(node.id)??0;
    const row=rows.get(column)??0;
    rows.set(column,row+1);
    return {id:node.id,x:24+column*236,y:24+row*116};
  });
  const position=new Map(positions.map(p=>[p.id,p]));
  const paths=input.edges.flatMap(edge=>{
    const from=position.get(edge.from.nodeId),to=position.get(edge.to.nodeId);
    if(!from||!to)return [];
    const x1=from.x+196,y1=from.y+39,x2=to.x,y2=to.y+39;
    const bend=Math.max(40,Math.abs(x2-x1)/2);
    return [{id:edge.id,path:`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`}];
  });
  return {
    width:Math.max(300,Math.max(...positions.map(p=>p.x),0)+230),
    height:Math.max(210,Math.max(...positions.map(p=>p.y),0)+110),
    truncated:input.nodes.length>nodes.length,
    nodes:positions,edges:paths,
  };
}
