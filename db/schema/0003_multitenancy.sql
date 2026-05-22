-- Multi-tenant routing and membership preference support.

create unique index if not exists users_org_external_subject_key
  on users (organization_id, external_subject)
  where external_subject is not null;

create table if not exists user_preferences (
  auth0_subject text primary key,
  default_organization_id uuid references organizations(id) on delete set null,
  last_organization_id uuid references organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_preferences_default_organization_idx
  on user_preferences (default_organization_id)
  where default_organization_id is not null;

create index if not exists user_preferences_last_organization_idx
  on user_preferences (last_organization_id)
  where last_organization_id is not null;
