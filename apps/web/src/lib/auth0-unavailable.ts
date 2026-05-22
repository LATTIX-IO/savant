export const AUTH_SERVICE_UNAVAILABLE_STATUS = 503;
export const AUTH_SERVICE_UNAVAILABLE_CODE = "auth_service_unavailable";

const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  "Authentication service is unavailable for this deployment.";

export function isApiRequestPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function createAuthServiceUnavailableApiBody() {
  return {
    error: {
      code: AUTH_SERVICE_UNAVAILABLE_CODE,
      message: AUTH_SERVICE_UNAVAILABLE_MESSAGE,
    },
  };
}

export function renderAuthServiceUnavailableHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Savant unavailable</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #fdfcfe;
        --panel: #ffffff;
        --text: #121619;
        --muted: #5f6a72;
        --rule: #d8dde2;
        --accent: #1f7a55;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(560px, 100%);
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 10px 32px rgba(18, 22, 25, 0.06);
      }

      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.15;
      }

      p {
        margin: 0 0 12px;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.55;
      }

      a {
        color: var(--accent);
        font-weight: 600;
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      code {
        display: inline-block;
        margin-top: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--rule);
        background: #f5f7f8;
        color: var(--text);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Savant</p>
      <h1>Authentication is required before this deployment can serve Savant.</h1>
      <p>${AUTH_SERVICE_UNAVAILABLE_MESSAGE}</p>
      <p>
        Configure the deployment's identity provider settings, then retry the request.
        Local loopback development continues to bypass auth when running in development mode.
      </p>
      <p>
        Review the public <a href="/auth-status">Auth status</a> page to verify the deployment's
        Auth0 domain, callback URL, hosted Universal Login routes, and onboarding prerequisites.
      </p>
      <code>${AUTH_SERVICE_UNAVAILABLE_CODE}</code>
    </main>
  </body>
</html>`;
}