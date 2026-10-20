-- PER-1429: terminal, tenant-audited Test Bench cancellation. Forward-only and idempotent.
-- 0024 is CREATE TABLE IF NOT EXISTS and does not reset this constraint on re-apply.
alter table test_bench_runs add column if not exists canceled_at timestamptz;
alter table test_bench_runs add column if not exists canceled_by text;
alter table test_bench_runs drop constraint if exists test_bench_runs_status_check;
alter table test_bench_runs add constraint test_bench_runs_status_check
  check(status in ('queued','running','complete','failed','canceled'));
-- Canceled runs never carry a full scored release result. Existing rows have
-- no cancellation timestamp and are unaffected.
alter table test_bench_runs drop constraint if exists test_bench_runs_canceled_consistency;
alter table test_bench_runs add constraint test_bench_runs_canceled_consistency
  check(status <> 'canceled' or
    (scorecard is null and canceled_at is not null and canceled_by is not null));
comment on column test_bench_runs.canceled_at is
  'Terminal cancellation time. Provider calls already in flight may still complete; no future calls are initiated after cancellation is observed.';
