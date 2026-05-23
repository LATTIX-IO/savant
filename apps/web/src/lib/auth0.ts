import { NextResponse } from "next/server.js";
import { Auth0Client } from "@auth0/nextjs-auth0/server";

import {
	hasAuth0EnvConfig,
	normalizeReturnToPath,
	readConfiguredEnvValue,
	resolveAuth0AppBaseUrl,
	resolveAuth0ClientId,
	resolveAuth0Domain,
} from "./auth0-config.ts";
import {
	buildAuthCallbackFailureHref,
	extractAuthCallbackFailure,
} from "./auth0-callback.ts";

const resolvedAuth0AppBaseUrl = resolveAuth0AppBaseUrl(process.env);
const resolvedAuth0ClientId = resolveAuth0ClientId(process.env);
const resolvedAuth0ClientSecret = readConfiguredEnvValue(process.env.AUTH0_CLIENT_SECRET);
const resolvedAuth0Domain = resolveAuth0Domain(process.env);
const resolvedAuth0Secret = readConfiguredEnvValue(process.env.AUTH0_SECRET);

if (resolvedAuth0Domain && process.env.AUTH0_DOMAIN !== resolvedAuth0Domain) {
	process.env.AUTH0_DOMAIN = resolvedAuth0Domain;
}

if (resolvedAuth0ClientId && process.env.AUTH0_CLIENT_ID !== resolvedAuth0ClientId) {
	process.env.AUTH0_CLIENT_ID = resolvedAuth0ClientId;
}

if (resolvedAuth0ClientSecret && process.env.AUTH0_CLIENT_SECRET !== resolvedAuth0ClientSecret) {
	process.env.AUTH0_CLIENT_SECRET = resolvedAuth0ClientSecret;
}

if (resolvedAuth0AppBaseUrl && process.env.APP_BASE_URL !== resolvedAuth0AppBaseUrl) {
	process.env.APP_BASE_URL = resolvedAuth0AppBaseUrl;
}

if (resolvedAuth0Secret && process.env.AUTH0_SECRET !== resolvedAuth0Secret) {
	process.env.AUTH0_SECRET = resolvedAuth0Secret;
}

export const isAuth0Configured = hasAuth0EnvConfig(process.env);

export const auth0 = isAuth0Configured ? new Auth0Client({
	onCallback: async (error, ctx) => {
		if (error) {
			const failure = extractAuthCallbackFailure(error);

			console.error("[auth/callback] failed", {
				sdkErrorCode: failure.sdkErrorCode ?? "unknown",
				oauthErrorCode: failure.oauthErrorCode,
				oauthErrorDescription: failure.oauthErrorDescription,
				responseType: ctx.responseType ?? null,
				challengeMode: ctx.challengeMode ?? "redirect",
				appBaseUrlConfigured: Boolean(ctx.appBaseUrl || resolvedAuth0AppBaseUrl),
				hasReturnTo: Boolean(ctx.returnTo),
			});

			if (ctx.challengeMode === "popup") {
				return new NextResponse(null, {
					status: 200,
					headers: {
						"Cache-Control": "no-store, max-age=0",
					},
				});
			}

			const appBaseUrl = ctx.appBaseUrl ?? resolvedAuth0AppBaseUrl;

			if (!appBaseUrl) {
				return new NextResponse("Authentication callback failed.", {
					status: 500,
					headers: {
						"Cache-Control": "no-store, max-age=0",
						"X-Savant-Error-Code": failure.sdkErrorCode ?? "auth_callback_error",
					},
				});
			}

			const failureHref = buildAuthCallbackFailureHref({
				returnTo: ctx.returnTo,
				sdkErrorCode: failure.sdkErrorCode,
				oauthErrorCode: failure.oauthErrorCode,
				oauthErrorDescription: failure.oauthErrorDescription,
			});

			return NextResponse.redirect(new URL(failureHref, appBaseUrl));
		}

		const appBaseUrl = ctx.appBaseUrl ?? resolvedAuth0AppBaseUrl;

		if (!appBaseUrl) {
			throw new Error("appBaseUrl could not be resolved for the callback redirect.");
		}

		const safeReturnTo = normalizeReturnToPath(ctx.returnTo, "/");

		return NextResponse.redirect(new URL(safeReturnTo, appBaseUrl));
	},
}) : null;
