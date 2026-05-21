---
name: lattix-debug
description: Diagnose a bug using evidence-first Lattix workflow
argument-hint: "<bug report, logs, stack trace, or failing test>"
agent: agent
---

Diagnose and fix the issue.

Process:
1. Summarize symptoms and known facts.
2. Identify likely failure modes.
3. Add or update a failing test that reproduces the issue when practical.
4. Inspect relevant code paths and boundaries.
5. Implement the smallest safe fix.
6. Add logs/metrics only if they improve future diagnosis.
7. Include verification commands and regression risks.

Do not guess APIs, configs, paths, or test results. State uncertainty clearly.