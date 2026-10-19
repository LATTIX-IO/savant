-- PER-1560: offline, independently approved crypto maintenance admission.
-- Tenant-specific and provider-independent. No HTTP route and no scheduled trigger.
-- Application operator role is never sufficient authorization by itself.
create table if not exists crypto_maintenance_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  approval_id uuid not null unique,
  operator_actor_id bigint not null check (operator_actor_id > 0),
  reviewer_actor_id bigint not null check (reviewer_actor_id > 0),
  github_run_id bigint not null check (github_run_id > 0),
  github_run_attempt integer not null check (github_run_attempt > 0),
  target varchar(24) not null check (target in ('definitions','runs','ai-secrets')),
  max_rows integer not null check (max_rows between 1 and 20),
  head_sha char(40) not null check (head_sha ~ '^[a-f0-9]{40}$'),
  key_version varchar(128) not null check (length(key_version)>0),
  backup_id varchar(128) not null check (length(backup_id)>0),
  backup_sha256 char(64) not null check (backup_sha256 ~ '^[a-f0-9]{64}$'),
  approval_sha256 char(64) not null check (approval_sha256 ~ '^[a-f0-9]{64}$'),
  change_ticket varchar(32) not null check (change_ticket ~ '^PER-[1-9][0-9]{0,6}$'),
  state varchar(16) not null default 'admitted'
    check (state in ('admitted','running','completed','uncertain')),
  migrated integer check (migrated is null or migrated between 0 and 20),
  resulting_batch_id uuid,
  admitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_maintenance_independent_reviewer_check
    check (operator_actor_id <> reviewer_actor_id),
  constraint crypto_maintenance_workflow_attempt_unique
    unique (github_run_id,github_run_attempt),
  constraint crypto_maintenance_result_consistent
    check ((state='completed' and migrated is not null and resulting_batch_id is not null)
      or (state<>'completed' and migrated is null and resulting_batch_id is null))
);
create unique index if not exists crypto_maintenance_unfinished_tenant_target
  on crypto_maintenance_operations (organization_id,target)
  where state in ('admitted','running','uncertain');

-- Prevent rewriting previously verified identity/approval, restoring "running",
-- or erasing an uncertain outcome via arbitrary SQL UPDATE.
create or replace function crypto_maintenance_preserve_attestation()
returns trigger language plpgsql as $$
begin
  if (new.organization_id,new.approval_id,new.operator_actor_id,new.reviewer_actor_id,
      new.github_run_id,new.github_run_attempt,new.target,new.max_rows,new.head_sha,
      new.key_version,new.backup_id,new.backup_sha256,new.approval_sha256,
      new.change_ticket,new.admitted_at)
      is distinct from
     (old.organization_id,old.approval_id,old.operator_actor_id,old.reviewer_actor_id,
      old.github_run_id,old.github_run_attempt,old.target,old.max_rows,old.head_sha,
      old.key_version,old.backup_id,old.backup_sha256,old.approval_sha256,
      old.change_ticket,old.admitted_at)
     then raise exception 'crypto_maintenance_attestation_immutable' using errcode='23514';
  end if;
  if not ((old.state='admitted' and new.state in ('running','uncertain'))
      or (old.state='running' and new.state in ('completed','uncertain')))
    then raise exception 'crypto_maintenance_state_transition_invalid' using errcode='23514';
  end if;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists crypto_maintenance_attestation_guard on crypto_maintenance_operations;
create trigger crypto_maintenance_attestation_guard
  before update on crypto_maintenance_operations
  for each row execute function crypto_maintenance_preserve_attestation();

revoke all on table crypto_maintenance_operations from public;
comment on table crypto_maintenance_operations is
  'Only signature-verified, independently approved maintenance; uncertain attempts require supervised reconciliation, never automatic replay.';
