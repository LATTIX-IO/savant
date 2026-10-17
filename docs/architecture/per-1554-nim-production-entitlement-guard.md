# PER-1554 — Production entitlement guard for NVIDIA Developer NIM catalog

NVIDIA's official FAQ states access through its Developer Program is limited to research, prototyping, development and testing, and commercial production requires NVIDIA AI Enterprise licensing. The catalog hostname `integrate.api.nvidia.com` is the existing Savant server-side default. Sources: https://docs.api.nvidia.com/nim/docs/product and https://docs.api.nvidia.com/nim/docs/run-anywhere .

The default hosted catalog **must not serve production end-users on the assumption that possessing an API key constitutes commercial permission**. The `createNimChatClient.complete` shared inference path now invokes a production entitlement guard before any provider I/O when `VERCEL_ENV=production` or `SAVANT_DEPLOYMENT_ENV=production`. It denies the developer catalog host regardless of caller-supplied environment license claims. This changes no API keys, billing state or production deployments.

The guard permits development/preview testing under the developer program terms. A different server-configured host is outside this precise restriction but is **not thereby certified** for commercial use; self-hosted NIM licensing, hosting agreements, private vendor accounts, provider TOS and secure egress approvals remain separate preconditions.

To authorize production NIM in the future, obtain actual provider account and contract confirmation under PER-1552 (including permitted endpoint, account, entitlement type and expiry). Independently review the evidence and deploy under an approved licensed host or an explicitly vetted contracted hosted endpoint. Do not add a `VERIFIED=true` bypass flag. Do not use public token costs as a surrogate for contracted GPU licensing.

Unit tests enforce production denial and zero provider network calls with the actual factory, preview eligibility, invalid protocol denial, origin canonicalization and fake license-claim rejection. CI must pass Node, lint, TypeScript, Next production build, secrets, PostgreSQL and high/critical dependency audit.

This increment is compliance protection, not proof of a commercial NIM entitlement. BYO OpenAI costs remain externally billed; Jev order/credits remain separate from NVIDIA licensing.
