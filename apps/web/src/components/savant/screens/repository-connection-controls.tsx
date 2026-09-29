"use client";

import type { GitConnectionSummary, RepositoryListItem, RepositorySyncStatusPayload } from "@savant/types";
import { useEffect, useState } from "react";

import {
  assignRepositoryConnection,
  fetchGitConnections,
  fetchRepositorySyncStatus,
  removeRepository,
} from "@/lib/git-connections-client";
import { extractWorkspaceSlugFromPathname } from "@/lib/tenant-paths";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure Repos",
};

function sourceControlHref(): string {
  const slug = typeof window === "undefined" ? null : extractWorkspaceSlugFromPathname(window.location.pathname);
  return slug ? `/o/${encodeURIComponent(slug)}/settings?section=source-control` : "/settings?section=source-control";
}

/**
 * Shows which provider connection reads a repository, lets the user switch it
 * (resolving CONNECTION_AMBIGUOUS or moving off a legacy credential), and
 * removes the repository. Removal deletes Savant's index only; the Git
 * repository and the provider connection are untouched.
 */
export function RepositoryConnectionControls({
  repository,
  onChanged,
  onRemoved,
}: {
  repository: RepositoryListItem;
  onChanged: (message: string) => void;
  onRemoved: (message: string) => void;
}) {
  const [status, setStatus] = useState<RepositorySyncStatusPayload | null>(null);
  const [candidates, setCandidates] = useState<GitConnectionSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<"assign" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const providerLabel = PROVIDER_LABELS[repository.provider] ?? repository.provider;

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [statusResponse, connectionsResponse] = await Promise.all([
          fetchRepositorySyncStatus(repository.id),
          fetchGitConnections(),
        ]);
        if (!active) {
          return;
        }
        const compatible = connectionsResponse.data.filter(
          (connection) => connection.provider === repository.provider && connection.status === "active",
        );
        setStatus(statusResponse.data);
        setCandidates(compatible);
        setSelected(statusResponse.data.connection?.id ?? compatible[0]?.id ?? "");
        setError(null);
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Connection details could not be loaded.");
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [repository.id, repository.provider, reloadToken]);

  async function assign() {
    if (!selected) {
      return;
    }
    setBusy("assign");
    setError(null);
    try {
      await assignRepositoryConnection(repository.id, selected);
      const name = candidates.find((candidate) => candidate.id === selected)?.displayName ?? "the selected connection";
      onChanged(`${repository.name} now reads through ${name}. A sync has started.`);
      setReloadToken((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The connection could not be changed.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const confirmed = window.confirm(
      `Remove ${repository.name} from Savant?\n\nThis deletes its ${repository.skills} indexed skill${repository.skills === 1 ? "" : "s"} from Savant. The Git repository and the ${providerLabel} connection are not affected, and you can connect the repository again later.`,
    );
    if (!confirmed) {
      return;
    }
    setBusy("remove");
    setError(null);
    try {
      const response = await removeRepository(repository.id);
      onRemoved(`Removed ${repository.name} and ${response.data.removedSkillCount} indexed skill${response.data.removedSkillCount === 1 ? "" : "s"}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The repository could not be removed.");
      setBusy(null);
    }
  }

  const current = status?.connection ?? null;
  const canSwitch = candidates.length > 0 && selected !== "" && selected !== current?.id;

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="eyebrow">Provider connection</div>

      {error && (
        <div className="note blood">
          <span style={{ fontSize: 12.5 }}>{error}</span>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
        {current ? (
          <>
            <span style={{ fontWeight: 500 }}>{current.displayName}</span>
            {current.isLegacy && <span className="chip chip-brass">legacy credential</span>}
            {current.status !== "active" && <span className="chip chip-blood">{current.status.replace(/_/g, " ")}</span>}
          </>
        ) : (
          <span className="muted">
            {status ? `No ${providerLabel} connection is assigned.` : "Loading…"}
          </span>
        )}
      </div>

      {candidates.length > 0 ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select
            aria-label={`${providerLabel} connection`}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            style={{ height: 30, fontSize: 12.5, borderRadius: 5, border: "1px solid var(--rule)", background: "transparent", color: "var(--ink)", padding: "0 8px", maxWidth: 260 }}
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}{candidate.isLegacy ? " (legacy)" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" disabled={!canSwitch || busy !== null} onClick={() => void assign()}>
            {busy === "assign" ? "Checking access…" : current ? "Change connection" : "Use this connection"}
          </button>
        </div>
      ) : (
        status && (
          <a className="btn btn-sm" href={sourceControlHref()} style={{ alignSelf: "flex-start" }}>
            Connect {providerLabel}
          </a>
        )
      )}

      <div>
        <button type="button" className="btn btn-sm btn-danger" disabled={busy !== null} onClick={() => void remove()}>
          {busy === "remove" ? "Removing…" : "Remove repository"}
        </button>
      </div>
    </div>
  );
}
