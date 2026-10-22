"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RepositoryListItem } from "@savant/types";
import type { WorkflowSpecification, WorkflowNodeKind } from "@savant/types/workflow-specification";
import { parseWorkflowSpecification } from "@savant/schemas/workflow-specification";
import { fetchRepositoryList } from "@/lib/control-plane-client";
import { buildTenantAwareAppPath, withWorkspaceSlugQuery } from "@/lib/tenant-paths";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { workflowDocumentPath, workflowIdValid, workflowSaveGate, layoutWorkflowGraph } from "@/lib/ui-v2-workflow-model";
import { addWorkflowConnection, addWorkflowPort, editWorkflowPortType,
  removeWorkflowNode, removeWorkflowPort, incompatibleWorkflowConnection } from "@/lib/ui-v2-workflow-editor";
import styles from "./workflow-studio-v2.module.css";

type WorkflowRecord = {
  sourceOfTruth: "git"; repositoryId: string; workflowId: string;
  specification: WorkflowSpecification; blobSha: string; commitSha: string; digest: string;
  indexed?: boolean; reconciliationRequired?: boolean;
};
type Inventory = { scope: string; phase: "loading"|"ready"|"error"; data: RepositoryListItem[]; message: string };
type Loaded = { key: string; phase: "idle"|"loading"|"ready"|"missing"|"error"; record: WorkflowRecord|null; message: string };
type EditMode = "graph"|"json";
type IndexedWorkflow = {workflowId:string;version:string;sourceCommitSha:string;indexedAt:string};
type IndexLoad = {key:string;phase:"idle"|"loading"|"ready"|"error";items:IndexedWorkflow[];message:string};
const NO_INDEX:IndexLoad={key:"",phase:"idle",items:[],message:""};
const EMPTY: Inventory = {scope:"",phase:"loading",data:[],message:""};
const NONE: Loaded = {key:"",phase:"idle",record:null,message:""};
const KINDS: readonly WorkflowNodeKind[]=["agent","skill","tool","model","decision","subworkflow","opaque"];

function initialSpec(id:string):WorkflowSpecification {
  return {schemaVersion:1,workflowId:id,version:"0.1.0",
    source:{runtime:"not-specified"},nodes:[],edges:[]};
}
function errorMessage(payload: unknown, fallback: string): string {
  if(payload&&typeof payload==="object"&&"error" in payload){
    const error=(payload as {error?:{code?:unknown}}).error;
    if(typeof error?.code==="string") return error.code.replaceAll("_"," ");
  }
  return fallback;
}
async function requestWorkflow(method:"GET"|"PUT",slug:string,repo:string,id:string,body?:unknown,signal?:AbortSignal):Promise<WorkflowRecord>{
  const url=withWorkspaceSlugQuery(workflowDocumentPath(id),slug);
  const target=method==="GET" ? url+`&repositoryId=${encodeURIComponent(repo)}` : url;
  const response=await fetch(target,{method,credentials:"same-origin",cache:"no-store",
    ...(body===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)}),
    ...(signal?{signal}:{}),
  });
  const payload:unknown=await response.json().catch(()=>null);
  if(!response.ok){
    const error=new Error(errorMessage(payload,`Workflow request failed (${response.status}).`));
    (error as Error&{status:number}).status=response.status;
    throw error;
  }
  if(!payload||typeof payload!=="object"||!("data" in payload)) throw new Error("Invalid workflow response.");
  return (payload as {data:WorkflowRecord}).data;
}
function nextId(prefix:string,existing:readonly {id:string}[]):string{
  const used=new Set(existing.map(x=>x.id));
  for(let i=1;i<=1000;i++)if(!used.has(`${prefix}-${i}`))return `${prefix}-${i}`;
  throw new Error("No available node or edge identifier.");
}
export function WorkflowStudioV2(){
  const slug=useUiV2WorkspaceSlug()??"";
  const pathname=usePathname()||"/";
  const [inventory,setInventory]=useState<Inventory>(EMPTY);
  const [indexed,setIndexed]=useState<IndexLoad>(NO_INDEX);
  const [indexRetry,setIndexRetry]=useState(0);
  const readRef=useRef<AbortController|null>(null);
  const [repositoryId,setRepositoryId]=useState("");
  const [workflowId,setWorkflowId]=useState("");
  const [loaded,setLoaded]=useState<Loaded>(NONE);
  const [draft,setDraft]=useState<WorkflowSpecification|null>(null);
  const [baseline,setBaseline]=useState("");
  const [selectedId,setSelectedId]=useState("");
  const [mode,setMode]=useState<EditMode>("graph");
  const [text,setText]=useState("");
  const [jsonError,setJsonError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [fromId,setFromId]=useState("");
  const [fromPort,setFromPort]=useState("");
  const [toId,setToId]=useState("");
  const [toPort,setToPort]=useState("");
  const scopeKey=`${slug}:${repositoryId}:${workflowId}`;
  const active=loaded.key===scopeKey?loaded:NONE;
  const repo=inventory.scope===slug?inventory.data.find(r=>r.id===repositoryId):null;
  const source=draft?JSON.stringify(draft):"";
  const graph=useMemo(()=>draft?layoutWorkflowGraph(draft):null,[draft]);
  const listKey=`${slug}:${repositoryId}`;
  const visibleIndex=indexed.key===listKey?indexed:NO_INDEX;
  const dirty=draft!==null && (source!==baseline || Boolean(jsonError));
  const safeId=workflowIdValid(workflowId);
  const available=repo?.provider==="github";
  const validation=useMemo(()=>{
    if(!draft)return {valid:false,reason:"Open or create a workflow to edit."};
    if(jsonError)return {valid:false,reason:jsonError};
    try{
      parseWorkflowSpecification(draft);
      const mismatch=incompatibleWorkflowConnection(draft);
      if(mismatch)return {valid:false,reason:`Connection ${mismatch} has incompatible or missing ports.`};
      return {valid:true,reason:"DAG and typed data-flow ports valid."};
    }
    catch(e){return {valid:false,reason:e instanceof Error?e.message:"Invalid graph."};}
  },[draft,jsonError]);
  const gate=workflowSaveGate({hasRecord:active.phase==="ready",canCreate:active.phase==="missing",
    valid:validation.valid,dirty,repositorySupported:available});
  const selected=draft?.nodes.find(n=>n.id===selectedId)||null;
  const fromNode=draft?.nodes.find(n=>n.id===fromId)||null;
  const toNode=draft?.nodes.find(n=>n.id===toId)||null;
  const libraryHref=buildTenantAwareAppPath(pathname,"/skills") as Route;
  const workbenchHref=buildTenantAwareAppPath(pathname,"/workbench") as Route;

  useEffect(()=>{
    if(!slug)return;
    const controller=new AbortController();
    queueMicrotask(()=>setInventory({scope:slug,phase:"loading",data:[],message:""}));
    void fetchRepositoryList({workspaceSlug:slug,signal:controller.signal}).then(r=>{
      if(!controller.signal.aborted)setInventory({scope:slug,phase:"ready",data:r.data,message:""});
    }).catch(e=>{
      if(!controller.signal.aborted)setInventory({scope:slug,phase:"error",data:[],
        message:e instanceof Error?e.message:"Repository inventory unavailable."});
    });
    return ()=>controller.abort();
  },[slug]);

  useEffect(()=>{
    if(!slug||!repositoryId||!available)return;
    const controller=new AbortController();
    const key=`${slug}:${repositoryId}`;
    queueMicrotask(()=>{if(!controller.signal.aborted)setIndexed({key,phase:"loading",items:[],message:""});});
    const path=withWorkspaceSlugQuery("/api/workflows",slug)+`&repositoryId=${encodeURIComponent(repositoryId)}`;
    void fetch(path,{credentials:"same-origin",cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const payload:unknown=await response.json().catch(()=>null);
        if(!response.ok)throw new Error(errorMessage(payload,`Workflow index failed (${response.status}).`));
        if(!payload||typeof payload!=="object"||!("data" in payload)||!Array.isArray(payload.data))
          throw new Error("Workflow index response was invalid.");
        if(!controller.signal.aborted)setIndexed({key,phase:"ready",items:payload.data as IndexedWorkflow[],message:""});
      }).catch(error=>{if(!controller.signal.aborted)setIndexed({key,phase:"error",items:[],
        message:error instanceof Error?error.message:"Workflow index unavailable."});});
    return ()=>controller.abort();
  },[slug,repositoryId,available,indexRetry]);

  useEffect(()=>{
    // Never reuse another tenant, repository or workflow's mutable state.
    readRef.current?.abort();readRef.current=null;
    queueMicrotask(()=>{setBusy(false);setLoaded({...NONE,key:scopeKey});setDraft(null);setBaseline("");
      setSelectedId("");setMessage("");setJsonError("");setMode("graph");setText("");});
    return ()=>{readRef.current?.abort();};
  },[scopeKey]);

  useEffect(()=>{
    if(!dirty)return;
    const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    // Next.js client-side <Link> navigations do not raise beforeunload.
    const guardClientLink=(event:MouseEvent)=>{
      if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
      const target=event.target;
      if(!(target instanceof Element)||!target.closest("a[href]"))return;
      if(!window.confirm("Leave Workflow Studio and discard unsaved changes?")){
        event.preventDefault();event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload",guard);
    document.addEventListener("click",guardClientLink,true);
    return ()=>{
      window.removeEventListener("beforeunload",guard);
      document.removeEventListener("click",guardClientLink,true);
    };
  },[dirty]);

  function replaceDraft(value:WorkflowSpecification){
    setDraft(value);setText(JSON.stringify(value,null,2));setJsonError("");setMessage("");
  }
  async function open(){
    if(!slug||!repositoryId||!safeId||!available||busy||draft!==null)return;
    const key=scopeKey;
    const controller=new AbortController();
    readRef.current?.abort();readRef.current=controller;
    setBusy(true);setLoaded({key,phase:"loading",record:null,message:""});setMessage("");
    try{
      const record=await requestWorkflow("GET",slug,repositoryId,workflowId,undefined,controller.signal);
      if(controller.signal.aborted)return;
      const value=parseWorkflowSpecification(record.specification);
      setLoaded({key,phase:"ready",record,message:""});
      replaceDraft(value);setBaseline(JSON.stringify(value));setSelectedId("");
    }catch(e){
      if(controller.signal.aborted)return;
      const status=(e as {status?:number}).status;
      if(status===404){
        setLoaded({key,phase:"missing",record:null,message:"No readable workflow at this path. Creating requires an authorized write."});
      }else{
        setLoaded({key,phase:"error",record:null,message:e instanceof Error?e.message:"Could not open workflow."});
      }
      setDraft(null);setBaseline("");setSelectedId("");
    }finally{if(readRef.current===controller){readRef.current=null;setBusy(false);}}
  }
  function close(){
    if(dirty&&!window.confirm("Discard unsaved workflow edits?"))return;
    readRef.current?.abort();readRef.current=null;
    setDraft(null);setBaseline("");setLoaded({...NONE,key:scopeKey});
    setMessage("");setSelectedId("");setJsonError("");setText("");setMode("graph");
  }
  function create(){
    if(!available||!safeId||busy||!repositoryId||active.phase!=="missing")return;
    const value=initialSpec(workflowId);replaceDraft(value);setBaseline("");
  }
  function changeNode(id:string,values:Partial<WorkflowSpecification["nodes"][number]>){
    if(!draft)return;
    replaceDraft({...draft,nodes:draft.nodes.map(n=>n.id===id?{...n,...values}:n)});
  }
  function changeNodeKind(kind:WorkflowNodeKind){
    if(!draft||!selected)return;
    const nodes=draft.nodes.map(node=>{
      if(node.id!==selected.id)return node;
      if(kind==="opaque")return {...node,kind,native:node.native??{kind:"external"}};
      const value={...node};
      delete value.native;
      return {...value,kind};
    });
    replaceDraft({...draft,nodes});
  }
  function addNode(){
    if(!draft||draft.nodes.length>=1000)return;
    const id=nextId("step",draft.nodes);
    replaceDraft({...draft,nodes:[...draft.nodes,{id,kind:"skill",label:"New step",
      inputs:[{id:"in",dataType:"any"}],outputs:[{id:"out",dataType:"any"}]}]});
    setSelectedId(id);
  }
  function removeNode(){
    if(!draft||!selected)return;
    if(!window.confirm(`Remove ${selected.label||selected.id} and its connections?`))return;
    replaceDraft(removeWorkflowNode(draft,selected.id));
    setSelectedId("");
  }
  function modifyPort(direction:"inputs"|"outputs",portId:string,type:string){
    if(!draft||!selected)return;
    const result=editWorkflowPortType(draft,selected.id,direction,portId,type);
    if(result.ok)replaceDraft(result.document);else setMessage(result.reason);
  }
  function insertPort(direction:"inputs"|"outputs"){
    if(!draft||!selected)return;
    const result=addWorkflowPort(draft,selected.id,direction);
    if(result.ok)replaceDraft(result.document);else setMessage(result.reason);
  }
  function deletePort(direction:"inputs"|"outputs",portId:string){
    if(!draft||!selected)return;
    if(!window.confirm("Remove this port and all connections referencing it?"))return;
    const result=removeWorkflowPort(draft,selected.id,direction,portId);
    if(result.ok)replaceDraft(result.document);else setMessage(result.reason);
  }
  function addEdge(){
    if(!draft)return;
    const result=addWorkflowConnection(draft,fromId,fromPort,toId,toPort);
    if(result.ok)replaceDraft(result.document);else setMessage(result.reason);
  }
  async function save(){
    if(!slug||!repositoryId||!draft||!gate.allowed||busy||active.key!==scopeKey)return;
    let spec:WorkflowSpecification;
    try{spec=parseWorkflowSpecification(draft);}catch(e){
      setMessage(e instanceof Error?e.message:"Invalid graph.");return;
    }
    const directCommit=active.phase==="ready"?"update":"create";
    if(!window.confirm(`Commit this workflow directly to the selected Git repository (${directCommit})? Savant will not open a review proposal or execute the workflow.`))return;
    setBusy(true);setMessage("");
    try{
      const result=await requestWorkflow("PUT",slug,repositoryId,workflowId,{
        repositoryId,expectedBlobSha:active.phase==="ready"?active.record?.blobSha??null:null,
        specification:spec,
      });
      setLoaded({key:scopeKey,phase:"ready",record:result,message:""});
      replaceDraft(result.specification);
      setBaseline(JSON.stringify(result.specification));
      setIndexRetry(value=>value+1);
      setMessage(result.reconciliationRequired
        ?"Git saved the workflow, but its database index needs reconciliation."
        :`Saved to Git revision ${result.commitSha.slice(0,12)}. This does not run or publish the workflow.`);
    }catch(e){
      const status=(e as {status?:number}).status;
      setMessage(status===409
        ?"Revision conflict or provider restriction. Your draft is preserved. Reopen and reconcile before retrying."
        :e instanceof Error?e.message:"Save failed. Draft retained.");
    }finally{setBusy(false);}
  }
  function changeMode(){
    if(mode==="json" && jsonError){
      if(!window.confirm("Invalid JSON has not been applied to the graph. Discard those invalid edits?"))return;
      if(draft)setText(JSON.stringify(draft,null,2));
      setJsonError("");
    }
    setMode(value=>value==="graph"?"json":"graph");
  }
  function onJsonChange(value:string){
    setText(value);
    try{
      const next=parseWorkflowSpecification(JSON.parse(value) as unknown);
      if(next.workflowId!==workflowId)throw new Error("Workflow ID cannot be changed here.");
      setDraft(next);setJsonError("");
    }catch(e){setJsonError(e instanceof Error?e.message:"Invalid JSON.");}
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p><Link href={workbenchHref}>Workbench</Link> / Workflow Studio</p>
        <h1>Workflow Studio</h1>
        <p>Model versioned, non-executable workflow specifications backed by authorized Git repositories.</p></div>
      <div className={styles.actions}>
        <Link href={workbenchHref}>Browse skills</Link>
        <button type="button" onClick={changeMode} disabled={!draft}>
          {mode==="graph"?"JSON source":"Graph and inspector"}
        </button>
        <button type="button" onClick={()=>void save()} disabled={busy||!gate.allowed}>Commit to Git</button>
      </div>
    </header>
    <div className={styles.selector}>
      <label>Repository
        <select value={repositoryId} onChange={e=>setRepositoryId(e.target.value)} disabled={inventory.phase!=="ready"||busy||draft!==null}>
          <option value="">Select connected repository</option>
          {inventory.data.map(r=><option key={r.id} value={r.id}>{r.name} · {r.provider}</option>)}
        </select>
      </label>
      <label>Workflow ID
        <input value={workflowId} onChange={e=>setWorkflowId(e.target.value.trim().toLowerCase())}
          placeholder="incident-response" maxLength={80} disabled={busy||draft!==null} />
      </label>
      <button type="button" disabled={!safeId||!repositoryId||!available||busy||draft!==null} onClick={()=>void open()}>
        Open from Git
      </button>
      {active.phase==="missing"&&draft===null&&<button type="button" disabled={busy} onClick={create}>Create draft</button>}
      {draft&&<button type="button" disabled={busy} onClick={close}>Close workflow</button>}
    </div>
    {repo&&available&&<div className={styles.selector}>
      <label>Indexed workflows (discovery, not verified Git source)
        <select value={visibleIndex.items.some(item=>item.workflowId===workflowId)?workflowId:""}
          onChange={e=>setWorkflowId(e.target.value)} disabled={busy||draft!==null||visibleIndex.phase!=="ready"}>
          <option value="">Choose indexed workflow</option>
          {visibleIndex.items.map(item=><option key={item.workflowId} value={item.workflowId}>
            {item.workflowId} · {item.version}
          </option>)}
        </select>
      </label>
      {visibleIndex.phase==="error"?<p role="alert" className={styles.error}>{visibleIndex.message}</p>:
        visibleIndex.phase==="loading"?<p>Loading authorized index…</p>:
        visibleIndex.phase==="ready"&&visibleIndex.items.length===0?
          <p className={styles.help}>This Git repository has no indexed workflow specifications. Indexed skills and workflows are different artifacts. To create a workflow, enter a new safe Workflow ID above, click “Open from Git” to check for an existing version, then choose “Create draft” if it is absent. Nothing executes or commits until you explicitly save.</p>:
          <p className={styles.help}>Open an indexed artifact to verify the current Git contents. This list is not execution evidence.</p>}
      <button type="button" onClick={()=>setIndexRetry(value=>value+1)} disabled={busy||!available}>Refresh index</button>
    </div>}
    {inventory.phase==="error"&&<p role="alert" className={styles.error}>{inventory.message}</p>}
    {repo&&!available&&<p role="status" className={styles.warning}>Workflow Git writes currently support GitHub only; {repo.provider} is unsupported.</p>}
    {!safeId&&workflowId&&<p className={styles.warning}>Use a lowercase workflow ID of 1–80 safe characters, without traversal or path separators.</p>}
    {active.message&&<p role="status" className={styles.warning}>{active.message}</p>}
    {message&&<p role="status" className={styles.notice}>{message}</p>}
    {draft&&<div className={styles.meta}>
      <span>Source: Git · workflows/{workflowId}.json</span>
      <span>Commit: {active.record?.commitSha?.slice(0,12)||"Unsaved"}</span>
      <span>Nodes {draft.nodes.length} · edges {draft.edges.length}</span>
      <span>{dirty?"Unsaved edits":"Current revision"}</span>
      <span className={validation.valid?styles.valid:styles.error}>{validation.reason}</span>
    </div>}
    {draft&&mode==="json"
      ?<section className={styles.source} aria-label="Workflow JSON source">
        <label htmlFor="workflow-json">WorkflowSpecification v1 JSON — validated before save</label>
        <textarea id="workflow-json" spellCheck={false} value={text} onChange={e=>onJsonChange(e.target.value)}/>
      </section>
      :draft?<div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Workflow steps">
          <div className={styles.sectionTitle}><strong>Steps</strong><button type="button" onClick={addNode} disabled={busy}>Add step</button></div>
          {draft.nodes.length===0?<p>No steps yet. Add a step to start modeling.</p>:draft.nodes.map(node=>
            <button key={node.id} type="button" className={selectedId===node.id?styles.selected:styles.step}
              onClick={()=>setSelectedId(node.id)} aria-pressed={selectedId===node.id}>
              <small>{node.kind}</small><strong>{node.label||node.id}</strong><span>{node.id}</span>
            </button>)}
        </aside>
        <section className={styles.graph} aria-label="Workflow dependency graph">
          <h2>Directed flow</h2>
          <p className={styles.help}>Select a step to edit it. Connections are persisted as typed DAG edges; loops are rejected.</p>
          {graph&&<div className={styles.flowPlane} style={{width:graph.width,height:graph.height}}>
            <svg className={styles.wires} width={graph.width} height={graph.height} aria-hidden="true">
              <defs><marker id="sv2-workflow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="currentColor"/></marker></defs>
              {graph.edges.map(edge=><path key={edge.id} d={edge.path} fill="none"
                stroke="currentColor" strokeWidth={1.5} markerEnd="url(#sv2-workflow-arrow)"/>) }
            </svg>
            {graph.nodes.map(point=>{
              const node=draft.nodes.find(candidate=>candidate.id===point.id);
              if(!node)return null;
              return <button key={node.id} type="button" onClick={()=>setSelectedId(node.id)}
                style={{left:point.x,top:point.y}}
                className={selectedId===node.id?styles.nodeSelected:styles.node}
                aria-pressed={selectedId===node.id}>
                <small>{node.kind}</small><strong>{node.label||node.id}</strong><span>{node.id}</span>
              </button>;
            })}
          </div>}
          {graph?.truncated&&<p className={styles.warning}>Diagram shows the first 200 nodes. The validated JSON source retains the entire graph.</p>}
          {draft.nodes.length===0&&<p>No workflow nodes have been modeled yet. Add a step to begin.</p>}
          <h3>Connections</h3>
          <ul className={styles.edges}>{draft.edges.map(edge=><li key={edge.id}>
            <span>{edge.from.nodeId}.{edge.from.portId} → {edge.to.nodeId}.{edge.to.portId}</span>
            <button type="button" aria-label={`Remove connection ${edge.id}`} onClick={()=>
              replaceDraft({...draft,edges:draft.edges.filter(e=>e.id!==edge.id)})}>Remove</button>
          </li>)}</ul>
          <div className={styles.connect}>
            <label>From<select value={fromId} onChange={e=>{setFromId(e.target.value);setFromPort("");}}><option value="">Step</option>
              {draft.nodes.map(n=><option key={n.id} value={n.id}>{n.label||n.id}</option>)}</select></label>
            <label>From output<select value={fromPort} onChange={e=>setFromPort(e.target.value)}>
              <option value="">Port</option>
              {(fromNode?.outputs??[]).map(p=><option key={p.id} value={p.id}>{p.id} · {p.dataType}</option>)}
            </select></label>
            <label>To<select value={toId} onChange={e=>{setToId(e.target.value);setToPort("");}}><option value="">Step</option>
              {draft.nodes.map(n=><option key={n.id} value={n.id}>{n.label||n.id}</option>)}</select></label>
            <label>To input<select value={toPort} onChange={e=>setToPort(e.target.value)}>
              <option value="">Port</option>
              {(toNode?.inputs??[]).map(p=><option key={p.id} value={p.id}>{p.id} · {p.dataType}</option>)}
            </select></label>
            <button type="button" onClick={addEdge} disabled={!fromId||!fromPort||!toId||!toPort||busy}>Connect steps</button>
          </div>
        </section>
        <aside className={styles.inspector} aria-label="Step inspector">
          <h2>Inspector</h2>
          {selected?<div className={styles.fields}>
            <label>Step ID<input value={selected.id} readOnly title="Stable immutable node identity"/></label>
            <label>Title<input value={selected.label??""} maxLength={2048}
              onChange={e=>changeNode(selected.id,{label:e.target.value})}/></label>
            <label>Kind<select value={selected.kind} onChange={e=>changeNodeKind(e.target.value as WorkflowNodeKind)}>{KINDS.map(k=><option key={k} value={k}>{k}</option>)}</select></label>
            <h3>Typed input ports</h3>
            {(selected.inputs??[]).map(p=><div key={p.id} className={styles.portRow}>
              <code>{p.id}</code>
              <label>Data type<input aria-label={`Type for input ${p.id}`}
                value={p.dataType} onChange={e=>modifyPort("inputs",p.id,e.target.value)}/></label>
              <button type="button" onClick={()=>deletePort("inputs",p.id)}>Remove</button>
            </div>)}
            <button type="button" onClick={()=>insertPort("inputs")} disabled={(selected.inputs?.length??0)>=100}>Add input</button>
            <h3>Typed output ports</h3>
            {(selected.outputs??[]).map(p=><div key={p.id} className={styles.portRow}>
              <code>{p.id}</code>
              <label>Data type<input aria-label={`Type for output ${p.id}`}
                value={p.dataType} onChange={e=>modifyPort("outputs",p.id,e.target.value)}/></label>
              <button type="button" onClick={()=>deletePort("outputs",p.id)}>Remove</button>
            </div>)}
            <button type="button" onClick={()=>insertPort("outputs")} disabled={(selected.outputs?.length??0)>=100}>Add output</button>
            <p>Opaque provider-native extensions and edge conditions can be edited as JSON. Savant never executes them.</p>
            <button type="button" onClick={removeNode} disabled={busy}>Remove step and connections</button>
          </div>:<p>Select a graph step to edit its metadata.</p>}
          <h3>Version</h3>
          <div className={styles.fields}>
            <label>Version<input value={draft.version} maxLength={80}
              onChange={e=>replaceDraft({...draft,version:e.target.value})}/></label>
            <label>Origin runtime<input value={draft.source.runtime} maxLength={128}
              onChange={e=>replaceDraft({...draft,source:{...draft.source,runtime:e.target.value}})}/></label>
          </div>
        </aside>
      </div>:<div className={styles.empty} role="status">
        <strong>{!repositoryId?"Start by selecting a connected GitHub repository.":!workflowId?
          "Choose an existing workflow or name a new one.":"Open the versioned Git document to inspect or start a draft."}</strong>
        <p>Skill indexing does not automatically create workflow specifications. Workflows are
          governed Git documents with typed steps. New graphs begin empty and become
          editable after the repository has been checked for an existing version.</p>
        <Link href={workbenchHref}>Choose an indexed skill in Workbench</Link>
      </div>}
    {draft&&<footer className={styles.footer}>
      <span>{gate.allowed?"Ready to save":"Save unavailable"} · {gate.reason}</span>
      <span>Modeling only · no workflow execution, scheduling, or inferred tool traces</span>
    </footer>}
  </div>;
}
