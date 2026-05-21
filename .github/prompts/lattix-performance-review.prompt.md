---
name: lattix-performance-review
description: Review Lattix code for latency, throughput, memory, query, and concurrency risks
argument-hint: "<file, diff, endpoint, job, query, or workflow>"
agent: agent
---

Perform a Lattix performance review.

Check:
- Algorithmic complexity and avoidable work.
- DB query count, indexes, joins, transactions, locks, pagination.
- Network calls, retries, timeouts, batching, pooling.
- Memory growth, streaming vs buffering, large payloads.
- Concurrency safety, backpressure, cancellation, queue depth.
- Caching opportunities and invalidation risks.
- Hot-path logging/metrics overhead.
- Production observability for latency, throughput, errors, saturation.

Rules:
- Preserve correctness and security.
- Prefer measured improvements over speculative rewrites.
- Do not add dependencies unless justified.
- Recommend benchmarks or profiling commands where useful.

Return:
## Summary
## Bottlenecks
## Recommended Changes
## Tests/Benchmarks
## Observability
## Risks
## Verification Commands