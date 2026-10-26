# D1 read investigation, 2026-10-26

## Scope and attribution

The supplied Cloudflare screenshot reports 3.98M daily reads of a 5M allowance and 42.52k writes for `codex-command-center-telemetry` (`8d2ed842-ae1e-49d5-b722-411690425ddb`). Those totals do not identify a query or prove deployment parity. The investigated source baseline is GitHub main `2ffd5d5f2c8402957356f4663dde01b274c0408e`. No production raw-event scan, backfill, or pricing repair was used for this investigation.

Normal overlay GETs read a saved snapshot; they do not rebuild it. Ingest refreshes snapshots. The six-hour cron refreshes platform intelligence in KV. These are distinct cost paths.

## Verified source issues and changes

- Migration 0005 removed `idx_codex_session_summary_last_seen`, although snapshot rebuild and retention queries use that timestamp. Migration 0006 restores the index without rewriting evidence or backfilling rollups.
- `COUNT(*) OVER()` plus `SELECT *` and `ORDER BY ... LIMIT 20` scanned and sorted wide session rows. The replacement counts matching entries through the covering time index and fetches only the newest 20 complete rows. Exact totals and snapshot freshness intervals remain intact.
- Isolate-local coordination and a separate freshness read allowed concurrent instances to rebuild the same range. Three durable atomic claims now check freshness while acquiring a one-minute lease. Tokens prevent an expired owner from overwriting a newer owner's snapshot. Failed builds retain their claim for backoff; later ingests can recover expired claims. Freshness reads omit payload JSON.
- The visible Forensics screen displayed 25 events but called the full 35-statement analytics reader plus preflight. It now calls one query, reading at most 26 candidates from each indexed storage generation and returning 25 with honest truncation metadata. Its link disables prefetching. The full analytics function is retained, and its two previously unbounded history aggregates now use the same 30-day window as the preflight.

## Local evidence and limits

`tests/telemetry-read-cost.test.ts` applies every migration to real in-memory SQLite. With 50,000 sessions and 2,000 matching the 24-hour window, the original plan includes `SCAN codex_session_summary` and `USE TEMP B-TREE FOR ORDER BY`. The new plan contains:

```text
SEARCH s USING INDEX idx_codex_session_summary_last_seen (last_seen_at>?)
SCALAR SUBQUERY 1
SEARCH codex_session_summary USING COVERING INDEX idx_codex_session_summary_last_seen (last_seen_at>?)
```

The tests verify exact 24h/7d/30d counts, empty windows, newest-session ordering, concurrent claims through separate adapters sharing one database, stale metadata after another publisher completes, failure backoff, expired-claim recovery, and stale-writer fencing. A 60,000-event fixture verifies that the visible forensic action remains one indexed query and is not blocked by the separate full-analytics cap. An older-event backlog fixture verifies consistent full-analytics bounds.

`npm run audit:d1` also exercises application rebuild/claim SQL against disposable local D1 and reports per-statement `rows_read` when provided by the emulator. A 24h session comparison enforces a reduction when nonzero read metadata is implemented. Returned row counts establish result bounds only. Local metadata and query plans do not establish production billed savings. Matching session counts and dimension groups still contribute read cost; this change does not claim a universal daily-read ceiling.

On XPS2, Windows Application Control blocks the installed `workerd.exe`; local D1 migration/audit, two existing integration tests, and any Worker preview requiring that executable cannot run there. Do not change security policy to bypass this. Linux CI must supply D1 verification. A production Next.js build and loopback HTTP rendering can be verified independently.

## Authorized rollout

1. Require passing checks on the exact GitHub revision. Confirm the production deployment's current revision and pending migrations using existing authorized authentication. Confirm Access denies anonymous requests before application execution. HTTP denial alone does not prove the Access policy configuration.
2. Apply checked-in migration 0006 to the configured database through the established Wrangler migration workflow, after checking that migrations 0001-0005 are already applied. Creating the index has a one-time cost proportional to existing session summaries; it does not scan raw telemetry. No relay pause, raw backfill, pricing repair, or recording interruption is needed.
3. Build with `npm run build:vinext` and deploy through `npm run deploy:vinext` using the existing encrypted bindings. Record the exact deployment/version receipt and source commit. Do not create credentials or change Access policy as part of this rollout.
4. Verify the existing authorized overlay endpoint and its snapshot revision/freshness, then verify the actual installed overlay/relay integration. These changes are server-side and do not require a new native executable. An XPS2 check does not establish that an overlay on another computer was updated.
5. Compare subsequent Cloudflare read analytics over comparable traffic windows and inspect safe ingest rebuild diagnostics. Avoid full-table production SQL while close to the daily allowance.

The task checkout on XPS2 has no existing Wrangler authentication, installed Codex Live shortcut, or responding loopback relay. Production deployment parity and the user's overlay installation target therefore remain unverified until the established authorized deployment environment is available. Do not use another computer without authorization.

## Rollback

Redeploy the previously verified Worker version through the existing deployment workflow if behavior regresses. Keep migration 0006's index and empty/small lease table: the old application ignores the leases, and retaining additive schema avoids a data reset or schema rollback. No raw evidence is changed by this migration. Reverting the application restores the prior read amplification, so monitor the read allowance and do not run a backfill as rollback.
