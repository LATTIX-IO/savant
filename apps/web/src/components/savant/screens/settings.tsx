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
import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

import type { AuthViewer } from "@/lib/auth0-session";
import {
  getVisibleSettingsSectionIds,
  type SettingsSectionId,
} from "@/lib/workspace-features";
import {
  createAIConnection,
  fetchAIConnections,
  revokeAIConnection,
  rotateAIConnection,
  setAIConnectionDefaults,
} from "@/lib/control-plane-client";

const SECTIONS: { id: SettingsSectionId; label: string; sub: string }[] = [
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
  const [section, setSection] = useState<SettingsSectionId>("general");
  const visibleSections = getVisibleSettingsSectionIds().map((id) => SECTIONS.find((section) => section.id === id)!).filter(Boolean);
  const activeSection = visibleSections.some((visibleSection) => visibleSection.id === section)
    ? section
    : visibleSections[0]?.id ?? "general";

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
            {visibleSections.map((s) => (
              <div
                key={s.id}
                onClick={() => setSection(s.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: activeSection === s.id ? "var(--moss-soft)" : "transparent",
                  transition: "background 100ms var(--ease)",
                  position: "relative",
                }}
              >
                {activeSection === s.id && (
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
                    fontWeight: activeSection === s.id ? 500 : 450,
                    color: activeSection === s.id ? "var(--ink)" : "var(--ink-2)",
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
          {activeSection === "general" && <GeneralSection settings={settings.general} />}
          {activeSection === "auth" && <AuthSection viewer={viewer} settings={settings.authentication} />}
          {activeSection === "ai" && (
            <AIProvidersSection
              viewer={viewer}
              members={settings.members}
              connections={settings.aiConnections}
            />
          )}
          {activeSection === "members" && <MembersSection members={settings.members} />}
          {activeSection === "security" && <SecuritySection settings={settings.security} />}
          {activeSection === "notifications" && <NotificationsSection settings={settings.notifications} />}
          {activeSection === "billing" && <BillingSection settings={settings.billing} />}
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
  value,
  mono,
  onChange,
  placeholder,
  readOnly,
  style,
  type,
}: {
  defaultValue?: string;
  value?: string;
  mono?: boolean;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  style?: CSSProperties;
  type?: "text" | "password" | "url";
}) {
  return (
    <input
      defaultValue={defaultValue}
      value={value}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      placeholder={placeholder}
      readOnly={readOnly}
      type={type ?? "text"}
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
  if (provider === "openai-compatible") return "OpenAI-compatible";
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

function formatOptionalMetricValue(
  value: number | null,
  options?: {
    compactThousands?: boolean;
    suffix?: string;
    decimals?: number;
  },
): ReactNode {
  if (value == null) {
    return <span className="muted">—</span>;
  }

  if (options?.compactThousands) {
    const compactValue = value / 1000;
    const decimals = options.decimals ?? (compactValue >= 10 ? 0 : 2);

    return (
      <>
        {compactValue.toFixed(decimals)}
        <span style={{ fontSize: 16, color: "var(--muted)" }}>k</span>
      </>
    );
  }

  return (
    <>
      {value.toLocaleString()}
      {options?.suffix ? <span style={{ fontSize: 16, color: "var(--muted)" }}>{options.suffix}</span> : null}
    </>
  );
}

function buildBillingCycleLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/[_-]+/g, " ");
}

function buildBillingStatusLabel(settings: WorkspaceBillingSettings): string {
  if (
    settings.renewalDate.toLowerCase().startsWith("stripe sync") ||
    settings.renewalDate.toLowerCase().includes("awaiting billing")
  ) {
    return settings.renewalDate;
  }

  return `Renews ${settings.renewalDate}`;
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

type AIConnectionCreateFormState = {
  provider: string;
  label: string;
  defaultModel: string;
  purpose: string;
  usageScope: string;
  apiKey: string;
  allowedModels: string;
  supportsExecution: boolean;
  supportsJudging: boolean;
  isDefaultExecution: boolean;
  isDefaultJudge: boolean;
  baseUrl: string;
  apiVersion: string;
};

type AIConnectionRotateFormState = {
  apiKey: string;
  defaultModel: string;
  purpose: string;
  usageScope: string;
  allowedModels: string;
  baseUrl: string;
  apiVersion: string;
};

type AIConnectionFeedback = {
  kind: "success" | "error";
  message: string;
};

const AI_PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
];

function createEmptyAIConnectionForm(): AIConnectionCreateFormState {
  return {
    provider: "openai",
    label: "",
    defaultModel: "",
    purpose: "",
    usageScope: "",
    apiKey: "",
    allowedModels: "",
    supportsExecution: true,
    supportsJudging: true,
    isDefaultExecution: true,
    isDefaultJudge: false,
    baseUrl: "",
    apiVersion: "",
  };
}

function createRotateAIConnectionForm(connection: AIConnectionSummary): AIConnectionRotateFormState {
  return {
    apiKey: "",
    defaultModel: connection.defaultModel,
    purpose: connection.purpose,
    usageScope: connection.usageScope,
    allowedModels: "",
    baseUrl: "",
    apiVersion: "",
  };
}

function createEmptyRotateAIConnectionForm(): AIConnectionRotateFormState {
  return {
    apiKey: "",
    defaultModel: "",
    purpose: "",
    usageScope: "",
    allowedModels: "",
    baseUrl: "",
    apiVersion: "",
  };
}

function sortAIConnections(connections: AIConnectionSummary[]): AIConnectionSummary[] {
  return [...connections].sort((left, right) => {
    if (left.status === "revoked" && right.status !== "revoked") {
      return 1;
    }

    if (left.status !== "revoked" && right.status === "revoked") {
      return -1;
    }

    if (left.isDefaultExecution !== right.isDefaultExecution) {
      return left.isDefaultExecution ? -1 : 1;
    }

    if (left.isDefaultJudge !== right.isDefaultJudge) {
      return left.isDefaultJudge ? -1 : 1;
    }

    return left.label.localeCompare(right.label);
  });
}

function toOptionalTrimmedValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseAllowedModels(value: string): string[] | undefined {
  const models = value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return models.length > 0 ? models : undefined;
}

function isWorkspaceAdminRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

function canViewerManageAIConnections(
  viewer: AuthViewer,
  members: WorkspaceSettingsPayload["members"],
): boolean {
  if (!viewer.isAuthenticated || !viewer.email) {
    return false;
  }

  const member = members.find((candidate) => candidate.email.toLowerCase() === viewer.email?.toLowerCase());
  return member ? isWorkspaceAdminRole(member.role) : false;
}

function AIManagementAccessChip({ canManage }: { canManage: boolean }) {
  return canManage
    ? (
      <span className="chip chip-moss">
        <span className="dot" />
        admin access
      </span>
    )
    : <span className="chip chip-paper">view only</span>;
}

function AIManagementFeedback({ feedback }: { feedback: AIConnectionFeedback | null }) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className="note"
      style={{
        marginBottom: 14,
        borderColor: feedback.kind === "error" ? "rgba(130, 40, 40, 0.2)" : undefined,
      }}
    >
      <span className="n-icon">{feedback.kind === "error" ? "⚠️" : "✅"}</span>
      <div>{feedback.message}</div>
    </div>
  );
}

function AIConnectionFlag({ children }: { children: ReactNode }) {
  return (
    <span className="chip chip-paper" style={{ height: 24, padding: "0 8px", fontSize: 10.5 }}>
      {children}
    </span>
  );
}

function AIConnectionFormCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
        color: disabled ? "var(--ink-3)" : "var(--ink-2)",
      }}
    >
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function GeneralSection({ settings }: { settings: WorkspaceGeneralSettings }) {
  return (
    <>
      <SettingsPanel title="Workspace" sub="Identity used across releases, audit, and signed bundles.">
        <FormRow label="Workspace name" sub="Shown in the top bar and on release bundles.">
          <TextInput defaultValue={settings.workspaceName} />
        </FormRow>
        <FormRow label="Workspace slug" sub="Stable identifier used across control-plane records and tenant routing.">
          <TextInput defaultValue={settings.workspaceSlug} mono readOnly />
        </FormRow>
        <FormRow label="Workspace URL" sub="Canonical path-based tenant URL reserved on Savant.">
          <TextInput defaultValue={settings.workspaceUrl} mono readOnly />
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
            <a href="/signin" className="btn btn-sm">
              Test login
            </a>
            <a href="/signup" className="btn btn-sm">
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

function AIProvidersSection({
  viewer,
  members,
  connections,
}: {
  viewer: AuthViewer;
  members: WorkspaceSettingsPayload["members"];
  connections: AIConnectionSummary[];
}) {
  const [aiConnections, setAIConnections] = useState<AIConnectionSummary[]>(() => sortAIConnections(connections));
  const [createForm, setCreateForm] = useState<AIConnectionCreateFormState>(() => createEmptyAIConnectionForm());
  const [rotateForm, setRotateForm] = useState<AIConnectionRotateFormState>(() => createEmptyRotateAIConnectionForm());
  const [isCreateOpen, setCreateOpen] = useState(connections.length === 0);
  const [rotateConnectionId, setRotateConnectionId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AIConnectionFeedback | null>(null);
  const canManage = canViewerManageAIConnections(viewer, members);

  const defaultExecution = aiConnections.find((connection) => connection.isDefaultExecution) ?? null;
  const defaultJudge = aiConnections.find((connection) => connection.isDefaultJudge) ?? null;
  const rotatingConnection = aiConnections.find((connection) => connection.aiConnectionUuid === rotateConnectionId) ?? null;

  async function refreshConnections(successMessage?: string) {
    const response = await fetchAIConnections();
    setAIConnections(sortAIConnections(response.data));

    if (successMessage) {
      setFeedback({ kind: "success", message: successMessage });
    }
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage || busyAction) {
      return;
    }

    if (!createForm.supportsExecution && !createForm.supportsJudging) {
      setFeedback({
        kind: "error",
        message: "Choose at least one capability before saving an AI connection.",
      });
      return;
    }

    setBusyAction("create");
    setFeedback(null);

    try {
      await createAIConnection({
        provider: createForm.provider,
        label: createForm.label.trim(),
        defaultModel: createForm.defaultModel.trim(),
        purpose: createForm.purpose.trim(),
        usageScope: createForm.usageScope.trim(),
        apiKey: createForm.apiKey,
        allowedModels: parseAllowedModels(createForm.allowedModels),
        supportsExecution: createForm.supportsExecution,
        supportsJudging: createForm.supportsJudging,
        isDefaultExecution: createForm.supportsExecution ? createForm.isDefaultExecution : false,
        isDefaultJudge: createForm.supportsJudging ? createForm.isDefaultJudge : false,
        baseUrl: toOptionalTrimmedValue(createForm.baseUrl),
        apiVersion: toOptionalTrimmedValue(createForm.apiVersion),
      });

      setCreateForm(createEmptyAIConnectionForm());
      setCreateOpen(false);
      await refreshConnections("AI connection saved. The secret stayed server-side the whole time.");
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the AI connection.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefresh() {
    if (busyAction) {
      return;
    }

    setBusyAction("refresh");
    setFeedback(null);

    try {
      await refreshConnections("AI connection metadata refreshed.");
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not refresh AI connections.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSetDefault(connection: AIConnectionSummary, mode: "execution" | "judge") {
    if (!canManage || busyAction) {
      return;
    }

    setBusyAction(`${mode}:${connection.aiConnectionUuid}`);
    setFeedback(null);

    try {
      await setAIConnectionDefaults(connection.aiConnectionUuid, {
        setAsExecutionDefault: mode === "execution",
        setAsJudgeDefault: mode === "judge",
      });
      await refreshConnections(
        mode === "execution"
          ? `${connection.label} is now the default execution model.`
          : `${connection.label} is now the default judge model.`,
      );
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not update the default AI routing.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevoke(connection: AIConnectionSummary) {
    if (!canManage || busyAction) {
      return;
    }

    const confirmed = window.confirm(
      `Revoke ${connection.label}? Existing eval runs keep their historical metadata, but the connection will stop accepting new work.`,
    );
    if (!confirmed) {
      return;
    }

    setBusyAction(`revoke:${connection.aiConnectionUuid}`);
    setFeedback(null);

    try {
      await revokeAIConnection(connection.aiConnectionUuid, {
        reason: "Revoked from workspace settings.",
      });
      if (rotateConnectionId === connection.aiConnectionUuid) {
        setRotateConnectionId(null);
      }
      await refreshConnections(`${connection.label} was revoked.`);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not revoke the AI connection.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handleOpenRotate(connection: AIConnectionSummary) {
    if (!canManage || connection.status === "revoked") {
      return;
    }

    if (rotateConnectionId === connection.aiConnectionUuid) {
      setRotateConnectionId(null);
      setRotateForm(createEmptyRotateAIConnectionForm());
      return;
    }

    setRotateConnectionId(connection.aiConnectionUuid);
    setRotateForm(createRotateAIConnectionForm(connection));
    setFeedback(null);
  }

  async function handleRotateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage || !rotateConnectionId || busyAction) {
      return;
    }

    setBusyAction(`rotate:${rotateConnectionId}`);
    setFeedback(null);

    try {
      await rotateAIConnection(rotateConnectionId, {
        apiKey: rotateForm.apiKey,
        defaultModel: toOptionalTrimmedValue(rotateForm.defaultModel),
        purpose: toOptionalTrimmedValue(rotateForm.purpose),
        usageScope: toOptionalTrimmedValue(rotateForm.usageScope),
        allowedModels: parseAllowedModels(rotateForm.allowedModels),
        baseUrl: toOptionalTrimmedValue(rotateForm.baseUrl),
        apiVersion: toOptionalTrimmedValue(rotateForm.apiVersion),
      });

      setRotateConnectionId(null);
      setRotateForm(createEmptyRotateAIConnectionForm());
      await refreshConnections("AI connection secret rotated.");
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not rotate the AI connection secret.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <SettingsPanel
        title="Bring-your-own AI connections"
        sub="Tenant-scoped provider credentials used for evaluation execution, judging, and recommendation generation."
        actions={(
          <>
            <AIManagementAccessChip canManage={canManage} />
            <button type="button" className="btn btn-sm" disabled={busyAction === "refresh"} onClick={handleRefresh}>
              {busyAction === "refresh" ? "Refreshing…" : "Refresh"}
            </button>
            {canManage ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busyAction !== null && busyAction !== "create"}
                onClick={() => {
                  setCreateOpen((open) => !open);
                  setFeedback(null);
                }}
              >
                {isCreateOpen ? "Close form" : "Connect provider"}
              </button>
            ) : null}
          </>
        )}
      >
        <div className="note" style={{ marginBottom: 14 }}>
          <span className="n-icon">🔐</span>
          <div>
            Raw API keys stay in Savant&apos;s encrypted server-side vault. The workspace settings view only shows metadata,
            stable UUIDs, usage history, and rotation posture.
          </div>
        </div>

        <AIManagementFeedback feedback={feedback} />

        {!canManage ? (
          <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
            You can review provider metadata here, but only workspace owners or members of <span className="mono">platform-admins</span>
            can add, rotate, default, or revoke BYO-AI connections.
          </div>
        ) : null}

        {isCreateOpen && canManage ? (
          <form onSubmit={handleCreateSubmit}>
            <div style={{ borderTop: "1px solid var(--rule)", marginBottom: 8 }}>
              <FormRow label="Provider" sub="Pick the managed provider or a standards-compatible endpoint.">
                <select
                  onChange={(event) => {
                    const provider = event.target.value;
                    setCreateForm((current) => ({ ...current, provider }));
                  }}
                  style={selectStyle}
                  value={createForm.provider}
                >
                  {AI_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Display label" sub="Human-friendly name shown in routing and audit views.">
                <TextInput
                  onChange={(value) => setCreateForm((current) => ({ ...current, label: value }))}
                  placeholder="Production GPT-4.1"
                  value={createForm.label}
                />
              </FormRow>
              <FormRow label="Default model" sub="Default model identifier used when a run does not override it.">
                <TextInput
                  onChange={(value) => setCreateForm((current) => ({ ...current, defaultModel: value }))}
                  placeholder="gpt-4.1"
                  value={createForm.defaultModel}
                />
              </FormRow>
              <FormRow label="Purpose" sub="Why this provider exists in the workspace.">
                <TextInput
                  onChange={(value) => setCreateForm((current) => ({ ...current, purpose: value }))}
                  placeholder="Primary execution provider"
                  value={createForm.purpose}
                />
              </FormRow>
              <FormRow label="Usage scope" sub="Describe which jobs or environments should use it.">
                <TextInput
                  onChange={(value) => setCreateForm((current) => ({ ...current, usageScope: value }))}
                  placeholder="Production evaluations"
                  value={createForm.usageScope}
                />
              </FormRow>
              <FormRow label="API key" sub="Submitted once to the server and stored only as encrypted ciphertext.">
                <TextInput
                  onChange={(value) => setCreateForm((current) => ({ ...current, apiKey: value }))}
                  placeholder="sk-…"
                  type="password"
                  value={createForm.apiKey}
                />
              </FormRow>
              <FormRow label="Allowed models" sub="Optional allow-list. Separate items with commas or new lines.">
                <textarea
                  onChange={(event) => setCreateForm((current) => ({ ...current, allowedModels: event.target.value }))}
                  placeholder="gpt-4.1, gpt-4.1-mini"
                  style={{
                    width: "100%",
                    maxWidth: 420,
                    minHeight: 72,
                    padding: 10,
                    border: "1px solid var(--rule-2)",
                    borderRadius: 4,
                    fontSize: 13,
                    outline: "none",
                    background: "var(--panel)",
                    resize: "vertical",
                  }}
                  value={createForm.allowedModels}
                />
              </FormRow>
              <FormRow label="Capabilities" sub="Controls which routing lanes this provider can serve.">
                <div className="col" style={{ gap: 10 }}>
                  <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                    <AIConnectionFormCheckbox
                      checked={createForm.supportsExecution}
                      label="Supports execution"
                      onChange={(checked) => {
                        setCreateForm((current) => ({
                          ...current,
                          supportsExecution: checked,
                          isDefaultExecution: checked ? current.isDefaultExecution : false,
                        }));
                      }}
                    />
                    <AIConnectionFormCheckbox
                      checked={createForm.supportsJudging}
                      label="Supports judging"
                      onChange={(checked) => {
                        setCreateForm((current) => ({
                          ...current,
                          supportsJudging: checked,
                          isDefaultJudge: checked ? current.isDefaultJudge : false,
                        }));
                      }}
                    />
                  </div>
                  <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                    <AIConnectionFormCheckbox
                      checked={createForm.isDefaultExecution}
                      disabled={!createForm.supportsExecution}
                      label="Make execution default"
                      onChange={(checked) => setCreateForm((current) => ({ ...current, isDefaultExecution: checked }))}
                    />
                    <AIConnectionFormCheckbox
                      checked={createForm.isDefaultJudge}
                      disabled={!createForm.supportsJudging}
                      label="Make judge default"
                      onChange={(checked) => setCreateForm((current) => ({ ...current, isDefaultJudge: checked }))}
                    />
                  </div>
                </div>
              </FormRow>
              <FormRow label="Advanced endpoint" sub="Required for OpenAI-compatible endpoints; optional for Azure/OpenAI variants.">
                <div className="col" style={{ gap: 10, maxWidth: 420 }}>
                  <TextInput
                    onChange={(value) => setCreateForm((current) => ({ ...current, baseUrl: value }))}
                    placeholder={createForm.provider === "openai-compatible" ? "https://model.example.com/v1" : "Optional base URL override"}
                    type="url"
                    value={createForm.baseUrl}
                  />
                  <TextInput
                    onChange={(value) => setCreateForm((current) => ({ ...current, apiVersion: value }))}
                    placeholder="Optional API version"
                    value={createForm.apiVersion}
                  />
                </div>
              </FormRow>
            </div>

            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busyAction === "create"}
                onClick={() => {
                  setCreateForm(createEmptyAIConnectionForm());
                  setCreateOpen(false);
                  setFeedback(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busyAction === "create"}>
                {busyAction === "create" ? "Saving…" : "Save connection"}
              </button>
            </div>
          </form>
        ) : null}

        {aiConnections.length === 0 ? (
          <div
            style={{
              borderTop: "1px solid var(--rule)",
              paddingTop: 14,
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            No BYO-AI connections are configured for this workspace yet. Add a provider connection before running
            in-platform evaluations or recommendation jobs.
          </div>
        ) : (
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
                  <th>Actions</th>
                  <th style={{ textAlign: "right" }}>Last used</th>
                </tr>
              </thead>
              <tbody>
                {aiConnections.map((connection) => (
                  <tr key={connection.aiConnectionUuid}>
                    <td>
                      <div className="tbl-name-text" style={{ gap: 6 }}>
                        <span className="pri">{connection.label}</span>
                        <span className="sec mono">
                          {formatProviderLabel(connection.provider)} · {connection.aiConnectionUuid}
                        </span>
                        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          {connection.isDefaultExecution ? <AIConnectionFlag>Execution default</AIConnectionFlag> : null}
                          {connection.isDefaultJudge ? <AIConnectionFlag>Judge default</AIConnectionFlag> : null}
                        </div>
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
                        <td>
                          {canManage ? (
                            <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              {connection.supportsExecution && !connection.isDefaultExecution ? (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={busyAction === `execution:${connection.aiConnectionUuid}`}
                                  onClick={() => handleSetDefault(connection, "execution")}
                                >
                                  {busyAction === `execution:${connection.aiConnectionUuid}` ? "Saving…" : "Set exec default"}
                                </button>
                              ) : null}
                              {connection.supportsJudging && !connection.isDefaultJudge ? (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={busyAction === `judge:${connection.aiConnectionUuid}`}
                                  onClick={() => handleSetDefault(connection, "judge")}
                                >
                                  {busyAction === `judge:${connection.aiConnectionUuid}` ? "Saving…" : "Set judge default"}
                                </button>
                              ) : null}
                              {connection.status !== "revoked" ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busyAction === `rotate:${connection.aiConnectionUuid}`}
                                    onClick={() => handleOpenRotate(connection)}
                                  >
                                    {rotateConnectionId === connection.aiConnectionUuid ? "Close rotate" : "Rotate"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={busyAction === `revoke:${connection.aiConnectionUuid}`}
                                    onClick={() => handleRevoke(connection)}
                                  >
                                    {busyAction === `revoke:${connection.aiConnectionUuid}` ? "Revoking…" : "Revoke"}
                                  </button>
                                </>
                              ) : (
                                <span className="subtle" style={{ fontSize: 11.5 }}>Archived</span>
                              )}
                            </div>
                          ) : (
                            <span className="subtle" style={{ fontSize: 11.5 }}>View only</span>
                          )}
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

            {rotatingConnection && canManage ? (
              <form onSubmit={handleRotateSubmit} style={{ borderTop: "1px solid var(--rule)", marginTop: 14 }}>
                <FormRow
                  label={`Rotate ${rotatingConnection.label}`}
                  sub="Submit a new secret without ever revealing the stored value back to the browser."
                >
                  <div className="col" style={{ gap: 10, maxWidth: 420 }}>
                    <TextInput
                      onChange={(value) => setRotateForm((current) => ({ ...current, apiKey: value }))}
                      placeholder="Paste the replacement API key"
                      type="password"
                      value={rotateForm.apiKey}
                    />
                    <TextInput
                      onChange={(value) => setRotateForm((current) => ({ ...current, defaultModel: value }))}
                      placeholder="Default model"
                      value={rotateForm.defaultModel}
                    />
                    <TextInput
                      onChange={(value) => setRotateForm((current) => ({ ...current, purpose: value }))}
                      placeholder="Purpose"
                      value={rotateForm.purpose}
                    />
                    <TextInput
                      onChange={(value) => setRotateForm((current) => ({ ...current, usageScope: value }))}
                      placeholder="Usage scope"
                      value={rotateForm.usageScope}
                    />
                    <textarea
                      onChange={(event) => setRotateForm((current) => ({ ...current, allowedModels: event.target.value }))}
                      placeholder="Optional allow-list update (comma or newline separated)"
                      style={{
                        width: "100%",
                        minHeight: 72,
                        padding: 10,
                        border: "1px solid var(--rule-2)",
                        borderRadius: 4,
                        fontSize: 13,
                        outline: "none",
                        background: "var(--panel)",
                        resize: "vertical",
                      }}
                      value={rotateForm.allowedModels}
                    />
                    <TextInput
                      onChange={(value) => setRotateForm((current) => ({ ...current, baseUrl: value }))}
                      placeholder="Optional base URL override"
                      type="url"
                      value={rotateForm.baseUrl}
                    />
                    <TextInput
                      onChange={(value) => setRotateForm((current) => ({ ...current, apiVersion: value }))}
                      placeholder="Optional API version"
                      value={rotateForm.apiVersion}
                    />
                    <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busyAction === `rotate:${rotatingConnection.aiConnectionUuid}`}
                        onClick={() => {
                          setRotateConnectionId(null);
                          setRotateForm(createEmptyRotateAIConnectionForm());
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={busyAction === `rotate:${rotatingConnection.aiConnectionUuid}`}
                      >
                        {busyAction === `rotate:${rotatingConnection.aiConnectionUuid}` ? "Rotating…" : "Rotate secret"}
                      </button>
                    </div>
                  </div>
                </FormRow>
              </form>
            ) : null}
            </table>
          </div>
        )}
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
  const remainingSkills = settings.skillsIncluded != null
    ? Math.max(settings.skillsIncluded - settings.activeSkills, 0)
    : null;
  const remainingSeats = Math.max(settings.includedSeats - settings.usedSeats, 0);
  const hasUsageMetering = (
    settings.evalRunsUsedMonthly != null ||
    settings.distributionsMonthly != null ||
    settings.storageGbUsed != null ||
    settings.apiCallsMonthly != null
  );

  return (
    <>
      <SettingsPanel
        title="Plan"
        sub={[settings.planName, buildBillingCycleLabel(settings.billingCycle)].filter(Boolean).join(" · ") || settings.planName}
      >
        <FormRow label="Current plan">
          <div className="row" style={{ gap: 10 }}>
            <span className="chip chip-ink">{settings.planName}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {buildBillingStatusLabel(settings)}
            </span>
          </div>
        </FormRow>
        <FormRow label="Skills included" sub="Annual contract.">
          {settings.skillsIncluded == null ? (
            <span className="muted" style={{ fontSize: 12 }}>
              Contract skill cap is not sourced from live billing data yet. {settings.activeSkills} active skills are indexed today.
            </span>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <span className="mono num" style={{ fontSize: 13 }}>
                {settings.skillsIncluded}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                · {settings.activeSkills} active · {remainingSkills} remaining
              </span>
            </div>
          )}
        </FormRow>
        <FormRow label="Seats" sub="Members with edit / approve permissions.">
          <div className="row" style={{ gap: 8 }}>
            <span className="mono num" style={{ fontSize: 13 }}>
              {settings.includedSeats}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              · {settings.usedSeats} in use · {remainingSeats} remaining
            </span>
          </div>
        </FormRow>
        <FormRow label="Eval compute · monthly cap">
          {settings.evalRunCapMonthly == null || settings.evalRunsUsedMonthly == null ? (
            <span className="muted" style={{ fontSize: 12 }}>
              Live monthly evaluation usage metering is not available yet.
            </span>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <span className="mono num" style={{ fontSize: 13 }}>
                {settings.evalRunCapMonthly.toLocaleString()}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                runs · {settings.evalRunsUsedMonthly.toLocaleString()} used this month
              </span>
            </div>
          )}
        </FormRow>
      </SettingsPanel>

      <SettingsPanel title="Usage · last 30 days" sub="Audit-visible activity counted toward plan limits.">
        {!hasUsageMetering ? (
          <div className="note">
            <span className="n-icon">ℹ️</span>
            <div>
              Live billing usage metering has not been wired for eval runs, distributions, storage, or API traffic yet,
              so Savant now leaves those values unset instead of showing placeholder totals.
            </div>
          </div>
        ) : (
          <div className="kpi-strip" style={{ borderRadius: 4 }}>
            <div className="kpi">
              <div className="kpi-label">Eval runs</div>
              <div className="kpi-value num">
                {formatOptionalMetricValue(settings.evalRunsUsedMonthly, { compactThousands: true, decimals: 2 })}
              </div>
              <div className="kpi-trend">
                {settings.evalRunCapMonthly != null && settings.evalRunsUsedMonthly != null
                  ? `${Math.round((settings.evalRunsUsedMonthly / settings.evalRunCapMonthly) * 100)}% of cap`
                  : "Live cap unavailable"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Distributions</div>
              <div className="kpi-value num">
                {formatOptionalMetricValue(settings.distributionsMonthly, { compactThousands: true, decimals: 0 })}
              </div>
              <div className="kpi-trend">
                {settings.distributionsMonthly != null ? "Live monthly total" : "Live metering unavailable"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Storage</div>
              <div className="kpi-value num">
                {formatOptionalMetricValue(settings.storageGbUsed, { suffix: "GB" })}
              </div>
              <div className="kpi-trend">
                {settings.storageGbUsed != null && settings.storageGbCap != null
                  ? `of ${settings.storageGbCap} GB`
                  : "Live storage cap unavailable"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">API calls</div>
              <div className="kpi-value num">
                {formatOptionalMetricValue(settings.apiCallsMonthly, { compactThousands: true, decimals: 0 })}
              </div>
              <div className={`kpi-trend${settings.apiCallsDeltaPct != null && settings.apiCallsDeltaPct > 0 ? " up" : ""}`}>
                {settings.apiCallsDeltaPct != null ? `▲ ${settings.apiCallsDeltaPct}%` : "Live trend unavailable"}
              </div>
            </div>
          </div>
        )}
      </SettingsPanel>
    </>
  );
}
