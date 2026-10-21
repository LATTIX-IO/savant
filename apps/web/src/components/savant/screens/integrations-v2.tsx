"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState,type ReactNode} from "react";
import type {AIConnectionSummary,ConnectorDashboardPayload,EvaluationDashboardPayload,
 RepositoryListItem} from "@savant/types";
import {UiV2EmptyState,UiV2Metric,UiV2PageHeader,UiV2StateBanner,
 UiV2Status,UiV2TableViewport} from "@/components/savant/ui-v2";
import {useUiV2WorkspaceSlug} from "@/components/savant/ui-v2/mode";
import {fetchRepositoryList,fetchAIConnections,fetchConnectorDashboard,
 fetchEvaluationDashboard} from "@/lib/control-plane-client";
import {getUiV2RepositoryHealth} from "@/lib/ui-v2-library-model";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import styles from "./operational-admin-v2.module.css";

type Section="source"|"models"|"clients"|"distribution"|"setup"|"router";
type IntegrationEvidence={scope:string;loading:boolean;repositories:readonly RepositoryListItem[]|null;
 models:readonly AIConnectionSummary[]|null;connectors:ConnectorDashboardPayload|null;
 evaluations:EvaluationDashboardPayload|null;errors:readonly string[]};
const EMPTY:IntegrationEvidence={scope:"",loading:true,repositories:null,models:null,
 connectors:null,evaluations:null,errors:[]};

export function IntegrationsV2({legacy}:{legacy:ReactNode}){
 const slug=useUiV2WorkspaceSlug()??"";
 const pathname=usePathname()||"/";
 const [tab,setTab]=useState<Section>("source");
 const [evidence,setEvidence]=useState<IntegrationEvidence>(EMPTY);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!slug)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setEvidence({...EMPTY,scope:slug});});
  void Promise.allSettled([
    fetchRepositoryList({workspaceSlug:slug,signal:controller.signal}),
    fetchAIConnections({workspaceSlug:slug,signal:controller.signal}),
    fetchConnectorDashboard({workspaceSlug:slug,signal:controller.signal}),
    fetchEvaluationDashboard({workspaceSlug:slug,signal:controller.signal}),
  ]).then(([repositories,models,connectors,evaluations])=>{
    if(controller.signal.aborted)return;
    setEvidence({scope:slug,loading:false,
      repositories:repositories.status==="fulfilled"?repositories.value.data:null,
      models:models.status==="fulfilled"?models.value.data:null,
      connectors:connectors.status==="fulfilled"?connectors.value.data:null,
      evaluations:evaluations.status==="fulfilled"?evaluations.value.data:null,
      errors:[
       ...(repositories.status==="rejected"?["Repository connections unavailable."]:[]),
       ...(models.status==="rejected"?["Model connections unavailable or forbidden."]:[]),
       ...(connectors.status==="rejected"?["Distribution connectors unavailable."]:[]),
       ...(evaluations.status==="rejected"?["Evaluation readiness unknown."]:[]),
      ]});
  });
  return ()=>controller.abort();
 },[slug,retry]);
 const live=evidence.scope===slug?evidence:EMPTY;
 const repositoryHref=buildTenantAwareAppPath(pathname,"/repositories") as Route;
 const modelsHref=(buildTenantAwareAppPath(pathname,"/settings")+"?section=ai") as Route;
 const sourceHref=(buildTenantAwareAppPath(pathname,"/settings")+"?section=source-control") as Route;
 const evaluationsHref=buildTenantAwareAppPath(pathname,"/evaluations") as Route;
 const defaultHref=buildTenantAwareAppPath(pathname,"/settings") as Route;
 const status=(model:AIConnectionSummary)=>model.status==="active"?"ready":
   model.status==="revoked"?"failed":"warning";
 const repoIndexed=live.repositories?.filter(r=>getUiV2RepositoryHealth(r)==="ready").length??null;
 const providerReady=live.models?.some(m=>m.status==="active"&&m.supportsExecution)??false;
 const firstEvaluation=live.evaluations?.runs.length??null;
 return <div className={styles.page}>
  <UiV2PageHeader title="Integrations" eyebrow="Workspace / connected systems"
   description="Real source connections, authorized model metadata, router controls, and distribution."
   actions={<button type="button" className={styles.control}
     onClick={()=>setRetry(x=>x+1)}>Refresh</button>}/>
  {live.errors.map(msg=><UiV2StateBanner key={msg} state="unavailable" label={msg}/>)}
  <section className={styles.topology} aria-label="Integration topology">
    <div><h2>Sources</h2><UiV2Metric label="Connected repositories" value={live.repositories?.length??null}/>
      <Link href={repositoryHref}>Repository inventory</Link></div>
    <span aria-hidden="true" className={styles.arrow}>→</span>
    <div className={styles.hub}><strong>Savant</strong><span>index · evaluate · route</span></div>
    <span aria-hidden="true" className={styles.arrow}>→</span>
    <div><h2>Execution</h2><UiV2Metric label="Authorized model connections" value={live.models?.length??null}/>
      <Link href={modelsHref}>Provider controls</Link></div>
  </section>
  <div className={styles.tabs} role="tablist" aria-label="Integration categories">
    {(["source","models","clients","distribution","setup","router"] as const).map(area=>
      <button type="button" role="tab" key={area} aria-selected={area===tab}
        onClick={()=>setTab(area)}>{area==="source"?"Source control":
         area==="models"?"Model providers":area==="clients"?"Agent clients":
         area==="distribution"?"Distribution":area==="setup"?"Setup guide":"Router controls"}</button>)}
  </div>
  <section className={styles.section} role="tabpanel">
    {tab==="source"?<>
      <div className={styles.sectionHead}><h2>Source control</h2>
        <Link href={sourceHref}>Connect, authorize, sync or revoke</Link></div>
      {!live.repositories?<UiV2EmptyState message="Repository source unavailable."/>:
       live.repositories.length===0?<UiV2EmptyState message="No repositories connected."/>:
       <UiV2TableViewport label="Authorized repositories"><table className={styles.table}>
        <thead><tr><th>Name</th><th>Provider</th><th>Branch</th><th>Index state</th><th>Skills</th></tr></thead>
        <tbody>{live.repositories.map(repo=><tr key={repo.id}><td>{repo.name}</td>
          <td>{repo.provider}</td><td>{repo.branch}</td>
          <td><UiV2Status state={getUiV2RepositoryHealth(repo)==="ready"?"ready":"warning"}
            label={getUiV2RepositoryHealth(repo)}/></td>
          <td>{repo.skills}</td></tr>)}</tbody></table></UiV2TableViewport>}
    </>:tab==="models"?<>
      <div className={styles.sectionHead}><h2>Model providers</h2>
        <Link href={modelsHref}>Manage encrypted connection credentials</Link></div>
      {!live.models?<UiV2EmptyState message="No permission or source for model connections."/>:
        live.models.length===0?<UiV2EmptyState message="No model provider configured."/>:
        <UiV2TableViewport label="Model provider metadata only"><table className={styles.table}>
          <thead><tr><th>Connection</th><th>Provider</th><th>Capabilities</th>
            <th>Rotation</th><th>Status</th></tr></thead>
          <tbody>{live.models.map(model=><tr key={model.aiConnectionUuid}>
            <td>{model.label}</td><td>{model.provider}</td>
            <td>{[model.supportsExecution?"execute":null,model.supportsJudging?"judge":null]
              .filter(Boolean).join(", ")||"Not specified"}</td>
            <td>{model.lastRotated||"Not available"}</td>
            <td><UiV2Status state={status(model)} label={model.status}/></td>
          </tr>)}</tbody></table></UiV2TableViewport>}
      <UiV2StateBanner state="ready" label="API credentials are never returned to this read-only topology."/>
    </>:tab==="clients"?<>
      <h2>Agent clients</h2>
      <UiV2StateBanner state="unavailable"
        label="A tenant-scoped agent-client inventory API is not available; no clients or token values are inferred."/>
      <button type="button" className={styles.control} onClick={()=>setTab("router")}>
        Open existing permission-gated router controls
      </button>
    </>:tab==="distribution"?<>
      <h2>Distribution</h2>
      {!live.connectors?<UiV2EmptyState message="Connector status is unavailable."/>:
        live.connectors.connectors.length===0?<UiV2EmptyState message="No distribution connectors recorded."/>:
        <UiV2TableViewport label="Connected distribution adapters"><table className={styles.table}>
          <thead><tr><th>Connector</th><th>Category</th><th>Status</th><th>Scope</th></tr></thead>
          <tbody>{live.connectors.connectors.map(c=><tr key={c.id}>
            <td>{c.name}</td><td>{c.category}</td>
            <td><UiV2Status state={c.status==="healthy"?"ready":c.status==="offline"?"unavailable":"warning"} label={c.status}/></td>
            <td>{c.scope}</td>
          </tr>)}</tbody></table></UiV2TableViewport>}
    </>:tab==="setup"?<>
      <h2>Setup guide · current server evidence</h2>
      <div className={styles.setup}>
        {([
          {title:"1 · Connect source control",ok:live.repositories!==null&&live.repositories.length>0,
           href:sourceHref,action:"Manage source connections"},
          {title:"2 · Choose repositories",ok:live.repositories!==null&&live.repositories.length>0,
           href:repositoryHref,action:"Open repository inventory"},
          {title:"3 · Index skills",ok:repoIndexed!==null&&repoIndexed>0,
           href:repositoryHref,action:"Inspect index state"},
          {title:"4 · Connect an execution model",ok:providerReady,
           href:modelsHref,action:"Manage model providers"},
          {title:"5 · Run a first evaluation",ok:firstEvaluation!==null&&firstEvaluation>0,
           href:evaluationsHref,action:"Open Evaluations"},
        ]).map(item=><div key={item.title}>
          <strong>{item.title}</strong><UiV2Status
            state={item.ok?"ready":"warning"} label={item.ok?"Observed":"Action / evidence required"}/>
          <Link href={item.href}>{item.action}</Link>
        </div>)}
      </div>
      <p className={styles.note}>An indexed evaluation record is not proof of a Test Bench provider-backed
         case execution. Saved suites, recoverable keys, billing receipts and live provider
         acceptance remain separate gates. No step uses browser-local simulated state.</p>
      <Link href={defaultHref}>Workspace settings</Link>
    </>:<div className={styles.legacy}>
      <UiV2StateBanner state="warning"
       label="Existing router credential issuance remains controlled by its server-side authorization policy."/>
      {legacy}
    </div>}
  </section>
 </div>;
}
