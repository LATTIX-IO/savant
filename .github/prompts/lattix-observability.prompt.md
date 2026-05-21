---
name: lattix-observability
description: Add Lattix-standard logs, metrics, traces, and health checks
argument-hint: "<service, endpoint, job, or workflow>"
agent: agent
---

Improve observability for this Lattix production path.

Add where relevant:
- Structured JSON logs.
- Request IDs, trace IDs, operation names, stable error codes.
- Metrics for latency, errors, throughput, retries, queue depth, saturation.
- Tracing spans for external calls, long operations, and critical workflows.
- Health/readiness checks for services.
- Sanitization to prevent secrets, PII, auth headers, session IDs, or sensitive payloads in logs.

Return:
Observability gaps; code changes; metric/log/span names; verification steps; dashboard/alert suggestions if applicable.