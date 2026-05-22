-- Durable onboarding + billing state for the hosted checkout flow.

create table if not exists onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  auth0_subject text not null unique,
  auth0_email text not null,
  auth0_display_name text,
  workspace_name text not null,
  workspace_slug text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  seat_count integer not null check (seat_count between 1 and 500),
  status text not null default 'draft' check (status in ('draft', 'checkout_pending', 'provisioning', 'ready', 'failed', 'canceled')),
  stripe_mode text not null default 'test' check (stripe_mode in ('test', 'live')),
  checkout_idempotency_key text not null,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  organization_id uuid references organizations(id) on delete set null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists onboarding_sessions_checkout_idempotency_key
  on onboarding_sessions (checkout_idempotency_key);

create unique index if not exists onboarding_sessions_checkout_session_key
  on onboarding_sessions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists onboarding_sessions_organization_id_key
  on onboarding_sessions (organization_id)
  where organization_id is not null;

create unique index if not exists onboarding_sessions_workspace_slug_active_key
  on onboarding_sessions (lower(workspace_slug))
  where status in ('checkout_pending', 'provisioning', 'ready');

create index if not exists onboarding_sessions_subject_updated_at_idx
  on onboarding_sessions (auth0_subject, updated_at desc);

create index if not exists users_external_subject_idx
  on users (external_subject)
  where external_subject is not null;

create table if not exists billing_accounts (
  organization_id uuid primary key references organizations(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  auth0_subject text not null,
  billing_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_subscriptions (
  organization_id uuid primary key references organizations(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text,
  status text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  seat_count integer not null check (seat_count between 1 and 500),
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
