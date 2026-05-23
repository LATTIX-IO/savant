"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  RepoSyncReason,
  RepositoryDetailPayload,
  RepositoryListItem,
  RepositorySyncStatus,
} from "@savant/types";

import { Ic, ProviderIcon } from "@/components/savant/icons";
import {
  BranchRef,
  CommitRef,
  Facet,
} from "@/components/savant/primitives";
import { useOnboarding } from "@/components/savant/onboarding-context";
import {
  fetchRepositoryDetail,
  fetchRepositoryList,
  triggerRepositorySync,
} from "@/lib/control-plane-client";

type ProviderFilter = "all" | "github" | "gitlab" | "azure" | "bitbucket";

export function RepositoriesScreen() {
  const { show, latestConnectedRepository } = useOnboarding();
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [selId, setSelId] = useState("");
  const [repositories, setRepositories] = useState<RepositoryListItem[]>([]);
  const [repositoriesStatus, setRepositoriesStatus] = useState<"loading" | "error" | "success">("loading");
  const [repositoriesError, setRepositoriesError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepositoryDetailPayload | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadListToken, setReloadListToken] = useState(0);
  const [reloadDetailToken, setReloadDetailToken] = useState(0);
  const [syncingRepositoryId, setSyncingRepositoryId] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<{
    tone: "default" | "warning" | "error";
    message: string;
  } | null>(null);
  const autoRequestedSyncAtRef = useRef(0);
  const latestConnectedAt = latestConnectedRepository?.at ?? 0;
  const latestConnectedEntry = latestConnectedRepository
    ? repositories.find((repository) => repository.id === latestConnectedRepository.id) ?? null
    : null;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadRepositories() {
      setRepositoriesStatus("loading");
      setRepositoriesError(null);

      try {
        const response = await fetchRepositoryList({ signal: controller.signal });

        if (active) {
          setRepositories(response.data);
          setRepositoriesStatus("success");
        }
      } catch (error) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setRepositoriesStatus("error");
        setRepositoriesError(
          error instanceof Error ? error.message : "Could not load repositories.",
        );
      }
    }

    void loadRepositories();

    return () => {
      active = false;
      controller.abort();
    };
  }, [latestConnectedAt, reloadListToken]);

  useEffect(() => {
    if (!latestConnectedRepository) {
      return;
    }

    const timeoutHandle = window.setTimeout(() => {
      setSelId(latestConnectedRepository.id);
    }, 0);

    return () => {
      window.clearTimeout(timeoutHandle);
    };
  }, [latestConnectedRepository]);

  const filtered = useMemo(
    () =>
      providerFilter === "all"
        ? repositories
        : repositories.filter((repository) => repository.provider === providerFilter),
    [providerFilter, repositories],
  );

  const activeSelId = filtered.some((repository) => repository.id === selId)
    ? selId
    : filtered[0]?.id ?? "";

  useEffect(() => {
    if (!activeSelId) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadDetail() {
      setDetailStatus("loading");
      setDetailError(null);

      try {
        const response = await fetchRepositoryDetail(activeSelId, { signal: controller.signal });

        if (active) {
          setDetail(response.data);
          setDetailStatus("success");
        }
      } catch (error) {
        if (controller.signal.aborted || !active) {
          return;
        }

        setDetail(null);
        setDetailStatus("error");
        setDetailError(
          error instanceof Error ? error.message : "Could not load repository details.",
        );
      }
    }

    void loadDetail();

    return () => {
      active = false;
      controller.abort();
    };
  }, [activeSelId, latestConnectedAt, reloadDetailToken]);

  const sel = filtered.find((repository) => repository.id === activeSelId) ?? filtered[0] ?? null;
  const det = detail?.repository.id === activeSelId ? detail.details : null;
  const selectedRepositoryUrl = sel?.webUrl ?? null;

  const requestRepositorySyncFor = useCallback(async (repositoryId: string, reason: RepoSyncReason) => {
    setSyncingRepositoryId(repositoryId);
    setSyncNotice(null);

    try {
      const response = await triggerRepositorySync(repositoryId, { reason });
      setSyncNotice({
        tone: response.data.accepted ? "default" : "warning",
        message: response.data.message,
      });
      setReloadListToken((value) => value + 1);
      setReloadDetailToken((value) => value + 1);
    } catch (error) {
      setSyncNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not request repository sync.",
      });
    } finally {
      setSyncingRepositoryId((value) => (value === repositoryId ? null : value));
    }
  }, []);

  useEffect(() => {
    if (!latestConnectedRepository || repositoriesStatus !== "success" || !latestConnectedEntry) {
      return;
    }

    if (autoRequestedSyncAtRef.current >= latestConnectedRepository.at) {
      return;
    }

    autoRequestedSyncAtRef.current = latestConnectedRepository.at;

    if (!latestConnectedEntry.providerReadiness.indexingSupported) {
      const timeoutHandle = window.setTimeout(() => {
        setSyncNotice({
          tone: "warning",
          message: `Connected ${latestConnectedEntry.name}. ${latestConnectedEntry.providerReadiness.immediateIndexing.message}`,
        });
      }, 0);

      return () => {
        window.clearTimeout(timeoutHandle);
      };
    }

    const timeoutHandle = window.setTimeout(() => {
      void requestRepositorySyncFor(latestConnectedRepository.id, "initial_connect");
    }, 0);

    return () => {
      window.clearTimeout(timeoutHandle);
    };
  }, [latestConnectedEntry, latestConnectedRepository, repositoriesStatus, requestRepositorySyncFor]);

  const totalSkills = repositories.reduce((count, repository) => count + repository.skills, 0);
  const stale = repositories.filter((repository) => repository.status !== "ok").length;
  const lastSyncedRepository = repositories[0] ?? null;

  const retryList = () => setReloadListToken((value) => value + 1);
  const retryDetail = () => setReloadDetailToken((value) => value + 1);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/03</span>
            <span className="sep">—</span>
            <span>Repositories</span>
          </div>
          <h1 className="h-display">Source repositories</h1>
          <div className="page-head-sub">
            Skill content lives in your Git environment. Savant ingests, validates manifests, and
            resolves approved versions back to a commit.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (!sel || syncingRepositoryId || !sel.providerReadiness.indexingSupported) {
                return;
              }

              void requestRepositorySyncFor(sel.id, "manual");
            }}
            disabled={!sel || syncingRepositoryId !== null || !sel.providerReadiness.indexingSupported}
            title={sel && !sel.providerReadiness.indexingSupported
              ? sel.providerReadiness.immediateIndexing.message
              : undefined}
          >
            {syncingRepositoryId === sel?.id ? (
              <Ic.Spinner className="b-icon" />
            ) : (
              <Ic.Refresh className="b-icon" />
            )}
            {syncingRepositoryId === sel?.id
              ? "Requesting sync…"
              : sel && !sel.providerReadiness.indexingSupported
                ? "Sync unavailable"
                : "Sync selected"}
          </button>
          <button type="button" className="btn btn-primary" onClick={show}>
            <Ic.Plus className="b-icon" />
            Connect repository
          </button>
        </div>
      </div>

      {syncNotice ? (
        <div
          className={`note${syncNotice.tone === "warning" ? " brass" : syncNotice.tone === "error" ? " blood" : ""}`}
          style={{ marginBottom: 16 }}
        >
          {syncNotice.tone === "error" ? (
            <Ic.XCircle className="n-icon" />
          ) : syncNotice.tone === "warning" ? (
            <Ic.Warn className="n-icon" />
          ) : (
            <Ic.Refresh className="n-icon" />
          )}
          <span>{syncNotice.message}</span>
        </div>
      ) : null}

      <div className="kpi-strip" style={{ marginBottom: 24 }}>
        <div className="kpi">
          <div className="kpi-label">Connected</div>
          <div className="kpi-value num">{repositories.length}</div>
          <div className="kpi-trend">live control-plane count</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Skills under management</div>
          <div className="kpi-value num">{totalSkills}</div>
          <div className="kpi-trend up">▲ 6 this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Last sync</div>
          <div className="kpi-value num">
            {lastSyncedRepository ? lastSyncedRepository.lastSync : "—"}
          </div>
          <div className="kpi-trend">
            {lastSyncedRepository ? `latest listed repo · ${lastSyncedRepository.name}` : "awaiting data"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Needs attention</div>
          <div className="kpi-value num" style={{ color: stale ? "var(--oxblood)" : "var(--ink)" }}>
            {stale}
          </div>
          <div className="kpi-trend down">repositories not currently in sync</div>
        </div>
      </div>

      <div className="split">
        <div className="col" style={{ gap: 0 }}>
          <div className="filterbar">
            <Facet active={providerFilter === "all"} onClick={() => setProviderFilter("all")}>
              All
            </Facet>
            <Facet active={providerFilter === "github"} onClick={() => setProviderFilter("github")}>
              <Ic.GitHub style={{ width: 11, height: 11 }} /> GitHub
            </Facet>
            <Facet active={providerFilter === "gitlab"} onClick={() => setProviderFilter("gitlab")}>
              <Ic.GitLab style={{ width: 11, height: 11 }} /> GitLab
            </Facet>
            <Facet active={providerFilter === "azure"} onClick={() => setProviderFilter("azure")}>
              <Ic.Azure style={{ width: 11, height: 11 }} /> Azure
            </Facet>
            <Facet active={providerFilter === "bitbucket"} onClick={() => setProviderFilter("bitbucket")}>
              <Ic.Bitbucket style={{ width: 11, height: 11 }} /> Bitbucket
            </Facet>
            <div className="grow" />
            <button type="button" className="btn btn-sm">
              <Ic.Sort className="b-icon" />
              Sort: last sync
            </button>
          </div>
          <div className="panel" style={{ borderRadius: "0 0 6px 6px", borderTop: 0 }}>
            <div className="panel-bd tight">
              {repositoriesStatus === "loading" && repositories.length === 0 ? (
                <div className="panel-bd">
                  <div className="note">
                    <Ic.Spinner className="n-icon" />
                    <span>Loading connected repositories from the control-plane API…</span>
                  </div>
                </div>
              ) : repositoriesStatus === "error" && repositories.length === 0 ? (
                <div className="panel-bd">
                  <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <Ic.XCircle className="n-icon" />
                      <span>{repositoriesError ?? "Could not load repositories."}</span>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={retryList}>
                      Retry
                    </button>
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="panel-bd">
                  <div className="note brass">
                    <Ic.Warn className="n-icon" />
                    <span>No repositories match the current provider filter.</span>
                  </div>
                </div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th>Provider</th>
                      <th>Default branch</th>
                      <th style={{ textAlign: "right" }}>Skills</th>
                      <th>Last sync</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        className={r.id === activeSelId ? "selected" : ""}
                        onClick={() => setSelId(r.id)}
                      >
                        <td>
                          <div className="tbl-name">
                            <ProviderIcon p={r.provider} size={13} />
                            <div className="tbl-name-text">
                              {r.webUrl ? (
                                <a
                                  href={r.webUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="pri mono link"
                                  style={{ fontSize: 12.5, width: "fit-content" }}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {r.name}
                                </a>
                              ) : (
                                <span className="pri mono" style={{ fontSize: 12.5 }}>
                                  {r.name}
                                </span>
                              )}
                              <span className="sec">{r.provider}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="chip chip-paper">{r.provider}</span>
                        </td>
                        <td>
                          <BranchRef branch={r.branch} />
                        </td>
                        <td className="num" style={{ textAlign: "right", fontWeight: 500 }}>
                          {r.skills}
                        </td>
                        <td className="muted">{r.lastSync}</td>
                        <td>
                          <RepositoryStatusPill status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ position: "sticky", top: 0 }}>
          <div className="panel-hd">
            <div className="panel-title">Repository details</div>
            {selectedRepositoryUrl ? (
              <a
                href={selectedRepositoryUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm"
              >
                <Ic.ExternalLink className="b-icon" />
                Open in {sel?.provider ?? "provider"}
              </a>
            ) : (
              <button
                type="button"
                className="btn btn-sm"
                disabled
                title="No repository URL is available for this provider yet."
              >
                <Ic.ExternalLink className="b-icon" />
                Open in {sel?.provider ?? "provider"}
              </button>
            )}
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!sel ? (
              <div className="note brass">
                <Ic.Warn className="n-icon" />
                <span>Select a repository to inspect its details.</span>
              </div>
            ) : detailStatus === "loading" ? (
              <div className="note">
                <Ic.Spinner className="n-icon" />
                <span>Loading repository details for <span className="mono">{sel.name}</span>…</span>
              </div>
            ) : detailStatus === "error" ? (
              <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <Ic.XCircle className="n-icon" />
                  <span>{detailError ?? "Could not load repository details."}</span>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={retryDetail}>
                  Retry
                </button>
              </div>
            ) : !det ? (
              <div className="note brass">
                <Ic.Warn className="n-icon" />
                <span>Repository details are not available yet.</span>
              </div>
            ) : (
              <>
                <div>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <ProviderIcon p={sel.provider} size={14} />
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                      {sel.name}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                    {det.description}
                  </div>
                </div>

                <div className="divider" />

                <div className="col" style={{ gap: 6 }}>
                  <DetailRow label="Default branch">
                    <BranchRef branch={sel.branch} />
                  </DetailRow>
                  <DetailRow label="Sync mode">
                    <span className="chip chip-paper">{det.syncMode}</span>
                  </DetailRow>
                  <DetailRow label="Supported sync">
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {sel.providerReadiness.supportedSyncModes.map((mode) => (
                        <span key={mode} className="chip chip-paper">{mode}</span>
                      ))}
                    </div>
                  </DetailRow>
                  <DetailRow label="Indexing">
                    <ReadinessPill
                      supported={sel.providerReadiness.indexingSupported}
                      message={sel.providerReadiness.immediateIndexing.message}
                    />
                  </DetailRow>
                  <DetailRow label="Webhook">
                    {sel.providerReadiness.supportsWebhookRegistration ? (
                      <WebhookHealthPill health={det.webhookHealth} lastSync={sel.lastSync} />
                    ) : (
                      <ReadinessPill
                        supported={false}
                        message={sel.providerReadiness.webhookRegistration.message}
                      />
                    )}
                  </DetailRow>
                  <DetailRow label="Tier policy">
                    <span style={{ fontSize: 12.5 }}>{det.tierPolicy}</span>
                  </DetailRow>
                  <DetailRow label="Skills">
                    <span className="num" style={{ fontSize: 12.5 }}>
                      {sel.skills}
                    </span>
                  </DetailRow>
                  <DetailRow label="By tier">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="chip tier-1">T1 {det.skillsByTier[1]}</span>
                      <span className="chip tier-2">T2 {det.skillsByTier[2]}</span>
                      <span className="chip tier-3">T3 {det.skillsByTier[3]}</span>
                    </div>
                  </DetailRow>
                </div>

                <div className="divider" />

                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Recent commits
                  </div>
                  {det.recentCommits.length === 0 ? (
                    <div className="note brass">
                      <Ic.Warn className="n-icon" />
                      <span>No recent commits are available for this repository yet.</span>
                    </div>
                  ) : (
                    <div className="col" style={{ gap: 8 }}>
                      {det.recentCommits.map((c, i) => (
                        <div key={i} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                          <CommitRef commit={c.commit} />
                          <div className="col" style={{ gap: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 12.5,
                                color: "var(--ink-2)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.msg}
                            </div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {c.who} · {c.when}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RepositoryStatusPill({ status }: { status: RepositorySyncStatus }) {
  if (status === "ok") {
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        in sync
      </span>
    );
  }

  if (status === "warn") {
    return (
      <span className="chip chip-brass">
        <span className="dot" />
        attention
      </span>
    );
  }

  return (
    <span className="chip chip-blood">
      <span className="dot" />
      stale
    </span>
  );
}

function WebhookHealthPill({ health, lastSync }: { health: string; lastSync: string }) {
  if (health === "ok") {
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        healthy · {lastSync}
      </span>
    );
  }

  if (health === "pending") {
    return (
      <span className="chip chip-brass">
        <span className="dot" />
        pending setup
      </span>
    );
  }

  return (
    <span className="chip chip-blood">
      <span className="dot" />
      {health}
    </span>
  );
}

function ReadinessPill({ supported, message }: { supported: boolean; message: string }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className={`chip ${supported ? "chip-moss" : "chip-paper"}`}>
        <span className="dot" />
        {supported ? "available" : "not yet wired"}
      </span>
      <span className="muted" style={{ fontSize: 11.5 }}>{message}</span>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr",
        alignItems: "center",
        gap: 12,
        padding: "3px 0",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
