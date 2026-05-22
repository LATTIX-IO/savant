import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0, isAuth0Configured } from "@/lib/auth0";
import { normalizeReturnToPath } from "@/lib/auth0-config";
import {
  buildOnboardingReturnToPath,
  isOnboardingSandboxEnabled,
} from "@/lib/onboarding-runtime";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create your Savant workspace",
  description:
    "Start a 14-day Savant trial. Sign in with Auth0 and configure your workspace in under a minute.",
};

type SignupSearchParams = {
  cycle?: string;
  seats?: string;
  returnTo?: string;
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SignupSearchParams>;
}) {
  const params = await searchParams;
  const session = auth0 ? await auth0.getSession() : null;

  const onboardingTarget = buildOnboardingReturnToPath({
    cycle: params.cycle,
    seats: params.seats,
  });
  const target = normalizeReturnToPath(params.returnTo, onboardingTarget);

  // If they're already signed in, skip Auth0 and drop them into the onboarding
  // wizard where they pick a workspace name, seat count, and billing cycle.
  if (session?.user) {
    redirect(target as Route);
  }

  if (isOnboardingSandboxEnabled()) {
    redirect(target as Route);
  }

  // Not signed in — hand them off to Auth0's signup screen through the
  // canonical Next.js SDK route. Stash the final target in returnTo so we can
  // pick it back up after the callback.
  if (isAuth0Configured) {
    const qs = new URLSearchParams({
      screen_hint: "signup",
      returnTo: target,
    });
    const loginHref = `/auth/login?${qs.toString()}`;
    redirect(loginHref as Route);
  }

  // Local-dev fallback when Auth0 isn't configured: hop straight into onboarding.
  redirect(target as Route);
}
