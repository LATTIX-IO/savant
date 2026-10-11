-- PER-1082: rebuildable version/provenance index for tenant-authored WorkflowSpecifications.
-- Git owns complete workflow documents; this table MUST NOT store their content.
create table if not exists workflow_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  workflow_id varchar(80) not null check (length(workflow_id) > 0),
  specification_version varchar(80) not null,
  source_commit_sha varchar(64) not null,
  content_blob_sha varchar(64) not null,
  canonical_digest varchar(64) not null check (canonical_digest ~ '^[0-9a-f]{64}$'),
  actor_subject text not null,
  indexed_at timestamptz not null default now(),
  unique (organization_id, repository_id, workflow_id, source_commit_sha)
);

create index if not exists workflow_artifact_versions_latest_idx
  on workflow_artifact_versions (organization_id, repository_id, workflow_id, indexed_at desc);

-- For existing installations no backfill is required; indexes are rebuilt by
-- reading workflows/*.json at Git revisions. Never infer history from skill rows.
comment on table workflow_artifact_versions is
  'Rebuildable tenant Git workflow metadata only. Complete specifications and native provider payloads remain in tenant Git.';
