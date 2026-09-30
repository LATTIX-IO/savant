-- Import-time evaluation results: the full scorecard and per-case results the
-- repository's evaluation dataset produces, so the first sync establishes the
-- baseline Skill Intelligence and SkillOpt compare against.

alter table indexed_eval_results add column if not exists overall_score numeric(6, 2);
alter table indexed_eval_results add column if not exists scorecard jsonb;
alter table indexed_eval_results add column if not exists case_results jsonb not null default '[]'::jsonb;
alter table indexed_eval_results add column if not exists source text not null default 'external';

create index if not exists indexed_eval_results_skill_latest_idx
  on indexed_eval_results (indexed_skill_id, indexed_at desc);
