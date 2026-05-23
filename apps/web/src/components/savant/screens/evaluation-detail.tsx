"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { CommitRef, Delta, EnvPill, Tier } from "@/components/savant/primitives";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ControlPlaneClientError,
  fetchEvaluationDetail,
} from "@/lib/control-plane-client";
import {
  EVALUATION_RUBRIC_THRESHOLDS,
  buildEvaluationArtifactBundle,
  buildCustomEvaluationRequestFromPreset,
  cloneEvaluationConfigEntries,
  cloneEvaluationMetricAlignment,
  simulateCustomEvaluationTest,
  type EvaluationConfigEntry,
  type EvaluationCustomTestPreset,
  type EvaluationCustomTestRequest,
  type EvaluationCustomTestResult,
  type EvaluationRunDetail,
  type EvaluationArtifactBundle,
  type EvaluationMetric,
  type EvaluationMetricAlignment,
  type EvaluationRecommendation,
} from "@/lib/evaluation-detail-helpers.ts";
import {
  buildRecommendationDecisionStorageKey,
  buildSkillRecommendationQueueScope,
  buildSkillRecommendationQueueStorageKey,
  parseQueuedSkillRecommendations,
  parseRecommendationDecisions,
  type RecommendationDecision,
  syncQueuedSkillRecommendations,
} from "@/lib/evaluation-recommendation-queue.ts";
import { normalizeReleaseProgress } from "@/lib/release-flow.ts";
import { buildSkillDetailPath } from "@/lib/skill-paths.ts";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";

interface SavedTestBenchEval {
  id: string;
  name: string;
  request: EvaluationCustomTestRequest;
  metricAlignment: EvaluationMetricAlignment[];
  datasetFields: EvaluationConfigEntry[];
  runnerSettings: EvaluationConfigEntry[];
  updatedAt: string;
}

interface EvalComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

type LoadState = "loading" | "ready" | "error";

type ConfigEntryPreset = {
  key: string;
  label: string;
  description: string;
  valuePlaceholder: string;
  defaultValue?: string;
};

const TEST_BENCH_STORAGE_PREFIX = "savant:test-bench-evals:v1";
const EVAL_COMMENTS_STORAGE_PREFIX = "savant:eval-comments:v1";
const CUSTOM_CONFIG_ENTRY_VALUE = "__custom__";

const RECOMMENDATION_DECISION_OPTIONS: Array<{
  value: RecommendationDecision;
  label: string;
  tone: "moss" | "brass" | "paper";
  description: string;
}> = [
  {
    value: "queue-next",
    label: "Queue next",
    tone: "moss",
    description: "Make this the next eval or implementation move.",
  },
  {
    value: "needs-review",
    label: "Needs review",
    tone: "brass",
    description: "Promising, but gather more evidence before acting.",
  },
  {
    value: "hold",
    label: "Hold",
    tone: "paper",
    description: "Not the right move for this eval right now.",
  },
];

const DATASET_FIELD_PRESETS: ConfigEntryPreset[] = [
  {
    key: "case_id",
    label: "Case name or ID",
    description: "A simple identifier so each sample is easy to reference later.",
    valuePlaceholder: "nda-001",
  },
  {
    key: "prompt",
    label: "Prompt or source text",
    description: "The exact question, clause text, or document snippet the skill should evaluate.",
    valuePlaceholder: "Paste the clause text or prompt",
  },
  {
    key: "verdict",
    label: "Expected outcome",
    description: "The result this sample should land on, like pass, investigate, or fail.",
    valuePlaceholder: "pass",
  },
  {
    key: "quality",
    label: "Quality score",
    description: "How strong the answer should be overall for this sample.",
    valuePlaceholder: "0.90",
  },
  {
    key: "format_compliance",
    label: "Formatting follows the rules",
    description: "Whether the response should match the expected structure or formatting rules.",
    valuePlaceholder: "true",
  },
  {
    key: "grounding_score",
    label: "Evidence grounding score",
    description: "How well the answer should stay tied to source evidence or cited facts.",
    valuePlaceholder: "0.95",
  },
  {
    key: "actionability",
    label: "Actionability score",
    description: "How easy it should be for a reviewer to act on the result.",
    valuePlaceholder: "0.85",
  },
  {
    key: "policy_compliance",
    label: "Policy compliant",
    description: "Whether the answer should stay inside the applicable policy or safety rules.",
    valuePlaceholder: "true",
  },
  {
    key: "latency_ms",
    label: "Expected speed (ms)",
    description: "The rough response-time target for this sample in milliseconds.",
    valuePlaceholder: "1200",
  },
  {
    key: "estimated_cost_usd",
    label: "Estimated cost (USD)",
    description: "The expected cost for running this sample.",
    valuePlaceholder: "0.03",
  },
  {
    key: "human_revision_count",
    label: "Human edits needed",
    description: "How many reviewer edits should be needed before the output is usable.",
    valuePlaceholder: "1",
  },
];

const RUNNER_SETTING_PRESETS: ConfigEntryPreset[] = [
  {
    key: "batch_size",
    label: "How many cases to run at once",
    description: "Controls the number of samples processed together in one batch.",
    valuePlaceholder: "8",
    defaultValue: "8",
  },
  {
    key: "timeout_seconds",
    label: "Time limit per case (seconds)",
    description: "How long a single case can run before the system stops it.",
    valuePlaceholder: "45",
    defaultValue: "45",
  },
  {
    key: "retry_count",
    label: "Retries if a case fails",
    description: "How many times the runner should retry a failed case automatically.",
    valuePlaceholder: "2",
    defaultValue: "2",
  },
  {
    key: "parallel_workers",
    label: "How many workers run in parallel",
    description: "Controls how many tasks can run at the same time.",
    valuePlaceholder: "4",
    defaultValue: "4",
  },
  {
    key: "evaluator_mode",
    label: "Review strictness",
    description: "Choose how strict or forgiving the evaluator should be.",
    valuePlaceholder: "balanced",
    defaultValue: "balanced",
  },
  {
    key: "sampling_strategy",
    label: "How cases are sampled",
    description: "Controls whether the runner picks balanced, random, or targeted cases.",
    valuePlaceholder: "balanced-mix",
  },
  {
    key: "temperature",
    label: "Creativity / variation",
    description: "Controls how deterministic or varied the model responses should be.",
    valuePlaceholder: "0.2",
    defaultValue: "0.2",
  },
  {
    key: "max_output_tokens",
    label: "Maximum answer length",
    description: "Caps how long the model response is allowed to be.",
    valuePlaceholder: "1200",
    defaultValue: "1200",
  },
  {
    key: "pass_threshold",
    label: "Pass score override",
    description: "Overrides the score needed for a sample or run to count as a pass.",
    valuePlaceholder: "85",
  },
  {
    key: "investigate_threshold",
    label: "Investigate score override",
    description: "Overrides the score range that should trigger manual review.",
    valuePlaceholder: "70",
  },
];

function createSavedTestBenchEvalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `bench-${Math.random().toString(36).slice(2, 10)}`;
}

function createEvalCommentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `comment-${Math.random().toString(36).slice(2, 10)}`;
}

function createEvalConfigEntryId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `config-${Math.random().toString(36).slice(2, 10)}`;
}

function formatSavedEvalTimestamp(isoTimestamp: string) {
  const parsed = Date.parse(isoTimestamp);

  if (Number.isNaN(parsed)) {
    return "recently";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function isSavedTestBenchEval(value: unknown): value is SavedTestBenchEval {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SavedTestBenchEval>;

  return (
    typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.updatedAt === "string"
    && !!candidate.request
    && typeof candidate.request.focus === "string"
    && typeof candidate.request.datasetSlice === "string"
    && typeof candidate.request.caseCount === "number"
    && typeof candidate.request.judgeModel === "string"
    && typeof candidate.request.includeEdgeCases === "boolean"
    && typeof candidate.request.compareAgainstBaseline === "boolean"
    && typeof candidate.request.notes === "string"
  );
}

function isEvalComment(value: unknown): value is EvalComment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EvalComment>;

  return typeof candidate.id === "string"
    && typeof candidate.author === "string"
    && typeof candidate.body === "string"
    && typeof candidate.createdAt === "string"
    && (candidate.updatedAt === undefined || typeof candidate.updatedAt === "string");
}

function isEvaluationConfigEntry(value: unknown): value is EvaluationConfigEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EvaluationConfigEntry>;

  return typeof candidate.id === "string"
    && typeof candidate.key === "string"
    && typeof candidate.value === "string";
}

function isMetricId(value: unknown): value is EvaluationMetricAlignment["metricId"] {
  return value === "quality"
    || value === "compliance"
    || value === "grounding"
    || value === "actionability"
    || value === "efficiency";
}

function isEvaluationMetricAlignment(value: unknown): value is EvaluationMetricAlignment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EvaluationMetricAlignment>;

  return isMetricId(candidate.metricId)
    && typeof candidate.metricLabel === "string"
    && (candidate.weight === undefined || typeof candidate.weight === "number")
    && typeof candidate.whatToMeasure === "string"
    && Array.isArray(candidate.howToGrade)
    && candidate.howToGrade.every((line) => typeof line === "string")
    && Array.isArray(candidate.improvementLevers)
    && candidate.improvementLevers.every((line) => typeof line === "string");
}

function normalizeSavedTestBenchEval(
  value: unknown,
  fallbackMetricAlignment: EvaluationMetricAlignment[],
): SavedTestBenchEval | null {
  if (!isSavedTestBenchEval(value)) {
    return null;
  }

  const candidate = value as SavedTestBenchEval & { metricAlignment?: unknown };
  const metricAlignment = Array.isArray(candidate.metricAlignment) && candidate.metricAlignment.every(isEvaluationMetricAlignment)
    ? cloneEvaluationMetricAlignment(candidate.metricAlignment)
    : cloneEvaluationMetricAlignment(fallbackMetricAlignment);
  const datasetFields = Array.isArray(candidate.datasetFields) && candidate.datasetFields.every(isEvaluationConfigEntry)
    ? cloneEvaluationConfigEntries(candidate.datasetFields)
    : [];
  const runnerSettings = Array.isArray(candidate.runnerSettings) && candidate.runnerSettings.every(isEvaluationConfigEntry)
    ? cloneEvaluationConfigEntries(candidate.runnerSettings)
    : [];

  return {
    id: candidate.id,
    name: candidate.name,
    request: cloneTestBenchRequest(candidate.request),
    metricAlignment,
    datasetFields,
    runnerSettings,
    updatedAt: candidate.updatedAt,
  };
}

function parseSavedTestBenchEvals(rawValue: string | null, fallbackMetricAlignment: EvaluationMetricAlignment[]): SavedTestBenchEval[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((candidate) => normalizeSavedTestBenchEval(candidate, fallbackMetricAlignment))
      .filter((candidate): candidate is SavedTestBenchEval => candidate !== null);
  } catch {
    return [];
  }
}

function buildInitialEvalComments(detail: EvaluationRunDetail): EvalComment[] {
  return detail.reviewerNotes.map((note, index) => ({
    id: `seed-${detail.uuid}-${index + 1}`,
    author: note.who,
    body: note.text,
    createdAt: note.when,
  }));
}

function parseEvalComments(rawValue: string | null, fallbackComments: EvalComment[]): EvalComment[] {
  if (!rawValue) {
    return fallbackComments;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return fallbackComments;
    }

    const comments = parsed.filter(isEvalComment);
    return comments.length > 0 ? comments : fallbackComments;
  } catch {
    return fallbackComments;
  }
}

function formatCommentTimestamp(timestamp: string) {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : formatSavedEvalTimestamp(timestamp);
}

function formatMetricAlignmentLines(lines: string[]) {
  return lines.join("\n");
}

function findConfigEntryPreset(presets: ConfigEntryPreset[], key: string) {
  return presets.find((preset) => preset.key === key) ?? null;
}

function getConfigEntrySelectValue(presets: ConfigEntryPreset[], key: string) {
  if (!key) {
    return "";
  }

  return findConfigEntryPreset(presets, key) ? key : CUSTOM_CONFIG_ENTRY_VALUE;
}

function formatConfigEntryLabel(key: string) {
  if (!key) {
    return "(unnamed field)";
  }

  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseMetricAlignmentLines(rawValue: string) {
  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function cloneTestBenchRequest(request: EvaluationCustomTestRequest): EvaluationCustomTestRequest {
  return {
    focus: request.focus,
    datasetSlice: request.datasetSlice,
    caseCount: request.caseCount,
    judgeModel: request.judgeModel,
    includeEdgeCases: request.includeEdgeCases,
    compareAgainstBaseline: request.compareAgainstBaseline,
    notes: request.notes,
  };
}

function sanitizeEditorConfigEntries(entries: EvaluationConfigEntry[]) {
  return cloneEvaluationConfigEntries(entries)
    .map((entry) => ({
      ...entry,
      key: entry.key.trim(),
      value: entry.value.trim(),
    }))
    .filter((entry) => entry.key.length > 0);
}

interface TestBenchEditorState {
  isOpen: boolean;
  mode: "create" | "edit";
  evalId: string | null;
  name: string;
  request: EvaluationCustomTestRequest;
  metricAlignment: EvaluationMetricAlignment[];
  datasetFields: EvaluationConfigEntry[];
  runnerSettings: EvaluationConfigEntry[];
}

export function EvaluationDetailScreen({ evaluationUuid }: { evaluationUuid: string }) {
  const pathname = usePathname() || "/";

  const [detail, setDetail] = useState<EvaluationRunDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvaluationDetail() {
      setLoadState("loading");
      setErrorMessage(null);

      try {
        const response = await fetchEvaluationDetail(evaluationUuid, { signal: controller.signal });

        if (controller.signal.aborted) {
          return;
        }

        setDetail(response.data);
        setLoadState("ready");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setDetail(null);
        setLoadState("error");
        setErrorMessage(
          error instanceof ControlPlaneClientError
            ? error.message
            : "Unable to load live evaluation detail right now.",
        );
      }
    }

    void loadEvaluationDetail();

    return () => {
      controller.abort();
    };
  }, [evaluationUuid, reloadToken]);

  if (loadState === "loading" && !detail) {
    return <EvaluationDetailLoadingState />;
  }

  if (!detail) {
    return (
      <EvaluationDetailUnavailableState
        evaluationUuid={evaluationUuid}
        pathname={pathname}
        errorMessage={errorMessage}
        onRetry={() => setReloadToken((current) => current + 1)}
      />
    );
  }

  return (
    <EvaluationDetailLoadedScreen
      key={`${evaluationUuid}:${detail.uuid}`}
      detail={detail}
      evaluationUuid={evaluationUuid}
      pathname={pathname}
    />
  );
}

function EvaluationDetailLoadedScreen({
  detail,
  evaluationUuid,
  pathname,
}: {
  detail: EvaluationRunDetail;
  evaluationUuid: string;
  pathname: string;
}) {

  const firstPreset = detail.customTestPresets[0] ?? {
    id: "default",
    label: "Focused rerun",
    focus: "Retest the current regression slice on a narrow benchmark.",
    datasetSlice: "focused-regression-slice",
    caseCount: 24,
    judgeModel: detail.judgeModel,
    notes: "",
  } satisfies EvaluationCustomTestPreset;

  const defaultRequest = buildCustomEvaluationRequestFromPreset(firstPreset);
  const defaultMetricAlignment = cloneEvaluationMetricAlignment(detail.metricAlignment);
  const [customResult, setCustomResult] = useState<EvaluationCustomTestResult | null>(null);
  const [lastRunEvalName, setLastRunEvalName] = useState<string | null>(null);
  const [savedTestBenchEvals, setSavedTestBenchEvals] = useState<SavedTestBenchEval[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const storageKey = `${TEST_BENCH_STORAGE_PREFIX}:${detail.skill.id}:${detail.run.dataset}`;
    return parseSavedTestBenchEvals(
      window.localStorage.getItem(storageKey),
      cloneEvaluationMetricAlignment(detail.metricAlignment),
    );
  });
  const [evalComments, setEvalComments] = useState<EvalComment[]>(() => {
    if (typeof window === "undefined") {
      return buildInitialEvalComments(detail);
    }

    const storageKey = `${EVAL_COMMENTS_STORAGE_PREFIX}:${detail.uuid}`;
    return parseEvalComments(window.localStorage.getItem(storageKey), buildInitialEvalComments(detail));
  });
  const [commentDraft, setCommentDraft] = useState({ author: "", body: "" });
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState({ author: "", body: "" });
  const [expandedRecommendationId, setExpandedRecommendationId] = useState<string | null>(detail.recommendations[0]?.id ?? null);
  const [recommendationDecisions, setRecommendationDecisions] = useState<Record<string, RecommendationDecision>>(() => {
    if (typeof window === "undefined") {
      return {};
    }

    return parseRecommendationDecisions(
      window.localStorage.getItem(buildRecommendationDecisionStorageKey(evaluationUuid)),
    );
  });
  const [editorState, setEditorState] = useState<TestBenchEditorState>({
    isOpen: false,
    mode: "create",
    evalId: null,
    name: firstPreset.label,
    request: cloneTestBenchRequest(defaultRequest),
    metricAlignment: cloneEvaluationMetricAlignment(defaultMetricAlignment),
    datasetFields: [],
    runnerSettings: [],
  });
  const recommendationDecisionStorageKey = buildRecommendationDecisionStorageKey(detail.uuid);
  const recommendationQueueStorageKey = buildSkillRecommendationQueueStorageKey(buildSkillRecommendationQueueScope({
      id: detail.skill.id,
      name: detail.skill.name,
      team: detail.skill.team,
      repo: detail.skill.repo,
      branch: detail.skill.branch,
    }));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const existingQueuedRecommendations = parseQueuedSkillRecommendations(
      window.localStorage.getItem(recommendationQueueStorageKey),
    );
    const nextQueuedRecommendations = syncQueuedSkillRecommendations(existingQueuedRecommendations, {
      skill: {
        id: detail.skill.id,
        name: detail.skill.name,
        team: detail.skill.team,
        repo: detail.skill.repo,
        branch: detail.skill.branch,
      },
      evaluation: {
        uuid: detail.uuid,
        ref: detail.run.ref,
        dataset: detail.run.dataset,
        started: detail.run.started,
      },
      recommendations: detail.recommendations.map((recommendation) => ({
        id: recommendation.id,
        category: recommendation.category,
        title: recommendation.title,
        effort: recommendation.effort,
        impact: recommendation.impact,
        rationale: recommendation.rationale,
        actions: [...recommendation.actions],
      })),
      decisions: recommendationDecisions,
    });

    window.localStorage.setItem(recommendationQueueStorageKey, JSON.stringify(nextQueuedRecommendations));
  }, [detail, recommendationDecisions, recommendationQueueStorageKey]);

  const resolvedDetail = detail;
  const testBenchStorageKey = `${TEST_BENCH_STORAGE_PREFIX}:${detail.skill.id}:${detail.run.dataset}`;
  const evalCommentsStorageKey = `${EVAL_COMMENTS_STORAGE_PREFIX}:${detail.uuid}`;
  const evaluationsHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const skillHref = buildSkillDetailPath(pathname, detail.skill) as Route;
  const publishedHistoryRun = detail.readOnly && detail.publishedRef
    ? detail.historicalRuns.find((candidate) => candidate.ref === detail.publishedRef) ?? null
    : null;
  const latestPublishedHref = publishedHistoryRun
    ? buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(publishedHistoryRun.uuid)}`) as Route
    : null;
  const sortedSavedTestBenchEvals = [...savedTestBenchEvals].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const editingSavedEval = editorState.evalId
    ? savedTestBenchEvals.find((savedEval) => savedEval.id === editorState.evalId) ?? null
    : null;
  const artifactBundle = buildEvaluationArtifactBundle(detail, editorState.request, editorState.metricAlignment, {
    datasetFields: editorState.datasetFields,
    runnerSettings: editorState.runnerSettings,
  });

  function persistSavedTestBenchEvals(nextSavedEvals: SavedTestBenchEval[]) {
    setSavedTestBenchEvals(nextSavedEvals);

    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(testBenchStorageKey, JSON.stringify(nextSavedEvals));
  }

  function persistEvalComments(nextComments: EvalComment[]) {
    setEvalComments(nextComments);

    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(evalCommentsStorageKey, JSON.stringify(nextComments));
  }

  function persistRecommendationDecisions(nextDecisions: Record<string, RecommendationDecision>) {
    setRecommendationDecisions(nextDecisions);

    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(recommendationDecisionStorageKey, JSON.stringify(nextDecisions));
  }

  function openCreateTestBenchEditor() {
    if (resolvedDetail.readOnly) {
      return;
    }

    const nextEvalCount = savedTestBenchEvals.length + 1;
    setEditorState({
      isOpen: true,
      mode: "create",
      evalId: null,
      name: `Test Bench eval ${nextEvalCount}`,
      request: cloneTestBenchRequest(defaultRequest),
      metricAlignment: cloneEvaluationMetricAlignment(defaultMetricAlignment),
      datasetFields: [],
      runnerSettings: [],
    });
  }

  function openEditTestBenchEditor(savedEvalId: string) {
    if (resolvedDetail.readOnly) {
      return;
    }

    const savedEval = savedTestBenchEvals.find((candidate) => candidate.id === savedEvalId);

    if (!savedEval) {
      return;
    }

    setEditorState({
      isOpen: true,
      mode: "edit",
      evalId: savedEval.id,
      name: savedEval.name,
      request: cloneTestBenchRequest(savedEval.request),
      metricAlignment: cloneEvaluationMetricAlignment(savedEval.metricAlignment),
      datasetFields: cloneEvaluationConfigEntries(savedEval.datasetFields),
      runnerSettings: cloneEvaluationConfigEntries(savedEval.runnerSettings),
    });
  }

  function closeTestBenchEditor() {
    setEditorState((current) => ({ ...current, isOpen: false }));
  }

  function updateEditorCaseCount(rawValue: string) {
    const parsedValue = Number.parseInt(rawValue, 10);
    setEditorState((current) => ({
      ...current,
      request: {
        ...current.request,
        caseCount: Number.isNaN(parsedValue)
          ? current.request.caseCount
          : Math.min(resolvedDetail.run.cases, Math.max(12, parsedValue)),
      },
    }));
  }

  function updateEditorMetricAlignment(
    metricId: EvaluationMetricAlignment["metricId"],
    field: "weight" | "whatToMeasure" | "howToGrade" | "improvementLevers",
    value: string,
  ) {
    setEditorState((current) => ({
      ...current,
      metricAlignment: current.metricAlignment.map((alignment) => {
        if (alignment.metricId !== metricId) {
          return alignment;
        }

        if (field === "weight") {
          const parsedPercent = Number.parseFloat(value);

          return {
            ...alignment,
            weight: Number.isNaN(parsedPercent)
              ? (alignment.weight ?? 0)
              : Math.min(100, Math.max(0, parsedPercent)) / 100,
          };
        }

        if (field === "whatToMeasure") {
          return {
            ...alignment,
            whatToMeasure: value,
          };
        }

        return {
          ...alignment,
          [field]: parseMetricAlignmentLines(value),
        };
      }),
    }));
  }

  function addEditorConfigEntry(scope: "dataset" | "runner") {
    const nextEntry: EvaluationConfigEntry = {
      id: createEvalConfigEntryId(),
      key: "",
      value: "",
    };

    setEditorState((current) => ({
      ...current,
      datasetFields: scope === "dataset"
        ? [...current.datasetFields, nextEntry]
        : current.datasetFields,
      runnerSettings: scope === "runner"
        ? [...current.runnerSettings, nextEntry]
        : current.runnerSettings,
    }));
  }

  function updateEditorConfigEntry(
    scope: "dataset" | "runner",
    entryId: string,
    field: "key" | "value",
    value: string,
  ) {
    setEditorState((current) => ({
      ...current,
      datasetFields: scope === "dataset"
        ? current.datasetFields.map((entry) => entry.id === entryId ? { ...entry, [field]: value } : entry)
        : current.datasetFields,
      runnerSettings: scope === "runner"
        ? current.runnerSettings.map((entry) => entry.id === entryId ? { ...entry, [field]: value } : entry)
        : current.runnerSettings,
    }));
  }

  function removeEditorConfigEntry(scope: "dataset" | "runner", entryId: string) {
    setEditorState((current) => ({
      ...current,
      datasetFields: scope === "dataset"
        ? current.datasetFields.filter((entry) => entry.id !== entryId)
        : current.datasetFields,
      runnerSettings: scope === "runner"
        ? current.runnerSettings.filter((entry) => entry.id !== entryId)
        : current.runnerSettings,
    }));
  }

  function saveTestBenchEval() {
    if (resolvedDetail.readOnly) {
      return;
    }

    const normalizedName = editorState.name.trim() || `Test Bench eval ${savedTestBenchEvals.length + 1}`;
    const updatedAt = new Date().toISOString();
    const datasetFields = sanitizeEditorConfigEntries(editorState.datasetFields);
    const runnerSettings = sanitizeEditorConfigEntries(editorState.runnerSettings);

    if (editorState.mode === "edit" && editorState.evalId) {
      const nextSavedEvals = savedTestBenchEvals.map((savedEval) => savedEval.id === editorState.evalId
        ? {
          ...savedEval,
          name: normalizedName,
          request: cloneTestBenchRequest(editorState.request),
          metricAlignment: cloneEvaluationMetricAlignment(editorState.metricAlignment),
          datasetFields,
          runnerSettings,
          updatedAt,
        }
        : savedEval);

      persistSavedTestBenchEvals(nextSavedEvals);
      setEditorState((current) => ({ ...current, isOpen: false, name: normalizedName }));
      return;
    }

    const nextSavedEval: SavedTestBenchEval = {
      id: createSavedTestBenchEvalId(),
      name: normalizedName,
      request: cloneTestBenchRequest(editorState.request),
      metricAlignment: cloneEvaluationMetricAlignment(editorState.metricAlignment),
      datasetFields,
      runnerSettings,
      updatedAt,
    };

    persistSavedTestBenchEvals([...savedTestBenchEvals, nextSavedEval]);
    setEditorState((current) => ({
      ...current,
      isOpen: false,
      mode: "edit",
      evalId: nextSavedEval.id,
      name: normalizedName,
      request: cloneTestBenchRequest(nextSavedEval.request),
      metricAlignment: cloneEvaluationMetricAlignment(nextSavedEval.metricAlignment),
      datasetFields: cloneEvaluationConfigEntries(nextSavedEval.datasetFields),
      runnerSettings: cloneEvaluationConfigEntries(nextSavedEval.runnerSettings),
    }));
  }

  function deleteSavedTestBenchEval(savedEvalId: string) {
    if (resolvedDetail.readOnly) {
      return;
    }

    persistSavedTestBenchEvals(savedTestBenchEvals.filter((savedEval) => savedEval.id !== savedEvalId));

    if (editorState.evalId === savedEvalId) {
      setEditorState((current) => ({
        ...current,
        isOpen: false,
        mode: "create",
        evalId: null,
        name: firstPreset.label,
        request: cloneTestBenchRequest(defaultRequest),
        metricAlignment: cloneEvaluationMetricAlignment(defaultMetricAlignment),
        datasetFields: [],
        runnerSettings: [],
      }));
    }
  }

  function runSavedTestBenchEval(savedEval: SavedTestBenchEval) {
    if (resolvedDetail.readOnly) {
      return;
    }

    const nextRequest = cloneTestBenchRequest(savedEval.request);
    setLastRunEvalName(savedEval.name);
    setCustomResult(simulateCustomEvaluationTest(resolvedDetail, nextRequest));
  }

  function runEditorDraft() {
    if (resolvedDetail.readOnly) {
      return;
    }

    const nextRequest = cloneTestBenchRequest(editorState.request);
    setLastRunEvalName(editorState.name.trim() || "Unsaved draft");
    setCustomResult(simulateCustomEvaluationTest(resolvedDetail, nextRequest));
  }

  function setRecommendationDecision(recommendationId: string, decision: RecommendationDecision) {
    persistRecommendationDecisions({
      ...recommendationDecisions,
      [recommendationId]: decision,
    });
  }

  function toggleRecommendationDetails(recommendationId: string) {
    setExpandedRecommendationId((current) => current === recommendationId ? null : recommendationId);
  }

  function addComment() {
    const body = commentDraft.body.trim();

    if (!body) {
      return;
    }

    const nextComment: EvalComment = {
      id: createEvalCommentId(),
      author: commentDraft.author.trim() || "You",
      body,
      createdAt: new Date().toISOString(),
    };

    persistEvalComments([...evalComments, nextComment]);
    setCommentDraft({ author: commentDraft.author.trim() || "You", body: "" });
  }

  function startEditingComment(comment: EvalComment) {
    setEditingCommentId(comment.id);
    setEditingCommentDraft({
      author: comment.author,
      body: comment.body,
    });
  }

  function cancelEditingComment() {
    setEditingCommentId(null);
    setEditingCommentDraft({ author: "", body: "" });
  }

  function saveEditedComment() {
    if (!editingCommentId) {
      return;
    }

    const body = editingCommentDraft.body.trim();

    if (!body) {
      return;
    }

    persistEvalComments(evalComments.map((comment) => comment.id === editingCommentId
      ? {
        ...comment,
        author: editingCommentDraft.author.trim() || comment.author,
        body,
        updatedAt: new Date().toISOString(),
      }
      : comment));
    cancelEditingComment();
  }

  function deleteComment(commentId: string) {
    persistEvalComments(evalComments.filter((comment) => comment.id !== commentId));

    if (editingCommentId === commentId) {
      cancelEditingComment();
    }
  }

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="page-head-meta">
            <Link href={evaluationsHref} className="link">
              Evaluations
            </Link>
            <span className="sep">/</span>
            <span>{detail.skill.team}</span>
            <span className="sep">/</span>
            <span className="mono">{detail.uuid}</span>
          </div>
          <div className="row" style={{ gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 className="h-display">{detail.skill.name}</h1>
            <Tier n={detail.skill.tier} />
            <RunStatusChip status={detail.run.status} failed={detail.run.failed} />
            <EnvPill env={detail.skill.channel} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link href={skillHref} className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            Open related skill
          </Link>
          <button type="button" className="btn btn-ghost">
            <Ic.ExternalLink className="b-icon" />
            Export eval
          </button>
          <a href="#test-bench" className="btn btn-primary">
            <Ic.Refresh className="b-icon" />
            Run Test Bench eval
          </a>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
          <BenchmarkMetricStrip metrics={detail.metrics} />

          <div className="panel" id="test-bench">
            <div className="panel-hd">
              <div>
                <div className="panel-title">Test Bench</div>
                <div className="subtle" style={{ fontSize: 11.5 }}>
                  Scoped reruns live here. Recommendations and benchmark pressure points stay attached to the same working surface.
                </div>
              </div>
              <span className={detail.readOnly ? "chip chip-paper" : "chip chip-moss"}>
                {detail.readOnly ? "read only" : "editable"}
              </span>
            </div>
            <div className="panel-bd" style={{ padding: 0 }}>
              {detail.readOnly ? (
                <div
                  style={{
                    padding: "14px 20px",
                    background: "var(--linen)",
                    borderBottom: "1px solid var(--rule)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                    <Ic.Warn className="n-icon" style={{ color: "var(--brass-deep)", marginTop: 1 }} />
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                      This evaluation is now historical because a newer published version is live.
                      {detail.publishedRef ? ` The current published ref is ${detail.publishedRef}.` : ""}
                    </div>
                  </div>
                  {latestPublishedHref ? (
                    <div>
                      <Link href={latestPublishedHref} className="link">
                        Open the latest published benchmark run
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div style={{ padding: "18px 20px", display: "grid", gap: 14 }}>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-primary" onClick={openCreateTestBenchEditor} disabled={detail.readOnly}>
                    <Ic.Plus className="b-icon" />
                    Add eval
                  </button>
                </div>

                <div className="panel-bd tight" style={{ padding: 0, border: "1px solid var(--rule)", borderRadius: 6 }}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Test</TableHead>
                        <TableHead>Dataset slice</TableHead>
                        <TableHead>Judge</TableHead>
                        <TableHead style={{ textAlign: "right" }}>Cases</TableHead>
                        <TableHead style={{ textAlign: "right" }}>Updated</TableHead>
                        <TableHead style={{ textAlign: "right" }}>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedSavedTestBenchEvals.length > 0 ? (
                        sortedSavedTestBenchEvals.map((savedEval) => (
                          <TableRow key={savedEval.id}>
                            <TableCell>
                              <div className="tbl-name-text">
                                <span className="pri">{savedEval.name}</span>
                                <span className="sec mono">
                                  {savedEval.request.includeEdgeCases ? "edge cases" : "standard cases"}
                                  {savedEval.request.compareAgainstBaseline ? " · baseline compare" : " · exploratory"}
                                  {` · ${savedEval.metricAlignment.length} metric semantics`}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="mono" style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
                              {savedEval.request.datasetSlice}
                            </TableCell>
                            <TableCell>{savedEval.request.judgeModel}</TableCell>
                            <TableCell className="num" style={{ textAlign: "right" }}>
                              {savedEval.request.caseCount}
                            </TableCell>
                            <TableCell className="mono" style={{ textAlign: "right", color: "var(--subtle)", fontSize: 11.5 }}>
                              {formatSavedEvalTimestamp(savedEval.updatedAt)}
                            </TableCell>
                            <TableCell>
                              <div className="row" style={{ justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => openEditTestBenchEditor(savedEval.id)}
                                  disabled={detail.readOnly}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => runSavedTestBenchEval(savedEval)}
                                  disabled={detail.readOnly}
                                >
                                  Run
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => deleteSavedTestBenchEval(savedEval.id)}
                                  disabled={detail.readOnly}
                                >
                                  Delete
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} style={{ padding: "16px 12px", color: "var(--subtle)" }}>
                            No tests configured yet. Click <strong>Add eval</strong> to create your first Test Bench test.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

              </div>

              <div style={{ borderTop: "1px solid var(--rule)", padding: "18px 20px", display: "grid", gap: 18 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Recommendations to iterate
                  </div>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 14 }}>
                    These are the concrete skill changes this benchmark is nudging you toward.
                  </div>
                  <RecommendationList
                    recommendations={detail.recommendations}
                    expandedRecommendationId={expandedRecommendationId}
                    recommendationDecisions={recommendationDecisions}
                    onToggleRecommendation={toggleRecommendationDetails}
                    onSetRecommendationDecision={setRecommendationDecision}
                  />
                </div>
              </div>

              {customResult ? <CustomTestResultSection result={customResult} runLabel={lastRunEvalName} /> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div>
                <div className="panel-title">Historical benchmark runs</div>
                <div className="subtle" style={{ fontSize: 11.5 }}>
                  Quick reference for the same benchmark. Open any row to inspect that run directly.
                </div>
              </div>
              <span className="chip chip-paper">{detail.historicalRuns.length} runs</span>
            </div>
            <div className="panel-bd tight">
              {detail.historicalRuns.length > 0 ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Score</th>
                      <th style={{ textAlign: "right" }}>Started</th>
                      <th>Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.historicalRuns.map((run) => {
                      const runHref = buildTenantAwareAppPath(pathname, `/evaluations/${encodeURIComponent(run.uuid)}`) as Route;

                      return (
                        <tr key={run.uuid}>
                          <td>
                            <div className="tbl-name-text">
                              <Link href={runHref} style={{ color: "inherit", textDecoration: "none" }}>
                                <span
                                  className="pri mono"
                                  style={{
                                    textDecoration: "underline",
                                    textDecorationColor: "var(--moss-soft)",
                                    textUnderlineOffset: 3,
                                  }}
                                >
                                  {run.ref}
                                </span>
                              </Link>
                              <span className="sec mono">{run.uuid} · {run.duration}</span>
                            </div>
                          </td>
                          <td>
                            <RunStatusChip status={run.status} failed={run.failed} compact />
                          </td>
                          <td className="num" style={{ textAlign: "right" }}>{run.score.toFixed(1)}</td>
                          <td className="mono" style={{ textAlign: "right", color: "var(--ink-3)", fontSize: 11.5 }}>
                            {run.started}
                          </td>
                          <td>
                            {run.readOnly ? (
                              <span className="chip chip-paper">
                                read only{run.newerPublishedRef ? ` · ${run.newerPublishedRef} live` : ""}
                              </span>
                            ) : (
                              <span className="chip chip-moss">open for comparison</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: "18px 20px", fontSize: 12.5, color: "var(--ink-2)" }}>
                  No other runs have been recorded for this benchmark yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Run metadata</div>
              <RunStatusChip status={detail.run.status} failed={detail.run.failed} compact />
            </div>
            <div className="panel-bd" style={{ padding: 0 }}>
              <MetadataSection title="Benchmark">
                <MetadataRow label="Run id" value={<span className="mono">{detail.uuid}</span>} />
                <MetadataRow label="Dataset" value={detail.run.dataset} />
                <MetadataRow label="Cases" value={`${detail.run.passed}/${detail.run.cases} passed`} />
                <MetadataRow label="Started" value={detail.run.started} />
                <MetadataRow label="Duration" value={detail.run.duration} />
                <MetadataRow label="Test Bench" value={detail.readOnly ? "Read only" : "Editable"} />
              </MetadataSection>

              <MetadataSection title="Versioning">
                <MetadataRow
                  label="Candidate ref"
                  value={(
                    <CommitRef
                      commit={detail.skill.candidateCommit !== "—" ? detail.skill.candidateCommit : detail.skill.commit}
                      label={detail.run.ref}
                    />
                  )}
                />
                <MetadataRow
                  label="Previous eval"
                  value={detail.baselineRun ? detail.baselineRun.ref : "First recorded run"}
                />
                <MetadataRow label="Published ref" value={detail.publishedRef ?? "Not published yet"} />
                <MetadataRow label="Release branch" value={detail.skill.branch} />
              </MetadataSection>

              <MetadataSection title="Execution">
                <MetadataRow label="Executed by" value={detail.executedBy} />
                <MetadataRow label="Environment" value={detail.executionEnvironment} />
                <MetadataRow label="Candidate model" value={detail.candidateModel} />
                <MetadataRow label="Judge model" value={detail.judgeModel} />
              </MetadataSection>

              {detail.release ? (
                <MetadataSection title="Release context">
                  <MetadataRow label="Queue" value={`${detail.release.candidateRef} → ${detail.release.toEnv}`} />
                  <MetadataRow
                    label="Readiness"
                    value={`${Math.round(normalizeReleaseProgress(detail.release.readinessPct) * 100)}% ready`}
                  />
                  <MetadataRow
                    label="Approvals"
                    value={`${detail.release.approvalsDone}/${detail.release.approvalsRequired}`}
                  />
                  <MetadataRow
                    label="Blocker"
                    value={detail.release.approvalsBlocked ?? "Approval path clear"}
                  />
                </MetadataSection>
              ) : null}

              <MetadataSection title="Comments">
                <CommentSection
                  comments={evalComments}
                  commentDraft={commentDraft}
                  editingCommentId={editingCommentId}
                  editingCommentDraft={editingCommentDraft}
                  onChangeCommentDraft={setCommentDraft}
                  onChangeEditingCommentDraft={setEditingCommentDraft}
                  onAddComment={addComment}
                  onStartEditingComment={startEditingComment}
                  onCancelEditingComment={cancelEditingComment}
                  onSaveEditedComment={saveEditedComment}
                  onDeleteComment={deleteComment}
                />
              </MetadataSection>
            </div>
          </div>
        </div>
      </div>

      {editorState.isOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            display: "flex",
            justifyContent: "flex-end",
            background: "var(--overlay-scrim)",
            backdropFilter: "blur(1px)",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="test-bench-editor-title"
        >
          <button
            type="button"
            onClick={closeTestBenchEditor}
            aria-label="Close Test Bench editor"
            style={{
              flex: 1,
              border: 0,
              background: "transparent",
              cursor: "default",
            }}
          />
          <section
            style={{
              width: "50vw",
              minWidth: "min(100vw, 420px)",
              maxWidth: "100vw",
              height: "100vh",
              background: "var(--panel)",
              borderLeft: "1px solid var(--rule)",
              display: "grid",
              gridTemplateRows: "auto 1fr auto",
              boxShadow: "var(--shadow-pop)",
            }}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--rule)", display: "grid", gap: 8 }}>
              <div className="row between" style={{ gap: 8, alignItems: "center" }}>
                <div>
                  <div className="eyebrow" id="test-bench-editor-title">
                    {editorState.mode === "edit" ? "Edit Test Bench eval" : "Add Test Bench eval"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4 }}>
                    Configure a focused test and save it for repeatable skill optimization.
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={closeTestBenchEditor}>
                  <Ic.X className="b-icon" />
                  Close
                </button>
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="chip chip-paper">{detail.run.dataset}</span>
                <span className="chip chip-paper">max {detail.run.cases} cases</span>
                <span className="chip chip-paper">{artifactBundle.rubric.dimensions.length} metric semantics</span>
                <span className="chip chip-paper">rubric {artifactBundle.rubric.rubricVersion}</span>
                <span className="chip chip-paper">
                  {editorState.mode === "edit" && editingSavedEval
                    ? `updated ${formatSavedEvalTimestamp(editingSavedEval.updatedAt)}`
                    : "new draft"}
                </span>
              </div>
            </div>

            <div style={{ padding: "16px 18px", overflow: "auto", display: "grid", gap: 18 }}>
              <section style={{ display: "grid", gap: 12 }}>
                <div className="eyebrow">Definition</div>
                <div className="field">
                  <label className="field-label" htmlFor="test-bench-flyout-name">Eval name</label>
                  <input
                    id="test-bench-flyout-name"
                    value={editorState.name}
                    disabled={detail.readOnly}
                    onChange={(event) => setEditorState((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Name this Test Bench eval"
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="test-bench-flyout-focus">Test focus</label>
                  <textarea
                    id="test-bench-flyout-focus"
                    rows={4}
                    value={editorState.request.focus}
                    disabled={detail.readOnly}
                    onChange={(event) => setEditorState((current) => ({
                      ...current,
                      request: { ...current.request, focus: event.target.value },
                    }))}
                    style={{ minHeight: 106, resize: "vertical" }}
                  />
                </div>
              </section>

              <section style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, display: "grid", gap: 12 }}>
                <div>
                  <div className="eyebrow">Dataset & runner settings</div>
                  <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
                    Core fields map the standard dataset and rubric settings. Add any extra repo fields below so the saved eval can fully define the files written into the git repo.
                  </div>
                </div>

                <div className="grid-2" style={{ gap: 14 }}>
                  <div className="field">
                    <label className="field-label" htmlFor="test-bench-flyout-slice">Dataset slice</label>
                    <input
                      id="test-bench-flyout-slice"
                      value={editorState.request.datasetSlice}
                      disabled={detail.readOnly}
                      onChange={(event) => setEditorState((current) => ({
                        ...current,
                        request: { ...current.request, datasetSlice: event.target.value },
                      }))}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="test-bench-flyout-cases">Case count</label>
                    <input
                      id="test-bench-flyout-cases"
                      type="number"
                      min={12}
                      max={detail.run.cases}
                      value={editorState.request.caseCount}
                      disabled={detail.readOnly}
                      onChange={(event) => updateEditorCaseCount(event.target.value)}
                    />
                  </div>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="test-bench-flyout-judge">Judge model</label>
                  <select
                    id="test-bench-flyout-judge"
                    value={editorState.request.judgeModel}
                    disabled={detail.readOnly}
                    onChange={(event) => setEditorState((current) => ({
                      ...current,
                      request: { ...current.request, judgeModel: event.target.value },
                    }))}
                  >
                    <option value="strict rubric judge">Strict rubric judge</option>
                    <option value="balanced rubric judge">Balanced rubric judge</option>
                    <option value="fast confidence judge">Fast confidence judge</option>
                  </select>
                </div>

                <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                  <label className="row" style={{ gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                    <input
                      type="checkbox"
                      checked={editorState.request.includeEdgeCases}
                      disabled={detail.readOnly}
                      onChange={(event) => setEditorState((current) => ({
                        ...current,
                        request: { ...current.request, includeEdgeCases: event.target.checked },
                      }))}
                    />
                    Include edge cases
                  </label>
                  <label className="row" style={{ gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                    <input
                      type="checkbox"
                      checked={editorState.request.compareAgainstBaseline}
                      disabled={detail.readOnly}
                      onChange={(event) => setEditorState((current) => ({
                        ...current,
                        request: { ...current.request, compareAgainstBaseline: event.target.checked },
                      }))}
                    />
                    Compare against previous benchmark
                  </label>
                </div>

                <div className="grid-2-equal" style={{ gap: 14 }}>
                  <ConfigEntryEditorSection
                    title="Additional dataset fields"
                    description="Choose the extra sample fields this eval should write into the dataset file, then set the value for each one."
                    entries={editorState.datasetFields}
                    emptyState="No extra dataset fields yet."
                    addLabel="Add dataset field"
                    presets={DATASET_FIELD_PRESETS}
                    customLabel="Custom dataset field"
                    onAdd={() => addEditorConfigEntry("dataset")}
                    onUpdate={(entryId, field, value) => updateEditorConfigEntry("dataset", entryId, field, value)}
                    onRemove={(entryId) => removeEditorConfigEntry("dataset", entryId)}
                    disabled={detail.readOnly}
                  />

                  <ConfigEntryEditorSection
                    title="Additional runner settings"
                    description="Choose the extra run controls this eval should carry into the repo, like time limits, retries, or batching."
                    entries={editorState.runnerSettings}
                    emptyState="No extra runner settings yet."
                    addLabel="Add runner setting"
                    presets={RUNNER_SETTING_PRESETS}
                    customLabel="Custom runner setting"
                    onAdd={() => addEditorConfigEntry("runner")}
                    onUpdate={(entryId, field, value) => updateEditorConfigEntry("runner", entryId, field, value)}
                    onRemove={(entryId) => removeEditorConfigEntry("runner", entryId)}
                    disabled={detail.readOnly}
                  />
                </div>
              </section>

              <section style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, display: "grid", gap: 12 }}>
                <div className="row between" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div className="eyebrow">Metric semantics</div>
                    <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
                      Each eval can define its own meaning of quality, compliance, grounding, actionability, and efficiency. These fields become the semantic layer for `eval/rubric.yaml`.
                    </div>
                  </div>
                  <span className="chip chip-paper">
                    pass {EVALUATION_RUBRIC_THRESHOLDS.pass} · investigate {EVALUATION_RUBRIC_THRESHOLDS.investigate}
                  </span>
                </div>

                <MetricAlignmentEditorSection
                  dimensions={artifactBundle.rubric.dimensions}
                  onUpdate={updateEditorMetricAlignment}
                />
              </section>

              <section style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, display: "grid", gap: 12 }}>
                <div>
                  <div className="eyebrow">Repository compatibility</div>
                  <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
                    This eval now maps cleanly to the `lattix-skills` artifact model: dataset, rubric, and baseline references can be derived from the data you define here.
                  </div>
                </div>

                <ArtifactCompatibilitySection artifactBundle={artifactBundle} />
              </section>
            </div>

            <div
              style={{
                padding: "14px 18px",
                borderTop: "1px solid var(--rule)",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => editorState.evalId ? deleteSavedTestBenchEval(editorState.evalId) : closeTestBenchEditor()}
                disabled={detail.readOnly}
              >
                {editorState.evalId ? "Delete eval" : "Cancel"}
              </button>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={runEditorDraft} disabled={detail.readOnly}>
                  <Ic.Refresh className="b-icon" />
                  Run draft
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={saveTestBenchEval} disabled={detail.readOnly}>
                  <Ic.Check className="b-icon" />
                  Save eval
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MetricAlignmentEditorSection({
  dimensions,
  onUpdate,
}: {
  dimensions: EvaluationArtifactBundle["rubric"]["dimensions"];
  onUpdate: (
    metricId: EvaluationMetricAlignment["metricId"],
    field: "weight" | "whatToMeasure" | "howToGrade" | "improvementLevers",
    value: string,
  ) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 0 }}>
      {dimensions.map((dimension, index) => (
        <div
          key={dimension.metricId}
          style={{
            borderTop: index > 0 ? "1px solid var(--rule)" : "none",
            padding: index > 0 ? "18px 0 4px" : "4px 0 4px",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{dimension.metricLabel}</div>

          <div className="field" style={{ maxWidth: 240 }}>
            <label className="field-label" htmlFor={`metric-${dimension.metricId}-weight`}>Weight</label>
            <input
              id={`metric-${dimension.metricId}-weight`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={Math.round(dimension.weight * 100)}
              onChange={(event) => onUpdate(dimension.metricId, "weight", event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`metric-${dimension.metricId}-meaning`}>What this metric means</label>
            <textarea
              id={`metric-${dimension.metricId}-meaning`}
              rows={3}
              value={dimension.whatToMeasure}
              onChange={(event) => onUpdate(dimension.metricId, "whatToMeasure", event.target.value)}
              style={{ minHeight: 88, resize: "vertical" }}
            />
          </div>

          <div className="grid-2" style={{ gap: 14 }}>
            <div className="field">
              <label className="field-label" htmlFor={`metric-${dimension.metricId}-grading`}>How to grade</label>
              <textarea
                id={`metric-${dimension.metricId}-grading`}
                rows={5}
                value={formatMetricAlignmentLines(dimension.howToGrade)}
                onChange={(event) => onUpdate(dimension.metricId, "howToGrade", event.target.value)}
                style={{ minHeight: 112, resize: "vertical" }}
              />
              <div className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>One grading signal per line.</div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor={`metric-${dimension.metricId}-improvements`}>What improves it</label>
              <textarea
                id={`metric-${dimension.metricId}-improvements`}
                rows={5}
                value={formatMetricAlignmentLines(dimension.improvementLevers)}
                onChange={(event) => onUpdate(dimension.metricId, "improvementLevers", event.target.value)}
                style={{ minHeight: 112, resize: "vertical" }}
              />
              <div className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>Capture the concrete levers this eval should reward.</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigEntryEditorSection({
  title,
  description,
  entries,
  emptyState,
  addLabel,
  presets,
  customLabel,
  onAdd,
  onUpdate,
  onRemove,
  disabled,
}: {
  title: string;
  description: string;
  entries: EvaluationConfigEntry[];
  emptyState: string;
  addLabel: string;
  presets: ConfigEntryPreset[];
  customLabel: string;
  onAdd: () => void;
  onUpdate: (entryId: string, field: "key" | "value", value: string) => void;
  onRemove: (entryId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 6,
        padding: "12px 14px",
        display: "grid",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div className="row between" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{title}</div>
          <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
            {description}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onAdd} disabled={disabled}>
          <Ic.Plus className="b-icon" />
          {addLabel}
        </button>
      </div>

      {entries.length > 0 ? (
        <div style={{ border: "1px solid var(--rule)", borderRadius: 6, overflow: "hidden", background: "var(--panel)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) auto",
              gap: 12,
              padding: "10px 12px",
              borderBottom: "1px solid var(--rule)",
              background: "var(--linen)",
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "var(--track-mini)",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            <div>Setting</div>
            <div>Value</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>

          <div style={{ display: "grid", background: "var(--panel)" }}>
            {entries.map((entry, index) => {
              const preset = findConfigEntryPreset(presets, entry.key);
              const selectedValue = getConfigEntrySelectValue(presets, entry.key);
              const isCustom = selectedValue === CUSTOM_CONFIG_ENTRY_VALUE;

              return (
                <div
                  key={entry.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) auto",
                    gap: 12,
                    padding: "12px",
                    borderTop: index > 0 ? "1px solid var(--rule)" : "none",
                    alignItems: "start",
                    background: "var(--panel)",
                  }}
                >
                  <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                    <select
                      value={selectedValue}
                      disabled={disabled}
                      onChange={(event) => {
                        const nextValue = event.target.value;

                        if (nextValue === CUSTOM_CONFIG_ENTRY_VALUE) {
                          onUpdate(entry.id, "key", "");
                          return;
                        }

                        onUpdate(entry.id, "key", nextValue);

                        const nextPreset = findConfigEntryPreset(presets, nextValue);
                        if (!entry.value.trim() && nextPreset?.defaultValue) {
                          onUpdate(entry.id, "value", nextPreset.defaultValue);
                        }
                      }}
                      style={{ width: "100%" }}
                    >
                      <option value="">Choose a setting</option>
                      {presets.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                      <option value={CUSTOM_CONFIG_ENTRY_VALUE}>{customLabel}</option>
                    </select>

                    {isCustom ? (
                      <input
                        value={entry.key}
                        disabled={disabled}
                        onChange={(event) => onUpdate(entry.id, "key", event.target.value)}
                        placeholder={customLabel === "Custom dataset field" ? "custom_dataset_field" : "custom_runner_setting"}
                        style={{ width: "100%" }}
                      />
                    ) : null}

                    <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                      {preset?.description ?? "Pick the kind of data or setting this row should capture."}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <input
                      value={entry.value}
                      disabled={disabled}
                      onChange={(event) => onUpdate(entry.id, "value", event.target.value)}
                      placeholder={preset?.valuePlaceholder ?? "Enter a value"}
                      style={{ width: "100%" }}
                    />
                    <div className="subtle" style={{ fontSize: 11.5 }}>
                      {preset ? `Example: ${preset.valuePlaceholder}` : "Enter the value to save with this setting."}
                    </div>
                  </div>

                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => onRemove(entry.id)}
                      disabled={disabled}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ border: "1px dashed var(--rule)", borderRadius: 6, padding: "12px 14px", fontSize: 12, color: "var(--ink-2)" }}>
          {emptyState}
        </div>
      )}
    </div>
  );
}

function ArtifactCompatibilitySection({ artifactBundle }: { artifactBundle: EvaluationArtifactBundle }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "12px 14px",
          display: "grid",
          gap: 8,
        }}
      >
        <div className="row between" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{artifactBundle.dataset.path}</div>
            <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>Dataset artifact</div>
          </div>
          <span className="chip chip-paper">v{artifactBundle.dataset.evalSetVersion}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Source dataset <span className="mono">{artifactBundle.dataset.sourceDataset}</span> · slice <span className="mono">{artifactBundle.dataset.datasetSlice}</span> · {artifactBundle.dataset.sampleCount} cases
        </div>
        <div className="subtle" style={{ fontSize: 11.5 }}>
          {artifactBundle.dataset.includeEdgeCases ? "Edge cases included" : "Standard cases only"}
        </div>
        <ArtifactConfigList label="Dataset fields" entries={artifactBundle.dataset.fields} presets={DATASET_FIELD_PRESETS} />
      </div>

      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "12px 14px",
          display: "grid",
          gap: 8,
        }}
      >
        <div className="row between" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{artifactBundle.rubric.path}</div>
            <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>Rubric artifact</div>
          </div>
          <span className="chip chip-paper">v{artifactBundle.rubric.rubricVersion}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Judge <span className="mono">{artifactBundle.rubric.judgeModel}</span> · pass {artifactBundle.rubric.thresholds.pass} · investigate {artifactBundle.rubric.thresholds.investigate}
        </div>
        <ArtifactConfigList label="Runner settings" entries={artifactBundle.rubric.runnerSettings} presets={RUNNER_SETTING_PRESETS} />
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {artifactBundle.rubric.dimensions.map((dimension) => (
            <span key={dimension.metricId} className="chip chip-paper">
              {dimension.metricLabel} {Math.round(dimension.weight * 100)}%
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 6,
          padding: "12px 14px",
          display: "grid",
          gap: 8,
        }}
      >
        <div className="row between" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{artifactBundle.baseline.path}</div>
            <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>Baseline / scorecard linkage</div>
          </div>
          <span className="chip chip-paper">{artifactBundle.baseline.compareAgainstBaseline ? "baseline linked" : "exploratory"}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Skill <span className="mono">{artifactBundle.baseline.skillId}</span> · version <span className="mono">{artifactBundle.baseline.skillVersion}</span>
        </div>
        <div className="subtle" style={{ fontSize: 11.5 }}>
          {artifactBundle.baseline.compareAgainstBaseline
            ? `Baseline ref ${artifactBundle.baseline.baselineRef ?? "not available yet"}`
            : "Exploratory draft — no baseline comparison will be enforced."}
        </div>
      </div>
    </div>
  );
}

function ArtifactConfigList({
  label,
  entries,
  presets,
}: {
  label: string;
  entries: EvaluationConfigEntry[];
  presets: ConfigEntryPreset[];
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="subtle" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ border: "1px solid var(--rule)", borderRadius: 6, overflow: "hidden" }}>
        {entries.map((entry, index) => {
          const preset = findConfigEntryPreset(presets, entry.key);

          return (
            <div
              key={`${entry.id}-${entry.key || index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: 12,
                padding: "8px 10px",
                borderTop: index > 0 ? "1px solid var(--rule)" : "none",
                fontSize: 11.5,
              }}
            >
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ color: "var(--ink)", fontWeight: 500 }}>{preset?.label ?? formatConfigEntryLabel(entry.key)}</span>
                {entry.key ? (
                  <span className="mono" style={{ color: "var(--subtle)" }}>{entry.key}</span>
                ) : null}
              </div>
              <span className="mono" style={{ color: "var(--ink-2)", textAlign: "right" }}>{entry.value || "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BenchmarkMetricStrip({ metrics }: { metrics: EvaluationMetric[] }) {
  return (
    <div
      style={{
        borderRadius: 6,
        background: "var(--rule)",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 1,
      }}
    >
      {metrics.map((metric) => {
        const delta = metric.candidate - metric.baseline;

        return (
          <div
            key={metric.id}
            style={{
              padding: "16px 18px",
              background: "var(--panel)",
              display: "grid",
              gap: 8,
            }}
          >
            <div className="eyebrow">{metric.label}</div>
            <div className="row between" style={{ gap: 10, alignItems: "baseline" }}>
              <div className="num" style={{ fontSize: 28, color: "var(--ink)" }}>{metric.candidate.toFixed(1)}</div>
              <div style={{ whiteSpace: "nowrap" }}>
                <Delta v={delta} />
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              Previous {metric.baseline.toFixed(1)} · {metric.note}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendationList({
  recommendations,
  expandedRecommendationId,
  recommendationDecisions,
  onToggleRecommendation,
  onSetRecommendationDecision,
}: {
  recommendations: EvaluationRecommendation[];
  expandedRecommendationId: string | null;
  recommendationDecisions: Record<string, RecommendationDecision>;
  onToggleRecommendation: (recommendationId: string) => void;
  onSetRecommendationDecision: (recommendationId: string, decision: RecommendationDecision) => void;
}) {
  const decisionCounts = RECOMMENDATION_DECISION_OPTIONS.map((option) => ({
    ...option,
    count: recommendations.filter((recommendation) => recommendationDecisions[recommendation.id] === option.value).length,
  }));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="chip chip-paper">{recommendations.length} recommendations</span>
        {decisionCounts.map((option) => (
          <span key={option.value} className={`chip chip-${option.tone}`}>
            {option.label} · {option.count}
          </span>
        ))}
      </div>

      <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
        Anything marked <strong style={{ color: "var(--ink)" }}>Queue next</strong> is mirrored into the related skill&apos;s <strong style={{ color: "var(--ink)" }}>Builder</strong> tab.
      </div>

      {recommendations.map((recommendation) => {
        const isExpanded = expandedRecommendationId === recommendation.id;
        const decision = recommendationDecisions[recommendation.id] ?? null;

        return (
          <section
            key={recommendation.id}
            style={{
              border: "1px solid var(--rule)",
              borderRadius: 6,
              overflow: "hidden",
              background: isExpanded ? "var(--linen)" : "var(--panel)",
            }}
          >
            <button
              type="button"
              onClick={() => onToggleRecommendation(recommendation.id)}
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "transparent",
                border: 0,
                textAlign: "left",
                display: "grid",
                gap: 10,
                cursor: "pointer",
              }}
            >
              <div className="row between" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{recommendation.title}</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
                    {recommendation.rationale}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <span className={recommendationEffortChipClass(recommendation)}>
                    {recommendation.category} · {recommendation.effort}
                  </span>
                  {decision ? (
                    <span className={recommendationDecisionChipClass(decision)}>
                      {RECOMMENDATION_DECISION_OPTIONS.find((option) => option.value === decision)?.label ?? decision}
                    </span>
                  ) : null}
                  <span className="chip chip-paper">{isExpanded ? "Hide detail" : "Open detail"}</span>
                </div>
              </div>

              <div className="row between" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  <span style={{ color: "var(--ink)", fontWeight: 600 }}>Impact:</span> {recommendation.impact}
                </div>
                <div className="subtle" style={{ fontSize: 11.5 }}>
                  {recommendation.actions.length} actions suggested
                </div>
              </div>
            </button>

            {isExpanded ? (
              <div style={{ borderTop: "1px solid var(--rule)", padding: "14px 16px", display: "grid", gap: 14 }}>
                <div className="grid-2" style={{ gap: 14 }}>
                  <div>
                    <div className="subtle" style={{ fontSize: 11.5, marginBottom: 6 }}>Why this matters</div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
                      {recommendation.rationale}
                    </div>
                  </div>
                  <div>
                    <div className="subtle" style={{ fontSize: 11.5, marginBottom: 6 }}>Decision shortcuts</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {RECOMMENDATION_DECISION_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`btn btn-sm ${decision === option.value ? recommendationDecisionButtonClass(option.value) : "btn-ghost"}`}
                          onClick={() => onSetRecommendationDecision(recommendation.id, option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="subtle" style={{ fontSize: 11.5, marginBottom: 6 }}>Recommended actions</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                    {recommendation.actions.map((action) => (
                      <li key={action} style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>{action}</li>
                    ))}
                  </ul>
                </div>

                {decision ? (
                  <div className="subtle" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                    Decision: {RECOMMENDATION_DECISION_OPTIONS.find((option) => option.value === decision)?.description}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function CommentSection({
  comments,
  commentDraft,
  editingCommentId,
  editingCommentDraft,
  onChangeCommentDraft,
  onChangeEditingCommentDraft,
  onAddComment,
  onStartEditingComment,
  onCancelEditingComment,
  onSaveEditedComment,
  onDeleteComment,
}: {
  comments: EvalComment[];
  commentDraft: { author: string; body: string };
  editingCommentId: string | null;
  editingCommentDraft: { author: string; body: string };
  onChangeCommentDraft: (next: { author: string; body: string }) => void;
  onChangeEditingCommentDraft: (next: { author: string; body: string }) => void;
  onAddComment: () => void;
  onStartEditingComment: (comment: EvalComment) => void;
  onCancelEditingComment: () => void;
  onSaveEditedComment: () => void;
  onDeleteComment: (commentId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 10, borderBottom: "1px solid var(--rule)", paddingBottom: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="eval-comment-author">Name</label>
          <input
            id="eval-comment-author"
            value={commentDraft.author}
            onChange={(event) => onChangeCommentDraft({ ...commentDraft, author: event.target.value })}
            placeholder="You"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="eval-comment-body">Add comment</label>
          <textarea
            id="eval-comment-body"
            rows={4}
            value={commentDraft.body}
            onChange={(event) => onChangeCommentDraft({ ...commentDraft, body: event.target.value })}
            placeholder="Add context, concerns, or a decision note for this eval."
            style={{ minHeight: 104, resize: "vertical" }}
          />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={onAddComment}>
            <Ic.Plus className="b-icon" />
            Add comment
          </button>
        </div>
      </div>

      {comments.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {comments.map((comment) => {
            const isEditing = editingCommentId === comment.id;

            return (
              <article key={comment.id} style={{ display: "grid", gap: 8 }}>
                <div className="row between" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{comment.author}</div>
                    <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {formatCommentTimestamp(comment.createdAt)}{comment.updatedAt ? ` · edited ${formatCommentTimestamp(comment.updatedAt)}` : ""}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {isEditing ? (
                      <>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancelEditingComment}>Cancel</button>
                        <button type="button" className="btn btn-sm btn-primary" onClick={onSaveEditedComment}>Save</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onStartEditingComment(comment)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDeleteComment(comment.id)}>Delete</button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="field">
                      <label className="field-label" htmlFor={`edit-comment-author-${comment.id}`}>Name</label>
                      <input
                        id={`edit-comment-author-${comment.id}`}
                        value={editingCommentDraft.author}
                        onChange={(event) => onChangeEditingCommentDraft({
                          ...editingCommentDraft,
                          author: event.target.value,
                        })}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor={`edit-comment-body-${comment.id}`}>Comment</label>
                      <textarea
                        id={`edit-comment-body-${comment.id}`}
                        rows={4}
                        value={editingCommentDraft.body}
                        onChange={(event) => onChangeEditingCommentDraft({
                          ...editingCommentDraft,
                          body: event.target.value,
                        })}
                        style={{ minHeight: 96, resize: "vertical" }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{comment.body}</div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="subtle" style={{ fontSize: 11.5 }}>
          No comments yet. Add one to capture review context or decisions for this eval.
        </div>
      )}
    </div>
  );
}

function CustomTestResultSection({
  result,
  runLabel,
}: {
  result: EvaluationCustomTestResult;
  runLabel?: string | null;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--rule)", padding: "18px 20px", display: "grid", gap: 14 }}>
      <div className="row between" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{result.headline}</div>
          {runLabel ? (
            <div className="subtle" style={{ fontSize: 11.5, marginTop: 4 }}>
              Test: {runLabel}
            </div>
          ) : null}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 5 }}>
            Runtime {result.runtimeSeconds}s · pass rate {result.passRate.toFixed(1)}% · score {result.score.toFixed(1)}
          </div>
        </div>
        <span className={resultStatusChipClass(result.status)}>{result.status}</span>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="chip chip-paper">Δ {result.delta.toFixed(1)} pts</span>
        <span className="chip chip-paper">{result.passRate.toFixed(1)}% pass rate</span>
        <span className="chip chip-paper">{result.runtimeSeconds}s runtime</span>
      </div>

      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
        {result.findings.map((finding) => (
          <li key={finding} style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{finding}</li>
        ))}
      </ul>

      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>Suggested next step:</span> {result.suggestedNextStep}
      </div>
    </div>
  );
}

function MetadataSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ padding: "16px 18px", borderTop: "1px solid var(--rule)" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}

function MetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(96px, 112px) minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
        marginTop: 10,
      }}
    >
      <div className="subtle" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function RunStatusChip({
  status,
  failed,
  compact = false,
}: {
  status: string;
  failed: number;
  compact?: boolean;
}) {
  if (status === "running") {
    return (
      <span className="chip chip-brass">
        <span className="dot" />
        {compact ? "running" : "Running"}
      </span>
    );
  }

  if (status === "complete-with-regressions") {
    return (
      <span className="chip chip-blood">
        <Ic.Warn style={{ width: 10, height: 10 }} />
        {compact ? `${failed || 0} regressions` : `${failed || 0} regressions`}
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="chip chip-blood">
        <Ic.Warn style={{ width: 10, height: 10 }} />
        {compact ? "failed" : "Failed"}
      </span>
    );
  }

  if (status === "complete-baseline") {
    return <span className="chip chip-paper">baseline set</span>;
  }

  return (
    <span className="chip chip-moss">
      <Ic.Check style={{ width: 10, height: 10 }} />
      {compact ? "passed" : "Passed"}
    </span>
  );
}

function EvaluationDetailLoadingState() {
  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/04</span>
            <span className="sep">—</span>
            <span>Evaluations</span>
          </div>
          <h1 className="h-display">Loading evaluation detail</h1>
          <div className="page-head-sub">
            Pulling the indexed run, related skill metadata, and current release context from the control plane.
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-bd">
          <div className="note">
            <Ic.Spinner className="n-icon" />
            <div className="grow">
              <div style={{ fontSize: 13, fontWeight: 500 }}>Loading live evaluation detail…</div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>
                This view now reads from the tenant-scoped evaluation detail API instead of local fixture composition.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EvaluationDetailUnavailableState({
  evaluationUuid,
  pathname,
  errorMessage,
  onRetry,
}: {
  evaluationUuid: string;
  pathname: string;
  errorMessage?: string | null;
  onRetry?: (() => void) | undefined;
}) {
  const evaluationsHref = buildTenantAwareAppPath(pathname, "/evaluations") as Route;
  const hasExplicitError = Boolean(errorMessage);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/04</span>
            <span className="sep">—</span>
            <span>Evaluations</span>
          </div>
          <h1 className="h-display">{hasExplicitError ? "Evaluation detail unavailable" : "Evaluation detail pending hydration"}</h1>
          <div className="page-head-sub">
            {hasExplicitError
              ? "The control plane could not return the live detail payload for this run right now."
              : "This run is visible from the live control-plane index, but the richer recommendations, comments, and Test Bench detail view has not been hydrated for it yet."}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-bd">
          <div className="note brass">
            <Ic.Warn className="n-icon" />
            <div className="grow">
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--brass-deep)" }}>
                {hasExplicitError
                  ? <>Could not load indexed run <span className="mono">{evaluationUuid}</span>.</>
                  : <>Detailed workspace support is not available for indexed run <span className="mono">{evaluationUuid}</span> yet.</>}
              </div>
              <div style={{ fontSize: 12, color: "var(--brass-deep)", opacity: 0.8, marginTop: 2 }}>
                {errorMessage ?? "You can still use the live evaluations index for status, coverage, and regression monitoring while this detail slice is wired up."}
              </div>
            </div>
            {onRetry ? (
              <button type="button" className="btn btn-sm" onClick={onRetry}>
                Retry
              </button>
            ) : null}
            <Link href={evaluationsHref} className="btn btn-sm">
              Back to evaluations
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function recommendationEffortChipClass(recommendation: EvaluationRecommendation) {
  if (recommendation.effort === "high") {
    return "chip chip-blood";
  }

  if (recommendation.effort === "medium") {
    return "chip chip-brass";
  }

  return "chip chip-moss";
}

function recommendationDecisionChipClass(decision: RecommendationDecision) {
  if (decision === "queue-next") {
    return "chip chip-moss";
  }

  if (decision === "needs-review") {
    return "chip chip-brass";
  }

  return "chip chip-paper";
}

function recommendationDecisionButtonClass(decision: RecommendationDecision) {
  if (decision === "queue-next") {
    return "btn-primary";
  }

  return "btn";
}

function resultStatusChipClass(status: EvaluationCustomTestResult["status"]) {
  if (status === "promising") {
    return "chip chip-moss";
  }

  if (status === "watch") {
    return "chip chip-brass";
  }

  return "chip chip-blood";
}
