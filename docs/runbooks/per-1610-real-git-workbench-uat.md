# PER-1610 — Real Git Workbench asset acceptance

This runbook qualifies only the source-backed Git skill-file inventory, declared dependencies, and read-only file inspector. It does **not** establish provider invocation traces, autonomous workflow execution, enterprise OAuth, or full production UI cutover.

## Prerequisites

1. An actual owner-authenticated browser state from the existing `per-1600-owner-auth0-capture.md` local procedure. Never commit or upload the cookie JSON.
2. Workspace A contains a **real indexed GitHub skill** whose `source_commit_sha` is a full immutable commit; its repository must be accessible to Savant's managed Git read connection. Use the actual skill UUID in `SAVANT_UAT_SKILL_UUID`. Do not substitute a mocked source, fallback draft, guessed tenant or placeholder.
3. The skill has one actual, non-empty text reference under `references/`, `scripts/`, `eval/` or `evals/`. Example syntax for the optional acceptance fixture is `references/policy.md`; use a verified **relative** path from the source tree.
4. Workspace B is a separate, owner-readable synthetic workspace and must not contain A's skill; denied C must not be accessible. Existing production-read-only opt-ins and private capture controls are mandatory.

## Execute locally

On the operator workstation, set existing `SAVANT_UAT_BASE_URL`, `SAVANT_UAT_STORAGE_STATE`, `SAVANT_UAT_WORKSPACE_A/B/DENIED`, `SAVANT_UAT_SKILL_UUID`, and `SAVANT_UAT_ASSET_PATH` to the actual A-only file. Follow the existing production-origin opt-in policy when required.

```powershell
$env:SAVANT_UAT_ASSET_PATH = "references/<verified-file>.md"
node apps/web/scripts/ux-v2-authenticated-acceptance.cjs
```

The optional asset portion of the 390/768/1280/1440 light/dark journeys waits for the real Git file tree, selects the known path, verifies that non-empty pinned content appears in the read-only inspector, returns to `SKILL.md`, and checks outer viewport overflow. The tenant-isolation journey makes a real GET against workspace B's same skill ID and requires an explicit 403/404. No Git mutation is submitted; all screenshots and the browser receipt remain private and outside Git.

## Negative/manual verification

- Workspace B and denied C never enumerate A's asset names or contents.
- Invalid encoded paths, dot traversal, dot-git, missing files and unsupported provider types return explicit errors without external fetch or fallback content.
- GitHub mode `120000` symlinks are excluded, and large/invalid UTF-8 assets fail closed.
- Keyboard tab, Enter/Space, reduced motion, low-width file-tree discoverability, screen-reader labels, light/dark contrast, and focus movement receive a real human review.
- A source-commit change invalidates the displayed index and selected preview; an unsubmitted `SKILL.md` draft remains separate from a read-only file preview and requires reviewed Git proposal semantics for write.
- Verify GitHub branch protection explicitly if performing a separate synthetic write rehearsal. This read-only runner does not approve/push anything.

## Known limits

`SKILL.md` Markdown references are classified as verified, missing, external or unsafe based on **observed Git paths at the pinned commit**. They are not execution traces and do not prove that any model or tool invoked those dependencies. The inventory is bounded to 200 safe files, with omitted count displayed. Only GitHub managed read connections are supported by this increment; other connection types fail explicitly.

This runner alone does not close PER-1585, PER-1586, PER-1592 or PER-1421. Keep the overall UX rollout gate held until actual authenticated acceptance and independent operational readiness are recorded.
