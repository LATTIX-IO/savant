-- PER-1059 increment 11: disabled-by-default tenant-scoped signed-status connectors.
-- Only outbound endpoint and opaque tenant-specific vault references are persisted.
create table if not exists harness_status_connector_configs (
  organization_id uuid not null references organizations(id) on delete cascade,
  adapter_id varchar(128) not null
    check (adapter_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  endpoint varchar(512) not null,
  secret_ref varchar(256) not null,
  status varchar(16) not null default 'disabled'
    check (status in ('disabled','active')),
  revision integer not null default 1 check (revision>=1),
  updated_by varchar(128) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,adapter_id),
  check (secret_ref like ('vault:' || organization_id::text || ':' || adapter_id || ':%')),
  check (endpoint like 'https://%/v1/savant/status')
);
create index if not exists harness_status_connectors_enabled_idx
  on harness_status_connector_configs (organization_id,adapter_id)
  where status='active';
comment on table harness_status_connector_configs is
  'Disabled-by-default, tenant-scoped admin-approved customer harness status endpoint and vault reference; no credential values or provider response bodies.';
