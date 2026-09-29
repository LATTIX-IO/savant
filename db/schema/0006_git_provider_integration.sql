-- Managed Git provider integration (GitHub App, GitLab, Bitbucket Cloud, Azure Repos).
--
-- Phase A of the migration: the new model is introduced alongside the legacy
-- `credentials_ref` environment-variable reference, which keeps working until
-- existing connections are reauthorized through the Source Control settings.

alter table git_provider_connections
  add column if not exists auth_type text,
  add column if not exists provider_host text,
  add column if not exists provider_account_id text,
  add column if not exists provider_account_name text,
  add column if not exists provider_installation_id text,
  -- Provider-specific access scope, e.g. the Azure DevOps organization a PAT is limited to.
  add column if not exists provider_scope text,
  add column if not exists secret_id uuid,
  add column if not exists scopes jsonb not null default '[]'::jsonb,
  add column if not exists last_validated_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists disconnected_at timestamptz;

-- Existing hand-inserted rows point at a deployment environment variable.
update git_provider_connections
set auth_type = 'legacy_env'
where auth_type is null;

alter table git_provider_connections
  alter column auth_type set not null,
  alter column auth_type set default 'oauth',
  alter column credentials_ref drop not null;

alter table git_provider_connections
  drop constraint if exists git_provider_connections_auth_type_check;
alter table git_provider_connections
  add constraint git_provider_connections_auth_type_check
  check (auth_type in ('github_app_installation', 'oauth', 'access_token', 'pat', 'legacy_env'));

alter table git_provider_connections
  drop constraint if exists git_provider_connections_status_check;
alter table git_provider_connections
  add constraint git_provider_connections_status_check
  check (status in ('active', 'needs_reauthorization', 'revoked', 'error', 'disconnected'));

-- A legacy connection must still name its environment variable; managed
-- connections never do.
alter table git_provider_connections
  drop constraint if exists git_provider_connections_credential_source_check;
alter table git_provider_connections
  add constraint git_provider_connections_credential_source_check
  check (auth_type <> 'legacy_env' or credentials_ref is not null);

create index if not exists git_provider_connections_org_provider_idx
  on git_provider_connections (organization_id, provider_type, status);

-- One live connection per provider account/installation inside an organization,
-- so re-running an authorization updates the existing connection.
create unique index if not exists git_provider_connections_org_account_key
  on git_provider_connections (
    organization_id,
    provider_type,
    coalesce(provider_host, ''),
    coalesce(provider_installation_id, provider_account_id)
  )
  where status <> 'disconnected'
    and coalesce(provider_installation_id, provider_account_id) is not null;

-- Encrypted credential material. The encryption key lives outside the
-- database (GIT_CREDENTIAL_ENCRYPTION_KEY); ciphertext is bound to the owning
-- organization and connection through AES-GCM additional authenticated data.
create table if not exists git_provider_secrets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null references git_provider_connections(id) on delete cascade,
  encrypted_payload text not null,
  secret_fingerprint text not null,
  algorithm text not null default 'aes-256-gcm',
  key_version smallint not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'git_provider_connections_secret_id_fkey'
  ) then
    alter table git_provider_connections
      add constraint git_provider_connections_secret_id_fkey
      foreign key (secret_id) references git_provider_secrets(id) on delete set null;
  end if;
end $$;

-- Single-use OAuth / installation authorization state. Only a SHA-256 hash of
-- the state value is stored; the PKCE verifier and any per-instance client
-- credentials are encrypted.
create table if not exists git_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_subject text not null,
  provider_type text not null check (provider_type in ('github', 'gitlab', 'azure', 'bitbucket')),
  provider_host text,
  return_path text not null,
  encrypted_payload text,
  reauthorize_connection_id uuid references git_provider_connections(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists git_oauth_states_expiry_idx
  on git_oauth_states (expires_at)
  where consumed_at is null;

-- Explicit repository -> provider connection association (INV-GIT-02).
create table if not exists repository_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  connection_id uuid not null references git_provider_connections(id) on delete cascade,
  provider_repository_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id)
);

create index if not exists repository_connections_connection_idx
  on repository_connections (organization_id, connection_id);

-- Idempotent repository connection on (organization, provider, provider repository id).
create unique index if not exists repositories_org_provider_external_id_key
  on repositories (organization_id, provider_type, external_repo_id)
  where external_repo_id is not null;

alter table repositories
  add column if not exists provider_host text,
  add column if not exists provider_namespace text,
  add column if not exists provider_project text;

-- Repository indexing state is separate from repository existence
-- (INV-GIT-06). New states surface authorization problems distinctly.
alter table repository_sync_state
  add column if not exists sync_started_at timestamptz,
  add column if not exists sync_target_revision text;

alter table repository_sync_state
  drop constraint if exists repository_sync_state_status_check;
alter table repository_sync_state
  add constraint repository_sync_state_status_check
  check (status in ('idle', 'indexing', 'ok', 'warn', 'error', 'auth_required', 'access_revoked'));

comment on table git_provider_secrets is
  'Encrypted Git provider credentials (OAuth refresh/access tokens, manual tokens). Never plaintext; the key is held outside the database.';

comment on table git_oauth_states is
  'Single-use, expiring authorization state for Git provider OAuth and GitHub App installation flows.';

comment on table repository_connections is
  'Explicit association between a repository and the exact provider connection used to read it.';
