"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useReducer, useState } from "react";

import type {
  ActivityEventItem,
  EvalRunSummary,
  FlaggedCaseItem,
  ReviewerComment,
  SkillDetailPayload,
  SkillSourcePayload,
} from "@savant/types";

import { Ic, ProviderIcon } from "@/components/savant/icons";
import {
  CommitRef,
  Delta,
  EnvPill,
  ProvenanceRail,
  type ProvenanceStep,
  ScoreBar,
  Tier,
} from "@/components/savant/primitives";
import {
  fetchSkillDetail,
  fetchSkillSource,
  updateSkillSource,
} from "@/lib/control-plane-client";
import {
  buildSkillRecommendationQueueScope,
  buildSkillRecommendationQueueStorageKey,
  parseQueuedSkillRecommendations,
  type QueuedSkillRecommendation,
} from "@/lib/evaluation-recommendation-queue.ts";
import {
  insertQueuedSkillRecommendationsIntoDraft,
  parseMarkdownPreviewBlocks,
} from "@/lib/skill-builder";
import { buildRepositoryWebUrl } from "@/lib/repository-links";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";

type TabKey = "evaluation" | "builder" | "versions" | "access" | "activity";

type LoadStatus = "idle" | "loading" | "error" | "success";

type SaveStatus = "idle" | "saving" | "error" | "success";

type BuilderFeedback = {
  tone: "info" | "success" | "error";
  message: string;
};

const EMPTY_QUEUED_RECOMMENDATIONS: QueuedSkillRecommendation[] = [];
const queuedRecommendationSnapshotCache = new Map<
  string,
  { rawValue: string | null; parsed: QueuedSkillRecommendation[] }
>();

function subscribeToQueuedRecommendationStorage(
  storageKey: string | null,
  onStoreChange: () => void,
) {
  if (typeof window === "undefined" || !storageKey) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("storage", handleStorage);
  };
}

function readQueuedRecommendationSnapshot(storageKey: string | null): QueuedSkillRecommendation[] {
  if (typeof window === "undefined" || !storageKey) {
    return EMPTY_QUEUED_RECOMMENDATIONS;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  const cachedSnapshot = queuedRecommendationSnapshotCache.get(storageKey);

  if (cachedSnapshot && cachedSnapshot.rawValue === rawValue) {
    return cachedSnapshot.parsed;
  }

  const parsedSnapshot = rawValue
    ? parseQueuedSkillRecommendations(rawValue)
    : EMPTY_QUEUED_RECOMMENDATIONS;
  const normalizedSnapshot = parsedSnapshot.length > 0
    ? parsedSnapshot
    : EMPTY_QUEUED_RECOMMENDATIONS;

  queuedRecommendationSnapshotCache.set(storageKey, {
    rawValue,
    parsed: normalizedSnapshot,
  });

  return normalizedSnapshot;
}

function formatQueuedRecommendationValue(value: string): string {
  if (!value.trim()) {
    return "Unknown";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function queuedRecommendationChipClass(recommendation: QueuedSkillRecommendation) {
  if (recommendation.effort === "high") {
    return "chip chip-blood";
  }

  if (recommendation.effort === "medium") {
    return "chip chip-brass";
  }

  return "chip chip-moss";
}

export function SkillScreen({ skillId }: { skillId: string }) {
  const [tab, setTab] = useState<TabKey>("builder");
  const pathname = usePathname() || "/";
  const catalogHref = buildTenantAwareAppPath(pathname, "/skills") as Route;
  const [detail, setDetail] = useState<SkillDetailPayload | null>(null);
  const [detailStatus, setDetailStatus] = useState<LoadStatus>("loading");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [source, setSource] = useState<SkillSourcePayload | null>(null);
  const [sourceStatus, setSourceStatus] = useState<LoadStatus>("idle");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [builderFeedback, setBuilderFeedback] = useState<BuilderFeedback | null>(null);
  const [, bumpQueuedRecommendationsVersion] = useReducer(
    (current: number) => current + 1,
    0,
  );
  const sourceSkillId = source?.skillId ?? null;
  const sourceSkillUuid = source?.skillUuid ?? null;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadSkillDetail() {
      setDetailStatus("loading");
      setDetailError(null);

      try {
        const response = await fetchSkillDetail(skillId, { signal: controller.signal });

        if (!active) {
          return;
        }

        setDetail(response.data);
        setDetailStatus("success");
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setDetailStatus("error");
        setDetailError(
          error instanceof Error ? error.message : "Could not load the skill detail.",
        );
      }
    }

    void loadSkillDetail();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken, skillId]);

  useEffect(() => {
    if (tab !== "builder" || detailStatus !== "success" || !detail) {
      return;
    }

    const activeSourceMatchesCurrentSkill = sourceSkillId === detail.skill.id || sourceSkillUuid === detail.skill.skillUuid;

    if (sourceStatus === "loading" || activeSourceMatchesCurrentSkill) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadSkillSource() {
      setSourceStatus("loading");
      setSourceError(null);

      try {
        const response = await fetchSkillSource(skillId, { signal: controller.signal });

        if (!active) {
          return;
        }

        setSource(response.data);
        setDraft(response.data.content);
        setSourceStatus("success");
        setSaveStatus("idle");
        setSaveMessage(null);
        setBuilderFeedback(null);
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setSourceStatus("error");
        setSourceError(
          error instanceof Error ? error.message : "Could not load the skill source.",
        );
      }
    }

    void loadSkillSource();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    detail,
    detailStatus,
    skillId,
    sourceSkillId,
    sourceSkillUuid,
    sourceStatus,
    tab,
  ]);

  const skill = detail?.skill ?? null;
  const latestEval = detail?.evaluations[0] ?? null;
  const activeSource = source && skill && source.skillId === skill.id ? source : null;
  const queueStorageKey = skill
    ? buildSkillRecommendationQueueStorageKey(buildSkillRecommendationQueueScope({
        id: skill.id,
        name: skill.name,
        team: skill.team,
        repo: skill.repo,
        branch: skill.branch,
      }))
    : null;

  useEffect(() => {
    if (!queueStorageKey) {
      return;
    }

    return subscribeToQueuedRecommendationStorage(queueStorageKey, () => {
      bumpQueuedRecommendationsVersion();
    });
  }, [queueStorageKey]);

  const queuedRecommendations = readQueuedRecommendationSnapshot(queueStorageKey);

  const repositoryHref = skill
    ? buildRepositoryWebUrl({
        provider: skill.repoProvider,
        name: skill.repo,
      })
    : null;
  const latestEvalHref = latestEval
    ? buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(latestEval.id)}`) as Route
    : null;
  const railSteps = useMemo(() => buildRailSteps(detail), [detail]);
  const builderIsDirty = activeSource ? draft !== activeSource.content : false;

  async function saveBuilderDraft() {
    if (!activeSource || !builderIsDirty || !activeSource.canSave || saveStatus === "saving") {
      return;
    }

    setSaveStatus("saving");
    setSaveMessage(null);
    setBuilderFeedback(null);

    try {
      const response = await updateSkillSource(skillId, {
        content: draft,
      });

      setSource({
        ...activeSource,
        content: draft,
        sourceCommitSha: response.data.commit.sha,
        canSave: true,
        saveDisabledReason: undefined,
      });
      setSaveStatus("success");
      setSaveMessage(
        response.data.warnings.length > 0
          ? response.data.warnings.join(" ")
          : `Saved ${activeSource.sourcePath} to ${response.data.branch}.`,
      );
      setReloadToken((current) => current + 1);
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error ? error.message : "Could not save the skill source.",
      );
    }
  }

  function resetBuilderDraft() {
    setDraft(activeSource?.content ?? "");
    setSaveStatus("idle");
    setSaveMessage(null);
    setBuilderFeedback(null);
  }

  function insertQueuedRecommendationsIntoBuilder(nextRecommendations: QueuedSkillRecommendation[]) {
    if (!activeSource) {
      setBuilderFeedback({
        tone: "error",
        message: "Load the current Builder source before inserting queued recommendations.",
      });
      return;
    }

    const result = insertQueuedSkillRecommendationsIntoDraft(draft, nextRecommendations);

    if (result.insertedCount > 0) {
      setDraft(result.draft);
      setSaveStatus("idle");
      setSaveMessage(null);
      setBuilderFeedback({
        tone: "success",
        message: `Inserted ${result.insertedCount} queued recommendation${result.insertedCount === 1 ? "" : "s"} into the draft. Save SKILL.md when you are ready.`,
      });
      return;
    }

    setBuilderFeedback({
      tone: "info",
      message: nextRecommendations.length === 1
        ? "That queued recommendation is already present in the draft."
        : "All queued recommendations are already present in the draft.",
    });
  }

  function insertQueuedRecommendation(queueId: string) {
    const recommendation = queuedRecommendations.find((candidate) => candidate.queueId === queueId);

    if (!recommendation) {
      setBuilderFeedback({
        tone: "error",
        message: "That queued recommendation is no longer available. Refresh the page and try again.",
      });
      return;
    }

    insertQueuedRecommendationsIntoBuilder([recommendation]);
  }

  function insertAllQueuedRecommendations() {
    insertQueuedRecommendationsIntoBuilder(queuedRecommendations);
  }

  if (detailStatus === "loading" && !detail) {
    return <ScreenState kind="loading" message="Loading governed skill detail from the control-plane API…" />;
  }

  if (detailStatus === "error" && !detail) {
    return (
      <ScreenState
        kind="error"
        message={detailError ?? "Could not load the skill detail."}
        actionLabel="Retry"
        onAction={() => setReloadToken((current) => current + 1)}
      />
    );
  }

  if (!detail || !skill) {
    return <ScreenState kind="error" message="Skill detail is unavailable." />;
  }

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="page-head-meta">
            <Link href={catalogHref} className="link">
              Catalog
            </Link>
            <span className="sep">/</span>
            <span>{skill.team}</span>
            <span className="sep">/</span>
            <span>Tier {skill.tier}</span>
          </div>
          <div className="row" style={{ gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 className="h-display">{skill.name}</h1>
            <Tier n={skill.tier} />
            <EnvPill env={skill.channel} />
          </div>
          <div className="page-head-sub">{skill.description}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {latestEvalHref ? (
            <Link href={latestEvalHref} className="btn btn-ghost">
              <Ic.Eval className="b-icon" />
              Open latest eval
            </Link>
          ) : null}
          {repositoryHref ? (
            <a href={repositoryHref} target="_blank" rel="noreferrer" className="btn btn-ghost">
              <Ic.ExternalLink className="b-icon" />
              View in {skill.repoProvider}
            </a>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setReloadToken((current) => current + 1)}
          >
            <Ic.Refresh className="b-icon" />
            Refresh
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Lifecycle
        </div>
        <ProvenanceRail steps={railSteps} />
      </div>

      <div
        style={{
          borderBottom: "1px solid var(--rule)",
          marginBottom: 20,
          display: "flex",
          gap: 0,
        }}
      >
        {(
          [
            ["builder", "Builder", queuedRecommendations.length > 0 ? `${queuedRecommendations.length} queued` : source?.mode === "repository" ? source.sourcePath : undefined],
            ["evaluation", "Evaluation", `${detail.flaggedCases.length} flagged`],
            ["versions", "Versions", `${skill.versionCount}`],
            ["access", "Access"],
            ["activity", "Activity"],
          ] as Array<[TabKey, string, string?]>
        ).map(([k, label, badge]) => (
          <button
            type="button"
            key={k}
            onClick={() => setTab(k)}
            className={`tab ${tab === k ? "active" : ""}`}
            style={{ padding: "0 18px", background: "transparent", border: 0 }}
          >
            <span>{label}</span>
            {badge ? <span className="tab-count">{badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "evaluation" && <EvaluationTab detail={detail} pathname={pathname} />}
      {tab === "builder" && (
        <BuilderTab
          detail={detail}
          pathname={pathname}
          draft={activeSource ? draft : ""}
          source={activeSource}
          sourceStatus={sourceStatus}
          sourceError={sourceError}
          saveStatus={saveStatus}
          saveMessage={saveMessage}
          feedback={builderFeedback}
          queuedRecommendations={queuedRecommendations}
          isDirty={builderIsDirty}
          onDraftChange={setDraft}
          onResetDraft={resetBuilderDraft}
          onSaveDraft={() => {
            void saveBuilderDraft();
          }}
          onInsertQueuedRecommendation={insertQueuedRecommendation}
          onInsertAllQueuedRecommendations={insertAllQueuedRecommendations}
          onRetryLoad={() => {
            setSource(null);
            setSourceStatus("idle");
            setSourceError(null);
            setDraft("");
            setSaveStatus("idle");
            setSaveMessage(null);
            setBuilderFeedback(null);
          }}
        />
      )}
      {tab === "versions" && <VersionsTab detail={detail} />}
      {tab === "access" && <AccessTab detail={detail} />}
      {tab === "activity" && <ActivityTab detail={detail} />}
    </div>
  );
}

function buildRailSteps(detail: SkillDetailPayload | null): ProvenanceStep[] {
  if (!detail) {
    return [];
  }

  const latestEval = detail.evaluations[0] ?? null;
  const approvedCount = detail.requiredApprovals.filter((approval) => approval.status === "approved").length;
  const currentRef = detail.skill.candidateRef !== "—" ? detail.skill.candidateRef : detail.skill.ref;
  const currentCommit = detail.skill.candidateCommit !== "—"
    ? detail.skill.candidateCommit
    : detail.skill.commit;
  const evalValue = latestEval
    ? `${latestEval.cases} cases · ${detail.flaggedCases.length} flagged`
    : "Awaiting first run";
  const evalMeta = latestEval
    ? `${latestEval.dataset} · ${latestEval.duration} · ${latestEval.started}`
    : "Run an evaluation to capture baseline deltas.";

  return [
    {
      label: "Repository",
      value: detail.skill.repo,
      meta: (
        <span className="row" style={{ gap: 4 }}>
          <ProviderIcon p={detail.skill.repoProvider} size={9} />
          <span className="muted">{detail.skill.repoProvider}</span>
        </span>
      ),
      state: "ok",
    },
    {
      label: "Reference",
      value: currentRef,
      meta: (
        <span className="mono subtle" style={{ fontSize: 10.5 }}>
          {currentCommit} · {detail.skill.branch}
        </span>
      ),
      state: detail.skill.candidateRef !== "—" ? "now" : "ok",
    },
    {
      label: "Evaluation",
      value: evalValue,
      meta: <span className="muted">{evalMeta}</span>,
      state: latestEval?.status === "running" || latestEval?.status === "failed"
        ? "warn"
        : detail.flaggedCases.length > 0
          ? "warn"
          : "ok",
    },
    {
      label: "Approval",
      value: `${approvedCount} of ${detail.requiredApprovals.length} approved`,
      meta: <span className="muted">{detail.requiredApprovals.find((approval) => approval.status === "pending")?.role ?? "Ready for release"}</span>,
      state: approvedCount === detail.requiredApprovals.length ? "ok" : "now",
    },
    {
      label: "Release",
      value: detail.activeRelease
        ? `${detail.activeRelease.toEnv} · ${detail.activeRelease.candidateRef}`
        : detail.skill.channel === "production"
          ? `Production · ${detail.skill.ref}`
          : `Channel · ${detail.skill.channel}`,
      meta: (
        <span className="muted">
          {detail.activeRelease
            ? `${detail.activeRelease.readinessPct}% ready · ${detail.activeRelease.when}`
            : detail.skill.channel === "production"
              ? `Last eval ${detail.skill.lastEval}`
              : "Promote after approval"}
        </span>
      ),
      state: detail.activeRelease ? "now" : detail.skill.channel === "production" ? "ok" : "",
    },
  ];
}

function EvaluationTab({
  detail,
  pathname,
}: {
  detail: SkillDetailPayload;
  pathname: string;
}) {
  const latestEval = detail.evaluations[0] ?? null;
  const passRate = latestEval ? Math.round((latestEval.passed / Math.max(latestEval.cases, 1)) * 1000) / 10 : null;
  const latestEvalHref = latestEval
    ? buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(latestEval.id)}`) as Route
    : null;

  return (
    <div className="split wide">
      <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
        <div className={`note ${latestEval?.status === "complete-with-regressions" || latestEval?.status === "failed" || detail.flaggedCases.length > 0 ? "brass" : ""}`}>
          {latestEval?.status === "running"
            ? <Ic.Spinner className="n-icon" />
            : latestEval?.status === "failed"
              ? <Ic.Warn className="n-icon" />
              : <Ic.Eval className="n-icon" />}
          <div className="grow">
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--brass-deep)" }}>
              {latestEval
                ? buildEvaluationBanner(detail, latestEval)
                : "This skill has not completed a control-plane evaluation yet."}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--brass-deep)", opacity: 0.8, marginTop: 2 }}
            >
              {latestEval
                ? (
                    <>
                      Eval set: <span className="mono">{latestEval.dataset}</span> · {latestEval.cases} cases · {latestEval.started} · {latestEval.duration}
                    </>
                  )
                : "Run or connect an evaluation to populate rubric and regression context here."}
            </div>
          </div>
          {latestEvalHref ? (
            <Link
              href={latestEvalHref}
              className="btn btn-sm"
              style={{ background: "var(--panel)", borderColor: "var(--rule-2)" }}
            >
              Open eval <Ic.ChevR className="b-icon" />
            </Link>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Run summary</div>
            {detail.activeRelease ? (
              <span className="chip chip-brass">{detail.activeRelease.readinessPct}% ready for {detail.activeRelease.toEnv}</span>
            ) : null}
          </div>
          <div className="panel-bd" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            <Score label="Overall" value={detail.skill.score} />
            <Score
              label="Pass rate"
              value={passRate}
              unit="%"
              {...(latestEval?.delta != null ? { delta: latestEval.delta } : {})}
            />
            <Score label="Flagged cases" value={detail.flaggedCases.length} />
            <Score label="Versions tracked" value={detail.versionHistory.length} />
          </div>
        </div>

        <RecentEvaluationsPanel evaluations={detail.evaluations} pathname={pathname} />

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Rubric breakdown</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              {detail.rubricBaseline.length} metrics
            </span>
          </div>
          <div className="panel-bd">
            {detail.rubricBaseline.length > 0 ? detail.rubricBaseline.map((row, index) => (
              <ScoreBar
                key={`${row.label}-${index}`}
                label={row.label}
                baseline={row.baseline}
                candidate={row.candidate}
                dir={row.direction}
              />
            )) : (
              <EmptyPanelState message="Rubric comparisons will appear after the first indexed evaluation run." />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="row" style={{ gap: 10 }}>
              <div className="panel-title">Flagged cases</div>
              <span className="chip chip-blood">{detail.flaggedCases.length}</span>
            </div>
          </div>
          <div className="panel-bd tight">
            {detail.flaggedCases.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 100 }}>Case</th>
                    <th>Description</th>
                    <th>Rubric</th>
                    <th style={{ textAlign: "right" }}>Baseline</th>
                    <th style={{ textAlign: "right" }}>Candidate</th>
                    <th style={{ textAlign: "right" }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.flaggedCases.map((flag) => (
                    <FlagRow key={flag.caseId} flag={flag} />
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyPanelState message="No flagged cases are attached to the current evaluation set." />
            )}
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: "var(--gutter)" }}>
        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Approval timeline</div>
            <span className="chip chip-brass">
              <span className="dot" />
              {detail.requiredApprovals.some((approval) => approval.status === "pending")
                ? "awaiting approval"
                : "ready for release"}
            </span>
          </div>
          <div className="panel-bd">
            <div className="tl">
              {detail.approvalTimeline.map((event, index) => (
                <div className="tl-item" key={`${event.when}-${event.role}-${index}`}>
                  <span className={`tl-node ${event.node}`} />
                  <div>
                    <div className="tl-pri">
                      <b>{event.who}</b> <span className="muted">{event.action}</span>
                    </div>
                    <div className="tl-sec">{event.role}</div>
                  </div>
                  <div className="tl-meta">{event.when}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Required approvals</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              {detail.requiredApprovals.filter((approval) => approval.status === "approved").length} of {detail.requiredApprovals.length}
            </span>
          </div>
          <div className="panel-bd tight">
            {detail.requiredApprovals.map((approval) => (
              <ApprovalRow
                key={approval.role}
                role={approval.role}
                who={approval.assignee ?? "—"}
                status={approval.status}
                when={approval.when ?? "—"}
              />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Reviewer notes</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              {detail.reviewerComments.length}
            </span>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {detail.reviewerComments.length > 0 ? detail.reviewerComments.map((comment, index) => (
              <CommentRow key={`${comment.who}-${comment.when}-${index}`} comment={comment} />
            )) : (
              <EmptyPanelState message="No reviewer comments have been indexed for this skill yet." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BuilderTab({
  detail,
  pathname,
  source,
  draft,
  sourceStatus,
  sourceError,
  saveStatus,
  saveMessage,
  feedback,
  queuedRecommendations,
  isDirty,
  onDraftChange,
  onResetDraft,
  onSaveDraft,
  onInsertQueuedRecommendation,
  onInsertAllQueuedRecommendations,
  onRetryLoad,
}: {
  detail: SkillDetailPayload;
  pathname: string;
  source: SkillSourcePayload | null;
  draft: string;
  sourceStatus: LoadStatus;
  sourceError: string | null;
  saveStatus: SaveStatus;
  saveMessage: string | null;
  feedback: BuilderFeedback | null;
  queuedRecommendations: QueuedSkillRecommendation[];
  isDirty: boolean;
  onDraftChange: (nextDraft: string) => void;
  onResetDraft: () => void;
  onSaveDraft: () => void;
  onInsertQueuedRecommendation: (queueId: string) => void;
  onInsertAllQueuedRecommendations: () => void;
  onRetryLoad: () => void;
}) {
  const previewBlocks = useMemo(
    () => parseMarkdownPreviewBlocks(draft),
    [draft],
  );

  return (
    <div className="split wide">
      <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
        {sourceStatus === "loading" ? (
          <div className="note">
            <Ic.Spinner className="n-icon" />
            <span>Loading the current SKILL.md source…</span>
          </div>
        ) : null}
        {sourceStatus === "error" ? (
          <div className="note blood" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <Ic.XCircle className="n-icon" />
              <span>{sourceError ?? "Could not load the skill source."}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetryLoad}>
              Retry
            </button>
          </div>
        ) : null}
        {feedback ? (
          <div className={`note ${feedback.tone === "error" ? "blood" : ""}`}>
            {feedback.tone === "error" ? <Ic.XCircle className="n-icon" /> : <Ic.Check className="n-icon" />}
            <span>{feedback.message}</span>
          </div>
        ) : null}
        {source ? (
          <>
            <div className={`note ${source.mode === "fallback" ? "brass" : ""}`}>
              {source.mode === "repository" ? <Ic.Repo className="n-icon" /> : <Ic.Warn className="n-icon" />}
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  {source.mode === "repository"
                    ? `Editing ${source.sourcePath} from ${source.branch}.`
                    : "Showing a generated builder draft because live SKILL.md content is unavailable."}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {source.mode === "repository"
                    ? `Source commit ${source.sourceCommitSha ?? "pending"} · ${source.repository}`
                    : source.saveDisabledReason ?? "Connect a supported provider-backed repository to enable live Builder edits."}
                </div>
              </div>
            </div>

            {saveStatus !== "idle" && saveMessage ? (
              <div className={`note ${saveStatus === "error" ? "blood" : saveStatus === "success" && source.mode === "fallback" ? "brass" : ""}`}>
                {saveStatus === "error" ? <Ic.XCircle className="n-icon" /> : <Ic.Check className="n-icon" />}
                <span>{saveMessage}</span>
              </div>
            ) : null}

            <div className="panel">
              <div className="panel-hd">
                <div className="panel-title">Markdown source</div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={onResetDraft} disabled={!isDirty || saveStatus === "saving"}>
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={onSaveDraft}
                    disabled={!isDirty || !source.canSave || saveStatus === "saving"}
                  >
                    {saveStatus === "saving" ? <Ic.Spinner className="b-icon" /> : <Ic.Check className="b-icon" />}
                    Save SKILL.md
                  </button>
                </div>
              </div>
              <div className="panel-bd" style={{ padding: 0 }}>
                <textarea
                  value={draft}
                  onChange={(event) => {
                    onDraftChange(event.target.value);
                  }}
                  spellCheck={false}
                  aria-label="SKILL markdown source"
                  style={{
                    width: "100%",
                    minHeight: 540,
                    border: 0,
                    resize: "vertical",
                    outline: "none",
                    padding: 18,
                    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="col" style={{ gap: "var(--gutter)" }}>
        <QueuedRecommendationsPanel
          pathname={pathname}
          queuedRecommendations={queuedRecommendations}
          canInsert={Boolean(source)}
          onInsertQueuedRecommendation={onInsertQueuedRecommendation}
          onInsertAllQueuedRecommendations={onInsertAllQueuedRecommendations}
        />

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Preview</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              Safe markdown preview
            </span>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {previewBlocks.length > 0 ? previewBlocks.map((block, index) => (
              <MarkdownPreviewBlockView key={`${block.type}-${index}`} block={block} />
            )) : (
              <EmptyPanelState message="Add markdown content to start building the skill source." />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div className="panel-title">Implementation context</div>
            <span className="subtle" style={{ fontSize: 11.5 }}>
              Live evaluation signals
            </span>
          </div>
          <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <ContextMetric label="Latest eval" value={detail.evaluations[0]?.dataset ?? "Not available yet"} />
            <ContextMetric label="Flagged cases" value={String(detail.flaggedCases.length)} />
            <ContextMetric label="Reviewer comments" value={String(detail.reviewerComments.length)} />
            <ContextMetric label="Source path" value={source?.sourcePath ?? "SKILL.md"} mono />

            {detail.flaggedCases.slice(0, 3).length > 0 ? (
              <div className="col" style={{ gap: 8 }}>
                <div className="eyebrow" style={{ fontSize: 10 }}>Top flagged cases</div>
                {detail.flaggedCases.slice(0, 3).map((flag) => (
                  <div
                    key={flag.caseId}
                    style={{
                      padding: "10px 12px",
                      border: "1px solid var(--rule)",
                      borderRadius: 4,
                      background: "var(--linen)",
                    }}
                  >
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>#{flag.caseId} · {flag.rubric}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{flag.description}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function QueuedRecommendationsPanel({
  pathname,
  queuedRecommendations,
  canInsert,
  onInsertQueuedRecommendation,
  onInsertAllQueuedRecommendations,
}: {
  pathname: string;
  queuedRecommendations: QueuedSkillRecommendation[];
  canInsert: boolean;
  onInsertQueuedRecommendation: (queueId: string) => void;
  onInsertAllQueuedRecommendations: () => void;
}) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <div>
          <div className="panel-title">Queued from evaluations</div>
          <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
            Recommendations marked <strong style={{ color: "var(--ink)" }}>Queue next</strong> show up here until their evaluation decision changes.
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {queuedRecommendations.length > 1 ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onInsertAllQueuedRecommendations} disabled={!canInsert}>
              Insert all
            </button>
          ) : null}
          <span className="chip chip-paper">{queuedRecommendations.length} queued</span>
        </div>
      </div>
      <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {queuedRecommendations.length > 0 ? queuedRecommendations.map((recommendation) => {
          const evaluationHref = buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(recommendation.evaluationUuid)}`) as Route;

          return (
            <div
              key={recommendation.queueId}
              style={{
                border: "1px solid var(--rule)",
                borderRadius: 6,
                background: "var(--linen)",
                padding: "12px 14px",
                display: "grid",
                gap: 10,
              }}
            >
              <div className="row between" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{recommendation.title}</div>
                  <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
                    {recommendation.evaluationRef} · {recommendation.evaluationDataset} · {recommendation.evaluationStarted}
                  </div>
                </div>
                <span className={queuedRecommendationChipClass(recommendation)}>
                  {formatQueuedRecommendationValue(recommendation.category)} · {formatQueuedRecommendationValue(recommendation.effort)}
                </span>
              </div>

              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
                {recommendation.rationale}
              </div>

              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
                {recommendation.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => onInsertQueuedRecommendation(recommendation.queueId)}
                  disabled={!canInsert}
                >
                  Insert into draft
                </button>
                <Link href={evaluationHref} className="btn btn-sm btn-ghost">
                  Open eval
                </Link>
              </div>
            </div>
          );
        }) : (
          <EmptyPanelState message="Mark a recommendation as Queue next on an evaluation to bring it here." />
        )}
      </div>
    </div>
  );
}

function RecentEvaluationsPanel({
  evaluations,
  pathname,
}: {
  evaluations: EvalRunSummary[];
  pathname: string;
}) {
  return (
    <div className="panel">
      <div className="panel-hd">
        <div className="panel-title">Recent evaluations</div>
        <span className="subtle" style={{ fontSize: 11.5 }}>
          {evaluations.length}
        </span>
      </div>
      <div className="panel-bd tight">
        {evaluations.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Dataset</th>
                <th style={{ textAlign: "right" }}>Cases</th>
                <th style={{ textAlign: "right" }}>Pass</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Δ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((evaluation) => {
                const href = buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(evaluation.id)}`) as Route;

                return (
                  <tr key={evaluation.id}>
                    <td>
                      <div className="tbl-name-text">
                        <span className="pri mono">{evaluation.ref}</span>
                        <span className="sec">{evaluation.started}</span>
                      </div>
                    </td>
                    <td>{evaluation.dataset}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{evaluation.cases}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{evaluation.passed}</td>
                    <td>{renderEvaluationStatusChip(evaluation.status)}</td>
                    <td style={{ textAlign: "right" }}>
                      {evaluation.delta == null ? <span className="subtle">—</span> : <Delta v={evaluation.delta} />}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={href} className="btn btn-sm">Open</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyPanelState message="No evaluations are attached to this skill yet." />
        )}
      </div>
    </div>
  );
}

function FlagRow({ flag }: { flag: FlaggedCaseItem }) {
  return (
    <tr>
      <td>
        <span className="mono num">#{flag.caseId}</span>
      </td>
      <td>{flag.description}</td>
      <td className="muted" style={{ fontSize: 12 }}>
        {flag.rubric}
      </td>
      <td className="mono num" style={{ textAlign: "right" }}>
        {flag.baseline.toFixed(2)}
      </td>
      <td className="mono num" style={{ textAlign: "right", color: "var(--oxblood)" }}>
        {flag.candidate.toFixed(2)}
      </td>
      <td style={{ textAlign: "right" }}>
        <Delta v={flag.delta * 100} />
      </td>
    </tr>
  );
}

function Score({
  label,
  value,
  delta,
  unit,
  worseUp,
}: {
  label: string;
  value: number | null;
  delta?: number;
  unit?: string;
  worseUp?: boolean;
}) {
  let deltaColor = "var(--subtle)";
  if (delta != null) {
    const bad = worseUp ? delta > 0 : delta < 0;
    deltaColor = bad ? "var(--oxblood)" : "var(--moss)";
  }
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
        {value == null ? (
          <span className="h-display" style={{ fontSize: 20, color: "var(--subtle)" }}>—</span>
        ) : (
          <span className="h-display" style={{ fontSize: 20 }}>
            {value.toFixed(1)}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{unit || ""}</span>
          </span>
        )}
        {delta != null && (
          <span className="mono num" style={{ fontSize: 11, color: deltaColor }}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
            {unit || ""}
          </span>
        )}
      </div>
    </div>
  );
}

function ApprovalRow({
  role,
  who,
  status,
  when,
}: {
  role: string;
  who: string;
  status: "approved" | "pending";
  when: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--rule)",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>{role}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {who === "—" ? "Awaiting reviewer assignment" : who}
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {status === "approved" ? (
          <span className="chip chip-moss">
            <Ic.Check style={{ width: 10, height: 10 }} />
            Approved
          </span>
        ) : (
          <span className="chip chip-brass">
            <Ic.Clock style={{ width: 10, height: 10 }} />
            Pending
          </span>
        )}
        <span
          className="subtle"
          style={{ fontSize: 11.5, width: 56, textAlign: "right" as const }}
        >
          {when}
        </span>
      </div>
    </div>
  );
}

type Version = {
  ref: string;
  commit: string;
  who: string;
  when: string;
  channel: "candidate" | "production" | "archived";
  score: number;
  delta: number;
};

function VersionsTab({ detail }: { detail: SkillDetailPayload }) {
  const versions: Version[] = detail.versionHistory;

  return (
    <div className="panel">
      <div className="panel-hd">
        <div className="panel-title">Version history</div>
        <span className="subtle" style={{ fontSize: 11.5 }}>
          {versions.length} tracked revisions
        </span>
      </div>
      <div className="panel-bd tight">
        {versions.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Version</th>
                <th>Commit</th>
                <th>Author</th>
                <th>Channel</th>
                <th>Released</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th style={{ textAlign: "right" }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version, index) => (
                <tr key={`${version.ref}-${index}`}>
                  <td>
                    <span className="mono num" style={{ color: "var(--ink)", fontWeight: 500 }}>
                      {version.ref}
                    </span>
                  </td>
                  <td>
                    <CommitRef commit={version.commit} />
                  </td>
                  <td className="muted">{version.who}</td>
                  <td>
                    {version.channel === "candidate" ? (
                      <span className="chip chip-brass">candidate</span>
                    ) : version.channel === "production" ? (
                      <EnvPill env="production" />
                    ) : (
                      <span className="chip chip-paper">archived</span>
                    )}
                  </td>
                  <td className="subtle">{version.when}</td>
                  <td className="mono num" style={{ textAlign: "right" }}>
                    {version.score.toFixed(1)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Delta v={version.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyPanelState message="No indexed versions are available for this skill yet." />
        )}
      </div>
    </div>
  );
}

function AccessTab({ detail }: { detail: SkillDetailPayload }) {
  return (
    <div className="grid-2" style={{ alignItems: "flex-start" }}>
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Groups with access</div>
          <span className="subtle" style={{ fontSize: 11.5 }}>
            {detail.accessGrants.length}
          </span>
        </div>
        <div className="panel-bd tight">
          {detail.accessGrants.length > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Members</th>
                  <th>Permissions</th>
                  <th>Source</th>
                  <th style={{ textAlign: "right" }}>Last sync</th>
                </tr>
              </thead>
              <tbody>
                {detail.accessGrants.map((grant) => (
                  <tr key={grant.name}>
                    <td>
                      <span className="mono" style={{ color: "var(--ink)" }}>
                        {grant.name}
                      </span>
                    </td>
                    <td className="num">{grant.members}</td>
                    <td className="muted">{grant.permission}</td>
                    <td>
                      <span className="chip chip-paper">{grant.source}</span>
                    </td>
                    <td className="subtle" style={{ textAlign: "right" }}>
                      {grant.lastSync}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyPanelState message="No access grants are indexed for this skill yet." />
          )}
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Access policy</div>
          <span className="subtle" style={{ fontSize: 11.5 }}>
            {detail.accessPolicyRules.length} rules
          </span>
        </div>
        <div className="panel-bd" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {detail.accessPolicyRules.length > 0 ? detail.accessPolicyRules.map((policy, index) => (
            <div
              key={`${policy.rule}-${index}`}
              style={{
                padding: "10px 12px",
                border: "1px solid var(--rule)",
                borderRadius: 4,
                background: "var(--linen)",
              }}
            >
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>
                {policy.rule}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{policy.value}</div>
            </div>
          )) : <EmptyPanelState message="No access policy rules are attached to this skill yet." />}
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ detail }: { detail: SkillDetailPayload }) {
  return (
    <div className="grid-2" style={{ alignItems: "flex-start" }}>
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Activity log</div>
          <span className="subtle" style={{ fontSize: 11.5 }}>
            {detail.activityLog.length}
          </span>
        </div>
        <div className="panel-bd">
          {detail.activityLog.length > 0 ? (
            <Timeline events={detail.activityLog} />
          ) : (
            <EmptyPanelState message="No activity events have been recorded for this skill yet." />
          )}
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd">
          <div className="panel-title">Audit highlights</div>
          <span className="subtle" style={{ fontSize: 11.5 }}>
            {detail.auditHighlights.length}
          </span>
        </div>
        <div className="panel-bd">
          {detail.auditHighlights.length > 0 ? (
            <Timeline events={detail.auditHighlights} />
          ) : (
            <EmptyPanelState message="No audit highlights are attached to this skill yet." />
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenState({
  kind,
  message,
  actionLabel,
  onAction,
}: {
  kind: "loading" | "error";
  message: string;
  actionLabel?: string;
  onAction?: (() => void) | undefined;
}) {
  return (
    <div className="page-inner">
      <div className={`note ${kind === "error" ? "blood" : ""}`} style={{ marginTop: 24, justifyContent: "space-between", alignItems: "center" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          {kind === "loading" ? <Ic.Spinner className="n-icon" /> : <Ic.XCircle className="n-icon" />}
          <span>{message}</span>
        </div>
        {actionLabel && onAction ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyPanelState({ message }: { message: string }) {
  return (
    <div className="note">
      <Ic.Overview className="n-icon" />
      <span>{message}</span>
    </div>
  );
}

function CommentRow({ comment }: { comment: ReviewerComment }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="avatar sm">{comment.who.slice(0, 2).toUpperCase()}</span>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{comment.who}</span>
        <span className="subtle" style={{ fontSize: 11.5 }}>
          {comment.when}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.5,
          paddingLeft: 28,
        }}
      >
        {comment.text}
      </div>
    </div>
  );
}

function ContextMetric({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--rule)",
        borderRadius: 4,
        background: "var(--linen)",
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div className={mono ? "mono" : undefined} style={{ fontSize: 13, color: "var(--ink)" }}>{value}</div>
    </div>
  );
}

function MarkdownPreviewBlockView({
  block,
}: {
  block: ReturnType<typeof parseMarkdownPreviewBlocks>[number];
}) {
  if (block.type === "heading") {
    const size = 24 - (block.level - 1) * 2;

    return (
      <div style={{ fontSize: size, fontWeight: 600, color: "var(--ink)", lineHeight: 1.25 }}>
        {block.text}
      </div>
    );
  }

  if (block.type === "paragraph") {
    return <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>{block.text}</div>;
  }

  if (block.type === "blockquote") {
    return (
      <div style={{ borderLeft: "2px solid var(--rule-2)", paddingLeft: 12, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6 }}>
        {block.text}
      </div>
    );
  }

  if (block.type === "code") {
    return (
      <div style={{ border: "1px solid var(--rule)", borderRadius: 4, overflow: "hidden", background: "var(--linen)" }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--rule)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>
          {block.language ?? "code"}
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            fontSize: 12,
            lineHeight: 1.6,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {block.content}
        </pre>
      </div>
    );
  }

  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, color: "var(--ink-2)", fontSize: 13 }}>
      {block.items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function Timeline({ events }: { events: Array<Pick<ActivityEventItem, "when" | "who" | "action" | "target" | "node">> }) {
  return (
    <div className="tl">
      {events.map((event, index) => (
        <div className="tl-item" key={`${event.when}-${event.action}-${index}`}>
          <span className={`tl-node ${event.node}`} />
          <div>
            <div className="tl-pri">
              <b>{event.who}</b> <span className="muted">{event.action.toLowerCase()}</span> {event.target}
            </div>
          </div>
          <div className="tl-meta">{event.when}</div>
        </div>
      ))}
    </div>
  );
}

function buildEvaluationBanner(detail: SkillDetailPayload, latestEval: EvalRunSummary): string {
  if (latestEval.status === "running") {
    return `Evaluation is still running across ${latestEval.cases} cases.`;
  }

  if (latestEval.status === "failed") {
    return "Latest run failed before scoring completed. Review the indexed run and rerun once the underlying issue is fixed.";
  }

  if (detail.flaggedCases.length > 0) {
    return `Latest run surfaced ${detail.flaggedCases.length} flagged cases that should inform the next Builder edit.`;
  }

  if (latestEval.delta != null) {
    return `Latest run completed with a ${latestEval.delta >= 0 ? "positive" : "negative"} delta of ${latestEval.delta.toFixed(1)} points.`;
  }

  return "Latest run completed without flagged regressions.";
}

function renderEvaluationStatusChip(status: EvalRunSummary["status"]) {
  switch (status) {
    case "running":
      return <span className="chip chip-paper">running</span>;
    case "complete-with-regressions":
      return <span className="chip chip-brass">regressions</span>;
    case "complete-baseline":
      return <span className="chip chip-paper">baseline</span>;
    case "failed":
      return <span className="chip chip-blood">failed</span>;
    default:
      return <span className="chip chip-moss">complete</span>;
  }
}
