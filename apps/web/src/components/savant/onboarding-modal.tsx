"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getPreferredRepositorySyncMode,
  getRepositoryProviderReadiness,
  supportsRepositorySyncMode,
} from "@savant/types";
import type {
  ApiErrorResponse,
  RepoBootstrapTemplateResponse,
  RepoConnectResponse,
  RepoContractValidationCheck,
  RepoContractValidationResponse,
  RepoProvisionResponse,
  RepositorySyncMode,
} from "@savant/types";

import { Ic, ProviderIcon } from "@/components/savant/icons";
import { useOnboarding } from "@/components/savant/onboarding-context";
import {
  buildTenantScopedControlPlanePath,
  provisionRepository,
} from "@/lib/control-plane-client";

type Path = "connect" | "provision";
type ProviderId = "github" | "gitlab" | "azure" | "bitbucket" | "selfhosted" | "more";

const PROVIDERS: { id: ProviderId; name: string; meta: string; disabled?: boolean | undefined }[] = [
  { id: "github", name: "GitHub", meta: "Connect + provision ready" },
  { id: "gitlab", name: "GitLab", meta: "Connect + index ready" },
  { id: "azure", name: "Azure DevOps", meta: "Manual preview only" },
  { id: "bitbucket", name: "Bitbucket", meta: "Manual preview only" },
  { id: "selfhosted", name: "Self-hosted Git", meta: "Manual preview only" },
  { id: "more", name: "Other provider", meta: "Coming soon", disabled: true },
];

const STEPS = [
  { title: "Choose path", sub: "Connect existing or provision new" },
  { title: "Pick provider", sub: "Where the repository lives" },
  { title: "Repo details", sub: "URL, branch, and identity" },
  { title: "Validate", sub: "Confirm structure and manifests" },
];

type ProvisionPreviewState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: RepoBootstrapTemplateResponse["data"] };

type ConnectValidationState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: RepoContractValidationResponse["data"] };

type ConnectPersistState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: RepoConnectResponse["data"] };

type ProvisionPersistState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: RepoProvisionResponse["data"] };

const EXAMPLE_CONNECT_SNAPSHOT = [
  "docs/README.md",
  "registry/skills.yaml",
  "registry/dependencies.yaml",
  "registry/owners.yaml",
  "registry/routing-policies.yaml",
  "tier1/standards/compliance-review/SKILL.md",
  "tier1/standards/compliance-review/metadata.yaml",
  "tier2/methodology/legal/contract-review-assistant/SKILL.md",
  "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
  "tier2/methodology/legal/contract-review-assistant/eval/dataset.yaml",
  "tier3/workflow/research/triage-helper/SKILL.md",
  "tier3/workflow/research/triage-helper/metadata.yaml",
  "evals/datasets/contracts.yaml",
  "evals/rubrics/default.yaml",
  "templates/README.md",
].join("\n");

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return typeof value === "object" && value !== null && "error" in value;
}

function parseSnapshotPaths(value: string): string[] {
  return [...new Set(
    value
      .split(/[\r\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function getValidationTone(checks: readonly RepoContractValidationCheck[]): "moss" | "brass" | "blood" {
  if (checks.some((check) => check.status === "fail")) {
    return "blood";
  }

  if (checks.some((check) => check.status === "warn" || check.status === "pending")) {
    return "brass";
  }

  return "moss";
}

function providerDisplayName(provider: ProviderId): string {
  return PROVIDERS.find((candidate) => candidate.id === provider)?.name ?? provider;
}

function providerRepositoryExample(provider: ProviderId): string {
  switch (provider) {
    case "gitlab":
      return "gitlab.com/your-group/your-repo";
    case "azure":
      return "dev.azure.com/your-org/your-project/_git/your-repo";
    case "bitbucket":
      return "bitbucket.org/your-workspace/your-repo";
    case "selfhosted":
      return "git.example.com/team/your-repo";
    case "more":
      return "your-provider.example.com/team/your-repo";
    case "github":
    default:
      return "github.com/your-org/your-repo";
  }
}

export function OnboardingModal() {
  const { open, hide, reportRepositoryConnected } = useOnboarding();
  const [step, setStep] = useState(0);
  const [path, setPath] = useState<Path>("connect");
  const [provider, setProvider] = useState<ProviderId>("github");
  const [repoUrl, setRepoUrl] = useState("github.com/wexler-hahn/finance-skills");
  const [branch, setBranch] = useState("main");
  const [name, setName] = useState("Finance Skills");
  const [syncMode, setSyncMode] = useState<RepositorySyncMode>(() => getPreferredRepositorySyncMode("github"));
  const [repoTreeSnapshot, setRepoTreeSnapshot] = useState("");
  const [provisionPreview, setProvisionPreview] = useState<ProvisionPreviewState>({
    status: "idle",
  });
  const [connectValidation, setConnectValidation] = useState<ConnectValidationState>({
    status: "idle",
  });
  const [connectPersist, setConnectPersist] = useState<ConnectPersistState>({
    status: "idle",
  });
  const [provisionPersist, setProvisionPersist] = useState<ProvisionPersistState>({
    status: "idle",
  });
  const selectedProviderReadiness = useMemo(() => getRepositoryProviderReadiness(provider), [provider]);
  const snapshotPaths = useMemo(() => parseSnapshotPaths(repoTreeSnapshot), [repoTreeSnapshot]);
  const supportsWebhookSync = supportsRepositorySyncMode(selectedProviderReadiness, "webhook");
  const supportsLivePreview = selectedProviderReadiness.supportsLiveTreePreview;

  function selectProvider(nextProvider: ProviderId) {
    setProvider(nextProvider);

    const nextReadiness = getRepositoryProviderReadiness(nextProvider);

    if (!supportsRepositorySyncMode(nextReadiness, syncMode)) {
      setSyncMode(getPreferredRepositorySyncMode(nextReadiness));
    }
  }

  useEffect(() => {
    if (!open || step !== 3 || path !== "provision") {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadPreview() {
      setProvisionPersist({ status: "idle" });
      setProvisionPreview({ status: "loading" });

      try {
        const response = await fetch(buildTenantScopedControlPlanePath("/api/repositories/bootstrap-template"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            defaultBranch: branch,
            displayName: name,
            provider,
            repoUrl,
            syncMode,
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as
          | RepoBootstrapTemplateResponse
          | ApiErrorResponse;

        if (!response.ok || isApiErrorResponse(payload)) {
          throw new Error(
            isApiErrorResponse(payload)
              ? payload.error.message
              : "Could not generate a repository bootstrap preview.",
          );
        }

        if (active) {
          setProvisionPreview({ status: "success", data: payload.data });
        }
      } catch (error) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setProvisionPreview({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not generate a repository bootstrap preview.",
        });
      }
    }

    void loadPreview();

    return () => {
      active = false;
      controller.abort();
    };
  }, [branch, name, open, path, provider, repoUrl, step, syncMode]);

  useEffect(() => {
    if (!open || step !== 3 || path !== "connect") {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadValidation() {
      setConnectPersist({ status: "idle" });
      setConnectValidation({ status: "loading" });

      try {
        const response = await fetch(buildTenantScopedControlPlanePath("/api/repositories/validate-contract"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            defaultBranch: branch,
            displayName: name,
            observedPaths: snapshotPaths.length > 0 ? snapshotPaths : undefined,
            path: "connect",
            provider,
            repoUrl,
            syncMode,
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as
          | RepoContractValidationResponse
          | ApiErrorResponse;

        if (!response.ok || isApiErrorResponse(payload)) {
          throw new Error(
            isApiErrorResponse(payload)
              ? payload.error.message
              : "Could not validate the repository contract.",
          );
        }

        if (active) {
          setConnectValidation({ status: "success", data: payload.data });
        }
      } catch (error) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setConnectValidation({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not validate the repository contract.",
        });
      }
    }

    void loadValidation();

    return () => {
      active = false;
      controller.abort();
    };
  }, [branch, name, open, path, provider, repoUrl, snapshotPaths, step, syncMode]);

  if (!open) return null;

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const close = () => {
    hide();
    setStep(0);
    setConnectValidation({ status: "idle" });
    setConnectPersist({ status: "idle" });
    setProvisionPreview({ status: "idle" });
    setProvisionPersist({ status: "idle" });
  };

  async function submitProvisionedRepository() {
    if (provisionPersist.status === "loading") {
      return;
    }

    setProvisionPersist({ status: "loading" });

    try {
      const payload = await provisionRepository({
        defaultBranch: branch,
        displayName: name,
        provider,
        repoUrl,
        syncMode,
      });

      reportRepositoryConnected(payload.data.repository.id);
      setProvisionPersist({ status: "success", data: payload.data });
    } catch (error) {
      setProvisionPersist({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not provision the repository.",
      });
    }
  }

  async function submitConnectedRepository() {
    if (connectPersist.status === "loading") {
      return;
    }

    setConnectPersist({ status: "loading" });

    try {
      const response = await fetch(buildTenantScopedControlPlanePath("/api/repositories/connect"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defaultBranch: branch,
          displayName: name,
          observedPaths: snapshotPaths.length > 0 ? snapshotPaths : undefined,
          provider,
          repoUrl,
          syncMode,
        }),
      });

      const payload = (await response.json()) as RepoConnectResponse | ApiErrorResponse;

      if (!response.ok || isApiErrorResponse(payload)) {
        throw new Error(
          isApiErrorResponse(payload)
            ? payload.error.message
            : "Could not connect the repository.",
        );
      }

      reportRepositoryConnected(payload.data.repository.id);
      setConnectPersist({ status: "success", data: payload.data });
    } catch (error) {
      setConnectPersist({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not connect the repository.",
      });
    }
  }

  const connectTone =
    connectValidation.status === "success"
      ? getValidationTone(connectValidation.data.checks)
      : connectValidation.status === "error"
        ? "blood"
        : "brass";
  const effectiveProviderReadiness = connectValidation.status === "success"
    ? connectValidation.data.providerReadiness
    : selectedProviderReadiness;
  const canSubmitConnect =
    path === "connect"
    && connectValidation.status === "success"
    && connectValidation.data.ready
    && effectiveProviderReadiness.indexingSupported;
  const canSubmitProvision = path === "provision" && provisionPreview.status === "success";
  const isSubmitting = connectPersist.status === "loading" || provisionPersist.status === "loading";

  return (
    <div
      className="onboarding"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="onboarding-shell">
        <div className="onb-rail">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              /02 — Connect
            </div>
            <div className="h-display" style={{ fontSize: 22, marginBottom: 4 }}>
              Add a repository
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
              Savant treats your Git repository as the source of truth for skill content.
              Approvals, evaluations, and releases live here.
            </div>
          </div>

          <div className="col" style={{ marginTop: 14, gap: 0 }}>
            {STEPS.map((s, i) => (
              <div
                key={i}
                className={`onb-step ${
                  i < step ? "done" : i === step ? "active" : "upcoming"
                }`}
              >
                <div className="onb-num">
                  {i < step ? <Ic.Check style={{ width: 11, height: 11 }} /> : i + 1}
                </div>
                <div>
                  <div className="onb-t">{s.title}</div>
                  <div className="onb-s">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto" }}>
            <div className="note">
              <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
              <div style={{ fontSize: 11.5 }}>
                Savant keeps skill content in your Git environment. In the secure MVP, GitHub writes only happen when you explicitly provision or commit a scaffold in-flow.
              </div>
            </div>
          </div>
        </div>

        <div className="onb-body">
          {step === 0 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Step 1 of 4
                </div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  How would you like to start?
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 480 }}>
                  Connect a repository that already contains skills, or provision a new one
                  from a Savant-validated template.
                </div>
              </div>

              <div className="choice-grid">
                <button
                  type="button"
                  className={`choice ${path === "connect" ? "selected" : ""}`}
                  onClick={() => setPath("connect")}
                >
                  <div className="choice-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="24"
                      height="24"
                    >
                      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                    </svg>
                  </div>
                  <div className="choice-title">Connect existing repository</div>
                  <div className="choice-sub">
                    You already have skill files in a Git repository. Savant will read
                    structure, validate manifests, and ingest tracked skills.
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: "auto" }}>
                    <span className="chip chip-paper">read-only</span>
                    <span className="chip chip-paper">poll/manual sync</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`choice ${path === "provision" ? "selected" : ""}`}
                  onClick={() => {
                    setPath("provision");
                    selectProvider("github");
                  }}
                >
                  <div className="choice-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="24"
                      height="24"
                    >
                      <rect x="3" y="4" width="18" height="14" rx="1.5" />
                      <path d="M12 9v6M9 12h6" />
                    </svg>
                  </div>
                  <div className="choice-title">Provision new repository</div>
                  <div className="choice-sub">
                    Savant creates a new repository in your Git environment from a template
                    with manifests, eval scaffolding, and example tier‑1 skills.
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: "auto" }}>
                    <span className="chip chip-paper">GitHub-first</span>
                    <span className="chip chip-paper">eval scaffolding</span>
                  </div>
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Step 2 of 4
                </div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  Where does your repository live?
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 480 }}>
                  {path === "provision"
                    ? "Provider-backed provisioning is GitHub-first in the current secure MVP. Other providers can still be connected where read support exists."
                    : "Pick the provider that currently hosts your repository. Live preview and indexing vary by provider."}
                </div>
              </div>

              <div className="provider-grid">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`provider ${provider === p.id ? "selected" : ""}`}
                    disabled={p.disabled || (path === "provision" && p.id !== "github")}
                    onClick={() => selectProvider(p.id)}
                  >
                    <ProviderIcon p={p.id} size={20} />
                    <div className="col" style={{ gap: 1 }}>
                      <div className="provider-name">{p.name}</div>
                      <div className="provider-meta">{p.meta}</div>
                    </div>
                    {provider === p.id ? (
                      <Ic.CheckCircle
                        style={{ marginLeft: "auto", color: "var(--moss)", width: 14, height: 14 }}
                      />
                    ) : p.disabled ? (
                      <span className="chip chip-paper" style={{ marginLeft: "auto", opacity: 0.75 }}>
                        soon
                      </span>
                    ) : path === "provision" && p.id !== "github" ? (
                      <span className="chip chip-paper" style={{ marginLeft: "auto", opacity: 0.75 }}>
                        connect only
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="note" style={{ marginTop: 14 }}>
                <Ic.Lock className="n-icon" style={{ color: "var(--slate)" }} />
                <div style={{ fontSize: 12 }}>
                  Savant authenticates via an OAuth app or installation token. Credentials are
                  encrypted at rest and never exposed to skill content.
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Step 3 of 4
                </div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  {path === "connect" ? "Point Savant at your repository" : "Name the new repository"}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 480 }}>
                  {path === "connect"
                    ? supportsLivePreview
                      ? `Use the full URL of an existing repository. Savant attempts a live ${providerDisplayName(provider)} tree preview for supported public repositories, indexes supported repositories immediately after connect, and still accepts a pasted snapshot override for private repositories or troubleshooting.`
                      : "Use the full URL of an existing repository. Savant accepts a pasted repository snapshot for manual pre-flight validation while live provider previews are unavailable for this provider."
                    : "Savant will create this repository in GitHub using the tier-1 starter template."}
                </div>
              </div>

              <div>
                <div className="field">
                  <div className="field-label">Repository URL</div>
                  <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
                  <div className="field-help">
                    Example: <span className="mono">{providerRepositoryExample(provider)}</span>
                  </div>
                </div>

                <div className="row" style={{ gap: 14 }}>
                  <div className="field grow">
                    <div className="field-label">Default branch</div>
                    <input value={branch} onChange={(e) => setBranch(e.target.value)} />
                  </div>
                  <div className="field grow">
                    <div className="field-label">Display name</div>
                    <input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Tier policy</div>
                  <select defaultValue="t2">
                    <option value="t1">Tier 1 — Strict (compliance approval required)</option>
                    <option value="t2">Tier 2 — Standard (owner + reviewer approval)</option>
                    <option value="t3">Tier 3 — Lightweight (owner approval only)</option>
                  </select>
                  <div className="field-help">
                    Default tier for skills ingested from this repository. Individual skills can override.
                  </div>
                </div>

                <div className="field">
                  <div className="field-label">Sync mode</div>
                  <div className="row" style={{ gap: 8 }}>
                    <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
                      <input
                        disabled={!supportsRepositorySyncMode(selectedProviderReadiness, "webhook")}
                        checked={syncMode === "webhook"}
                        name="sync"
                        type="radio"
                        onChange={() => setSyncMode("webhook")}
                      />{" "}
                      Webhook (real-time)
                    </label>
                    <label className="row" style={{ gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
                      <input
                        disabled={!supportsRepositorySyncMode(selectedProviderReadiness, "poll")}
                        checked={syncMode === "poll"}
                        name="sync"
                        type="radio"
                        onChange={() => setSyncMode("poll")}
                      />{" "}
                      Polled (every 5 min)
                    </label>
                    <label className="row" style={{ gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
                      <input
                        disabled={!supportsRepositorySyncMode(selectedProviderReadiness, "manual")}
                        checked={syncMode === "manual"}
                        name="sync"
                        type="radio"
                        onChange={() => setSyncMode("manual")}
                      />{" "}
                      Manual (operator-triggered)
                    </label>
                  </div>
                  <div className="field-help">
                    {supportsWebhookSync
                      ? "Webhook sync is available for this provider. Poll and manual remain available for staged rollout or troubleshooting."
                      : selectedProviderReadiness.webhookRegistration.message}
                  </div>
                </div>

                {path === "connect" && (
                  <div className="field">
                    <div className="row between" style={{ alignItems: "center", gap: 10 }}>
                      <div className="field-label" style={{ marginBottom: 0 }}>Repository tree snapshot override</div>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setRepoTreeSnapshot(EXAMPLE_CONNECT_SNAPSHOT)}
                        >
                          Load example snapshot
                        </button>
                        {repoTreeSnapshot ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setRepoTreeSnapshot("")}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <textarea
                      rows={8}
                      value={repoTreeSnapshot}
                      onChange={(e) => setRepoTreeSnapshot(e.target.value)}
                      placeholder={supportsLivePreview
                        ? "Optional fallback. Paste one repository path per line to override the live preview or validate a private repository manually."
                        : "Required for now. Paste one repository path per line to validate this provider before live provider reads land."}
                      style={{ minHeight: 148, resize: "vertical" }}
                    />
                    <div className="field-help">
                      {supportsLivePreview
                        ? `Leave this blank to let Savant try a live ${providerDisplayName(provider)} tree preview for supported public repositories. Paste a path list only when you want to override the preview or validate a private repository manually.`
                        : "Paste a path list to validate this provider before live provider tree reads land."}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            path === "provision" ? (
              <>
                <div className="onb-bd-hd">
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Step 4 of 4
                  </div>
                  <div className="h-display" style={{ fontSize: 26 }}>
                    Preview repository bootstrap
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 520 }}>
                    Savant generated a contract-aware scaffold preview for {repoUrl} on branch{" "}
                    <span className="mono">{branch}</span>.
                  </div>
                </div>

                <div className="panel" style={{ marginBottom: 14 }}>
                  <div className="panel-hd">
                    <div className="panel-title">Bootstrap preview</div>
                    <span
                      className={`chip ${
                        provisionPreview.status === "error"
                          ? "chip-blood"
                          : provisionPreview.status === "success"
                            ? "chip-moss"
                            : "chip-paper"
                      }`}
                    >
                      {provisionPreview.status === "success" ? (
                        <Ic.Check style={{ width: 10, height: 10 }} />
                      ) : provisionPreview.status === "error" ? (
                        <Ic.XCircle style={{ width: 10, height: 10 }} />
                      ) : (
                        <Ic.Warn style={{ width: 10, height: 10 }} />
                      )}
                      {provisionPreview.status === "success"
                        ? "ready to scaffold"
                        : provisionPreview.status === "error"
                          ? "preview failed"
                          : "generating preview"}
                    </span>
                  </div>

                  <div className="panel-bd" style={{ padding: "0 var(--pad-card)" }}>
                    {provisionPreview.status === "loading" && (
                      <ValidateRow
                        warn
                        label="Bootstrap preview"
                        meta="Generating directories, registry files, and eval scaffolding"
                      />
                    )}

                    {provisionPreview.status === "error" && (
                      <ValidateRow fail label="Bootstrap preview" meta={provisionPreview.message} />
                    )}

                    {provisionPreview.status === "success" && (
                      <>
                        {provisionPreview.data.checks.map((check) => (
                          <ValidateCheckRow key={check.key} check={check} />
                        ))}
                      </>
                    )}
                  </div>
                </div>

                <div className="note">
                  <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                  <div style={{ fontSize: 12 }}>
                    {provisionPreview.status === "success"
                      ? `The generated scaffold includes ${provisionPreview.data.summary.directoryCount} directories and ${provisionPreview.data.summary.fileCount} files, including registry manifests and evaluation roots.`
                      : "Savant is preparing the repository scaffold preview before committing it into your tenant-owned repository."}
                  </div>
                </div>

                {provisionPersist.status === "error" && (
                  <div className="note blood" style={{ marginTop: 12 }}>
                    <Ic.XCircle className="n-icon" style={{ color: "var(--oxblood)" }} />
                    <div style={{ fontSize: 12 }}>{provisionPersist.message}</div>
                  </div>
                )}

                {provisionPersist.status === "success" && (
                  <div className="note" style={{ marginTop: 12 }}>
                    <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                    <div style={{ fontSize: 12 }}>
                      Created <span className="mono">{provisionPersist.data.repository.name}</span> and committed the bootstrap scaffold at <span className="mono">{provisionPersist.data.commit.sha.slice(0, 7)}</span>.
                      {provisionPersist.data.indexedSkillCount > 0
                        ? ` Indexed ${provisionPersist.data.indexedSkillCount} skills immediately.`
                        : " The repository is now connected and ready for follow-on syncs."}
                      {provisionPersist.data.warnings.length > 0
                        ? ` ${provisionPersist.data.warnings.join(" ")}`
                        : ""}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="onb-bd-hd">
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    Step 4 of 4
                  </div>
                  <div className="h-display" style={{ fontSize: 26 }}>
                    Validate repository structure
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 520 }}>
                    Savant ran a contract check against {repoUrl} on branch <span className="mono">{branch}</span>.
                  </div>
                </div>

                <div className="panel" style={{ marginBottom: 14 }}>
                  <div className="panel-hd">
                    <div className="panel-title">Repository check</div>
                    <span className={`chip chip-${connectTone}`}>
                      {connectValidation.status === "success" && connectTone === "moss" ? (
                        <Ic.Check style={{ width: 10, height: 10 }} />
                      ) : connectValidation.status === "error" || connectTone === "blood" ? (
                        <Ic.XCircle style={{ width: 10, height: 10 }} />
                      ) : (
                        <Ic.Warn style={{ width: 10, height: 10 }} />
                      )}
                      {connectValidation.status === "success"
                        ? connectValidation.data.ready
                          ? "ready to ingest"
                          : connectTone === "blood"
                            ? "needs repair"
                            : "pre-flight pending"
                        : connectValidation.status === "error"
                          ? "validation failed"
                          : "validating"}
                    </span>
                  </div>
                  <div className="panel-bd" style={{ padding: "0 var(--pad-card)" }}>
                    {connectValidation.status === "loading" && (
                      <ValidateRow
                        warn
                        label="Repository validation"
                        meta={
                          snapshotPaths.length > 0
                            ? `Inspecting ${snapshotPaths.length} provided repository paths`
                            : supportsLivePreview
                              ? `Resolving the live ${providerDisplayName(provider)} repository tree preview`
                              : selectedProviderReadiness.liveTreePreview.message
                        }
                      />
                    )}

                    {connectValidation.status === "error" && (
                      <ValidateRow fail label="Repository validation" meta={connectValidation.message} />
                    )}

                    {connectValidation.status === "success" && (
                      <>
                        {connectValidation.data.checks.map((check) => (
                          <ValidateCheckRow key={check.key} check={check} />
                        ))}
                      </>
                    )}
                  </div>
                </div>

                {connectValidation.status === "success" && (
                  <div className={`note ${connectTone === "blood" ? "blood" : connectTone === "brass" ? "brass" : ""}`}>
                    {connectTone === "moss" ? (
                      <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                    ) : connectTone === "blood" ? (
                      <Ic.XCircle className="n-icon" style={{ color: "var(--oxblood)" }} />
                    ) : (
                      <Ic.Warn className="n-icon" style={{ color: "var(--brass)" }} />
                    )}
                    <div style={{ fontSize: 12 }}>
                      {connectValidation.data.ready
                        ? connectValidation.data.providerReadiness.indexingSupported
                          ? connectValidation.data.validationSource === "provider-live-preview"
                            ? `The live ${providerDisplayName(provider)} preview matched the Savant contract. ${connectValidation.data.summary.discoveredSkillPackageCount} skill package roots were discovered and ${providerDisplayName(provider)} repositories will be indexed immediately after connect.`
                            : `The provided snapshot matched the Savant contract. ${connectValidation.data.summary.discoveredSkillPackageCount} skill package roots were discovered and ${providerDisplayName(provider)} repositories will be indexed immediately after connect.`
                          : connectValidation.data.providerReadiness.immediateIndexing.message
                        : connectValidation.data.summary.observedPathCount === 0
                          ? connectValidation.data.providerReadiness.supportsLiveTreePreview
                            ? `${providerDisplayName(provider)} could not produce a live repository preview from the current locator. Paste a path list to keep validating while private-repository auth is still being wired.`
                            : connectValidation.data.providerReadiness.liveTreePreview.message
                          : connectValidation.data.nextSteps.join(" ")}
                    </div>
                  </div>
                )}

                {connectPersist.status === "error" && (
                  <div className="note blood" style={{ marginTop: 12 }}>
                    <Ic.XCircle className="n-icon" style={{ color: "var(--oxblood)" }} />
                    <div style={{ fontSize: 12 }}>{connectPersist.message}</div>
                  </div>
                )}

                {connectPersist.status === "success" && (
                  <div className="note" style={{ marginTop: 12 }}>
                    <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                    <div style={{ fontSize: 12 }}>
                      {connectPersist.data.created
                        ? connectPersist.data.repository.providerReadiness.indexingSupported
                          ? `Connected ${connectPersist.data.repository.name}. Savant will now trigger the initial repository sync so the tenant-scoped repository record can populate with indexed skills.`
                          : `Connected ${connectPersist.data.repository.name}. ${connectPersist.data.repository.providerReadiness.immediateIndexing.message}`
                        : `Updated the existing control-plane connection for ${connectPersist.data.repository.name}. The repository list will refresh with the latest sync settings.`}
                      {connectPersist.data.warnings.length > 0
                        ? ` ${connectPersist.data.warnings.join(" ")}`
                        : ""}
                    </div>
                  </div>
                )}
              </>
            )
          )}

          <div className="onb-bd-foot">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <div className="row" style={{ gap: 8 }}>
              {step > 0 && (
                <button type="button" className="btn btn-ghost" onClick={back}>
                  Back
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn btn-primary" onClick={next}>
                  <span>Continue</span>
                  <Ic.ChevR className="b-icon" />
                </button>
              ) : (
                <button
                  type="button"
                  className={(path === "connect" && canSubmitConnect && connectPersist.status !== "success")
                    || (path === "provision" && canSubmitProvision && provisionPersist.status !== "success")
                    ? "btn btn-primary"
                    : "btn btn-brass"}
                  disabled={isSubmitting}
                  onClick={() => {
                    if (path === "provision") {
                      if (provisionPersist.status === "success") {
                        close();
                        return;
                      }

                      if (canSubmitProvision) {
                        void submitProvisionedRepository();
                        return;
                      }

                      close();
                      return;
                    }

                    if (connectPersist.status === "success") {
                      close();
                      return;
                    }

                    if (canSubmitConnect) {
                      void submitConnectedRepository();
                      return;
                    }

                    close();
                  }}
                >
                  {isSubmitting ? (
                    <Ic.Spinner className="b-icon" />
                  ) : (
                    <Ic.Check className="b-icon" />
                  )}
                  <span>
                    {path === "provision"
                      ? provisionPersist.status === "success"
                        ? "Done"
                        : provisionPersist.status === "loading"
                          ? "Provisioning repository…"
                          : canSubmitProvision
                            ? "Create repository"
                            : "Close"
                      : connectPersist.status === "success"
                        ? "Done"
                        : connectPersist.status === "loading"
                          ? "Connecting repository…"
                          : canSubmitConnect
                            ? "Connect repository"
                            : "Close"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ValidateRow({
  warn,
  fail,
  label,
  meta,
}: {
  ok?: boolean;
  warn?: boolean;
  fail?: boolean;
  label: string;
  meta: string;
}) {
  return (
    <div className="validate-row">
      <span className={`v-icon ${warn ? "pending" : fail ? "fail" : ""}`}>
        {warn ? (
          <Ic.Warn style={{ width: 14, height: 14 }} />
        ) : fail ? (
          <Ic.XCircle style={{ width: 14, height: 14 }} />
        ) : (
          <Ic.CheckCircle style={{ width: 14, height: 14 }} />
        )}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{label}</span>
      <span className="v-meta mono">{meta}</span>
    </div>
  );
}

function ValidateCheckRow({ check }: { check: RepoContractValidationCheck }) {
  return (
    <ValidateRow
      warn={check.status === "warn" || check.status === "pending"}
      fail={check.status === "fail"}
      label={check.label}
      meta={check.meta}
    />
  );
}
