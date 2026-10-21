# PER-1600 — Owner-only Auth0 session for UX-07 (Windows PowerShell)

This is a **local interactive preflight** for the existing Playwright acceptance runner,
not a bypass for real Auth0, tenant isolation, database recovery, or the UX-08 release gate.

1. Use a trusted, personal Windows workstation with Node.js and Playwright available,
   and a protected directory **outside the Git repository**. The A slug must be a
   *real, owner-accessible synthetic workspace*. Do not invent or use another
   customer's slug. The denied C workspace must not be accessible to the owner.
2. In a PowerShell session, set the same environment variables the acceptance
   runner already requires. The value below is a **template**, not a confirmed
   workspace slug:

```powershell
$env:SAVANT_UAT_BASE_URL = "https://savantskills.app/"
$env:SAVANT_UAT_OWNER_PRODUCTION_ACK = "OWNER-READONLY-PRODUCTION-SYNTHETIC-UX"
$env:SAVANT_UAT_SYNTHETIC_TENANTS = "true"
$env:SAVANT_UAT_WORKSPACE_A = "<actual-owner-synthetic-a>"
$secureDir = Join-Path $env:LOCALAPPDATA "Savant-Private-UAT"
New-Item -ItemType Directory -Force -Path $secureDir | Out-Null
$env:SAVANT_UAT_STORAGE_STATE = Join-Path $secureDir "owner-auth0-playwright.json"
node apps/web/scripts/ux-v2-owner-login-capture.cjs
```

3. A Chromium window opens. Authenticate normally through real Auth0 in that
   visible window, navigate to the selected tenant if necessary, then press
   Enter in the terminal. The tool navigates to the real v2 Overview and checks
   that the authenticated workspace route renders before saving the cookie-only
   session. It never asks for or prints a password/token.
4. The result is a local, exclusive, best-effort `0600` session JSON file, with
   own-origin secure session cookies and **no Auth0-IdP third-party cookies or
   localStorage**. Windows ACLs are inherited from the selected directory:
   the operator is responsible for protecting that directory. Do not upload,
   paste, email or commit this file. It is a live session secret.
5. Independently provision/confirm real owner-accessible B, denied C, and the
   A-only Git-indexed proposal-capable skill UUID. Then run
   `node apps/web/scripts/ux-v2-authenticated-acceptance.cjs` with the existing
   `SAVANT_UAT_WORKSPACE_B`, `SAVANT_UAT_WORKSPACE_DENIED`,
   `SAVANT_UAT_SKILL_UUID` and saved state.
6. A pass produces the private 64-PNG browser evidence manifest, **not** proof
   of production restored schema/keys, provider/billing evidence, all HTTP
   negative paths, or witnessed rollback. PER-1585/1586 remain In Progress until
   those independent gates are met.

The helper never changes Vercel flags, creates users, writes provider data, or
executes schema migrations. Use a newly named output file for each attempt;
existing session files are never overwritten.
