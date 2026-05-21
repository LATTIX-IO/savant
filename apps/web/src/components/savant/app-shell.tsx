"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Fragment, type ReactNode } from "react";

import { Ic } from "@/components/savant/icons";
import { OnboardingProvider } from "@/components/savant/onboarding-context";
import { OnboardingModal } from "@/components/savant/onboarding-modal";
import { TweaksProvider } from "@/components/savant/tweaks-context";
import { TweaksPanel } from "@/components/savant/tweaks-panel";
import {
  ORG,
  SKILLS,
  REPOS,
  EVAL_RUNS,
  RELEASES,
  POLICIES,
  CONNECTORS,
} from "@/lib/savant-data";

const TITLE_BY_PATH: Record<string, { group: string; title: string }> = {
  "/": { group: "Workspace", title: "Overview" },
  "/skills": { group: "Workspace", title: "Skills" },
  "/repositories": { group: "Workspace", title: "Repositories" },
  "/evaluations": { group: "Workspace", title: "Evaluations" },
  "/releases": { group: "Workspace", title: "Releases" },
  "/policies": { group: "Governance", title: "Policies" },
  "/audit": { group: "Governance", title: "Audit" },
  "/connectors": { group: "Governance", title: "Connectors" },
  "/settings": { group: "System", title: "Settings" },
};

export function SavantShell({ children }: { children: ReactNode }) {
  return (
    <TweaksProvider>
      <OnboardingProvider>
        <div className="app">
          <Sidebar />
          <TopBar />
          <div className="page">{children}</div>
          <OnboardingModal />
          <TweaksPanel />
        </div>
      </OnboardingProvider>
    </TweaksProvider>
  );
}

function Sidebar() {
  const pathname = usePathname() || "/";

  type Item = {
    href: Route;
    label: string;
    icon: (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
    count: number | null;
    match: (p: string) => boolean;
  };

  const workspaceItems: Item[] = [
    { href: "/", label: "Overview", icon: Ic.Overview, count: null, match: (p) => p === "/" },
    { href: "/skills", label: "Skills", icon: Ic.Skills, count: SKILLS.length, match: (p) => p.startsWith("/skills") },
    { href: "/repositories", label: "Repositories", icon: Ic.Repo, count: REPOS.length, match: (p) => p.startsWith("/repositories") },
    { href: "/evaluations", label: "Evaluations", icon: Ic.Eval, count: EVAL_RUNS.filter((r) => r.status === "running").length || EVAL_RUNS.length, match: (p) => p.startsWith("/evaluations") },
    { href: "/releases", label: "Releases", icon: Ic.Release, count: RELEASES.length, match: (p) => p.startsWith("/releases") },
  ];
  const govItems: Item[] = [
    { href: "/policies", label: "Policies", icon: Ic.Policy, count: POLICIES.filter((p) => p.state === "active").length, match: (p) => p.startsWith("/policies") },
    { href: "/audit", label: "Audit", icon: Ic.Audit, count: null, match: (p) => p.startsWith("/audit") },
    { href: "/connectors", label: "Connectors", icon: Ic.Connectors, count: CONNECTORS.length, match: (p) => p.startsWith("/connectors") },
  ];

  const renderItem = (it: Item) => {
    const Icon = it.icon;
    const active = it.match(pathname);
    return (
      <Link key={it.href} href={it.href} className={`nav-item ${active ? "active" : ""}`}>
        <Icon className="nav-icon" />
        <span>{it.label}</span>
        {it.count != null ? <span className="nav-count num">{it.count}</span> : null}
      </Link>
    );
  };

  const settingsActive = pathname.startsWith("/settings");

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--ink)" strokeWidth="1.5" />
            <path d="M7 12h10M7 8h10M7 16h6" stroke="var(--moss)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="brand-name">Savant</div>
      </Link>

      <nav className="nav">
        <div className="nav-group">
          <div className="nav-group-label">Workspace</div>
          {workspaceItems.map(renderItem)}
        </div>
        <div className="nav-group">
          <div className="nav-group-label">Governance</div>
          {govItems.map(renderItem)}
        </div>
      </nav>

      <div className="nav-pinned">
        <Link href="/settings" className={`nav-item ${settingsActive ? "active" : ""}`}>
          <Ic.Settings className="nav-icon" />
          <span>Settings</span>
        </Link>
      </div>

      <div className="sidebar-foot">
        <div className="avatar">{ORG.user.initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="foot-user-name">{ORG.user.name}</div>
          <div className="foot-user-role">{ORG.user.role}</div>
        </div>
        <button type="button" className="icon-btn" style={{ marginLeft: "auto" }}>
          <Ic.ChevR style={{ width: 12, height: 12 }} />
        </button>
      </div>
    </aside>
  );
}

function TopBar() {
  const pathname = usePathname() || "/";

  type Crumb = readonly [label: string, target: Route | null | "current"];
  let crumbs: Crumb[];
  if (pathname.startsWith("/skills/") && pathname !== "/skills") {
    const slug = pathname.split("/")[2] ?? "";
    const skill = SKILLS.find((s) => s.id === slug);
    crumbs = [
      ["Workspace", null],
      ["Skills", "/skills"],
      [skill?.name || "Skill", "current"],
    ];
  } else {
    const info = TITLE_BY_PATH[pathname] ?? { group: "Workspace", title: "Overview" };
    crumbs = [[info.group, null], [info.title, "current"]];
  }

  return (
    <header className="topbar">
      <button
        type="button"
        className="btn btn-sm"
        style={{ background: "var(--ivory)", border: "1px solid var(--rule-2)" }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            background: "var(--ink)",
            color: "var(--linen)",
            display: "grid",
            placeItems: "center",
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          {ORG.short}
        </span>
        <span>{ORG.name}</span>
        <Ic.ChevD className="b-icon" />
      </button>

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
        <span>{ORG.env}</span>
      </div>

      <div className="topbar-search">
        <Ic.Search className="s-icon" />
        <input placeholder="Search skills, repos, evals, releases…" />
        <span className="kbd">⌘ K</span>
      </div>

      <button type="button" className="icon-btn" title="Notifications">
        <Ic.Bell style={{ width: 14, height: 14 }} />
        <span className="badge-dot" />
      </button>

      <Link href="/settings" className="icon-btn" title="Settings">
        <Ic.Settings style={{ width: 14, height: 14 }} />
      </Link>
    </header>
  );
}
