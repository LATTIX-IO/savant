"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillDetailPayload, SkillSourcePayload } from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { UiV2Button, UiV2EmptyState, UiV2Status } from "@/components/savant/ui-v2";
import { useUiV2Mode, useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { fetchSkillDetail, fetchSkillSource } from "@/lib/control-plane-client";
import { proposeFileEdits } from "@/lib/git-connections-client";
import { parseMarkdownPreviewBlocks } from "@/lib/skill-builder";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import {
  getWorkbenchGate, submitReviewedWorkbenchProposal,
  sourceRevisionLabel, workbenchChangeStats,
} from "@/lib/ui-v2-workbench-model";
import styles from "./workbench-v2.module.css";

type LoadState<T> =
  | { scope: string; phase: "loading"; data: null; error: null }
  | { scope: string; phase: "ready"; data: T; error: null }
  | { scope: string; phase: "error"; data: null; error: string };

type Notice = { scope: string; kind: "error" | "proposal"; message: string; proposalId: string | null };
const emptyDetail: LoadState<SkillDetailPayload> = { scope: "", phase: "loading", data: null, error: null };
const emptySource: LoadState<SkillSourcePayload> = { scope: "", phase: "loading", data: null, error: null };

export function WorkbenchV2({ skillId }: { skillId: string }) {
  const enabled = useUiV2Mode();
  const workspaceSlug = useUiV2WorkspaceSlug();
  const scope = workspaceSlug && skillId ? `${workspaceSlug}/${skillId}` : "";
  const pathname = usePathname() || "/";
  const catalogHref = buildTenantAwareAppPath(pathname, "/skills") as Route;
  const evaluationsHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const [detail, setDetail] = useState<LoadState<SkillDetailPayload>>(emptyDetail);
  const [source, setSource] = useState<LoadState<SkillSourcePayload>>(emptySource);
  const [draft, setDraft] = useState<{ scope: string; text: string }>({ scope: "", text: "" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reviewed, setReviewed] = useState<{ scope: string; text: string; base: string } | null>(null);
  const [mode, setMode] = useState<"edit" | "preview" | "review">("edit");
  const [saveBusy, setSaveBusy] = useState(false);
  const savingRef = useRef(false);
  const liveScopeRef = useRef("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    liveScopeRef.current = scope;
    return () => {
      if (liveScopeRef.current === scope) liveScopeRef.current = "";
    };
  }, [scope]);

  useEffect(() => {
    if (!enabled || !workspaceSlug || !scope) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setDetail({ scope, phase: "loading", data: null, error: null });
        setSource({ scope, phase: "loading", data: null, error: null });
        setNotice(null);
        setReviewed(null);
      }
    });
    const options = { workspaceSlug, signal: controller.signal };
    void fetchSkillDetail(skillId, options).then(result => {
      if (active) setDetail({ scope, phase: "ready", data: result.data, error: null });
    }).catch(error => {
      if (active && !controller.signal.aborted) setDetail({
        scope, phase: "error", data: null,
        error: error instanceof Error ? error.message : "Skill details could not be loaded.",
      });
    });
    void fetchSkillSource(skillId, options).then(result => {
      if (active) {
        setSource({ scope, phase: "ready", data: result.data, error: null });
        setDraft({ scope, text: result.data.content });
        setMode("edit");
      }
    }).catch(error => {
      if (active && !controller.signal.aborted) setSource({
        scope, phase: "error", data: null,
        error: error instanceof Error ? error.message : "SKILL.md could not be loaded.",
      });
    });
    return () => { active = false; controller.abort(); };
  }, [enabled, workspaceSlug, scope, skillId, retry]);

  const currentDetail = detail.scope === scope ? detail : emptyDetail;
  const currentSource = source.scope === scope ? source : emptySource;
  const skill = currentDetail.phase === "ready" ? currentDetail.data.skill : null;
  const sourceData = currentSource.phase === "ready" ? currentSource.data : null;
  const editorText = draft.scope === scope ? draft.text : "";
  const gate = getWorkbenchGate(sourceData, editorText);
  const pending = notice?.scope === scope && notice.kind === "proposal" ? notice : null;
  const visibleNotice = notice?.scope === scope ? notice : null;
  const hasReviewed = reviewed?.scope === scope && reviewed.text === editorText &&
    reviewed.base === sourceData?.content;
  const comparison = sourceData ? workbenchChangeStats(sourceData.content, editorText) : null;
  const blocks = useMemo(() => parseMarkdownPreviewBlocks(editorText), [editorText]);
  const latestEvaluation = currentDetail.phase === "ready"
    ? currentDetail.data.evaluations[0] ?? null : null;
  const evaluationDetailHref = latestEvaluation
    ? buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(latestEvaluation.id)}`) as Route
    : evaluationsHref;

  async function submitProposal() {
    if (!enabled || !workspaceSlug || !scope || !sourceData ||
        getWorkbenchGate(sourceData, editorText).kind !== "ready" || !hasReviewed ||
        pending || savingRef.current) return;
    savingRef.current = true;
    setSaveBusy(true);
    setNotice(null);
    try {
      const outcome = await submitReviewedWorkbenchProposal({
        source: sourceData,
        draft: editorText,
        isCurrent: () => liveScopeRef.current === scope,
        readCurrentSource: async () => {
          const result = await fetchSkillSource(skillId, { workspaceSlug });
          return result.data;
        },
        createProposal: async input => {
          const result = await proposeFileEdits(input.repositoryId, {
            title: `Savant: revise ${input.name} SKILL.md`,
            body: `Source: ${sourceData.repository}/${input.path}. Submitted from the Savant Workbench for review.`,
            files: [{ path: input.path, content: input.content }],
          }, { workspaceSlug });
          return { id: result.data.id, status: result.data.status };
        },
      });
      if (liveScopeRef.current !== scope) return;
      if (outcome.kind === "blocked") {
        setReviewed(null);
        setNotice({ scope, kind: "error", message: outcome.message, proposalId: null });
        return;
      }
      setNotice({
        scope, kind: "proposal",
        proposalId: outcome.proposalId,
        message: `Change proposal ${outcome.proposalId} created with status ${outcome.status}. Source was not committed or merged by this action.`,
      });
      setReviewed(null);
    } catch (error) {
      setNotice({
        scope, kind: "error", proposalId: null,
        message: error instanceof Error ? error.message : "The change proposal was not created.",
      });
    } finally {
      savingRef.current = false;
      setSaveBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div>
          <p className={styles.breadcrumb}><Link href={catalogHref}>Library</Link> / Workbench</p>
          <h1>{skill?.name ?? "Skill Workbench"}</h1>
          <p className={styles.subhead}>
            {skill ? `${skill.repo} · ${skill.branch} · Tier ${skill.tier}` : "Loading authorized skill metadata…"}
          </p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.linkButton} href={catalogHref}>Back to Library</Link>
          <Link className={styles.linkButton} href={evaluationDetailHref}>Evaluations</Link>
          <UiV2Button variant="tertiary" disabled={saveBusy}
            onClick={() => {
              if (comparison?.changed && !window.confirm("Discard the unsent draft and reload the current repository source?")) return;
              setRetry(value => value + 1);
            }}>
            <Ic.Refresh className={styles.icon} aria-hidden="true" />Reload source
          </UiV2Button>
        </div>
      </div>

      {currentDetail.phase === "error" ? (
        <div className={styles.alert} role="alert">Skill metadata unavailable: {currentDetail.error}</div>
      ) : null}
      {visibleNotice ? (
        <div className={visibleNotice.kind === "error" ? styles.alert : styles.success} role={visibleNotice.kind === "error" ? "alert" : "status"}>
          {visibleNotice.message}
        </div>
      ) : null}

      <div className={styles.layout}>
        <aside className={styles.tree} aria-label="Indexed skill files">
          <h2>Source files</h2>
          {sourceData?.mode === "repository" ? (
            <div className={styles.file} aria-current="page">
              <Ic.Repo className={styles.icon} aria-hidden="true" />
              <span>{sourceData.sourcePath}</span>
              {gate.kind === "ready" ? <span className={styles.dirty} title="Draft not yet proposed">*</span> : null}
            </div>
          ) : <p className={styles.muted}>No live indexed SKILL.md. Any fallback draft shown in the editor is read-only and is not verified repository content.</p>}
          <p className={styles.note}>Only the indexed SKILL.md is available through the production source API. Other files and graph dependencies are not editable here.</p>
        </aside>

        <section className={styles.editorPanel} aria-label="SKILL.md source editor">
          <div className={styles.editorToolbar}>
            <div className={styles.tabs} role="group" aria-label="Workbench viewing mode">
              <UiV2Button size="small" variant={mode === "edit" ? "primary" : "default"} aria-pressed={mode === "edit"}
                onClick={() => setMode("edit")}>Edit</UiV2Button>
              <UiV2Button size="small" variant={mode === "preview" ? "primary" : "default"} aria-pressed={mode === "preview"}
                onClick={() => setMode("preview")}>Preview</UiV2Button>
              <UiV2Button size="small" variant={mode === "review" ? "primary" : "default"} aria-pressed={mode === "review"}
                onClick={() => setMode("review")}>Compare</UiV2Button>
            </div>
            {comparison ? <span className={styles.muted}>Original {comparison.originalLines} lines · Draft {comparison.proposedLines} lines</span> : null}
          </div>

          {currentSource.phase === "loading" ? (
            <p className={styles.status} role="status">Loading indexed SKILL.md from the repository…</p>
          ) : currentSource.phase === "error" ? (
            <div className={styles.alert} role="alert">{currentSource.error}</div>
          ) : !sourceData ? (
            <UiV2EmptyState message="No source file is available." />
          ) : mode === "review" ? (
            <div className={styles.comparison}>
              <div><h3>Repository original</h3><pre>{sourceData.content}</pre></div>
              <div><h3>Your uncommitted draft</h3><pre>{editorText}</pre></div>
            </div>
          ) : mode === "preview" ? (
            <div className={styles.preview} aria-label="Plain Markdown preview">
              {blocks.length === 0 ? <UiV2EmptyState message="Draft has no readable content." /> :
                blocks.map((block, i) => {
                  if (block.type === "heading") return <h3 key={i}>{block.text}</h3>;
                  if (block.type === "paragraph") return <p key={i}>{block.text}</p>;
                  if (block.type === "blockquote") return <blockquote key={i}>{block.text}</blockquote>;
                  if (block.type === "code") return <pre key={i}>{block.content}</pre>;
                  return <ul key={i}>{block.items.map((item, n) => <li key={n}>{item}</li>)}</ul>;
                })}
            </div>
          ) : (
            <label className={styles.editorLabel}>
              <span className={styles.visuallyHidden}>SKILL.md Markdown source</span>
              <textarea className={styles.editor} spellCheck={false}
                aria-describedby="sv2-workbench-gate"
                readOnly={gate.kind === "read-only" || gate.kind === "not-loaded" || Boolean(pending)}
                value={editorText}
                onChange={event => {
                  setDraft({ scope, text: event.target.value });
                  setReviewed(null);
                  setNotice(previous => previous?.kind === "proposal" ? previous : null);
                }} />
            </label>
          )}

          <div className={styles.footer}>
            <p id="sv2-workbench-gate" className={styles.note}>{gate.message}</p>
            <div className={styles.actions}>
              <UiV2Button size="small" disabled={saveBusy || Boolean(pending) || !sourceData || !comparison?.changed}
                onClick={() => {
                  if (sourceData) {
                    setDraft({ scope, text: sourceData.content });
                    setReviewed(null);
                    setNotice(null);
                    setMode("edit");
                  }
                }}>Discard draft</UiV2Button>
              <UiV2Button variant="primary" size="small" disabled={gate.kind !== "ready" || saveBusy || Boolean(pending)}
                onClick={() => {
                  if (sourceData) {
                    setMode("review");
                    setReviewed({ scope, text: editorText, base: sourceData.content });
                  }
                }}>Review changes</UiV2Button>
              <UiV2Button variant="primary" size="small"
                disabled={gate.kind !== "ready" || !hasReviewed || saveBusy || Boolean(pending)}
                onClick={() => { void submitProposal(); }}>
                {saveBusy ? "Submitting…" : "Create change proposal"}
              </UiV2Button>
            </div>
          </div>
        </section>

        <aside className={styles.inspector} aria-label="Skill source metadata">
          <h2>Inspector</h2>
          {skill ? (
            <dl>
              <dt>Skill ID</dt><dd className={styles.mono}>{skill.skillUuid}</dd>
              <dt>Owner</dt><dd>{skill.owner}</dd>
              <dt>Channel</dt><dd>{skill.channel}</dd>
              <dt>Repository</dt><dd>{skill.repo}</dd>
              <dt>Latest evaluation</dt><dd>
                {latestEvaluation ? <Link href={evaluationDetailHref}>{latestEvaluation.status}</Link> :
                  "Not available"}
              </dd>
            </dl>
          ) : <p className={styles.muted}>No skill metadata available.</p>}
          <h2>Git provenance</h2>
          {sourceData ? (
            <dl>
              <dt>Path</dt><dd className={styles.mono}>{sourceData.sourcePath}</dd>
              <dt>Branch</dt><dd className={styles.mono}>{sourceData.branch}</dd>
              <dt>Indexed commit</dt><dd className={styles.mono}>{sourceRevisionLabel(sourceData)}</dd>
              <dt>Save capability</dt><dd>
                <UiV2Status state={gate.kind === "read-only" ? "unavailable" : "ready"}
                  label={gate.kind === "read-only" ? "Read-only" : "Review proposal"} />
              </dd>
            </dl>
          ) : <p className={styles.muted}>No verified source.</p>}
          <h2>Workflow and dependencies</h2>
          <UiV2Status state="unavailable" label="No indexed dependency graph" />
          <p className={styles.note}>The prototype visual graph is not authoritative and is not executed in this Workbench.</p>
        </aside>
      </div>
    </div>
  );
}
