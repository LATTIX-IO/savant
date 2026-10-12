-- PER-1059 increment 8: side-effect boundary is a persistent reconciliation hold.
-- A provider invocation must never begin until dispatchStarted is committed.
alter table harness_eval_dispatch_leases
  drop constraint if exists harness_eval_dispatch_leases_state_check;
alter table harness_eval_dispatch_leases
  add constraint harness_eval_dispatch_leases_state_check
  check (state in ('leased','retry','acknowledged','exhausted','dispatching','reconciliation'));
alter table harness_eval_dispatch_leases
  add column if not exists reconciliation_reason varchar(32);
alter table harness_eval_dispatch_leases
  drop constraint if exists harness_eval_dispatch_leases_reconciliation_reason_check;
alter table harness_eval_dispatch_leases
  add constraint harness_eval_dispatch_leases_reconciliation_reason_check
  check (
    (state = 'reconciliation' and reconciliation_reason is not null and reconciliation_reason in
      ('provider_unknown','provider_timeout','invalid_response','ack_failed'))
    or (state <> 'reconciliation' and reconciliation_reason is null)
  );
alter table harness_eval_transitions
  drop constraint if exists harness_eval_transitions_action_check;
alter table harness_eval_transitions
  add constraint harness_eval_transitions_action_check
  check (action in ('reserved','started','cancelRequested','eventApplied','expired',
    'dispatchStarted','reconciliationRequired'));
create index if not exists harness_dispatch_reconciliation_idx
  on harness_eval_dispatch_leases (organization_id,updated_at)
  where state in ('dispatching','reconciliation');
comment on column harness_eval_dispatch_leases.reconciliation_reason is
  'Safe code only; never a provider error, token, raw payload or personal data.';
