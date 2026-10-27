# JK External API Design

## Product

JK External API is a read-only public index that connects Korean external data sources, the data they expose, useful technologies, k-skill entries, and six practical project blueprints. The deployed site lives below `/jk-external-api/`; a separate Cloudflare Worker provides six allow-listed live previews without exposing secrets or becoming a generic proxy.

## Boundaries

- `packages/catalog` owns validated source, skill, blueprint, technology, and preview contracts plus generated catalog data.
- `apps/site` owns the Astro static site and Preact interactions for search, filtering, the home relationship view, comparison, and previews.
- `apps/preview-worker` owns Hono routes, query validation, upstream adapters, normalized responses, caching, CORS, and rate limiting.
- All relationships use IDs validated by Zod. No database, account, location permission, analytics, cookie, CMS, write API, or user-specific state is introduced.

## Catalog

The first release contains exactly 14 curated source groups, six blueprints, and a generated snapshot of every upstream k-skill entry. External descriptions are summarized; records store attribution, official links, and verification dates rather than copied source material. A GitHub-tree/frontmatter sync command merges upstream entries with explicit manual overrides and fails safely on malformed data or rate limits.

## Site experience

The home route is a deterministic 12-column layout: a two-column source rail, seven-column SVG route map, and three-column selection dossier. Explicit `home.x`, `home.y`, and `home.lines` values make the graph stable. On narrow screens, the SVG yields to an equivalent accessible list ordered search → domain → source → detail. Search spans names, summaries, keywords, fields, and technologies; filters cover domain, delivery, authentication, freshness, and geography. Comparison accepts at most four sources.

The visual system resembles a Korean public-record index: white record stock (`#FBFBFC`), ink (`#141B27`), public blue (`#2357A5`), field green (`#687C46`), exception red (`#BA3A36`), and ruled pale blue (`#EEF2F7`). MaruBuri is the restrained display face, Pretendard Variable the body face, and IBM Plex Mono the catalog utility face. The signature element is the home route's relationship map itself: line colors represent domains while every state also has an icon and text label. Corners and dividers remain square and document-like; motion is limited to route drawing and selection and disappears under reduced motion.

## Preview service

The Worker exposes health plus weather, air quality, transit arrival, public facilities, places, and performances routes. Each route validates bounded query input, maps only to its known upstream endpoint, uses a five-second timeout, and returns the shared discriminated response. Cache keys use normalized sorted query strings with adapter-specific TTLs. Only GET and OPTIONS are accepted; configured Pages and localhost origins receive CORS headers; a Cloudflare rate-limiter binding enforces 30 requests per 60 seconds per client IP.

## Failure behavior

Static content never depends on the Worker. A preview failure renders its stable error code, retryability, and official source link inside that widget while the rest of the page remains usable. Missing secrets report `NOT_CONFIGURED`; invalid input, empty results, upstream timeouts, throttling, outages, and format drift map to the documented error union. Health discloses only version and adapter activation booleans.

## Verification and delivery

Vitest covers schemas, catalog relationships, synchronization, and Worker adapters. Playwright covers search and compound filters, deterministic selection, direct routes, four-item comparison, copy controls, fallback widgets, 360px layout, keyboard use, and critical axe findings. CI runs lint, typecheck, tests, build, internal-link checks, and E2E. Main deploys the static artifact through GitHub Pages; Worker deployment remains a production-environment-approved manual workflow. A Monday 09:00 KST workflow proposes reviewed catalog changes and opens issues for outages.
