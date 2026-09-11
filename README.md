# Codex Command Center

Codex Command Center is a private, extensible engineering dashboard for trusted repository, delivery, project, and agent signals. Its first live adapter reads one configured private GitHub repository and exposes repository metadata, recent commits, branches, open pull requests, open issues, GitHub Actions runs, activity, and commit trends. Unavailable or empty data stays explicit; the application never manufactures dashboard metrics.

The application has one shared source tree and two supported local workflows:

- Next.js 16 App Router for normal local development and production-build validation.
- vinext and the Cloudflare Vite plugin for future Cloudflare Workers builds and local Worker previews.

## Production deployment is currently blocked

Do not expose this dashboard publicly. A first production deployment is forbidden until Cloudflare Zero Trust / Access is configured for the Worker, the Access policy denies anonymous requests before application execution, and an authorized-user policy has been tested. There is intentionally no homemade username/password system in this repository. Application-level Access JWT verification can be considered later as defense in depth.

No deploy command is run by CI. The deployment script exists only for a future, explicitly authorized deployment after the Access gate and encrypted runtime configuration are ready.

## Requirements and installation

- Node.js 20.19 or newer
- npm

Install the locked dependencies from the repository root:

```bash
npm ci
```

For local development, copy `.env.example` to `.env.local` and supply local values there. `.env.local` is ignored by Git. The example contains variable names only.

## Local Next.js workflow

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The normal production workflow remains available:

```bash
npm run build
npm start
```

## Cloudflare Workers / vinext workflow

The Cloudflare migration uses the current vinext path for Next.js 16:

```bash
npm run check:vinext
npm run dev:vinext
npm run build:vinext
npm run preview:workers
```

The vinext development server defaults to [http://localhost:3001](http://localhost:3001). `npm run preview:workers` runs the built Worker locally with Wrangler. `vite.config.ts` selects the Workers Cache API CDN adapter, no KV-backed data cache, and no image-optimization service. `wrangler.jsonc` enables Node.js compatibility so the same server-only environment boundary works in the Worker runtime.

The repository also contains `npm run deploy:vinext` for a future authorized deployment. Do not run it until Cloudflare Access and encrypted runtime configuration have been completed and reviewed.

## Runtime configuration and secrets

Local Next.js and vinext development use the ignored `.env.local` file. Production must supply the private GitHub credential as a Cloudflare encrypted secret or secret binding; it must never be placed in `wrangler.jsonc`, source code, package metadata, documentation values, client components, or a `NEXT_PUBLIC_*` variable. The repository owner and repository name are non-secret runtime configuration and can be supplied as Worker variables or bindings.

The server-only wrapper in `src/lib/providers/github.ts` is the only environment-reading boundary. It passes configuration into the provider core at runtime. Authenticated GitHub requests are read-only REST `GET` requests, use `cache: "no-store"`, and never expose authorization headers through provider results or UI data.

## Architecture

```text
.
├── .github/workflows/ci.yml       # Next.js and Worker verification; no deployment
├── app/                            # Shared App Router pages and dynamic dashboard layout
├── src/components/                 # Provider-agnostic dashboard presentation
├── src/lib/dashboard/              # Server query and pure view-model composition
├── src/lib/providers/              # Contracts, registry, GitHub core/wrapper, empty adapters
├── tests/                          # Transport-injected provider and view-model tests
├── .env.example                    # Variable names only
├── AGENTS.md                       # Permanent agent and deployment safety rules
├── next.config.ts                  # Normal Next.js configuration
├── vite.config.ts                  # vinext / Cloudflare Vite configuration
├── wrangler.jsonc                  # Secret-free Worker configuration
└── package.json                    # Next.js and Worker scripts
```

Presentation components depend on typed `DataResult<T>` and `ProviderHealth` contracts, never GitHub transport details. `src/lib/providers/registry.ts` remains the provider composition boundary. `src/lib/providers/github-core.ts` is runtime-portable and testable through an injected Fetch implementation; `src/lib/providers/github.ts` is marked server-only and reads runtime configuration. The target list is already modeled as a collection so additional repositories can be introduced without changing dashboard components.

## GitHub snapshot and request design

Each dashboard render asks the GitHub provider for one snapshot. For each configured repository, the adapter schedules at most six distinct capability operations: repository metadata, 30-day commits, branches, open pull requests, open issues, and recent Actions runs. A shared limiter permits no more than five active outbound GitHub operations. Activity, 7-day and 30-day trends, CI summaries, and overview metrics are derived locally from those results; they do not re-fetch the same capability.

The provider retains its individual capability methods for architectural compatibility, but they all reuse the same cached/in-flight snapshot. Concurrent callers deduplicate against one in-flight fetch.

Results are intentionally bounded:

- Commits cover the latest 30-day window and pagination is capped at 1,000 records per repository.
- Branch pagination is capped at 1,000 records per repository.
- Pull requests, issue records, and Actions runs are recent views capped at 100 records per repository.
- Composed activity is capped at the latest 50 records.

Typed bounds metadata records the cap and whether GitHub indicated truncation. The UI labels these as bounded results and uses an “at least” indicator when a result is known to be truncated.

## Cache design

GitHub project snapshots use a 60-second module-memory cache keyed by an encoded, sorted repository scope. The cache stores actual upstream fetch timestamps; rendering does not replace them. Authenticated upstream fetches and dynamically rendered dashboard responses remain private/no-store.

This is deliberately the smallest appropriate design for the current single-user deployment. In Workers it is isolate-local and best-effort: entries are not shared across isolates, regions, or cold starts, and therefore do not guarantee one global fetch per minute. In-flight calls within one isolate are deduplicated. If a refresh is temporarily rate-limited or fails because of a network/API error, an existing safe stale snapshot can be served with explicit degraded health and retry metadata. A shared KV, Durable Object, or database should only be introduced if measured traffic demonstrates a need for cross-isolate coordination.

The generated Cloudflare CDN adapter does not authorize public caching of private HTML or RSC payloads. Dashboard routes remain dynamic, and provider fetches opt out of HTTP caching. These protections must be rechecked in Worker preview and before every production rollout.

## Failure and rate-limit behavior

The provider distinguishes missing configuration, authentication failures, permission failures, primary rate exhaustion, secondary rate limiting, network errors, API errors, and valid empty results. `Retry-After` and `X-RateLimit-Reset` are converted into safe typed retry metadata. Raw GitHub error bodies, credentials, and request headers are not returned to the browser.

Repository metadata can succeed while a narrower capability fails. In that case GitHub health is `degraded`, the failing capability remains explicitly unavailable, and the Data Sources page shows the effective partial state instead of claiming full health.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check:vinext
npm run build:vinext
```

CI runs all six checks on pushes and pull requests. It does not deploy.

## Future integrations

Planned provider seams include Codex activity and usage telemetry where supported, project telemetry, Liquidation Terminal telemetry, multiple GitHub repositories, and additional read-only providers. Each integration must preserve typed results, server-only credentials, bounded concurrency, explicit freshness/failure semantics, and honest unavailable states.

## Git workflow

GitHub is the canonical source of truth. Inspect status and understand the provider architecture before editing. Run applicable checks and inspect the final diff. Do not change the configured remote, commit, push, create a pull request, or deploy without explicit authorization.
