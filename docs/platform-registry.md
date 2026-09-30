# Platform metadata registry

The `/platform` route is a bundled, source-attributed reference plus a point-in-time audit of the local Codex installation. It does not fetch OpenAI/GitHub data at render time and does not query or write D1.

## Evidence layers

| Layer | Meaning | Examples |
| --- | --- | --- |
| Live/account telemetry | Returned by the local Codex app-server or privacy-bounded OTel ingestion | Rate-limit windows/reset times, banked-reset count when present, emitted model/reasoning/token fields |
| Official product metadata | OpenAI docs, Help Center, changelog, or upstream Codex source | Model specifications, published rates, command definitions, product release state |
| Local runtime snapshot | Directly observed on this Windows installation at the recorded time | Codex CLI/Desktop versions, top-level `codex --help` verbs, bundled model catalog |
| Derived estimates | Calculations from measured counters and a documented rate card | API-equivalent USD and Work/Codex token-credit comparisons, never an invoice or account balance |

Keep these layers separate. An API or Work/Codex listing does not prove this account, plan, or installed build can use a capability. A model missing from the captured local bundle is `not_observed`, not `unavailable`. Unknown model IDs and persisted telemetry remain unchanged and render through their raw identifier.

## September 29, 2026 updates represented

- GPT-6.1 Sol (`gpt-6.1-sol`): 1,050,000 context tokens, 128,000 maximum output, API reasoning low/medium/high/xhigh/max (`none` and `minimal` unsupported). Responses API is required for tool calling. Standard short-context API USD and Work/Codex Standard token-credit rates are listed separately. The local bundled catalog did not contain this ID at inspection time.
- GPT-6.1 Sol multi-agent is beta in the Responses API. Current Command Center telemetry cannot establish a parent/child agent lifecycle graph.
- Fast and Ultrafast are service tiers, not reasoning efforts. The official rate card lists Fast for GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol, and GPT-6 Luna where supported. Ultrafast is GPT-6 Astra-only, at 6× API / 6× purchased Work/Codex credits / 8× included allowance on eligible plans. It is not listed by this installed model catalog. No actual served tier is ingested.
- Agents API computer use is an official OpenAI-hosted browser feature; it does not itself create a Codex desktop telemetry signal.
- Codex Cloud and Sign in with ChatGPT appear as product metadata with account eligibility unknown. Daybreak/Trusted Access is available only with approval; Daybreak Red needs separate provisioning. Its local model slugs are observed in the bundle but do not prove this account is approved.
- GPT-5.5 is scheduled to retire from ChatGPT, Work, and Codex on Oct 14, 2026; API access is unaffected. GPT-5.4/mini are documented as unavailable in Codex when signed in with ChatGPT as of Aug 31, while API-key use remains unaffected. Both facts are kept separate from old telemetry and bundled model definitions.
- The pinned upstream Codex source defines `/voice`. The current local CLI `--help` does not report slash-menu contents, so local `/voice` availability and voice-event telemetry remain unknown.
- Dots and ChatGPT Space were reviewed but are not folded into Codex usage dashboards; no relevant telemetry contract is established here.

Product/release status, official source presence, and `accountAvailability` are distinct. “Available” at a product surface does not mean provisioned for this user. Command rows label official source-backed entries separately from this machine’s observation; absence from `--help` is not treated as proof that a slash command is absent.

## Model, tier, command, and price rules

- `src/lib/platform/registry.ts` contains source IDs, authority/source type, URLs where available, effective/verified dates, status, and separate local/account observations.
- `normalizeKnownModelIdentifier()` normalizes recognized GPT-6.1 Sol variants for metadata lookup only; it never rewrites persisted model identifiers. Unknown IDs pass through unchanged.
- Reasoning effort and service tier are separate. Explicit `priority`/`priority:Fast` normalizes to Fast; a missing value remains unknown. Local `ultra` reasoning is not API/Work `Ultrafast` processing.
- CLI/TUI slash commands come from a pinned upstream `openai/codex` source revision; Desktop commands come from the separate Desktop command reference. This local `codex --help` reports top-level verbs, not slash menus, so installed slash-command availability remains unknown. The pinned source is not a local install or minimum-version guarantee.
- `src/lib/telemetry/pricing.ts` centralizes token pricing. The exact local slugs `gpt-daybreak-blue-latest` and `gpt-daybreak-red-latest` resolve to the respective official Daybreak rates. The aggregate estimator applies Standard, short-context rates only. It does not apply long-context, Fast, Ultrafast, Batch/Flex, regional, or separately metered feature adjustments because request-level context length and returned service tier are not retained.
- Work/Codex credit cards vary by plan and agreement. The token-rate equivalent stays separate from `account/usage/read` credits and reset data.

## Usage and reset semantics

The supported local app-server calls are read-only `account/read`, `account/rateLimits/read`, and `account/usage/read`. Preserve these distinct concepts:

1. Automatic primary/secondary usage windows: display only returned values and reset timestamps.
2. Banked resets: use returned `availableCount`; preserve returned `resetType`/`status` and show expiration only for an available reset with a returned `expiresAt`. Redeeming one can reset applicable windows and move the next weekly reset date; use only the runtime's later returned timestamp. Detail rows may be capped, so the count stays authoritative. Preserve `details: []` (details fetched, none returned) separately from missing/null details.
3. Global/promotional resets: OpenAI documents these as automatic, immediately applied resets, not saved/banked resets. The local account reader has no distinct per-account promotional-reset field; do not infer one from an announcement.
4. Purchased instant resets: OpenAI documents these as a separate eligible-account option that refreshes usage windows after purchase. The local reader does not prove purchase or eligibility; do not infer these from credits or banked resets.
5. Credits: display only the returned account balance; never derive it from API-equivalent pricing.

The app-server client does not consume or purchase resets. Missing fields remain unknown, not zero.

## Telemetry and D1 impact

This change adds no parser behavior, D1 schema/migration, snapshot query, polling, or write path. Current telemetry may contain an agent name, but this ingestion path does not normalize a served service tier, execution target, or verified parent/child lifecycle. Tool calls are not used to synthesize relationships. API, Work, local, and cloud execution remain separate until an authenticated supported provider is added in a separately reviewed change.

The Platform route does not call `getCodexPageData`, an API route, or a D1-backed provider. Bundled metadata adds no D1 reads/writes; materialized pricing continues at the existing refresh cadence.

## Refresh process

1. Inspect the live install with `codex --version`, `codex --help`, and `codex debug models --bundled`. Copy only allowlisted version/model/effort/context/tier fields; never copy credentials, local paths, prompts, or arbitrary runtime output.
2. Verify model specifications and API token prices in OpenAI developer docs, Work/Codex credit rates in the applicable Help Center card, and feature status in official changelog/release notes.
3. Check `codex-rs/tui/src/slash_command.rs` from `openai/codex` and the Desktop command reference separately. Keep debug-only, platform-specific, local-observed, and account-available claims distinct.
4. Update `verifiedAt`, `effectiveDate`, source IDs/URLs, metadata, and focused tests together. Do not runtime-fetch it, insert it into telemetry, or rewrite historical raw events.
5. Run platform/pricing/parser tests and the project verification suite, including `npm run audit:d1`; inspect final diff for new query/write paths.

## Verified source manifest

The local runtime and most listed documentation sources were checked at `2026-09-30T01:23:56Z` (Sep 29, 2026 in America/Los_Angeles). The model page, API pricing, Sep 29 API changelog, and Work/Codex rate card were rechecked at `2026-09-30T01:36:04Z`; the official DevDay event page was checked at `2026-09-30T01:45:35Z`. The event page confirms date and schedule only; product/release claims below are independently sourced from official docs, rate cards, release notes, or upstream source. An effective date is recorded only when an OpenAI release/publication date was stated; verification time is not treated as an effective date.

| Source ID | Authority / effective date | Canonical source |
| --- | --- | --- |
| `apiModel` | OpenAI developer docs · Sep 29 | [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| `apiPricing` | OpenAI developer docs · current pricing checked Sep 29 | [API pricing](https://developers.openai.com/api/docs/pricing) |
| `workRateCard` | OpenAI Help Center · current card checked Sep 29 | [Work/Codex credit rate card](https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing) |
| `apiChangelog` | Official release notes · Sep 29 | [API Changelog](https://developers.openai.com/api/docs/changelog) |
| `devDayEvent` | Official DevDay event page · Sep 29 (event date/schedule only) | [OpenAI DevDay 2026](https://devday.openai.com/) |
| `codexSource` | Official source · pinned blob `85eabb59dcc1ba7ee22de8172f4e90ce3af0e49d` | [Codex TUI slash-command source](https://github.com/openai/codex/blob/85eabb59dcc1ba7ee22de8172f4e90ce3af0e49d/codex-rs/tui/src/slash_command.rs) |
| `desktopCommands` | Official Codex reference | [Desktop slash commands](https://learn.chatgpt.com/docs/developer-commands) |
| `appServer` | Official Codex app-server docs | [App-server account methods](https://learn.chatgpt.com/docs/app-server) |
| `bankedResetHelp` | Official Help Center · reset semantics | [How banked Codex resets work](https://help.openai.com/en/articles/20001498-how-banked-codex-resets-work) |
| `purchasedResetHelp` | Official Help Center · purchased reset | [Paid weekly Work and Codex rate-limit resets](https://help.openai.com/en/articles/20001507-paid-weekly-work-and-codex-rate-limit-resets) |
| `usageHelp` | Official Help Center · account usage | [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) |
| `cloud` | Official Codex docs | [Codex Cloud](https://learn.chatgpt.com/docs/cloud) |
| `signIn` | OpenAI developer cookbook · Sep 28 | [Sign in with ChatGPT](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) |
| `daybreak` | OpenAI developer/safety docs | [Daybreak access guide](https://developers.openai.com/api/docs/guides/daybreak) |
| `dots` | Official ChatGPT docs | [dots computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps) |
| `space` | Official ChatGPT docs | [ChatGPT Space](https://learn.chatgpt.com/docs/space) |
| `codexReleaseNotes` | Official Codex release notes · Sep 28 CLI entry | [Codex changelog](https://learn.chatgpt.com/docs/changelog) |

The local runtime source is not external: its CLI/Desktop versions and bounded bundled model catalog snapshot are recorded in `src/lib/platform/registry.ts` with the verification time.
