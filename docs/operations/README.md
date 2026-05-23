# Operations documentation

Use this folder for local development runbooks, release steps, monitoring notes, and incident response checklists.

## GitHub-first repository writes

The current secure MVP only supports provider-backed repository provisioning and scaffold/apply commits through GitHub.

- Set an env var such as `GITHUB_WRITE_TOKEN` in the runtime.
- Store the env var name in `git_provider_connections.credentials_ref` for the active GitHub connection.
- Use `poll` or `manual` sync. Webhook sync is intentionally disabled for this MVP slice.
- Only workspace Owners and members of the `platform-admins` group can connect, provision, apply scaffolds, or request repository sync.

If you connect an existing repository without an explicit `connectionId`, Savant will bind the repository to the single active GitHub connection when that choice is unambiguous.
