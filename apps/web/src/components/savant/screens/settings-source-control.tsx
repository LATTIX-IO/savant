"use client";

import type {
  DiscoveredRepository,
  GitConnectionStatus,
  GitConnectionSummary,
  GitProviderDescriptor,
  GitProviderType,
} from "@savant/types";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

import {
  connectGitManualToken,
  connectSelectedRepositories,
  disconnectGitConnection,
  fetchDiscoveredRepositories,
  fetchGitConnections,
  fetchGitProviders,
  reauthorizeGitConnection,
  startGitAuthorization,
  validateGitConnection,
} from "@/lib/git-connections-client";

type Feedback = { kind: "success" | "error" | "info"; message: string } | null;

const PROVIDER_ORDER: GitProviderType[] = ["github", "gitlab", "bitbucket", "azure"];

const ERROR_MESSAGES: Record<string, string> = {
  AUTHORIZATION_STATE_INVALID: "The authorization could not be verified (it expired, was already used, or belongs to another session). Start the connection again.",
  AUTH_REQUIRED: "The provider did not grant authorization. Try connecting again.",
  PERMISSION_DENIED: "Only organization admins can connect source control providers.",
  PROVIDER_NOT_CONFIGURED: "This provider is not configured on this Savant deployment yet.",
  TOKEN_REVOKED: "The provider reports that the authorization was revoked or the app was uninstalled.",
  PROVIDER_UNAVAILABLE: "The provider was unavailable. Try again shortly.",
};

const inputStyle: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  height: 32,
  padding: "0 10px",
  borderRadius: 5,
  border: "1px solid var(--rule)",
  background: "var(--paper, transparent)",
  color: "var(--ink)",
  fontSize: 12.5,
};

function formatRelative(value: string | null): string {
  if (!value) {
    return "never";
  }
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

function StatusChip({ status, legacy }: { status: GitConnectionStatus; legacy: boolean }) {
  if (legacy && status === "active") {
    return <span className="chip chip-brass"><span className="dot" />legacy credential</span>;
  }

  switch (status) {
    case "active":
      return <span className="chip chip-moss"><span className="dot" />connected</span>;
    case "needs_reauthorization":
      return <span className="chip chip-brass"><span className="dot" />reauthorization required</span>;
    case "revoked":
      return <span className="chip chip-blood"><span className="dot" />revoked</span>;
    case "error":
      return <span className="chip chip-blood"><span className="dot" />error</span>;
    default:
      return <span className="chip chip-paper">disconnected</span>;
  }
}

function Notice({ feedback, onDismiss }: { feedback: Feedback; onDismiss?: () => void }) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className="note"
      role={feedback.kind === "error" ? "alert" : "status"}
      style={{ marginBottom: 14, borderColor: feedback.kind === "error" ? "rgba(130, 40, 40, 0.2)" : undefined }}
    >
      <span className="n-icon">{feedback.kind === "error" ? "⚠️" : feedback.kind === "success" ? "✅" : "ℹ️"}</span>
      <div style={{ flex: 1 }}>{feedback.message}</div>
      {onDismiss && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

function Panel({ title, sub, actions, children }: { title: string; sub?: string | undefined; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-hd">
        <div>
          <div className="panel-title" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>
            {title}
          </div>
          {sub && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
        </div>
        {actions && <div className="row" style={{ gap: 8 }}>{actions}</div>}
      </div>
      <div className="panel-bd">{children}</div>
    </div>
  );
}

function readUrlParams(): { status: string | null; connectionId: string | null; error: string | null; provider: string | null; resyncing: string | null } {
  if (typeof window === "undefined") {
    return { status: null, connectionId: null, error: null, provider: null, resyncing: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    status: params.get("git_status"),
    connectionId: params.get("git_connection"),
    error: params.get("git_error"),
    provider: params.get("git_provider"),
    resyncing: params.get("git_resyncing"),
  };
}

function clearUrlParams() {
  const url = new URL(window.location.href);
  for (const key of ["git_status", "git_connection", "git_error", "git_provider", "git_resyncing"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function SourceControlSection({ canManage }: { canManage: boolean }) {
  const [providers, setProviders] = useState<GitProviderDescriptor[]>([]);
  const [connections, setConnections] = useState<GitConnectionSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerConnectionId, setPickerConnectionId] = useState<string | null>(null);
  const [selfManagedFor, setSelfManagedFor] = useState<GitProviderType | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [providerResponse, connectionResponse] = await Promise.all([fetchGitProviders(), fetchGitConnections()]);
      setProviders(providerResponse.data);
      setConnections(connectionResponse.data);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Could not load source control connections." });
    }
  }, []);

  useEffect(() => {
    // Deferred so state updates happen outside the effect body.
    const timeoutHandle = window.setTimeout(() => {
      const params = readUrlParams();
      if (params.error) {
        setFeedback({ kind: "error", message: ERROR_MESSAGES[params.error] ?? `Authorization failed (${params.error}).` });
        clearUrlParams();
      } else if (params.status && params.connectionId) {
        const resync = params.resyncing ? ` Savant is syncing ${params.resyncing} existing repositor${params.resyncing === "1" ? "y" : "ies"} that this connection can read.` : "";
        setFeedback({ kind: "success", message: `Provider ${params.status === "reauthorized" ? "reauthorized" : "connected"}.${resync} Choose the repositories Savant can access.` });
        setPickerConnectionId(params.connectionId);
        clearUrlParams();
      }
      void reload();
    }, 0);

    return () => window.clearTimeout(timeoutHandle);
  }, [reload]);

  const byProvider = useMemo(() => {
    const groups = new Map<GitProviderType, GitConnectionSummary[]>();
    for (const connection of connections) {
      groups.set(connection.provider, [...(groups.get(connection.provider) ?? []), connection]);
    }
    return groups;
  }, [connections]);

  async function beginAuthorization(provider: GitProviderType, options?: { host?: string; clientId?: string; clientSecret?: string }) {
    setBusy(`connect:${provider}`);
    setFeedback(null);
    try {
      const response = await startGitAuthorization(provider, {
        returnPath: `${window.location.pathname}?section=source-control`,
        ...options,
      });
      window.location.assign(response.data.authorizationUrl);
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Authorization could not be started." });
      setBusy(null);
    }
  }

  async function reauthorize(connection: GitConnectionSummary) {
    setBusy(`reauth:${connection.id}`);
    try {
      const response = await reauthorizeGitConnection(connection.id, { returnPath: `${window.location.pathname}?section=source-control` });
      window.location.assign(response.data.authorizationUrl);
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Reauthorization could not be started." });
      setBusy(null);
    }
  }

  async function validate(connection: GitConnectionSummary) {
    setBusy(`validate:${connection.id}`);
    try {
      const response = await validateGitConnection(connection.id);
      setFeedback({ kind: response.data.healthy ? "success" : "error", message: response.data.message });
      await reload();
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Validation failed." });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(connection: GitConnectionSummary) {
    const confirmed = window.confirm(
      `Disconnect ${connection.displayName}? Savant will stop reading its ${connection.repositoryCount} repositories. Indexed skills are kept and the repositories are marked as needing authorization.`,
    );
    if (!confirmed) {
      return;
    }
    setBusy(`disconnect:${connection.id}`);
    try {
      const response = await disconnectGitConnection(connection.id);
      setFeedback({
        kind: "success",
        message: `Disconnected. ${response.data.repositoriesMarked} repositor${response.data.repositoriesMarked === 1 ? "y is" : "ies are"} now marked “authorization required”.`,
      });
      if (pickerConnectionId === connection.id) {
        setPickerConnectionId(null);
      }
      await reload();
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Disconnect failed." });
    } finally {
      setBusy(null);
    }
  }

  const pickerConnection = connections.find((connection) => connection.id === pickerConnectionId) ?? null;
  const orderedProviders = PROVIDER_ORDER.map((type) => providers.find((provider) => provider.type === type)).filter(
    (provider): provider is GitProviderDescriptor => Boolean(provider),
  );

  return (
    <>
      <Notice feedback={feedback} onDismiss={() => setFeedback(null)} />

      {pickerConnection && (
        <RepositoryPicker
          connection={pickerConnection}
          hierarchyLabel={providers.find((provider) => provider.type === pickerConnection.provider)?.hierarchy.join(" › ") ?? ""}
          onClose={() => setPickerConnectionId(null)}
          onConnected={(message) => {
            setFeedback({ kind: "success", message });
            void reload();
          }}
        />
      )}

      <Panel
        title="Source control"
        sub="Integrations · Connect Git providers so Savant can discover and index private skill repositories. Savant requests read-only repository access."
        actions={!canManage ? <span className="chip chip-paper">view only</span> : undefined}
      >
        {loadState === "loading" && <div className="muted" style={{ fontSize: 12.5 }}>Loading providers…</div>}
        {loadState === "ready" && (
          <div className="col" style={{ gap: 14 }}>
            {orderedProviders.map((provider) => (
              <ProviderCard
                key={provider.type}
                provider={provider}
                connections={byProvider.get(provider.type) ?? []}
                canManage={canManage}
                busy={busy}
                onConnect={() => (provider.supportsSelfManaged ? setSelfManagedFor(provider.type) : void beginAuthorization(provider.type))}
                onManage={(connection) => setPickerConnectionId(connection.id)}
                onReauthorize={(connection) => void reauthorize(connection)}
                onValidate={(connection) => void validate(connection)}
                onDisconnect={(connection) => void disconnect(connection)}
              >
                {selfManagedFor === provider.type && (
                  <GitLabHostChooser
                    busy={busy === `connect:${provider.type}`}
                    cloudConfigured={provider.configured}
                    onCancel={() => setSelfManagedFor(null)}
                    onSubmit={(options) => void beginAuthorization(provider.type, options)}
                  />
                )}
              </ProviderCard>
            ))}
          </div>
        )}
      </Panel>

      {canManage && (
        <Panel
          title="Advanced"
          sub="Connect using an access token when an app or OAuth installation is not possible (GitHub Enterprise, troubleshooting). Prefer a read-only token."
          actions={
            <button type="button" className="btn btn-sm" onClick={() => setShowTokenForm((value) => !value)}>
              {showTokenForm ? "Hide" : "Connect using access token"}
            </button>
          }
        >
          {showTokenForm ? (
            <ManualTokenForm
              providers={orderedProviders}
              onDone={(message) => {
                setFeedback({ kind: "success", message });
                setShowTokenForm(false);
                void reload();
              }}
              onError={(message) => setFeedback({ kind: "error", message })}
            />
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              Tokens are sent once over HTTPS to Savant’s server, validated, encrypted immediately, and never displayed again.
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

function ProviderCard({
  provider,
  connections,
  canManage,
  busy,
  onConnect,
  onManage,
  onReauthorize,
  onValidate,
  onDisconnect,
  children,
}: {
  provider: GitProviderDescriptor;
  connections: GitConnectionSummary[];
  canManage: boolean;
  busy: string | null;
  onConnect: () => void;
  onManage: (connection: GitConnectionSummary) => void;
  onReauthorize: (connection: GitConnectionSummary) => void;
  onValidate: (connection: GitConnectionSummary) => void;
  onDisconnect: (connection: GitConnectionSummary) => void;
  children?: ReactNode;
}) {
  const connectable = provider.configured || provider.supportsSelfManaged;

  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{provider.label}</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
            {provider.primaryAuth === "github_app_installation" ? "Savant GitHub App" : "OAuth"} · requests {provider.requestedAccess.join(", ")}
          </div>
        </div>
        {canManage && (
          <button type="button" className="btn btn-sm btn-primary" disabled={!connectable || busy === `connect:${provider.type}`} onClick={onConnect}>
            {busy === `connect:${provider.type}` ? "Redirecting…" : connections.length > 0 ? "Connect another" : "Connect"}
          </button>
        )}
      </div>

      {!provider.configured && provider.configurationHint && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          {provider.supportsSelfManaged ? "GitLab.com is not configured; self-managed instances can still be connected. " : ""}
          {provider.configurationHint}
        </div>
      )}

      {children}

      {connections.length > 0 && (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          {connections.map((connection) => (
            <div key={connection.id} style={{ borderTop: "1px solid var(--rule)", paddingTop: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{connection.displayName}</span>
                    <StatusChip status={connection.status} legacy={connection.isLegacy} />
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                    Repositories: {connection.repositoryCount} · Last verified: {formatRelative(connection.lastValidatedAt)}
                    {connection.providerHost ? ` · ${connection.providerHost}` : ""}
                    {connection.lastErrorCode ? ` · last error ${connection.lastErrorCode}` : ""}
                  </div>
                  {connection.isLegacy && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4, color: "var(--ink-2)" }}>
                      Legacy credential — this connection uses a deployment-managed credential. Reauthorize using the Savant {provider.label} integration.
                    </div>
                  )}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {connection.status === "active" && (
                    <button type="button" className="btn btn-sm" onClick={() => onManage(connection)}>
                      Manage repositories
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" disabled={busy === `validate:${connection.id}` || connection.status === "disconnected"} onClick={() => onValidate(connection)}>
                    {busy === `validate:${connection.id}` ? "Checking…" : "Validate"}
                  </button>
                  {canManage && (
                    <>
                      <button type="button" className="btn btn-sm" disabled={busy === `reauth:${connection.id}`} onClick={() => onReauthorize(connection)}>
                        Reauthorize
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" disabled={busy === `disconnect:${connection.id}`} onClick={() => onDisconnect(connection)}>
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GitLabHostChooser({
  busy,
  cloudConfigured,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  cloudConfigured: boolean;
  onCancel: () => void;
  onSubmit: (options?: { host: string; clientId: string; clientSecret: string }) => void;
}) {
  const [mode, setMode] = useState<"cloud" | "self">(cloudConfigured ? "cloud" : "self");
  const [host, setHost] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "cloud") {
      onSubmit();
    } else {
      onSubmit({ host, clientId, clientSecret });
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <div className="col" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 8, fontSize: 12.5 }}>
          <input type="radio" name="gitlab-mode" checked={mode === "cloud"} disabled={!cloudConfigured} onChange={() => setMode("cloud")} />
          GitLab.com
        </label>
        <label className="row" style={{ gap: 8, fontSize: 12.5 }}>
          <input type="radio" name="gitlab-mode" checked={mode === "self"} onChange={() => setMode("self")} />
          Self-managed GitLab
        </label>
        {mode === "self" && (
          <div className="col" style={{ gap: 8, marginLeft: 22 }}>
            <input style={inputStyle} type="url" required placeholder="https://gitlab.example.com" value={host} onChange={(event) => setHost(event.target.value)} aria-label="GitLab URL" />
            <input style={inputStyle} required placeholder="OAuth application ID" value={clientId} onChange={(event) => setClientId(event.target.value)} aria-label="OAuth application ID" />
            <input style={inputStyle} type="password" required autoComplete="off" placeholder="OAuth application secret" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} aria-label="OAuth application secret" />
            <div className="muted" style={{ fontSize: 11.5 }}>
              Register an OAuth application on your instance with scopes read_repository, read_api and read_user, and the redirect URI
              <code style={{ marginLeft: 4 }}>/api/git/connections/gitlab/callback</code> on this Savant origin.
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
            {busy ? "Redirecting…" : "Continue"}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function ManualTokenForm({
  providers,
  onDone,
  onError,
}: {
  providers: GitProviderDescriptor[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [provider, setProvider] = useState<GitProviderType>("github");
  const [token, setToken] = useState("");
  const [host, setHost] = useState("");
  const [organization, setOrganization] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await connectGitManualToken({
        provider,
        token,
        ...(displayName.trim() ? { displayName } : {}),
        ...(provider === "gitlab" && host.trim() ? { host } : {}),
        ...(provider === "azure" ? { organization } : {}),
      });
      onDone([response.data.message, ...response.data.warnings].join(" "));
    } catch (error) {
      onError(error instanceof Error ? error.message : "The token could not be validated.");
    } finally {
      // The token is never kept in component state after submission.
      setToken("");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="col" style={{ gap: 8 }}>
      <select style={inputStyle} value={provider} onChange={(event) => setProvider(event.target.value as GitProviderType)} aria-label="Provider">
        {providers.filter((entry) => entry.supportsManualToken).map((entry) => (
          <option key={entry.type} value={entry.type}>{entry.label}</option>
        ))}
      </select>
      <input style={inputStyle} placeholder="Display name (optional)" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      {provider === "gitlab" && (
        <input style={inputStyle} type="url" placeholder="Self-managed URL (leave empty for GitLab.com)" value={host} onChange={(event) => setHost(event.target.value)} />
      )}
      {provider === "azure" && (
        <input style={inputStyle} required placeholder="Azure DevOps organization" value={organization} onChange={(event) => setOrganization(event.target.value)} />
      )}
      <input
        style={inputStyle}
        type="password"
        required
        autoComplete="off"
        spellCheck={false}
        placeholder="Read-only access token"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        aria-label="Access token"
      />
      <div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={submitting || !token}>
          {submitting ? "Validating…" : "Validate and store"}
        </button>
      </div>
    </form>
  );
}

function RepositoryPicker({
  connection,
  hierarchyLabel,
  onClose,
  onConnected,
}: {
  connection: GitConnectionSummary;
  hierarchyLabel: string;
  onClose: () => void;
  onConnected: (message: string) => void;
}) {
  const [items, setItems] = useState<DiscoveredRepository[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, DiscoveredRepository>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const requestToken = useRef(0);

  const load = useCallback(async (cursor: string | null, term: string) => {
    const token = ++requestToken.current;
    setState("loading");
    setError(null);
    try {
      const response = await fetchDiscoveredRepositories(connection.id, { cursor, search: term });
      if (token !== requestToken.current) {
        return;
      }
      setItems((current) => (cursor ? [...current, ...response.data] : response.data));
      setNextCursor(response.meta.nextCursor);
      setState("ready");
    } catch (caught) {
      if (token === requestToken.current) {
        setState("error");
        setError(caught instanceof Error ? caught.message : "Repositories could not be listed.");
      }
    }
  }, [connection.id]);

  useEffect(() => {
    const timeoutHandle = window.setTimeout(() => void load(null, appliedSearch), 0);
    return () => window.clearTimeout(timeoutHandle);
  }, [load, appliedSearch]);

  useEffect(() => {
    const handle = window.setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const groups = useMemo(() => {
    const map = new Map<string, DiscoveredRepository[]>();
    for (const item of items) {
      const key = item.hierarchy.join(" / ") || "—";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  function toggle(item: DiscoveredRepository) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.providerRepositoryId)) {
        next.delete(item.providerRepositoryId);
      } else {
        next.set(item.providerRepositoryId, item);
      }
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((current) => {
      const next = new Map(current);
      for (const item of items) {
        if (!item.connectedRepositoryId) {
          next.set(item.providerRepositoryId, item);
        }
      }
      return next;
    });
  }

  async function connectSelected() {
    setSubmitting(true);
    try {
      const response = await connectSelectedRepositories({
        connectionId: connection.id,
        repositories: [...selected.values()].map((item) => ({ providerRepositoryId: item.providerRepositoryId, fullName: item.fullName })),
      });
      const { connected, failed } = response.data;
      const parts = [`Connected ${connected.length} repositor${connected.length === 1 ? "y" : "ies"}; initial indexing started.`];
      if (failed.length > 0) {
        parts.push(`${failed.length} could not be connected: ${failed.map((entry) => entry.message).join(" ")}`);
      }
      onConnected(parts.join(" "));
      setSelected(new Map());
      void load(null, appliedSearch);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The repositories could not be connected.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel
      title={`Choose repositories Savant can access · ${connection.displayName}`}
      sub={hierarchyLabel ? `Grouped by ${hierarchyLabel}` : undefined}
      actions={<button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>}
    >
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          style={{ ...inputStyle, maxWidth: 320 }}
          type="search"
          placeholder="Search repositories…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search repositories"
        />
        <button type="button" className="btn btn-sm" onClick={selectAllVisible} disabled={items.length === 0}>
          Select all visible
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void connectSelected()} disabled={selected.size === 0 || submitting}>
          {submitting ? "Connecting…" : `Connect selected${selected.size > 0 ? ` (${selected.size})` : ""}`}
        </button>
      </div>

      {error && <Notice feedback={{ kind: "error", message: error }} />}

      {state !== "error" && items.length === 0 && state === "ready" && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          No repositories are visible to this connection{appliedSearch ? " for that search" : ""}.
          {connection.provider === "github" ? " Grant the Savant GitHub App access to more repositories, then reload." : ""}
        </div>
      )}

      <div className="col" style={{ gap: 12, maxHeight: 460, overflowY: "auto" }}>
        {groups.map(([group, repositories]) => (
          <div key={group}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{group}</div>
            <div className="col" style={{ gap: 2 }}>
              {repositories.map((item) => (
                <label
                  key={item.providerRepositoryId}
                  className="row"
                  style={{ gap: 10, padding: "6px 4px", borderRadius: 4, cursor: item.connectedRepositoryId ? "default" : "pointer", fontSize: 12.5 }}
                >
                  <input
                    type="checkbox"
                    disabled={Boolean(item.connectedRepositoryId)}
                    checked={Boolean(item.connectedRepositoryId) || selected.has(item.providerRepositoryId)}
                    onChange={() => toggle(item)}
                  />
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>{item.name}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{item.isPrivate ? "private" : "public"}{item.defaultBranch ? ` · ${item.defaultBranch}` : ""}</span>
                  {item.connectedRepositoryId && <span className="chip chip-moss" style={{ height: 20, fontSize: 10.5 }}>connected</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        {state === "loading" && <span className="muted" style={{ fontSize: 12 }}>Loading…</span>}
        {state === "ready" && nextCursor && (
          <button type="button" className="btn btn-sm" onClick={() => void load(nextCursor, appliedSearch)}>
            Load more
          </button>
        )}
      </div>
    </Panel>
  );
}
