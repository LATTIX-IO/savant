-- PER-1059 increment 9: metadata-only provider reconciliation observations.
-- Never persist untrusted provider response bodies, prompts, credentials or tokens.
create table if not exists harness_eval_reconciliation_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  harness_run_id uuid not null,
  observation_id varchar(128) not null,
  adapter_id varchar(128) not null,
  idempotency_sha256 varchar(64) not null
    check (idempotency_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 varchar(64) not null
    check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  provider_state varchar(16) not null
    check (provider_state in ('accepted','not_found','unknown')),
  observed_at timestamptz not null default now(),
  unique (organization_id,harness_run_id,observation_id),
  foreign key (organization_id,harness_run_id)
    references harness_eval_runs (organization_id,id) on delete cascade
);
create index if not exists harness_reconciliation_observations_tenant_idx
  on harness_eval_reconciliation_observations
    (organization_id,harness_run_id,observed_at);
comment on table harness_eval_reconciliation_observations is
  'Read-only provider state observation for uncertain customer-harness execution. A not_found response alone NEVER authorizes replay.';
