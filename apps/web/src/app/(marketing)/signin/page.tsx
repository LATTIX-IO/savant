import type { Route } from "next";
import { redirect } from "next/navigation";

import { auth0, isAuth0Configured } from "@/lib/auth0";
import { normalizeReturnToPath } from "@/lib/auth0-config";
import { isOnboardingSandboxEnabled } from "@/lib/onboarding-runtime";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in to Savant",
  description:
    "Continue to Savant with Auth0. Sign in to access your dashboard, onboarding, and protected workspace routes.",
};

type SigninSearchParams = {
  returnTo?: string;
};

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<SigninSearchParams>;
}) {
  const params = await searchParams;
  const target = normalizeReturnToPath(params.returnTo, "/dashboard");
  const session = auth0 ? await auth0.getSession() : null;

  if (session?.user) {
    redirect(target as Route);
  }

  if (isOnboardingSandboxEnabled()) {
    redirect(target as Route);
  }

  if (isAuth0Configured) {
    const loginParams = new URLSearchParams({
      returnTo: target,
    });
    const loginHref = `/auth/login?${loginParams.toString()}`;
    redirect(loginHref as Route);
  }

  redirect(target as Route);
}