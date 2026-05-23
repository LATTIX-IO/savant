"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Fragment, type ReactNode, useEffect, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { OnboardingProvider } from "@/components/savant/onboarding-context";
import { OnboardingModal } from "@/components/savant/onboarding-modal";
import { SavantLogo } from "@/components/savant/savant-logo";
import { TweaksProvider, useTweaks } from "@/components/savant/tweaks-context";
import { TweaksPanel } from "@/components/savant/tweaks-panel";
import type { AuthViewer } from "@/lib/auth0-session";
import { fetchSkillDetail } from "@/lib/control-plane-client";
import {
  buildSavantShellBreadcrumbs,
  EMPTY_SAVANT_SHELL_DATA,
  type SavantShellData,
} from "@/lib/shell-state";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";
import {
  buildTenantAppPath,
  extractWorkspaceSlugFromPathname,
  stripTenantPathPrefix,
} from "@/lib/tenant-paths";
import { buildBinaryThemeToggleState } from "@/lib/theme-toggle";

type WorkspaceSummary = {
  name: string;
  short: string;
  env: string;
  slug: string;
};

type WorkspaceMembershipSummary = WorkspaceSummary & {
  isDefault: boolean;
  isLastUsed: boolean;
};

export function SavantShell({
  children,
  viewer,
  shellData,
  workspace,
  memberships,
}: {
  children: ReactNode;
  viewer: AuthViewer;
  shellData?: SavantShellData;
  workspace?: WorkspaceSummary;
  memberships?: WorkspaceMembershipSummary[];
}) {
  return (
    <TweaksProvider>
      <OnboardingProvider>
        <div className="app">
          <Sidebar viewer={viewer} {...(shellData ? { shellData } : {})} />
          <TopBar viewer={viewer} {...(workspace ? { workspace } : {})} {...(memberships ? { memberships } : {})} />
          <div className="page">{children}</div>
          <OnboardingModal />
          <TweaksPanel />
        </div>
      </OnboardingProvider>
    </TweaksProvider>
  );
}

function Sidebar({ viewer, shellData }: { viewer: AuthViewer; shellData?: SavantShellData }) {
  const pathname = usePathname() || "/";
  const workspaceSlug = extractWorkspaceSlugFromPathname(pathname);
  const appPath = stripTenantPathPrefix(pathname);
  const counts = shellData?.counts ?? EMPTY_SAVANT_SHELL_DATA.counts;

  type Item = {
    href: Route;
    label: string;
    icon: (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
    count: number | null;
    match: (path: string) => boolean;
  };

  const workspaceItems: Item[] = [
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/dashboard") : "/dashboard") as Route, label: "Overview", icon: Ic.Overview, count: null, match: (p) => p === "/dashboard" },
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/skills") : "/skills") as Route, label: "Skills", icon: Ic.Skills, count: counts.skills, match: (p) => p.startsWith("/skills") },
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/repositories") : "/repositories") as Route, label: "Repositories", icon: Ic.Repo, count: counts.repositories, match: (p) => p.startsWith("/repositories") },
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/evaluations") : "/evaluations") as Route, label: "Evaluations", icon: Ic.Eval, count: counts.evaluations, match: (p) => p.startsWith("/evaluations") },
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/releases") : "/releases") as Route, label: "Releases", icon: Ic.Release, count: counts.releases, match: (p) => p.startsWith("/releases") },
  ];
  const govItems: Item[] = [
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/policies") : "/policies") as Route, label: "Policies", icon: Ic.Policy, count: counts.policies, match: (p) => p.startsWith("/policies") },
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/audit") : "/audit") as Route, label: "Audit", icon: Ic.Audit, count: null, match: (p) => p.startsWith("/audit") },
    { href: (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/connectors") : "/connectors") as Route, label: "Connectors", icon: Ic.Connectors, count: counts.connectors, match: (p) => p.startsWith("/connectors") },
  ];
  const showGovernanceNavigation = isGovernanceFeatureEnabled();

  const renderItem = (it: Item) => {
    const Icon = it.icon;
    const active = it.match(appPath);
    return (
      <Link key={it.href} href={it.href} className={`nav-item ${active ? "active" : ""}`}>
        <Icon className="nav-icon" />
        <span>{it.label}</span>
        {it.count != null ? <span className="nav-count num">{it.count}</span> : null}
      </Link>
    );
  };

  const settingsActive = appPath.startsWith("/settings");
  const dashboardHref = (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/dashboard") : "/dashboard") as Route;
  const settingsHref = (workspaceSlug ? buildTenantAppPath(workspaceSlug, "/settings") : "/settings") as Route;

  return (
    <aside className="sidebar">
      <Link href={dashboardHref} className="brand" aria-label="Savant dashboard">
        <SavantLogo className="brand-logo" />
      </Link>

      <nav className="nav">
        <div className="nav-group">
          <div className="nav-group-label">Workspace</div>
          {workspaceItems.map(renderItem)}
        </div>
        {showGovernanceNavigation ? (
          <div className="nav-group">
            <div className="nav-group-label">Governance</div>
            {govItems.map(renderItem)}
          </div>
        ) : null}
      </nav>

      <div className="nav-pinned">
        <Link href={settingsHref} className={`nav-item ${settingsActive ? "active" : ""}`}>
          <Ic.Settings className="nav-icon" />
          <span>Settings</span>
        </Link>
      </div>

      <div className="sidebar-foot">
        <div className="avatar">{viewer.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="foot-user-name">{viewer.displayName}</div>
          <div className="foot-user-role">{viewer.subtitle}</div>
        </div>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto" }}>
          <Ic.ChevR style={{ width: 12, height: 12 }} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({
  viewer,
  workspace,
  memberships,
}: {
  viewer: AuthViewer;
  workspace?: WorkspaceSummary;
  memberships?: WorkspaceMembershipSummary[];
}) {
  const pathname = usePathname() || "/";
  const workspaceSlug = extractWorkspaceSlugFromPathname(pathname);
  const appPath = stripTenantPathPrefix(pathname);
  const { resolvedTheme, set } = useTweaks();
  const themeToggle = buildBinaryThemeToggleState(resolvedTheme);
  const [resolvedSkillTitle, setResolvedSkillTitle] = useState<{
    skillId: string;
    title: string | null;
  } | null>(null);
  const currentWorkspace = workspace ?? {
    name: "Workspace",
    short: "SV",
    env: "development",
    slug: "workspace",
  };
  const currentAppPath = appPath === "/" ? "/dashboard" : appPath;
  const workspaceOptions = memberships ?? [];
  const activeSkillId = appPath.startsWith("/skills/") && appPath !== "/skills"
    ? appPath.split("/")[2]?.trim() ?? ""
    : "";
  const skillTitle = activeSkillId && resolvedSkillTitle?.skillId === activeSkillId
    ? resolvedSkillTitle.title
    : null;

  useEffect(() => {
    if (!activeSkillId) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function loadSkillTitle() {
      try {
        const response = await fetchSkillDetail(activeSkillId, {
          ...(workspaceSlug ? { workspaceSlug } : {}),
          signal: controller.signal,
        });

        if (active) {
          setResolvedSkillTitle({
            skillId: activeSkillId,
            title: response.data.skill.name,
          });
        }
      } catch {
        if (active && !controller.signal.aborted) {
          setResolvedSkillTitle({
            skillId: activeSkillId,
            title: null,
          });
        }
      }
    }

    void loadSkillTitle();

    return () => {
      active = false;
      controller.abort();
    };
  }, [activeSkillId, workspaceSlug]);

  const crumbs = buildSavantShellBreadcrumbs(appPath, { skillTitle });

  return (
    <header className="topbar">
      {workspaceOptions.length > 1 ? (
        <details style={{ position: "relative" }}>
          <summary
            className="btn btn-sm"
            style={{
              background: "var(--ivory)",
              border: "1px solid var(--rule-2)",
              listStyle: "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                background: "var(--solid)",
                color: "var(--on-solid)",
                display: "grid",
                placeItems: "center",
                borderRadius: 3,
                fontSize: 9,
                fontWeight: 600,
              }}
            >
              {currentWorkspace.short}
            </span>
            <span>{currentWorkspace.name}</span>
            <Ic.ChevD className="b-icon" />
          </summary>
          <div
            className="panel"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              minWidth: 260,
              padding: 8,
              zIndex: 20,
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 8, fontSize: 10 }}>
              Switch workspace
            </div>
            <div className="col" style={{ gap: 4 }}>
              {workspaceOptions.map((membership) => {
                const href = buildTenantAppPath(membership.slug, currentAppPath) as Route;
                const isCurrent = membership.slug === currentWorkspace.slug;

                return (
                  <Link
                    key={membership.slug}
                    href={href}
                    className="row between"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 5,
                      border: `1px solid ${isCurrent ? "var(--moss-soft)" : "var(--rule)"}`,
                      background: isCurrent ? "var(--moss-soft)" : "var(--panel)",
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          background: "var(--solid)",
                          color: "var(--on-solid)",
                          display: "grid",
                          placeItems: "center",
                          borderRadius: 4,
                          fontSize: 9,
                          fontWeight: 600,
                        }}
                      >
                        {membership.short}
                      </span>
                      <div className="col" style={{ gap: 2 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>
                          {membership.name}
                        </span>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          /o/{membership.slug}
                        </span>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {membership.isDefault ? (
                        <span className="chip chip-paper" style={{ fontSize: 10 }}>default</span>
                      ) : null}
                      {membership.isLastUsed && !isCurrent ? (
                        <span className="chip chip-paper" style={{ fontSize: 10 }}>recent</span>
                      ) : null}
                      {isCurrent ? (
                        <span className="chip chip-moss" style={{ fontSize: 10 }}>
                          <span className="dot" />current
                        </span>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </details>
      ) : (
        <button
          type="button"
          className="btn btn-sm"
          style={{ background: "var(--ivory)", border: "1px solid var(--rule-2)" }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              background: "var(--solid)",
              color: "var(--on-solid)",
              display: "grid",
              placeItems: "center",
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 600,
            }}
          >
            {currentWorkspace.short}
          </span>
          <span>{currentWorkspace.name}</span>
          <Ic.ChevD className="b-icon" />
        </button>
      )}

      <div className="crumbs">
        {crumbs.map(([label, target], i) => (
          <Fragment key={`${label}-${i}`}>
            {i > 0 && <span className="sep">/</span>}
            {target && target !== "current" ? (
              <Link href={target} className="link">
                {label}
              </Link>
            ) : (
              <span className={target === "current" ? "current" : ""}>{label}</span>
            )}
          </Fragment>
        ))}
      </div>

      <div className="env-pill" title="Environment">
        <span className="dot" />
        <span>{currentWorkspace.env}</span>
      </div>

      <div className="topbar-search">
        <Ic.Search className="s-icon" />
        <input placeholder="Search skills, repos, evals, releases…" />
        <span className="kbd">⌘ K</span>
      </div>

      <button
        type="button"
        className="icon-btn"
        aria-label={themeToggle.title}
        aria-pressed={themeToggle.isDark}
        title={themeToggle.title}
        onClick={() => set("theme", themeToggle.nextTheme)}
      >
        {themeToggle.isDark ? (
          <Ic.Sun style={{ width: 14, height: 14 }} />
        ) : (
          <Ic.Moon style={{ width: 14, height: 14 }} />
        )}
      </button>

      <button type="button" className="icon-btn" title="Notifications">
        <Ic.Bell style={{ width: 14, height: 14 }} />
        <span className="badge-dot" />
      </button>

      <a
        href={viewer.isAuthenticated ? "/auth/logout" : "/signin"}
        className="btn btn-sm"
        style={{ whiteSpace: "nowrap" }}
      >
        {viewer.isAuthenticated ? "Log out" : "Log in"}
      </a>
    </header>
  );
}
