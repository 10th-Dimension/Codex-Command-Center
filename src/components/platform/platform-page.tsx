import {
  CODEX_CLI_COMMANDS,
  CODEX_DESKTOP_COMMANDS,
  GPT_61_SOL,
  LOCAL_CODEX_MODELS,
  LOCAL_CODEX_RUNTIME,
  OTHER_REVIEWED_SURFACES,
  PLATFORM_CAPABILITIES,
  PLATFORM_SOURCES,
  PLATFORM_VERIFIED_AT,
  SERVICE_TIER_REGISTRY,
  TELEMETRY_BOUNDARIES,
  USAGE_RESET_SEMANTICS,
  getPlatformSource,
  type PlatformCapability,
  type PlatformSource,
  type PlatformSourceId,
} from "@/lib/platform/registry";
import { resolveCodexPricingRate } from "@/lib/telemetry/pricing";

const gpt61Price = resolveCodexPricingRate(GPT_61_SOL.id);

export function PlatformPage() {
  return <div className="platform-page">
    <header className="platform-hero">
      <div>
        <span className="platform-eyebrow">OPENAI · CODEX · VERIFIED METADATA</span>
        <h1>Platform intelligence</h1>
        <p>Official product facts, this machine’s observed Codex baseline, and the limits of what the telemetry can prove—kept separate.</p>
      </div>
      <div className="platform-verified"><span>Metadata verified</span><time dateTime={PLATFORM_VERIFIED_AT}>{PLATFORM_VERIFIED_AT.replace("T", " ").replace(".000Z", " UTC")}</time><small>Sep 29 local runtime and release audit</small></div>
    </header>

    <section className="platform-section" aria-labelledby="platform-updates-title">
      <SectionHeading eyebrow="RELEASES, CAPABILITIES & ROLLOUT STATE" title="Product and release intelligence" id="platform-updates-title" />
      <div className="platform-feature-grid">
        {PLATFORM_CAPABILITIES.map((capability) => <CapabilityCard key={capability.id} capability={capability} />)}
      </div>
    </section>

    <section className="platform-section" aria-labelledby="platform-model-title">
      <SectionHeading eyebrow="MODEL CATALOG" title="GPT-6.1 Sol and this installed bundle" id="platform-model-title" />
      <article className="platform-panel platform-model-card">
        <div className="platform-panel-heading"><div><span className="platform-status available">API documented</span><span className="platform-status unknown">Not observed in local bundle</span></div><SourceLink sourceId="apiModel" /></div>
        <h3>{GPT_61_SOL.displayName} <code>{GPT_61_SOL.id}</code></h3>
        <p>GPT-6 family model for complex coding and professional work, positioned below GPT-6 Astra in API price. Chat Completions does not provide tool calling for this model; use Responses API for tools.</p>
        <dl className="platform-facts">
          <Fact label="API context" value={formatTokens(GPT_61_SOL.contextWindowTokens)} />
          <Fact label="Maximum output" value={formatTokens(GPT_61_SOL.maximumOutputTokens)} />
          <Fact label="Reasoning" value={GPT_61_SOL.reasoningEfforts.join(" · ")} />
          <Fact label="Unsupported effort" value={GPT_61_SOL.unsupportedReasoningEfforts.join(" · ")} />
          <Fact label="Work/Codex account access" value="Unknown until returned by the account/runtime" />
        </dl>
        {gpt61Price ? <div className="platform-rate-grid">
          <div><b>Rate</b><b>Input / 1M</b><b>Cached input / 1M</b><b>Output / 1M</b>
            <span>API Standard, short context</span><span>${gpt61Price.inputUsdPerMillion?.toFixed(2)}</span><span>${gpt61Price.cachedInputUsdPerMillion?.toFixed(2)}</span><span>${gpt61Price.outputUsdPerMillion?.toFixed(2)}</span>
            <span>Work/Codex Standard credits</span><span>{gpt61Price.inputCreditsPerMillion}</span><span>{gpt61Price.cachedInputCreditsPerMillion}</span><span>{gpt61Price.outputCreditsPerMillion}</span>
          </div>
          <p>API cache writes: ${gpt61Price.cacheWriteUsdPerMillion?.toFixed(2)} per 1M; Codex does not charge cache writes in credits. Above {formatTokens(GPT_61_SOL.longContextThresholdTokens)} input tokens, the API documents Standard rates of $4 input, $0.20 cached input, $5 cache writes, and $15 output per million for the full request. Aggregate telemetry lacks per-request context lengths, so that tier is not applied to historical estimates.</p>
          <p>Work/Codex credit rates come from OpenAI’s credit-based Work/Codex rate card. Eligibility and rate cards vary by plan and workspace, so this dashboard cannot determine whether that card applies to this account; personal-plan credit purchase prices and balances remain account-specific.</p>
          <SourceLink sourceId="workRateCard" /> <SourceLink sourceId="apiPricing" />
        </div> : <p className="platform-unavailable">Pricing metadata is unavailable.</p>}
      </article>
      <details className="platform-panel platform-details">
        <summary>Locally bundled model catalog <span>{LOCAL_CODEX_MODELS.length} entries · snapshot, not a live connection</span></summary>
        <div className="platform-table-wrap"><table><thead><tr><th>Bundled slug</th><th>Context window</th><th>Maximum context</th><th>Reasoning efforts</th><th>Catalog tier</th></tr></thead>
          <tbody>{LOCAL_CODEX_MODELS.map((model) => <tr key={model.id}><th><code>{model.id}</code><small>{model.displayName}</small></th><td>{formatTokens(model.contextWindowTokens)}</td><td>{formatTokens(model.maximumContextTokens)}</td><td>{model.reasoningEfforts.join(", ")}</td><td>{model.speedTiers.length ? model.speedTiers.join(", ") : "Not listed"}</td></tr>)}</tbody>
        </table></div>
        <p className="platform-note">Observed with <code>codex debug models --bundled</code> on {LOCAL_CODEX_RUNTIME.cliVersion}. This snapshot can include gated or retired model definitions; it is not the account’s selectable-model list. GPT-6.1 Sol and Ultrafast were not in this bundled output, which does not prove they are unavailable to the account or another client.</p>
        <SourceLink sourceId="localRuntime" />
      </details>
    </section>

    <div className="platform-columns">
      <section className="platform-section" aria-labelledby="platform-tiers-title">
        <SectionHeading eyebrow="PROCESSING, NOT REASONING" title="Service tiers" id="platform-tiers-title" />
        <article className="platform-panel platform-table-wrap"><table><thead><tr><th>Tier</th><th>API vs Standard</th><th>Work/Codex credits</th><th>Scope</th></tr></thead><tbody>
          {SERVICE_TIER_REGISTRY.map((tier) => <tr key={tier.id}><th>{tier.id}</th><td>{tier.apiMultiplier === 1 ? "1×" : tier.apiMultiplier === null ? "Unknown" : `${tier.apiMultiplier}×`}</td><td>{tier.workCodexPurchasedCreditMultiplier === null ? "No published rate" : `${tier.workCodexPurchasedCreditMultiplier}× purchased · ${tier.workCodexIncludedAllowanceMultiplier}× included allowance`}</td><td>{tier.modelsAndScope}</td></tr>)}
        </tbody></table>
          <p className="platform-note">Fast and Ultrafast are not reasoning efforts. The local model catalog lists Fast for selected models, but current telemetry does not capture the tier that actually served a request. Therefore these multipliers are documented for reference only and are not applied to the aggregate estimator.</p>
          <SourceLink sourceId="apiPricing" /> <SourceLink sourceId="workRateCard" />
        </article>
      </section>

      <section className="platform-section" aria-labelledby="platform-runtime-title">
        <SectionHeading eyebrow="THIS WINDOWS INSTALL · POINT-IN-TIME" title="Observed local runtime" id="platform-runtime-title" />
        <article className="platform-panel">
          <dl className="platform-facts platform-runtime-facts">
            <Fact label="Codex CLI" value={LOCAL_CODEX_RUNTIME.cliVersion} />
            <Fact label="Codex Desktop package" value={LOCAL_CODEX_RUNTIME.desktopPackageVersion} />
            <Fact label="Model catalog" value={`${LOCAL_CODEX_MODELS.length} bundled entries`} />
            <Fact label="Slash commands in --help" value="Not enumerated" />
          </dl>
          <h3 className="platform-subheading">Top-level CLI commands observed</h3>
          <div className="platform-chips">{LOCAL_CODEX_RUNTIME.topLevelCommands.map((command) => <code key={command}>{command}</code>)}</div>
          <p className="platform-note">The local <code>--help</code> output lists entrypoint verbs, not the slash-command menu. The slash-command registry below is official source/documentation data; local availability remains unknown unless directly observed.</p>
          <p className="platform-note">Runtime snapshot captured {LOCAL_CODEX_RUNTIME.observedAt}.</p>
          <SourceLink sourceId="localRuntime" />
        </article>
      </section>
    </div>

    <section className="platform-section" aria-labelledby="platform-commands-title">
      <SectionHeading eyebrow="SURFACES ARE NOT INTERCHANGEABLE" title="Command registry" id="platform-commands-title" />
      <div className="platform-command-grid">
        <CommandGroup title="Codex CLI / TUI · upstream source" commands={CODEX_CLI_COMMANDS} sourceId="codexSource" />
        <CommandGroup title="Codex desktop · official reference" commands={CODEX_DESKTOP_COMMANDS} sourceId="desktopCommands" />
      </div>
      <p className="platform-note">CLI/TUI commands are present in upstream source, but a source-main entry is not a claim that this alpha install ships it. Desktop commands are documented separately. Notable corrections: upstream uses <code>/setup-default-sandbox</code>, <code>/approve</code>, and <code>/subagents</code>—not <code>/elevate-sandbox</code>, <code>/auto-review</code>, or <code>/multi-agents</code>. GPT-6.1 multi-agent support is a separate API beta feature.</p>
    </section>

    <div className="platform-columns">
      <section className="platform-section" aria-labelledby="platform-usage-title">
        <SectionHeading eyebrow="ACCOUNT VALUES ONLY WHEN RETURNED" title="Usage and reset semantics" id="platform-usage-title" />
        <article className="platform-panel platform-table-wrap"><table><thead><tr><th>Kind</th><th>Evidence field</th><th>How it is represented</th><th>Source</th></tr></thead><tbody>
          {USAGE_RESET_SEMANTICS.map((item) => <tr key={item.id}><th>{item.title}</th><td><code>{item.field}</code></td><td>{item.observation}</td><td><SourceLink sourceId={item.sourceId} compact /></td></tr>)}
        </tbody></table>
          <p className="platform-note">The existing local app-server client reads account, rate limits, and usage only; it does not consume or purchase resets. A banked reset is not a credit. Global resets apply automatically; purchased instant resets are separate from usage credits. Neither purchase nor account eligibility is proved by this reader.</p>
        </article>
      </section>

      <section className="platform-section" aria-labelledby="platform-observability-title">
        <SectionHeading eyebrow="NO INFERRED AGENT GRAPH" title="What telemetry can prove" id="platform-observability-title" />
        <article className="platform-panel">
          <ul className="platform-boundary-list">{TELEMETRY_BOUNDARIES.map((item) => <li key={item.name}><span className={`platform-state ${item.state}`}>{item.state.replaceAll("_", " ")}</span><div><b>{item.name}</b><p>{item.detail}</p></div></li>)}</ul>
          <p className="platform-note">Existing token, session, tool, quota, trend, composition, and pricing history remains on its current ingestion and D1 paths. Product metadata is bundled static data and never written per session or poll.</p>
        </article>
      </section>
    </div>

    <section className="platform-section" aria-labelledby="platform-provenance-title">
      <SectionHeading eyebrow="OFFICIAL SOURCES · POINT-IN-TIME CHECK" title="Provenance and refresh" id="platform-provenance-title" />
      <div className="platform-source-grid">{(Object.values(PLATFORM_SOURCES) as PlatformSource[]).map((source) => <div className="platform-source" key={source.sourceId}>
        <span>{source.authority.replaceAll("_", " ")}</span>
        {source.url ? <a href={source.url} rel="noreferrer">{source.title}</a> : <b>{source.title}</b>}
        <code>{source.sourceId}</code>
        <small>Verified {source.verifiedAt}{source.effectiveDate ? ` · effective ${source.effectiveDate}` : ""}</small>
      </div>)}</div>
      <div className="platform-reviewed">{OTHER_REVIEWED_SURFACES.map((surface) => <div key={surface.title}><b>{surface.title}</b><span>{surface.summary}</span><SourceLink sourceId={surface.sourceId} /></div>)}</div>
      <p className="platform-note">Refresh by rechecking OpenAI’s model/pricing pages, release notes, Help Center rate card and app-server reference, then the current <code>openai/codex</code> slash-command source and this machine’s <code>codex --version</code>, <code>codex --help</code>, and bundled model catalog. Update source IDs, verification time, and tests together. Runtime rendering has no GitHub/OpenAI network dependency.</p>
    </section>
  </div>;
}

function SectionHeading({ eyebrow, title, id }: Readonly<{ eyebrow: string; title: string; id: string }>) {
  return <header className="platform-section-heading"><div><span>{eyebrow}</span><h2 id={id}>{title}</h2></div></header>;
}

function CapabilityCard({ capability }: Readonly<{ capability: PlatformCapability }>) {
  return <article className="platform-panel platform-capability-card">
    <div className="platform-card-top"><span className={`platform-status ${capability.status}`}>{capability.status.replaceAll("_", " ")}</span><span>{capability.surface}{capability.effectiveDate ? ` · effective ${capability.effectiveDate}` : ""}</span></div>
    <h3>{capability.title}</h3><p>{capability.summary}</p>
    <div className="platform-card-bottom"><span>Account: <b>{capability.accountAvailability}</b></span>{capability.sourceIds.map((sourceId) => <SourceLink key={sourceId} sourceId={sourceId} compact />)}</div>
  </article>;
}

function CommandGroup({ title, commands, sourceId }: Readonly<{ title: string; commands: typeof CODEX_CLI_COMMANDS | typeof CODEX_DESKTOP_COMMANDS; sourceId: PlatformSourceId }>) {
  return <details className="platform-panel platform-details">
    <summary>{title}<span>{commands.length} commands · local availability unknown</span></summary>
    <div className="platform-table-wrap"><table><thead><tr><th>Command</th><th>Purpose</th><th>Source status</th><th>This install</th></tr></thead><tbody>
      {commands.map((item) => <tr key={`${item.surface}:${item.command}`}><th><code>{item.command}</code>{item.aliases?.length ? <small>aliases: {item.aliases.join(", ")}</small> : null}</th><td>{item.purpose}{item.surface.endsWith("debug build") ? " (debug build only)" : ""}</td><td>{item.official ? "Official command" : "Unknown"}</td><td>{item.localObservation === "unknown" ? "Unknown" : item.localObservation.replaceAll("_", " ")}</td></tr>)}
    </tbody></table></div>
    <p className="platform-note">Official source: {itemSourceTitle(sourceId)}. No minimum stable version is claimed because the referenced source does not establish one.</p>
    <SourceLink sourceId={sourceId} />
  </details>;
}

function SourceLink({ sourceId, compact = false }: Readonly<{ sourceId: PlatformSourceId; compact?: boolean }>) {
  const source = getPlatformSource(sourceId);
  return source.url
    ? <a className={compact ? "platform-source-link compact" : "platform-source-link"} href={source.url} rel="noreferrer">{compact ? "Source" : source.title}</a>
    : <span className="platform-source-link">{source.title}</span>;
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatTokens(value: number) {
  return value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(3))}M` : `${Math.round(value / 1_000)}K`;
}

function itemSourceTitle(sourceId: PlatformSourceId) {
  return PLATFORM_SOURCES[sourceId].title;
}
