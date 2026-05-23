import type { GitProvider, SkillTier } from "@savant/types";

import type { QueuedSkillRecommendation } from "./evaluation-recommendation-queue.ts";

export const MAX_SKILL_SOURCE_LENGTH = 200_000;

const QUEUED_RECOMMENDATIONS_SECTION_TITLE = "## Queued evaluation recommendations";
const QUEUED_RECOMMENDATIONS_SECTION_START = "<!-- savant:queued-recommendations:start -->";
const QUEUED_RECOMMENDATIONS_SECTION_END = "<!-- savant:queued-recommendations:end -->";

export interface SkillSourceDraftSeed {
  skillId: string;
  skillUuid: string;
  name: string;
  description: string;
  tier: SkillTier;
  owner: string;
  team: string;
  repo: string;
  repoProvider: GitProvider;
  branch: string;
  ref: string;
  candidateRef: string;
}

export type MarkdownPreviewBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string | null; content: string }
  | { type: "blockquote"; text: string };

export interface InsertQueuedSkillRecommendationsResult {
  draft: string;
  insertedCount: number;
  skippedCount: number;
}

function isMeaningfulValue(value: string | null | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return Boolean(normalized && normalized !== "—");
}

function buildMetadataLine(label: string, value: string | null | undefined): string | null {
  return isMeaningfulValue(value) ? `- ${label}: ${value.trim()}` : null;
}

export function buildFallbackSkillSourceContent(seed: SkillSourceDraftSeed): string {
  const metadataLines = [
    buildMetadataLine("Skill ID", seed.skillId),
    buildMetadataLine("Skill UUID", seed.skillUuid),
    buildMetadataLine("Owner", seed.owner),
    buildMetadataLine("Team", seed.team),
    buildMetadataLine("Tier", `Tier ${seed.tier}`),
    buildMetadataLine("Repository", seed.repo),
    buildMetadataLine("Provider", seed.repoProvider),
    buildMetadataLine("Branch", seed.branch),
    buildMetadataLine("Production ref", seed.ref),
    buildMetadataLine("Candidate ref", seed.candidateRef),
  ].filter((line): line is string => Boolean(line));

  return [
    `# ${seed.name}`,
    "",
    seed.description.trim(),
    "",
    "## Metadata",
    ...metadataLines,
    "",
    "## Responsibilities",
    "- Describe the core task this skill performs.",
    "- Define the expected inputs, outputs, and decision boundaries.",
    "- Capture any safety, policy, or quality guardrails required before release.",
    "",
    "## Evaluation focus",
    "- Explain what success means for the next evaluation cycle.",
    "- Document known regressions, reviewer notes, or queued improvements to address.",
    "",
    "## Operating notes",
    "- Reference supporting assets such as metadata, eval datasets, and rubrics when they exist.",
    "- Keep implementation guidance precise enough that future edits remain reviewable.",
  ].join("\n");
}

function normalizeMarkdown(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n");
}

function isBulletListLine(line: string): boolean {
  return /^[-*+]\s+/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isBlockquoteLine(line: string): boolean {
  return /^>\s?/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^(?:[-*+]|\d+\.)\s+/, "").trim();
}

function isCodeFence(line: string): boolean {
  return /^```/.test(line.trim());
}

function isHtmlCommentLine(line: string): boolean {
  return /^<!--.*-->$/.test(line.trim());
}

function isSpecialMarkdownStart(line: string): boolean {
  return isHeadingLine(line)
    || isBulletListLine(line)
    || isOrderedListLine(line)
    || isBlockquoteLine(line)
    || isCodeFence(line)
    || isHtmlCommentLine(line);
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

function buildQueuedRecommendationMarker(recommendation: QueuedSkillRecommendation): string {
  return `<!-- savant:queued-recommendation:${recommendation.queueId} -->`;
}

function buildQueuedRecommendationBlock(recommendation: QueuedSkillRecommendation): string {
  return [
    buildQueuedRecommendationMarker(recommendation),
    `### ${recommendation.title}`,
    `- Source evaluation: ${recommendation.evaluationRef} · ${recommendation.evaluationDataset} · ${recommendation.evaluationStarted}`,
    `- Category: ${formatQueuedRecommendationValue(recommendation.category)}`,
    `- Effort: ${formatQueuedRecommendationValue(recommendation.effort)}`,
    `- Impact: ${recommendation.impact}`,
    "",
    recommendation.rationale,
    "",
    "Recommended actions:",
    ...recommendation.actions.map((action) => `- ${action}`),
  ].join("\n");
}

function appendQueuedRecommendationSection(
  normalizedDraft: string,
  blocks: string[],
): string {
  if (blocks.length === 0) {
    return normalizedDraft;
  }

  if (
    normalizedDraft.includes(QUEUED_RECOMMENDATIONS_SECTION_START)
    && normalizedDraft.includes(QUEUED_RECOMMENDATIONS_SECTION_END)
  ) {
    const endMarkerIndex = normalizedDraft.indexOf(QUEUED_RECOMMENDATIONS_SECTION_END);
    const beforeEndMarker = normalizedDraft.slice(0, endMarkerIndex).trimEnd();
    const afterEndMarker = normalizedDraft.slice(endMarkerIndex);

    return `${beforeEndMarker}\n\n${blocks.join("\n\n")}\n\n${afterEndMarker}`;
  }

  const prefix = normalizedDraft.trim()
    ? `${normalizedDraft.trimEnd()}\n\n`
    : "";

  return [
    prefix,
    QUEUED_RECOMMENDATIONS_SECTION_TITLE,
    QUEUED_RECOMMENDATIONS_SECTION_START,
    "",
    blocks.join("\n\n"),
    "",
    QUEUED_RECOMMENDATIONS_SECTION_END,
  ].join("\n").trimEnd();
}

export function parseMarkdownPreviewBlocks(markdown: string): MarkdownPreviewBlock[] {
  const lines = normalizeMarkdown(markdown);
  const blocks: MarkdownPreviewBlock[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isHtmlCommentLine(trimmed)) {
      index += 1;
      continue;
    }

    if (isCodeFence(trimmed)) {
      const match = /^```([A-Za-z0-9_-]+)?\s*$/.exec(trimmed);
      const language = match?.[1] ?? null;
      const contentLines: string[] = [];
      index += 1;

      while (index < lines.length && !isCodeFence(lines[index] ?? "")) {
        contentLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length && isCodeFence(lines[index] ?? "")) {
        index += 1;
      }

      blocks.push({
        type: "code",
        language,
        content: contentLines.join("\n").trimEnd(),
      });
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2]!.trim(),
      });
      index += 1;
      continue;
    }

    if (isBulletListLine(trimmed) || isOrderedListLine(trimmed)) {
      const ordered = isOrderedListLine(trimmed);
      const items: string[] = [];

      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        if (!candidate) {
          index += 1;
          break;
        }

        if ((ordered && !isOrderedListLine(candidate)) || (!ordered && !isBulletListLine(candidate))) {
          break;
        }

        items.push(stripListMarker(candidate));
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (isBlockquoteLine(trimmed)) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        if (!candidate) {
          index += 1;
          break;
        }

        if (!isBlockquoteLine(candidate)) {
          break;
        }

        quoteLines.push(candidate.replace(/^>\s?/, "").trim());
        index += 1;
      }

      blocks.push({
        type: "blockquote",
        text: quoteLines.join(" ").trim(),
      });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      const candidateTrimmed = candidate.trim();

      if (!candidateTrimmed) {
        index += 1;
        break;
      }

      if (isSpecialMarkdownStart(candidateTrimmed) && paragraphLines.length > 0) {
        break;
      }

      paragraphLines.push(candidateTrimmed);
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" ").trim(),
    });
  }

  return blocks;
}

export function insertQueuedSkillRecommendationsIntoDraft(
  draft: string,
  recommendations: QueuedSkillRecommendation[],
): InsertQueuedSkillRecommendationsResult {
  const normalizedDraft = draft.replace(/\r\n?/g, "\n").trimEnd();
  const uniqueRecommendations = recommendations.filter((recommendation, index, collection) => (
    collection.findIndex((candidate) => candidate.queueId === recommendation.queueId) === index
  ));

  let skippedCount = 0;
  const blocksToInsert = uniqueRecommendations.flatMap((recommendation) => {
    if (normalizedDraft.includes(buildQueuedRecommendationMarker(recommendation))) {
      skippedCount += 1;
      return [];
    }

    return [buildQueuedRecommendationBlock(recommendation)];
  });

  return {
    draft: appendQueuedRecommendationSection(normalizedDraft, blocksToInsert),
    insertedCount: blocksToInsert.length,
    skippedCount,
  };
}
