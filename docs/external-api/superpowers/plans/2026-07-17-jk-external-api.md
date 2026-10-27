# JK External API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the complete JK External API static site, shared catalog, read-only preview Worker, and deployment automation described in the approved design.

**Architecture:** A pnpm workspace separates a Zod-validated catalog from an Astro/Preact static site and a Hono Cloudflare Worker. Generated data flows one way from upstream k-skill metadata plus manual overrides into catalog JSON, then into pre-rendered pages; live previews are optional isolated widgets using shared contracts.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript, Astro, Preact, Zod, Fuse.js, Hono, Cloudflare Workers, Vitest, Miniflare, Playwright, axe-core.

## Global Constraints

- GitHub Pages base path is `/jk-external-api/`.
- The catalog contains 14 source groups, six blueprints, and a complete generated k-skill snapshot.
- All relationships are validated ID arrays; no database or write API exists.
- Secrets are server environment variables only and never enter site bundles or examples.
- Preview routes are allow-listed, GET/OPTIONS only, bounded, cached, and limited to 30 requests per 60 seconds per IP.
- Static content remains usable when every live preview fails.

---

### Task 1: Workspace and catalog contracts

**Files:** root workspace configuration; `packages/catalog/src/schema.ts`; schema fixtures and tests.

- [ ] Write schema tests for required fields, duplicate IDs, broken relations, invalid URLs/dates/coordinates, and stale verification dates; run them and confirm missing-module failure.
- [ ] Implement the shared Zod contracts and catalog validator; rerun tests to green.
- [ ] Add root lint, typecheck, test, and build commands and pin Node/pnpm versions.

### Task 2: Curated content and k-skill synchronization

**Files:** `packages/catalog/src/data/*`; `packages/catalog/src/sync/*`; generated JSON; sync fixtures/tests.

- [ ] Write failing tests for 14 source groups, six blueprints, merge behavior, add/delete/description changes, malformed frontmatter, and GitHub rate limits.
- [ ] Add curated source/technology/blueprint records with official attribution and verified ID relationships.
- [ ] Implement GitHub tree/frontmatter ingestion and override merging, then generate the complete snapshot and rerun tests.

### Task 3: Static Atlas application

**Files:** `apps/site/src/layouts`, `components`, `pages`, `styles`, `lib`; component and browser tests.

- [ ] Write failing search/filter/compare state tests, then implement Fuse-based search, compound filters, and four-item comparison.
- [ ] Build pre-rendered index/detail routes for sources, skills, blueprints, technologies, and comparison.
- [ ] Implement the explicit-coordinate SVG Atlas, selected dossier, keyboard interaction, equivalent mobile list, reduced motion, local font declarations, and the approved record-index token system.
- [ ] Add resilient preview widgets and secure environment-driven API base URL.

### Task 4: Preview Worker

**Files:** `apps/preview-worker/src`; `wrangler.jsonc`; Worker tests.

- [ ] Write failing tests for validation, success, no results, timeout, 429, 5xx, malformed XML/JSON, cache hit/miss, CORS, rate limiting, and missing secrets.
- [ ] Implement normalized response helpers and the six injected upstream adapters.
- [ ] Add Hono routing, five-second cancellation, normalized cache keys/TTLs, allow-listed CORS, method rejection, health output, and rate-limiter binding.

### Task 5: Automation, documentation, and verification

**Files:** `.github/workflows/*`; README; environment examples; Playwright configuration and E2E specs.

- [ ] Add CI, official Pages deployment, approved manual Worker deployment, and Monday 09:00 KST catalog/health checks.
- [ ] Document setup, secrets, attribution, licensing, deployment gates, and failure behavior.
- [ ] Run lint, typecheck, all unit/integration tests, Astro build, internal-link validation, Playwright desktop/mobile/keyboard/axe tests, and `git diff --check`.
- [ ] Inspect rendered pages at desktop and 360px, correct visual/accessibility issues, then repeat the full verification suite.
