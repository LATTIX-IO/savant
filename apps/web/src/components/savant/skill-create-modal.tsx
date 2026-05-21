"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  ApiErrorResponse,
  SkillScaffoldResponse,
  SkillTierKey,
  Tier3Kind,
} from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { REPOS } from "@/lib/savant-data";

type SkillCreateModalProps = {
  open: boolean;
  onClose: () => void;
};

type PreviewState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: SkillScaffoldResponse["data"] };

const STEPS = [
  { title: "Choose target", sub: "Repository and tier placement" },
  { title: "Describe skill", sub: "Metadata and ownership" },
  { title: "Preview scaffold", sub: "Generated files and registry updates" },
] as const;

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return typeof value === "object" && value !== null && "error" in value;
}

function parseDependencies(value: string): string[] {
  return [...new Set(value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

export function SkillCreateModal({ open, onClose }: SkillCreateModalProps) {
  const [step, setStep] = useState(0);
  const [repositoryId, setRepositoryId] = useState(REPOS[0]?.id ?? "");
  const [tier, setTier] = useState<SkillTierKey>("tier2");
  const [displayName, setDisplayName] = useState("Contract Review Assistant");
  const [owner, setOwner] = useState("ari.chen");
  const [summary, setSummary] = useState(
    "Review commercial contracts, extract key obligations, and flag material risk language.",
  );
  const [domain, setDomain] = useState("legal");
  const [category, setCategory] = useState("contracts");
  const [status, setStatus] = useState<"draft" | "active" | "deprecated">("draft");
  const [tier3Kind, setTier3Kind] = useState<Tier3Kind>("workflow");
  const [personSlug, setPersonSlug] = useState("ari-chen");
  const [packagePath, setPackagePath] = useState("");
  const [dependenciesInput, setDependenciesInput] = useState("shared/legal-style\nshared/risk-taxonomy");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const selectedRepository = REPOS.find((repo) => repo.id === repositoryId) ?? REPOS[0] ?? null;
  const dependencies = useMemo(() => parseDependencies(dependenciesInput), [dependenciesInput]);
  const canAdvanceDetails =
    displayName.trim().length > 0 &&
    owner.trim().length > 0 &&
    summary.trim().length > 0 &&
    repositoryId.trim().length > 0;

  useEffect(() => {
    if (!open || step !== 2 || !canAdvanceDetails) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadPreview() {
      setPreview({ status: "loading" });

      try {
        const response = await fetch("/api/skills/scaffold", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            category,
            dependencies,
            displayName,
            domain,
            owner,
            packagePath: packagePath.trim() || undefined,
            personSlug: tier === "tier3" && tier3Kind === "personal" ? personSlug : undefined,
            status,
            summary,
            tier,
            tier3Kind: tier === "tier3" ? tier3Kind : undefined,
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as SkillScaffoldResponse | ApiErrorResponse;

        if (!response.ok || isApiErrorResponse(payload)) {
          throw new Error(
            isApiErrorResponse(payload)
              ? payload.error.message
              : "Could not generate a skill scaffold preview.",
          );
        }

        if (active) {
          setPreview({ status: "success", data: payload.data });
        }
      } catch (error) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setPreview({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not generate a skill scaffold preview.",
        });
      }
    }

    void loadPreview();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    canAdvanceDetails,
    category,
    dependencies,
    displayName,
    domain,
    open,
    owner,
    packagePath,
    personSlug,
    status,
    step,
    summary,
    tier,
    tier3Kind,
  ]);

  if (!open) {
    return null;
  }

  const close = () => {
    setStep(0);
    setPreview({ status: "idle" });
    onClose();
  };

  const next = () => {
    if (step === 1 && !canAdvanceDetails) {
      return;
    }

    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const back = () => setStep((current) => Math.max(current - 1, 0));

  return (
    <div
      className="onboarding"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div aria-modal="true" className="onboarding-shell" role="dialog">
        <div className="onb-rail">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              /04 — Author
            </div>
            <div className="h-display" style={{ fontSize: 22, marginBottom: 4 }}>
              Create a skill
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
              Savant scaffolds the package shape, eval assets, and registry updates so skill
              owners can start from governed structure instead of blank files.
            </div>
          </div>

          <div className="col" style={{ marginTop: 14, gap: 0 }}>
            {STEPS.map((item, index) => (
              <div
                key={item.title}
                className={`onb-step ${
                  index < step ? "done" : index === step ? "active" : "upcoming"
                }`}
              >
                <div className="onb-num">
                  {index < step ? <Ic.Check style={{ width: 11, height: 11 }} /> : index + 1}
                </div>
                <div>
                  <div className="onb-t">{item.title}</div>
                  <div className="onb-s">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto" }}>
            <div className="note">
              <Ic.Lock className="n-icon" style={{ color: "var(--moss)" }} />
              <div style={{ fontSize: 11.5 }}>
                This slice previews the Git changes needed for skill creation. Direct commit,
                registry writeback, and re-indexing land in the next backend pass.
              </div>
            </div>
          </div>
        </div>

        <div className="onb-body">
          {step === 0 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Step 1 of 3
                </div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  Where should this skill live?
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 520 }}>
                  Choose the target repository and the governance tier so Savant can derive the
                  correct package path.
                </div>
              </div>

              <div className="field">
                <div className="field-label">Repository target</div>
                <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                  {REPOS.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.name} · {repo.provider} · {repo.branch}
                    </option>
                  ))}
                </select>
                <div className="field-help">
                  Skills are scaffolded into the selected tenant-owned repository and later indexed
                  back into Savant.
                </div>
              </div>

              <div className="choice-grid">
                <TierChoice
                  active={tier === "tier1"}
                  description="High-governance shared standards and strongly controlled skills."
                  label="Tier 1"
                  meta="tier1/standards/<skill-package>"
                  onClick={() => setTier("tier1")}
                />
                <TierChoice
                  active={tier === "tier2"}
                  description="Reusable methodology skills organized by functional domain."
                  label="Tier 2"
                  meta="tier2/methodology/<domain>/<skill-package>"
                  onClick={() => setTier("tier2")}
                />
                <TierChoice
                  active={tier === "tier3"}
                  description="Personal or workflow-specific skills with narrower distribution."
                  label="Tier 3"
                  meta="tier3/personal|workflow/..."
                  onClick={() => setTier("tier3")}
                />
              </div>

              {selectedRepository ? (
                <div className="note" style={{ marginTop: 14 }}>
                  <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                  <div style={{ fontSize: 12 }}>
                    Targeting <span className="mono">{selectedRepository.name}</span> on branch{" "}
                    <span className="mono">{selectedRepository.branch}</span> with {selectedRepository.skills} governed skills already indexed.
                  </div>
                </div>
              ) : null}
            </>
          )}

          {step === 1 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Step 2 of 3
                </div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  Describe the skill package
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 540 }}>
                  These inputs become the first draft of the package metadata, starter eval assets,
                  and registry updates.
                </div>
              </div>

              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                <div className="field grow">
                  <div className="field-label">Display name</div>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </div>
                <div className="field grow">
                  <div className="field-label">Owner</div>
                  <input value={owner} onChange={(event) => setOwner(event.target.value)} />
                </div>
              </div>

              <div className="field">
                <div className="field-label">Summary</div>
                <textarea
                  rows={4}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  style={{ minHeight: 92, resize: "vertical" }}
                />
              </div>

              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                <div className="field grow">
                  <div className="field-label">Domain</div>
                  <input value={domain} onChange={(event) => setDomain(event.target.value)} />
                </div>
                <div className="field grow">
                  <div className="field-label">Category</div>
                  <input value={category} onChange={(event) => setCategory(event.target.value)} />
                </div>
              </div>

              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                <div className="field grow">
                  <div className="field-label">Initial status</div>
                  <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="deprecated">Deprecated</option>
                  </select>
                </div>
                <div className="field grow">
                  <div className="field-label">Package path override</div>
                  <input
                    placeholder="Optional — let Savant derive the path by default"
                    value={packagePath}
                    onChange={(event) => setPackagePath(event.target.value)}
                  />
                </div>
              </div>

              {tier === "tier3" && (
                <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                  <div className="field grow">
                    <div className="field-label">Tier 3 kind</div>
                    <select
                      value={tier3Kind}
                      onChange={(event) => setTier3Kind(event.target.value as Tier3Kind)}
                    >
                      <option value="workflow">Workflow</option>
                      <option value="personal">Personal</option>
                    </select>
                  </div>
                  {tier3Kind === "personal" && (
                    <div className="field grow">
                      <div className="field-label">Owner slug</div>
                      <input value={personSlug} onChange={(event) => setPersonSlug(event.target.value)} />
                    </div>
                  )}
                </div>
              )}

              <div className="field">
                <div className="field-label">Dependencies</div>
                <textarea
                  rows={3}
                  value={dependenciesInput}
                  onChange={(event) => setDependenciesInput(event.target.value)}
                  style={{ minHeight: 76, resize: "vertical" }}
                />
                <div className="field-help">
                  Enter one dependency per line or separate them with commas.
                </div>
              </div>

              {!canAdvanceDetails && (
                <div className="note blood">
                  <Ic.Warn className="n-icon" />
                  <div style={{ fontSize: 12 }}>
                    Display name, owner, summary, and repository target are required before Savant
                    can generate the scaffold preview.
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="onb-bd-hd">
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Step 3 of 3
                </div>
                <div className="h-display" style={{ fontSize: 26 }}>
                  Review generated scaffold
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 6, maxWidth: 540 }}>
                  Savant generated a deterministic skill package preview for{" "}
                  <span className="mono">{selectedRepository?.name ?? "the selected repository"}</span>.
                </div>
              </div>

              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-hd">
                  <div className="panel-title">Scaffold status</div>
                  <span
                    className={`chip ${
                      preview.status === "success"
                        ? "chip-moss"
                        : preview.status === "error"
                          ? "chip-blood"
                          : "chip-paper"
                    }`}
                  >
                    {preview.status === "success" ? (
                      <Ic.Check style={{ width: 10, height: 10 }} />
                    ) : preview.status === "error" ? (
                      <Ic.XCircle style={{ width: 10, height: 10 }} />
                    ) : (
                      <Ic.Warn style={{ width: 10, height: 10 }} />
                    )}
                    {preview.status === "success"
                      ? "preview ready"
                      : preview.status === "error"
                        ? "preview failed"
                        : "generating"}
                  </span>
                </div>
                <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {preview.status === "loading" && (
                    <div className="note">
                      <Ic.Spinner className="n-icon" />
                      <div style={{ fontSize: 12 }}>
                        Generating package structure, starter eval assets, and registry updates…
                      </div>
                    </div>
                  )}

                  {preview.status === "error" && (
                    <div className="note blood">
                      <Ic.XCircle className="n-icon" />
                      <div style={{ fontSize: 12 }}>{preview.message}</div>
                    </div>
                  )}

                  {preview.status === "success" && (
                    <>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span className="chip chip-paper">{selectedRepository?.name ?? "repo"}</span>
                        <span className="chip chip-paper">{preview.data.packagePath}</span>
                        <span className="chip chip-paper">uuid {preview.data.skillUuid.slice(0, 8)}</span>
                      </div>

                      <div className="col" style={{ gap: 8 }}>
                        <PreviewStatRow label="Skill UUID" value={preview.data.skillUuid} />
                        <PreviewStatRow label="Skill ID" value={preview.data.skillId} />
                        <PreviewStatRow label="Package path" value={preview.data.packagePath} />
                      </div>

                      <div className="divider" />

                      <div>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>
                          Generated files
                        </div>
                        <div className="col" style={{ gap: 8 }}>
                          {preview.data.files.map((file) => (
                            <PreviewArtifactRow
                              key={file.path}
                              label={file.path}
                              meta={file.purpose}
                              preview={file.content.split("\n").slice(0, 3).join("\n")}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="divider" />

                      <div>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>
                          Registry updates
                        </div>
                        <div className="col" style={{ gap: 8 }}>
                          {preview.data.registryUpdates.map((update) => (
                            <PreviewArtifactRow
                              key={update.path}
                              label={update.path}
                              meta={update.purpose}
                              preview={update.preview}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="note">
                <Ic.CheckCircle className="n-icon" style={{ color: "var(--moss)" }} />
                <div style={{ fontSize: 12 }}>
                  This preview now covers both the generated skill package and the registry files
                  that must change for indexing. The next slice will persist those writes into the
                  tenant-owned Git repository and trigger re-indexing.
                </div>
              </div>
            </>
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
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={step === 1 && !canAdvanceDetails}
                  onClick={next}
                  style={step === 1 && !canAdvanceDetails ? { opacity: 0.6 } : undefined}
                >
                  <span>{step === 1 ? "Generate preview" : "Continue"}</span>
                  <Ic.ChevR className="b-icon" />
                </button>
              ) : (
                <button type="button" className="btn btn-brass" onClick={close}>
                  <Ic.Check className="b-icon" />
                  <span>Finish — close preview</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TierChoice({
  active,
  description,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`choice ${active ? "selected" : ""}`} onClick={onClick}>
      <div className="choice-icon">
        <Ic.Plus width={24} height={24} />
      </div>
      <div className="choice-title">{label}</div>
      <div className="choice-sub">{description}</div>
      <span className="chip chip-paper" style={{ marginTop: "auto", alignSelf: "flex-start" }}>
        {meta}
      </span>
    </button>
  );
}

function PreviewStatRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "96px 1fr",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <span className="mono" style={{ color: "var(--ink-2)", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function PreviewArtifactRow({
  label,
  meta,
  preview,
}: {
  label: string;
  meta: string;
  preview: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 6,
        padding: 12,
        background: "var(--panel)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 3, minWidth: 0 }}>
          <span className="mono" style={{ color: "var(--ink)", fontSize: 11.5 }}>{label}</span>
          <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{meta}</span>
        </div>
      </div>
      <pre
        style={{
          margin: "10px 0 0",
          padding: "10px 12px",
          background: "var(--linen)",
          border: "1px solid var(--rule)",
          borderRadius: 4,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          color: "var(--ink-3)",
        }}
      >
        {preview}
      </pre>
    </div>
  );
}