/**
 * Credential redaction for anything that may reach logs, telemetry, audit
 * payloads, error serialization, or job payloads.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|private[_-]?key|client[_-]?secret|code[_-]?verifier|pkce[_-]?verifier|verifier|(?:access|refresh|id|installation|bearer|auth)[_-]?token|token|password|passwd|pat|secret|code|state|assertion|jwt)$/i;

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // Authorization header values.
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // GitHub tokens (classic, OAuth, installation, refresh, fine-grained).
  [/\b(?:gh[pousr])_[A-Za-z0-9_]{16,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  // GitLab personal/project/OAuth tokens.
  [/\bgl(?:pat|oas|rt|dt|ptt|ft|soat)-[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  // Atlassian API tokens.
  [/\bATATT[A-Za-z0-9_=-]{20,}\b/g, REDACTED],
  // JWTs (GitHub App JWTs, Entra access/id tokens).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // PEM private keys.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // key=value pairs in query strings or form bodies.
  [/\b(access_token|refresh_token|id_token|client_secret|code_verifier|code|token|assertion)=([^&\s"']+)/gi, `$1=${REDACTED}`],
  // JSON-ish "key": "value" pairs.
  [/("(?:access_token|refresh_token|id_token|client_secret|code_verifier|accessToken|refreshToken|clientSecret|token|privateKey)"\s*:\s*")[^"]*(")/g, `$1${REDACTED}$2`],
  // Credentials embedded in URLs.
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/(https?:\/\/)(?:x-access-token|oauth2|x-token-auth)@/gi, `$1${REDACTED}@`],
];

/**
 * Azure DevOps PATs are 52 lowercase base32 characters (or 84 chars for the
 * newer format) with no prefix; only redact them when they follow a
 * credential-ish keyword to avoid mangling commit SHAs and ids.
 */
const AZURE_PAT_CONTEXT_PATTERN = /\b(pat|token|password)(\s*[:=]\s*)["']?([a-z2-7]{52}|[A-Za-z0-9]{84})["']?/gi;

export function redactString(value: string, knownSecrets: readonly string[] = []): string {
  let output = value;

  for (const secret of knownSecrets) {
    if (secret && secret.length >= 6) {
      output = output.split(secret).join(REDACTED);
    }
  }

  for (const [pattern, replacement] of VALUE_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output.replace(AZURE_PAT_CONTEXT_PATTERN, `$1$2${REDACTED}`);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Deep-redacts a value for logging/serialization. Cycles are cut. */
export function redactValue(value: unknown, knownSecrets: readonly string[] = [], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value, knownSecrets);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, knownSecrets),
      ...("code" in value && typeof value.code === "string" ? { code: value.code } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, knownSecrets, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, knownSecrets, seen);
  }

  return output;
}

/**
 * Keys that may appear in git audit payloads. Anything else is dropped, so a
 * future caller cannot leak a token by passing a whole object through.
 */
const AUDIT_PAYLOAD_ALLOWED_KEYS = new Set([
  "provider",
  "connection_id",
  "repository_id",
  "provider_repository_id",
  "organization_id",
  "error_code",
  "skill_count",
  "duration_ms",
  "auth_type",
  "provider_host",
  "provider_account_name",
  "repository_name",
  "trigger",
  "status",
  "reason",
  "revoked_remotely",
  "repositories_marked_auth_required",
  "reconciled_repository_count",
  "commit_sha",
  "legacy",
]);

export function sanitizeGitAuditPayload(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!AUDIT_PAYLOAD_ALLOWED_KEYS.has(key)) {
      continue;
    }

    if (value === null || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = redactString(value).slice(0, 300);
    }
  }

  return output;
}

type LogLevel = "info" | "warn" | "error";

/** Structured, redacted logger for the git subsystem. */
export function logGitEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ scope: "git", event, ...(redactValue(fields) as Record<string, unknown>) });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (process.env.GIT_INTEGRATION_DEBUG_LOGS === "true") {
    console.info(line);
  }
}
