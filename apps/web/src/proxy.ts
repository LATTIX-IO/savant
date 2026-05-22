import { NextResponse, type NextRequest } from "next/server";

import { auth0, isAuth0Configured } from "./lib/auth0";
import {
  getDashboardAuthAction,
  getAuthReturnTo,
  isLocalDevAuthBypass,
} from "./lib/auth0-config";

export async function proxy(request: Request) {
  const client = auth0;
  const requestUrl = new URL(request.url);
  const isLocalDevBypass = isLocalDevAuthBypass(requestUrl);
  const isConfigured = isAuth0Configured && client !== null;

  if (!isConfigured) {
    const action = getDashboardAuthAction({
      isConfigured: false,
      isLocalDevBypass,
      pathname: requestUrl.pathname,
      hasSession: false,
    });

    if (action === "allow") {
      return NextResponse.next();
    }

    throw new Error(
      "Auth0 is not configured. Set APP_BASE_URL, AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, and AUTH0_SECRET.",
    );
  }

  const configuredClient = client;

  if (!configuredClient) {
    throw new Error(
      "Auth0 client became unavailable after configuration checks. Restart the server and verify your Auth0 environment variables.",
    );
  }

  const authResponse = await configuredClient.middleware(request);
  const session = await configuredClient.getSession(request as NextRequest);
  const action = getDashboardAuthAction({
    isConfigured: true,
    isLocalDevBypass,
    pathname: requestUrl.pathname,
    hasSession: Boolean(session),
  });

  if (action === "allow") {
    return authResponse;
  }

  const loginUrl = new URL("/auth/login", requestUrl.origin);
  loginUrl.searchParams.set("returnTo", getAuthReturnTo(requestUrl));

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
