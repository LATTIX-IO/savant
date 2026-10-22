"use client";

import Link from "next/link";
import type {Route} from "next";
import {useEffect,useState} from "react";
import type {AIConnectionSummary,RepositoryListItem,SkillListItem} from "@savant/types";
import {fetchAIConnections,fetchRepositoryList,fetchSkillList} from "@/lib/control-plane-client";
import {buildTenantAppPath} from "@/lib/tenant-paths";
import {describeWorkspaceSetup} from "@/lib/ui-v2-setup-status";
import styles from "./app-shell-v2.module.css";

type Status={
 scope:string;loading:boolean;
 repositories:readonly RepositoryListItem[]|null;
 skills:readonly SkillListItem[]|null;
 models:readonly AIConnectionSummary[]|null;
};
const INITIAL:Status={scope:"",loading:true,repositories:null,skills:null,models:null};

/** A compact, read-only status link. Does not award completion based on a Git
 * index, unverified provider run, browser state, or a remembered checklist flag. */
export function SetupStatusBubbleV2({workspaceSlug}:{workspaceSlug:string}){
 const [status,setStatus]=useState<Status>(INITIAL);
 useEffect(()=>{
  if(!workspaceSlug)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setStatus({...INITIAL,scope:workspaceSlug});});
  void Promise.allSettled([
   fetchRepositoryList({workspaceSlug,signal:controller.signal}),
   fetchSkillList(undefined,{workspaceSlug,signal:controller.signal}),
   fetchAIConnections({workspaceSlug,signal:controller.signal}),
  ]).then(([repositories,skills,models])=>{
   if(controller.signal.aborted)return;
   setStatus({scope:workspaceSlug,loading:false,
    repositories:repositories.status==="fulfilled"?repositories.value.data:null,
    skills:skills.status==="fulfilled"?skills.value.data:null,
    models:models.status==="fulfilled"?models.value.data:null,
   });
  });
  return ()=>controller.abort();
 },[workspaceSlug]);
 const live=status.scope===workspaceSlug?status:INITIAL;
 const report=describeWorkspaceSetup(live);
 const label=live.loading?"Checking setup…":report.completeness==="unavailable"?
   "Setup status unavailable":`${report.observed} of ${report.required} observed`;
 return <Link href={buildTenantAppPath(workspaceSlug,"/settings?section=setup") as Route}
   className={styles.setupBubble} aria-label={`Open workspace setup. ${label}.`}>
   <span className={styles.setupBubbleTitle}>
     <span>Workspace setup</span>
     <span aria-hidden="true">→</span>
   </span>
   <strong>{label}</strong>
   <span className={styles.setupBubbleTrack} aria-hidden="true">
     <span style={{width:`${(report.observed/report.required)*100}%`}}/>
   </span>
   <small>Configure and verify remaining steps</small>
 </Link>;
}
