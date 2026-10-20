-- PER-1447: immutable per-call provider-REPORTED token evidence.
-- This is NOT actual billable usage, actual dollars, or an invoice.
-- An unknown/timeout provider result may still incur provider charges.
create unique index if not exists test_bench_runs_tenant_id_receipt_fk
  on test_bench_runs(organization_id,id);

create table if not exists test_bench_provider_usage_receipts (
  organization_id uuid not null,
  run_id uuid not null,
  case_index integer not null check(case_index between 1 and 4),
  phase text not null check(phase in ('executor','judge')),
  model text not null check(length(model) between 1 and 160),
  prompt_tokens integer not null check(prompt_tokens>=0 and prompt_tokens<=1000000),
  completion_tokens integer not null check(completion_tokens>=0 and completion_tokens<=1000000),
  observed_at timestamptz not null default now(),
  constraint test_bench_provider_usage_nonzero
    check(prompt_tokens+completion_tokens>0),
  constraint test_bench_provider_usage_primary
    primary key(organization_id,run_id,case_index,phase),
  constraint test_bench_provider_usage_tenant_run_fk
    foreign key(organization_id,run_id)
      references test_bench_runs(organization_id,id) on delete cascade
);
create index if not exists test_bench_provider_usage_run_recent
  on test_bench_provider_usage_receipts(organization_id,run_id,observed_at desc);

alter table test_bench_runs
  add column if not exists observed_executor_tokens integer not null default 0
  check(observed_executor_tokens>=0 and observed_executor_tokens<=4000000);
alter table test_bench_runs
  add column if not exists observed_judge_tokens integer not null default 0
  check(observed_judge_tokens>=0 and observed_judge_tokens<=4000000);
alter table test_bench_runs
  add column if not exists observed_usage_receipts integer not null default 0
  check(observed_usage_receipts between 0 and 8);

comment on table test_bench_provider_usage_receipts is
  'Tenant-bound deduplicated acknowledgments of model/judge token usage, never provider billing or raw prompts/responses. Missing receipt != zero charged usage.';
comment on column test_bench_runs.observed_executor_tokens is
  'Only provider-reported and durably acknowledged tokens from executor; actual invoice and unknown provider side effects may differ.';
