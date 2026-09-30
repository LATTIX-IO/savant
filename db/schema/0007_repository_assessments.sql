-- Post-sync repository assessments, finding dismissals, and change proposals
-- that are written back to the tenant repository as pull requests.

create table if not exists repository_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  commit_sha text not null,
  summary jsonb not null,
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists repository_assessments_latest_idx
  on repository_assessments (organization_id, repository_id, created_at desc);

-- Dismissals are keyed on the finding fingerprint so they survive re-syncs.
create table if not exists assessment_finding_dismissals (
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  fingerprint text not null,
  dismissed_by text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (repository_id, fingerprint)
);

create table if not exists repository_change_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  connection_id uuid references git_provider_connections(id) on delete set null,
  title text not null,
  body text not null default '',
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'opening_pr', 'pr_open', 'merged', 'closed', 'failed', 'rejected')),
  files jsonb not null,
  finding_fingerprints jsonb not null default '[]'::jsonb,
  base_branch text not null,
  base_commit_sha text,
  head_branch text,
  pull_request_number integer,
  pull_request_url text,
  error text,
  created_by text not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists repository_change_proposals_repo_idx
  on repository_change_proposals (organization_id, repository_id, created_at desc);

comment on table repository_change_proposals is
  'Savant-generated repository changes. Nothing is written to the repository until a Savant admin or repository manager approves; approval opens a pull request so the repository''s own branch protection and review rules apply.';
