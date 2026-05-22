import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0, isAuth0Configured } from "@/lib/auth0";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create your Savant workspace",
  description:
    "Start a 14-day Savant trial. Sign in with Auth0 and configure your workspace in under a minute.",
};

type SignupSearchParams = {
  cycle?: string;
  seats?: string;
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<SignupSearchParams>;
}) {
  const params = await searchParams;
  const session = auth0 ? await auth0.getSession() : null;

  const onboardingTarget = (() => {
    const next = new URLSearchParams();
    if (params.cycle) next.set("cycle", params.cycle);
    if (params.seats) next.set("seats", params.seats);
    return (next.size ? `/onboarding?${next}` : "/onboarding") as Route;
  })();

  // If they're already signed in, skip Auth0 and drop them into the onboarding
  // wizard where they pick a workspace name, seat count, and billing cycle.
  if (session?.user) {
    redirect(onboardingTarget);
  }

  // Not signed in — hand them off to Auth0's signup screen. The Auth0 SDK
  // mounts /api/auth/login (with screen_hint=signup) automatically when
  // `isAuth0Configured` is true. Stash the cycle in returnTo so we can pick
  // it back up after the callback.
  if (isAuth0Configured) {
    const qs = new URLSearchParams({
      screen_hint: "signup",
      returnTo: onboardingTarget,
    });
    redirect(`/api/auth/login?${qs.toString()}` as Route);
  }

  // Local-dev fallback when Auth0 isn't configured: hop straight into onboarding.
  redirect(onboardingTarget);
}
