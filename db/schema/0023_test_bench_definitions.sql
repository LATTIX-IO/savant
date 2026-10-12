-- PER-1422: persistent encrypted test case definitions; no execution and no
-- plaintext case inputs or outputs in PostgreSQL, jobs, or audit payloads.
-- 0023 follows 0015-0022 harness migrations on the parallel PER-1059 stack.
create unique index if not exists repositories_org_id_unique_for_test_bench
  on repositories (organization_id,id);

create table if not exists test_bench_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null,
  skill_id text not null check (length(skill_id) between 1 and 300),
  source_path text not null check (length(source_path) between 1 and 1024),
  source_commit_sha text not null check (
    source_commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'
  ),
  name text not null check (length(name) between 1 and 100),
  cases_ciphertext text not null check (
    length(cases_ciphertext) between 10 and 32768
    and left(cases_ciphertext,3)='v1:'
  ),
  revision integer not null default 1 check (revision >= 1),
  create_request_id uuid not null,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint test_bench_repository_tenant_fk
    foreign key (organization_id,repository_id)
    references repositories (organization_id,id) on delete cascade,
  constraint test_bench_request_id_unique
    unique (organization_id,create_request_id)
);

create index if not exists test_bench_skill_active_idx
  on test_bench_definitions (organization_id,skill_id,updated_at desc)
  where archived_at is null;

create index if not exists test_bench_repo_active_idx
  on test_bench_definitions (organization_id,repository_id,source_commit_sha)
  where archived_at is null;

comment on table test_bench_definitions is
  'Only tenant-bound AES-256-GCM encrypted bounded case definitions. No runtime evidence, no generated scores. Authenticated via service layer.';
