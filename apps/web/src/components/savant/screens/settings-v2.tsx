"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState,type ReactNode} from "react";
import type {WorkspaceSettingsPayload} from "@savant/types";
import {inspectUiV2ProviderLanes} from "@/lib/ui-v2-provider-lanes";
import {ProviderConnectionGuide} from "./provider-connection-guide";
import {UiV2EmptyState,UiV2Metric,UiV2PageHeader,UiV2StateBanner,
 UiV2Status,UiV2TableViewport} from "@/components/savant/ui-v2";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import styles from "./operational-admin-v2.module.css";

type Section="general"|"ai"|"members"|"access"|"policies"|"audit"|"billing"|"advanced";
const SECTIONS:[Section,string][]=[
 ["general","General"],["ai","AI providers"],["members","Members"],["access","Access and roles"],
 ["policies","Policies"],["audit","Audit log"],["billing","Billing"],["advanced","Manage settings"],
];
export function SettingsV2({settings,legacy}:{settings:WorkspaceSettingsPayload;legacy:ReactNode}){
 const pathname=usePathname()||"/";
 const [tab,setTab]=useState<Section>("general");
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);
  if(params.has("section")){
   const timeout=window.setTimeout(()=>setTab("advanced"),0);
   return ()=>window.clearTimeout(timeout);
  }
 },[]);
 const auditHref=buildTenantAwareAppPath(pathname,"/audit") as Route;
 const policyHref=buildTenantAwareAppPath(pathname,"/policies") as Route;
 const integrationsHref=buildTenantAwareAppPath(pathname,"/router") as Route;
 const members=settings.members;
 const executor=inspectUiV2ProviderLanes(settings.aiConnections).workspaceOpenAiExecutor;
 return <div className={styles.page}>
  <UiV2PageHeader eyebrow="Workspace / administration" title="Settings"
   description="Identity, membership, policy, operational security and billing."/>
  <div className={styles.settingsLayout}>
   <nav className={styles.sideNav} aria-label="Settings sections">
    {SECTIONS.map(([id,label])=><button key={id} type="button" aria-current={tab===id?"page":undefined}
      onClick={()=>setTab(id)}>{label}</button>)}
   </nav>
   <section className={styles.section} aria-label={SECTIONS.find(x=>x[0]===tab)?.[1]}>
    {tab==="general"?<>
      <h2>General</h2>
      <dl className={styles.definition}>
        <dt>Workspace</dt><dd>{settings.general.workspaceName}</dd>
        <dt>Slug</dt><dd>{settings.general.workspaceSlug}</dd>
        <dt>Time zone</dt><dd>{settings.general.timeZone}</dd>
        <dt>Default skill tier</dt><dd>Tier {settings.general.defaultTier}</dd>
        <dt>Evaluation suite required</dt><dd>{settings.general.requireEvalSuite?"Yes":"No"}</dd>
        <dt>Authentication mode</dt><dd>{settings.authentication.sessionMode}</dd>
      </dl>
      <button type="button" className={styles.control} onClick={()=>setTab("advanced")}>
        Change verified workspace settings
      </button>
    </>:tab==="ai"?<>
      <h2>AI provider connections</h2>
      <p className={styles.note}>Test inference, production inference and
       enterprise workspace integrations have distinct authorizations. Planned
       actions are disabled until the provider and server-side contracts exist.</p>
      <ProviderConnectionGuide executorLabel={executor?.label??null}
       testAction={<button type="button" className={styles.control}
        onClick={()=>setTab("advanced")}>Manage existing test API credentials</button>}/>
    </>:tab==="members"?<>
      <h2>Members</h2>
      {members.length===0?<UiV2EmptyState message="No member records returned."/>:
      <UiV2TableViewport label="Workspace member directory"><table className={styles.table}>
       <thead><tr><th>Member</th><th>Role</th><th>Groups</th><th>Status</th></tr></thead>
       <tbody>{members.map((member,index)=><tr key={index}>
         <td>{member.name}</td><td>{member.role}</td><td>{member.groups.join(", ")||"Not reported"}</td>
         <td><UiV2Status state={member.status==="active"?"ready":"warning"} label={member.status}/></td>
       </tr>)}</tbody>
      </table></UiV2TableViewport>}
      <button type="button" className={styles.control} onClick={()=>setTab("advanced")}>
        Invite or manage members with existing role gates
      </button>
    </>:tab==="access"?<>
      <h2>Access and roles</h2>
      <UiV2StateBanner state="planned"
        label="External SCIM identity synchronization, group mappings and effective-user checks are not verified."/>
      <p className={styles.note}>Member roles below are server-provided workspace records.
        They are not an effective permission matrix and do not grant, revoke or reconcile authorization.</p>
      <dl className={styles.definition}><dt>Authentication provider</dt>
        <dd>{settings.authentication.provider}</dd>
        <dt>Configuration</dt><dd>{settings.authentication.status}</dd>
        <dt>Member records</dt><dd>{members.length}</dd>
      </dl>
      <button type="button" className={styles.control} onClick={()=>setTab("advanced")}>
        Manage existing membership and security controls
      </button>
    </>:tab==="policies"?<>
      <h2>Policies</h2>
      <UiV2StateBanner state="warning" label="Policy decisions and modifications remain enforced by existing server permissions."/>
      <Link href={policyHref}>Open governed policy inventory</Link>
      <h2>Auto-Improve</h2>
      <UiV2StateBanner state="planned"
        label="Autonomous improvement policy execution is not enabled in this migration."/>
    </>:tab==="audit"?<>
      <h2>Audit log</h2>
      <Link href={auditHref}>Open recorded tenant audit events and filters</Link>
      <p className={styles.note}>No local or fabricated access-sync history is displayed.</p>
    </>:tab==="billing"?<>
      <h2>Billing</h2>
      <UiV2StateBanner state="warning"
        label="Billing changes and invoice details remain subject to existing owner entitlements."/>
      <button type="button" className={styles.control} onClick={()=>setTab("advanced")}>
        Open role-gated billing management
      </button>
    </>:<div className={styles.legacy}>
      <UiV2StateBanner state="warning"
        label="Existing settings editor retains Auth0 membership, credential rotation and audited billing permissions."/>
      <Link href={integrationsHref}>Integrations</Link>
      {legacy}
    </div>}
   </section>
  </div>
 </div>;
}
