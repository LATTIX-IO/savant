"use client";
import { useEffect, useState } from "react";
import { extractWorkspaceSlugFromPathname } from "@/lib/tenant-paths";
import {
  ArtifactPolicyClientError, describeArtifactPolicy, listArtifactPolicies,
  makeArtifactPolicyScope, postArtifactPolicyMutation,
  type ArtifactPolicyList, type ArtifactPolicyRule,
} from "@/lib/artifact-policy-client";
type Kind="skill"|"workflow_spec";
type Effect="allow"|"deny";
type PrincipalType="user"|"group"|"role";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safeError(error:unknown):string {
  if(error instanceof ArtifactPolicyClientError) {
    if([401,403,404].includes(error.status))return "Not authorized to inspect this artifact or repository.";
    if(error.status===409)return "Policy changed since it was loaded. Reload before editing.";
    if(error.status===503)return "Policy administration is unavailable. No changes were made.";
    return `Policy request failed (${error.code}).`;
  }
  return "Policy request failed. No changes were made.";
}
/** Explicit, admin-authorized artifact inspector. Never fetches source content. */
export function RepositoryArtifactPolicyInspector({repositoryId}:{repositoryId:string}) {
  const [kind,setKind]=useState<Kind>("skill");
  const [artifactId,setArtifactId]=useState("");
  const [scopeKey,setScopeKey]=useState("");
  const [snapshot,setSnapshot]=useState<ArtifactPolicyList|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [effect,setEffect]=useState<Effect>("deny");
  const [principalType,setPrincipalType]=useState<PrincipalType>("role");
  const [principalRef,setPrincipalRef]=useState("member");
  const [saving,setSaving]=useState(false);
  const [revisionToken,setRevisionToken]=useState(0);
  useEffect(()=>{const id=window.setTimeout(()=>{setSnapshot(null);setScopeKey("");setError("");},0);return ()=>window.clearTimeout(id);},[repositoryId,kind,artifactId]);
  useEffect(()=>{
    if(!scopeKey)return;
    const controller=new AbortController();
    const id=window.setTimeout(()=>setLoading(true),0);
    const slug=extractWorkspaceSlugFromPathname(window.location.pathname);
    if(!slug){const timer=window.setTimeout(()=>{setError("Select a workspace to inspect artifact policies.");setSnapshot(null);setLoading(false);},0);return ()=>{clearTimeout(timer);clearTimeout(id);};}
    const [repository,scopeKind,artifact]=scopeKey.split("|");
    if(repository!==repositoryId||!scopeKind||!artifact){clearTimeout(id);return;}
    let active=true;
    try{
      const scope=makeArtifactPolicyScope(repository,scopeKind,artifact);
      void listArtifactPolicies(scope,slug,fetch,controller.signal).then(result=>{
        if(active){setSnapshot(result);setError("");}
      }).catch(err=>{
        if(active&&!controller.signal.aborted){setSnapshot(null);setError(safeError(err));}
      }).finally(()=>{if(active)setLoading(false);});
    }catch(err){const timer=window.setTimeout(()=>{setSnapshot(null);setError(safeError(err));setLoading(false);},0);return ()=>{clearTimeout(timer);clearTimeout(id);};}
    return ()=>{active=false;controller.abort();clearTimeout(id);};
  },[scopeKey,repositoryId,revisionToken]);
  const expectedKey=`${repositoryId}|${kind}|${artifactId.trim()}`;
  const ready=Boolean(snapshot)&&scopeKey===expectedKey&&!loading&&!error&&!saving;
  async function change(operation:"grant"|"revoke",rule?:ArtifactPolicyRule) {
    if(!snapshot||!ready)return;
    const slug=extractWorkspaceSlugFromPathname(window.location.pathname);
    if(!slug)return;
    const principal=rule??{effect,principalType,principalRef};
    if(operation==="revoke"&&!window.confirm("Revoke this artifact read rule? This change is immediate."))return;
    try {
      const scope=makeArtifactPolicyScope(repositoryId,kind,artifactId.trim());
      if(principal.principalType!=="role"&&!UUID.test(principal.principalRef)){setError("Enter a tenant-local UUID for this principal.");return;}
      setSaving(true);
      await postArtifactPolicyMutation(scope,{operation,effect:principal.effect,principalType:principal.principalType,principalRef:principal.principalRef,requestId:crypto.randomUUID()},snapshot.revision,slug);
      setSnapshot(null);
      setRevisionToken(value=>value+1);
    } catch(err){
      setSnapshot(null);setError(safeError(err));
      if(err instanceof ArtifactPolicyClientError&&err.status===409)setRevisionToken(value=>value+1);
    }finally{setSaving(false);}
  }
  return <section aria-label="Artifact read policy" className="col" style={{gap:12}}>
    <div className="row between"><h3 className="h3">Artifact read policy</h3><span className="chip chip-paper">Admin only</span></div>
    <p className="muted" style={{fontSize:12}}>Inspect explicit read restrictions for one skill or workflow specification. Authorization is enforced server-side; this does not change Git access.</p>
    <div className="col" style={{gap:8}}>
      <label htmlFor="artifact-policy-kind" className="eyebrow">Artifact kind</label>
      <select id="artifact-policy-kind" value={kind} onChange={event=>setKind(event.target.value as Kind)} className="input">
        <option value="skill">Skill</option><option value="workflow_spec">Workflow specification</option>
      </select>
      <label htmlFor="artifact-policy-id" className="eyebrow">Artifact identifier</label>
      <input id="artifact-policy-id" className="input" maxLength={128} value={artifactId} placeholder="e.g. review/quality" onChange={event=>setArtifactId(event.target.value)}/>
      <button type="button" className="btn btn-sm" disabled={!artifactId.trim()||loading||saving} onClick={()=>{setSnapshot(null);setError("");setScopeKey(expectedKey);setRevisionToken(x=>x+1);}}>Inspect rules</button>
    </div>
    <div role="status" aria-live="polite" className="muted" style={{fontSize:12}}>
      {loading?"Loading policy…":saving?"Applying policy change…":error||(!snapshot?"Choose an artifact and inspect its rules.":`Policy revision ${snapshot.revision} · ${snapshot.rules.length} rule(s)`)}
    </div>
    {snapshot&&scopeKey===expectedKey&&!error?<div className="col" style={{gap:8}}>
      <p className="muted" style={{fontSize:12}}>{describeArtifactPolicy(snapshot.rules)}</p>
      <ul style={{paddingLeft:18}}>
        {snapshot.rules.map(rule=><li key={rule.id} style={{fontSize:12,marginBottom:8}}>
          <strong>{rule.effect.toUpperCase()}</strong> · {rule.principalType}: <code>{rule.principalRef}</code>{" "}
          <button className="btn btn-ghost btn-sm" disabled={!ready} type="button" onClick={()=>void change("revoke",rule)}>Revoke</button>
        </li>)}
      </ul>
      <div className="col" style={{gap:6}}>
        <label className="eyebrow" htmlFor="policy-effect">Effect</label>
        <select className="input" id="policy-effect" value={effect} onChange={e=>setEffect(e.target.value as Effect)}><option value="deny">Deny</option><option value="allow">Allow</option></select>
        <label className="eyebrow" htmlFor="policy-principal-type">Principal type</label>
        <select className="input" id="policy-principal-type" value={principalType} onChange={e=>{const type=e.target.value as PrincipalType;setPrincipalType(type);setPrincipalRef(type==="role"?"member":"");}}>
          <option value="role">Member role</option><option value="user">User UUID</option><option value="group">Group UUID</option>
        </select>
        {principalType!=="role"?<><label className="eyebrow" htmlFor="policy-principal-ref">Principal UUID</label>
          <input className="input" id="policy-principal-ref" value={principalRef} onChange={e=>setPrincipalRef(e.target.value)} placeholder="Tenant-local UUID"/></>:null}
        <button type="button" className="btn btn-primary btn-sm" disabled={!ready||(principalType!=="role"&&!UUID.test(principalRef))} onClick={()=>void change("grant")}>Add read rule</button>
      </div>
    </div>:null}
  </section>;
}
