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
 // The compact bubble only checks source/index/model metadata. The Test Bench
 // case and observed-provider steps require an explicit skill/suite selection.
 const prerequisites=report.steps.filter(step=>
   step.id!=="cases"&&step.id!=="verified-run");
 const observed=prerequisites.filter(step=>step.state==="observed").length;
 const label=live.loading?"Checking setup…":prerequisites.every(step=>step.state==="unknown")?
   "Setup sources unavailable":`${observed} of ${prerequisites.length} source/provider checks observed`;
 return <Link href={buildTenantAppPath(workspaceSlug,"/settings?section=setup") as Route}
   className={styles.setupBubble} aria-label={`Open workspace setup. ${label}.`}>
   <span className={styles.setupBubbleTitle}>
     <span>Workspace setup</span>
     <span aria-hidden="true">→</span>
   </span>
   <strong>{label}</strong>
   <span className={styles.setupBubbleTrack} aria-hidden="true">
     <span style={{width:`${(observed/prerequisites.length)*100}%`}}/>
   </span>
   <small>Verify saved cases and actual runs in Settings</small>
 </Link>;
}
