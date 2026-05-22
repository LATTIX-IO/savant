"use client";

import type {
  AIConnectionStatus,
  AIConnectionSummary,
  PublicAuthProviderSettings,
  WorkspaceBillingSettings,
  WorkspaceGeneralSettings,
  WorkspaceNotificationSettings,
  WorkspaceSecuritySettings,
  WorkspaceSettingsPayload,
} from "@savant/types";
import { useState, type CSSProperties, type ReactNode } from "react";

import type { AuthViewer } from "@/lib/auth0-session";

type SectionId =
  | "general"
  | "auth"
  | "ai"
  | "members"
  | "security"
  | "notifications"
  | "billing";

const SECTIONS: { id: SectionId; label: string; sub: string }[] = [
  { id: "general", label: "General", sub: "Org identity & defaults" },
  { id: "auth", label: "Authentication", sub: "SSO, IdP, MFA" },
  { id: "ai", label: "AI providers", sub: "BYO models & key routing" },
  { id: "members", label: "Members", sub: "Users & groups" },
  { id: "security", label: "Security", sub: "Keys, audit retention" },
  { id: "notifications", label: "Notifications", sub: "Alerts & subscriptions" },
  { id: "billing", label: "Billing", sub: "Plan & usage" },
];

export function SettingsScreen({
  viewer,
  settings,
}: {
  viewer: AuthViewer;
  settings: WorkspaceSettingsPayload;
}) {
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
            Configuration for the {settings.general.workspaceName} workspace, backed by current auth, membership,
            and AI connection metadata.
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
                  cursor: "pointer",
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
          {section === "general" && <GeneralSection settings={settings.general} />}
          {section === "auth" && <AuthSection viewer={viewer} settings={settings.authentication} />}
          {section === "ai" && <AIProvidersSection connections={settings.aiConnections} />}
          {section === "members" && <MembersSection members={settings.members} />}
          {section === "security" && <SecuritySection settings={settings.security} />}
          {section === "notifications" && <NotificationsSection settings={settings.notifications} />}
          {section === "billing" && <BillingSection settings={settings.billing} />}
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
  readOnly,
  style,
}: {
  defaultValue: string;
  mono?: boolean;
  readOnly?: boolean;
  style?: CSSProperties;
}) {
  return (
    <input
      defaultValue={defaultValue}
      readOnly={readOnly}
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
          background: "var(--glass-toggle-knob)",
          boxShadow: "var(--glass-toggle-knob-shadow)",
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

function displayOrFallback(value: string | null, fallback = "Not configured"): string {
  return value ?? fallback;
}

function formatProviderLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "azure-openai") return "Azure OpenAI";
  return provider;
}

function formatList(values: string[]): string {
  return values.join(" · ");
}

function formatCapabilities(connection: AIConnectionSummary): string {
  if (connection.supportsExecution && connection.supportsJudging) {
    return "Execution + judging";
  }

  if (connection.supportsExecution) {
    return "Execution";
  }

  if (connection.supportsJudging) {
    return "Judging";
  }

  return "Inactive";
}

function AuthStatusChip({ status }: { status: PublicAuthProviderSettings["status"] }) {
  if (status === "configured") {
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        configured · Auth0
      </span>
    );
  }

  if (status === "development-bypass") {
    return (
      <span className="chip chip-brass">
        <span className="dot" />
        development bypass
      </span>
    );
  }

  return <span className="chip chip-paper">not configured</span>;
}

function AIConnectionStatusChip({ status }: { status: AIConnectionStatus }) {
  if (status === "active") {
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        active
      </span>
    );
  }

  if (status === "needs-rotation") {
    return (
      <span className="chip chip-brass">
        <span className="dot" />
        rotate soon
      </span>
    );
  }

  return (
    <span className="chip chip-blood">
      <span className="dot" />
      revoked
    </span>
  );
}

function GeneralSection({ settings }: { settings: WorkspaceGeneralSettings }) {
  return (
    <>
      <SettingsPanel title="Workspace" sub="Identity used across releases, audit, and signed bundles.">
        <FormRow label="Workspace name" sub="Shown in the top bar and on release bundles.">
          <TextInput defaultValue={settings.workspaceName} />
        </FormRow>
        <FormRow label="Workspace slug" sub="Stable identifier used across control-plane records.">
          <TextInput defaultValue={settings.workspaceSlug} mono readOnly />
        </FormRow>
        <FormRow label="Subdomain" sub="The Savant-managed workspace hostname prefix.">
          <div className="row" style={{ gap: 6 }}>
            <TextInput
              defaultValue={settings.subdomain}
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
          <select defaultValue={String(settings.defaultTier)} style={selectStyle}>
            <option value="1">Tier 1 — strict</option>
            <option value="2">Tier 2 — standard</option>
            <option value="3">Tier 3 — lightweight</option>
          </select>
        </FormRow>
        <FormRow label="Time zone" sub="Used for audit timestamps and release windows.">
          <select defaultValue={settings.timeZone} style={selectStyle}>
            <option value="America / New York">America / New York</option>
            <option value="America / Los Angeles">America / Los Angeles</option>
            <option value="Europe / London">Europe / London</option>
            <option value="UTC">UTC</option>
          </select>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Defaults" sub="Apply to newly created skills unless overridden.">
        <FormRow
          label="Approval requirement"
          sub="Number of approvers required for production release."
        >
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue={String(settings.approvalRequirement)} mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              + compliance for Tier 1
            </span>
          </div>
        </FormRow>
        <FormRow label="Staging burn-in" sub="Required time in staging before production promotion.">
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue={String(settings.stagingBurnInHours)} mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              hours
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval suite required" sub="Block release if no eval suite is attached.">
          <Toggle on={settings.requireEvalSuite} />
        </FormRow>
      </SettingsPanel>
    </>
  );
}

function AuthSection({
  viewer,
  settings,
}: {
  viewer: AuthViewer;
  settings: PublicAuthProviderSettings;
}) {
  return (
    <>
      <SettingsPanel
        title="Auth0 web application"
        sub="Official Next.js SDK integration with server-side sessions and hosted Universal Login."
        actions={<AuthStatusChip status={settings.status} />}
      >
        <FormRow label="Current session" sub="The currently resolved user in this browser session.">
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className={`chip ${viewer.isAuthenticated ? "chip-moss" : "chip-paper"}`}>
              <span className="dot" />
              {viewer.isAuthenticated ? "authenticated" : "guest"}
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{viewer.displayName}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {viewer.email ?? viewer.subtitle}
            </span>
          </div>
        </FormRow>
        <FormRow label="Provider" sub="Currently active identity provider.">
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className="chip chip-paper" style={{ height: 26, padding: "0 10px", fontSize: 11 }}>
              Auth0 · Regular Web Application
            </span>
            <a href="/auth/login" className="btn btn-sm">
              Test login
            </a>
            <a href="/auth/login?screen_hint=signup" className="btn btn-sm">
              Test signup
            </a>
            <a href="/auth/logout" className="btn btn-sm">
              Logout
            </a>
          </div>
        </FormRow>
        <FormRow label="Tenant domain" sub="Matches the Auth0 tenant configured for this workspace.">
          <TextInput defaultValue={displayOrFallback(settings.tenantDomain)} mono readOnly />
        </FormRow>
        <FormRow label="Client ID" sub="Safe for browser-side redirects; keep the client secret server-side only.">
          <TextInput defaultValue={displayOrFallback(settings.clientId)} mono readOnly />
        </FormRow>
        <FormRow
          label="Application type"
          sub="Auth0 should be configured as a confidential regular web application."
        >
          <span className="chip chip-paper" style={{ height: 26, padding: "0 10px", fontSize: 11 }}>
            {settings.applicationType}
          </span>
        </FormRow>
        <FormRow label="Base URL" sub="Must match the origin currently allowed in your Auth0 application.">
          <TextInput defaultValue={displayOrFallback(settings.appBaseUrl)} mono readOnly />
        </FormRow>
        <FormRow label="Callback URL" sub="Registered in Auth0 under Allowed Callback URLs.">
          <TextInput defaultValue={displayOrFallback(settings.callbackUrl)} mono readOnly />
        </FormRow>
        <FormRow label="Logout URL" sub="Registered in Auth0 under Allowed Logout URLs.">
          <TextInput defaultValue={displayOrFallback(settings.logoutUrl)} mono readOnly />
        </FormRow>
        <FormRow
          label="Token auth method"
          sub="The installed Auth0 Next.js SDK uses client_secret_post for confidential clients with a client secret."
        >
          <span className="chip chip-paper" style={{ height: 26, padding: "0 10px", fontSize: 11 }}>
            {settings.tokenEndpointAuthMethod}
          </span>
        </FormRow>
        <FormRow
          label="Session mode"
          sub="Authentication happens on the server with encrypted cookies managed by the SDK."
        >
          <span className="chip chip-paper" style={{ height: 26, padding: "0 10px", fontSize: 11 }}>
            {settings.sessionMode}
          </span>
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

function AIProvidersSection({ connections }: { connections: AIConnectionSummary[] }) {
  const defaultExecution = connections.find((connection) => connection.isDefaultExecution) ?? null;
  const defaultJudge = connections.find((connection) => connection.isDefaultJudge) ?? null;

  return (
    <>
      <SettingsPanel
        title="Bring-your-own AI connections"
        sub="Tenant-scoped provider credentials used for evaluation execution, judging, and recommendation generation."
        actions={
          <button type="button" className="btn btn-sm">
            Connect provider
          </button>
        }
      >
        <div className="note" style={{ marginBottom: 14 }}>
          <span className="n-icon">🔐</span>
          <div>
            Raw API keys stay in external secret storage. Savant stores only metadata, stable UUIDs, usage history, and rotation posture.
          </div>
        </div>

        <div
          className="panel-bd tight"
          style={{ margin: "0 calc(-1 * var(--pad-card))", borderTop: "1px solid var(--rule)" }}
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>Connection</th>
                <th>Default model</th>
                <th>Capabilities</th>
                <th>Scope</th>
                <th>Secret store</th>
                <th>Rotation</th>
                <th style={{ textAlign: "right" }}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => (
                <tr key={connection.aiConnectionUuid}>
                  <td>
                    <div className="tbl-name-text">
                      <span className="pri">{connection.label}</span>
                      <span className="sec mono">
                        {formatProviderLabel(connection.provider)} · {connection.aiConnectionUuid}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="chip chip-paper">{connection.defaultModel}</span>
                  </td>
                  <td>
                    <div className="col" style={{ gap: 4 }}>
                      <AIConnectionStatusChip status={connection.status} />
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {formatCapabilities(connection)}
                      </span>
                    </div>
                  </td>
                  <td className="muted">{connection.usageScope}</td>
                  <td className="muted">{connection.secretStore}</td>
                  <td className="subtle">{connection.lastRotated}</td>
                  <td className="subtle" style={{ textAlign: "right" }}>
                    {connection.lastUsed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsPanel>

      <SettingsPanel title="Default model routing" sub="Execution and judging defaults used when a run does not override the provider.">
        <FormRow label="Execution default" sub="Primary model used to run baseline and candidate skill invocations.">
          <div className="col" style={{ gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
              {defaultExecution ? `${defaultExecution.label} · ${defaultExecution.defaultModel}` : "No default execution provider"}
            </span>
            {defaultExecution ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                {defaultExecution.purpose}
              </span>
            ) : null}
          </div>
        </FormRow>
        <FormRow label="Judge default" sub="Model used for rubric scoring and grounded recommendation generation.">
          <div className="col" style={{ gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
              {defaultJudge ? `${defaultJudge.label} · ${defaultJudge.defaultModel}` : "No default judge provider"}
            </span>
            {defaultJudge ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                {defaultJudge.purpose}
              </span>
            ) : null}
          </div>
        </FormRow>
      </SettingsPanel>
    </>
  );
}

function MembersSection({ members }: { members: WorkspaceSettingsPayload["members"] }) {
  return (
    <SettingsPanel
      title="Members"
      sub={`${members.filter((m) => m.status === "active").length} active members, ${members.filter((m) => m.status === "off-boarded").length} off-boarded.`}
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
            {members.map((m) => (
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

function SecuritySection({ settings }: { settings: WorkspaceSecuritySettings }) {
  return (
    <>
      <SettingsPanel title="Encryption keys" sub="Skill bundles are signed before distribution.">
        <FormRow label="Bundle signing key" sub="Ed25519 keypair. Rotate every 90 days.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {settings.bundleSigningKeyRef}
            </span>
            <span className="subtle" style={{ fontSize: 11 }}>
              rotated {settings.bundleSigningKeyLastRotated}
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
          <Toggle on={settings.customerManagedKey} />
        </FormRow>
        <FormRow label="Key vault" sub="External secret store for connector credentials.">
          <select defaultValue={settings.keyVaultProvider} style={{ ...selectStyle, minWidth: 220 }}>
            <option value="HashiCorp Vault">HashiCorp Vault</option>
            <option value="AWS KMS">AWS KMS</option>
            <option value="Azure Key Vault">Azure Key Vault</option>
            <option value="GCP KMS">GCP KMS</option>
          </select>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Audit & retention" sub="How long governance events are kept.">
        <FormRow label="Audit log retention">
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue={String(settings.auditRetentionYears)} mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              years (minimum)
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval result retention">
          <div className="row" style={{ gap: 8 }}>
            <TextInput defaultValue={String(settings.evalRetentionDays)} mono style={{ width: 64 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              days
            </span>
          </div>
        </FormRow>
        <FormRow label="Stream to SIEM" sub="Forward audit events to your security information system.">
          <Toggle on={settings.streamToSiem} />
        </FormRow>
      </SettingsPanel>
    </>
  );
}

function NotificationsSection({ settings }: { settings: WorkspaceNotificationSettings }) {
  return (
    <SettingsPanel title="Subscriptions" sub="Where governance events are surfaced.">
      <FormRow
        label="Approval requested"
        sub="Notify the reviewer when a candidate is submitted for approval."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={settings.approvalRequestedChannels.length > 0} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {formatList(settings.approvalRequestedChannels)}
          </span>
        </div>
      </FormRow>
      <FormRow
        label="Regression detected"
        sub="Notify the skill owner when an eval run flags a regression."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={settings.regressionDetectedChannels.length > 0} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {formatList(settings.regressionDetectedChannels)}
          </span>
        </div>
      </FormRow>
      <FormRow
        label="Rollback executed"
        sub="Notify platform admins on any production rollback."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={settings.rollbackExecutedChannels.length > 0} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {formatList(settings.rollbackExecutedChannels)}
          </span>
        </div>
      </FormRow>
      <FormRow label="Policy violation blocked" sub="Notify when a policy prevents an action.">
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={settings.policyViolationChannels.length > 0} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {formatList(settings.policyViolationChannels)}
          </span>
        </div>
      </FormRow>
      <FormRow
        label="Weekly summary"
        sub="Friday summary of approvals, releases, and regressions."
      >
        <div className="row" style={{ gap: 6 }}>
          <Toggle on={settings.weeklySummaryEnabled} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {formatList(settings.weeklySummaryChannels)}
          </span>
        </div>
      </FormRow>
    </SettingsPanel>
  );
}

function BillingSection({ settings }: { settings: WorkspaceBillingSettings }) {
  return (
    <>
      <SettingsPanel title="Plan" sub={`${settings.planName} · annual`}>
        <FormRow label="Current plan">
          <div className="row" style={{ gap: 10 }}>
            <span className="chip chip-ink">{settings.planName}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              Renews {settings.renewalDate}
            </span>
          </div>
        </FormRow>
        <FormRow label="Skills included" sub="Annual contract.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              {settings.skillsIncluded}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              · {settings.activeSkills} active · {settings.skillsIncluded - settings.activeSkills} remaining
            </span>
          </div>
        </FormRow>
        <FormRow label="Seats" sub="Members with edit / approve permissions.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              {settings.includedSeats}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              · {settings.usedSeats} in use · {settings.includedSeats - settings.usedSeats} remaining
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval compute · monthly cap">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              {settings.evalRunCapMonthly.toLocaleString()}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              runs · {settings.evalRunsUsedMonthly.toLocaleString()} used this month
            </span>
          </div>
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Usage · last 30 days" sub="Audit-visible activity counted toward plan limits.">
        <div className="kpi-strip" style={{ borderRadius: 4 }}>
          <div className="kpi">
            <div className="kpi-label">Eval runs</div>
            <div className="kpi-value num">
              {(settings.evalRunsUsedMonthly / 1000).toFixed(2)}
              <span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
            </div>
            <div className="kpi-trend">
              {Math.round((settings.evalRunsUsedMonthly / settings.evalRunCapMonthly) * 100)}% of cap
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Distributions</div>
            <div className="kpi-value num">
              {(settings.distributionsMonthly / 1000).toFixed(0)}
              <span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
            </div>
            <div className="kpi-trend">unlimited</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Storage</div>
            <div className="kpi-value num">
              {settings.storageGbUsed}
              <span style={{ fontSize: 16, color: "var(--muted)" }}>GB</span>
            </div>
            <div className="kpi-trend">of {settings.storageGbCap} GB</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">API calls</div>
            <div className="kpi-value num">
              {(settings.apiCallsMonthly / 1000).toFixed(0)}
              <span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
            </div>
            <div className="kpi-trend up">▲ {settings.apiCallsDeltaPct}%</div>
          </div>
        </div>
      </SettingsPanel>
    </>
  );
}
