"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState,type ReactNode} from "react";
import type {SkillListItem,SkillDetailPayload,ReleaseDashboardPayload,
 OrganizationIntelligencePayload} from "@savant/types";
import {useUiV2WorkspaceSlug} from "@/components/savant/ui-v2/mode";
import {fetchSkillList,fetchSkillDetail,fetchReleaseDashboard,
 fetchOrganizationIntelligence} from "@/lib/control-plane-client";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import {UiV2EmptyState,UiV2Metric,UiV2PageHeader,UiV2StateBanner,
 UiV2Status,UiV2TableViewport} from "@/components/savant/ui-v2";
import {ObservedRunComparisonPanel} from "./observed-run-comparison-panel";
import {observedPortfolio,releaseProgress,chronologicalReleaseHistory}
 from "@/lib/ui-v2-insights-model";
import {recordedGitRevisionOptions,recordedGitCompareUrl} from "@/lib/ui-v2-insights-git-comparison";
import styles from "./insights-v2.module.css";

type Panel="compare"|"releases"|"portfolio"|"advanced";
type Data={scope:string;loading:boolean;skills:readonly SkillListItem[]|null;
 releases:ReleaseDashboardPayload|null;portfolio:OrganizationIntelligencePayload|null;
 errors:readonly string[]};
const EMPTY:Data={scope:"",loading:true,skills:null,releases:null,portfolio:null,errors:[]};
export function InsightsV2({advanced}:{advanced:ReactNode}){
 const slug=useUiV2WorkspaceSlug()??"";
 const pathname=usePathname()||"/";
 const [data,setData]=useState<Data>(EMPTY);
 const [selection,setSelection]=useState("");
 const [gitComparison,setGitComparison]=useState<{skill:string;base:string;head:string}>({
   skill:"",base:"",head:"",
 });
 const [detail,setDetail]=useState<{scope:string;id:string;data:SkillDetailPayload|null;
  ready:boolean}>({scope:"",id:"",data:null,ready:false});
 const [tab,setTab]=useState<Panel>("compare");
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!slug)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setData({...EMPTY,scope:slug});});
  void Promise.allSettled([
    fetchSkillList(undefined,{workspaceSlug:slug,signal:controller.signal}),
    fetchReleaseDashboard({workspaceSlug:slug,signal:controller.signal}),
    fetchOrganizationIntelligence({workspaceSlug:slug,signal:controller.signal}),
  ]).then(([skills,releases,portfolio])=>{
    if(controller.signal.aborted)return;
    setData({scope:slug,loading:false,
      skills:skills.status==="fulfilled"?skills.value.data:null,
      releases:releases.status==="fulfilled"?releases.value.data:null,
      portfolio:portfolio.status==="fulfilled"?portfolio.value.data:null,
      errors:[
        ...(skills.status==="rejected"?["Skill inventory unavailable."]:[]),
        ...(releases.status==="rejected"?["Release dashboard unavailable."]:[]),
        ...(portfolio.status==="rejected"?["Portfolio telemetry unavailable."]:[]),
      ]});
  });
  return ()=>controller.abort();
 },[slug,refresh]);
 const current=data.scope===slug?data:EMPTY;
 const skill=current.skills?.find(x=>x.id===selection)??current.skills?.[0]??null;
 const skillId=skill?.id??"";
 useEffect(()=>{
  if(!slug||!skillId)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)
    setDetail({scope:slug,id:skillId,data:null,ready:false});});
  void fetchSkillDetail(skillId,{workspaceSlug:slug,signal:controller.signal})
   .then(x=>{if(!controller.signal.aborted)setDetail({
     scope:slug,id:skillId,data:x.data,ready:true});})
   .catch(()=>{if(!controller.signal.aborted)setDetail({
     scope:slug,id:skillId,data:null,ready:true});});
  return ()=>controller.abort();
 },[slug,skillId,refresh]);
 const inspected=detail.scope===slug&&detail.id===skillId?detail:null;
 const history=inspected?.data?.versionHistory??[];
 const options=skill?recordedGitRevisionOptions(skill,history):[];
 const selectedGit=gitComparison.skill===`${slug}/${skillId}`?gitComparison:null;
 const base=options.some(item=>item.commit===selectedGit?.base)?selectedGit!.base:options[1]?.commit??"";
 const head=options.some(item=>item.commit===selectedGit?.head)?selectedGit!.head:options[0]?.commit??"";
 const compareUrl=skill?recordedGitCompareUrl(skill,history,base,head):null;
 const portfolio=observedPortfolio(current.portfolio);
 const releasesHref=buildTenantAwareAppPath(pathname,"/releases") as Route;
 const skillHref=skill?buildTenantAwareAppPath(pathname,
   "/skills/"+encodeURIComponent(skill.skillUuid)) as Route:null;
 return <div className={styles.page}>
  <UiV2PageHeader title="Insights" eyebrow="Quality engineering / evidence"
    description="Compare immutable source revisions, inspect release gates, and review portfolio telemetry."
    actions={<button type="button" className={styles.button}
      onClick={()=>setRefresh(x=>x+1)}>Refresh source-backed data</button>}/>
  {current.errors.map(x=><UiV2StateBanner key={x} label={x} state="unavailable"/>)}
  <div className={styles.tabs} role="tablist" aria-label="Insights sections">
    {(["compare","releases","portfolio","advanced"] as const).map(v=>
      <button type="button" key={v} role="tab" aria-selected={v===tab}
        onClick={()=>setTab(v)}>{v==="compare"?"Compare versions":
         v==="releases"?"Releases":v==="portfolio"?"Portfolio":"Advanced policies"}</button>)}
  </div>
  <section className={styles.section} role="tabpanel">
    {tab==="advanced"?<div className={styles.advanced}>
      <UiV2StateBanner state="warning"
        label="Advanced intelligence controls retain the existing audited policy workflow during migration."/>
      {advanced}
    </div>:tab==="compare"?<>
      <div className={styles.picker}>
        <label>Skill <select value={skillId} disabled={!current.skills?.length}
          onChange={e=>setSelection(e.target.value)}>
          {(current.skills??[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {skillHref?<Link href={skillHref}>Open Workbench</Link>:null}
      </div>
      {!skill?<UiV2EmptyState message="Choose an indexed skill to compare verified revisions."/>:
      <div className={styles.compare}>
        <section className={styles.panel}>
          <h2>What changed</h2>
          {inspected?.data?.versionHistory.length?
            <UiV2TableViewport label="Recorded immutable skill versions">
              <table className={styles.table}>
                <thead><tr><th>Version</th><th>Commit SHA</th><th>Channel</th><th>Recorded score</th></tr></thead>
                <tbody>{inspected.data.versionHistory.map(v=><tr key={v.commit}>
                  <td>{v.ref}</td><td className={styles.mono}>{v.commit}</td><td>{v.channel}</td>
                  <td>{Number.isFinite(v.score)?v.score:"Not available"}</td>
                </tr>)}</tbody>
              </table></UiV2TableViewport>:
            <UiV2EmptyState message="No verified version history available for this skill."/>}
          {skill&&options.length>=2?<div className={styles.gitCompare} aria-label="Recorded Git source comparison">
            <div className={styles.gitCompareFields}>
              <label>Base revision
                <select value={base} onChange={event=>setGitComparison({
                  skill:`${slug}/${skillId}`,base:event.target.value,head,
                })}>
                  {options.map(version=><option key={version.commit} value={version.commit}>
                    {version.label}</option>)}
                </select>
              </label>
              <label>Candidate revision
                <select value={head} onChange={event=>setGitComparison({
                  skill:`${slug}/${skillId}`,base,head:event.target.value,
                })}>
                  {options.map(version=><option key={version.commit} value={version.commit}>
                    {version.label}</option>)}
                </select>
              </label>
            </div>
            {compareUrl?<a href={compareUrl} target="_blank" rel="noopener noreferrer"
              className={styles.gitCompareLink}>
              Review these immutable revisions in GitHub <span aria-hidden="true">↗</span>
            </a>:<p className={styles.note} role="status">
              Choose two different, recorded Git revisions to compare.
            </p>}
            <p className={styles.note}>GitHub shows a read-only, repository-wide
              comparison between the selected commits; changes may include other
              skills or files. Savant has not independently verified a skill-only
              per-file diff or a QA uplift from this link. Review affected paths
              and authorizations in Git before approval.</p>
          </div>:<UiV2StateBanner state="unavailable"
             label={inspected?.ready&&!inspected.data?
               "Skill detail unavailable. Retry the authorized source history request.":
               skill?.repoProvider!=="github"?
               "Git compare is available for GitHub-hosted skills only.":
               "At least two distinct full Git revisions must be recorded before source comparison."}/>}

        </section>
        <section className={styles.panel}>
          <h2>Did it improve / What regressed</h2>
          <ObservedRunComparisonPanel key={slug+":"+skillId} skillId={skill.id} workspaceSlug={slug}/>
          <p className={styles.note}>Comparisons must share input cases, execution model,
             judge and scoring contract; differing source SHA alone is insufficient.</p>
        </section>
      </div>
    }
    </>:tab==="releases"?<>
      <header className={styles.title}><h2>Release requests and gates</h2>
        <Link href={releasesHref}>Open full release controls</Link></header>
      {!current.releases?<UiV2EmptyState message="Release state unavailable."/>:
        current.releases.inMotion.length===0?<UiV2EmptyState message="No release requests in flight."/>:
        <UiV2TableViewport label="Observed release readiness"><table className={styles.table}>
          <thead><tr><th>Skill</th><th>Candidate</th><th>Target</th>
             <th>Approval gates</th><th>Blocking reason</th></tr></thead>
          <tbody>{current.releases.inMotion.map(item=>{
            const gate=releaseProgress(item);
            return <tr key={item.id}>
              <td>{item.skill}</td><td className={styles.mono}>{item.candidateCommit}</td>
              <td>{item.toEnv}</td><td>{gate.approved}/{gate.required}</td>
              <td>{item.approvalsBlocked??"No explicit approval blocker reported"}</td>
            </tr>;
          })}</tbody></table></UiV2TableViewport>}
      <h2>Release history</h2>
      {!current.releases?.history.length?<UiV2EmptyState message="No recorded release or rollback history."/>:
        <UiV2TableViewport label="Observed release history"><table className={styles.table}>
          <thead><tr><th>Recorded</th><th>Skill</th><th>Revision</th><th>Environment</th><th>Outcome</th></tr></thead>
          <tbody>{chronologicalReleaseHistory(current.releases.history).slice(0,25).map((item,i)=><tr key={i}>
            <td>{item.when}</td><td>{item.skill}</td><td>{item.ref}</td>
            <td>{item.env}</td><td><UiV2Status state={item.outcome==="rolled-back"?"warning":"ready"}
              label={item.outcome}/></td>
          </tr>)}</tbody></table></UiV2TableViewport>}
      <UiV2StateBanner state="unavailable"
        label="Promotion and rollback remain governed server-side; this view never auto-approves a candidate."/>
    </>:<>
      <div className={styles.portfolio}>
        <UiV2Metric label="Active skills" value={portfolio.active}/>
        <UiV2Metric label="Runs this month" value={portfolio.runs}/>
        <UiV2Metric label="Skills improving" value={portfolio.improving}/>
        <UiV2Metric label="Skills degrading" value={portfolio.degrading}/>
        <UiV2Metric label="Evaluation coverage" value={portfolio.coverage===null?null:`${portfolio.coverage}%`}/>
        <UiV2Metric label="Telemetry sufficient" value={portfolio.telemetry===null?null:`${portfolio.telemetry}%`}/>
      </div>
      <h2>Improvement recommendations</h2>
      {!current.portfolio?.queue.length?<UiV2EmptyState message="No evidence-backed recommendations available."/>:
       <UiV2TableViewport label="Source-backed recommendations"><table className={styles.table}>
         <thead><tr><th>Skill</th><th>Evidence strength</th><th>Validation</th>
           <th>Status</th><th>Runs</th></tr></thead>
         <tbody>{current.portfolio.queue.map(item=><tr key={item.recommendationId}>
           <td><Link href={buildTenantAwareAppPath(pathname,
              "/skills/"+encodeURIComponent(item.skillId)) as Route}>{item.skillName}</Link></td>
           <td>{item.evidenceStrength}</td>
           <td><UiV2Status state={item.validated?"ready":"unavailable"}
             label={item.validated?"Validated":"Predicted / unverified"}/></td>
           <td>{item.status}</td><td>{item.runCount}</td>
         </tr>)}</tbody>
       </table></UiV2TableViewport>}
      <p className={styles.note}>The portfolio reports source-backed operational telemetry.
        Score deltas, provider charges and source changes are not merged into a common
        comparator without pinned, compatible observed receipts. Recommendations are not releases.</p>
    </>}
  </section>
 </div>;
}
