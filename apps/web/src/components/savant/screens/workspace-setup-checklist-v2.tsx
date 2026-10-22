"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import type {AIConnectionSummary,RepositoryListItem,SkillListItem} from "@savant/types";
import {fetchAIConnections,fetchRepositoryList,fetchSkillList} from "@/lib/control-plane-client";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import {describeWorkspaceSetup,selectedTestBenchReadiness,type SetupState} from "@/lib/ui-v2-setup-status";
import {listPersistedTestBenches} from "@/lib/test-bench-client";
import {listObservedTestBenchRuns} from "@/lib/observed-test-bench-runs";
import type {TestBenchDefinition} from "@/server/test-bench/definition-contract";
import type {ObservedRunSummary} from "@/server/test-bench/observed-run-store";
import {useUiV2WorkspaceSlug} from "@/components/savant/ui-v2/mode";
import {UiV2StateBanner} from "@/components/savant/ui-v2";
import styles from "./operational-admin-v2.module.css";

type Result={
 scope:string;loading:boolean;repositories:readonly RepositoryListItem[]|null;
 skills:readonly SkillListItem[]|null;models:readonly AIConnectionSummary[]|null;
 issues:readonly string[];
};
const EMPTY:Result={scope:"",loading:true,repositories:null,skills:null,models:null,issues:[]};
type CaseCheck={key:string;loading:boolean;definitions:readonly TestBenchDefinition[]|null;error:boolean};
type RunCheck={key:string;loading:boolean;runs:readonly ObservedRunSummary[]|null;error:boolean};
const EMPTY_CASES:CaseCheck={key:"",loading:true,definitions:null,error:false};
const EMPTY_RUNS:RunCheck={key:"",loading:true,runs:null,error:false};
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
 const [selectedSkillId,setSelectedSkillId]=useState("");
 const [selectedSuiteId,setSelectedSuiteId]=useState("");
 const [cases,setCases]=useState<CaseCheck>(EMPTY_CASES);
 const [runs,setRuns]=useState<RunCheck>(EMPTY_RUNS);
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
 // Never query a former tenant's skill or suite identifiers.
 const skill=live.skills?.find(item=>item.id===selectedSkillId)??null;
 const skillKey=skill?`${slug}:${skill.id}`:"";
 const caseState=cases.key===skillKey?cases:EMPTY_CASES;
 const currentSuite=caseState.definitions?.find(item=>item.id===selectedSuiteId)??
   caseState.definitions?.[0]??null;
 const runKey=currentSuite?`${skillKey}:${currentSuite.id}:${currentSuite.revision}:${currentSuite.sourceCommitSha}`:"";
 const runState=runs.key===runKey?runs:EMPTY_RUNS;
 const checked=selectedTestBenchReadiness({
   selectedSkill:Boolean(skill),
   definitions:caseState.loading?null:caseState.definitions,
   selectedSuite:currentSuite,
   runs:runState.loading?null:runState.runs,
 });
 const report=describeWorkspaceSetup({...live,
   caseState:checked.cases,verifiedRunState:checked.verifiedRun,
 });
 useEffect(()=>{
   if(!slug||!skill)return;
   const controller=new AbortController();
   const key=skillKey;
   queueMicrotask(()=>{if(!controller.signal.aborted)
     setCases({key,loading:true,definitions:null,error:false});});
   void listPersistedTestBenches(skill.id,{workspaceSlug:slug,signal:controller.signal})
     .then(definitions=>{if(!controller.signal.aborted)
       setCases({key,loading:false,definitions,error:false});})
     .catch(()=>{if(!controller.signal.aborted)
       setCases({key,loading:false,definitions:null,error:true});});
   return ()=>controller.abort();
 },[slug,skill?.id,skillKey,retry]);
 useEffect(()=>{
   if(!slug||!skill||!currentSuite)return;
   const controller=new AbortController();
   const key=runKey;
   queueMicrotask(()=>{if(!controller.signal.aborted)
     setRuns({key,loading:true,runs:null,error:false});});
   void listObservedTestBenchRuns(skill.id,currentSuite.id,currentSuite.sourceCommitSha,{
     workspaceSlug:slug,signal:controller.signal,
   }).then(records=>{if(!controller.signal.aborted)
     setRuns({key,loading:false,runs:records,error:false});})
     .catch(()=>{if(!controller.signal.aborted)
       setRuns({key,loading:false,runs:null,error:true});});
   return ()=>controller.abort();
 },[slug,skill?.id,runKey,currentSuite?.id,currentSuite?.sourceCommitSha,retry]);
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
