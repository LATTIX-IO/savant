-- Full catalog enumeration, the safety pass policy, and the skill router.

-- Sources: Matt Pocock's skills replace the Karpathy guidelines package.
delete from skill_hub_sources where id = 'karpathy-guidelines';
insert into skill_hub_sources (id, name, kind, publisher, trust, homepage, description, config, max_skills, sort_order) values
  ('mattpocock', 'Matt Pocock skills', 'github', 'Matt Pocock', 'community', 'https://github.com/mattpocock/skills',
    'Engineering and TypeScript skills by Matt Pocock.', '{"owner":"mattpocock","repo":"skills","roots":["skills"]}'::jsonb, 100000, 40)
on conflict (id) do nothing;

-- Enumerate every listing a source has; analysis is bounded by daily budgets instead.
alter table skill_hub_sources add column if not exists enumeration jsonb not null default '{}'::jsonb;
alter table skill_hub_sources add column if not exists total_listed integer;
update skill_hub_sources set max_skills = 100000 where max_skills < 100000;

alter table hub_skills add column if not exists locator jsonb;
alter table hub_skills add column if not exists popularity_score numeric not null default 0;
alter table hub_skills add column if not exists listed_run text;
alter table hub_skills add column if not exists hydrated_at timestamptz;
alter table hub_skills drop constraint if exists hub_skills_status_check;
alter table hub_skills add constraint hub_skills_status_check check (status in ('listed', 'active', 'removed', 'fetch_failed'));
update hub_skills set hydrated_at = coalesce(hydrated_at, fetched_at) where status = 'active';
update hub_skills set popularity_score = coalesce((popularity->>'installs')::numeric, 0) + coalesce((popularity->>'downloads')::numeric, 0)
  + case when popularity ? 'installs' or popularity ? 'downloads' then 0 else coalesce((popularity->>'stars')::numeric, 0) end
  where popularity_score = 0;
create index if not exists hub_skills_backlog_idx on hub_skills (status, popularity_score desc);

create table if not exists hub_budget_usage (
  day date not null,
  kind text not null,
  used integer not null default 0,
  primary key (day, kind)
);

-- Keep in sync with 0010 (both re-run on every deploy).
alter table background_jobs drop constraint if exists background_jobs_kind_check;
alter table background_jobs add constraint background_jobs_kind_check
  check (kind in ('eval_generation', 'safety_scan', 'hub_sync', 'hub_hydrate', 'hub_safety', 'hub_eval'));

-- Safety policy: SkillSpector CAUTION below risk 20 passes (the raw result is still shown).
update hub_skill_analyses set verdict = case
    when safety->>'recommendation' = 'DO_NOT_INSTALL' then 'unsafe'
    when (safety->>'recommendation' = 'CAUTION' and coalesce((safety->>'riskScore')::numeric, 100) >= 20)
      or findings @> '[{"code":"UPSTREAM_SECURITY_FLAG"}]'::jsonb then 'caution'
    when (safety->>'recommendation' = 'SAFE' or (safety->>'recommendation' = 'CAUTION' and (safety->>'riskScore')::numeric < 20))
      and eval_status in ('complete', 'needs_review') and coalesce((eval->'scorecard'->>'overallScore')::numeric, 0) >= 70 then 'validated'
    when safety->>'recommendation' in ('SAFE', 'CAUTION') or eval_status in ('complete', 'needs_review') then 'analyzed'
    else 'unverified'
  end
where safety is not null or eval_status in ('complete', 'needs_review');

-- Live telemetry from the skill router: more runtimes.
alter table skill_runs drop constraint if exists skill_runs_runtime_check;
alter table skill_runs add constraint skill_runs_runtime_check
  check (runtime in ('openai', 'chatgpt', 'claude', 'codex', 'copilot', 'vscode', 'cursor', 'gemini', 'api', 'other'));

-- Routing decisions (which skill the router picked for a task, and how confident it was).
create table if not exists skill_route_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connector_id text,
  runtime text not null,
  client_name text,
  task_fingerprint text not null,
  candidates jsonb not null default '[]'::jsonb,
  chosen_skill_id text,
  confidence numeric,
  method text not null,
  run_id text,
  created_at timestamptz not null default now()
);
create index if not exists skill_route_decisions_org_idx on skill_route_decisions (organization_id, created_at desc);
