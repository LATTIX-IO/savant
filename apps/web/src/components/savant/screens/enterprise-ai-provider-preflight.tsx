"use client";
import {useEffect,useState} from "react";
import {buildTenantScopedControlPlanePath} from "@/lib/control-plane-client";
import type {EnterpriseProviderId} from "@/lib/enterprise-provider-catalog";
import styles from "./operational-admin-v2.module.css";
type Surface={id:string;name:string;prerequisite:string;disposition:string;authorized:false;verified:false;coverage:"unknown"};
type Provider={id:EnterpriseProviderId;name:string;consoleUrl:string;connectionState:"unconfigured";grantVerified:false;surfaces:Surface[]};
export function EnterpriseAIProviderPreflight({workspaceSlug}:{workspaceSlug:string}){
 const [state,setState]=useState<{scope:string;status:"loading"|"ready"|"unavailable";data:Provider[];error:string}>({scope:"",status:"loading",data:[],error:""});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!workspaceSlug)return;
  const controller=new AbortController();
  void fetch(buildTenantScopedControlPlanePath("/api/enterprise-ai/providers",{workspaceSlug}),{
   cache:"no-store",credentials:"same-origin",signal:controller.signal
  }).then(async response=>{
   if(!response.ok)throw new Error("Provider preflight is unavailable or access was denied.");
   const payload=await response.json() as {data?:Provider[]};
   if(!Array.isArray(payload.data))throw new Error("Provider preflight response is invalid.");
   if(!controller.signal.aborted)setState({scope:workspaceSlug,status:"ready",data:payload.data,error:""});
  }).catch(()=>{
   if(!controller.signal.aborted)setState({scope:workspaceSlug,status:"unavailable",data:[],error:"Provider preflight unavailable. No provider authorization has been established."});
  });
  return ()=>controller.abort();
 },[workspaceSlug,revision]);
 const current=state.scope===workspaceSlug?state:{scope:workspaceSlug,status:"loading" as const,data:[],error:""};
 return <section aria-label="Enterprise AI provider preflight" className={styles.enterprisePreflight}>
  <div className={styles.sectionHead}><div><h2>Enterprise AI providers</h2>
   <p className={styles.note}>Provider capabilities and prerequisites; not a live grant or connectivity check.</p></div>
   <button type="button" className={styles.control} onClick={()=>setRevision(v=>v+1)}>Refresh availability</button></div>
  {current.status!=="ready"?<p role="status" className={styles.note}>{current.error||"Loading provider capability requirements..."}</p>:
   <div className={styles.enterprisePreflightGrid}>{current.data.map(p=>
    <article key={p.id} className={styles.providerGuideCard}>
     <h3>{p.name}</h3><p className={styles.note}>Unconfigured · No verified provider grant</p>
     <ul>{p.surfaces.map(s=><li key={s.id}><strong>{s.name}</strong>
      <span className={styles.note}>{s.prerequisite}</span>
      <small>{s.disposition} · not authorized · coverage unknown</small>
     </li>)}</ul>
     <p className={styles.note}>External registration is not yet required. Savant will expose a guided authorization action after its secure provider adapter is accepted.</p>
    </article>)}</div>}
 </section>;
}
