"use client";

import Link from "next/link";
import type { Route } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

import {
  isSafeUiV2InternalHref,
  normalizeUiV2Density,
  uiV2MetricValue,
  uiV2StatusLabel,
  type UiV2Density,
  type UiV2Status as UiV2StatusKind,
} from "./contracts";
import styles from "./ui-v2.module.css";
import tokenStyles from "./operational-tokens.module.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400", "500", "600"], display: "swap",
  variable: "--sv2-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"], display: "swap",
  variable: "--sv2-plex-mono",
});

export function UiV2Surface({
  children, density = "compact", className = "", ...props
}: HTMLAttributes<HTMLDivElement> & { density?: UiV2Density; children: ReactNode }) {
  return (
    <div {...props} data-savant-ui="v2" data-density={normalizeUiV2Density(density)}
      className={`${tokenStyles.tokens} ${styles.surface} ${plexSans.variable} ${plexMono.variable} ${className}`.trim()}>
      {children}
    </div>
  );
}

type ButtonVariant = "default" | "primary" | "tertiary" | "danger";
export function UiV2Button({
  children, variant = "default", size = "normal", type = "button", className = "", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: "normal" | "small";
}) {
  const variants: Record<ButtonVariant, string> = {
    default: "", primary: styles.primary ?? "", tertiary: styles.tertiary ?? "", danger: styles.danger ?? "",
  };
  return (
    <button {...props} type={type} className={`${styles.button} ${variants[variant]} ${size === "small" ? styles.small : ""} ${className}`.trim()}>
      {children}
    </button>
  );
}

export function UiV2Panel({
  heading, children, className = "",
}: { heading?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.panel} ${className}`.trim()}>
      {heading ? <header className={styles.panelHeader}><h2>{heading}</h2></header> : null}
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function UiV2Status({
  state, label,
}: { state: UiV2StatusKind; label?: string }) {
  const classes: Record<UiV2StatusKind, string> = {
    ready: styles.ready ?? "", running: styles.running ?? "", warning: styles.warning ?? "",
    failed: styles.failed ?? "", planned: styles.planned ?? "", simulated: styles.simulated ?? "",
    unavailable: "",
  };
  return <span className={`${styles.status} ${classes[state]}`.trim()}>{uiV2StatusLabel(state, label)}</span>;
}

export function UiV2Field({
  id, label, hint, error, ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string; label: string; hint?: string; error?: string;
}) {
  const describedBy = [
    input["aria-describedby"], hint ? `${id}-hint` : "", error ? `${id}-error` : "",
  ].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}</label>
      <input {...input} id={id} className={styles.input}
        aria-invalid={Boolean(error)} aria-describedby={describedBy}/>
      {hint ? <span id={`${id}-hint`} className={styles.fieldHint}>{hint}</span> : null}
      {error ? <span id={`${id}-error`} className={styles.fieldError}>{error}</span> : null}
    </div>
  );
}

export type UiV2NavigationTab = { id: string; label: string; href: string };
export function UiV2NavigationTabs({
  label, tabs, activeId,
}: { label: string; tabs: readonly UiV2NavigationTab[]; activeId: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {tabs.map(tab => isSafeUiV2InternalHref(tab.href)
        ? <Link key={tab.id} href={tab.href as Route}
            aria-current={tab.id === activeId ? "page" : undefined}
            className={`${styles.tab} ${tab.id === activeId ? styles.tabActive : ""}`.trim()}>
            {tab.label}
          </Link>
        : <span key={tab.id} className={`${styles.tab} ${styles.disabledTab}`}
            aria-disabled="true">{tab.label}</span>)}
    </nav>
  );
}

export function UiV2TableViewport({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.tableViewport} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function UiV2EmptyState({ message }: { message: string }) {
  return <p role="status" className={styles.empty}>{message}</p>;
}

export function UiV2Metric({ label, value }: { label: string; value: number | string | null | undefined }) {
  return <dl className={styles.metric}><dt>{label}</dt><dd>{uiV2MetricValue(value)}</dd></dl>;
}

export function UiV2Disclosure({
  label, children,
}: { label: string; children: ReactNode }) {
  return <details className={styles.disclosure}><summary>{label}</summary>
    <div className={styles.disclosureContent}>{children}</div>
  </details>;
}

/** Shared UX-00 workbench header with optional, permission-backed actions. */
export function UiV2PageHeader({ title, eyebrow, description, actions }: {
  title: string; eyebrow?: string; description?: string; actions?: ReactNode;
}) {
  return <header className={styles.pageHeader}>
    <div>{eyebrow ? <div className={styles.pageEyebrow}>{eyebrow}</div> : null}
      <h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
    {actions ? <div className={styles.pageActions}>{actions}</div> : null}
  </header>;
}

export function UiV2Breadcrumbs({ items }: {
  items: readonly { label: string; href?: string | null }[];
}) {
  return <nav className={styles.crumbs} aria-label="Breadcrumbs">
    {items.map((item, index) => <span key={index}>
      {index > 0 ? <span aria-hidden="true"> / </span> : null}
      {item.href && isSafeUiV2InternalHref(item.href)
        ? <Link href={item.href as Route}>{item.label}</Link>
        : <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>}
    </span>)}
  </nav>;
}

export function UiV2StateBanner({ state, label, children }: {
  state: UiV2StatusKind; label: string; children?: ReactNode;
}) {
  return <div className={styles.banner} role={state === "failed" ? "alert" : "status"}>
    <UiV2Status state={state} label={label} />{children ? <span>{children}</span> : null}
  </div>;
}

/** Native modal owns focus trapping; Escape requests a controlled close. */
export function UiV2Dialog({ id, title, open, onClose, children, actions, drawer = false }: {
  id: string; title: string; open: boolean; onClose: () => void; children: ReactNode;
  actions?: ReactNode; drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={`${id}-title`}
    className={`${styles.dialog} ${drawer ? styles.drawer : ""}`}
    onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.dialogHead}>
      <h2 id={`${id}-title`}>{title}</h2>
      <UiV2Button size="small" aria-label="Close" onClick={onClose}>Close</UiV2Button>
    </header>
    <div className={styles.dialogBody}>{children}</div>
    {actions ? <footer className={styles.dialogActions}>{actions}</footer> : null}
  </dialog>;
}

export function UiV2InspectorDrawer(props: Omit<Parameters<typeof UiV2Dialog>[0], "drawer">) {
  return <UiV2Dialog {...props} drawer />;
}

export function UiV2SplitPane({ children, inspector }: {
  children: ReactNode; inspector: ReactNode;
}) {
  return <div className={styles.splitPane}>
    <section className={styles.splitMain}>{children}</section>
    <aside className={styles.splitInspector} aria-label="Inspector">{inspector}</aside>
  </div>;
}

/** Canvas presence never asserts executable workflow capability. */
export function UiV2CanvasRegion({ label, children, unavailable }: {
  label: string; children: ReactNode; unavailable?: string;
}) {
  return <div role="region" aria-label={label} tabIndex={0} className={styles.canvasRegion}>
    {unavailable ? <UiV2StateBanner state="unavailable" label={unavailable} /> : children}
  </div>;
}
