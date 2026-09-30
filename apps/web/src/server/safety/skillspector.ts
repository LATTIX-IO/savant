import { createHash } from "node:crypto";

/**
 * Skill package security scanning with NVIDIA SkillSpector
 * (https://github.com/NVIDIA/skillspector, Apache-2.0).
 *
 * SkillSpector is a Python tool (static analysis — prompt injection, data
 * exfiltration, excessive agency, dangerous code, supply chain via OSV — plus
 * an optional LLM semantic pass), so it runs in a Vercel Sandbox microVM
 * rather than in the web function. The sandbox is named and persistent, so
 * the one-time install is reused across scans. Package files are written into
 * the sandbox; no repository credentials enter it.
 */

export const SKILLSPECTOR_PACKAGE = "git+https://github.com/NVIDIA/skillspector.git";
export const SANDBOX_NAME = "savant-skillspector-v1";

export type ScanPackage = {
  root: string;
  skillId: string;
  tier: string;
  /** Package files keyed by path relative to the package root. */
  files: Record<string, string>;
};

export type SafetyIssue = {
  id: string;
  category: string;
  severity: string;
  confidence: number | null;
  title: string;
  file: string | null;
  line: number | null;
};

export type SafetyScanResult = {
  root: string;
  skillId: string;
  fingerprint: string;
  status: "complete" | "failed" | "unavailable";
  riskScore: number | null;
  severity: string | null;
  recommendation: "SAFE" | "CAUTION" | "DO_NOT_INSTALL" | null;
  issues: SafetyIssue[];
  llmUsed: boolean;
  scannerVersion: string | null;
  error: string | null;
};

export class SafetyScanUnavailableError extends Error {
  readonly code = "SAFETY_SCAN_UNAVAILABLE";
}

/** Text files SkillSpector analyses; binaries and images are skipped. */
export const SCANNABLE_FILE = /\.(md|markdown|txt|ya?ml|json|toml|py|sh|bash|zsh|js|mjs|cjs|ts|ps1|rb|pl|cfg|ini|env\.example)$|(^|\/)(requirements[^/]*\.txt|Dockerfile|Makefile)$/i;

export function packageFingerprint(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) {
    hash.update(path).update("\u0000").update(files[path] as string).update("\u0000");
  }
  return hash.digest("hex").slice(0, 32);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Maps a SkillSpector JSON report (tolerant of field-name variations across versions). */
export function parseSkillSpectorReport(report: unknown): Pick<SafetyScanResult, "riskScore" | "severity" | "recommendation" | "issues" | "llmUsed" | "scannerVersion"> {
  const root = (typeof report === "object" && report !== null ? report : {}) as Record<string, unknown>;
  const risk = (root.risk_assessment ?? root.riskAssessment ?? {}) as Record<string, unknown>;
  const metadata = (root.metadata ?? {}) as Record<string, unknown>;
  const rawIssues = Array.isArray(root.issues) ? root.issues : Array.isArray(root.findings) ? root.findings : [];
  const recommendation = (text(risk.recommendation) ?? text(root.recommendation))?.toUpperCase().replace(/\s+/g, "_") ?? null;

  return {
    riskScore: num(risk.score ?? root.risk_score),
    severity: (text(risk.severity) ?? text(root.severity))?.toUpperCase() ?? null,
    recommendation: recommendation === "SAFE" || recommendation === "CAUTION" || recommendation === "DO_NOT_INSTALL" ? recommendation : null,
    issues: rawIssues.slice(0, 100).map((raw, index) => {
      const issue = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      const location = (issue.location ?? {}) as Record<string, unknown>;
      return {
        id: text(issue.id) ?? text(issue.rule_id) ?? `issue-${index + 1}`,
        category: text(issue.category) ?? "unknown",
        severity: (text(issue.severity) ?? "UNKNOWN").toUpperCase(),
        confidence: num(issue.confidence),
        title: (text(issue.title) ?? text(issue.message) ?? text(issue.description) ?? text(issue.name) ?? text(issue.id) ?? "Issue").slice(0, 300),
        file: text(location.file) ?? text(issue.file),
        line: num(location.start_line ?? location.line ?? issue.line),
      };
    }),
    llmUsed: metadata.llm_available === true && metadata.llm_requested === true,
    scannerVersion: text(metadata.skillspector_version),
  };
}

/** A small driver run inside the sandbox: scans each package directory and prints one JSON document. */
export const DRIVER_SCRIPT = String.raw`
import json, os, subprocess, sys
manifest = json.load(open(sys.argv[1]))
results = []
for item in manifest["packages"]:
    out = item["dir"] + ".report.json"
    args = ["skillspector", "scan", item["dir"], "-f", "json", "-o", out]
    env = dict(os.environ)
    if not item.get("llm"):
        args.append("--no-llm")
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=item.get("timeout", 240), env=env)
        report = json.load(open(out)) if os.path.exists(out) else None
        results.append({"root": item["root"], "exit": proc.returncode, "report": report, "stderr": proc.stderr[-800:]})
    except subprocess.TimeoutExpired:
        results.append({"root": item["root"], "exit": -1, "report": None, "stderr": "timed out"})
print(json.dumps({"results": results}))
`;

type SandboxLike = {
  runCommand(params: { cmd: string; args?: string[]; env?: Record<string, string>; sudo?: boolean; cwd?: string }): Promise<{ exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>;
  writeFiles(files: { path: string; content: string | Uint8Array }[]): Promise<void>;
  stop(): Promise<unknown>;
};

async function openSandbox(): Promise<SandboxLike> {
  let sandboxModule: typeof import("@vercel/sandbox");
  try {
    sandboxModule = await import("@vercel/sandbox");
  } catch (error) {
    throw new SafetyScanUnavailableError(`The Vercel Sandbox SDK is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return await sandboxModule.Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      runtime: "python3.13",
      persistent: true,
      resources: { vcpus: 2 },
      timeout: 20 * 60 * 1000,
    }) as unknown as SandboxLike;
  } catch (error) {
    throw new SafetyScanUnavailableError(`A Vercel Sandbox could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureInstalled(sandbox: SandboxLike): Promise<void> {
  const probe = await sandbox.runCommand({ cmd: "sh", args: ["-lc", "command -v skillspector >/dev/null && skillspector --help >/dev/null"] });
  if (probe.exitCode === 0) {
    return;
  }
  const install = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", `(command -v git >/dev/null || sudo dnf install -y -q git) && python3 -m pip install -q --upgrade pip && python3 -m pip install -q "${SKILLSPECTOR_PACKAGE}"`],
  });
  if (install.exitCode !== 0) {
    throw new SafetyScanUnavailableError(`SkillSpector could not be installed in the sandbox: ${(await install.stderr()).slice(-500)}`);
  }
}

/**
 * Scans packages in one sandbox session. `llmRoots` get SkillSpector's LLM
 * semantic pass (via NVIDIA NIM when a key is configured); the rest are
 * static-only.
 */
export async function runSkillSpectorScans(packages: readonly ScanPackage[], options: {
  llmRoots?: ReadonlySet<string>;
  nimApiKey?: string | null;
  llmModel?: string | null;
  perPackageTimeoutSec?: number;
}): Promise<SafetyScanResult[]> {
  if (packages.length === 0) {
    return [];
  }
  const sandbox = await openSandbox();
  const runId = `scan-${Date.now().toString(36)}`;
  const base = `/vercel/sandbox/${runId}`;
  try {
    await ensureInstalled(sandbox);

    const manifest = packages.map((item, index) => ({
      root: item.root,
      dir: `${base}/${index}`,
      llm: Boolean(options.llmRoots?.has(item.root) && options.nimApiKey),
      timeout: options.perPackageTimeoutSec ?? 240,
    }));
    await sandbox.writeFiles([
      { path: `${base}/driver.py`, content: DRIVER_SCRIPT },
      { path: `${base}/manifest.json`, content: JSON.stringify({ packages: manifest }) },
      ...packages.flatMap((item, index) => Object.entries(item.files).map(([path, content]) => ({ path: `${base}/${index}/${path}`, content }))),
    ]);

    const env: Record<string, string> = {};
    if (options.nimApiKey) {
      env.SKILLSPECTOR_PROVIDER = "nv_build";
      env.NVIDIA_INFERENCE_KEY = options.nimApiKey;
      if (options.llmModel) env.SKILLSPECTOR_MODEL = options.llmModel;
    }
    const run = await sandbox.runCommand({ cmd: "python3", args: [`${base}/driver.py`, `${base}/manifest.json`], env });
    const stdout = await run.stdout();
    let parsed: { results?: Array<{ root: string; exit: number; report: unknown; stderr: string }> };
    try {
      parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
    } catch {
      throw new Error(`SkillSpector driver output could not be parsed: ${(await run.stderr()).slice(-400)}`);
    }

    const byRoot = new Map((parsed.results ?? []).map((result) => [result.root, result]));
    return packages.map((item, index) => {
      const result = byRoot.get(item.root);
      const fingerprint = packageFingerprint(item.files);
      if (!result || !result.report) {
        return {
          root: item.root, skillId: item.skillId, fingerprint, status: "failed" as const,
          riskScore: null, severity: null, recommendation: null, issues: [], llmUsed: Boolean(manifest[index]?.llm), scannerVersion: null,
          error: (result?.stderr || "SkillSpector produced no report.").slice(-500),
        };
      }
      return { root: item.root, skillId: item.skillId, fingerprint, status: "complete" as const, error: null, ...parseSkillSpectorReport(result.report) };
    });
  } finally {
    await sandbox.runCommand({ cmd: "rm", args: ["-rf", base] }).catch(() => undefined);
    await sandbox.stop().catch(() => undefined);
  }
}
