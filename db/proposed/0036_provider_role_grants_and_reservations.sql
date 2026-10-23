-- PER-1602 staged DDL: DO NOT place under db/schema before PER-1592.
-- No production migrations, grants, provider entitlements or rates are seeded.
-- Use only after a witnessed encrypted backup + isolated restore and approved operator run.

-- Scope composite foreign keys to prevent foreign-tenant role/grant references.
create unique index if not exists users_org_id_provider_role_fk on users(organization_id,id);
create unique index if not exists ai_connections_org_id_provider_type_role_fk
  on ai_connections(organization_id,id,provider_type);

-- Separate approved provider-specific price references; no default tariff seeded.
create table if not exists ai_provider_role_rates (
  id uuid primary key default gen_random_uuid(),
  provider_type text not null check(provider_type in ('openai','anthropic','azure-openai','openai-compatible')),
  model text not null check(length(btrim(model)) between 1 and 160),
  revision text not null check(length(btrim(revision)) between 1 and 160),
  input_micro_usd_per_million bigint not null check(input_micro_usd_per_million between 0 and 1000000000000),
  cache_write_micro_usd_per_million bigint not null check(cache_write_micro_usd_per_million between 0 and 1000000000000),
  cache_read_micro_usd_per_million bigint not null check(cache_read_micro_usd_per_million between 0 and 1000000000000),
  output_micro_usd_per_million bigint not null check(output_micro_usd_per_million between 0 and 1000000000000),
  fixed_micro_usd_per_call bigint not null default 0 check(fixed_micro_usd_per_call between 0 and 1000000000000),
  source_uri text not null check(source_uri like 'https://%' and length(source_uri) between 12 and 1024),
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check(status in ('draft','approved','revoked')),
  approved_by uuid references users(id) on delete restrict,
  approved_at timestamptz,
  valid_from timestamptz not null,
  valid_until timestamptz,
  constraint ai_provider_rate_approval_check check(status<>'approved' or
    (approved_by is not null and approved_at is not null)),
  constraint ai_provider_rate_window_check check(valid_until is null or valid_until>valid_from),
  unique(provider_type,model,revision)
);

-- Activated rate content is immutable; a revoked rate cannot be restored.
create or replace function ai_provider_role_rate_immutability() returns trigger
language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception 'approved provider rate immutable'; end if;
    return old;
  end if;
  if old.status='revoked' then raise exception 'revoked provider rate immutable'; end if;
  if old.status='approved' and not (
    new.status='revoked' and
    (to_jsonb(new)-'status')=(to_jsonb(old)-'status')) then
    raise exception 'approved provider rate immutable';
  end if;
  return new;
end $$;
drop trigger if exists ai_provider_role_rate_immutable_trg on ai_provider_role_rates;
create trigger ai_provider_role_rate_immutable_trg
before update or delete on ai_provider_role_rates for each row
execute function ai_provider_role_rate_immutability();

create table if not exists ai_provider_role_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null,
  provider_type text not null check (provider_type in ('openai','anthropic','azure-openai','openai-compatible')),
  role text not null check(role in ('evaluation-executor','evaluation-judge','production-serving')),
  model text not null check(length(btrim(model)) between 1 and 160),
  credential_mode text not null check(credential_mode in ('api-key','workload-federation','approved-delegated-oauth')),
  secret_fingerprint text not null check(secret_fingerprint ~ '^[a-f0-9]{64}$'),
  key_version integer not null check(key_version>0),
  pricing_revision text not null check(length(btrim(pricing_revision)) between 1 and 160),
  billing_owner text not null check(length(btrim(billing_owner)) between 1 and 160),
  max_tokens_per_call integer not null check(max_tokens_per_call between 1 and 1000000),
  max_micro_usd_per_call bigint not null check(max_micro_usd_per_call between 1 and 1000000000000),
  daily_cap_micro_usd bigint not null check(daily_cap_micro_usd between 1 and 1000000000000),
  monthly_cap_micro_usd bigint not null check(monthly_cap_micro_usd between 1 and 1000000000000),
  status text not null default 'draft' check(status in ('draft','active','revoked')),
  approved_by uuid,
  approved_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_provider_role_grants_limits check(
    max_micro_usd_per_call<=daily_cap_micro_usd and daily_cap_micro_usd<=monthly_cap_micro_usd),
  constraint ai_provider_role_grants_active_approval check(
    status<>'active' or (approved_by is not null and approved_at is not null and
      verified_at is not null)),
  constraint ai_provider_role_grants_time check(expires_at is null or (verified_at is not null and expires_at>verified_at)),
  constraint ai_provider_role_grants_approved_rate_fk foreign key(provider_type,model,pricing_revision)
    references ai_provider_role_rates(provider_type,model,revision) on delete restrict,
  constraint ai_provider_role_grants_revoked_at check(status<>'revoked' or revoked_at is not null),
  constraint ai_provider_role_grants_same_tenant_approver_fk
    foreign key(organization_id,approved_by) references users(organization_id,id) on delete restrict,
  constraint ai_provider_role_grants_tenant_connection_fk
    foreign key(organization_id,connection_id,provider_type)
    references ai_connections(organization_id,id,provider_type) on delete restrict,
  unique(organization_id,id),
  unique(organization_id,id,role)
);

-- Active grants may only be revoked; never rotate a key or increase caps
-- in-place. New credentials/rates need a new independently approved grant.
create or replace function ai_provider_role_grant_immutability() returns trigger
language plpgsql as $$
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception 'activated provider grant immutable'; end if;
    return old;
  end if;
  if old.status='revoked' then raise exception 'revoked provider grant immutable'; end if;
  if old.status='active' and not (
    new.status='revoked' and new.revoked_at is not null and
    (to_jsonb(new)-'status'-'revoked_at'-'updated_at')=
    (to_jsonb(old)-'status'-'revoked_at'-'updated_at')) then
    raise exception 'activated provider grant immutable';
  end if;
  return new;
end $$;
drop trigger if exists ai_provider_role_grant_immutable_trg on ai_provider_role_grants;
create trigger ai_provider_role_grant_immutable_trg
before update or delete on ai_provider_role_grants for each row
execute function ai_provider_role_grant_immutability();

-- A default role is an independent pointer. Never infer it from legacy
-- is_default_execution / is_default_judge or a provider subscription.
create table if not exists ai_provider_role_defaults (
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null check(role in ('evaluation-executor','evaluation-judge','production-serving')),
  grant_id uuid not null,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key(organization_id,role),
  foreign key(organization_id,updated_by) references users(organization_id,id) on delete restrict,
  foreign key(organization_id,grant_id,role)
    references ai_provider_role_grants(organization_id,id,role) on delete restrict
);

-- Actor permission is explicit and revocable, with composite tenant FKs.
create table if not exists ai_provider_role_actor_grants (
  organization_id uuid not null,
  grant_id uuid not null,
  user_id uuid not null,
  authorized_by uuid,
  authorized_at timestamptz not null default now(),
  primary key(organization_id,grant_id,user_id),
  foreign key(organization_id,authorized_by) references users(organization_id,id) on delete restrict,
  foreign key(organization_id,grant_id)
    references ai_provider_role_grants(organization_id,id) on delete cascade,
  foreign key(organization_id,user_id)
    references users(organization_id,id) on delete cascade
);

-- Conservative spend; retained reservations protect against duplicate charges.
create table if not exists ai_provider_role_spend_days (
  organization_id uuid not null,
  grant_id uuid not null,
  utc_day date not null,
  reserved_micro_usd bigint not null check(reserved_micro_usd between 0 and 1000000000000),
  updated_at timestamptz not null default now(),
  primary key(organization_id,grant_id,utc_day),
  foreign key(organization_id,grant_id)
    references ai_provider_role_grants(organization_id,id) on delete restrict
);
create table if not exists ai_provider_role_spend_months (
  organization_id uuid not null,
  grant_id uuid not null,
  utc_month date not null check(extract(day from utc_month)=1),
  reserved_micro_usd bigint not null check(reserved_micro_usd between 0 and 1000000000000),
  updated_at timestamptz not null default now(),
  primary key(organization_id,grant_id,utc_month),
  foreign key(organization_id,grant_id)
    references ai_provider_role_grants(organization_id,id) on delete restrict
);

-- Idempotency is tied to the actual phase/case; a retry never re-dispatches.
-- An uncertain call retains its reservation and requires manual reconciliation.
create table if not exists ai_provider_role_call_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  grant_id uuid not null,
  role text not null check(role in ('evaluation-executor','evaluation-judge','production-serving')),
  run_id uuid not null,
  call_index integer not null check(call_index between 1 and 1000),
  connection_id uuid not null,
  actor_user_id uuid not null,
  model text not null check(length(btrim(model)) between 1 and 160),
  pricing_revision text not null check(length(btrim(pricing_revision)) between 1 and 160),
  reserved_micro_usd bigint not null check(reserved_micro_usd between 1 and 1000000000000),
  estimated_tokens integer not null check(estimated_tokens between 1 and 1000000),
  state text not null default 'reserved' check(state in ('reserved','dispatching','acknowledged','uncertain')),
  dispatched_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id,run_id,role,call_index),
  foreign key(organization_id,grant_id,role)
    references ai_provider_role_grants(organization_id,id,role) on delete restrict,
  foreign key(organization_id,connection_id)
    references ai_connections(organization_id,id) on delete restrict,
  foreign key(organization_id,actor_user_id)
    references users(organization_id,id) on delete restrict,
  constraint ai_provider_reservation_state_times check(
    (state='reserved' and dispatched_at is null and acknowledged_at is null) or
    (state='dispatching' and dispatched_at is not null and acknowledged_at is null) or
    (state='uncertain' and dispatched_at is not null and acknowledged_at is null) or
    (state='acknowledged' and dispatched_at is not null and acknowledged_at is not null))
);
create index if not exists ai_provider_role_unresolved_intents
  on ai_provider_role_call_reservations(organization_id,grant_id,created_at)
  where state in ('reserved','dispatching','uncertain');

-- Scope audited operator writes externally. Application identity must not be
-- permitted to activate a grant or assign users without admin authorization.
comment on table ai_provider_role_grants is
  'Explicit scoped provider rights; no legacy metadata or user subscription grants execution permission.';
comment on table ai_provider_role_call_reservations is
  'Conservative pre-egress hold and idempotency. Neither a provider ACK nor a billed-dollar invoice.';
