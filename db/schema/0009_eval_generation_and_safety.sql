-- Background work that runs after a sync: generating evaluations for skills
-- that have none (LLM drafts, Jev validates, LLM executes, Jev scores) and
-- scanning skill packages for security risks with NVIDIA SkillSpector.

-- A small lease-based queue. Work runs in `after()` callbacks bounded by the
-- route's max duration; an expired lease lets the next trigger pick it up.
create table if not exists background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid references repositories(id) on delete cascade,
  kind text not null check (kind in ('eval_generation', 'safety_scan')),
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed')),
  attempts integer not null default 0,
  lease_until timestamptz,
  progress jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- One live job per key (e.g. one scan per repository commit, one generation per skill).
create unique index if not exists background_jobs_live_key
  on background_jobs (organization_id, kind, dedupe_key)
  where status in ('queued', 'running');

create index if not exists background_jobs_claim_idx
  on background_jobs (status, created_at);

create table if not exists eval_generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  job_id uuid references background_jobs(id) on delete set null,
  skill_id text not null,
  source_path text not null,
  commit_sha text,
  mode text not null check (mode in ('generate', 'alignment')),
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'needs_review', 'failed')),
  trigger text not null default 'manual',
  requested_by text not null,
  rounds integer not null default 0,
  -- Every drafted case with Jev's validation answers and the decision taken.
  cases jsonb not null default '[]'::jsonb,
  -- Executed, Jev-scored samples in the repository's dataset format.
  samples jsonb not null default '[]'::jsonb,
  scorecard jsonb,
  -- Comparison with a committed answer key, when the skill has one.
  alignment jsonb,
  files jsonb not null default '[]'::jsonb,
  proposal_id uuid references repository_change_proposals(id) on delete set null,
  models jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists eval_generation_runs_skill_idx
  on eval_generation_runs (organization_id, skill_id, created_at desc);

create table if not exists skill_safety_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  repository_id uuid not null references repositories(id) on delete cascade,
  skill_id text not null,
  source_path text not null,
  commit_sha text not null,
  package_fingerprint text not null,
  status text not null check (status in ('complete', 'failed', 'unavailable')),
  risk_score integer,
  severity text,
  recommendation text,
  issues jsonb not null default '[]'::jsonb,
  llm_used boolean not null default false,
  scanner_version text,
  error text,
  scanned_at timestamptz not null default now()
);

create index if not exists skill_safety_scans_latest_idx
  on skill_safety_scans (repository_id, source_path, scanned_at desc);
