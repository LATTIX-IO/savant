-- PER-1457: durable PRE-EGRESS intent, not proof a provider executed/billed.
-- A missing provider usage ACK means UNCERTAIN impact, never zero cost.
create table if not exists test_bench_provider_call_intents (
  organization_id uuid not null,
  run_id uuid not null,
  job_id uuid not null,
  case_index integer not null check (case_index between 1 and 4),
  phase text not null check (phase in ('executor','judge')),
  provider_code text not null check (provider_code in ('nim','openai','jev')),
  recorded_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  constraint test_bench_provider_intent_phase_provider_check check (
    (phase='judge' and provider_code='jev') or
    (phase='executor' and provider_code in ('nim','openai'))
  ),
  constraint test_bench_provider_intent_ack_after_record_check check (
    acknowledged_at is null or acknowledged_at>=recorded_at
  ),
  constraint test_bench_provider_call_intents_pkey
    primary key(organization_id,run_id,case_index,phase),
  constraint test_bench_provider_call_intents_tenant_run_fk
    foreign key(organization_id,run_id)
      references test_bench_runs(organization_id,id) on delete cascade
);
create index if not exists test_bench_provider_intents_pending
  on test_bench_provider_call_intents(organization_id,run_id)
  where acknowledged_at is null;
comment on table test_bench_provider_call_intents is
  'Pre-network metadata-only dispatch intents; NOT actual provider calls, billable usage, tokens, invoice, proof of delivery or dollars. An unmatched intent indicates unresolved external side effects.';
comment on column test_bench_provider_call_intents.acknowledged_at is
  'Set only in the same transaction as a validated provider-reported usage receipt. Null means usage confirmation is unavailable; cost cannot be inferred.';
