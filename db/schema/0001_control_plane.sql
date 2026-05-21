create extension if not exists pgcrypto;

-- Canonical control-plane tables.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  environment text not null default 'production',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  external_subject text,
  email text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled', 'offboarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_org_email_key
  on users (organization_id, lower(email));

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  external_group_id text,
  provider text,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists groups_org_name_key
  on groups (organization_id, lower(name));

create table if not exists group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists role_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  principal_type text not null check (principal_type in ('user', 'group', 'service')),
  principal_id uuid not null,
  role_key text not null,
  scope_type text not null,
  scope_ref text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists git_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_type text not null check (provider_type in ('github', 'gitlab', 'azure', 'bitbucket', 'selfhosted')),
  display_name text not null,
  installation_ref text,
  credentials_ref text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists repositories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid references git_provider_connections(id) on delete set null,
  provider_type text not null check (provider_type in ('github', 'gitlab', 'azure', 'bitbucket', 'selfhosted')),
  external_repo_id text,
  owner_name text not null,
  repo_name text not null,
  default_branch text not null,
  visibility text not null default 'private',
  canonical_clone_url text,
  status text not null default 'connected' check (status in ('connected', 'warning', 'stale', 'disabled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_type, owner_name, repo_name)
);

create table if not exists repository_permissions (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references repositories(id) on delete cascade,
  permission_key text not null,
  granted_to_type text not null check (granted_to_type in ('user', 'group', 'role')),
  granted_to_ref text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists repository_sync_state (
  repository_id uuid primary key references repositories(id) on delete cascade,
  sync_mode text not null default 'poll' check (sync_mode in ('webhook', 'poll', 'manual')),
  status text not null default 'idle' check (status in ('idle', 'indexing', 'ok', 'warn', 'error')),
  last_indexed_commit_sha text,
  last_indexed_at timestamptz,
  last_successful_sync_at timestamptz,
  last_webhook_at timestamptz,
  next_poll_at timestamptz,
  error_code text,
  error_message text
);

create table if not exists repository_webhooks (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references repositories(id) on delete cascade,
  provider_webhook_id text,
  endpoint_path text not null,
  secret_ref text not null,
  status text not null default 'active' check (status in ('active', 'warning', 'disabled')),
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, endpoint_path)
);

create table if not exists access_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  policy_key text not null,
  name text not null,
  policy_type text not null check (policy_type in ('access', 'approval', 'distribution', 'environment')),
  scope_type text not null,
  scope_ref text not null,
  state text not null default 'draft' check (state in ('draft', 'active', 'deprecated')),
  rules jsonb not null default '[]'::jsonb,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, policy_key)
);

create table if not exists policy_bindings (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references access_policies(id) on delete cascade,
  scope_type text not null,
  scope_ref text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid references repositories(id) on delete set null,
  skill_id text not null,
  candidate_ref text not null,
  candidate_commit_sha text not null,
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'blocked', 'canceled')),
  requested_by uuid references users(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists review_comments (
  id uuid primary key default gen_random_uuid(),
  review_request_id uuid not null references review_requests(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  body text not null,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists release_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid references repositories(id) on delete set null,
  skill_id text not null,
  source_ref text not null,
  source_commit_sha text not null,
  from_environment text not null check (from_environment in ('draft', 'staging', 'production')),
  to_environment text not null check (to_environment in ('draft', 'staging', 'production')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked', 'rejected', 'released', 'rolled_back')),
  requested_by uuid references users(id) on delete set null,
  review_request_id uuid references review_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists release_approvals (
  id uuid primary key default gen_random_uuid(),
  release_request_id uuid not null references release_requests(id) on delete cascade,
  required_role text not null,
  approver_user_id uuid references users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists release_targets (
  id uuid primary key default gen_random_uuid(),
  release_request_id uuid not null references release_requests(id) on delete cascade,
  target_key text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'released', 'failed', 'rolled_back')),
  bundle_locator text,
  last_synced_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  unique (release_request_id, target_key)
);

create table if not exists release_events (
  id uuid primary key default gen_random_uuid(),
  release_request_id uuid not null references release_requests(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists connector_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connector_key text not null,
  category text not null check (category in ('local', 'native', 'notify', 'bundle')),
  kind text not null,
  status text not null default 'healthy' check (status in ('healthy', 'degraded', 'warning', 'offline')),
  credentials_ref text,
  config jsonb not null default '{}'::jsonb,
  installed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, connector_key)
);

create table if not exists connector_targets (
  id uuid primary key default gen_random_uuid(),
  connector_installation_id uuid not null references connector_installations(id) on delete cascade,
  target_ref text not null,
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connector_installation_id, target_ref)
);

create table if not exists connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connector_installation_id uuid not null references connector_installations(id) on delete cascade,
  release_request_id uuid references release_requests(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  metrics jsonb not null default '{}'::jsonb
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_type text not null,
  actor_ref text not null,
  category text not null,
  action text not null,
  target_type text not null,
  target_ref text not null,
  request_id text,
  trace_id text,
  payload_redacted jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_events_org_occurred_at_idx
  on audit_events (organization_id, occurred_at desc);

-- Rebuildable Git-derived index tables.

create table if not exists indexed_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  skill_id text not null,
  display_name text not null,
  tier text not null check (tier in ('tier1', 'tier2', 'tier3')),
  owner text,
  status text not null,
  source_path text not null,
  metadata_version text,
  source_commit_sha text not null,
  default_branch text,
  content_hash text not null,
  manifest jsonb not null default '{}'::jsonb,
  last_indexed_at timestamptz not null default now(),
  unique (repository_id, skill_id, source_commit_sha)
);

comment on table indexed_skills is
  'Rebuildable Git-derived skill index. Git remains the canonical source of skill content.';

create index if not exists indexed_skills_repo_skill_idx
  on indexed_skills (repository_id, skill_id);

create table if not exists indexed_skill_versions (
  id uuid primary key default gen_random_uuid(),
  indexed_skill_id uuid not null references indexed_skills(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  skill_id text not null,
  version_ref text not null,
  commit_sha text not null,
  branch_name text,
  channel text,
  is_current_candidate boolean not null default false,
  is_current_baseline boolean not null default false,
  observed_at timestamptz not null default now(),
  unique (repository_id, skill_id, commit_sha)
);

create table if not exists indexed_skill_dependencies (
  id uuid primary key default gen_random_uuid(),
  indexed_skill_id uuid not null references indexed_skills(id) on delete cascade,
  dependency_skill_id text not null,
  source text not null,
  source_commit_sha text not null,
  last_indexed_at timestamptz not null default now(),
  unique (indexed_skill_id, dependency_skill_id, source_commit_sha)
);

create table if not exists indexed_eval_assets (
  id uuid primary key default gen_random_uuid(),
  indexed_skill_id uuid not null references indexed_skills(id) on delete cascade,
  asset_type text not null check (asset_type in ('dataset', 'rubric', 'baseline', 'comparison', 'fixture')),
  logical_name text,
  source_path text not null,
  source_commit_sha text not null,
  content_hash text not null,
  version_label text,
  last_indexed_at timestamptz not null default now(),
  unique (indexed_skill_id, asset_type, source_path, source_commit_sha)
);

create table if not exists indexed_eval_results (
  id uuid primary key default gen_random_uuid(),
  indexed_skill_id uuid not null references indexed_skills(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  run_external_id text,
  dataset_asset_id uuid references indexed_eval_assets(id) on delete set null,
  baseline_asset_id uuid references indexed_eval_assets(id) on delete set null,
  comparison_artifact_path text,
  comparison_commit_sha text,
  total_cases integer not null default 0,
  passed_cases integer not null default 0,
  failed_cases integer not null default 0,
  score_delta numeric(8, 2),
  status text not null check (status in ('running', 'complete', 'complete_with_regressions', 'complete_baseline', 'failed')),
  executed_at timestamptz,
  indexed_at timestamptz not null default now()
);

comment on table indexed_eval_results is
  'Rebuildable summaries that point to Git-authored evaluation evidence instead of replacing it.';

create table if not exists indexed_release_manifests (
  id uuid primary key default gen_random_uuid(),
  release_request_id uuid references release_requests(id) on delete set null,
  repository_id uuid not null references repositories(id) on delete cascade,
  skill_id text not null,
  release_ref text not null,
  source_commit_sha text not null,
  manifest_path text not null,
  bundle_locator text,
  target_environment text not null,
  indexed_at timestamptz not null default now(),
  unique (repository_id, skill_id, release_ref, source_commit_sha)
);

comment on table indexed_release_manifests is
  'Derived release manifest index. Canonical release workflow state remains in release_* tables.';