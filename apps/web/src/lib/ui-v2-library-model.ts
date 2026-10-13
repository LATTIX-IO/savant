import type { OverviewKpi, OverviewPayload, RepositoryListItem, SkillListItem } from "@savant/types";

export type LibrarySection = "skills" | "repositories";
export type LibraryStage = "all" | "production" | "staging" | "draft" | "candidate";

export function filterUiV2Skills(
  skills: readonly SkillListItem[],
  term: string,
  stage: LibraryStage,
): SkillListItem[] {
  const needle = term.trim().toLocaleLowerCase();
  return skills.filter(skill => {
    const stageMatch =
      stage === "all" ||
      (stage === "candidate" ? skill.status.startsWith("candidate") : skill.channel === stage);
    const textMatch = needle.length === 0 ||
      [skill.name, skill.description, skill.owner, skill.team, skill.repo]
        .some(value => value.toLocaleLowerCase().includes(needle));
    return stageMatch && textMatch;
  });
}

export function filterUiV2Repositories(
  repositories: readonly RepositoryListItem[],
  term: string,
): RepositoryListItem[] {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return [...repositories];
  return repositories.filter(repository =>
    [repository.name, repository.branch, repository.provider]
      .some(value => value.toLocaleLowerCase().includes(needle)),
  );
}

export type RepositoryHealth = "ready" | "indexing" | "action-required" | "not-indexed";
export function getUiV2RepositoryHealth(repository: RepositoryListItem): RepositoryHealth {
  if (repository.syncState === "failed" || repository.syncState === "auth_required" ||
    repository.syncState === "access_revoked" || repository.status !== "ok") {
    return "action-required";
  }
  if (repository.syncState === "indexing") return "indexing";
  // Connection does not imply indexing. A null timestamp is authoritative.
  return repository.projection.indexedAt !== null ? "ready" : "not-indexed";
}

export function getUiV2Kpi(overview: OverviewPayload, key: OverviewKpi["key"]): OverviewKpi | null {
  return overview.kpis.find(item => item.key === key && Number.isFinite(item.value)) ?? null;
}

export function safeUiV2Count(count: unknown): number | null {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function uiV2ProvenanceNote(repository: RepositoryListItem): string {
  if (repository.projection.indexedAt === null) return "Not indexed";
  // Do not claim the source commit is verified from a display timestamp.
  return `Indexed: ${repository.projection.indexedAt}`;
}
