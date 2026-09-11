# Codex Command Center agent rules

These rules are permanent maintenance guidance for agents working in this repository.

## Before changing anything

- Run `git status --short --branch` before editing.
- Confirm the current branch and remote before any work that could affect project history.
- Read the relevant architecture and provider interfaces before modifying a feature.
- Keep the application directly in this repository root. Do not create a nested `Codex-Command-Center` directory.

## Architecture

- Preserve the separation between presentation components and provider/data-source adapters.
- Keep provider contracts strongly typed and provider-agnostic.
- Do not import GitHub SDKs, credentials, or provider-specific transport details into presentation components.
- Add new integrations behind the provider interfaces and registry.
- Prefer focused, reversible changes over unnecessary rewrites.

## Data integrity and security

- Never fabricate dashboard metrics, activity, repository records, or trend values.
- If a provider is unavailable, return and render an explicit unavailable state.
- Never commit credentials, private keys, access tokens, logs, recordings, databases, caches, or large runtime datasets.
- Keep local secrets in ignored environment files or an appropriate secret manager.
- Never expose server-only credentials through client components or `NEXT_PUBLIC_*` variables.
- Never put credentials or secret values in source code, documentation, or examples.

## Verification

- Run applicable tests when tests exist.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run build` after meaningful changes.
- Start the application locally and verify the primary dashboard route renders when the change affects the UI.
- Inspect the final `git status` and `git diff` before reporting completion.
- Report failures and warnings honestly; do not silently bypass or weaken checks.

## Git workflow

- GitHub is the canonical code history for this project.
- Do not change or replace the configured GitHub remote.
- Do not commit, push, or create pull requests unless the user explicitly asks for that operation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
