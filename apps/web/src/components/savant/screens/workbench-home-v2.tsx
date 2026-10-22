"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { SkillListItem } from "@savant/types";
import { fetchSkillList } from "@/lib/control-plane-client";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { UiV2EmptyState, UiV2PageHeader, UiV2StateBanner } from "@/components/savant/ui-v2";
import { buildSkillDetailPath } from "@/lib/skill-paths";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import styles from "./workbench-home-v2.module.css";

type Inventory={
  scope:string;phase:"loading"|"ready"|"error";
  data:readonly SkillListItem[];message:string;
};
const EMPTY:Inventory={scope:"",phase:"loading",data:[],message:""};
const MAX_VISIBLE=30;

/**
 * Workbench opens as a real location, not a command palette or a selected
 * arbitrary skill. The only choices shown are authorized tenant-indexed skills.
 */
export function WorkbenchHomeV2(){
  const slug=useUiV2WorkspaceSlug()??"";
  const pathname=usePathname()||"/";
  const [inventory,setInventory]=useState<Inventory>(EMPTY);
  const [query,setQuery]=useState("");
  const [expanded,setExpanded]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    if(!slug)return;
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){
      setInventory({...EMPTY,scope:slug});setQuery("");setExpanded(false);
    }});
    void fetchSkillList(undefined,{workspaceSlug:slug,signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted)
        setInventory({scope:slug,phase:"ready",data:result.data,message:""});
    }).catch(error=>{
      if(!controller.signal.aborted)
        setInventory({scope:slug,phase:"error",data:[],message:
          error instanceof Error?error.message:"Authorized skill inventory unavailable."});
    });
    return ()=>controller.abort();
  },[slug,refresh]);

  const live=inventory.scope===slug?inventory:EMPTY;
  const selectedQuery=query.trim().toLocaleLowerCase();
  const matches=useMemo(()=>(live.data||[]).filter(item=>
    !selectedQuery||[item.name,item.id,item.team,item.owner,item.repo,item.description]
      .some(value=>String(value??"").toLocaleLowerCase().includes(selectedQuery))
  ).slice(0,MAX_VISIBLE),[live.data,selectedQuery]);
  const library=buildTenantAwareAppPath(pathname,"/skills") as Route;
  const workflow=buildTenantAwareAppPath(pathname,"/workflows") as Route;

  return <div className={styles.page}>
    <UiV2PageHeader eyebrow="Workspace / Workbench" title="Workbench"
      description="Select an indexed skill to inspect its Git-owned instructions, references, evaluations and declared dependencies."
      actions={<button className={styles.button} type="button" onClick={()=>setRefresh(x=>x+1)}>
        Refresh skills
      </button>}/>
    <div className={styles.tabs} role="navigation" aria-label="Workbench areas">
      <span aria-current="page">Skill workbench</span>
      <Link href={workflow}>Workflow Studio</Link>
    </div>
    <section className={styles.selection} aria-labelledby="workbench-select-title">
      <div className={styles.intro}>
        <h2 id="workbench-select-title">Choose a skill</h2>
        <p>Nothing is loaded until you select an authorized skill. Selecting a skill opens its
          Git-backed editor; no changes are written without an explicit reviewed proposal.</p>
      </div>
      <label className={styles.searchLabel} htmlFor="sv2-workbench-skill-query">
        Search indexed skills
      </label>
      <input id="sv2-workbench-skill-query" className={styles.search} type="search"
        autoComplete="off" value={query} role="combobox" aria-controls="sv2-workbench-skills"
        aria-expanded={expanded} aria-autocomplete="list"
        onFocus={()=>setExpanded(true)}
        onChange={event=>{setQuery(event.target.value);setExpanded(true);}}
        onKeyDown={event=>{if(event.key==="Escape")setExpanded(false);}} 
        placeholder="Search by skill, owner, repository, or purpose…"/>
      {live.phase==="loading"?<p role="status" className={styles.muted}>
        Loading your workspace's indexed skills…</p>:
        live.phase==="error"?<UiV2StateBanner state="unavailable" label={live.message}/>:
        live.data.length===0?<UiV2EmptyState
          message="No indexed skills are available yet. Connect and synchronize a Git repository in Library."/>:
        expanded?<div className={styles.options} id="sv2-workbench-skills" role="listbox"
          aria-label="Authorized indexed skills">
          {matches.length===0?<p className={styles.muted}>No skills match this search.</p>:
          matches.map(item=><Link key={item.skillUuid} className={styles.option} role="option"
            aria-selected="false" href={buildSkillDetailPath(pathname,item) as Route}>
            <strong>{item.name}</strong>
            <small>Tier {item.tier} · {item.repo} · {item.channel}</small>
            {item.description?<span>{item.description}</span>:null}
          </Link>)}
          {live.data.length>MAX_VISIBLE?<p className={styles.muted}>
            Showing up to {MAX_VISIBLE} matches. Narrow the search to find a specific skill.
          </p>:null}
        </div>:<button type="button" className={styles.button}
          onClick={()=>setExpanded(true)}>Browse {live.data.length} authorized skills</button>}
    </section>
    <section className={styles.empty} aria-label="Workbench empty state">
      <div className={styles.emptyArt} aria-hidden="true"><span>SKILL.md</span><span>references/</span><span>evaluations/</span></div>
      <h2>No skill selected</h2>
      <p>Select a skill above to load its verified source tree and context.
        Workflow specifications are authored separately in Workflow Studio.
        Dependencies and execution telemetry are identified by their actual evidence source.</p>
      <div className={styles.links}><Link href={library}>Open Library</Link><Link href={workflow}>Open Workflow Studio</Link></div>
    </section>
  </div>;
}
