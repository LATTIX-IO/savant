import { Auth0Client } from "@auth0/nextjs-auth0/server";

import { hasAuth0EnvConfig, resolveAuth0AppBaseUrl, resolveAuth0Domain } from "./auth0-config.ts";

const resolvedAuth0AppBaseUrl = resolveAuth0AppBaseUrl(process.env);
const resolvedAuth0Domain = resolveAuth0Domain(process.env);

if (resolvedAuth0Domain && process.env.AUTH0_DOMAIN !== resolvedAuth0Domain) {
	process.env.AUTH0_DOMAIN = resolvedAuth0Domain;
}

if (resolvedAuth0AppBaseUrl && process.env.APP_BASE_URL !== resolvedAuth0AppBaseUrl) {
	process.env.APP_BASE_URL = resolvedAuth0AppBaseUrl;
}

export const isAuth0Configured = hasAuth0EnvConfig(process.env);

export const auth0 = isAuth0Configured ? new Auth0Client() : null;
