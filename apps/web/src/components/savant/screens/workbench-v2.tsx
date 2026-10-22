"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { SkillDetailPayload, SkillSourcePayload } from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { UiV2Button, UiV2CanvasRegion, UiV2EmptyState, UiV2StateBanner, UiV2Status } from "@/components/savant/ui-v2";
import { useUiV2Mode, useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { fetchSkillAssets, fetchSkillDetail, fetchSkillSource } from "@/lib/control-plane-client";
import type { SkillAssetResponseData } from "@/lib/ui-v2-skill-assets";
import { proposeFileEdits } from "@/lib/git-connections-client";
import { parseMarkdownPreviewBlocks } from "@/lib/skill-builder";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import {
  getWorkbenchGate, submitReviewedWorkbenchProposal,
  sourceRevisionLabel, workbenchChangeStats, buildObservedWorkbenchCanvas,
} from "@/lib/ui-v2-workbench-model";
import styles from "./workbench-v2.module.css";

type LoadState<T> =
  | { scope: string; phase: "loading"; data: null; error: null }
  | { scope: string; phase: "ready"; data: T; error: null }
  | { scope: string; phase: "error"; data: null; error: string };

type Notice = { scope: string; kind: "error" | "proposal"; message: string; proposalId: string | null };
const emptyDetail: LoadState<SkillDetailPayload> = { scope: "", phase: "loading", data: null, error: null };
const emptySource: LoadState<SkillSourcePayload> = { scope: "", phase: "loading", data: null, error: null };
const emptyAssets: LoadState<SkillAssetResponseData> = { scope: "", phase: "loading", data: null, error: null };

export function WorkbenchV2({ skillId }: { skillId: string }) {
  const enabled = useUiV2Mode();
  const workspaceSlug = useUiV2WorkspaceSlug();
  const scope = workspaceSlug && skillId ? `${workspaceSlug}/${skillId}` : "";
  const pathname = usePathname() || "/";
  const catalogHref = buildTenantAwareAppPath(pathname, "/skills") as Route;
  const evaluationsHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const [detail, setDetail] = useState<LoadState<SkillDetailPayload>>(emptyDetail);
  const [source, setSource] = useState<LoadState<SkillSourcePayload>>(emptySource);
  const [assets, setAssets] = useState<LoadState<SkillAssetResponseData>>(emptyAssets);
  const [assetPreview, setAssetPreview] = useState<LoadState<SkillAssetResponseData>>(emptyAssets);
  const [assetSelection, setAssetSelection] = useState<{scope:string;path:string}|null>(null);
  const [draft, setDraft] = useState<{ scope: string; text: string }>({ scope: "", text: "" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reviewed, setReviewed] = useState<{ scope: string; text: string; base: string } | null>(null);
  const [mode, setMode] = useState<"edit" | "preview" | "review">("edit");
  const [workspaceView, setWorkspaceView] = useState<"canvas" | "split" | "code">("canvas");
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
        setWorkspaceView("canvas");
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
  const assetScope = sourceData?.mode === "repository" && sourceData.sourceCommitSha
    ? `${scope}@${sourceData.sourceCommitSha}` : "";
  const activeAssets = assets.scope === assetScope ? assets : emptyAssets;
  const assetData = activeAssets.phase === "ready" ? activeAssets.data : null;
  const chosenPath=assetSelection?.scope===assetScope?assetSelection.path:null;
  const previewKey=chosenPath?`${assetScope}:${chosenPath}`:"";
  const currentPreview=assetPreview.scope===previewKey?assetPreview:emptyAssets;
  const selectedPreview=currentPreview.phase==="ready"?currentPreview.data.selection:null;
  const editorText = draft.scope === scope ? draft.text : "";
  useEffect(()=>{
    if(!enabled||!workspaceSlug||!assetScope||!sourceData)return;
    const controller=new AbortController();
    let active=true;
    queueMicrotask(()=>{
      if(active){setAssets({scope:assetScope,phase:"loading",data:null,error:null});
        setAssetSelection(null);}
    });
    void fetchSkillAssets(skillId,{workspaceSlug,signal:controller.signal}).then(result=>{
      if(!active||controller.signal.aborted)return;
      if(result.data.commitSha!==sourceData.sourceCommitSha)
        throw new Error("Asset index revision differs from the loaded source; reload Workbench.");
      if(sourceData.sourcePath!==result.data.root+"/SKILL.md"
        && sourceData.sourcePath!==result.data.root)
        throw new Error("Indexed asset root differs from the loaded source path.");
      setAssets({scope:assetScope,phase:"ready",data:result.data,error:null});
    }).catch(error=>{
      if(active&&!controller.signal.aborted)setAssets({scope:assetScope,phase:"error",data:null,
        error:error instanceof Error?error.message:"Verified Git asset inventory unavailable."});
    });
    return ()=>{active=false;controller.abort();};
  },[enabled,workspaceSlug,skillId,assetScope,retry,sourceData?.sourceCommitSha,sourceData?.sourcePath]);

  useEffect(()=>{
    if(!enabled||!workspaceSlug||!chosenPath||!previewKey||!assetScope)return;
    const controller=new AbortController();
    let active=true;
    queueMicrotask(()=>{if(active)setAssetPreview({scope:previewKey,phase:"loading",data:null,error:null});});
    void fetchSkillAssets(skillId,{workspaceSlug,path:chosenPath,signal:controller.signal})
      .then(result=>{
        if(!active||controller.signal.aborted)return;
        if(result.data.commitSha!==sourceData?.sourceCommitSha
          ||result.data.selection?.path!==chosenPath)
          throw new Error("Requested file revision or path no longer matches the selected source.");
        setAssetPreview({scope:previewKey,phase:"ready",data:result.data,error:null});
      }).catch(error=>{
        if(active&&!controller.signal.aborted)setAssetPreview({scope:previewKey,phase:"error",
          data:null,error:error instanceof Error?error.message:"File preview unavailable."});
      });
    return ()=>{active=false;controller.abort();};
  },[enabled,workspaceSlug,skillId,chosenPath,previewKey,assetScope,sourceData?.sourceCommitSha]);

  function openObservedFile(path:string){
    if(!assetData||!assetData.files.some(file=>file.path===path))return;
    if(path===assetData.root+"/SKILL.md"){
      setAssetSelection(null);setWorkspaceView("code");setMode("edit");
      return;
    }
    setAssetSelection({scope:assetScope,path});
    setWorkspaceView("code");
  }

  const gate = getWorkbenchGate(sourceData, editorText);
  const pending = notice?.scope === scope && notice.kind === "proposal" ? notice : null;
  const visibleNotice = notice?.scope === scope ? notice : null;
  const hasReviewed = reviewed?.scope === scope && reviewed.text === editorText &&
    reviewed.base === sourceData?.content;
  const comparison = sourceData ? workbenchChangeStats(sourceData.content, editorText) : null;
  const blocks = useMemo(() => parseMarkdownPreviewBlocks(editorText), [editorText]);
  const observedCanvas = useMemo(() =>
    buildObservedWorkbenchCanvas(sourceData,
      currentDetail.phase === "ready" ? currentDetail.data : null),
    [sourceData, currentDetail]);
  useEffect(() => {
    if (!comparison?.changed || pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [comparison?.changed, pending]);
  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (comparison?.changed &&
        !window.confirm("Leave Workbench and discard the unsubmitted draft?")) {
      event.preventDefault();
    }
  };
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
          <Link className={styles.linkButton} href={catalogHref} onClick={guardNavigation}>Back to Library</Link>
          <Link className={styles.linkButton} href={evaluationDetailHref} onClick={guardNavigation}>Evaluations</Link>
          <Link className={styles.linkButton} href={buildTenantAwareAppPath(pathname,"/workflows") as Route} onClick={guardNavigation}>Workflow Studio</Link>
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
          {assetData ? <>
            <p className={styles.note}>Actual files at pinned Git commit <code>{assetData.commitSha.slice(0,12)}</code>. Open to inspect; only SKILL.md can be edited through reviewed proposals.</p>
            <div className={styles.assetTree} role="group" aria-label="Observed Git skill files">
              {assetData.files.map(file=><button key={file.path} type="button"
                className={`${styles.assetItem} ${(chosenPath===file.path||
                  (!chosenPath&&file.kind==="instructions"))?styles.assetSelected:""}`}
                aria-pressed={chosenPath===file.path||(!chosenPath&&file.kind==="instructions")}
                onClick={()=>openObservedFile(file.path)}>
                <Ic.Repo className={styles.icon} aria-hidden="true" />
                <span><strong>{file.relativePath}</strong>
                  <small>{file.kind} · {file.bytes==null?"Size unreported":`${file.bytes} bytes`}</small></span>
                {!chosenPath&&file.kind==="instructions"&&gate.kind==="ready"?
                  <span className={styles.dirty} title="Draft not yet proposed">*</span>:null}
              </button>)}
            </div>
            {!assetData.complete?<p className={styles.note} role="status">
              Inventory truncated: {assetData.omitted} additional allowlisted files are not inspectable in this view.
            </p>:null}
          </>:sourceData?.mode==="repository"?<>
            <div className={styles.file} aria-current="page">
              <Ic.Repo className={styles.icon} aria-hidden="true" />
              <span>{sourceData.sourcePath}</span>
              {gate.kind==="ready"?<span className={styles.dirty} title="Draft not yet proposed">*</span>:null}
            </div>
            {assetScope && activeAssets.phase==="error"?
              <p className={styles.note} role="alert">Git asset inventory unavailable: {activeAssets.error}</p>:
              <p className={styles.note} role="status">{assetScope?
                "Loading authorized Git files…":"Indexed commit unavailable; additional files cannot be verified."}</p>}
          </>:<p className={styles.muted}>No live indexed SKILL.md. Any fallback draft shown in the editor is read-only and is not verified repository content.</p>}
          {observedCanvas.evaluations.length > 0 ? <>
            <h2>Recorded evaluation assets</h2>
            {observedCanvas.evaluations.map(run =>
              <Link key={run.id} className={styles.assetLink} onClick={guardNavigation}
                href={buildTenantAwareAppPath(pathname,
                  `/evaluations/${encodeURIComponent(run.id)}`) as Route}>
                <Ic.Eval className={styles.icon} aria-hidden="true" />{run.dataset}
              </Link>)}
          </> : null}
        </aside>

        <section className={styles.editorPanel} aria-label="SKILL.md source editor">
          <div className={styles.editorToolbar}>
            <div className={styles.tabs} role="group" aria-label="Workbench layout">
              {(["canvas", "split", "code"] as const).map(view =>
                <UiV2Button key={view} size="small"
                  variant={workspaceView === view ? "primary" : "default"}
                  aria-pressed={workspaceView === view}
                  onClick={() => setWorkspaceView(view)}>
                  {view === "canvas" ? "Canvas" : view === "split" ? "Split" : "Code"}
                </UiV2Button>)}
            </div>
            <div className={styles.tabs} role="group" aria-label="Workbench viewing mode">
              <UiV2Button size="small" variant={mode === "edit" ? "primary" : "default"} aria-pressed={mode === "edit"}
                onClick={() => { setAssetSelection(null);setMode("edit"); setWorkspaceView("code"); }}>Edit</UiV2Button>
              <UiV2Button size="small" variant={mode === "preview" ? "primary" : "default"} aria-pressed={mode === "preview"}
                onClick={() => { setAssetSelection(null);setMode("preview"); setWorkspaceView("code"); }}>Preview</UiV2Button>
              <UiV2Button size="small" variant={mode === "review" ? "primary" : "default"} aria-pressed={mode === "review"}
                onClick={() => { setAssetSelection(null);setMode("review"); setWorkspaceView("code"); }}>Compare</UiV2Button>
            </div>
            {comparison ? <span className={styles.muted}>Original {comparison.originalLines} lines · Draft {comparison.proposedLines} lines</span> : null}
          </div>

          <div className={`${styles.workArea} ${workspaceView === "split" ? styles.workAreaSplit : ""}`}>
            {workspaceView !== "code" ? <UiV2CanvasRegion label="Indexed skill and observed evaluation canvas"
              {...(currentSource.phase !== "ready"
                ? { unavailable: "Indexed SKILL.md is not available" }
                : !observedCanvas.source
                  ? { unavailable: "No verified indexed repository source" }
                  : {})}>
              <div className={styles.visualCanvas}>
                <p className={styles.canvasLane}>Indexed source · Git-owned artifact</p>
                {observedCanvas.source ? <button type="button" className={styles.canvasSource}
                  onClick={() => { setAssetSelection(null);setWorkspaceView("code"); setMode("edit"); }}>
                  <span className={styles.canvasType}>SKILL.md · indexed source</span>
                  <strong>{observedCanvas.source.path}</strong>
                  <span>Revision: {observedCanvas.source.commit ?? "Not reported"}</span>
                  <span>Open source editor</span>
                </button> : null}
                <p className={styles.canvasLane}>Recorded evaluations associated with this skill</p>
                {observedCanvas.evaluations.length === 0
                  ? <UiV2EmptyState message="No evaluation summaries recorded for this skill." />
                  : <div className={styles.canvasEvaluations}>{observedCanvas.evaluations.map(run =>
                      <Link key={run.id} className={styles.canvasEval} onClick={guardNavigation}
                        href={buildTenantAwareAppPath(pathname,
                          `/evaluations/${encodeURIComponent(run.id)}`) as Route}>
                        <span className={styles.canvasType}>Evaluation · {run.status}</span>
                        <strong>{run.dataset}</strong>
                        <span>{run.ref} · {run.passed}/{run.cases} cases passed</span>
                      </Link>)}</div>}
                <p className={styles.note}>Evaluation association is skill-level only. A run is not proved
                  to have used the currently indexed source revision.</p>
                <p className={styles.canvasLane}>Declared file dependencies · indexed SKILL.md</p>
                {assetData?<div className={styles.dependencyGraph} aria-label="Observed dependency links from SKILL.md">
                  <div className={styles.dependencyOrigin}>
                    <strong>SKILL.md</strong><span>Git · {assetData.commitSha.slice(0,12)}</span>
                  </div>
                  {assetData.links.length===0?
                    <p className={styles.note}>No Markdown file links declared in this indexed SKILL.md.</p>:
                    assetData.links.map((link,i)=><div key={`${link.line}-${i}`} className={styles.dependencyEdge}>
                      <span aria-hidden="true">→</span>
                      {link.status==="verified"&&link.resolvedPath?
                        <button type="button" className={styles.dependencyTarget}
                          onClick={()=>openObservedFile(link.resolvedPath!)}>
                          <strong>{link.raw}</strong>
                          <small>Verified file · SKILL.md line {link.line}</small>
                        </button>:
                        <span className={styles.dependencyTarget}>
                          <strong>{link.raw}</strong>
                          <small>{link.status} · SKILL.md line {link.line}</small>
                        </span>}
                    </div>)}
                </div>:<UiV2StateBanner state="unavailable"
                  label="No ACL-verified, pinned repository tree available for dependency inspection" />}
                <p className={styles.note}>These edges are authored Markdown file references only.
                  No tool invocation, runtime execution or data lineage has been observed.</p>
              </div>
            </UiV2CanvasRegion> : null}
            {workspaceView !== "canvas" ? <div className={styles.sourceArea}>
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


            </div> : null}
          </div>
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
                    setWorkspaceView("code");
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
