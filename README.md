# Codex Command Center

Codex Command Center is an open-source observability and developer-operations dashboard for Codex, GitHub, usage telemetry, account quota, delivery health, and development activity. It combines privacy-filtered OpenTelemetry history, resilient local buffering, real-time local Codex account data, and a native Windows overlay.

The product is designed as one cohesive command center: the website is the deep Usage and Operations workspace, while Codex Live is its always-available companion. The shared visual language carries measured KPI cards, density and trend views, exact-value hover details, one blended API-equivalent credits/USD counter, model and reasoning breakdowns, latest-session context, delivery health, and privacy-safe observed operations from the full dashboard into the compact Windows surface. The implementation uses the repository's own provider contracts, bounded materialized snapshots, and native overlay host; it does not read raw telemetry for normal views, fabricate live agent state, or turn an account balance into a guessed bill.

The project has two related product surfaces and one shared server/provider architecture:

- **Codex Command Center website:** the full Next.js 16 observability dashboard, deployed through vinext on Cloudflare Workers.
- **Codex Live Windows overlay:** a compact, bundled Tauri v2 application that runs independently of a browser and reads only a privacy-filtered snapshot through the local relay.

## Production security posture

Production is live and must remain private behind Cloudflare Zero Trust / Access. The Access policy must deny anonymous requests before application execution. There is intentionally no homemade username/password system in this repository. Application-level Access JWT verification can be considered later as defense in depth.

No deploy command is run by CI. Deployment remains an explicitly authorized operation and requires the Access gate plus encrypted runtime configuration.

## Requirements and installation

- Node.js 22 or newer
- npm

Building the native Windows overlay additionally requires:

- Rust stable 1.77.2 or newer, preferably installed with `rustup`.
- Visual Studio 2022 Build Tools with the **Desktop development with C++** workload and a current Windows 10/11 SDK.
- Microsoft Edge WebView2 Runtime, normally included with supported Windows releases.

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

The repository also contains `npm run deploy:vinext` for an explicitly authorized deployment. Never deploy if Cloudflare Access is absent, misconfigured, or permits anonymous execution.

## Runtime configuration and secrets

Local Next.js and vinext development use the ignored `.env.local` file. Production supplies the private GitHub credential and dedicated ingestion key as Cloudflare encrypted secrets. `wrangler.jsonc` declares their names as required deployment guards, but values must never be placed in configuration, source code, package metadata, documentation, client components, or a `NEXT_PUBLIC_*` variable. The repository owner and repository name are non-secret runtime configuration and can be supplied as Worker variables or bindings.

The server-only wrapper in `src/lib/providers/github.ts` is the only environment-reading boundary. It passes configuration into the provider core at runtime. Authenticated GitHub requests are read-only REST `GET` requests, use `cache: "no-store"`, and never expose authorization headers through provider results or UI data.

## Architecture

```text
.
├── .github/workflows/ci.yml       # Next.js and Worker verification; no deployment
├── app/                            # Shared App Router pages and dynamic dashboard layout
├── desktop/overlay/                # Bundled Tauri v2 Codex Live Windows application
├── migrations/                     # Versioned D1 telemetry schema
├── scripts/telemetry-relay.ts      # Loopback-only OTLP relay for Codex
├── scripts/telemetry-spool.ts      # Bounded durable OTLP outage buffer
├── scripts/telemetry-spool-payload.ts # Privacy-safe replay payload boundary
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
  -> privacy normalization and idempotent raw insert
  -> grouped incremental 10-minute scalar trend plus hourly model/reasoning/session rollups
  -> bounded 24h / 7d / 30d materialized snapshots
  -> typed Codex provider
  -> Codex page and Codex Live overlay
```

The relay listens only on IPv4 loopback. It accepts OTLP/HTTP protobuf or JSON, preserves the payload content type, and adds `CF-Access-Client-Id`, `CF-Access-Client-Secret`, and `X-Codex-Telemetry-Key` only on the outbound request. Relay credentials are separate from GitHub credentials. The relay never prints configuration values or payloads.

When the upstream collector is temporarily unavailable or returns a retryable failure, the relay places the individual OTLP request in a bounded disk-backed spool and acknowledges it locally so Codex is not held open by a cloud outage. Entries survive relay restarts and replay oldest-first when the collector recovers. The spool is limited to 64 MiB and 512 entries; if either bound is reached, the oldest entries are dropped deterministically and the safe dropped-batch count is exposed in relay health and Codex Live. Corrupt entries are discarded without stopping the relay. Runtime spool files live in the operating-system application-data area and are never committed.

Before an entry reaches disk, the relay rebuilds it from the existing privacy-safe normalized event fields. The spool stores only the request content type and that bounded OTLP body; it never stores raw prompt/body fields, credentials, authorization headers, GitHub credentials, Codex app-server authentication, or any other relay configuration. Replay carries the original server-side fingerprint and preserves the content type so retries remain idempotent. It is not a logging or UI surface. Protobuf requests are intentionally kept as individual entries rather than concatenated without a correct protobuf decode/re-encode path.

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

`migrations/0001_codex_telemetry.sql` creates the base event table. The additive `migrations/0002_codex_analytics_v2.sql` adds reviewed operational scalar fields. The additive `migrations/0003_codex_rollups.sql` adds the scalar trend, hourly model, hourly reasoning, session-summary, and dashboard-snapshot tables. The existing global table stores the finer scalar trend under its `hour_start` column for schema compatibility. Event fingerprints retain their unique constraint, and ingestion continues to use prepared statements and D1 batches capped at 50 writes.

Raw events default to 30-day retention through `CODEX_TELEMETRY_RETENTION_DAYS`; cleanup runs after an ingest that accepts at least one new event and is time-gated so repeated small requests do not repeat the same maintenance work. Duplicate-only exporter retries skip rollup, cleanup, and snapshot maintenance after the required fingerprinted insert check. The configured value is bounded to 1–365 days and migration 0003 does not reduce or delete that history. Rollups retain 31 days. The scalar activity trend uses 10-minute buckets, capping its retained table at 4,464 possible time buckets before any additional dimensions. Normal dashboard and overlay reads use only the three small materialized snapshots; the 35-statement raw analytics path is restricted to the explicit Forensics action and performs an indexed 50,000-event preflight cap before the fan-out.

Ingest first performs `INSERT OR IGNORE` against the fingerprinted raw table, examines each D1 write result, and rolls up only rows whose insert actually changed the database. Exporter retries therefore cannot double-count summaries. Newly inserted events are grouped in memory before bounded 10-minute-trend/hourly-model/reasoning/session upserts; multiple events in one bucket produce one upsert per grouped key. Retention cleanup and snapshot-staleness checks are time-gated to once per minute per Worker isolate; raw retention deletion is additionally capped at 500 events per maintenance pass so an accumulated backlog cannot turn one ingest request into an unbounded D1 read/delete operation. Rollup correctness remains immediate, while repeated tiny requests no longer repeat the same maintenance work. Each ingest response exposes safe aggregate diagnostics such as accepted/duplicate events, grouped upserts, snapshot rebuilds, cleanup deletes, and D1 `rows_written` metadata when the runtime supplies it. These are operational measurements, not the official Cloudflare billing meter.

Snapshot generation reads range-bounded rollup tables, never raw events: 24-hour snapshots have a one-minute TTL and read at most 144 ten-minute scalar buckets, while 7- and 30-day snapshots have 15-minute TTLs and read at most 1,008 and 4,320 scalar buckets respectively before the separate bounded model/reasoning/session queries. There is no normal 50,000-row dashboard scan. Missing migration-0003 tables are tolerated during rollout: ingest continues storing raw events, normal Codex analytics report unavailable, and no expensive raw fallback occurs.

The one-time backfill is explicit and never runs at startup or deployment:

```bash
# Local D1 is the default.
npm run backfill:codex-rollups

# Production requires both flags and separate operational authorization.
npm run backfill:codex-rollups -- --remote --confirm-remote
```

The utility refuses non-empty rollup tables unless `--rebuild` is also supplied. A rebuild deletes and recreates rollup/snapshot rows only; it does not modify retained raw telemetry. Its four raw scans select only privacy-safe aggregate columns.

Before an authorized deployment, apply pending checked-in migrations to the configured D1 database and confirm the encrypted Worker secret named `CODEX_TELEMETRY_INGEST_KEY` remains available. Do not put the secret value in Wrangler configuration. Local schema verification can use:

```bash
npx wrangler d1 migrations apply codex-command-center-telemetry --local
```

Applying remote migrations, creating encrypted production secrets, configuring Access, and deploying are production operations and require explicit authorization.

### Dashboard semantics

The website has two top-level destinations: **Codex** and **GitHub**. Codex presents health, freshness, six key token/session measurements, one activity trend, model/reasoning distributions, performance, and the latest session. Usage, Sessions, Tools, Forensics, and Data health are expandable details. GitHub combines repository state, pull requests, issues, CI, branches, Actions, and recent activity. Legacy section URLs redirect into the appropriate page/detail. Settings is a drawer rather than a third destination.

The default Codex page never hydrates raw events. Exact event chronology, warnings/errors, approval/MCP/sandbox details, and other deep dimensions are retained behind explicit Forensics loading. This is intentionally more expensive and should be opened only for investigation.

Usage reports only token counts legitimately emitted by telemetry: input, output, cached/read, cache-write, reasoning, and tool tokens. It provides 24-hour, 7-day, and 30-day windows, token trends, model/session summaries, tool analytics, and TTFT/duration sample statistics. A reported zero means Codex emitted zero; `No samples` means the field exists in retained data but not in the selected window; `Unavailable` means the field has never been observed in retained data. Percentiles require minimum sample sizes, and no cache-hit percentage is inferred because the available counters do not establish a verified denominator. A separate API-equivalent accounting layer applies the published token-based Work/Codex rate card to the materialized model rollups: it shows one blended credit total and USD equivalent, keeps model detail inspectable, and marks unknown or incomplete coverage instead of pricing it as zero. It is a comparison estimate, not a live account balance or invoice.

### API-equivalent credits and USD

The pricing card uses the published [token-based Work/Codex USD rates](https://help.openai.com/en/articles/20001415) and [token-based Codex credit rates](https://help.openai.com/en/articles/11481834-cha) for every model that has a current input, cached-input, and output rate in the checked-in catalog. The calculation is performed once while materialized snapshots are built, not when the browser or overlay refreshes:

```text
credits = input tokens / 1M × input credit rate
         + cached input tokens / 1M × cached credit rate
         + output tokens / 1M × output credit rate
USD     = the same formula using the published USD rates
```

The visible result is one combined total across Sol, Terra, Luna, Astra, supported legacy-priced models, and any other recognized catalog entry. Reasoning effort (`low`, `medium`, `high`, `extra-high`, `max`, or `ultra`) remains a tracked dimension but does not create a second rate row; reasoning tokens are an output-token breakdown and are never added twice. Codex cache writes are tracked in the measured ledger but excluded from the charge because the current Codex rate card does not charge them. The user-selected feature boundary is token-only: web search, voice, images, fast-mode multipliers, long-context multipliers, regional processing, and other separately metered feature charges are not included. Each model row retains exact observed token counts and its own math in the expandable inspection view, while the command center and Codex Live overlay show the single blended counter.

## Website and native overlay

The website is the deep Usage and Operations workspace. Its main Codex view opens with a measured KPI ribbon, token activity trend and density map, token composition, model/reasoning distributions, latest-session context, a bounded live-operations card, and one unified API-equivalent accounting card. KPI cards link to their bounded detail sections; trend points, activity cells, distribution rows, and metrics expose exact observed values on hover and keyboard focus; and the measured-token ledger shows both the emitted fields and the pricing coverage state. Codex Live is the always-available companion: it prioritizes the latest model and reasoning effort actually observed in telemetry, the unified credits/USD equivalent, emitted token classes, TTFT, tool executions/failures, telemetry freshness, local-relay reachability, and—in Expanded mode—compact distributions, delivery health, and an observed-operations rail. It does not claim that a last-observed model is still active, and it does not attempt to reproduce the full dashboard.

The retained `/overlay` route remains a browser-based preview/reference surface. The actual companion in `desktop/overlay/` packages its own Vite/React frontend inside a frameless Tauri window; it does not open that route in Edge and does not require Edge or a local development server during normal use.

The desktop data path is:

```text
Codex OTel
  -> local relay POST /v1/logs
  -> authenticated Cloudflare ingestion
  -> D1
  -> private GET /api/overlay?range=24h|7d|30d
  -> local relay GET /v1/overlay?range=24h|7d|30d
  -> fixed loopback-only Rust request
  -> bundled Codex Live interface
```

Codex Live also maintains one separate, read-only stdio connection to the authenticated local Codex app-server. This is the authority for current account quota and account-level activity; it complements rather than replaces OTel. The local relay's delivery state remains separate from quota state:

```text
local Codex app-server (account/read, account/rateLimits/read, account/usage/read)
  -> persistent child owned by the existing local relay
  -> sanitized in-memory account snapshot
  -> loopback-only GET /v1/account
  -> native Codex Live and, when browser policy permits, the hosted dashboard on this PC
```

The collector discovers Codex through the optional `CODEX_CLI_PATH`, the current `PATH`, or the versioned Codex Desktop runtime below `%LOCALAPPDATA%\OpenAI\Codex\bin`. Each candidate is validated with a bounded `--version` invocation. It never reads `.codex/auth.json`, copies OAuth material, calls private ChatGPT usage endpoints, starts a Codex thread, invokes a tool, mutates an account, or consumes a rate-limit reset credit. Codex itself remains responsible for authentication and token refresh. App-server failure makes only account quota unavailable; OTel forwarding and historical analytics continue normally.

Quota windows are classified by their returned duration, not by their `primary` or `secondary` position: 300 minutes is shown as 5-hour, 10,080 minutes as weekly, and other known durations receive a generic duration-derived label. Missing windows, reset times, credit objects, and availability flags stay unavailable or unknown rather than being treated as zero. Paid/usage credits and earned banked resets are displayed as separate concepts. Additional limit IDs and their model association are retained only when the protocol supplies them.

`account/rateLimits/updated` is treated as a sparse invalidation signal. The relay debounces it, performs a fresh full read, and keeps a 45-second full-read fallback. Account activity uses the backend summary and at most the latest 90 `dailyUsageBuckets`; their accounting and timezone semantics are backend-defined, so they are labeled **Account Activity** and are never merged into OTel/D1 daily totals.

The website control panel exposes the complete account-activity contract currently returned by the supported local app-server: exact daily token buckets with 7-day and 30-day views, active-day and peak-day totals, lifetime tokens, current and longest streaks, peak daily tokens, longest running turn, quota windows, reset timing, and the existing materialized OTel/D1 model, reasoning, session, tool, latency, ledger, and API-equivalent views. The daily chart and ledger share the same bounded response and provide exact hover/focus values; changing the website range does not poll again or read D1. The native Codex Live overlay intentionally remains compact and does not render this website-only history panel.

The newer Codex Desktop Analytics screen can also show official credit history grouped by feature, model, surface, or turn start, plus top chats and plugin/skill activity. Those fields are not returned by this installation's supported `account/usage/read` contract (`threadUsage` is absent), and the local app-server exposes no supported equivalent. They therefore remain explicitly unavailable rather than being reconstructed from private ChatGPT storage, OTel events, or estimated token prices. The website's API-equivalent card is a separate token-rate comparison estimate, not official plan-credit history.

Quota information stays local in this implementation. Nothing from the account app-server is written to D1 or sent to Cloudflare. The hosted dashboard makes a credential-free browser request to `http://127.0.0.1:14318/v1/account`; the relay allows CORS only for the configured Command Center origin. Browser mixed-content or Private Network Access policy may block that request, in which case the web card remains honestly unavailable while native Codex Live continues to work. A dashboard opened on another device cannot access this PC's loopback relay.

Codex Live may show a compact `OTel delivery live`, `OTel delivery buffered`, or `OTel delivery replaying` state. This describes local delivery only; it does not mean that the materialized D1 snapshot is fresh. The overlay labels snapshot freshness separately, so a healthy relay can be visible while Activity or historical analytics remain unavailable or stale because the remote snapshot path is unavailable. A nonzero dropped-batch count is surfaced as degraded rather than presented as complete history.

`GET /api/overlay?range=24h|7d|30d` returns a dedicated private/no-store view model. It is limited to health states, aggregate operational counters, bounded token trends and distributions, safe delivery status, and privacy-filtered latest-session measurements. It never includes prompts, commands, arguments, output, reasoning text, account identity, host information, or credentials.

The relay read endpoint is deliberately not a proxy. It accepts only `GET /v1/overlay`, validates the range, rejects additional query parameters and paths, derives the fixed `/api/overlay` upstream from the configured collector origin, adds the existing Cloudflare Access service-token headers, enforces an 8-second upstream timeout and 256 KiB response limit, rejects redirects and non-JSON/unsafe responses, and never logs the response body. The ingestion key is not forwarded to the read endpoint. The relay caches one safe snapshot per range: its default upstream refresh interval is 30 seconds and its hard minimum is 15 seconds. Repeated local widget refreshes use that cache, and a safe stale value may be served during an upstream outage.

**Follow ChatGPT** is enabled by default. The Windows-native watcher uses ToolHelp process enumeration to detect the executable actually observed on this system, `ChatGPT.exe`. A cheap local process check continues every five seconds. When ChatGPT starts, the native app ensures its loopback relay is healthy, shows the overlay, and resumes refreshes. When ChatGPT exits, it hides the overlay, suspends remote polling, and stops only the relay child it owns. It never starts, stops, or restarts ChatGPT and never terminates an arbitrary Node process. If another healthy Codex relay already owns the loopback endpoint, the overlay uses it but marks it external and refuses ownership-only restart or stop operations.

Relay availability and telemetry freshness are separate signals. “Relay online” means the native process reached `127.0.0.1:14318`; it does not claim that remote telemetry is currently flowing. Freshness is `Live` through 15 seconds, `Recent` until five minutes, and `Idle` after five minutes while the data path remains healthy. `Stale` is reserved for an actual relay, snapshot, telemetry-provider, or D1 failure. If the relay is absent, the app retains settings and quit controls and shows a compact offline state.

### One-click Windows start

After a native release build, run `npm run install:codex-live-shortcut` once to create or repair the desktop shortcut. The installer uses Windows Script Host because it works with the default environment without weakening PowerShell execution policy. The resulting `Codex Live` shortcut points directly to `desktop/overlay/src-tauri/target/release/codex-command-center-overlay.exe` (or the normal debug executable when no release exists), has no arguments, and contains no credentials. Re-running the installer after every release build repairs stale shortcuts and makes the launch target explicit; it does not copy an older EXE into an unrelated desktop location.

The native GUI is the launcher and supervisor. It starts the existing relay entry point with Node in the repository root, loads secrets only through the relay's existing `.env.local` path, suppresses child standard streams, and uses the Windows no-console process flag. A fixed loopback `/health` response identifies the expected service without a cloud request. Tauri's single-instance plugin recovers an existing overlay; relay health and an owned child handle prevent duplicate relays. `Start with Windows` launches this same GUI, so the saved Follow ChatGPT preference governs the complete overlay-and-relay lifecycle.

### Codex Live layouts and controls

- **Mini:** approximately 300 × 150 pixels for a corner monitor.
- **Standard:** 360 × 250 pixels for current usage and health.
- **Expanded:** 430 × 500 pixels with trends, token composition, model/reasoning distributions, latest session, GitHub, and CI.
- **Strip:** 600 × 90 pixels for a monitor edge.

The frameless window is resizable, draggable when unlocked, always-on-top by default, single-instance, and backed by a system tray. Position and size are restored by Tauri’s window-state plugin. Explicit edge and corner grab areas make resizing reliable without native decorations. Corner placement and optional edge snapping are available. Lock mode disables dragging and resizing. The tray provides Show, Hide, Recover Overlay, all four layouts, always-on-top, click-through, position lock, Settings, Open Command Center, Start Relay, Restart Relay, Stop Relay, Start with Windows, and Quit. The right-click menu also provides Recover movement.

Default global shortcuts are:

- `Ctrl+Shift+Space`: show or hide the overlay.
- `Ctrl+Shift+O`: toggle click-through.

Click-through cannot be enabled unless both recovery shortcuts register successfully. Registration conflicts are surfaced in Settings instead of failing silently. The tray remains an additional recovery path. Double-clicking the header toggles Mini and Standard; Escape closes Settings or hides the focused overlay.

Appearance settings include native backdrop selection, dark/light surfaces, 20–100% surface opacity, Auto/White/Black/Red/Amber/Cyan/custom text, a separate validated accent color, 80–150% font scaling, and Tight/Comfortable density. Auto uses light text on the dark surface and dark text on the light surface. Mica uses the native Windows 11 backdrop when supported. Acrylic uses the native Windows 10/11 effect but remains optional because Windows/Tauri document resize and drag performance caveats on some builds. Unsupported native effects fall back to the stable translucent surface; Solid is always available.

Only non-sensitive UI preferences are stored in Tauri’s app-local store. The desktop frontend has no shell, filesystem, process, arbitrary HTTP, or global-shortcut capability. Its Rust fetch command is hardcoded to the loopback relay endpoint. Cloudflare Access credentials, the telemetry ingestion key, GitHub credentials, account identity, machine identifiers, and telemetry content never enter the executable’s configuration or frontend models.

### Native development and Windows build

Install the desktop lockfile separately:

```powershell
npm ci --prefix desktop/overlay
```

Build the bundled frontend and check the native code:

```powershell
npm run build:overlay
cargo fmt --manifest-path desktop/overlay/src-tauri/Cargo.toml --check
cargo check --manifest-path desktop/overlay/src-tauri/Cargo.toml
```

Run or build the Windows application; it supervises the relay itself:

```powershell
npm --prefix desktop/overlay run tauri dev
npm --prefix desktop/overlay run tauri build
```

The build produces unsigned local artifacts only. Do not sign, publish, or deploy them without an explicitly authorized release process. The current EXE is always the release artifact at `desktop/overlay/src-tauri/target/release/codex-command-center-overlay.exe`; the shortcut installer is deliberately tied to that path so the existing `.exe` launch workflow remains intact after UI changes.

For local website development, point the existing `TELEMETRY_COLLECTOR_URL` at the loopback Next.js ingestion endpoint. The relay derives `http://localhost:3000/api/overlay` from that explicitly local collector origin. In production it derives the same fixed path from the production Worker origin.

If the current Cloudflare Access service-token policy is scoped only to `/api/telemetry/ingest`, a future administrator must extend the existing Access application—or create an equally protected path-specific application—so `/api/overlay` permits **Service Auth** for the same relay service token. Keep the authenticated-user policy for browser dashboard routes and continue denying anonymous access. No Access policy is changed by this repository code.

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

GitHub project snapshots use a five-minute module-memory cache (`5 * 60_000`) keyed by an encoded, sorted repository scope. The cache stores actual upstream fetch timestamps; rendering does not replace them. Authenticated upstream fetches and dynamically rendered dashboard responses remain private/no-store. GitHub is intentionally lower-frequency than Codex analytics because repository statistics do not need second-by-second refreshes.

This is deliberately the smallest appropriate design for the current single-user deployment. In Workers it is isolate-local and best-effort: entries are not shared across isolates, regions, or cold starts, and therefore do not guarantee one global fetch per five minutes. In-flight calls within one isolate are deduplicated. If a refresh is temporarily rate-limited or fails because of a network/API error, an existing safe stale snapshot can be served with explicit degraded health and retry metadata. A shared KV, Durable Object, or database should only be introduced if measured traffic demonstrates a need for cross-isolate coordination.

The generated Cloudflare CDN adapter does not authorize public caching of private HTML or RSC payloads. Dashboard routes remain dynamic, and provider fetches opt out of HTTP caching. These protections must be rechecked in Worker preview and before every production rollout.

Codex snapshot caching is separate from GitHub caching. Ingest persists snapshots at bounded TTLs; the provider cache and GitHub cache have independent lifetimes. A normal Codex render issues one D1 statement returning at most three rows. `/api/overlay` issues one D1 statement returning one row. The GitHub page does not read Codex D1. Run `npm run audit:d1` to recreate a 50,000-row isolated local dataset, inspect query plans, and enforce these source and row-return budgets without accessing production.

## Safe production rollout order

Production operations require separate authorization. The safest order is:

1. Commit and push the feature branch, open the PR, and require all CI checks to pass.
2. Begin a short authorized maintenance window and pause the existing `Codex Telemetry Relay` scheduled task so raw events cannot arrive between backfill and deployment. Do not open the old dashboard during this window.
3. Apply migration 0003 before application deployment: `npx wrangler d1 migrations apply codex-command-center-telemetry --remote`.
4. While ingestion is paused, run `npm run backfill:codex-rollups -- --remote --confirm-remote`. Use `--rebuild` only if the new rollup tables are intentionally being rebuilt; raw telemetry is never deleted.
5. Merge and deploy the verified application immediately after the snapshots exist. If an unexpected deployment temporarily precedes the migration, ingest remains functional and analytics stay explicitly unavailable; there is no raw fallback.
6. Validate `codex_dashboard_snapshot` has exactly three rows and verify `/api/overlay` returns one small snapshot without a raw-table query.
7. Start the paused relay to complete its one rollout restart and load the final cache implementation: `Start-ScheduledTask -TaskName 'Codex Telemetry Relay'`. This is a one-time maintenance restart, not process coupling to ChatGPT.
8. Verify the current Cloudflare Access service token can reach `/api/overlay` and anonymous access remains denied.
9. Enable the native overlay and confirm Follow ChatGPT suspends relay requests while `ChatGPT.exe` is absent.

## Failure and rate-limit behavior

The provider distinguishes missing configuration, authentication failures, permission failures, primary rate exhaustion, secondary rate limiting, network errors, API errors, and valid empty results. `Retry-After` and `X-RateLimit-Reset` are converted into safe typed retry metadata. Raw GitHub error bodies, credentials, and request headers are not returned to the browser.

Repository metadata can succeed while a narrower capability fails. In that case GitHub health is `degraded`, the failing capability remains explicitly unavailable, and the Data Sources page shows the effective partial state instead of claiming full health.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run check:migrations
npm run audit:d1
npm run build
npm run check:vinext
npm run build:vinext
npm run build:overlay
```

CI runs the website, D1, Worker, bundled-overlay frontend, Rust formatting, and native Cargo checks on pushes and pull requests. It does not deploy or build a signed installer.

## Future integrations

Planned provider seams include project telemetry, multiple GitHub repositories, and additional read-only providers. Each integration must preserve typed results, server-only credentials, bounded concurrency, explicit freshness/failure semantics, honest unavailable states, and the rule that normal views read compact summaries rather than raw analytical history.

## Git workflow

GitHub is the canonical source of truth. Inspect status and understand the provider architecture before editing. Run applicable checks and inspect the final diff. Do not change the configured remote, commit, push, create a pull request, or deploy without explicit authorization.
