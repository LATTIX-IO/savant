import { Auth0Client } from "@auth0/nextjs-auth0/server";

import { hasAuth0EnvConfig, resolveAuth0AppBaseUrl } from "./auth0-config.ts";

const resolvedAuth0AppBaseUrl = resolveAuth0AppBaseUrl(process.env);

if (resolvedAuth0AppBaseUrl && process.env.APP_BASE_URL !== resolvedAuth0AppBaseUrl) {
	process.env.APP_BASE_URL = resolvedAuth0AppBaseUrl;
}

export const isAuth0Configured = hasAuth0EnvConfig(process.env);

export const auth0 = isAuth0Configured ? new Auth0Client() : null;
