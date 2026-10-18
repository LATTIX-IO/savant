-- PER-1059 increment 3: durable signed-webhook replay defense.
-- Unique per-tenant/per-run delivery IDs MUST be committed with the resulting
-- state transition, never as a separate preflight write.
create table if not exists harness_eval_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  harness_run_id uuid not null,
  delivery_id varchar(128) not null,
  event_id varchar(128) not null,
  payload_sha256 varchar(64) not null
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  accepted_at timestamptz not null default now(),
  unique (organization_id,harness_run_id,delivery_id),
  foreign key (organization_id,harness_run_id)
    references harness_eval_runs (organization_id,id) on delete cascade
);
create index if not exists harness_eval_deliveries_tenant_lookup_idx
  on harness_eval_deliveries (organization_id,harness_run_id,accepted_at);
comment on table harness_eval_deliveries is
  'PER-1059: authenticated, content-free signed delivery ID and digest receipts. No webhook body, HMAC, secret, trace payload or raw content.';
