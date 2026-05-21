import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: SVGProps<SVGSVGElement> = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const Ic = {
  Overview: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <rect x="2.5" y="2.5" width="5" height="5" rx="0.5" />
      <rect x="2.5" y="9" width="5" height="4.5" rx="0.5" />
      <rect x="9" y="2.5" width="4.5" height="3" rx="0.5" />
      <rect x="9" y="7" width="4.5" height="6.5" rx="0.5" />
    </svg>
  ),
  Skills: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 1.8 14 4.4v3.2c0 4-2.7 5.9-6 6.6-3.3-.7-6-2.6-6-6.6V4.4L8 1.8Z" />
      <path d="m5.5 7.8 1.8 1.8 3.2-3.2" />
    </svg>
  ),
  Repo: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M3 2h8.5a1.5 1.5 0 0 1 1.5 1.5V13" />
      <path d="M3 2v10a1.5 1.5 0 0 0 1.5 1.5h8" />
      <path d="M5.5 5h4" />
      <path d="M5.5 7.5h4" />
    </svg>
  ),
  Eval: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2.5 13.5 V 8" />
      <path d="M6 13.5 V 4" />
      <path d="M9.5 13.5 V 9.5" />
      <path d="M13 13.5 V 5.5" />
      <path d="M2 13.5 H 14" />
    </svg>
  ),
  Release: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="m3 8 4-3.5v2.5h6V9H7v2.5L3 8Z" />
      <circle cx="13.5" cy="8" r=".5" fill="currentColor" />
    </svg>
  ),
  Policy: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 1.5 2.5 4v4.5c0 3.5 3 5.5 5.5 6 2.5-.5 5.5-2.5 5.5-6V4L8 1.5Z" />
    </svg>
  ),
  Audit: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M3 2.5h7.5L13 5v8.5H3z" />
      <path d="M10 2.5V5h3" />
      <path d="M5 8h6M5 10.5h4" />
    </svg>
  ),
  Connectors: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <rect x="2" y="6" width="4" height="4" rx="0.5" />
      <rect x="10" y="6" width="4" height="4" rx="0.5" />
      <path d="M6 8h4" />
    </svg>
  ),
  Settings: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8 3.4 3.4" />
    </svg>
  ),
  Search: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  ),
  Bell: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M3.5 12h9l-1-1.5V7a3.5 3.5 0 1 0-7 0v3.5L3.5 12Z" />
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  ),
  ChevR: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="m6 3 5 5-5 5" />
    </svg>
  ),
  ChevD: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="m3 6 5 5 5-5" />
    </svg>
  ),
  Branch: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="4" cy="3.5" r="1.3" />
      <circle cx="4" cy="12.5" r="1.3" />
      <circle cx="12" cy="6" r="1.3" />
      <path d="M4 4.8V11.2" />
      <path d="M4 7c0 2 1.5 3 4 3" />
    </svg>
  ),
  Commit: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1.5 8h4M10.5 8h4" />
    </svg>
  ),
  Tag: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2 6.5V2.5h4l7.5 7.5-4 4L2 6.5Z" />
      <circle cx="5" cy="5.5" r=".8" fill="currentColor" />
    </svg>
  ),
  Check: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="m3 8.5 3 3 7-7" />
    </svg>
  ),
  CheckCircle: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.5 8 1.8 1.8 3.2-3.6" />
    </svg>
  ),
  X: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  ),
  XCircle: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="m6 6 4 4M10 6l-4 4" />
    </svg>
  ),
  Warn: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 2 14 13H2L8 2Z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.3" r=".5" fill="currentColor" />
    </svg>
  ),
  Clock: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  ),
  Plus: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  Arrow: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  ),
  ArrowUp: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  ),
  ArrowDown: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  ),
  Dot: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <circle cx="8" cy="8" r="3" />
    </svg>
  ),
  Refresh: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M13 4.5A5.5 5.5 0 1 0 14 8" />
      <path d="M14 2.5V5h-2.5" />
    </svg>
  ),
  Filter: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M2.5 3.5h11l-4 5v4l-3 1V8.5l-4-5Z" />
    </svg>
  ),
  Sort: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M4 3v10M4 3l-2 2M4 3l2 2" />
      <path d="M12 13V3M12 13l-2-2M12 13l2-2" />
    </svg>
  ),
  More: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <circle cx="3.5" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12.5" cy="8" r="1.2" />
    </svg>
  ),
  Lock: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  ),
  ExternalLink: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <path d="M9 2.5h4.5V7" />
      <path d="m13 3-6 6" />
      <path d="M11 9.5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h3" />
    </svg>
  ),
  GitHub: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M8 .5C3.86.5.5 3.86.5 8c0 3.32 2.15 6.13 5.13 7.13.38.07.51-.16.51-.36 0-.18-.01-.78-.01-1.42-2.09.38-2.62-.51-2.79-.97-.09-.24-.5-.97-.85-1.17-.29-.16-.7-.54-.01-.55.65-.01 1.11.6 1.27.85.74 1.25 1.93.9 2.4.69.07-.53.29-.9.53-1.1-1.85-.21-3.79-.93-3.79-4.12 0-.91.32-1.66.85-2.25-.09-.21-.37-1.07.08-2.22 0 0 .7-.22 2.29.85a7.74 7.74 0 0 1 4.17 0c1.59-1.08 2.29-.85 2.29-.85.46 1.15.17 2.01.08 2.22.53.59.85 1.33.85 2.25 0 3.2-1.95 3.91-3.8 4.12.3.26.56.76.56 1.54 0 1.11-.01 2.01-.01 2.29 0 .2.14.43.51.36A7.51 7.51 0 0 0 15.5 8c0-4.14-3.36-7.5-7.5-7.5Z" />
    </svg>
  ),
  GitLab: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="m8 14-2.7-8.3H2.5L8 14Z" opacity=".85" />
      <path d="M8 14 5.3 5.7H2.5L8 14Z" opacity=".6" />
      <path d="M2.5 5.7 1.7 8.3a.6.6 0 0 0 .22.68L8 14 2.5 5.7Z" opacity=".4" />
      <path d="m2.5 5.7.86-2.65a.43.43 0 0 1 .82 0L5.3 5.7H2.5Z" />
      <path d="M8 14 10.7 5.7h2.8L8 14Z" opacity=".85" />
      <path d="M8 14 10.7 5.7h2.8L8 14Z" opacity=".6" />
      <path d="M13.5 5.7l.83 2.6a.6.6 0 0 1-.22.68L8 14l5.5-8.3Z" opacity=".4" />
      <path d="m13.5 5.7-.86-2.65a.43.43 0 0 0-.82 0l-1.12 2.65h2.8Z" />
    </svg>
  ),
  Azure: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M6.2 2.2 1.5 13.5H5l3.5-9.6L6.2 2.2Z" opacity=".7" />
      <path d="m9.4 2.2-2.1 1.7 3.5 9.6H14L9.4 2.2Z" />
    </svg>
  ),
  Bitbucket: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="currentColor" {...p}>
      <path d="M2 2.5h12l-1.5 11h-9L2 2.5Z" opacity=".8" />
      <path d="M6.4 6.5h3.2l-.5 3.3H6.9L6.4 6.5Z" fill="var(--linen)" />
    </svg>
  ),
  Server: (p: IconProps) => (
    <svg viewBox="0 0 16 16" {...base} {...p}>
      <rect x="2.5" y="3" width="11" height="4" rx="0.5" />
      <rect x="2.5" y="9" width="11" height="4" rx="0.5" />
      <circle cx="5" cy="5" r=".5" fill="currentColor" />
      <circle cx="5" cy="11" r=".5" fill="currentColor" />
    </svg>
  ),
  Spinner: (p: IconProps) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" {...p}>
      <path d="M14 8a6 6 0 1 1-6-6" />
    </svg>
  ),
} satisfies Record<string, (p: IconProps) => React.JSX.Element>;

export type ProviderId = "github" | "gitlab" | "azure" | "bitbucket" | "selfhosted" | "more" | string;

export function ProviderIcon({ p, size = 13 }: { p: ProviderId; size?: number }) {
  const style = { width: size, height: size };
  if (p === "github") return <Ic.GitHub style={{ ...style, color: "var(--ink)" }} />;
  if (p === "gitlab") return <Ic.GitLab style={{ ...style, color: "#E24329" }} />;
  if (p === "azure") return <Ic.Azure style={{ ...style, color: "#1F6EB5" }} />;
  if (p === "bitbucket") return <Ic.Bitbucket style={{ ...style, color: "#1B65D7" }} />;
  return <Ic.Server style={{ ...style, color: "var(--slate)" }} />;
}
