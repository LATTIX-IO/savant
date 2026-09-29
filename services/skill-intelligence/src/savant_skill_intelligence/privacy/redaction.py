"""Third, independent redaction pass before anything reaches an optimizer.

Mirrors apps/web/src/lib/skill-intelligence/redaction.ts. The control plane
redacts at ingest and again when building the bundle; the worker does not
assume either pass happened. Any record that still looks like it contains a
secret after redaction is dropped from the dataset entirely.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SECRET_RULES: list[tuple[str, re.Pattern[str], bool]] = [
    ("private-key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"), False),
    ("connection-string", re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s:/@]+:[^\s@/]+@\S+", re.IGNORECASE), False),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"), False),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}\b"), False),
    ("openai-key", re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"), False),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"), False),
    ("slack-token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}\b"), False),
    ("stripe-key", re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b"), False),
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), False),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), False),
    ("savant-token", re.compile(r"\bsvt_[A-Za-z0-9_-]{20,}\b"), False),
    ("bearer-token", re.compile(r"(\b(?:authorization\s*:\s*)?bearer\s+)[A-Za-z0-9._~+/-]{16,}=*", re.IGNORECASE), True),
    (
        "credential-assignment",
        re.compile(
            r"(\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*[\"']?)(?!\[REDACTED)[^\s\"',;]{4,}",
            re.IGNORECASE,
        ),
        True,
    ),
]


def _luhn(candidate: str) -> bool:
    digits = [int(char) for char in candidate if char.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


_PII_RULES: dict[str, tuple[re.Pattern[str], object]] = {
    "email": (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), None),
    "ssn": (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), None),
    "credit-card": (re.compile(r"\b(?:\d[ -]?){12,18}\d\b"), _luhn),
    "phone": (re.compile(r"(?<![\w-])(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?![\w-])"), None),
    "ip-address": (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), lambda value: all(int(part) <= 255 for part in value.split("."))),
}
_PII_ORDER = ["email", "ssn", "credit-card", "phone", "ip-address"]


@dataclass
class RedactionResult:
    text: str
    counts: dict[str, int] = field(default_factory=dict)


def redact(text: str, pii_classes: list[str] | tuple[str, ...] = ()) -> RedactionResult:
    counts: dict[str, int] = {}

    def apply(key: str, pattern: re.Pattern[str], keep_prefix: bool, accept: object, value: str) -> str:
        def replace(match: re.Match[str]) -> str:
            if callable(accept) and not accept(match.group(0)):
                return match.group(0)
            counts[key] = counts.get(key, 0) + 1
            marker = f"[REDACTED:{key}]"
            return f"{match.group(1)}{marker}" if keep_prefix else marker

        return pattern.sub(replace, value)

    for key, pattern, keep_prefix in _SECRET_RULES:
        text = apply(key, pattern, keep_prefix, None, text)
    enabled = set(pii_classes)
    for key in _PII_ORDER:
        if key in enabled:
            pattern, accept = _PII_RULES[key]
            text = apply(key, pattern, False, accept, text)
    return RedactionResult(text=text, counts=counts)


def contains_secret(text: str) -> bool:
    return any(pattern.search(text) for _key, pattern, _keep in _SECRET_RULES)
