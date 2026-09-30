-- Public skill catalog: skills pulled from reputable hubs and repositories
-- (Anthropic, OpenAI, skills.sh, ClawHub, SkillsMP, ...), analysed once by
-- the platform (static checks, SkillSpector safety scan, LLM↔Jev live
-- evaluation), shown read-only on the public site and importable into any
-- tenant's connected repository. Catalog rows are platform-level: no tenant.

create table if not exists skill_hub_sources (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('github', 'skills_sh', 'clawhub', 'skillsmp')),
  publisher text not null,
  trust text not null check (trust in ('official', 'verified', 'community')),
  homepage text,
  description text,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  max_skills integer not null default 40,
  sort_order integer not null default 100,
  skill_count integer not null default 0,
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists hub_skills (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references skill_hub_sources(id) on delete cascade,
  external_id text not null,
  -- Same upstream skill listed by several hubs (e.g. github:owner/repo/path).
  canonical_key text,
  slug text not null,
  name text not null,
  description text,
  publisher text,
  source_url text,
  repository text,
  path text,
  version text,
  license text,
  popularity jsonb not null default '{}'::jsonb,
  rank integer,
  tags text[] not null default array[]::text[],
  upstream_security jsonb,
  content_hash text,
  skill_md text,
  files jsonb not null default '[]'::jsonb,
  file_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'removed', 'fetch_failed')),
  fetch_error text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists hub_skills_listing_idx on hub_skills (status, rank);
create index if not exists hub_skills_canonical_idx on hub_skills (canonical_key);

create table if not exists hub_skill_files (
  hub_skill_id uuid not null references hub_skills(id) on delete cascade,
  path text not null,
  content text not null,
  primary key (hub_skill_id, path)
);

create table if not exists hub_skill_analyses (
  hub_skill_id uuid primary key references hub_skills(id) on delete cascade,
  content_hash text,
  findings jsonb not null default '[]'::jsonb,
  safety jsonb,
  safety_hash text,
  safety_scanned_at timestamptz,
  eval_status text not null default 'none' check (eval_status in ('none', 'queued', 'running', 'complete', 'needs_review', 'failed')),
  eval_hash text,
  eval jsonb,
  eval_files jsonb not null default '[]'::jsonb,
  eval_error text,
  evaluated_at timestamptz,
  verdict text not null default 'unverified' check (verdict in ('validated', 'analyzed', 'caution', 'unsafe', 'unverified')),
  updated_at timestamptz not null default now()
);

-- Platform-level background jobs (no tenant) for catalog sync and analysis.
alter table background_jobs alter column organization_id drop not null;
-- Migrations are re-applied on every deploy, so this must list every job kind
-- (a narrower list would reject rows created by later migrations' job kinds).
alter table background_jobs drop constraint if exists background_jobs_kind_check;
alter table background_jobs add constraint background_jobs_kind_check
  check (kind in ('eval_generation', 'safety_scan', 'hub_sync', 'hub_hydrate', 'hub_safety', 'hub_eval'));
create unique index if not exists background_jobs_platform_live_key
  on background_jobs (kind, dedupe_key)
  where organization_id is null and status in ('queued', 'running');

insert into skill_hub_sources (id, name, kind, publisher, trust, homepage, description, config, max_skills, sort_order) values
  ('anthropic', 'Anthropic Agent Skills', 'github', 'Anthropic', 'official', 'https://github.com/anthropics/skills',
    'Anthropic''s official Agent Skills repository.', '{"owner":"anthropics","repo":"skills","roots":["skills"]}'::jsonb, 60, 10),
  ('openai', 'OpenAI Codex Skills', 'github', 'OpenAI', 'official', 'https://github.com/openai/skills',
    'OpenAI''s curated Codex skills catalog.', '{"owner":"openai","repo":"skills","roots":["skills/.curated","skills/.system"]}'::jsonb, 60, 20),
  ('openai-plugins', 'OpenAI Codex Plugins', 'github', 'OpenAI', 'official', 'https://github.com/openai/plugins',
    'Skills shipped in OpenAI''s Codex plugins repository.', '{"owner":"openai","repo":"plugins","roots":["plugins",".agents/skills"]}'::jsonb, 40, 30),
  ('karpathy-guidelines', 'Karpathy coding guidelines', 'github', 'multica-ai (community)', 'community', 'https://github.com/multica-ai/andrej-karpathy-skills',
    'Community skill packaging Andrej Karpathy''s coding-agent guidelines.', '{"owner":"multica-ai","repo":"andrej-karpathy-skills","roots":["skills"]}'::jsonb, 10, 40),
  ('skills-sh', 'skills.sh', 'skills_sh', 'Vercel', 'verified', 'https://skills.sh',
    'The open Agent Skills directory, ranked by installs, with partner security audits.', '{"view":"all-time"}'::jsonb, 60, 50),
  ('clawhub', 'ClawHub', 'clawhub', 'OpenClaw', 'community', 'https://clawhub.ai',
    'The OpenClaw skill registry, ranked by downloads, excluding skills it flags as suspicious.', '{"sort":"downloads"}'::jsonb, 40, 60),
  ('skillsmp', 'SkillsMP', 'skillsmp', 'SkillsMP', 'community', 'https://skillsmp.com',
    'Community marketplace indexing SKILL.md files across GitHub, ranked by stars.', '{"queries":["agent","code review","data analysis","security","documentation"]}'::jsonb, 30, 70)
on conflict (id) do nothing;
