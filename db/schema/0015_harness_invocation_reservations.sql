-- PER-1059 increment 1: durable, tenant-isolated execution reservations and
-- immutable, metadata-only event receipts. The customer harness still owns execution.
-- Separate from legacy skill_runs (observed telemetry) and imported eval scores.
create table if not exists harness_eval_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  adapter_id varchar(128) not null,
  run_id varchar(128) not null,
  actor_subject varchar(128) not null,
  idempotency_key varchar(128) not null,
  request_digest varchar(64) not null check (request_digest ~ '^[a-f0-9]{64}$'),
  spec_version_hash varchar(64) not null check (spec_version_hash ~ '^[a-f0-9]{64}$'),
  test_suite_hash varchar(64) not null check (test_suite_hash ~ '^[a-f0-9]{64}$'),
  trace_id varchar(128) not null,
  input_ref varchar(128) not null,
  -- Reserving a maximum is not an invoice; settlement is not part of this increment.
  max_cost_usd numeric(12,6) not null check (max_cost_usd > 0 and max_cost_usd <= 100000),
  max_duration_ms integer not null check (max_duration_ms between 1 and 86400000),
  capture_level varchar(16) not null check (capture_level in ('none','metadata','redacted')),
  retention_days smallint not null check (retention_days between 0 and 30),
  residency varchar(128) not null,
  external_run_id varchar(128),
  status varchar(20) not null default 'queued'
    check (status in ('queued','running','cancelRequested','succeeded','failed','timedOut','canceled')),
  latest_event_sequence bigint not null default 0 check (latest_event_sequence >= 0),
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,run_id),
  unique (organization_id,idempotency_key),
  unique (organization_id,id)
);
create index if not exists harness_eval_runs_active_org_idx
  on harness_eval_runs (organization_id,status,deadline_at)
  where status in ('queued','running','cancelRequested');
comment on table harness_eval_runs is
  'PER-1059: private control-plane reservation receipts only; no raw user content, secrets, adapter credentials or prompt traces.';

create table if not exists harness_eval_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  harness_run_id uuid not null,
  event_id varchar(128) not null,
  sequence bigint not null check (sequence > 0),
  status varchar(20) not null check (status in ('running','succeeded','failed','timedOut','canceled')),
  trace_id varchar(128) not null,
  created_at timestamptz not null default now(),
  unique (organization_id,harness_run_id,event_id),
  unique (organization_id,harness_run_id,sequence),
  foreign key (organization_id,harness_run_id)
    references harness_eval_runs (organization_id,id) on delete cascade
);
comment on table harness_eval_events is
  'Immutable ordered metadata-only receipts for tenant-scoped harness test runs; external webhooks must authenticate before admission.';
