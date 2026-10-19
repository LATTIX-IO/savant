-- PER-1444: conservative tenant/day admission units for observed Test Bench runs.
-- This is NOT actual provider token metering, invoicing or a monetary guarantee.
-- Idempotent DDL; server admission uses Postgres UTC day to avoid locale drift.
create table if not exists test_bench_daily_admissions (
  organization_id uuid not null references organizations(id) on delete cascade,
  utc_day date not null,
  admitted_runs integer not null default 0,
  reserved_normalized_tokens integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, utc_day),
  constraint test_bench_daily_admissions_run_limit
    check (admitted_runs between 0 and 10),
  constraint test_bench_daily_admissions_token_limit
    check (reserved_normalized_tokens between 0 and 120000),
  constraint test_bench_daily_admissions_atomic_units
    check (reserved_normalized_tokens = admitted_runs * 12000)
);
comment on table test_bench_daily_admissions is
  'Conservative UTC daily admissions for tenant Test Bench; 10 runs and 120k normalized budget units. Does not meter or cap actual provider charges.';
comment on column test_bench_daily_admissions.reserved_normalized_tokens is
  'Not measured provider tokens. Each admitted run consumes an unreimbursed 12000-unit reservation until the next UTC date to bound retries.';
