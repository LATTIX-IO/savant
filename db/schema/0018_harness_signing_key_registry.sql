-- PER-1059 increment 5: secret-free, tenant-scoped signing key references.
-- Actual cryptographic key material remains in an external vault.
create table if not exists harness_adapter_signing_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  adapter_id varchar(128) not null check (adapter_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  key_version integer not null check (key_version >= 1),
  secret_ref varchar(256) not null check (secret_ref ~ '^vault:[A-Za-z0-9_.:/-]{1,249}$'),
  status varchar(16) not null check (status in ('active','retiring','revoked')),
  not_before timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > not_before),
  unique (organization_id,adapter_id,key_version),
  unique (organization_id,adapter_id,secret_ref)
);
create unique index if not exists harness_signing_one_active_idx
  on harness_adapter_signing_keys (organization_id,adapter_id) where status='active';
create unique index if not exists harness_signing_one_retiring_idx
  on harness_adapter_signing_keys (organization_id,adapter_id) where status='retiring';
create index if not exists harness_signing_resolve_idx
  on harness_adapter_signing_keys (organization_id,adapter_id,status,expires_at);
comment on table harness_adapter_signing_keys is
  'Only vault references and key lifecycle metadata. No plaintext or encrypted HMAC key material, raw prompts or bearer credentials.';
