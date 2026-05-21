# `db`

PostgreSQL schema assets, migrations, seeds, and query utilities for Savant's control plane.

## Source-of-truth rule

The database is **not** the canonical store for tenant-authored skills or authored evaluation assets.

- External Git repositories remain canonical for skill packages, registry files, and authored eval assets.
- PostgreSQL is canonical for control-plane state and rebuildable read models only.

If a record can be deterministically rebuilt by scanning a repository at a known commit SHA, it should be modeled as a derived index, not as primary product truth.

## Table groups

### Canonical control-plane tables

These store state that is not hosted in Git:

- organizations, users, groups, and memberships
- role bindings and policy bindings
- Git provider connections, repository registrations, and sync state
- review requests, comments, release approvals, and rollout targets
- connector installations and sync runs
- workspace settings and immutable audit events

### Rebuildable derived tables

These tables cache Git-derived metadata for fast UI queries and search:

- indexed skills
- indexed skill versions and dependency edges
- indexed evaluation assets and result summaries
- indexed release manifests

All derived rows should include repository identity, source path, commit SHA, and index timestamps so the canonical source remains explicit.

## Current foundation

The initial SQL foundation lives in `db/schema/0001_control_plane.sql`.

It establishes the first split between:

- canonical control-plane tables
- rebuildable Git-derived index tables

Any future migration system should preserve that boundary rather than flatten everything into one big “stuff happened here” schema blob.
