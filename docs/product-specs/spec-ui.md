## Creative brief

### Product

**Savant** is an enterprise platform for turning expert knowledge into governed, reusable skills that can be versioned, tested, scored, approved, and distributed across AI tools and developer environments.

### Core concept

A skill is treated like **production software**, not loose prompt text.

The UI should communicate:

- governance
- provenance
- measurable quality
- release control
- enterprise trust
- Git-backed source of truth

### Primary users

Design primarily for:

- platform admins
- skill owners
- evaluators/reviewers
- security/compliance stakeholders

### Main product surfaces

The mockup should reflect these core surfaces:

- admin console
- skill catalog
- evaluation dashboard
- release dashboard
- Git repository connection / onboarding
- audit visibility

## Visual style

### Overall aesthetic

Use a **refined editorial-industrial enterprise** aesthetic.

Think:

- calm
- precise
- operational
- premium
- system-oriented
- serious, but not sterile

Avoid:

- sci-fi neon
- glowing glass cards
- purple/cyan gradients
- chat UI tropes
- rounded consumer-app softness
- “AI magic” visuals

### Memorable visual motif

The most distinctive element should be a **provenance rail** or **lifecycle rail** that visually connects:

**Repo → Commit/Ref → Eval → Approval → Release**

This should appear as a recurring visual pattern across the product, helping the UI feel uniquely Savant rather than generic SaaS.

### Color direction

Prefer a **light theme** with warm, intelligent neutrals and a few disciplined accents.

Suggested palette:

- background: warm paper / bone / soft stone
- primary text: deep charcoal or ink
- accent 1: muted moss or deep olive
- accent 2: brass / amber for approvals and release signals
- accent 3: controlled oxblood / rust for regressions and warnings
- accent 4: slate blue-gray for metadata and structure

Avoid pure black and pure white.

### Typography

Use a strong, modern sans-serif for UI and a restrained editorial serif for emphasis.

Suggested feel:

- body/UI: clean grotesk or contemporary enterprise sans
- headings: refined serif or elevated display serif used sparingly
- no techy monospace aesthetic as the main brand voice

### Layout

Prefer:

- asymmetric editorial layout
- dense but elegant information design
- fewer, larger structured panels instead of endless same-size cards
- sharp hierarchy
- left-aligned text
- visible rhythm in spacing

Avoid:

- card soup
- centered marketing-style hero layouts
- giant KPI tiles as the entire identity

## Product behavior to communicate visually

The mockup should make these concepts obvious at a glance:

- skills come from **external Git repositories**
- Savant stores governance, metadata, approvals, and release state
- every skill has source provenance
- every change can be evaluated and approved
- releases move through draft, staging, and production
- permissions and auditability matter

## Navigation model

Use a desktop-first enterprise app layout.

### Primary navigation

Left sidebar with sections like:

- Overview
- Skills
- Repositories
- Evaluations
- Releases
- Policies
- Audit
- Connectors
- Settings

### Top bar

Top bar should include:

- org switcher
- environment indicator
- search
- notifications
- user menu

## Key screens to mock up

If the AI can generate multiple screens, ask for **4 desktop screens**.

### 1. Admin overview

Purpose: show platform health and control.

Include:

- connected repositories summary
- pending approvals
- release queue
- regression alerts
- recently changed skills
- audit highlights
- environment status strip
- compact metrics, not giant vanity numbers

### 2. Skill catalog

Purpose: browse governed skills.

Include:

- searchable/filterable table or structured list
- columns for skill name, tier, owner, repo source, current version, release status, access state, score trend
- faceted filters for tier, status, owner, repo provider, environment
- right-side preview/details pane for selected skill

### 3. Skill detail + evaluation view

Purpose: show one skill as a governed artifact.

Include:

- skill title, owner, tier, tags
- Git source information
- branch / tag / commit reference
- version history
- approval timeline
- eval comparison between baseline and candidate
- rubric breakdown
- regression flags
- comments / reviewer notes
- provenance rail showing lifecycle

### 4. Release dashboard

Purpose: promote and rollback safely.

Include:

- environment progression: draft → staging → production
- approvals required / approvals completed
- release readiness checklist
- rollout state
- rollback controls
- downstream distribution targets
- signed bundle/build artifact status

### Optional 5th screen: Repository connection flow

Very useful because it reflects your differentiator.

Include a dual-path onboarding choice:

- **Connect existing repo**
- **Provision new repo from Savant template**

Show provider-agnostic support:

- GitHub
- GitLab
- Azure DevOps
- Bitbucket
- self-hosted Git

Do not make it feel GitHub-only.

## Important UI elements

Include these recurring components:

- repo/provider badges
- commit/reference chips
- approval badges
- environment pills
- structured audit timeline
- rubric score bars
- release progression rail
- empty states that teach the workflow
- side panels for metadata and permissions

## UX writing tone

Use copy that is:

- concise
- calm
- high-trust
- operational
- not hypey

Examples:

- “Connect a repository to ingest governed skills”
- “Candidate version introduces 2 regressions”
- “Awaiting security approval”
- “Production pinned to commit `a13f9c2`”
- “Rollback available”
- “No approved release for this environment”

Avoid copy like:

- “Supercharge your AI”
- “Magic automation”
- “Chat with your skills”
- “Instant intelligence”

## What to avoid

Tell the AI **not** to use:

- dark neon cyberpunk styling
- generic AI gradients
- floating glass cards everywhere
- chatbot bubbles
- giant centered hero stats
- decorative charts with no purpose
- icon-above-heading card grids repeated across the page
- consumer social-product vibes

## Single-screen priority version

If your mockup tool only does **one screen**, make it a **composite admin overview** that includes:

- left sidebar nav
- top bar
- repository onboarding/status panel
- skill registry table
- release queue section
- evaluation alerts section
- audit timeline
- provenance/release rail motif

That one screen should immediately communicate:

**“This is the enterprise system of record for Git-backed AI skills.”**