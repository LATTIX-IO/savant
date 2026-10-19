-- PER-1059 increment 4: metadata-only quarantine of authentically signed but invalid events.
-- Never store raw payloads, prompts, signatures, bearer tokens or HMAC keys.
create table if not exists harness_eval_event_quarantine (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  harness_run_id uuid not null,
  adapter_id varchar(128) not null,
  delivery_id varchar(128) not null,
  payload_sha256 varchar(64) not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  reason varchar(32) not null check (reason in ('invalid_event')),
  rejected_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at >= rejected_at),
  unique (organization_id,harness_run_id,delivery_id),
  foreign key (organization_id,harness_run_id)
    references harness_eval_runs (organization_id,id) on delete cascade
);
create index if not exists harness_event_quarantine_expiry_idx
  on harness_eval_event_quarantine (organization_id,expires_at);
comment on table harness_eval_event_quarantine is
  'Only verified-HMAC rejected event metadata. Retention scoped to originating run policy; no user content, signatures or secrets.';
