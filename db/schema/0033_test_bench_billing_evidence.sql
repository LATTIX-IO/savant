-- PER-1547 / 7A: platform-account billing evidence ONLY.
-- This is an unverified import ledger, not provider-authenticated invoices,
-- per-tenant charges, confirmed settlement or a provider spending cap.
create table if not exists test_bench_billing_periods (
  provider_code text not null check(provider_code in ('nim','jev')),
  account_sha256 text not null check(account_sha256 ~ '^[0-9a-f]{64}$'),
  utc_month date not null check(extract(day from utc_month)=1),
  frozen_at timestamptz,
  frozen_by text,
  constraint test_bench_billing_period_freeze_pair
    check((frozen_at is null)=(frozen_by is null)),
  primary key(provider_code,account_sha256,utc_month)
);
create table if not exists test_bench_billing_documents (
  id uuid primary key,
  provider_code text not null check(provider_code in ('nim','jev')),
  account_sha256 text not null check(account_sha256 ~ '^[0-9a-f]{64}$'),
  utc_month date not null check(extract(day from utc_month)=1),
  statement_ref text not null
    check(statement_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  document_sha256 text not null check(document_sha256 ~ '^[0-9a-f]{64}$'),
  source_kind text not null check(source_kind in ('invoice','rated_usage')),
  issued_at timestamptz not null,
  currency text not null default 'USD' check(currency='USD'),
  provenance text not null default 'unverified'
    check(provenance='unverified'),
  imported_by text not null check(length(btrim(imported_by)) between 1 and 200),
  imported_at timestamptz not null default now(),
  foreign key(provider_code,account_sha256,utc_month)
    references test_bench_billing_periods(provider_code,account_sha256,utc_month)
    on delete restrict,
  unique(provider_code,account_sha256,statement_ref),
  unique(provider_code,account_sha256,document_sha256),
  unique(id,provider_code,account_sha256,utc_month)
);
create index if not exists test_bench_billing_document_period
  on test_bench_billing_documents(provider_code,account_sha256,utc_month,imported_at);
create table if not exists test_bench_billing_lines (
  id uuid primary key,
  document_id uuid not null,
  provider_code text not null check(provider_code in ('nim','jev')),
  account_sha256 text not null check(account_sha256 ~ '^[0-9a-f]{64}$'),
  utc_month date not null check(extract(day from utc_month)=1),
  line_ref text not null
    check(line_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  model text not null check(length(btrim(model)) between 1 and 160),
  line_kind text not null check(line_kind in ('charge','credit')),
  amount_micro_usd bigint not null
    check(amount_micro_usd between -1000000000000 and 1000000000000
      and amount_micro_usd<>0),
  corrects_line_id uuid,
  created_at timestamptz not null default now(),
  constraint test_bench_billing_line_sign check(
    (line_kind='charge' and amount_micro_usd>0 and corrects_line_id is null)
    or
    (line_kind='credit' and amount_micro_usd<0 and corrects_line_id is not null)
  ),
  unique(document_id,line_ref),
  unique(id,provider_code,account_sha256),
  foreign key(document_id,provider_code,account_sha256,utc_month)
    references test_bench_billing_documents(id,provider_code,account_sha256,utc_month)
    on delete restrict,
  foreign key(corrects_line_id,provider_code,account_sha256)
    references test_bench_billing_lines(id,provider_code,account_sha256)
    on delete restrict
);
create index if not exists test_bench_billing_lines_model
  on test_bench_billing_lines(provider_code,account_sha256,utc_month,model);
create index if not exists test_bench_billing_lines_corrections
  on test_bench_billing_lines(corrects_line_id) where corrects_line_id is not null;

-- These are immutable source records; corrections are new documents/lines.
create or replace function test_bench_billing_source_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'billing source evidence is append-only';
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger
    where tgname='test_bench_billing_document_immutable_trg') then
    create trigger test_bench_billing_document_immutable_trg
      before update or delete on test_bench_billing_documents
      for each row execute function test_bench_billing_source_immutable();
  end if;
  if not exists(select 1 from pg_trigger
    where tgname='test_bench_billing_line_immutable_trg') then
    create trigger test_bench_billing_line_immutable_trg
      before update or delete on test_bench_billing_lines
      for each row execute function test_bench_billing_source_immutable();
  end if;
end $$;
comment on table test_bench_billing_documents is
  'Unverified operator-provided platform account source digests. Not authenticated with any provider and never tenant-attributed.';
comment on table test_bench_billing_lines is
  'Unverified account-level USD micro-unit lines; cannot confirm per-run cost without provider request-level attestation.';
comment on table test_bench_billing_periods is
  'Period freeze prevents further source ingestion; it is NOT provider invoice settlement or financial close.';
