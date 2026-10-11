-- PER-1201: additional *read* ACLs for individual Git-authored skills/workflow artifacts.
-- These rules never grant repository access. No file content or credentials are stored.
create table if not exists capability_artifact_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  repository_id uuid not null,
  artifact_kind text not null check (artifact_kind in ('skill', 'workflow_spec')),
  artifact_id text not null check (length(artifact_id) between 1 and 128),
  permission_key text not null default 'read' check (permission_key = 'read'),
  effect text not null check (effect in ('allow', 'deny')),
  granted_to_type text not null check (granted_to_type in ('user','group','role')),
  granted_to_ref text not null check (length(granted_to_ref) between 1 and 256),
  created_at timestamptz not null default now(),
  foreign key (organization_id, repository_id)
    references repositories (organization_id, id) on delete cascade,
  unique (organization_id, repository_id, artifact_kind, artifact_id,
          permission_key, effect, granted_to_type, granted_to_ref)
);
create index if not exists capability_artifact_permissions_scope_idx
 on capability_artifact_permissions (organization_id, repository_id, artifact_kind, artifact_id);

comment on table capability_artifact_permissions is
  'Optional per-artifact read filters enforced AFTER tenant/repository ACL and BEFORE Git IO; explicit deny overrides allow. Git remains source of authored content.';
