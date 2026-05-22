import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const IGNORED_FILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".config",
  ".cts",
  ".env",
  ".example",
  ".ini",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".mts",
  ".ps1",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const SENSITIVE_ENV_VALUE_PATTERN = /^(?:export\s+)?([A-Z][A-Z0-9_]*(?:ACCESS_KEY|API_KEY|AUTH_TOKEN|CLIENT_SECRET|PASSWORD|PRIVATE_KEY|REFRESH_TOKEN|SECRET|TOKEN|WEBHOOK_SECRET)[A-Z0-9_]*)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/i;
const QUOTED_SECRET_LITERAL_PATTERN = /(?:^|[\s{,(])(?:["'`])?[_$A-Za-z][_$A-Za-z0-9.-]*(?:access[_-]?key|api[_-]?key|auth[_-]?token|client[_-]?secret|password|passwd|private[_-]?key|refresh[_-]?token|secret|token|webhook[_-]?secret)[_$A-Za-z0-9.-]*(?:["'`])?\s*[:=]\s*(["'`])([^"'`\r\n]{8,})\1/gi;
const CONNECTION_STRING_PATTERN = /\b(?:amqp|mongodb(?:\+srv)?|mssql|mysql|postgres(?:ql)?|redis):\/\/[^\s:@/]+:[^\s@]+@/gi;
const RULES = [
  {
    id: "private-key",
    description: "private key material",
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "aws-access-key",
    description: "AWS access key",
    pattern: /\b(?:A3T|AKIA|ASIA|AGPA|AIDA|ANPA|AROA|AIPA)[A-Z0-9]{16}\b/g,
  },
  {
    id: "github-token",
    description: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    id: "github-fine-grained-token",
    description: "GitHub fine-grained token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    id: "slack-token",
    description: "Slack token",
    pattern: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "stripe-live-key",
    description: "Stripe live credential",
    pattern: /\b(?:pk|rk|sk)_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: "connection-string",
    description: "connection string with embedded credentials",
    pattern: CONNECTION_STRING_PATTERN,
  },
];
const ALLOW_PATTERNS = [
  /<[^>]+>/,
  /client-secret/i,
  /dummy/i,
  /example/i,
  /placeholder/i,
  /replace-me/i,
  /sample/i,
  /session-secret/i,
  /\b(?:pk|rk|sk)_test_[A-Za-z0-9_]+\b/i,
  /\$\{[^}]+\}/,
  /\$\([^)]+\)/,
  /^0123456789abcdef(?:0123456789abcdef){3}$/i,
];

function shouldSkipPath(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const pathSegments = normalizedPath.split("/");
  const baseName = path.posix.basename(normalizedPath);

  if (IGNORED_FILE_NAMES.has(baseName)) {
    return true;
  }

  if (pathSegments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  if (baseName.startsWith(".env")) {
    return false;
  }

  const extension = path.posix.extname(baseName).toLowerCase();
  return extension.length > 0 && !TEXT_FILE_EXTENSIONS.has(extension);
}

function isLikelyText(contentBuffer) {
  for (const byte of contentBuffer) {
    if (byte === 0) {
      return false;
    }
  }

  return true;
}

function isAllowedValue(candidate) {
  return ALLOW_PATTERNS.some((pattern) => pattern.test(candidate));
}

function maskValue(value) {
  if (value.length <= 10) {
    return `${value.slice(0, 2)}…${value.slice(-2)}`;
  }

  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function createFinding({ filePath, lineNumber, ruleId, description, matchedValue }) {
  return {
    filePath,
    lineNumber,
    ruleId,
    description,
    matchedValue,
  };
}

function scanLine(filePath, line, lineNumber) {
  const findings = [];

  for (const rule of RULES) {
    for (const match of line.matchAll(rule.pattern)) {
      const matchedValue = match[0];

      if (isAllowedValue(matchedValue) || isAllowedValue(line)) {
        continue;
      }

      findings.push(
        createFinding({
          filePath,
          lineNumber,
          ruleId: rule.id,
          description: rule.description,
          matchedValue,
        }),
      );
    }
  }

  const envMatch = line.match(SENSITIVE_ENV_VALUE_PATTERN);
  if (envMatch) {
    const matchedValue = envMatch[2] ?? envMatch[3] ?? envMatch[4] ?? "";

    if (matchedValue.length >= 8 && !isAllowedValue(matchedValue) && !isAllowedValue(line)) {
      findings.push(
        createFinding({
          filePath,
          lineNumber,
          ruleId: "sensitive-env-assignment",
          description: `hard-coded secret for ${envMatch[1]}`,
          matchedValue,
        }),
      );
    }
  }

  for (const match of line.matchAll(QUOTED_SECRET_LITERAL_PATTERN)) {
    const matchedValue = match[2];

    if (isAllowedValue(matchedValue) || isAllowedValue(line)) {
      continue;
    }

    findings.push(
      createFinding({
        filePath,
        lineNumber,
        ruleId: "quoted-secret-literal",
        description: "hard-coded secret literal",
        matchedValue,
      }),
    );
  }

  return findings;
}

function getCandidateFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || "Failed to enumerate repository files with git ls-files.");
  }

  return result.stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !shouldSkipPath(entry))
    .sort((left, right) => left.localeCompare(right));
}

const findings = [];
const candidateFiles = getCandidateFiles();

for (const relativeFilePath of candidateFiles) {
  const absoluteFilePath = path.join(ROOT_DIR, relativeFilePath);
  const fileBuffer = await readFile(absoluteFilePath);

  if (!isLikelyText(fileBuffer)) {
    continue;
  }

  const fileContents = fileBuffer.toString("utf8");
  const lines = fileContents.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    findings.push(...scanLine(relativeFilePath, line, lineIndex + 1));
  }
}

if (findings.length > 0) {
  console.error(`Security scan failed with ${findings.length} finding(s):`);

  for (const finding of findings) {
    console.error(
      `- ${finding.filePath}:${finding.lineNumber} [${finding.ruleId}] ${finding.description} (${maskValue(finding.matchedValue)})`,
    );
  }

  process.exit(1);
}

console.log(`Security scan passed across ${candidateFiles.length} file(s).`);
