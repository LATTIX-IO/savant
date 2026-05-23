# Runtime scorecard template

Score both runtime candidates against the same fixture profile and scenario set.

Use a 1-5 scale for each criterion:

- 1 = poor fit
- 2 = weak fit
- 3 = acceptable fit
- 4 = strong fit
- 5 = excellent fit

Multiply the score by the weight, then sum the weighted totals.

| Criterion | Weight | Rust score | Rust weighted | Python score | Python weighted | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Cold start behavior on Vercel | 15 |  |  |  |  |  |
| Warm latency for Git-heavy requests | 20 |  |  |  |  |  |
| Packaging and deployment ergonomics | 10 |  |  |  |  |  |
| Ecosystem fit for repo, eval, and bundle workloads | 15 |  |  |  |  |  |
| Local developer experience in this monorepo | 10 |  |  |  |  |  |
| Observability and debugging support | 10 |  |  |  |  |  |
| Operational limits on Vercel | 10 |  |  |  |  |  |
| Security and supply-chain posture | 10 |  |  |  |  |  |
| **Total** | **100** |  |  |  |  |  |

## Recommendation notes

- Primary runtime recommendation:
- Fallback runtime recommendation:
- Workloads that should remain in `apps/web` for now:
- Workloads that should move off Vercel entirely if needed:
