// Telemetry redaction. Runs before any run payload is persisted and again
// before any payload is handed to an optimization worker. Secrets are always
// redacted; PII classes are redacted when the tenant has configured them.
//
// The Python worker (services/skill-intelligence/src/savant_skill_intelligence/
// privacy/redaction.py) implements the same rules as a second, independent pass.

export type PiiClass = "email" | "phone" | "ssn" | "credit-card" | "ip-address";

export const ALL_PII_CLASSES: readonly PiiClass[] = ["email", "phone", "ssn", "credit-card", "ip-address"];

export type RedactionResult = {
  text: string;
  counts: Record<string, number>;
  redacted: boolean;
};

type Rule = {
  key: string;
  pattern: RegExp;
  /** Optional filter to reduce false positives (e.g. Luhn for card numbers). */
  accept?: (match: string) => boolean;
  /** Keep a leading capture group (e.g. "password=") and redact only the value. */
  keepPrefixGroup?: boolean;
};

// Order matters: multi-line and structured secrets first so later, broader
// rules do not partially consume them.
const SECRET_RULES: Rule[] = [
  {
    key: "private-key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    key: "connection-string",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@[^\s]+/gi,
  },
  { key: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { key: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { key: "openai-key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { key: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { key: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { key: "stripe-key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { key: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { key: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { key: "savant-token", pattern: /\bsvt_[A-Za-z0-9_-]{20,}\b/g },
  {
    key: "bearer-token",
    pattern: /(\b(?:authorization\s*:\s*)?bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
    keepPrefixGroup: true,
  },
  {
    key: "credential-assignment",
    pattern: /(\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?)(?!\[REDACTED)[^\s"',;]{4,}/gi,
    keepPrefixGroup: true,
  },
];

function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

function isValidIpv4(candidate: string): boolean {
  return candidate.split(".").every((part) => Number(part) <= 255);
}

const PII_RULES: Record<PiiClass, Rule> = {
  email: { key: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  ssn: { key: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  "credit-card": {
    key: "credit-card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: passesLuhn,
  },
  phone: {
    key: "phone",
    pattern: /(?<![\w-])(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?![\w-])/g,
  },
  "ip-address": {
    key: "ip-address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    accept: isValidIpv4,
  },
};

// Card numbers must be checked before phone numbers, which would otherwise
// match fragments of them.
const PII_ORDER: PiiClass[] = ["email", "ssn", "credit-card", "phone", "ip-address"];

function applyRule(text: string, rule: Rule, counts: Record<string, number>): string {
  return text.replace(rule.pattern, (match: string, ...groups: unknown[]) => {
    if (rule.accept && !rule.accept(match)) {
      return match;
    }

    counts[rule.key] = (counts[rule.key] ?? 0) + 1;
    const marker = `[REDACTED:${rule.key}]`;

    if (rule.keepPrefixGroup && typeof groups[0] === "string") {
      return `${groups[0]}${marker}`;
    }

    return marker;
  });
}

export function redactText(
  input: string,
  options: { piiClasses?: readonly PiiClass[] } = {},
): RedactionResult {
  const counts: Record<string, number> = {};
  let text = input;

  for (const rule of SECRET_RULES) {
    text = applyRule(text, rule, counts);
  }

  const enabled = new Set(options.piiClasses ?? []);
  for (const piiClass of PII_ORDER) {
    if (enabled.has(piiClass)) {
      text = applyRule(text, PII_RULES[piiClass], counts);
    }
  }

  return {
    text,
    counts,
    redacted: Object.keys(counts).length > 0,
  };
}

export function mergeRedactionCounts(
  ...sources: Array<Record<string, number>>
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

/** True if the text still contains something that looks like a secret. */
export function containsSecret(input: string): boolean {
  return SECRET_RULES.some((rule) => {
    rule.pattern.lastIndex = 0;
    const found = rule.pattern.test(input);
    rule.pattern.lastIndex = 0;
    return found;
  });
}
