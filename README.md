# Codex Command Center

Codex Command Center is a private, extensible engineering dashboard for trusted repository, delivery, project, and agent signals. Its live adapters read a configured private GitHub repository and privacy-filtered Codex OpenTelemetry logs stored in Cloudflare D1. Unavailable or empty data stays explicit; the application never manufactures dashboard metrics.

The application has one shared source tree and two supported local workflows:

- Next.js 16 App Router for normal local development and production-build validation.
- vinext and the Cloudflare Vite plugin for future Cloudflare Workers builds and local Worker previews.

## Production deployment is currently blocked

Do not expose this dashboard publicly. A first production deployment is forbidden until Cloudflare Zero Trust / Access is configured for the Worker, the Access policy denies anonymous requests before application execution, and an authorized-user policy has been tested. There is intentionally no homemade username/password system in this repository. Application-level Access JWT verification can be considered later as defense in depth.

No deploy command is run by CI. The deployment script exists only for a future, explicitly authorized deployment after the Access gate and encrypted runtime configuration are ready.

## Requirements and installation

- Node.js 22 or newer
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
├── migrations/                     # Versioned D1 telemetry schema
├── scripts/telemetry-relay.ts      # Loopback-only OTLP relay for Codex
├── src/components/                 # Provider-agnostic dashboard presentation
├── src/lib/dashboard/              # Server query and pure view-model composition
├── src/lib/providers/              # Contracts, registry, GitHub/Codex adapters
├── src/lib/telemetry/              # OTLP decoding, privacy filtering, ingestion, and D1 access
├── tests/                          # Transport-injected provider and view-model tests
├── .env.example                    # Variable names only
├── AGENTS.md                       # Permanent agent and deployment safety rules
├── next.config.ts                  # Normal Next.js configuration
├── vite.config.ts                  # vinext / Cloudflare Vite configuration
├── wrangler.jsonc                  # Secret-free Worker configuration
└── package.json                    # Next.js and Worker scripts
```

Presentation components depend on typed `DataResult<T>` and `ProviderHealth` contracts, never GitHub transport details. `src/lib/providers/registry.ts` remains the provider composition boundary. `src/lib/providers/github-core.ts` is runtime-portable and testable through an injected Fetch implementation; `src/lib/providers/github.ts` is marked server-only and reads runtime configuration. The target list is already modeled as a collection so additional repositories can be introduced without changing dashboard components.

The Codex path follows the same separation. The ingestion core accepts standard Web requests and a narrow D1 interface. The server-only Cloudflare adapter supplies the `CODEX_TELEMETRY_DB` binding and dedicated ingestion secret. Dashboard queries consume the typed Codex provider; components never import D1, the relay, Cloudflare bindings, or credentials.

## Codex telemetry pipeline

```text
Codex OTLP logs
  -> http://127.0.0.1:14318/v1/logs
  -> loopback-only local relay
  -> Cloudflare Access service-token authentication
  -> POST /api/telemetry/ingest
  -> dedicated ingestion-key verification
  -> privacy normalization and bounded batch writes
  -> CODEX_TELEMETRY_DB (D1)
  -> typed Codex provider
  -> Overview, Codex Activity, Usage, and Data Sources
```

The relay listens only on IPv4 loopback. It accepts OTLP/HTTP protobuf or JSON, preserves the payload content type, and adds `CF-Access-Client-Id`, `CF-Access-Client-Secret`, and `X-Codex-Telemetry-Key` only on the outbound request. Relay credentials are separate from GitHub credentials. The relay never prints configuration values or payloads.

Cloudflare Access is the external identity gate. Configure a service-token Access policy for the ingest path and an authorized-user policy for dashboard routes. The application-level ingestion key is an additional server-side check, not a replacement for Access. Never make the ingest path publicly reachable merely because it also checks the dedicated key.

### Local relay configuration

Keep these local relay variables in ignored `.env.local`; never place their values in tracked files:

- `TELEMETRY_COLLECTOR_URL`
- `TELEMETRY_INGEST_KEY`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

Start the relay from the repository root:

```bash
npm run telemetry:relay
```

### Windows Codex OTLP configuration

Edit `%USERPROFILE%\.codex\config.toml` and preserve every unrelated setting. Current official Codex configuration uses the `[otel]` table with an inline `otlp-http` exporter. Prompt content remains disabled:

```toml
[otel]
environment = "prod"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "http://127.0.0.1:14318/v1/logs", protocol = "binary" } }
```

Restart Codex after changing the configuration. The exporter supports OTLP/HTTP binary protobuf and JSON; binary is the default used here. Do not add prompt logging, authorization headers, or service credentials to Codex configuration—the loopback relay owns authentication to the remote collector.

### Event normalization and privacy

The normalizer recognizes the current Codex operational event families, including startup, session, model/API, usage, tool, approval, MCP, network, warning, and error events. OTLP `event.kind` participates in event identity when a dedicated event name or safe Codex body is absent. Category selection uses explicit event semantics first and reviewed retained fields second; a session identifier by itself does not force an otherwise unknown event into a known category. Unknown events retain only a bounded event identity and sanitized attribute-key names so schema drift remains diagnosable.

The following are never persisted: user email/account identity, host names, reasoning summaries, authorization or cookie headers, API keys, access or refresh tokens, passwords, private keys, client secrets, prompt text, request/response bodies, commands, tool arguments, stdout/stderr, or full tool results. Endpoint values and arbitrary unknown attribute values are also discarded. Identifiers and recognized operational scalar fields are length- and range-bounded before storage. Raw `call_id` is replaced with a one-way SHA-256 correlation hash before persistence. Ingestion payloads remain capped at 1 MiB and 500 log records.

Prompt logging is off by default and must remain off unless a separate privacy review explicitly authorizes it. Even if prompt or tool-output fields arrive accidentally, the ingestion boundary drops them before D1 writes.

### D1 schema, retention, and bindings

`migrations/0001_codex_telemetry.sql` creates the base event table. The additive `migrations/0002_codex_analytics_v2.sql` adds reviewed scalar fields for event kind, reasoning effort, cache-write/reasoning/tool tokens, TTFT, tool namespace and lifecycle, hashed call correlation, approval/sandbox policy, MCP origin, agent/provider/originator, and version/startup diagnostics. It also best-effort reclassifies legacy `unknown` rows only from values already retained by v1. Values discarded by v1 cannot be recovered. Schema-v1 and schema-v2 rows remain queryable together. Event fingerprints retain their unique constraint, and ingestion continues to use prepared statements and D1 batches capped at 50 writes.

Raw events default to 30-day retention through `CODEX_TELEMETRY_RETENTION_DAYS`; cleanup runs after successful ingestion. The configured value is bounded to 1–365 days. Long-term rollups are intentionally not fabricated or precomputed yet; add them only when a real product requirement defines their fields and retention.

Before an authorized deployment, apply pending checked-in migrations to the configured D1 database and confirm the encrypted Worker secret named `CODEX_TELEMETRY_INGEST_KEY` remains available. Do not put the secret value in Wrangler configuration. Local schema verification can use:

```bash
npx wrangler d1 migrations apply codex-command-center-telemetry --local
```

Applying remote migrations, creating encrypted production secrets, configuring Access, and deploying are production operations and require explicit authorization.

### Dashboard semantics

Codex Activity reports real stored events, 24-hour/7-day/30-day trends, event categories, models, reasoning effort, tool-related events, deduplicated completed tool executions, failures, approvals, sandbox policy, MCP dimensions, agent/provider/originator dimensions, startup/version diagnostics, timings, sessions, and recent warnings/errors. Tool lifecycle events with the same hashed call identifier count as one completed execution. When terminal execution semantics are absent, the UI reports tool-related events without pretending they are completed calls.

Usage reports only token counts legitimately emitted by telemetry: input, output, cached/read, cache-write, reasoning, and tool tokens. It provides 24-hour, 7-day, and 30-day windows, token trends, model/session summaries, tool analytics, and TTFT/duration sample statistics. A reported zero means Codex emitted zero; `No samples` means the field exists in retained data but not in the selected window; `Unavailable` means the field has never been observed in retained data. Percentiles require minimum sample sizes, and no cache-hit percentage is inferred because the available counters do not establish a verified denominator. The dashboard never derives account billing totals, credit balances, plan limits, rate-limit allocations, reset timers, or monetary cost from these logs.

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

Planned provider seams include project telemetry, Liquidation Terminal telemetry, multiple GitHub repositories, optional long-lived Codex rollups, and additional read-only providers. Each integration must preserve typed results, server-only credentials, bounded concurrency, explicit freshness/failure semantics, and honest unavailable states.

## Git workflow

GitHub is the canonical source of truth. Inspect status and understand the provider architecture before editing. Run applicable checks and inspect the final diff. Do not change the configured remote, commit, push, create a pull request, or deploy without explicit authorization.
