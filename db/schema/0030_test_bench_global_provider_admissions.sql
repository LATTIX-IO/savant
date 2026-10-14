-- PER-1452: conservative GLOBAL shared-provider admission reservations.
-- Units are fixed normalized QA worst-case reservations, NOT provider billing.
create table if not exists test_bench_platform_provider_daily_admissions (
  provider_code text not null check(provider_code in ('jev','nim')),
  utc_day date not null,
  admitted_runs integer not null default 0,
  reserved_normalized_tokens integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(provider_code,utc_day),
  constraint test_bench_platform_provider_daily_runs_bound
    check(admitted_runs >= 0 and
      ((provider_code='jev' and admitted_runs<=200) or
       (provider_code='nim' and admitted_runs<=100))),
  constraint test_bench_platform_provider_daily_units_bound
    check(reserved_normalized_tokens=admitted_runs*12000)
);
comment on table test_bench_platform_provider_daily_admissions is
  'Shared provider admission reservations across all tenants. No tenant IDs, prompts, secrets or observed billing. Cancellation is nonrefundable.';
