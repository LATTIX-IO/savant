import type { Route } from "next";

export type SavantShellCounts = {
  skills: number | null;
  repositories: number | null;
  evaluations: number | null;
  releases: number | null;
  policies: number | null;
  connectors: number | null;
};

export interface SavantShellData {
  counts: SavantShellCounts;
}

export type SavantShellCrumbTarget = Route | null | "current";
export type SavantShellCrumb = readonly [label: string, target: SavantShellCrumbTarget];

const TITLE_BY_PATH: Record<string, { group: string; title: string }> = {
  "/dashboard": { group: "Workspace", title: "Overview" },
  "/skills": { group: "Workspace", title: "Skills" },
  "/repositories": { group: "Workspace", title: "Repositories" },
  "/evaluations": { group: "Workspace", title: "Evaluations" },
  "/releases": { group: "Workspace", title: "Releases" },
  "/policies": { group: "Governance", title: "Policies" },
  "/audit": { group: "Governance", title: "Audit" },
  "/connectors": { group: "Governance", title: "Connectors" },
  "/settings": { group: "System", title: "Settings" },
};

export const EMPTY_SAVANT_SHELL_DATA: SavantShellData = {
  counts: {
    skills: null,
    repositories: null,
    evaluations: null,
    releases: null,
    policies: null,
    connectors: null,
  },
};

export function buildSavantShellData(counts: Partial<SavantShellCounts> = {}): SavantShellData {
  return {
    counts: {
      ...EMPTY_SAVANT_SHELL_DATA.counts,
      ...counts,
    },
  };
}

export function buildSavantShellBreadcrumbs(
  appPath: string,
  options?: {
    skillTitle?: string | null;
  },
): SavantShellCrumb[] {
  if (appPath.startsWith("/skills/") && appPath !== "/skills") {
    const skillTitle = options?.skillTitle?.trim() || "Skill";

    return [
      ["Workspace", null],
      ["Skills", "/skills"],
      [skillTitle, "current"],
    ];
  }

  if (appPath.startsWith("/evaluations/") && appPath !== "/evaluations") {
    const uuid = appPath.split("/")[2]?.trim() || "Evaluation";

    return [
      ["Workspace", null],
      ["Evaluations", "/evaluations"],
      [uuid, "current"],
    ];
  }

  const info = TITLE_BY_PATH[appPath] ?? { group: "Workspace", title: "Overview" };

  return [
    [info.group, null],
    [info.title, "current"],
  ];
}