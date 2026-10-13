-- PER-1438: explicit tenant-owned OpenAI Test Bench execution; preserve old platform jobs.
-- Credential material remains encrypted in ai_connection_secrets, never copied to run rows.
alter table test_bench_runs
  add column if not exists execution_source text not null default 'platform-nim';
alter table test_bench_runs
  add column if not exists execution_connection_id uuid;
alter table test_bench_runs
  add column if not exists execution_secret_fingerprint text;
alter table test_bench_runs
  add column if not exists execution_model_pinned text;
alter table test_bench_runs
  add column if not exists cost_accounting text not null default 'platform-estimate';

create unique index if not exists ai_connections_tenant_composite_ref
  on ai_connections(organization_id,id);

alter table test_bench_runs drop constraint if exists test_bench_runs_execution_source_check;
alter table test_bench_runs add constraint test_bench_runs_execution_source_check
  check (execution_source in ('platform-nim','workspace-openai'));

alter table test_bench_runs drop constraint if exists test_bench_runs_cost_accounting_check;
alter table test_bench_runs add constraint test_bench_runs_cost_accounting_check
  check (cost_accounting in ('platform-estimate','normalized-qa-proxy'));

alter table test_bench_runs drop constraint if exists test_bench_runs_source_integrity;
alter table test_bench_runs add constraint test_bench_runs_source_integrity check (
  (execution_source='platform-nim'
    and execution_connection_id is null
    and execution_secret_fingerprint is null
    and execution_model_pinned is null
    and cost_accounting='platform-estimate')
  or
  (execution_source='workspace-openai'
    and execution_connection_id is not null
    and execution_secret_fingerprint ~ '^[0-9a-f]{64}$'
    and length(execution_model_pinned) between 1 and 160
    and cost_accounting='normalized-qa-proxy')
);

alter table test_bench_runs drop constraint if exists test_bench_runs_tenant_execution_connection_fk;
alter table test_bench_runs add constraint test_bench_runs_tenant_execution_connection_fk
  foreign key (organization_id,execution_connection_id)
  references ai_connections(organization_id,id) on delete restrict;

create index if not exists test_bench_runs_tenant_openai_connection
  on test_bench_runs(organization_id,execution_connection_id,created_at desc)
  where execution_source='workspace-openai';

comment on column test_bench_runs.execution_secret_fingerprint is
  'Admission-time credential fingerprint only, never encrypted or plaintext API key. Worker denies rotation and revocation.';
comment on column test_bench_runs.cost_accounting is
  'normalized-qa-proxy is a fixed benchmark token-equivalent, not actual provider pricing or a monetary spend cap.';
