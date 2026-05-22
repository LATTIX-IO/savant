import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { buildAuthStatusHref, normalizeReturnToPath } from "@/lib/auth0-config";
import { getAuth0Diagnostics, type Auth0Diagnostics, type DiagnosticEnvStatus } from "@/lib/auth0-diagnostics";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Auth status",
  description:
    "Public Auth0 readiness diagnostics for this Savant deployment. Verifies hosted Universal Login wiring and onboarding prerequisites without exposing secrets.",
};

type AuthStatusSearchParams = {
  source?: string;
  returnTo?: string;
};

function StatusChip({
  status,
}: {
  status: "configured" | "development-bypass" | "unconfigured" | "reachable" | "unreachable" | "not-configured";
}) {
  if (status === "configured" || status === "reachable") {
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        {status}
      </span>
    );
  }

  if (status === "development-bypass") {
    return <span className="chip chip-brass">development bypass</span>;
  }

  if (status === "unreachable") {
    return <span className="chip chip-blood">unreachable</span>;
  }

  return <span className="chip chip-paper">{status}</span>;
}

function EnvStatusChip({ status }: { status: DiagnosticEnvStatus }) {
  if (status === "configured") {
    return (
      <span className="chip chip-moss">
        <span className="dot" />
        configured
      </span>
    );
  }

  if (status === "placeholder") {
    return <span className="chip chip-brass">placeholder</span>;
  }

  return <span className="chip chip-paper">missing</span>;
}

function DiagnosticRow({
  label,
  sub,
  value,
}: {
  label: string;
  sub?: string;
  value: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px, 240px) minmax(0, 1fr)",
        gap: 20,
        padding: "14px 0",
        borderBottom: "1px solid var(--rule)",
        alignItems: "flex-start",
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{label}</div>
        {sub ? (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
            {sub}
          </div>
        ) : null}
      </div>
      <div>{value}</div>
    </div>
  );
}

function renderEnvStatusSummary(status: DiagnosticEnvStatus, configuredValue?: string | null) {
  return (
    <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <EnvStatusChip status={status} />
      {configuredValue ? (
        <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {configuredValue}
        </span>
      ) : null}
    </div>
  );
}

function sourceLabel(source: string | undefined): string {
  if (source === "signin") return "Sign in";
  if (source === "signup") return "Sign up";
  if (source === "onboarding") return "Onboarding";
  if (source === "unavailable") return "Protected route";
  return "This deployment";
}

function actionItems(diagnostics: Auth0Diagnostics): string[] {
  const actions: string[] = [];

  if (diagnostics.clientSecretStatus !== "configured") {
    actions.push("Set a real AUTH0_CLIENT_SECRET in the deployment environment.");
  }

  if (diagnostics.sessionSecretStatus !== "configured") {
    actions.push("Set a real AUTH0_SECRET for encrypted server-side session cookies.");
  }

  if (diagnostics.appBaseUrlStatus !== "configured") {
    actions.push("Set APP_BASE_URL or NEXT_PUBLIC_APP_URL so callback/logout URLs resolve cleanly.");
  }

  if (diagnostics.discovery.status === "unreachable") {
    actions.push("Verify the Auth0 tenant domain or custom domain and ensure the deployment can reach the discovery endpoint.");
  }

  if (diagnostics.databaseStatus !== "configured") {
    actions.push("Set DATABASE_URL before expecting real onboarding checkout persistence to work.");
  }

  if (diagnostics.stripeWebhookStatus !== "configured") {
    actions.push("Set STRIPE_WEBHOOK_SECRET before expecting the hosted onboarding flow to provision tenants end to end.");
  }

  if (actions.length === 0) {
    actions.push("Auth0 looks configured. If login still fails, verify the allowed callback/logout URLs in the Auth0 dashboard match the values below and then retry the Universal Login flow.");
  }

  return actions;
}

export default async function AuthStatusPage({
  searchParams,
}: {
  searchParams: Promise<AuthStatusSearchParams>;
}) {
  const params = await searchParams;
  const diagnostics = await getAuth0Diagnostics();
  const requestedSource = sourceLabel(params.source);
  const returnTo = normalizeReturnToPath(params.returnTo, "/dashboard");
  const retrySigninHref = `/signin?returnTo=${encodeURIComponent(returnTo)}` as Route;
  const retrySignupHref = `/signup?returnTo=${encodeURIComponent(returnTo)}` as Route;
  const retryOnboardingHref = returnTo as Route;
  const actions = actionItems(diagnostics);

  return (
    <section className="marketing-section" style={{ paddingTop: 96 }}>
      <div className="marketing-inner" style={{ display: "grid", gap: 24 }}>
        <div className="col" style={{ gap: 12 }}>
          <div className="marketing-eyebrow">Deployment diagnostics</div>
          <h1 style={{ margin: 0, fontSize: "clamp(34px, 5vw, 56px)", lineHeight: 1.02 }}>
            Auth status
          </h1>
          <p style={{ margin: 0, maxWidth: 760, color: "var(--ink-3)", fontSize: 15, lineHeight: 1.7 }}>
            {requestedSource} sent you here because this deployment could not prove that Auth0 is fully ready.
            This page checks the hosted Universal Login entry points, resolved callback/logout URLs,
            and the non-secret onboarding prerequisites without exposing any credentials.
          </p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <StatusChip status={diagnostics.overallStatus} />
            <StatusChip status={diagnostics.discovery.status} />
            <span className="chip chip-paper">Universal Login · enabled</span>
          </div>
        </div>

        <div className="note" style={{ margin: 0 }}>
          <span className="n-icon">ℹ️</span>
          <div>
            We can verify that the deployment has the expected env values and that the Auth0 discovery
            document is reachable. We cannot prove a client secret is the exact correct value without
            completing a live OAuth exchange.
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div>
              <div className="panel-title">What to do next</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Fix the flagged items below, redeploy, then retry the same entry flow.
              </div>
            </div>
            <Link href="/" className="btn btn-sm">
              Back home
            </Link>
          </div>
          <div className="panel-bd">
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
              {actions.map((item) => (
                <li key={item} style={{ color: "var(--ink-3)", lineHeight: 1.55 }}>
                  {item}
                </li>
              ))}
            </ul>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 18 }}>
              <Link href={retrySigninHref} className="btn btn-sm">
                Retry sign in
              </Link>
              <Link href={retrySignupHref} className="btn btn-sm">
                Retry sign up
              </Link>
              <Link href={retryOnboardingHref} className="btn btn-sm">
                Retry onboarding
              </Link>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div>
              <div className="panel-title">Universal Login wiring</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Savant uses the official Auth0 Next.js SDK entry points rather than a custom login form.
              </div>
            </div>
          </div>
          <div className="panel-bd">
            <DiagnosticRow
              label="Sign in route"
              sub="Hosted login starts here."
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.loginRoute}</span>}
            />
            <DiagnosticRow
              label="Sign up route"
              sub="Hosted signup is the same Universal Login entry point with screen_hint=signup."
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.signupRoute}</span>}
            />
            <DiagnosticRow
              label="Mode"
              sub="Expected Auth0 experience for both sign in and sign up."
              value={<span className="chip chip-moss"><span className="dot" />Hosted Universal Login</span>}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div>
              <div className="panel-title">Auth0 environment</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Only non-secret status is shown here.
              </div>
            </div>
          </div>
          <div className="panel-bd">
            <DiagnosticRow
              label="Tenant domain"
              sub="AUTH0_DOMAIN or AUTH0_ISSUER_BASE_URL."
              value={renderEnvStatusSummary(diagnostics.tenantDomainStatus, diagnostics.tenantDomain)}
            />
            <DiagnosticRow
              label="Client ID"
              sub="Browser-safe identifier for the Auth0 regular web application."
              value={renderEnvStatusSummary(diagnostics.clientIdStatus, diagnostics.clientId)}
            />
            <DiagnosticRow
              label="Client secret"
              sub="Must be present server-side for the OAuth code exchange."
              value={<EnvStatusChip status={diagnostics.clientSecretStatus} />}
            />
            <DiagnosticRow
              label="Session secret"
              sub="Encrypts the server-side session cookie managed by the SDK."
              value={
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <EnvStatusChip status={diagnostics.sessionSecretStatus} />
                  {diagnostics.sessionSecretMatchesRecommendedHex64 === null ? null : diagnostics.sessionSecretMatchesRecommendedHex64 ? (
                    <span className="chip chip-paper">64-char hex · yes</span>
                  ) : (
                    <span className="chip chip-brass">64-char hex · no</span>
                  )}
                </div>
              }
            />
            <DiagnosticRow
              label="Resolved app base URL"
              sub="APP_BASE_URL, AUTH0_BASE_URL, or the supported public-origin fallbacks."
              value={renderEnvStatusSummary(diagnostics.appBaseUrlStatus, diagnostics.appBaseUrl)}
            />
            <DiagnosticRow
              label="Public app URL"
              sub="NEXT_PUBLIC_APP_URL, used by onboarding and local return URLs."
              value={renderEnvStatusSummary(diagnostics.publicAppUrlStatus, diagnostics.publicAppUrl)}
            />
            <DiagnosticRow
              label="Origins aligned"
              sub="Useful when the browser origin and callback origin drift apart between environments."
              value={<span className="chip chip-paper">{diagnostics.appBaseUrlMatchesPublicAppUrl === null ? "n/a" : diagnostics.appBaseUrlMatchesPublicAppUrl ? "yes" : "no"}</span>}
            />
            <DiagnosticRow
              label="Callback URL"
              sub="Register this under Allowed Callback URLs in Auth0."
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.callbackUrl ?? "Not configured"}</span>}
            />
            <DiagnosticRow
              label="Logout URL"
              sub="Register this under Allowed Logout URLs in Auth0."
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.logoutUrl ?? "Not configured"}</span>}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div>
              <div className="panel-title">Connection check</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                Live fetch against the Auth0 discovery endpoint for the resolved tenant domain.
              </div>
            </div>
            <StatusChip status={diagnostics.discovery.status} />
          </div>
          <div className="panel-bd">
            <DiagnosticRow
              label="Issuer"
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.discovery.issuer ?? "Unavailable"}</span>}
            />
            <DiagnosticRow
              label="Authorization endpoint"
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.discovery.authorizationEndpoint ?? "Unavailable"}</span>}
            />
            <DiagnosticRow
              label="Token endpoint"
              value={<span className="mono" style={{ fontSize: 12.5 }}>{diagnostics.discovery.tokenEndpoint ?? "Unavailable"}</span>}
            />
            {diagnostics.discovery.errorMessage ? (
              <DiagnosticRow
                label="Last error"
                value={<span style={{ color: "var(--oxblood)", fontSize: 12.5 }}>{diagnostics.discovery.errorMessage}</span>}
              />
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <div>
              <div className="panel-title">Onboarding prerequisites</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                These do not block Auth0 itself, but they do block a production-ready Stripe onboarding flow.
              </div>
            </div>
          </div>
          <div className="panel-bd">
            <DiagnosticRow
              label="DATABASE_URL"
              sub="Required for durable onboarding persistence and tenant provisioning."
              value={<EnvStatusChip status={diagnostics.databaseStatus} />}
            />
            <DiagnosticRow
              label="STRIPE_SECRET_KEY"
              sub="Required to create hosted Checkout sessions."
              value={<EnvStatusChip status={diagnostics.stripeSecretStatus} />}
            />
            <DiagnosticRow
              label="STRIPE_WEBHOOK_SECRET"
              sub="Required to trust Stripe webhooks during provisioning."
              value={<EnvStatusChip status={diagnostics.stripeWebhookStatus} />}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Link href={buildAuthStatusHref({ source: "unavailable", returnTo }) as Route} className="btn btn-sm">
            Refresh diagnostics
          </Link>
          <Link href="/" className="btn btn-sm">
            Marketing home
          </Link>
        </div>
      </div>
    </section>
  );
}
