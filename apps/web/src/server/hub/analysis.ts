import { parseSkillFrontmatter, type HubFile } from "./fetchers.ts";

/**
 * Static checks for a catalog skill and the catalog verdict. Structural
 * findings are immediate; the SkillSpector safety scan and the LLM↔Jev live
 * evaluation arrive later and refine the verdict.
 */

export type HubFinding = {
  code: string;
  severity: "blocker" | "warning" | "info";
  title: string;
  detail: string;
};

export type HubVerdict = "validated" | "analyzed" | "caution" | "unsafe" | "unverified";

const PLACEHOLDER = /<REPLACE[_A-Z]*>|(?:^|[\s>*-])(?:TODO|TBD|FIXME)\s*:|lorem ipsum/im;
const EXECUTABLE = /\.(py|sh|bash|js|mjs|cjs|ts|ps1|rb|go|rs)$/i;

function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/`[^`\n]*`/g, " ");
}

/** Relative files SKILL.md points at (markdown links and `scripts/…`/`references/…` mentions). */
export function referencedFiles(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/\]\((?!https?:|mailto:|#|\/)([^)\s#?]+)\)/g)) {
    found.add((match[1] as string).replace(/^\.\//, ""));
  }
  for (const match of markdown.matchAll(/(?:^|[\s`'"(])((?:scripts|references|assets|templates|examples)\/[\w./-]+\.\w{1,5})/g)) {
    found.add(match[1] as string);
  }
  return [...found].filter((path) => !path.includes("..") && !path.includes("{") && !path.includes("*"));
}

export function assessHubSkill(input: { files: readonly HubFile[]; license: string | null; upstreamSecurity: unknown }): HubFinding[] {
  const findings: HubFinding[] = [];
  const skillMd = input.files.find((file) => file.path === "SKILL.md")?.content ?? "";
  const front = parseSkillFrontmatter(skillMd);
  const paths = new Set(input.files.map((file) => file.path));

  if (!front.name || !front.description) {
    findings.push({
      code: "FRONTMATTER_INCOMPLETE",
      severity: "warning",
      title: `SKILL.md frontmatter is missing ${[!front.name && "name", !front.description && "description"].filter(Boolean).join(" and ")}`,
      detail: "Agents use the name and description to decide when to load a skill; without them it may never trigger.",
    });
  } else if (front.description.length < 40) {
    findings.push({ code: "DESCRIPTION_VAGUE", severity: "info", title: "Description is very short", detail: "A description that says when to use the skill helps agents route to it." });
  }

  const body = front.body.trim();
  if (body.length < 400) {
    findings.push({ code: "INSTRUCTIONS_THIN", severity: "warning", title: "Instructions are thin", detail: `SKILL.md has ${body.length} characters of instructions.` });
  }
  if (PLACEHOLDER.test(withoutCode(body))) {
    findings.push({ code: "PLACEHOLDER_CONTENT", severity: "warning", title: "SKILL.md contains placeholder text", detail: "TODO/TBD markers or template placeholders remain." });
  }

  const missing = referencedFiles(skillMd).filter((path) => !paths.has(path));
  if (missing.length > 0) {
    findings.push({
      code: "REFERENCED_FILE_MISSING",
      severity: "warning",
      title: `${missing.length} referenced file${missing.length === 1 ? " isn't" : "s aren't"} in the package`,
      detail: `${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}. They may be binary, too large to catalog, or missing upstream.`,
    });
  }

  const scripts = input.files.filter((file) => EXECUTABLE.test(file.path)).map((file) => file.path);
  if (scripts.length > 0) {
    findings.push({
      code: "EXECUTES_CODE",
      severity: "info",
      title: `Ships ${scripts.length} executable script${scripts.length === 1 ? "" : "s"}`,
      detail: `${scripts.slice(0, 5).join(", ")}${scripts.length > 5 ? ", …" : ""}. Review what they do before enabling the skill for agents with tool access.`,
    });
  }

  if (!input.license) {
    findings.push({ code: "LICENSE_UNKNOWN", severity: "info", title: "No license declared", detail: "Confirm you may reuse this skill before importing it into your repository." });
  }

  const upstream = upstreamFlag(input.upstreamSecurity);
  if (upstream) {
    findings.push({ code: "UPSTREAM_SECURITY_FLAG", severity: "warning", title: "The source hub's security checks flagged this skill", detail: upstream });
  }
  return findings;
}

/** Reads ClawHub `security` or skills.sh partner audits; returns a summary when anything isn't clean. */
export function upstreamFlag(security: unknown): string | null {
  if (!security || typeof security !== "object") return null;
  const record = security as Record<string, unknown>;
  if (typeof record.status === "string" && record.status !== "clean" && record.status !== "pass") {
    return `Upstream status: ${record.status}.`;
  }
  if (Array.isArray(record.audits)) {
    const failing = (record.audits as Array<Record<string, unknown>>).filter((audit) => audit.status && audit.status !== "pass");
    if (failing.length > 0) {
      return failing.map((audit) => `${String(audit.provider ?? "audit")}: ${String(audit.status)}${audit.summary ? ` (${String(audit.summary)})` : ""}`).join("; ");
    }
  }
  return null;
}

export function computeVerdict(input: {
  findings: readonly HubFinding[];
  safetyRecommendation: string | null;
  evalStatus: string;
  evalScore: number | null;
}): HubVerdict {
  if (input.safetyRecommendation === "DO_NOT_INSTALL" || input.findings.some((finding) => finding.severity === "blocker")) return "unsafe";
  if (input.safetyRecommendation === "CAUTION" || input.findings.some((finding) => finding.code === "UPSTREAM_SECURITY_FLAG")) return "caution";
  const evaluated = input.evalStatus === "complete" || input.evalStatus === "needs_review";
  if (input.safetyRecommendation === "SAFE" && evaluated && (input.evalScore ?? 0) >= 70) return "validated";
  if (input.safetyRecommendation === "SAFE" || evaluated) return "analyzed";
  return "unverified";
}
