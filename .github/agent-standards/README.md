# Lattix Agent Standards

This directory defines the synchronization contract for Lattix-wide agent standards.

The canonical authoring files remain in the monorepo root so humans and agents have one place to update them:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- `.github/prompts/*.prompt.md`

Generated copies are fanned out to child repositories by `scripts/sync-agent-standards.ps1`.

Do not hand-edit generated copies in child repositories. Update the canonical source files above, then run the sync script or let the `Agent Standards Sync` workflow apply and push generated updates after changes reach `main`.
