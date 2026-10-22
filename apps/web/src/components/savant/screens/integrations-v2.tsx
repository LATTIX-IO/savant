"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState,type ReactNode} from "react";
import type {AIConnectionSummary,ConnectorDashboardPayload,
 RepositoryListItem} from "@savant/types";
import {UiV2EmptyState,UiV2Metric,UiV2PageHeader,UiV2StateBanner,
 UiV2Status,UiV2TableViewport} from "@/components/savant/ui-v2";
import {useUiV2WorkspaceSlug} from "@/components/savant/ui-v2/mode";
import {fetchRepositoryList,fetchAIConnections,fetchConnectorDashboard} from "@/lib/control-plane-client";
import {inspectUiV2ProviderLanes} from "@/lib/ui-v2-provider-lanes";
import {ProviderConnectionGuide} from "./provider-connection-guide";
import {getUiV2RepositoryHealth} from "@/lib/ui-v2-library-model";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import styles from "./operational-admin-v2.module.css";

type Section="source"|"models"|"clients"|"distribution"|"setup"|"router";
type IntegrationEvidence={scope:string;loading:boolean;repositories:readonly RepositoryListItem[]|null;
 models:readonly AIConnectionSummary[]|null;connectors:ConnectorDashboardPayload|null;
 errors:readonly string[]};
const EMPTY:IntegrationEvidence={scope:"",loading:true,repositories:null,models:null,
 connectors:null,errors:[]};

export function IntegrationsV2({legacy}:{legacy:ReactNode}){
 const slug=useUiV2WorkspaceSlug()??"";
 const pathname=usePathname()||"/";
 const [tab,setTab]=useState<Section>("setup");
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
  ]).then(([repositories,models,connectors])=>{
    if(controller.signal.aborted)return;
    setEvidence({scope:slug,loading:false,
      repositories:repositories.status==="fulfilled"?repositories.value.data:null,
      models:models.status==="fulfilled"?models.value.data:null,
      connectors:connectors.status==="fulfilled"?connectors.value.data:null,
      errors:[
       ...(repositories.status==="rejected"?["Repository connections unavailable."]:[]),
       ...(models.status==="rejected"?["Model connections unavailable or forbidden."]:[]),
       ...(connectors.status==="rejected"?["Distribution connectors unavailable."]:[]),
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
 const lanes=inspectUiV2ProviderLanes(live.models);
 const providerReady=lanes.workspaceOpenAiExecutor!==null;
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
    {(["setup","source","models","clients","distribution","router"] as const).map(area=>
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
      <div className={styles.providerLanes} aria-label="AI provider execution contexts">
        <section>
          <h3>Evaluation executor</h3>
          {lanes.workspaceOpenAiExecutor
            ? <UiV2Status state="ready" label={lanes.workspaceOpenAiExecutor.label+" · default workspace OpenAI metadata"}/>
            : <UiV2Status state="unavailable" label="No active default workspace OpenAI executor"/>}
          <p className={styles.note}>The current saved Test Bench supports platform NIM or
            a tenant-owned OpenAI executor. A saved connection is not proof of a successful
            provider call, restored schema, or recoverable encryption key.</p>
        </section>
        <section>
          <h3>Evaluation judge</h3>
          <UiV2Status state="warning" label="Platform evaluation judge · independent service"/>
          <p className={styles.note}>{lanes.defaultJudgeCount} active BYO judge default(s)
            recorded as metadata. Test Bench does not dynamically route judging through
            that setting, so it cannot authorize a change of judge here.</p>
        </section>
        <section>
          <h3>Production AI serving</h3>
          <UiV2Status state="unavailable" label="Independent production routing not configured"/>
          <p className={styles.note}>Live end-user AI inference has no separately enforced
            tenant default in this integration. Do not reuse the evaluation executor as
            a production provider or infer production readiness from its status.</p>
        </section>
      </div>
      <ProviderConnectionGuide executorLabel={lanes.workspaceOpenAiExecutor?.label??null}
       testAction={<Link href={modelsHref} className={styles.control}>
        Configure existing test API provider
       </Link>}/>
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
      <div className={styles.sectionHead}><h2>Workspace setup</h2>
        <Link href={defaultHref}>Open the complete Settings setup checklist</Link></div>
      <p className={styles.note}>Settings is the canonical one-stop place for
        connecting Git, indexing skills, configuring model credentials, and
        verifying saved suites and actual evaluation runs. Integrations provides
        the advanced provider and distribution inventories below.</p>
      <div className={styles.setup}>
        <div><strong>Source repositories</strong>
          <UiV2Status state={live.repositories===null?"unavailable":
            live.repositories.length>0?"ready":"warning"}
            label={live.repositories===null?"Not available":
              live.repositories.length>0?"Connected metadata observed":"Connect source control"}/>
          <Link href={repositoryHref}>Manage sources</Link></div>
        <div><strong>Indexed skill evidence</strong>
          <UiV2Status state={repoIndexed===null?"unavailable":repoIndexed>0?"ready":"warning"}
            label={repoIndexed===null?"Not available":repoIndexed>0?
              `${repoIndexed} repository index(es) observed`:"No indexed repositories"}/>
          <Link href={repositoryHref}>Inspect indexing</Link></div>
        <div><strong>Test Bench provider</strong>
          <UiV2Status state={providerReady?"ready":"warning"}
            label={providerReady?"Connection metadata observed; runtime not verified":
              "No eligible default workspace test executor"}/>
          <Link href={modelsHref}>Manage provider credentials</Link></div>
        <div><strong>Saved cases and provider-backed runs</strong>
          <UiV2Status state="unavailable" label="Not verified by this integration inventory"/>
          <Link href={defaultHref}>Continue guided setup</Link></div>
      </div>
    </>:<div className={styles.legacy}>
      <UiV2StateBanner state="warning"
       label="Existing router credential issuance remains controlled by its server-side authorization policy."/>
      {legacy}
    </div>}
  </section>
 </div>;
}
