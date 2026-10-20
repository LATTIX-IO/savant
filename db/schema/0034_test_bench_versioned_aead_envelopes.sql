-- PER-1550: support authenticated key-ID v2 envelopes without modifying
-- historical v1 rows. Application AEAD validation remains authoritative.
alter table test_bench_definitions
  drop constraint if exists test_bench_definitions_cases_ciphertext_check;
alter table test_bench_definitions
  add constraint test_bench_definitions_cases_ciphertext_check
  check(length(cases_ciphertext) between 10 and 32768
    and (left(cases_ciphertext,3)='v1:'
      or cases_ciphertext ~ '^v2:[a-z][a-z0-9_-]{0,31}:'));

alter table test_bench_runs
  drop constraint if exists test_bench_runs_snapshot_ciphertext_check;
alter table test_bench_runs
  add constraint test_bench_runs_snapshot_ciphertext_check
  check(length(snapshot_ciphertext) between 10 and 32768
    and (left(snapshot_ciphertext,3)='v1:'
      or snapshot_ciphertext ~ '^v2:[a-z][a-z0-9_-]{0,31}:'));

alter table test_bench_runs
  drop constraint if exists test_bench_runs_results_ciphertext_check;
alter table test_bench_runs
  add constraint test_bench_runs_results_ciphertext_check
  check(results_ciphertext is null or (
    length(results_ciphertext) between 10 and 87650
    and (left(results_ciphertext,3)='v1:'
      or results_ciphertext ~ '^v2:[a-z][a-z0-9_-]{0,31}:')
  ));
comment on column test_bench_definitions.cases_ciphertext is
  'AES-GCM v1 legacy or v2 authenticated key-id envelope; v1 remains readable until secure rewrap.';
comment on column test_bench_runs.snapshot_ciphertext is
  'AES-GCM v1 legacy or v2 authenticated key-id envelope; caller AAD binds tenant/run/commit.';
comment on column test_bench_runs.results_ciphertext is
  'AES-GCM v1 legacy or v2 authenticated key-id envelope; never plaintext run evidence.';
