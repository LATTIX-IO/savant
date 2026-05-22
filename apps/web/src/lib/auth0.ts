import { Auth0Client } from "@auth0/nextjs-auth0/server";

import { hasAuth0EnvConfig } from "./auth0-config";

export const isAuth0Configured = hasAuth0EnvConfig(process.env);

export const auth0 = isAuth0Configured ? new Auth0Client() : null;
