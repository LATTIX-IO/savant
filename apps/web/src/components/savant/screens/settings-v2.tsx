"use client";

import Link from "next/link";
import type {Route} from "next";
import {usePathname} from "next/navigation";
import {useEffect,useState,type ReactNode} from "react";
import type {WorkspaceSettingsPayload} from "@savant/types";
import { BillingPortalButton } from "@/components/savant/billing-portal-button";
import {inspectUiV2ProviderLanes} from "@/lib/ui-v2-provider-lanes";
import {ProviderConnectionGuide} from "./provider-connection-guide";
import {WorkspaceSetupChecklistV2} from "./workspace-setup-checklist-v2";
import {UiV2EmptyState,UiV2PageHeader,UiV2StateBanner,UiV2Status,UiV2TableViewport} from "@/components/savant/ui-v2";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import styles from "./operational-admin-v2.module.css";

type Section="setup"|"general"|"ai"|"members"|"access"|"policies"|"audit"|"billing";
const SECTIONS:readonly [Section,string][]=[
 ["setup","Setup"],["general","General"],["ai","AI providers"],["members","Members"],
 ["access","Access and roles"],["policies","Policies"],["audit","Audit log"],["billing","Billing"],
];

/** Settings is the canonical setup landing; the legacy authenticated settings
 * editor is kept behind one explicit edit affordance, not duplicated as a
 * second top-level Settings page. */
export function SettingsV2({settings,legacy}:{settings:WorkspaceSettingsPayload;legacy:ReactNode}){
 const pathname=usePathname()||"/";
 const [tab,setTab]=useState<Section>("setup");
 const [showEditor,setShowEditor]=useState(false);
 const openEditor=()=>{setTab("general");setShowEditor(true);};
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);
  const raw=params.get("section");
  const next=raw==="source-control"?"setup":raw==="providers"?"ai":raw;
  if(next&&SECTIONS.some(([id])=>id===next)){
   const timeout=window.setTimeout(()=>setTab(next as Section),0);
   return ()=>window.clearTimeout(timeout);
  }
 },[]);
 const auditHref=buildTenantAwareAppPath(pathname,"/audit") as Route;
 const policyHref=buildTenantAwareAppPath(pathname,"/policies") as Route;
 const members=settings.members;
 const executor=inspectUiV2ProviderLanes(settings.aiConnections).workspaceOpenAiExecutor;
 return <div className={styles.page}>
  <UiV2PageHeader eyebrow="Workspace / administration" title="Settings"
   description="Complete workspace setup, then manage providers, members, access, policies and billing."/>
  <div className={styles.settingsLayout}>
   <nav className={styles.sideNav} aria-label="Settings sections">
    {SECTIONS.map(([id,label])=><button key={id} type="button"
      aria-current={tab===id?"page":undefined}
      onClick={()=>setTab(id)}>{label}</button>)}
   </nav>
   <section className={styles.section} aria-label={SECTIONS.find(item=>item[0]===tab)?.[1]}>
    {tab==="setup"?<WorkspaceSetupChecklistV2/>:tab==="general"?<>
      <h2>General</h2>
      <dl className={styles.definition}>
        <dt>Workspace</dt><dd>{settings.general.workspaceName}</dd>
        <dt>Slug</dt><dd>{settings.general.workspaceSlug}</dd>
        <dt>Time zone</dt><dd>{settings.general.timeZone}</dd>
        <dt>Default skill tier</dt><dd>Tier {settings.general.defaultTier}</dd>
        <dt>Evaluation suite required</dt><dd>{settings.general.requireEvalSuite?"Yes":"No"}</dd>
        <dt>Authentication mode</dt><dd>{settings.authentication.sessionMode}</dd>
      </dl>
      <button type="button" className={styles.control} aria-expanded={showEditor}
        aria-controls="sv2-settings-editor" onClick={()=>setShowEditor(value=>!value)}>
        {showEditor?"Close governed editor":"Edit workspace settings"}
      </button>
      {showEditor?<div id="sv2-settings-editor" className={styles.legacy}>
        <UiV2StateBanner state="warning"
          label="Changes are handled by existing server-side permissions and audit controls."/>
        {legacy}
      </div>:null}
    </>:tab==="ai"?<>
      <h2>AI provider connections</h2>
      <p className={styles.note}>Test inference, production inference and enterprise workspace
        integrations are separate authorizations. Provider connections here show metadata,
        not proof of a completed evaluation call.</p>
      <ProviderConnectionGuide executorLabel={executor?.label??null}
        testAction={<button type="button" className={styles.control}
          onClick={openEditor}>Manage existing API credentials</button>}/>
    </>:tab==="members"?<>
      <h2>Members</h2>
      {members.length===0?<UiV2EmptyState message="No member records returned."/>:
      <UiV2TableViewport label="Workspace member directory"><table className={styles.table}>
        <thead><tr><th>Member</th><th>Role</th><th>Groups</th><th>Status</th></tr></thead>
        <tbody>{members.map((member,index)=><tr key={index}>
          <td>{member.name}</td><td>{member.role}</td>
          <td>{member.groups.join(", ")||"Not reported"}</td>
          <td><UiV2Status state={member.status==="active"?"ready":"warning"} label={member.status}/></td>
        </tr>)}</tbody>
      </table></UiV2TableViewport>}
      <button type="button" className={styles.control} onClick={openEditor}>
        Manage members with existing role gates
      </button>
    </>:tab==="access"?<>
      <h2>Access and roles</h2>
      <UiV2StateBanner state="planned"
        label="External SCIM identity synchronization, group mappings and effective-user checks are not verified."/>
      <p className={styles.note}>Member roles are server-sourced summaries, not an
        effective permission matrix or a grant/revoke operation.</p>
      <dl className={styles.definition}><dt>Authentication provider</dt>
        <dd>{settings.authentication.provider}</dd>
        <dt>Configuration</dt><dd>{settings.authentication.status}</dd>
        <dt>Member records</dt><dd>{members.length}</dd>
      </dl>
      <button type="button" className={styles.control} onClick={openEditor}>
        Manage membership and security controls
      </button>
    </>:tab==="policies"?<>
      <h2>Policies</h2>
      <UiV2StateBanner state="warning"
        label="Policy changes remain enforced by existing server authorization."/>
      <Link href={policyHref}>Open governed policy inventory</Link>
      <h2>Auto-Improve</h2>
      <UiV2StateBanner state="planned"
        label="Autonomous improvement policy execution is not enabled."/>
    </>:tab==="audit"?<>
      <h2>Audit log</h2>
      <Link href={auditHref}>Open recorded workspace audit events</Link>
      <p className={styles.note}>No fabricated access-sync activity is displayed.</p>
    </>:tab==="billing"?<>
      <h2>Billing</h2>
      <BillingPortalButton workspaceSlug={settings.general.workspaceSlug}/>
      <UiV2StateBanner state="warning"
        label="Billing changes and invoices require existing owner entitlements."/>
      <button type="button" className={styles.control} onClick={openEditor}>
        Open role-gated billing management
      </button>
    </>:null}
   </section>
  </div>
 </div>;
}
