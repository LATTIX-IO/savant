import { buildTenantAwareAppPath } from "./tenant-paths.ts";

type SkillIdentifier = {
  id: string;
  skillUuid: string;
};

export function matchesSkillIdentifier(skill: SkillIdentifier, identifier: string): boolean {
  return skill.skillUuid === identifier || skill.id === identifier;
}

export function findSkillByIdentifier<T extends SkillIdentifier>(
  skills: readonly T[],
  identifier: string,
): T | undefined {
  return skills.find((skill) => matchesSkillIdentifier(skill, identifier));
}

export function buildSkillDetailPath(pathname: string, skill: SkillIdentifier): string {
  return buildTenantAwareAppPath(pathname, `/skills/${encodeURIComponent(skill.skillUuid)}`);
}
