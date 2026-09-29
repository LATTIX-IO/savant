-- Skill Intelligence: run telemetry, health, optimization, and governed
-- improvement recommendations.
--
-- These tables are canonical control-plane state and are intentionally kept
-- separate from the Git-derived skill/version index tables. An approved
-- recommendation never writes here into a "production" skill: it becomes a
-- normal release_requests row and follows the existing release rail.
--
-- Large text (inputs, outputs, trajectories) is stored encrypted in
-- skill_run_artifacts, referenced by storage_ref, never inline on skill_runs.

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

create table if not exists optimization_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope_type text not null check (scope_type in ('organization', 'skill')),
  scope_ref text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, scope_type, scope_ref)
);

comment on table optimization_configs is
  'Tenant and per-skill telemetry capture, retention, auto-optimization mode, change budget, evidence thresholds, and allowed optimizer providers.';

create table if not exists telemetry_ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  connector_id text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_used_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table telemetry_ingest_tokens is
  'Tenant-scoped bearer tokens for run telemetry ingestion. Only SHA-256 hashes are stored.';

-- ---------------------------------------------------------------------------
-- Run telemetry
-- ---------------------------------------------------------------------------

create table if not exists skill_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id text not null,
  skill_id text not null,
  skill_version_id text not null,
  connector_id text not null,
  runtime text not null check (runtime in ('openai', 'claude', 'codex', 'copilot', 'vscode', 'api', 'other')),
  model text,
  telemetry_level text not null check (telemetry_level in ('full', 'io', 'outcome')),
  started_at timestamptz not null,
  completed_at timestamptz,
  success boolean,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric(12, 6),
  task_archetype text,
  input_structure text check (input_structure in ('structured', 'unstructured')),
  business_unit text,
  -- Raw identity is permission-controlled; analytics default to the pseudonym.
  actor_user_ref text,
  actor_pseudonym text,
  group_ids text[] not null default array[]::text[],
  input_fingerprint text,
  feedback jsonb not null default '{}'::jsonb,
  policy jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  unique (organization_id, run_id)
);

create index if not exists skill_runs_org_skill_started_idx
  on skill_runs (organization_id, skill_id, started_at desc);

create index if not exists skill_runs_expires_idx
  on skill_runs (expires_at);

create table if not exists skill_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  skill_run_id uuid not null references skill_runs(id) on delete cascade,
  artifact_kind text not null check (artifact_kind in ('input', 'output', 'trajectory')),
  storage_backend text not null default 'postgres-encrypted',
  storage_ref text not null unique,
  encrypted_payload text,
  content_hash text not null,
  byte_size integer not null,
  key_version smallint not null default 1,
  redaction_summary jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (skill_run_id, artifact_kind)
);

comment on table skill_run_artifacts is
  'Redacted, encrypted run payloads. storage_backend allows migration to object storage without changing skill_runs.';

create table if not exists skill_feedback (
  id uuid primary key default gen_random_uuid(),
  skill_run_id uuid not null references skill_runs(id) on delete cascade,
  kind text not null check (kind in ('passive', 'explicit')),
  signal text,
  categories text[] not null default array[]::text[],
  rating smallint check (rating between 1 and 5),
  edit_ratio numeric(5, 4) check (edit_ratio between 0 and 1),
  comment_redacted text,
  reporter_role text not null default 'user' check (reporter_role in ('user', 'sme', 'system')),
  rubric_dimension text,
  -- Raw events are canonical; derived_score is recomputable as weighting evolves.
  derived_score numeric(5, 4) not null,
  weighting_version smallint not null default 1,
  recorded_at timestamptz not null default now()
);

create index if not exists skill_feedback_run_idx on skill_feedback (skill_run_id);

create table if not exists skill_outcomes (
  id uuid primary key default gen_random_uuid(),
  skill_run_id uuid not null references skill_runs(id) on delete cascade,
  output_score numeric(6, 2),
  human_accepted boolean,
  task_outcome text not null check (task_outcome in ('succeeded', 'failed', 'unknown')),
  outcome_label text,
  recorded_at timestamptz not null default now()
);

create index if not exists skill_outcomes_run_idx on skill_outcomes (skill_run_id);

-- ---------------------------------------------------------------------------
-- Derived intelligence (recomputable from runs + feedback)
-- ---------------------------------------------------------------------------

create table if not exists skill_failure_clusters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id text not null,
  cluster_key text not null,
  label text not null,
  basis text not null check (basis in ('feedback-category', 'rubric-dimension', 'metadata', 'text-similarity')),
  run_count integer not null,
  distinct_tasks integer not null,
  runtimes text[] not null default array[]::text[],
  example_run_ids text[] not null default array[]::text[],
  window_start timestamptz not null,
  window_end timestamptz not null,
  computed_at timestamptz not null default now(),
  unique (organization_id, skill_id, cluster_key, window_end)
);

create table if not exists skill_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id text not null,
  composite numeric(5, 2),
  dimensions jsonb not null default '[]'::jsonb,
  cohorts jsonb not null default '[]'::jsonb,
  run_count integer not null,
  full_trajectory_coverage numeric(5, 2) not null,
  computed_at timestamptz not null default now()
);

create index if not exists skill_health_snapshots_org_skill_idx
  on skill_health_snapshots (organization_id, skill_id, computed_at desc);

-- ---------------------------------------------------------------------------
-- Optimization
-- ---------------------------------------------------------------------------

create table if not exists optimization_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id text not null,
  base_version text not null,
  trigger text not null check (trigger in ('performance-degradation', 'failure-cluster', 'high-edit-rate', 'new-environment', 'scheduled', 'manual')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  objective jsonb not null,
  change_budget jsonb not null,
  optimizer_provider text not null,
  requested_by uuid references users(id) on delete set null,
  parent_recommendation_id uuid,
  lease_token_hash text,
  lease_expires_at timestamptz,
  attempt integer not null default 0,
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists optimization_jobs_status_idx
  on optimization_jobs (status, queued_at);

create unique index if not exists optimization_jobs_one_active_per_skill
  on optimization_jobs (organization_id, skill_id)
  where status in ('queued', 'running');

create table if not exists optimization_datasets (
  id uuid primary key default gen_random_uuid(),
  optimization_job_id uuid not null references optimization_jobs(id) on delete cascade,
  partition text not null check (partition in ('train', 'validation', 'regression', 'holdout')),
  case_count integer not null,
  run_ids text[] not null default array[]::text[],
  dataset_hash text not null,
  curation_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (optimization_job_id, partition)
);

comment on table optimization_datasets is
  'Curated dataset partitions per job. Holdout run ids are never included in the bundle sent to the optimizer sandbox.';

create table if not exists optimization_candidates (
  id uuid primary key default gen_random_uuid(),
  optimization_job_id uuid not null references optimization_jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id text not null,
  base_content_hash text not null,
  candidate_content text not null,
  candidate_content_hash text not null,
  edits jsonb not null default '[]'::jsonb,
  provenance jsonb not null,
  origin text not null default 'optimizer' check (origin in ('optimizer', 'human-modified')),
  created_at timestamptz not null default now()
);

create table if not exists candidate_evaluations (
  id uuid primary key default gen_random_uuid(),
  optimization_candidate_id uuid not null references optimization_candidates(id) on delete cascade,
  candidate_content_hash text not null,
  validation jsonb not null,
  passed boolean not null,
  evaluated_at timestamptz not null default now()
);

create table if not exists improvement_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_id text not null,
  optimization_job_id uuid references optimization_jobs(id) on delete set null,
  optimization_candidate_id uuid references optimization_candidates(id) on delete set null,
  base_version text not null,
  candidate_version text,
  trigger text not null,
  status text not null default 'generated' check (status in ('generated', 'evaluating', 'ready-for-review', 'approved', 'rejected', 'superseded')),
  requires_reevaluation boolean not null default false,
  required_approvals smallint not null default 1,
  priority_score numeric(10, 4) not null default 0,
  payload jsonb not null,
  release_request_id uuid references release_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists improvement_recommendations_org_status_idx
  on improvement_recommendations (organization_id, status, priority_score desc);

create index if not exists improvement_recommendations_org_skill_idx
  on improvement_recommendations (organization_id, skill_id, created_at desc);

create table if not exists recommendation_reviews (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references improvement_recommendations(id) on delete cascade,
  reviewer_user_id uuid references users(id) on delete set null,
  reviewer_ref text not null,
  reviewer_role text not null,
  decision text not null check (decision in ('approve', 'reject', 'modify', 'request-more-testing')),
  reasons text[] not null default array[]::text[],
  comment text,
  edit_decisions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table recommendation_reviews is
  'Reviewer decisions. Rejection reasons inform future optimization runs as structured signals; rejection prose is never fed into skill content.';
