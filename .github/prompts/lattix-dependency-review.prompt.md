---
name: lattix-dependency-review
description: Review a new or existing dependency for Lattix security, license, and maintenance risk
argument-hint: "<package name, proposed dependency, package file, or diff>"
agent: agent
---

Review this dependency for Lattix.

Check:
- Purpose and whether existing code/stdlib can solve it.
- License compatibility.
- Security posture and known/likely vulnerabilities.
- Maintenance health: release activity, ownership, popularity, issue volume.
- Transitive dependency risk.
- Runtime size, performance, and operational impact.
- Supply-chain risk: install scripts, native extensions, broad permissions.
- Version pinning/lockfile expectations.
- API stability and migration cost.
- Safer alternatives.

Rules:
- Do not add the dependency unless benefits clearly outweigh risks.
- Do not make network calls unless explicitly permitted.
- If freshness is uncertain, state how to verify with local/org-approved tools.

Return:
## Recommendation
Approve / Reject / Needs Review
## Purpose
## Alternatives
## License
## Security Risk
## Maintenance Risk
## Operational Impact
## Required Safeguards
## Verification Commands