-- PER-1425: bounded real Test Bench execution. No plaintext prompts/outputs in DB.
-- Keep job-kind checks in 0010/0011 compatible with schema reapplication.
alter table background_jobs drop constraint if exists background_jobs_kind_check;
alter table background_jobs add constraint background_jobs_kind_check
  check(kind in ('eval_generation','safety_scan','hub_sync','hub_hydrate','hub_safety','hub_eval','test_bench_run'));

-- Composite tenant boundary for the immutable source definition.
create unique index if not exists test_bench_definitions_tenant_id_unique
  on test_bench_definitions (organization_id,id);

create table if not exists test_bench_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null,
  definition_id uuid not null,
  definition_revision integer not null check (definition_revision>=1),
  skill_id text not null check(length(skill_id) between 1 and 300),
  source_path text not null check(length(source_path) between 1 and 1024),
  source_commit_sha text not null check(source_commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  request_id uuid not null,
  requested_by text not null,
  -- Per-run frozen encrypted copy: editing/archiving the source suite cannot modify queued inputs.
  snapshot_ciphertext text not null check(left(snapshot_ciphertext,3)='v1:' and length(snapshot_ciphertext)<=32768),
  results_ciphertext text,
  status text not null default 'queued' check(status in ('queued','running','complete','failed')),
  expected_cases integer not null check(expected_cases between 1 and 4),
  completed_cases integer not null default 0 check(completed_cases between 0 and 4),
  total_tokens integer not null default 0 check(total_tokens>=0),
  estimated_cost_usd numeric(12,6) not null default 0 check(estimated_cost_usd>=0),
  scorecard jsonb,
  execution_model text,
  judge_model text,
  job_id uuid references background_jobs(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint test_bench_run_definition_tenant_fk
    foreign key (organization_id,definition_id)
    references test_bench_definitions(organization_id,id) on delete cascade,
  constraint test_bench_run_repository_tenant_fk
    foreign key (organization_id,repository_id)
    references repositories(organization_id,id) on delete cascade,
  constraint test_bench_run_idempotent_request_unique unique(organization_id,request_id)
);
create index if not exists test_bench_runs_recent
  on test_bench_runs(organization_id,definition_id,created_at desc);
create unique index if not exists test_bench_runs_one_active
  on test_bench_runs(organization_id,definition_id)
  where status in ('queued','running');
comment on table test_bench_runs is
  'Case snapshots and observed per-case outcomes are tenant/AAD-bound encrypted. No simulated pass rate, plaintext provider response, or raw case payload in background_jobs.';
