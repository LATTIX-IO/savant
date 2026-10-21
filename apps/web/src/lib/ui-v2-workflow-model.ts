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
