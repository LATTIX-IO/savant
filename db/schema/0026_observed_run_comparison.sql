-- PER-1435: read-only, provenance-bound descriptive paired QA comparisons.
-- No generated scores and no mutation of historical run receipts.
-- The scoringContract marker is attached when a job completes; older legacy
-- scorecards intentionally remain ineligible until re-evaluated under a pinned rubric.
create index if not exists test_bench_runs_comparable_recent
  on test_bench_runs(organization_id,skill_id,completed_at desc)
  where status='complete' and scorecard is not null;

comment on index test_bench_runs_comparable_recent is
  'Bounded metadata-only listing of complete runs for tenant-scoped descriptive comparisons; eligibility requires scoring-contract fingerprint and matched encrypted cases.';
