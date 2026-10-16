-- PER-1545. Additive rate-contract and conservative monetary ADMISSION accounting.
-- No live price or entitlement is seeded. Monetary estimates are not invoices.
create table if not exists test_bench_provider_rate_cards (
  id uuid primary key,
  version text not null unique check(length(version) between 1 and 80),
  status text not null default 'draft' check(status in ('draft','approved')),
  active boolean not null default false,
  currency text not null default 'USD' check(currency='USD'),
  source_uri text not null check(length(source_uri) between 12 and 1024 and source_uri like 'https://%'),
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint test_bench_rate_card_approval_check check (
    (status='draft' and approved_by is null and approved_at is null
      and not active) or
    (status='approved' and approved_by is not null
      and length(btrim(approved_by)) between 1 and 200
      and approved_at is not null)
  ),
  constraint test_bench_rate_card_window_check
    check(valid_until is null or valid_until>valid_from)
);
-- Approved contract contents remain immutable, while an operator may replace
-- the active version. Historical approved versions remain version-addressable.
create unique index if not exists test_bench_provider_one_active_rate_card
  on test_bench_provider_rate_cards(active) where active=true;
create table if not exists test_bench_provider_rate_entries (
  rate_card_id uuid not null references test_bench_provider_rate_cards(id),
  provider_code text not null check(provider_code in ('nim','jev','openai')),
  model text not null check(length(model) between 1 and 160),
  input_micro_usd_per_million bigint not null
    check(input_micro_usd_per_million between 0 and 1000000000000),
  output_micro_usd_per_million bigint not null
    check(output_micro_usd_per_million between 0 and 1000000000000),
  fixed_micro_usd_per_call bigint not null default 0
    check(fixed_micro_usd_per_call between 0 and 1000000000000),
  primary key(rate_card_id,provider_code,model),
  constraint test_bench_provider_rate_nonzero check(
    input_micro_usd_per_million+output_micro_usd_per_million+
    fixed_micro_usd_per_call>0
  )
);
create or replace function test_bench_rate_card_immutability() returns trigger
language plpgsql as $$
begin
  if TG_OP='DELETE' then
    if OLD.status='approved' then
      raise exception 'approved provider rate version immutable';
    end if;
    return OLD;
  end if;
  if OLD.status='approved' and
    (to_jsonb(NEW)-'active') is distinct from (to_jsonb(OLD)-'active') then
    raise exception 'approved provider rate version immutable';
  end if;
  return NEW;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgname='test_bench_rate_card_immutable_trg') then
    create trigger test_bench_rate_card_immutable_trg
    before update or delete on test_bench_provider_rate_cards
    for each row execute function test_bench_rate_card_immutability();
  end if;
end $$;
create or replace function test_bench_rate_entry_immutability() returns trigger
language plpgsql as $$
declare card_status text;
begin
  select status into card_status from test_bench_provider_rate_cards
  where id=case when TG_OP='DELETE' then OLD.rate_card_id else NEW.rate_card_id end
  for share;
  if card_status is distinct from 'draft' then
    raise exception 'cannot change approved or missing provider rate version';
  end if;
  if TG_OP='UPDATE' and NEW.rate_card_id<>OLD.rate_card_id then
    raise exception 'rate entry cannot move between contract versions';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgname='test_bench_rate_entry_immutable_trg') then
    create trigger test_bench_rate_entry_immutable_trg
    before insert or update or delete on test_bench_provider_rate_entries
    for each row execute function test_bench_rate_entry_immutability();
  end if;
end $$;
create table if not exists test_bench_tenant_monetary_policies (
  organization_id uuid primary key references organizations(id) on delete cascade,
  policy_revision integer not null default 1 check(policy_revision>0),
  enabled boolean not null default false,
  daily_limit_micro_usd bigint not null check(daily_limit_micro_usd between 1 and 1000000000000),
  monthly_limit_micro_usd bigint not null check(monthly_limit_micro_usd between 1 and 1000000000000),
  updated_at timestamptz not null default now(),
  constraint test_bench_monetary_limits_check
    check(monthly_limit_micro_usd>=daily_limit_micro_usd)
);
create table if not exists test_bench_tenant_monetary_days (
  organization_id uuid not null references organizations(id) on delete cascade,
  utc_day date not null,
  reserved_micro_usd bigint not null check(reserved_micro_usd between 0 and 1000000000000),
  updated_at timestamptz not null default now(),
  primary key(organization_id,utc_day)
);
create table if not exists test_bench_tenant_monetary_months (
  organization_id uuid not null references organizations(id) on delete cascade,
  utc_month date not null check(extract(day from utc_month)=1),
  reserved_micro_usd bigint not null check(reserved_micro_usd between 0 and 1000000000000),
  updated_at timestamptz not null default now(),
  primary key(organization_id,utc_month)
);
alter table test_bench_runs add column if not exists rate_card_id uuid
  references test_bench_provider_rate_cards(id);
alter table test_bench_runs add column if not exists reserved_micro_usd bigint
  not null default 0 check(reserved_micro_usd>=0 and reserved_micro_usd<=1000000000000);
alter table test_bench_runs add column if not exists judge_model_pinned text
  check(judge_model_pinned is null or length(judge_model_pinned) between 1 and 160);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='test_bench_run_monetary_reservation_pair') then
    alter table test_bench_runs add constraint test_bench_run_monetary_reservation_pair
      check((rate_card_id is null and reserved_micro_usd=0) or
        (rate_card_id is not null and reserved_micro_usd>0));
  end if;
end $$;
comment on table test_bench_provider_rate_cards is
  'Operator-approved immutable price evidence. Exactly one approved card may be active. No default is seeded.';
comment on table test_bench_tenant_monetary_days is
  'Conservative nonrefundable monetary admission reservations, NOT actual billed provider costs.';
comment on column test_bench_runs.reserved_micro_usd is
  'Conservative rate-versioned planned micro-USD admission cushion, NOT actual invoice, settled usage or guaranteed maximum provider charges.';
