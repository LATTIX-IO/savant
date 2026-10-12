-- PER-1059 increment 6: tenant-scoped, process-independent dispatch lease fencing.
-- No provider payloads, prompts, secret values, or raw lease tokens are stored.
create table if not exists harness_eval_dispatch_leases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  harness_run_id uuid not null,
  adapter_id varchar(128) not null,
  worker_id varchar(128) not null,
  lease_token_sha256 varchar(64) not null check (lease_token_sha256 ~ '^[a-f0-9]{64}$'),
  generation integer not null default 1 check (generation between 1 and 2147483647),
  attempt integer not null default 1 check (attempt between 1 and 8),
  state varchar(16) not null check (state in ('leased','retry','acknowledged','exhausted')),
  lease_until timestamptz not null,
  next_eligible_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (organization_id,harness_run_id),
  foreign key (organization_id,harness_run_id)
    references harness_eval_runs (organization_id,id) on delete cascade
);
create index if not exists harness_dispatch_active_idx
  on harness_eval_dispatch_leases (organization_id,adapter_id,state,next_eligible_at);
comment on table harness_eval_dispatch_leases is
  'Private lease fencing for reserved customer-harness QA runs. 256-bit bearer lease token is returned once; only SHA-256 is stored. Leases do not guarantee exactly-once external execution.';
