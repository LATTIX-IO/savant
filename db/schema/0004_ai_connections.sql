create table if not exists ai_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_type text not null check (provider_type in ('openai', 'anthropic', 'azure-openai', 'openai-compatible')),
  display_name text not null,
  default_model text not null,
  purpose text not null,
  usage_scope text not null,
  allowed_models jsonb not null default '[]'::jsonb,
  supports_execution boolean not null default true,
  supports_judging boolean not null default true,
  is_default_execution boolean not null default false,
  is_default_judge boolean not null default false,
  status text not null default 'active' check (status in ('active', 'revoked')),
  secret_ref text not null unique,
  config jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  last_rotated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_connections_org_provider_label_key
  on ai_connections (organization_id, provider_type, lower(display_name));

create unique index if not exists ai_connections_default_execution_per_org_idx
  on ai_connections (organization_id)
  where is_default_execution = true and status = 'active';

create unique index if not exists ai_connections_default_judge_per_org_idx
  on ai_connections (organization_id)
  where is_default_judge = true and status = 'active';

create table if not exists ai_connection_secrets (
  ai_connection_id uuid primary key references ai_connections(id) on delete cascade,
  encrypted_secret text not null,
  secret_fingerprint text not null,
  algorithm text not null default 'aes-256-gcm',
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table ai_connections is
  'Tenant-scoped BYO-AI connection metadata. Raw credentials must stay outside Git and outside plaintext control-plane records.';

comment on table ai_connection_secrets is
  'Encrypted server-side secret material for BYO-AI connections. Raw API keys are never stored in plaintext.';