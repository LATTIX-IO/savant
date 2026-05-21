"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { MEMBERS } from "@/lib/savant-data";

type SectionId =
  | "general"
  | "auth"
  | "members"
  | "security"
  | "notifications"
  | "billing";

const SECTIONS: { id: SectionId; label: string; sub: string }[] = [
  { id: "general", label: "General", sub: "Org identity & defaults" },
  { id: "auth", label: "Authentication", sub: "SSO, IdP, MFA" },
  { id: "members", label: "Members", sub: "Users & groups" },
  { id: "security", label: "Security", sub: "Keys, audit retention" },
  { id: "notifications", label: "Notifications", sub: "Alerts & subscriptions" },
  { id: "billing", label: "Billing", sub: "Plan & usage" },
];

export function SettingsScreen() {
  const [section, setSection] = useState<SectionId>("general");

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/09</span>
            <span className="sep">—</span>
            <span>Settings</span>
          </div>
          <h1 className="h-display">Workspace settings</h1>
          <div className="page-head-sub">
            Configuration for the Wexler &amp; Hahn workspace. Changes are written to the audit log.
          </div>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: "240px minmax(0, 1fr)" }}>
        <div className="panel" style={{ position: "sticky", top: 0, padding: 8 }}>
          <div className="col" style={{ gap: 2 }}>
            {SECTIONS.map((s) => (
              <div
                key={s.id}
                onClick={() => setSection(s.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 5,
                  cursor: "default",
                  background: section === s.id ? "var(--moss-soft)" : "transparent",
                  transition: "background 100ms var(--ease)",
                  position: "relative",
                }}
              >
                {section === s.id && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 10,
                      bottom: 10,
                      width: 2,
                      background: "var(--moss)",
                    }}
                  />
                )}
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: section === s.id ? 500 : 450,
                    color: section === s.id ? "var(--ink)" : "var(--ink-2)",
                  }}
                >
                  {s.label}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                  {s.sub}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          {section === "general" && <GeneralSection />}
          {section === "auth" && <AuthSection />}
          {section === "members" && <MembersSection />}
          {section === "security" && <SecuritySection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "billing" && <BillingSection />}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  title,
  sub,
  children,
  actions,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-hd">
        <div>
          <div
            className="panel-title"
            style={{
              textTransform: "none",
              letterSpacing: 0,
              fontSize: 13.5,
              color: "var(--ink)",
              fontWeight: 500,
            }}
          >
            {title}
          </div>
          {sub && (
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              {sub}
            </div>
          )}
        </div>
        {actions && (
          <div className="row" style={{ gap: 8 }}>
            {actions}
          </div>
        )}
      </div>
      <div className="panel-bd">{children}</div>
    </div>
  );
}

function FormRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px, 220px) 1fr",
        gap: 24,
        padding: "14px 0",
        borderBottom: "1px solid var(--rule)",
        alignItems: "flex-start",
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {sub && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.4 }}>
            {sub}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function TextInput({
  defaultValue,
  mono,
  style,
}: {
  defaultValue: string;
  mono?: boolean;
  style?: CSSProperties;
}) {
  return (
    <input
      defaultValue={defaultValue}
      style={{
        width: "100%",
        maxWidth: 420,
        height: 32,
        padding: "0 10px",
        border: "1px solid var(--rule-2)",
        borderRadius: 4,
        fontSize: 13,
        outline: "none",
        background: "var(--panel)",
        fontFamily: mono ? "var(--mono)" : "inherit",
        ...style,
      }}
    />
  );
}

function Toggle({ on }: { on: boolean }) {
  const [v, setV] = useState(on);
  return (
    <button
      type="button"
      onClick={() => setV(!v)}
      style={{
        width: 34,
        height: 20,
        borderRadius: 999,
        background: v ? "var(--moss)" : "var(--rule-strong)",
        border: 0,
        position: "relative",
        transition: "background 160ms var(--ease)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: v ? 16 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--linen)",
          boxShadow: "0 1px 2px rgba(0,0,0,.15)",
          transition: "left 160ms var(--ease)",
        }}
      />
    </button>
  );
}

const selectStyle: CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid var(--rule-2)",
  borderRadius: 4,
  fontSize: 13,
  background: "var(--panel)",
  outline: "none",
  minWidth: 200,
};

function GeneralSection() {
  return (
    <>
      <SettingsPanel title="Workspace" sub="Identity used across releases, audit, and signed bundles.">
        <FormRow label="Workspace name" sub="Shown in the top bar and on release bundles.">
          <TextInput defaultValue="Wexler & Hahn" />
        </FormRow>
        <FormRow label="Subdomain" sub="The URL where Savant is served.">
          <div className="row" style={{ gap: 6 }}>
            <TextInput
              defaultValue="wexler-hahn"
              mono
              style={{ width: 200, height: 32, padding: "0 10px", borderRadius: 4 }}
            />
            <span className="mono" style={{ color: "var(--muted)", fontSize: 13 }}>
              .savant.app
            </span>
          </div>
        </FormRow>
        <FormRow
          label="Default tier"
          sub="Tier applied to skills ingested without an explicit manifest entry."
        >
          <select defaultValue="2" style={selectStyle}>
            <option value="1">Tier 1 — strict</option>
            <option value="2">Tier 2 — standard</option>
            <option value="3">Tier 3 — lightweight</option>
          </select>
        </FormRow>
        <FormRow label="Time zone" sub="Used for audit timestamps and release windows.">
          <select defaultValue="us-east" style={selectStyle}>
            <option value="us-east">America / New York</option>
            <option value="us-west">America / Los Angeles</option>
            <option value="eu">Europe / London</option>
            <option value="utc">UTC</option>
          </select>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Defaults" sub="Apply to newly created skills unless overridden.">
        <FormRow
          label="Approval requirement"
          sub="Number of approvers required for production release."
        >
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue="2" mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              + compliance for Tier 1
            </span>
          </div>
        </FormRow>
        <FormRow label="Staging burn-in" sub="Required time in staging before production promotion.">
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue="24" mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              hours
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval suite required" sub="Block release if no eval suite is attached.">
          <Toggle on={true} />
        </FormRow>
      </SettingsPanel>
    </>
  );
}

function AuthSection() {
  return (
    <>
      <SettingsPanel
        title="Single sign-on"
        sub="Identity is owned by your IdP. Group membership drives RBAC."
        actions={
          <span className="chip chip-moss">
            <span className="dot" />
            enabled · Okta
          </span>
        }
      >
        <FormRow label="Provider" sub="Currently active identity provider.">
          <div className="row" style={{ gap: 10 }}>
            <span className="chip chip-paper" style={{ height: 26, padding: "0 10px", fontSize: 11 }}>
              Okta · SAML
            </span>
            <button type="button" className="btn btn-sm">
              Change provider
            </button>
          </div>
        </FormRow>
        <FormRow label="ACS URL" sub="Configure this in your IdP application.">
          <TextInput defaultValue="https://wexler-hahn.savant.app/auth/saml/acs" mono />
        </FormRow>
        <FormRow label="Entity ID">
          <TextInput defaultValue="urn:savant:wexler-hahn" mono />
        </FormRow>
        <FormRow
          label="JIT provisioning"
          sub="Create users on first SSO sign-in if their email domain matches."
        >
          <Toggle on={true} />
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Group sync" sub="SCIM keeps Savant group membership in lockstep with your IdP.">
        <FormRow label="SCIM" sub="Last synced 12m ago. 218 members, 12 groups.">
          <div className="row" style={{ gap: 8 }}>
            <span className="chip chip-moss">
              <span className="dot" />
              active
            </span>
            <button type="button" className="btn btn-sm">
              Rotate token
            </button>
            <button type="button" className="btn btn-sm">
              Sync now
            </button>
          </div>
        </FormRow>
        <FormRow label="Synced groups" sub="Groups that map from IdP into Savant RBAC.">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {[
              "platform-admins",
              "legal-readers",
              "legal-owners",
              "eng-leads",
              "security-readers",
              "sre-oncall",
              "finance-bp",
              "se-team",
              "cs-team",
              "procurement",
              "all-employees",
            ].map((g) => (
              <span key={g} className="ref">
                {g}
              </span>
            ))}
          </div>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel
        title="Multi-factor"
        sub="Required for production releases regardless of IdP policy."
      >
        <FormRow
          label="Require MFA at release time"
          sub="Force step-up auth when promoting a skill to production."
        >
          <Toggle on={true} />
        </FormRow>
        <FormRow label="Session length" sub="Length of an authenticated session before re-auth.">
          <select defaultValue="12" style={selectStyle}>
            <option value="4">4 hours</option>
            <option value="8">8 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
          </select>
        </FormRow>
      </SettingsPanel>
    </>
  );
}

function MembersSection() {
  return (
    <SettingsPanel
      title="Members"
      sub={`${MEMBERS.filter((m) => m.status === "active").length} active members, ${MEMBERS.filter((m) => m.status === "off-boarded").length} off-boarded.`}
      actions={
        <>
          <button type="button" className="btn btn-sm">
            Invite
          </button>
          <button type="button" className="btn btn-sm">
            Manage groups
          </button>
        </>
      }
    >
      <div
        className="panel-bd tight"
        style={{ margin: "0 calc(-1 * var(--pad-card))", borderTop: "1px solid var(--rule)" }}
      >
        <table className="tbl">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Groups</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Last active</th>
            </tr>
          </thead>
          <tbody>
            {MEMBERS.map((m) => (
              <tr key={m.email}>
                <td>
                  <div className="tbl-name">
                    <span
                      className="avatar sm"
                      style={{
                        background: m.status === "off-boarded" ? "var(--rule-strong)" : "var(--moss)",
                      }}
                    >
                      {m.name
                        .split(" ")
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <div className="tbl-name-text">
                      <span className="pri">{m.name}</span>
                      <span className="sec mono">{m.email}</span>
                    </div>
                  </div>
                </td>
                <td className="muted">{m.role}</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {m.groups.length === 0 ? (
                      <span className="subtle">—</span>
                    ) : (
                      m.groups.slice(0, 2).map((g) => (
                        <span key={g} className="chip chip-paper">
                          {g}
                        </span>
                      ))
                    )}
                    {m.groups.length > 2 && (
                      <span className="subtle" style={{ fontSize: 11 }}>
                        +{m.groups.length - 2}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {m.status === "active" ? (
                    <span className="chip chip-moss">
                      <span className="dot" />
                      active
                    </span>
                  ) : (
                    <span className="chip chip-paper" style={{ color: "var(--oxblood)" }}>
                      off-boarded
                    </span>
                  )}
                </td>
                <td className="subtle" style={{ textAlign: "right" }}>
                  {m.last}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsPanel>
  );
}

function SecuritySection() {
  return (
    <>
      <SettingsPanel title="Encryption keys" sub="Skill bundles are signed before distribution.">
        <FormRow label="Bundle signing key" sub="Ed25519 keypair. Rotate every 90 days.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              ed25519-44a0…1cf2
            </span>
            <span className="subtle" style={{ fontSize: 11 }}>
              rotated 31d ago
            </span>
            <button type="button" className="btn btn-sm">
              Rotate
            </button>
          </div>
        </FormRow>
        <FormRow
          label="Customer-managed key"
          sub="Encrypt skill metadata and audit log with your own KMS key."
        >
          <Toggle on={false} />
        </FormRow>
        <FormRow label="Key vault" sub="External secret store for connector credentials.">
          <select defaultValue="vault" style={{ ...selectStyle, minWidth: 220 }}>
            <option value="vault">HashiCorp Vault</option>
            <option value="aws">AWS KMS</option>
            <option value="azure">Azure Key Vault</option>
            <option value="gcp">GCP KMS</option>
          </select>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Audit & retention" sub="How long governance events are kept.">
        <FormRow label="Audit log retention">
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue="7" mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              years (minimum)
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval result retention">
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue="365" mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              days
            </span>
          </div>
        </FormRow>
        <FormRow label="Stream to SIEM" sub="Forward audit events to your security information system.">
          <Toggle on={true} />
        </FormRow>
      </SettingsPanel>
    </>
  );
}

function NotificationsSection() {
  return (
    <SettingsPanel title="Subscriptions" sub="Where governance events are surfaced.">
      <FormRow
        label="Approval requested"
        sub="Notify the reviewer when a candidate is submitted for approval."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={true} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            Slack · Email
          </span>
        </div>
      </FormRow>
      <FormRow
        label="Regression detected"
        sub="Notify the skill owner when an eval run flags a regression."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={true} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            Slack · Linear
          </span>
        </div>
      </FormRow>
      <FormRow
        label="Rollback executed"
        sub="Notify platform admins on any production rollback."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={true} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            PagerDuty · Slack
          </span>
        </div>
      </FormRow>
      <FormRow label="Policy violation blocked" sub="Notify when a policy prevents an action.">
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={true} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            Slack
          </span>
        </div>
      </FormRow>
      <FormRow
        label="Weekly summary"
        sub="Friday summary of approvals, releases, and regressions."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={false} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            Email
          </span>
        </div>
      </FormRow>
    </SettingsPanel>
  );
}

function BillingSection() {
  return (
    <>
      <SettingsPanel title="Plan" sub="Enterprise · annual">
        <FormRow label="Current plan">
          <div className="row" style={{ gap: 10 }}>
            <span className="chip chip-ink">Enterprise</span>
            <span className="muted" style={{ fontSize: 12 }}>
              Renews 14 Mar 2027
            </span>
          </div>
        </FormRow>
        <FormRow label="Skills included" sub="Annual contract.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              500
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              · 218 active · 282 remaining
            </span>
          </div>
        </FormRow>
        <FormRow label="Seats" sub="Members with edit / approve permissions.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              50
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              · 38 in use · 12 remaining
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval compute · monthly cap">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              4,000
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              runs · 2,841 used this month
            </span>
          </div>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Usage · last 30 days" sub="Audit-visible activity counted toward plan limits.">
        <div className="kpi-strip" style={{ borderRadius: 4 }}>
          <div className="kpi">
            <div className="kpi-label">Eval runs</div>
            <div className="kpi-value num">
              2.84<span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
            </div>
            <div className="kpi-trend">71% of cap</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Distributions</div>
            <div className="kpi-value num">
              38<span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
            </div>
            <div className="kpi-trend">unlimited</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Storage</div>
            <div className="kpi-value num">
              12<span style={{ fontSize: 16, color: "var(--muted)" }}>GB</span>
            </div>
            <div className="kpi-trend">of 200 GB</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">API calls</div>
            <div className="kpi-value num">
              412<span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
            </div>
            <div className="kpi-trend up">▲ 18%</div>
          </div>
        </div>
      </SettingsPanel>
    </>
  );
}
