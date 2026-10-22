"use client";

import type {ChangeProposal,RepositoryListItem} from "@savant/types";
import {useEffect,useRef,useState,type KeyboardEvent} from "react";
import Link from "next/link";
import type {Route} from "next";

import {fetchRepositoryList} from "@/lib/control-plane-client";
import {importCatalogSkill} from "@/lib/git-connections-client";
import {eligibleCatalogImportRepositories,initialCatalogImportRepositoryId,canProposeCatalogImport} from "@/lib/ui-v2-catalog-import";
import {buildTenantAppPath} from "@/lib/tenant-paths";
import {SkillProposalNotice} from "./skill-assessment-findings";
import styles from "./catalog-import-dialog.module.css";

type ImportTarget={id:string;name:string;verdict:string};
type RepositoryState=
 |{status:"loading";data:readonly RepositoryListItem[];error:null}
 |{status:"ready";data:readonly RepositoryListItem[];error:null}
 |{status:"error";data:readonly RepositoryListItem[];error:string};
const empty:RepositoryState={status:"loading",data:[],error:null};

/** An explicit tenant-scoped proposal flow, not a direct push or an install.
 * The API independently validates owner permissions, origin, repo authorization,
 * upstream safety, path and branch protections before any Git PR is created. */
export function CatalogImportDialog({skill,workspaceSlug,onClose}:{
 skill:ImportTarget;workspaceSlug:string;onClose:()=>void;
}){
 const [repositories,setRepositories]=useState<RepositoryState>(empty);
 const [selectedId,setSelectedId]=useState("");
 const [targetRoot,setTargetRoot]=useState("");
 const [owner,setOwner]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [proposal,setProposal]=useState<ChangeProposal|null>(null);
 const [retry,setRetry]=useState(0);
 const closeRef=useRef<HTMLButtonElement>(null);
 const dialogRef=useRef<HTMLElement>(null);
 const ownedRef=useRef(true);
 const requestRef=useRef(false);

 useEffect(()=>{
   ownedRef.current=true;
   const prior=document.activeElement instanceof HTMLElement?document.activeElement:null;
   closeRef.current?.focus();
   return ()=>{ownedRef.current=false;prior?.focus();};
 },[]);
 useEffect(()=>{
   const controller=new AbortController();
   queueMicrotask(()=>{if(!controller.signal.aborted){
     setRepositories(empty);setSelectedId("");setError(null);
   }});
   void fetchRepositoryList({workspaceSlug,signal:controller.signal})
     .then(response=>{
       if(controller.signal.aborted)return;
       const data=eligibleCatalogImportRepositories(response.data);
       setRepositories({status:"ready",data,error:null});
       // Multiple destinations always require a conscious selection.
       setSelectedId(initialCatalogImportRepositoryId(data));
     }).catch(caught=>{
       if(!controller.signal.aborted)setRepositories({status:"error",data:[],
         error:caught instanceof Error?caught.message:"Repository inventory unavailable."});
     });
   return ()=>controller.abort();
 },[workspaceSlug,retry]);

 async function propose(){
   if(requestRef.current||!ownedRef.current||!canProposeCatalogImport({repositories:repositories.data,repositoryId:selectedId,verdict:skill.verdict,loading:busy||repositories.status!=="ready",proposalExists:Boolean(proposal)}))return;
   requestRef.current=true;setBusy(true);setError(null);
   try{
     const data=await importCatalogSkill(skill.id,{
       repositoryId:selectedId,
       ...(targetRoot.trim()?{targetRoot:targetRoot.trim()}:{}),
       ...(owner.trim()?{owner:owner.trim()}:{}),
     });
     if(ownedRef.current)setProposal(data.data.proposal);
   }catch(caught){
     if(ownedRef.current)setError(caught instanceof Error?caught.message:"Import proposal could not be created.");
   }finally{requestRef.current=false;if(ownedRef.current)setBusy(false);}
 }
 function onKeyDown(event:KeyboardEvent){
   if(event.key==="Escape"&&!busy){event.preventDefault();onClose();return;}
   if(event.key!=="Tab"||!dialogRef.current)return;
   const focusable=[...dialogRef.current.querySelectorAll<HTMLElement>(
     'button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href]'
   )].filter(el=>el.getClientRects().length>0);
   if(!focusable.length)return;
   if(event.shiftKey&&document.activeElement===focusable[0]){
     event.preventDefault();focusable.at(-1)?.focus();
   }else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){
     event.preventDefault();focusable[0]?.focus();
   }
 }
 const canPropose=canProposeCatalogImport({repositories:repositories.data,repositoryId:selectedId,
   verdict:skill.verdict,loading:busy||repositories.status!=="ready",proposalExists:Boolean(proposal)});
 return <div className={styles.scrim} onMouseDown={e=>{
   if(e.target===e.currentTarget&&!busy)onClose();
 }}>
   <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true"
     aria-labelledby="catalog-import-title" aria-describedby="catalog-import-description"
     onKeyDown={onKeyDown}>
     <header className={styles.header}>
       <div><h2 id="catalog-import-title">Import skill to your repository</h2>
         <p id="catalog-import-description"><strong>{skill.name}</strong> ·
           Submit a reviewed Git proposal. Nothing is pushed to your repository until
           its review and pull-request workflow is completed.</p></div>
       <button ref={closeRef} type="button" className="btn btn-ghost btn-sm"
         disabled={busy} aria-label="Close import dialog" onClick={onClose}>Close</button>
     </header>
     {skill.verdict==="unsafe"?<p className={styles.error} role="alert">
       This skill is classified unsafe and cannot be imported.</p>:null}
     {repositories.status==="loading"?<p role="status">Checking authorized repositories…</p>:
       repositories.status==="error"?<div role="alert" className={styles.error}>
         <p>Repository list unavailable: {repositories.error}</p>
         <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setRetry(x=>x+1)}>Retry</button>
       </div>:repositories.data.length===0?<div className={styles.empty}>
         <p>No connected, enabled repositories were returned for this workspace.</p>
         <Link href={buildTenantAppPath(workspaceSlug,"/repositories") as Route}
           onClick={onClose}>Connect a repository</Link>
       </div>:<>
       <label className={styles.field}>
         <span>Destination Git repository <strong aria-hidden="true">*</strong></span>
         <select className="input" value={selectedId}
           onChange={e=>{setSelectedId(e.target.value);setError(null);}}
           disabled={busy||Boolean(proposal)} required>
           <option value="">Choose a repository</option>
           {repositories.data.map(item=><option key={item.id} value={item.id}>
             {item.name} · {item.provider} · {item.branch}</option>)}
         </select>
       </label>
       <details className={styles.advanced}>
         <summary>Optional import location and owner</summary>
         <label className={styles.field}>Target path
           <input className="input" value={targetRoot}
             onChange={e=>setTargetRoot(e.target.value)}
             disabled={busy||Boolean(proposal)} placeholder="Automatic: tier2/imported/source/skill"/>
         </label>
         <label className={styles.field}>Owner
           <input className="input" value={owner} onChange={e=>setOwner(e.target.value)}
             disabled={busy||Boolean(proposal)} placeholder="Optional responsible team"/>
         </label>
       </details>
       <p className={styles.disclaimer}>The import includes source files, provenance
         metadata and applicable evaluation assets. An authorized reviewer must approve
         the proposal and open a Git pull request. The destination repository controls
         merging, validation and release.</p>
       <button type="button" className="btn btn-primary"
         disabled={!canPropose} onClick={()=>void propose()}>
         {busy?"Preparing reviewed proposal…":"Create import proposal"}
       </button>
     </>}
     {error?<p role="alert" className={styles.error}>{error}</p>:null}
     {proposal?<div className={styles.proposal} role="status">
       <strong>Proposal created — not merged or installed.</strong>
       <SkillProposalNotice proposal={proposal} onUpdated={setProposal}/>
     </div>:null}
   </section>
 </div>;
}
