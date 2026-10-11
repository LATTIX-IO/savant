-- PER-1203: serialized policy administration with monotonic revisions and retry-safe receipts.
-- Authored skills/workflows remain Git-owned; no source content or secrets in these tables.
create table if not exists capability_artifact_policy_revisions (
  organization_id uuid not null,
  repository_id uuid not null,
  artifact_kind text not null check (artifact_kind in ('skill','workflow_spec')),
  artifact_id text not null check (length(artifact_id) between 1 and 128),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id,repository_id,artifact_kind,artifact_id),
  foreign key (organization_id,repository_id)
    references repositories (organization_id,id) on delete cascade
);
create table if not exists capability_artifact_policy_requests (
  organization_id uuid not null,
  repository_id uuid not null,
  artifact_kind text not null,
  artifact_id text not null,
  request_id uuid not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  resulting_revision bigint not null check (resulting_revision >= 0),
  changed boolean not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,repository_id,artifact_kind,artifact_id,request_id),
  foreign key (organization_id,repository_id,artifact_kind,artifact_id)
    references capability_artifact_policy_revisions
      (organization_id,repository_id,artifact_kind,artifact_id) on delete cascade
);
create index if not exists capability_artifact_policy_requests_created_idx
  on capability_artifact_policy_requests (organization_id,created_at);
comment on table capability_artifact_policy_requests is
  'Idempotent policy mutation receipts: digest and revision only; no content, credentials or direct principal data.';
