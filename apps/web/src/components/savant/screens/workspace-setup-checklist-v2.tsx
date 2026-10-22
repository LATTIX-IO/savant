"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import type {AIConnectionSummary,RepositoryListItem,SkillListItem} from "@savant/types";
import {fetchAIConnections,fetchRepositoryList,fetchSkillList} from "@/lib/control-plane-client";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import {describeWorkspaceSetup,type SetupState} from "@/lib/ui-v2-setup-status";
import {useUiV2WorkspaceSlug} from "@/components/savant/ui-v2/mode";
import {UiV2StateBanner} from "@/components/savant/ui-v2";
import styles from "./operational-admin-v2.module.css";

type Result={
 scope:string;loading:boolean;repositories:readonly RepositoryListItem[]|null;
 skills:readonly SkillListItem[]|null;models:readonly AIConnectionSummary[]|null;
 issues:readonly string[];
};
const EMPTY:Result={scope:"",loading:true,repositories:null,skills:null,models:null,issues:[]};
const statusText:Record<SetupState,string>={
 observed:"Connection or source observed",
 "action-required":"Action required",
 unknown:"Status unavailable",
 "not-verified":"Verification required",
};
export function WorkspaceSetupChecklistV2(){
 const slug=useUiV2WorkspaceSlug()??"";
 const pathname=usePathname()||"/";
 const [result,setResult]=useState<Result>(EMPTY);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!slug)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setResult({...EMPTY,scope:slug});});
  void Promise.allSettled([
   fetchRepositoryList({workspaceSlug:slug,signal:controller.signal}),
   fetchSkillList(undefined,{workspaceSlug:slug,signal:controller.signal}),
   fetchAIConnections({workspaceSlug:slug,signal:controller.signal}),
  ]).then(([repos,skills,models])=>{
   if(controller.signal.aborted)return;
   setResult({scope:slug,loading:false,
    repositories:repos.status==="fulfilled"?repos.value.data:null,
    skills:skills.status==="fulfilled"?skills.value.data:null,
    models:models.status==="fulfilled"?models.value.data:null,
    issues:[
     ...(repos.status==="rejected"?["Source repository status unavailable."]:[]),
     ...(skills.status==="rejected"?["Indexed skill status unavailable."]:[]),
     ...(models.status==="rejected"?["Model connection metadata unavailable or role-restricted."]:[]),
    ],
   });
  });
  return ()=>controller.abort();
 },[slug,retry]);

 const live=result.scope===slug?result:EMPTY;
 const report=describeWorkspaceSetup(live);
 return <section className={styles.setupGuide} aria-label="Workspace setup and readiness">
   <div className={styles.setupHeader}>
     <div><h2>Set up Savant</h2>
      <p className={styles.note}>Configure source control, indexing, evaluation and operations in one place.
       The checklist uses live workspace evidence; it never equates connection metadata with a successful run.</p></div>
     <button type="button" className={styles.control} onClick={()=>setRetry(n=>n+1)}>Refresh checks</button>
   </div>
   <div className={styles.setupProgress} role="status">
    {live.loading?"Checking authorized workspace connections…":
      `${report.observed} of ${report.required} setup prerequisites observed; remaining steps need action or verification.`}
   </div>
   {live.issues.map(issue=><UiV2StateBanner key={issue} state="unavailable" label={issue}/>)}
   <ol className={styles.setupSteps}>
    {report.steps.map((step,index)=><li key={step.id} className={styles.setupStep}>
     <span className={styles.setupStepNumber} aria-hidden="true">{index+1}</span>
     <div className={styles.setupStepBody}>
      <h3>{step.title}</h3>
      <p>{step.detail}</p>
      <span className={styles.setupStatus} data-state={step.state}>
        {live.loading?"Checking…":statusText[step.state]}
      </span>
     </div>
     <Link className={styles.control}
       href={buildTenantAwareAppPath(pathname,step.target.split("?")[0]||"/settings").concat(
         step.target.includes("?")?"?"+step.target.split("?")[1]:"") as Route}>
      {step.state==="observed"?"Review":"Configure"}
     </Link>
    </li>)}
   </ol>
   <p className={styles.note}>A provider&apos;s API token, persisted test cases, actual run results
    and administrative OAuth grants are separate security boundaries. Setup is not complete
    until the required operational checks are independently verified.</p>
 </section>;
}
