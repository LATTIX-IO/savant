import { NextResponse, type NextRequest } from "next/server.js";

import { auth0, isAuth0Configured } from "./lib/auth0.ts";
import {
  AUTH_SERVICE_UNAVAILABLE_CODE,
  AUTH_SERVICE_UNAVAILABLE_STATUS,
  createAuthServiceUnavailableApiBody,
  isApiRequestPath,
  renderAuthServiceUnavailableHtml,
} from "./lib/auth0-unavailable.ts";
import {
  getDashboardAuthAction,
  getAuthReturnTo,
  getLegacyAuthRedirectPath,
  isLocalDevAuthBypass,
} from "./lib/auth0-config.ts";

function createAuthUnavailableResponse(requestUrl: URL) {
  if (isApiRequestPath(requestUrl.pathname)) {
    return NextResponse.json(createAuthServiceUnavailableApiBody(), {
      status: AUTH_SERVICE_UNAVAILABLE_STATUS,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Savant-Error-Code": AUTH_SERVICE_UNAVAILABLE_CODE,
      },
    });
  }

  return new NextResponse(renderAuthServiceUnavailableHtml(), {
    status: AUTH_SERVICE_UNAVAILABLE_STATUS,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "X-Savant-Error-Code": AUTH_SERVICE_UNAVAILABLE_CODE,
    },
  });
}

export async function proxy(request: Request) {
  const client = auth0;
  const requestUrl = new URL(request.url);
  const legacyAuthRedirectPath = getLegacyAuthRedirectPath(requestUrl);

  if (legacyAuthRedirectPath) {
    return NextResponse.redirect(new URL(legacyAuthRedirectPath, requestUrl.origin), 307);
  }

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

    return createAuthUnavailableResponse(requestUrl);
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

  const loginUrl = new URL("/signin", requestUrl.origin);
  loginUrl.searchParams.set("returnTo", getAuthReturnTo(requestUrl));

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
