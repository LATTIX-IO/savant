import "server-only";

import {
  createCheckoutIdempotencyKey,
  normalizeSeatCount,
  type BillingCycle,
  type OnboardingDraftSnapshot,
  type OnboardingIdentity,
  type OnboardingSessionRecord,
  type PaymentEnvironment,
  type ProvisionTenantInput,
} from "@/lib/onboarding";

import {
  getControlPlaneDatabase,
  isControlPlaneDatabaseConfigured,
} from "./database.ts";

export class OnboardingStoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OnboardingStoreError";
    this.code = code;
    this.status = status;
  }
}

type OnboardingRow = {
  id: string;
  auth0_subject: string;
  auth0_email: string;
  auth0_display_name: string | null;
  workspace_name: string;
  workspace_slug: string;
  billing_cycle: BillingCycle;
  seat_count: number;
  status: OnboardingSessionRecord["status"];
  stripe_mode: PaymentEnvironment;
  checkout_idempotency_key: string;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  organization_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TenantRow = {
  organization_id: string;
  workspace_name: string;
  workspace_slug: string;
};

export type ProvisionedTenantRecord = {
  organizationId: string;
  workspaceName: string;
  workspaceSlug: string;
  auth0Subject: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  onboardingSession: OnboardingSessionRecord;
};

export type OnboardingLandingState = {
  provisionedTenant: {
    organizationId: string;
    workspaceName: string;
    workspaceSlug: string;
  } | null;
  currentSession: OnboardingSessionRecord | null;
};

export type SubscriptionStateInput = {
  organizationId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  cycle: BillingCycle | null;
  seats: number | null;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapOnboardingRow(row: OnboardingRow): OnboardingSessionRecord {
  return {
    id: row.id,
    auth0Subject: row.auth0_subject,
    auth0Email: row.auth0_email,
    auth0DisplayName: row.auth0_display_name,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    cycle: row.billing_cycle,
    seats: row.seat_count,
    status: row.status,
    paymentEnvironment: row.stripe_mode,
    checkoutIdempotencyKey: row.checkout_idempotency_key,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    organizationId: row.organization_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    updatedAt: toIsoString(row.updated_at),
  };
}

function ensureOnboardingPersistenceConfigured() {
  if (!isControlPlaneDatabaseConfigured) {
    throw new OnboardingStoreError(
      "onboarding_persistence_unconfigured",
      "DATABASE_URL must be configured before onboarding can persist tenant state.",
      503,
    );
  }

  return getControlPlaneDatabase();
}

function readPostgresConstraint(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as {
    code?: string;
    constraint_name?: string;
  };

  return candidate.code === "23505" ? candidate.constraint_name ?? null : null;
}

async function getProvisionedTenantBySubjectInternal(auth0Subject: string) {
  const sql = ensureOnboardingPersistenceConfigured();
  const rows = await sql<TenantRow[]>`
    select
      organizations.id as organization_id,
      organizations.display_name as workspace_name,
      organizations.slug as workspace_slug
    from organizations
    inner join users on users.organization_id = organizations.id
    where users.external_subject = ${auth0Subject}
      and users.status = 'active'
    order by users.created_at asc
    limit 1
  `;

  const row = rows[0];
  return row
    ? {
        organizationId: row.organization_id,
        workspaceName: row.workspace_name,
        workspaceSlug: row.workspace_slug,
      }
    : null;
}

export async function getOnboardingStateForSubject(
  auth0Subject: string,
): Promise<OnboardingLandingState> {
  const sql = ensureOnboardingPersistenceConfigured();

  const [tenantRows, sessionRows] = await Promise.all([
    sql<TenantRow[]>`
      select
        organizations.id as organization_id,
        organizations.display_name as workspace_name,
        organizations.slug as workspace_slug
      from organizations
      inner join users on users.organization_id = organizations.id
      where users.external_subject = ${auth0Subject}
        and users.status = 'active'
      order by users.created_at asc
      limit 1
    `,
    sql<OnboardingRow[]>`
      select
        id,
        auth0_subject,
        auth0_email,
        auth0_display_name,
        workspace_name,
        workspace_slug,
        billing_cycle,
        seat_count,
        status,
        stripe_mode,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        organization_id,
        error_code,
        error_message,
        created_at,
        updated_at
      from onboarding_sessions
      where auth0_subject = ${auth0Subject}
      limit 1
    `,
  ]);

  const tenant = tenantRows[0]
    ? {
        organizationId: tenantRows[0].organization_id,
        workspaceName: tenantRows[0].workspace_name,
        workspaceSlug: tenantRows[0].workspace_slug,
      }
    : null;

  return {
    provisionedTenant: tenant,
    currentSession: sessionRows[0] ? mapOnboardingRow(sessionRows[0]) : null,
  };
}

export async function saveOnboardingDraft(
  identity: OnboardingIdentity,
  draft: OnboardingDraftSnapshot,
): Promise<OnboardingSessionRecord> {
  const sql = ensureOnboardingPersistenceConfigured();
  const existingTenant = await getProvisionedTenantBySubjectInternal(identity.subject);

  if (existingTenant) {
    throw new OnboardingStoreError(
      "tenant_already_exists",
      "This Auth0 account already belongs to a provisioned Savant tenant.",
      409,
    );
  }

  const checkoutIdempotencyKey = createCheckoutIdempotencyKey();

  const rows = await sql<OnboardingRow[]>`
    insert into onboarding_sessions (
      auth0_subject,
      auth0_email,
      auth0_display_name,
      workspace_name,
      workspace_slug,
      billing_cycle,
      seat_count,
      status,
      stripe_mode,
      checkout_idempotency_key,
      stripe_checkout_session_id,
      stripe_customer_id,
      stripe_subscription_id,
      organization_id,
      error_code,
      error_message
    )
    values (
      ${identity.subject},
      ${identity.email},
      ${identity.displayName},
      ${draft.workspaceName},
      ${draft.workspaceSlug},
      ${draft.cycle},
      ${draft.seats},
      'draft',
      'test',
      ${checkoutIdempotencyKey},
      null,
      null,
      null,
      null,
      null,
      null
    )
    on conflict (auth0_subject) do update
    set
      auth0_email = excluded.auth0_email,
      auth0_display_name = excluded.auth0_display_name,
      workspace_name = excluded.workspace_name,
      workspace_slug = excluded.workspace_slug,
      billing_cycle = excluded.billing_cycle,
      seat_count = excluded.seat_count,
      status = 'draft',
      checkout_idempotency_key = excluded.checkout_idempotency_key,
      stripe_checkout_session_id = null,
      stripe_customer_id = null,
      stripe_subscription_id = null,
      error_code = null,
      error_message = null,
      updated_at = now()
    returning
      id,
      auth0_subject,
      auth0_email,
      auth0_display_name,
      workspace_name,
      workspace_slug,
      billing_cycle,
      seat_count,
      status,
      stripe_mode,
      checkout_idempotency_key,
      stripe_checkout_session_id,
      stripe_customer_id,
      stripe_subscription_id,
      organization_id,
      error_code,
      error_message,
      created_at,
      updated_at
  `;

  return mapOnboardingRow(rows[0]!);
}

export async function beginCheckoutForOnboarding(
  identity: OnboardingIdentity,
  draft: OnboardingDraftSnapshot,
  paymentEnvironment: PaymentEnvironment,
): Promise<OnboardingSessionRecord> {
  const sql = ensureOnboardingPersistenceConfigured();
  const existingTenant = await getProvisionedTenantBySubjectInternal(identity.subject);

  if (existingTenant) {
    throw new OnboardingStoreError(
      "tenant_already_exists",
      "This Auth0 account already belongs to a provisioned Savant tenant.",
      409,
    );
  }

  const checkoutIdempotencyKey = createCheckoutIdempotencyKey();

  try {
    const rows = await sql<OnboardingRow[]>`
      insert into onboarding_sessions (
        auth0_subject,
        auth0_email,
        auth0_display_name,
        workspace_name,
        workspace_slug,
        billing_cycle,
        seat_count,
        status,
        stripe_mode,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        organization_id,
        error_code,
        error_message
      )
      values (
        ${identity.subject},
        ${identity.email},
        ${identity.displayName},
        ${draft.workspaceName},
        ${draft.workspaceSlug},
        ${draft.cycle},
        ${draft.seats},
        'checkout_pending',
        ${paymentEnvironment},
        ${checkoutIdempotencyKey},
        null,
        null,
        null,
        null,
        null,
        null
      )
      on conflict (auth0_subject) do update
      set
        auth0_email = excluded.auth0_email,
        auth0_display_name = excluded.auth0_display_name,
        workspace_name = excluded.workspace_name,
        workspace_slug = excluded.workspace_slug,
        billing_cycle = excluded.billing_cycle,
        seat_count = excluded.seat_count,
        status = 'checkout_pending',
        stripe_mode = excluded.stripe_mode,
        checkout_idempotency_key = excluded.checkout_idempotency_key,
        stripe_checkout_session_id = null,
        stripe_customer_id = null,
        stripe_subscription_id = null,
        organization_id = null,
        error_code = null,
        error_message = null,
        updated_at = now()
      returning
        id,
        auth0_subject,
        auth0_email,
        auth0_display_name,
        workspace_name,
        workspace_slug,
        billing_cycle,
        seat_count,
        status,
        stripe_mode,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        organization_id,
        error_code,
        error_message,
        created_at,
        updated_at
    `;

    return mapOnboardingRow(rows[0]!);
  } catch (error) {
    const constraint = readPostgresConstraint(error);
    if (constraint === "organizations_slug_key" || constraint === "onboarding_sessions_workspace_slug_active_key") {
      throw new OnboardingStoreError(
        "workspace_slug_unavailable",
        "That workspace URL is already reserved by another tenant.",
        409,
      );
    }

    throw error;
  }
}

export async function attachStripeCheckoutSession(
  onboardingSessionId: string,
  stripeCheckoutSessionId: string,
): Promise<OnboardingSessionRecord> {
  const sql = ensureOnboardingPersistenceConfigured();
  const rows = await sql<OnboardingRow[]>`
    update onboarding_sessions
    set
      stripe_checkout_session_id = ${stripeCheckoutSessionId},
      status = 'checkout_pending',
      updated_at = now()
    where id = ${onboardingSessionId}
    returning
      id,
      auth0_subject,
      auth0_email,
      auth0_display_name,
      workspace_name,
      workspace_slug,
      billing_cycle,
      seat_count,
      status,
      stripe_mode,
      checkout_idempotency_key,
      stripe_checkout_session_id,
      stripe_customer_id,
      stripe_subscription_id,
      organization_id,
      error_code,
      error_message,
      created_at,
      updated_at
  `;

  if (!rows[0]) {
    throw new OnboardingStoreError(
      "onboarding_session_not_found",
      "The onboarding session could not be updated with its Stripe checkout id.",
      404,
    );
  }

  return mapOnboardingRow(rows[0]);
}

export async function recordCheckoutFailure(
  onboardingSessionId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const sql = ensureOnboardingPersistenceConfigured();

  await sql`
    update onboarding_sessions
    set
      status = 'draft',
      stripe_checkout_session_id = null,
      error_code = ${errorCode},
      error_message = ${errorMessage},
      updated_at = now()
    where id = ${onboardingSessionId}
  `;
}

export async function getOnboardingSessionForSubjectByCheckoutSessionId(
  auth0Subject: string,
  stripeCheckoutSessionId: string,
): Promise<OnboardingSessionRecord | null> {
  const sql = ensureOnboardingPersistenceConfigured();
  const rows = await sql<OnboardingRow[]>`
    select
      id,
      auth0_subject,
      auth0_email,
      auth0_display_name,
      workspace_name,
      workspace_slug,
      billing_cycle,
      seat_count,
      status,
      stripe_mode,
      checkout_idempotency_key,
      stripe_checkout_session_id,
      stripe_customer_id,
      stripe_subscription_id,
      organization_id,
      error_code,
      error_message,
      created_at,
      updated_at
    from onboarding_sessions
    where auth0_subject = ${auth0Subject}
      and stripe_checkout_session_id = ${stripeCheckoutSessionId}
    limit 1
  `;

  return rows[0] ? mapOnboardingRow(rows[0]) : null;
}

export async function claimWebhookEvent(
  stripeEventId: string,
  eventType: string,
): Promise<boolean> {
  const sql = ensureOnboardingPersistenceConfigured();

  const inserted = await sql<{ stripe_event_id: string }[]>`
    insert into billing_webhook_events (stripe_event_id, event_type, status)
    values (${stripeEventId}, ${eventType}, 'processing')
    on conflict (stripe_event_id) do nothing
    returning stripe_event_id
  `;

  if (inserted.length > 0) {
    return true;
  }

  const retried = await sql<{ stripe_event_id: string }[]>`
    update billing_webhook_events
    set
      status = 'processing',
      last_error = null,
      processed_at = null
    where stripe_event_id = ${stripeEventId}
      and status = 'failed'
    returning stripe_event_id
  `;

  return retried.length > 0;
}

export async function markWebhookEventProcessed(stripeEventId: string): Promise<void> {
  const sql = ensureOnboardingPersistenceConfigured();

  await sql`
    update billing_webhook_events
    set
      status = 'processed',
      last_error = null,
      processed_at = now()
    where stripe_event_id = ${stripeEventId}
  `;
}

export async function markWebhookEventFailed(
  stripeEventId: string,
  errorMessage: string,
): Promise<void> {
  const sql = ensureOnboardingPersistenceConfigured();

  await sql`
    update billing_webhook_events
    set
      status = 'failed',
      last_error = ${errorMessage},
      processed_at = null
    where stripe_event_id = ${stripeEventId}
  `;
}

export async function finalizeCheckoutProvisioning(
  input: ProvisionTenantInput,
): Promise<ProvisionedTenantRecord> {
  const sql = ensureOnboardingPersistenceConfigured();

  return sql.begin(async (tx) => {
    const onboardingByCheckout = await tx<OnboardingRow[]>`
      select
        id,
        auth0_subject,
        auth0_email,
        auth0_display_name,
        workspace_name,
        workspace_slug,
        billing_cycle,
        seat_count,
        status,
        stripe_mode,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        organization_id,
        error_code,
        error_message,
        created_at,
        updated_at
      from onboarding_sessions
      where stripe_checkout_session_id = ${input.checkoutSessionId}
      limit 1
    `;

    const onboarding = onboardingByCheckout[0] ?? (input.onboardingSessionId
      ? (await tx<OnboardingRow[]>`
          select
            id,
            auth0_subject,
            auth0_email,
            auth0_display_name,
            workspace_name,
            workspace_slug,
            billing_cycle,
            seat_count,
            status,
            stripe_mode,
            checkout_idempotency_key,
            stripe_checkout_session_id,
            stripe_customer_id,
            stripe_subscription_id,
            organization_id,
            error_code,
            error_message,
            created_at,
            updated_at
          from onboarding_sessions
          where id = ${input.onboardingSessionId}
            and auth0_subject = ${input.auth0Subject}
          limit 1
        `)[0]
      : null);

    if (!onboarding) {
      throw new OnboardingStoreError(
        "onboarding_session_not_found",
        "The checkout session was not found in onboarding persistence.",
        404,
      );
    }

    const conflictingTenant = await tx<{ organization_id: string }[]>`
      select organizations.id as organization_id
      from organizations
      where lower(organizations.slug) = lower(${input.workspaceSlug})
        and not exists (
          select 1
          from users
          where users.organization_id = organizations.id
            and users.external_subject = ${input.auth0Subject}
        )
      limit 1
    `;

    if (conflictingTenant[0]) {
      throw new OnboardingStoreError(
        "workspace_slug_unavailable",
        "That workspace URL is already in use by another tenant.",
        409,
      );
    }

    const organizations = await tx<{
      id: string;
      slug: string;
      display_name: string;
    }[]>`
      insert into organizations (slug, display_name)
      values (${input.workspaceSlug}, ${input.workspaceName})
      on conflict (slug) do update
      set
        display_name = excluded.display_name,
        updated_at = now()
      returning id, slug, display_name
    `;
    const organization = organizations[0]!;

    const existingUsers = await tx<{ id: string }[]>`
      select id
      from users
      where organization_id = ${organization.id}
        and lower(email) = lower(${input.auth0Email})
      limit 1
    `;

    if (existingUsers[0]) {
      await tx`
        update users
        set
          external_subject = ${input.auth0Subject},
          display_name = ${input.auth0DisplayName ?? input.auth0Email},
          status = 'active',
          updated_at = now()
        where id = ${existingUsers[0].id}
      `;
    } else {
      await tx`
        insert into users (
          organization_id,
          external_subject,
          email,
          display_name,
          status
        )
        values (
          ${organization.id},
          ${input.auth0Subject},
          ${input.auth0Email},
          ${input.auth0DisplayName ?? input.auth0Email},
          'active'
        )
      `;
    }

    await tx`
      insert into workspace_settings (organization_id, settings)
      values (${organization.id}, '{}'::jsonb)
      on conflict (organization_id) do nothing
    `;

    if (input.stripeCustomerId) {
      await tx`
        insert into billing_accounts (
          organization_id,
          stripe_customer_id,
          stripe_mode,
          auth0_subject,
          billing_email
        )
        values (
          ${organization.id},
          ${input.stripeCustomerId},
          ${input.paymentEnvironment},
          ${input.auth0Subject},
          ${input.auth0Email}
        )
        on conflict (organization_id) do update
        set
          stripe_customer_id = excluded.stripe_customer_id,
          stripe_mode = excluded.stripe_mode,
          auth0_subject = excluded.auth0_subject,
          billing_email = excluded.billing_email,
          updated_at = now()
      `;
    }

    if (input.stripeSubscriptionId && input.stripeCustomerId) {
      await tx`
        insert into billing_subscriptions (
          organization_id,
          stripe_subscription_id,
          stripe_customer_id,
          stripe_price_id,
          status,
          billing_cycle,
          seat_count,
          cancel_at_period_end
        )
        values (
          ${organization.id},
          ${input.stripeSubscriptionId},
          ${input.stripeCustomerId},
          null,
          'pending_sync',
          ${input.cycle},
          ${input.seats},
          false
        )
        on conflict (organization_id) do update
        set
          stripe_subscription_id = excluded.stripe_subscription_id,
          stripe_customer_id = excluded.stripe_customer_id,
          status = excluded.status,
          billing_cycle = excluded.billing_cycle,
          seat_count = excluded.seat_count,
          updated_at = now()
      `;
    }

    await tx`
      insert into audit_events (
        organization_id,
        actor_type,
        actor_ref,
        category,
        action,
        target_type,
        target_ref,
        payload_redacted
      )
      values (
        ${organization.id},
        'user',
        ${input.auth0Subject},
        'onboarding',
        'tenant_provisioned',
        'organization',
        ${organization.id},
        ${tx.json({
          billingCycle: input.cycle,
          seatCount: input.seats,
          workspaceSlug: input.workspaceSlug,
        })}
      )
    `;

    const updatedSessions = await tx<OnboardingRow[]>`
      update onboarding_sessions
      set
        auth0_email = ${input.auth0Email},
        auth0_display_name = ${input.auth0DisplayName},
        workspace_name = ${input.workspaceName},
        workspace_slug = ${input.workspaceSlug},
        billing_cycle = ${input.cycle},
        seat_count = ${input.seats},
        status = 'provisioning',
        stripe_mode = ${input.paymentEnvironment},
        stripe_checkout_session_id = ${input.checkoutSessionId},
        stripe_customer_id = ${input.stripeCustomerId},
        stripe_subscription_id = ${input.stripeSubscriptionId},
        organization_id = ${organization.id},
        error_code = null,
        error_message = null,
        updated_at = now()
      where id = ${onboarding.id}
      returning
        id,
        auth0_subject,
        auth0_email,
        auth0_display_name,
        workspace_name,
        workspace_slug,
        billing_cycle,
        seat_count,
        status,
        stripe_mode,
        checkout_idempotency_key,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        organization_id,
        error_code,
        error_message,
        created_at,
        updated_at
    `;

    const updatedSession = mapOnboardingRow(updatedSessions[0]!);

    return {
      organizationId: organization.id,
      workspaceName: organization.display_name,
      workspaceSlug: organization.slug,
      auth0Subject: input.auth0Subject,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      onboardingSession: updatedSession,
    };
  });
}

export async function markOnboardingReady(onboardingSessionId: string): Promise<void> {
  const sql = ensureOnboardingPersistenceConfigured();

  await sql`
    update onboarding_sessions
    set
      status = 'ready',
      error_code = null,
      error_message = null,
      updated_at = now()
    where id = ${onboardingSessionId}
  `;
}

export async function markOnboardingCanceled(
  onboardingSessionId: string,
): Promise<OnboardingSessionRecord> {
  const sql = ensureOnboardingPersistenceConfigured();

  const rows = await sql<OnboardingRow[]>`
    update onboarding_sessions
    set
      status = 'canceled',
      error_code = null,
      error_message = null,
      updated_at = now()
    where id = ${onboardingSessionId}
    returning
      id,
      auth0_subject,
      auth0_email,
      auth0_display_name,
      workspace_name,
      workspace_slug,
      billing_cycle,
      seat_count,
      status,
      stripe_mode,
      checkout_idempotency_key,
      stripe_checkout_session_id,
      stripe_customer_id,
      stripe_subscription_id,
      organization_id,
      error_code,
      error_message,
      created_at,
      updated_at
  `;

  if (!rows[0]) {
    throw new OnboardingStoreError(
      "onboarding_session_not_found",
      "The onboarding session could not be marked as canceled.",
      404,
    );
  }

  return mapOnboardingRow(rows[0]);
}

export async function markOnboardingFailureByCheckoutSessionId(
  stripeCheckoutSessionId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const sql = ensureOnboardingPersistenceConfigured();

  await sql`
    update onboarding_sessions
    set
      status = 'failed',
      error_code = ${errorCode},
      error_message = ${errorMessage},
      updated_at = now()
    where stripe_checkout_session_id = ${stripeCheckoutSessionId}
  `;
}

export async function syncBillingSubscriptionState(
  input: SubscriptionStateInput,
): Promise<void> {
  const sql = ensureOnboardingPersistenceConfigured();

  let organizationId = input.organizationId;
  if (!organizationId && input.stripeCustomerId) {
    const accounts = await sql<{ organization_id: string }[]>`
      select organization_id
      from billing_accounts
      where stripe_customer_id = ${input.stripeCustomerId}
      limit 1
    `;
    organizationId = accounts[0]?.organization_id ?? null;
  }

  if (!organizationId) {
    return;
  }

  const existing = await sql<{
    billing_cycle: BillingCycle;
    seat_count: number;
    stripe_customer_id: string;
  }[]>`
    select billing_cycle, seat_count, stripe_customer_id
    from billing_subscriptions
    where organization_id = ${organizationId}
    limit 1
  `;

  const existingRow = existing[0];
  const seatCount = normalizeSeatCount(input.seats ?? existingRow?.seat_count ?? 1, 1);
  const billingCycle = input.cycle ?? existingRow?.billing_cycle ?? "annual";
  const stripeCustomerId = input.stripeCustomerId ?? existingRow?.stripe_customer_id ?? null;

  if (!stripeCustomerId) {
    return;
  }

  await sql`
    insert into billing_subscriptions (
      organization_id,
      stripe_subscription_id,
      stripe_customer_id,
      stripe_price_id,
      status,
      billing_cycle,
      seat_count,
      cancel_at_period_end
    )
    values (
      ${organizationId},
      ${input.stripeSubscriptionId},
      ${stripeCustomerId},
      ${input.stripePriceId},
      ${input.status},
      ${billingCycle},
      ${seatCount},
      ${input.cancelAtPeriodEnd}
    )
    on conflict (organization_id) do update
    set
      stripe_subscription_id = excluded.stripe_subscription_id,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_price_id = excluded.stripe_price_id,
      status = excluded.status,
      billing_cycle = excluded.billing_cycle,
      seat_count = excluded.seat_count,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = now()
  `;
}
