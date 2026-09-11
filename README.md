# Codex Command Center

Codex Command Center is a private, extensible dashboard for bringing trusted engineering and agent signals into one calm workspace. It is designed to eventually aggregate GitHub repositories, commits, branches, pull requests, issues, GitHub Actions, Codex activity and usage telemetry, project telemetry, Liquidation Terminal telemetry, and additional providers.

The current release establishes the application shell, typed provider contracts, adapter registry, security boundaries, and a read-only GitHub provider for one configured repository. It does not invent metrics: unavailable providers and empty GitHub responses remain explicit in the UI.

## Installation

Requirements:

- Node.js 20.9 or newer
- npm

Install dependencies from the repository root:

```bash
npm install
```

Copy `.env.example` to `.env.local` only when you are ready to configure a local integration. For the GitHub provider, set `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPOSITORY` in that ignored local file. The example file intentionally contains variable names only. Keep real values out of source code and documentation.

## Local development

Start the development server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). With the GitHub variables configured, the dashboard reads repository metadata, commits, branches, open pull requests, open issues, and GitHub Actions runs from the configured repository. Without them, each data surface explains that its source is unavailable instead of showing placeholder numbers.

Run the project checks with:

```bash
npm run lint
npm run typecheck
npm run build
```

Use `npm start` after a successful production build to serve the production output locally.

## Architecture

The UI is built with Next.js App Router, TypeScript, Tailwind CSS, and reusable React components. Server-side page composition asks the provider layer for typed results. Presentation components receive view-model data and do not know whether a result came from GitHub, Codex, Liquidation Terminal, or another source.

```text
.
├── .github/workflows/ci.yml       # Push and pull-request verification
├── app/                            # App Router entry points and global styles
├── src/components/dashboard/      # Shell, navigation, overview, and section views
├── src/components/ui/              # Small reusable visual primitives
├── src/lib/dashboard/              # Dashboard query composition and view models
├── src/lib/providers/              # Typed contracts, registry, and adapters
├── AGENTS.md                       # Permanent agent maintenance rules
├── .env.example                    # Secret-free variable names
├── eslint.config.mjs               # ESLint flat configuration
├── next.config.ts                  # Next.js configuration
├── package.json                    # npm scripts and dependencies
└── tsconfig.json                   # Strict TypeScript configuration
```

### Provider design

`src/lib/providers/types.ts` defines contracts for repository metadata, commits, branches, pull requests, issues, builds, Codex activity, Codex usage, and project telemetry. Every provider method returns a typed `DataResult<T>` union:

- `connected` contains data returned by a real provider.
- `unavailable` contains a safe, user-facing reason and no fabricated fallback.

`src/lib/providers/registry.ts` is the composition boundary. The server-only `src/lib/providers/github.ts` implements the GitHub adapter with authenticated, read-only REST `GET` requests, safe error classification, and short-lived server-side fetch caching. The overview query uses that registry and converts provider results into dashboard view models. The adapter stores configured repositories as targets, so additional repositories can be added without changing the dashboard components.

Codex activity, Codex usage, and project telemetry still use explicit empty adapters. They are placeholders for future integration work, not mock data sources.

## Security model

- `.env.local` and other local environment files are ignored by Git.
- `.env.example` contains variable names only and no secret values.
- There are no `NEXT_PUBLIC_*` variables for private credentials.
- The GitHub token belongs only in the server-only provider boundary; it must never cross into client components.
- Runtime artifacts, logs, recordings, databases, caches, and generated archives are ignored where appropriate.
- There are no GitHub write or mutation operations in this phase.
- The dashboard renders unavailable states until a real source is configured and preserves explicit empty states when a connected source returns no records.

## Git workflow

GitHub is the canonical source of truth for this project. Inspect status and understand the provider architecture before making changes. Run the applicable checks and inspect the final diff. Do not change the configured remote, commit, push, or open a pull request without explicit authorization.

## Future integrations

Planned integration seams include Codex activity and usage telemetry adapters where supported, project telemetry, Liquidation Terminal telemetry, multiple GitHub repository targets, and additional provider modules. Each integration should document its authentication boundary, failure behavior, refresh strategy, and data freshness without exposing private credentials or manufacturing unavailable values.
