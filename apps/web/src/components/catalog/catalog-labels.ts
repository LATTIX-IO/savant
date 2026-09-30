/** Shared labels for the skill catalog (public site and in-app). */

export const VERDICT_LABEL: Record<string, string> = {
  validated: "Validated",
  analyzed: "Analyzed",
  caution: "Review advised",
  unsafe: "Unsafe",
  unverified: "Pending analysis",
};

export const VERDICT_HINT: Record<string, string> = {
  validated: "Passed Savant's safety scan and scored 70+ on a live evaluation.",
  analyzed: "Scanned or evaluated by Savant; not yet both passing.",
  caution: "SkillSpector or the source hub flagged patterns to review before use.",
  unsafe: "SkillSpector recommends not installing this skill.",
  unverified: "Imported from the source hub; Savant's analysis is still running.",
};

export const TRUST_LABEL: Record<string, string> = {
  official: "Official",
  verified: "Verified hub",
  community: "Community",
};

export function popularityLabel(popularity: Record<string, number>): string | null {
  const format = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value));
  if (popularity.installs) return `${format(popularity.installs)} installs`;
  if (popularity.downloads) return `${format(popularity.downloads)} downloads`;
  if (popularity.stars) return `${format(popularity.stars)} stars`;
  return null;
}
