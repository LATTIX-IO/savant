"use client";

import type {ReactNode} from "react";
import {UiV2Status} from "@/components/savant/ui-v2";
import styles from "./operational-admin-v2.module.css";

/** PER-1607: operator-facing ROADMAP only. No auth/egress or role grants. */
export function ProviderConnectionGuide({testAction,executorLabel}:{
 testAction:ReactNode;executorLabel:string|null;
}){
 return <section className={styles.providerGuide} aria-label="Provider connection architecture">
  <div className={styles.providerGuideGrid}>
   <section className={styles.providerGuideCard} aria-labelledby="sv2-test-inference">
    <header className={styles.providerGuideHeader}>
     <div><small>QUALITY ENGINEERING</small><h3 id="sv2-test-inference">Test inference provider</h3></div>
     <UiV2Status state={executorLabel?"warning":"unavailable"}
      label={executorLabel?"OpenAI test default recorded":"Test provider not verified"}/>
    </header>
    <p className={styles.note}>Evaluate pinned skill versions with an independently budgeted model.
      Existing Test Bench permits workspace OpenAI credentials or platform NIM,
      and a separate platform JEV judge. Configuration metadata is not proof
      of provider-backed test execution.</p>
    {executorLabel?<p className={styles.note}>Recorded workspace test default: <strong>{executorLabel}</strong></p>:null}
    <div className={styles.providerGuideActions}>
     {testAction}
     <button type="button" disabled className={styles.control}
      aria-describedby="sv2-account-auth-note">Continue with ChatGPT</button>
     <button type="button" disabled className={styles.control}
      aria-describedby="sv2-account-auth-note">Connect Claude Code runtime</button>
    </div>
    <p className={styles.note} id="sv2-account-auth-note">Planned sign-in only.
      ChatGPT plan-backed inference requires approved scopes and commercial partner
      enablement. An unmodified Claude Code runtime may allow the end user to
      authenticate directly; Savant cannot proxy Claude.ai subscription OAuth.</p>
    <UiV2Status state="planned" label="No provider account OAuth active"/>
   </section>
   <section className={styles.providerGuideCard} aria-labelledby="sv2-prod-inference">
    <header className={styles.providerGuideHeader}>
     <div><small>ORGANIZATION DEPLOYMENT</small>
      <h3 id="sv2-prod-inference">Production / enterprise inference provider</h3></div>
     <UiV2Status state="unavailable" label="No production binding configured"/>
    </header>
    <p className={styles.note}>Serve authorized workspace users through a separately
      governed provider organization, project, model, workload identity and
      budget. Do not reuse evaluation credentials. ChatGPT Enterprise or Claude
      Enterprise identity does not automatically grant Savant API inference or
      include API billing.</p>
    <button type="button" disabled className={styles.control}
     aria-describedby="sv2-production-auth-note">Connect enterprise inference</button>
    <p id="sv2-production-auth-note" className={styles.note}>Planned: server-enforced
      production profile and provider-authorized authentication. OpenAI API
      projects and Anthropic workload federation remain separate from chat SSO.</p>
    <UiV2Status state="planned" label="Server-side roles · PER-1602"/>
   </section>
  </div>
  <section className={styles.providerGuideEnterprise} aria-labelledby="sv2-org-connectors">
   <div><small>PROVIDER-NATIVE WORKSPACES</small>
    <h3 id="sv2-org-connectors">Enterprise connectors and organization telemetry</h3>
    <p className={styles.note}>An admin may eventually install Savant in ChatGPT/Codex
      or Claude through a consented MCP/plugin connector. Separate compliance
      APIs may expose permitted organization activity. Both are different
      from Savant calling the provider for inference.</p></div>
   <button type="button" disabled className={styles.control}
    aria-describedby="sv2-org-connectors-note">Authorize enterprise workspace</button>
   <p id="sv2-org-connectors-note" className={styles.note}>
    Planned: requires provider admin setup, separate consent and verified scopes.
    This button neither installs a connector nor starts OAuth.</p>
  </section>
  <details className={styles.providerGuideDeveloper}>
   <summary>Developer notes · future provider connection contract</summary>
   <div className={styles.providerGuideDetails}>
    <p>Keep test executor, test judge, production inference, provider-to-Savant
      MCP access, and enterprise compliance ingestion independently authorized.
      Pin tenant, acting principal, model, role, token ownership, source SHA,
      billing attribution and revocation server-side. Never harvest CLI login tokens.</p>
    <p>OpenAI Enterprise SSO is not API execution consent. Claude Enterprise-managed
      MCP authorization runs Claude → Savant; workload identity federation is a
      separate Savant → Claude API path. No production credential can silently
      substitute for evaluation credentials.</p>
    <a target="_blank" rel="noopener noreferrer"
     href="https://github.com/LATTIX-IO/savant/blob/main/docs/architecture/adr-0025-enterprise-provider-connection-boundaries.md">
     ADR-0025 · design and vendor prerequisites</a>
    <a target="_blank" rel="noopener noreferrer" href="https://linear.app/lattix/issue/PER-1602">
     PER-1602 · enforced execution profiles</a>
    <a target="_blank" rel="noopener noreferrer" href="https://linear.app/lattix/issue/PER-1603">
     PER-1603 · account and enterprise authorization</a>
   </div>
  </details>
 </section>;
}
