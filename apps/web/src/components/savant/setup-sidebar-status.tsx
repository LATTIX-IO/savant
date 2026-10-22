"use client";

import Link from "next/link";
import type {Route} from "next";
import {useEffect,useState} from "react";
import type {RepositoryListItem,SkillListItem,AIConnectionSummary} from "@savant/types";
import {fetchRepositoryList,fetchSkillList,fetchAIConnections} from "@/lib/control-plane-client";
import {buildTenantAppPath} from "@/lib/tenant-paths";
import {describeWorkspaceSetup} from "@/lib/ui-v2-setup-status";
import styles from "./app-shell-v2.module.css";

type Counts={slug:string;loading:boolean;repositories:readonly RepositoryListItem[]|null;
 skills:readonly SkillListItem[]|null;models:readonly AIConnectionSummary[]|null};
const DEFAULT:Counts={slug:"",loading:true,repositories:null,skills:null,models:null};

/** Lightweight and read-only source-backed setup prompt; never marks a provider
 * ready from untested credentials or invents a verified Test Bench result. */
export function SetupSidebarStatus({workspaceSlug}:{workspaceSlug:string}){
 const [counts,setCounts]=useState<Counts>(DEFAULT);
 useEffect(()=>{
  if(!workspaceSlug)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setCounts({...DEFAULT,slug:workspaceSlug});});
  void Promise.allSettled([
   fetchRepositoryList({workspaceSlug,signal:controller.signal}),
   fetchSkillList(undefined,{workspaceSlug,signal:controller.signal}),
   fetchAIConnections({workspaceSlug,signal:controller.signal}),
  ]).then(([repos,skills,models])=>{
   if(controller.signal.aborted)return;
   setCounts({slug:workspaceSlug,loading:false,
    repositories:repos.status==="fulfilled"?repos.value.data:null,
    skills:skills.status==="fulfilled"?skills.value.data:null,
    models:models.status==="fulfilled"?models.value.data:null,
   });
  });
  return ()=>controller.abort();
 },[workspaceSlug]);
 const live=counts.slug===workspaceSlug?counts:DEFAULT;
 const report=describeWorkspaceSetup(live);
 const pending=report.steps.filter(step=>step.state!=="observed");
 const next=pending[0]?.title||"Review setup readiness";
 return <Link className={styles.setupBubble}
   href={buildTenantAppPath(workspaceSlug,"/settings") as Route}
   aria-label={`Open workspace setup: ${live.loading?
     "checking readiness":`${report.observed} of ${report.required} prerequisites observed`}`}>
   <span className={styles.setupBubbleTitle}>Finish workspace setup
     <span aria-hidden="true">↗</span></span>
   <span className={styles.setupBubbleMeter} aria-hidden="true"><i
     style={{width:`${report.required?100*report.observed/report.required:0}%`}}/></span>
   <span>{live.loading?"Checking setup…":
    `${report.observed} of ${report.required} prerequisites observed`}</span>
   <small>{live.loading?"Checking authorized workspace data":next}</small>
 </Link>;
}
