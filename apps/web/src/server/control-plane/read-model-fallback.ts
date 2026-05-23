import { getRepositoryProviderReadiness } from "@savant/types";
import type {
  RepositoryListItem,
  SkillListItem,
  SourceOfTruth,
} from "@savant/types";

import { buildRepositoryWebUrl } from "../../lib/repository-links.ts";
import { REPOS, SKILLS } from "../../lib/savant-data.ts";

export const FALLBACK_OVERVIEW_SOURCE_OF_TRUTH: SourceOfTruth = "mixed";
export const FALLBACK_REPOSITORY_LIST_SOURCE_OF_TRUTH: SourceOfTruth = "mixed";
export const FALLBACK_REPOSITORY_DETAIL_SOURCE_OF_TRUTH: SourceOfTruth = "mixed";
export const FALLBACK_SKILL_LIST_SOURCE_OF_TRUTH: SourceOfTruth = "derived-index";
export const FALLBACK_SKILL_DETAIL_SOURCE_OF_TRUTH: SourceOfTruth = "mixed";

export function emptyRepositoryProjection(): RepositoryListItem["projection"] {
  return {
    indexedAt: null,
    lastSuccessfulSyncAt: null,
    lastWebhookAt: null,
  };
}

export function emptySkillProjection(): SkillListItem["projection"] {
  return {
    sourcePath: null,
    sourceCommitSha: null,
    indexedAt: null,
  };
}

export function mapFallbackRepository(repository: (typeof REPOS)[number]): RepositoryListItem {
  return {
    ...repository,
    providerReadiness: getRepositoryProviderReadiness(repository.provider),
    webUrl: buildRepositoryWebUrl({
      provider: repository.provider,
      name: repository.name,
    }),
    projection: emptyRepositoryProjection(),
  };
}

export function mapFallbackSkill(skill: (typeof SKILLS)[number]): SkillListItem {
  return {
    ...skill,
    projection: emptySkillProjection(),
  };
}