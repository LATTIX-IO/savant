"use client";

import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { Ic } from "@/components/savant/icons";
import { useTweaks } from "@/components/savant/tweaks-context";
import { UiV2Surface } from "@/components/savant/ui-v2";
import { UiV2ModeProvider } from "@/components/savant/ui-v2/mode";
import type { WorkspaceMembershipSummary, WorkspaceSummary } from "@/components/savant/app-shell";
import type { AuthViewer } from "@/lib/auth0-session";
import { fetchSkillDetail } from "@/lib/control-plane-client";
import {
  EMPTY_SAVANT_SHELL_DATA, type SavantShellData,
} from "@/lib/shell-state";
import { buildBinaryThemeToggleState } from "@/lib/theme-toggle";
import { buildTenantAppPath, stripTenantPathPrefix } from "@/lib/tenant-paths";
import {
  buildUiV2RouteCrumbs, buildUiV2WorkspaceSwitchPath, getUiV2WorkspaceNavigation,
  resolveUiV2Route, type UiV2WorkspaceNavId,
} from "@/lib/ui-v2-shell-model";
import { SavantCommandPalette, type PaletteIntent } from "@/components/savant/savant-command-palette";
import { isGovernanceFeatureEnabled } from "@/lib/workspace-features";

import styles from "./app-shell-v2.module.css";

const iconById: Record<UiV2WorkspaceNavId, (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  overview: Ic.Overview, library: Ic.Skills, workbench: Ic.Repo, evaluations: Ic.Eval,
  runs: Ic.Clock, insights: Ic.Eval, integrations: Ic.Connectors, settings: Ic.Settings,
};
const groups = [{ id: "primary", label: "Workspaces" }, { id: "admin", label: "Administration" }] as const;

export function SavantShellV2({
  children, viewer, shellData, workspace, memberships,
}: {
  children: ReactNode;
  viewer: AuthViewer;
  shellData?: SavantShellData | undefined;
  workspace: WorkspaceSummary;
  memberships: readonly WorkspaceMembershipSummary[];
}) {
  const pathname = usePathname() || "/";
  const appPath = stripTenantPathPrefix(pathname);
  const counts = shellData?.counts ?? EMPTY_SAVANT_SHELL_DATA.counts;
  const navItems = getUiV2WorkspaceNavigation(workspace.slug, appPath, counts);
  const [paletteIntent, setPaletteIntent] = useState<PaletteIntent | null>(null);
  const { resolvedTheme, values, set } = useTweaks();
  const toggle = buildBinaryThemeToggleState(resolvedTheme);
  const dashboardHref = buildUiV2WorkspaceSwitchPath(workspace.slug, "/dashboard") as Route;
  const [resolvedTitle, setResolvedTitle] = useState<{ context: string; title: string | null } | null>(null);
  const route = resolveUiV2Route(appPath);
  const activeSkill = route.kind === "detail" && route.navId === "skills" ? route.resourceId : "";
  const mainRef = useRef<HTMLElement>(null);
  const previousLocation = useRef(`${workspace.slug}:${pathname}`);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteIntent("all");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  // Keep tab order and screen-reader location aligned after actual client-side
  // route changes. Do not steal focus on initial hydration or override scroll
  // restoration on Back/Forward; query-only state stays in the destination page.
  useEffect(() => {
    const current = `${workspace.slug}:${pathname}`;
    if (previousLocation.current === current) return;
    previousLocation.current = current;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, workspace.slug]);
  const skillContext = `${workspace.slug}/${activeSkill}`;

  useEffect(() => {
    if (!activeSkill) return;
    const controller = new AbortController();
    let mounted = true;
    async function loadTitle() {
      try {
        const response = await fetchSkillDetail(activeSkill, {
          workspaceSlug: workspace.slug, signal: controller.signal,
        });
        if (mounted) setResolvedTitle({ context: skillContext, title: response.data.skill.name });
      } catch {
        if (mounted && !controller.signal.aborted) {
          setResolvedTitle({ context: skillContext, title: null });
        }
      }
    }
    void loadTitle();
    return () => { mounted = false; controller.abort(); };
  }, [activeSkill, skillContext, workspace.slug]);

  const skillTitle = resolvedTitle?.context === skillContext ? resolvedTitle.title : null;
  const crumbs = buildUiV2RouteCrumbs(workspace.slug, appPath, { skillTitle });
  const density = values.density === "compact" ? "compact" : "comfortable";

  return (
    <UiV2Surface className={styles.shell} density={density}>
      <a className={styles.skipLink} href="#sv2-content">Skip to main content</a>
      <div className={styles.topband} aria-hidden="true" />
      <header className={styles.topbar}>
        <Link className={styles.brand} href={dashboardHref} aria-label="Savant Overview">
          <span className={styles.brandMark} aria-hidden="true">
            <Image className={styles.brandMarkLight} src="/brand/savant-ui-v2-light.svg" alt="" width={24} height={24} />
            <Image className={styles.brandMarkDark} src="/brand/savant-ui-v2-dark.svg" alt="" width={24} height={24} />
          </span><span>SAVANT</span>
        </Link>
        <div className={styles.workspaceMenu}>
          {memberships.length > 1 ? (
            <details key={workspace.slug} className={styles.switcher}
              onKeyDown={event => {
                if (event.key === "Escape" && event.currentTarget.open) {
                  event.stopPropagation();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}>
              <summary className={styles.workspaceButton} aria-label={`Workspace: ${workspace.name}. Switch workspace`}>
                <span className={styles.workspaceBadge} aria-hidden="true">{workspace.short}</span>
                <span className={styles.workspaceName}>{workspace.name}</span>
                <Ic.ChevD className={styles.icon} aria-hidden="true" />
              </summary>
              <div className={styles.workspaceOptions}>
                <div className={styles.menuLabel}>Switch workspace</div>
                {memberships.map(member => (
                  <Link key={member.slug} className={styles.workspaceOption}
                    href={buildUiV2WorkspaceSwitchPath(member.slug, appPath) as Route}
                    aria-current={member.slug === workspace.slug ? "page" : undefined}
                    onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); }}>
                    <span className={styles.workspaceBadge} aria-hidden="true">{member.short}</span>
                    <span className={styles.workspaceOptionText}>
                      <strong>{member.name}</strong>
                      <small>{member.isDefault ? "Default workspace" : member.isLastUsed ? "Recently used" : "Workspace"}</small>
                    </span>
                    {member.slug === workspace.slug ? <Ic.Check className={styles.icon} aria-label="Current workspace" /> : null}
                  </Link>
                ))}
              </div>
            </details>
          ) : (
            <span className={styles.workspaceButton}>
              <span className={styles.workspaceBadge} aria-hidden="true">{workspace.short}</span>
              <span className={styles.workspaceName}>{workspace.name}</span>
            </span>
          )}
        </div>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumbs">
          {crumbs.map((crumb, i) => (
            <Fragment key={`${i}:${crumb.label}`}>
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.href
                ? <Link href={crumb.href as Route}>{crumb.label}</Link>
                : <span aria-current={crumb.current ? "page" : undefined}>{crumb.label}</span>}
            </Fragment>
          ))}
        </nav>
        <div className={styles.topActions}>
          <button type="button" className={styles.actionLink} aria-keyshortcuts="Control+K Meta+K"
            title="Search authorized skills, runs and sections (Ctrl K)" aria-label="Search Savant"
            onClick={() => setPaletteIntent("all")}>
            <Ic.Search className={styles.icon} aria-hidden="true" />
            <span className={styles.searchLabel}>Search</span>
            <kbd className={styles.shortcut}>Ctrl K</kbd>
          </button>
          <button type="button" className={styles.iconButton}
            aria-label={toggle.title} title={toggle.title} aria-pressed={toggle.isDark}
            onClick={() => set("theme", toggle.nextTheme)}>
            {toggle.isDark ? <Ic.Sun className={styles.icon} aria-hidden="true" /> :
              <Ic.Moon className={styles.icon} aria-hidden="true" />}
          </button>
          <a href={viewer.isAuthenticated ? "/auth/logout" : "/signin"} className={styles.logout}>
            {viewer.isAuthenticated ? "Log out" : "Log in"}
          </a>
        </div>
      </header>
      <aside className={styles.sidebar} aria-label="Application navigation">
        <nav className={styles.nav} aria-label="Savant sections">
          {groups.map(group => {
            const items = navItems.filter(item => item.group === group.id);
            return <div key={group.id} className={styles.navGroup}>
              <div className={styles.navGroupTitle}>{group.label}</div>
              {items.map(it => {
                const Icon = iconById[it.id];
                const content = <>
                  <Icon className={styles.icon} aria-hidden="true" />
                  <span>{it.label}</span>
                  {it.count !== null ? <span className={styles.count}>{it.count}</span> : null}
                </>;
                if (it.picker) return <button key={it.id} type="button"
                  className={`${styles.navItem} ${styles.navButton} ${it.active ? styles.navActive : ""}`}
                  aria-current={it.active ? "page" : undefined}
                  onClick={() => setPaletteIntent(it.picker)}
                  title={`Choose ${it.id === "workbench" ? "a skill" : "an evaluation run"}`}>
                  {content}
                </button>;
                return <Link key={it.id} href={it.href as Route}
                  className={`${styles.navItem} ${it.active ? styles.navActive : ""}`}
                  aria-current={it.active ? "page" : undefined} title={it.label}>
                  {content}
                </Link>;
              })}
              {group.id === "primary" ? <Link
                href={buildTenantAppPath(workspace.slug,"/workflows") as Route}
                className={`${styles.navItem} ${styles.navSubItem} ${appPath==="/workflows"?styles.navSubActive:""}`}
                aria-current={appPath==="/workflows"?"page":undefined}
                title="Model Git-backed workflow specifications">
                <Ic.Repo className={styles.icon} aria-hidden="true" />
                <span>Workflow Studio</span>
              </Link> : null}
            </div>;
          })}
          <button type="button" className={`${styles.navItem} ${styles.navButton}`}
            onClick={() => setPaletteIntent("all")} title="Find tools and administrative sections">
            <Ic.Search className={styles.icon} aria-hidden="true" />
            <span>All sections</span>
          </button>
        </nav>
        <div className={styles.profile} title={viewer.displayName}>
          <span className={styles.profileAvatar} aria-hidden="true">{viewer.initials}</span>
          <div className={styles.profileText}><strong>{viewer.displayName}</strong><small>{viewer.subtitle}</small></div>
        </div>
      </aside>
      <main ref={mainRef} id="sv2-content" className={`page ${styles.main}`} tabIndex={-1}>
        <UiV2ModeProvider workspaceSlug={workspace.slug}>{children}</UiV2ModeProvider>
      </main>
      <SavantCommandPalette open={paletteIntent !== null} intent={paletteIntent ?? "all"}
        onClose={() => setPaletteIntent(null)} workspaceSlug={workspace.slug}
        counts={counts} governanceEnabled={isGovernanceFeatureEnabled()} />
    </UiV2Surface>
  );
}
