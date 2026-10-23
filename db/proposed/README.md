# Proposed database changes — not deployed

The files under `db/proposed/` are **review-only**. Savant's `apps/web/scripts/apply-db-schema.mjs` reads `db/schema/` exclusively. Do not copy these proposals into `db/schema/` or apply them against production until PER-1592 establishes tested, independently recoverable DB and managed-encryption-key backup/restore and an explicit production-mvp migration authorization.

`0036_provider_role_grants_and_reservations.sql` is a staged candidate for PER-1602. It intentionally creates no provider grants, default bindings, actor permissions, price rows or spend capacity. On an unprovisioned database, the server fails closed. PostgreSQL execution, migration idempotence, rollback, and concurrency acceptance remain outstanding. It must be reviewed against the exact schema head and tested on an isolated recovered clone before activation.
