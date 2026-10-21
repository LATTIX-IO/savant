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
  const [toId,setToId]=useState("");
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
    try{parseWorkflowSpecification(draft);return {valid:true,reason:"DAG schema valid."};}
    catch(e){return {valid:false,reason:e instanceof Error?e.message:"Invalid graph."};}
  },[draft,jsonError]);
  const gate=workflowSaveGate({hasRecord:active.phase==="ready",canCreate:active.phase==="missing",
    valid:validation.valid,dirty,repositorySupported:available});
  const selected=draft?.nodes.find(n=>n.id===selectedId)||null;
  const libraryHref=buildTenantAwareAppPath(pathname,"/skills") as Route;

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
  },[scopeKey]);

  useEffect(()=>{
    if(!dirty)return;
    const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",guard);
    return ()=>window.removeEventListener("beforeunload",guard);
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
  function addNode(){
    if(!draft||draft.nodes.length>=1000)return;
    const id=nextId("step",draft.nodes);
    replaceDraft({...draft,nodes:[...draft.nodes,{id,kind:"skill",label:"New step",
      inputs:[{id:"in",dataType:"any"}],outputs:[{id:"out",dataType:"any"}]}]});
    setSelectedId(id);
  }
  function removeNode(){
    if(!draft||!selected)return;
    replaceDraft({...draft,nodes:draft.nodes.filter(n=>n.id!==selected.id),
      edges:draft.edges.filter(e=>e.from.nodeId!==selected.id&&e.to.nodeId!==selected.id)});
    setSelectedId("");
  }
  function addEdge(){
    if(!draft||!fromId||!toId||fromId===toId)return;
    const from=draft.nodes.find(n=>n.id===fromId),to=draft.nodes.find(n=>n.id===toId);
    const output=from?.outputs?.[0],input=to?.inputs?.[0];
    if(!output||!input){setMessage("Both steps require an output and an input port.");return;}
    if(draft.edges.some(e=>e.from.nodeId===fromId&&e.to.nodeId===toId)){
      setMessage("That connection already exists.");return;
    }
    replaceDraft({...draft,edges:[...draft.edges,{id:nextId("edge",draft.edges),
      from:{nodeId:fromId,portId:output.id},to:{nodeId:toId,portId:input.id}}]});
  }
  async function save(){
    if(!slug||!repositoryId||!draft||!gate.allowed||busy||active.key!==scopeKey)return;
    let spec:WorkflowSpecification;
    try{spec=parseWorkflowSpecification(draft);}catch(e){
      setMessage(e instanceof Error?e.message:"Invalid graph.");return;
    }
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
      <div><p><Link href={libraryHref}>Library</Link> / Workbench / Workflows</p>
        <h1>Workflow Studio</h1>
        <p>Model versioned, non-executable workflow specifications backed by authorized Git repositories.</p></div>
      <div className={styles.actions}>
        <button type="button" onClick={()=>setMode(mode==="graph"?"json":"graph")} disabled={!draft}>
          {mode==="graph"?"JSON source":"Graph and inspector"}
        </button>
        <button type="button" onClick={()=>void save()} disabled={busy||!gate.allowed}>Save to Git</button>
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
          <p className={styles.help}>No readable indexed workflows. A Git workflow may still exist without an index record; use its ID to open.</p>:
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
          <div className={styles.nodes}>{draft.nodes.map(node=>
            <button key={node.id} type="button" onClick={()=>setSelectedId(node.id)}
              className={selectedId===node.id?styles.nodeSelected:styles.node}
              aria-pressed={selectedId===node.id}>
              <small>{node.kind}</small><strong>{node.label||node.id}</strong><span>{node.id}</span>
            </button>)}</div>
          <h3>Connections</h3>
          <ul className={styles.edges}>{draft.edges.map(edge=><li key={edge.id}>
            <span>{edge.from.nodeId}.{edge.from.portId} → {edge.to.nodeId}.{edge.to.portId}</span>
            <button type="button" aria-label={`Remove connection ${edge.id}`} onClick={()=>
              replaceDraft({...draft,edges:draft.edges.filter(e=>e.id!==edge.id)})}>Remove</button>
          </li>)}</ul>
          <div className={styles.connect}>
            <label>From<select value={fromId} onChange={e=>setFromId(e.target.value)}><option value="">Step</option>
              {draft.nodes.map(n=><option key={n.id} value={n.id}>{n.label||n.id}</option>)}</select></label>
            <label>To<select value={toId} onChange={e=>setToId(e.target.value)}><option value="">Step</option>
              {draft.nodes.map(n=><option key={n.id} value={n.id}>{n.label||n.id}</option>)}</select></label>
            <button type="button" onClick={addEdge} disabled={!fromId||!toId||busy}>Connect steps</button>
          </div>
        </section>
        <aside className={styles.inspector} aria-label="Step inspector">
          <h2>Inspector</h2>
          {selected?<div className={styles.fields}>
            <label>Step ID<input value={selected.id} readOnly title="Stable immutable node identity"/></label>
            <label>Title<input value={selected.label??""} maxLength={2048}
              onChange={e=>changeNode(selected.id,{label:e.target.value})}/></label>
            <label>Kind<select value={selected.kind} onChange={e=>{
              const kind=e.target.value as WorkflowNodeKind;
              changeNode(selected.id,kind==="opaque"?{kind,native:{kind:"external"}}:{kind,native:undefined});
            }}>{KINDS.map(k=><option key={k} value={k}>{k}</option>)}</select></label>
            <p>Port metadata and provider-native payloads can be inspected and edited in JSON source. Native operations are never executed here.</p>
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
      </div>:<div className={styles.empty} role="status">Select a connected GitHub repository, enter a workflow ID, and open the actual Git artifact. No example graphs or sample runtime data are shown.</div>}
    {draft&&<footer className={styles.footer}>
      <span>{gate.allowed?"Ready to save":"Save unavailable"} · {gate.reason}</span>
      <span>Modeling only · no workflow execution, scheduling, or inferred tool traces</span>
    </footer>}
  </div>;
}
