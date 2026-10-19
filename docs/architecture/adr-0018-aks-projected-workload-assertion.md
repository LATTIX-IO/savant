# ADR-0018 — AKS rotating projected service-account assertion reader

**Status:** Internal, filesystem-backed workload-identity assertion source for PER-1059; does not provision Kubernetes, Entra, networking, or production identities.

## Decision and scope

Savant is a QA and observability system for customer-owned AI skills/workflows. The previous increment introduced an Entra workload-federation token exchange but required an injected assertion reader. This increment supplies `createAksProjectedAssertionReader` for the projected Azure workload-identity token file. It is passed to `createAzureFederatedWorkloadTokenProvider({readFederatedAssertion})`, then to the Azure Key Vault version-pinned resolver, tenant-owned status connector, and durable evidence reconciler.

A deployment must supply the exact token path from **`AZURE_FEDERATED_TOKEN_FILE`** and an explicit trusted **read-only projected volume root**. AKS rotates the projected token, so the reader resolves and opens a **fresh file on each exchange**; never cache a JWT in process. Kubernetes projected volumes use internal `..data` symlinks; a blanket `O_NOFOLLOW` on the configured path is incompatible with safe rotation. This implementation resolves the path and the trusted mount root for each read, rejects targets escaping the canonical root (including a symlink to an external file), then opens the resolved final target read-only with `O_NOFOLLOW` and validates a bounded regular file of at most 16 KiB. A rename/rotation race fails closed and can be retried by the next normal reconciliation attempt. No assertion is logged or stored in PostgreSQL.

## Local assertions and external cryptographic trust

To catch obvious misconfiguration before network I/O, verify JWT syntax and canonical base64url JSON header/payload, `RS256|ES256` algorithm metadata, **exact deployment-configured OIDC issuer and Kubernetes service-account subject**, single direct-federation audience `api://AzureADTokenExchange`, future expiration with a minimum 30-second margin and maximum 24-hour window, and nonfuture `iat`/`nbf`. The identity-binding-proxy audience `api://AKSIdentityBinding` is expressly **not** interchangeable with direct Entra token exchange.

**Local claim checks do not verify the JWT signature.** Trust rests on the protected Kubernetes projected mount plus Entra's actual OIDC signature/issuer/subject/audience verification against an independently provisioned federated identity credential. The injected assertion file path, mount root, expected issuer and subject are **server-controlled deployment configuration**, never HTTP or tenant input. The file must not be user-writable. Pods must have the AKS workload-identity mutation label and a correctly annotated service account, with least-privilege Azure Key Vault secret-get authorization, restricted egress and TLS verification.

## Verification

- Unit/security: Kubernetes-style `..data` symlinks within root succeed, rotation causes next exchange to read new bytes, target symlink escaping the projected mount fails, missing/empty/oversized/malformed token fails, `none`/HMAC algorithms rejected, and wrong issuer, subject, audience (including identity-binding audience), expiry, future issuance and future not-before fail before Entra I/O.
- PostgreSQL integration: generate a synthetic projected AKS token filesystem; feed it through the private Entra token exchange transport, version-pinned Azure Key Vault HMAC reader, enabled tenant-scoped connector, signed provider status verifier, and immutable metadata-only reconciliation receipt. This is a **mocked federation response**, not a claim of live Azure RBAC or actual signing.
- Exact-head CI: existing Node/Python, lint, TypeScript, Next production build, committed-secret scanner, blocking production dependency audit, isolated PostgreSQL schema applied twice, and tenant/dispatch/concurrency/security integrations. Independent security review required before any merge.

## Deployment gating and remaining work

Before production enablement, deploy an AKS projected service-account token volume and `AZURE_FEDERATED_TOKEN_FILE`; configure expected issuer, namespace/service account, subject and FIC with Entra; verify managed identity and Key Vault RBAC; demonstrate TLS- and DNS/IP-pinned egress for both Entra and Key Vault; and run a supervised live federation, rotation/revocation and customer-harness status smoke. The existing code does **not** supply an authenticated HTTP management route, real external worker supervisor, final result/cancellation reconciliation, result ingestion, scorecards or cost settlement. **PER-1059 and Savant MVP remain In Progress.**

Reference: Microsoft Learn, AKS Workload Identity documentation, `https://learn.microsoft.com/azure/aks/workload-identity-overview`.
