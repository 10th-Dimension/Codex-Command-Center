/**
 * Static, source-attributed OpenAI/Codex capability metadata.
 * This registry is bundled at build time; it never fetches remote metadata or
 * writes product facts into telemetry tables.
 */
export const PLATFORM_VERIFIED_AT = "2026-09-30T01:45:35.000Z" as const;
const productMetadataVerified = "2026-09-30T01:36:04.000Z";
const previouslyVerified = "2026-09-30T01:23:56.000Z";

export type PlatformStatus = "available" | "rolling_out" | "announced" | "preview" | "beta" | "unavailable" | "unknown";
export type PlatformAuthority = "runtime" | "official_source_code" | "official_developer_docs" | "official_help_center" | "official_release_notes" | "official_safety_document" | "official_event";

export interface PlatformSource {
  sourceId: string;
  sourceType: "runtime" | "source_code" | "developer_docs" | "help_center" | "release_notes" | "safety_document" | "official_event";
  title: string;
  url?: string;
  revision?: string;
  authority: PlatformAuthority;
  verifiedAt: string;
  effectiveDate?: string;
}

const verified = productMetadataVerified;

export const PLATFORM_SOURCES = {
  localRuntime: {
    sourceId: "local-codex-runtime-2026-09-29",
    sourceType: "runtime",
    title: "Codex CLI help and bundled model catalog on this Windows machine",
    authority: "runtime",
    verifiedAt: previouslyVerified,
    effectiveDate: "2026-09-29",
  },
  apiModel: {
    sourceId: "openai-api-model-gpt-6.1-sol",
    sourceType: "developer_docs",
    title: "GPT-6.1 Sol model documentation",
    url: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    authority: "official_developer_docs",
    verifiedAt: verified,
    effectiveDate: "2026-09-29",
  },
  apiPricing: {
    sourceId: "openai-api-pricing-2026-09-29",
    sourceType: "developer_docs",
    title: "OpenAI API pricing",
    url: "https://developers.openai.com/api/docs/pricing",
    authority: "official_developer_docs",
    verifiedAt: verified,
  },
  workRateCard: {
    sourceId: "openai-work-codex-credit-rate-card-2026-09-29",
    sourceType: "help_center",
    title: "ChatGPT Rate Card: Business, Enterprise/Edu credit-based pricing",
    url: "https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing",
    authority: "official_help_center",
    verifiedAt: verified,
  },
  apiChangelog: {
    sourceId: "openai-api-changelog-2026-09-29",
    sourceType: "release_notes",
    title: "OpenAI API Changelog — September 29, 2026",
    url: "https://developers.openai.com/api/docs/changelog",
    authority: "official_release_notes",
    verifiedAt: verified,
    effectiveDate: "2026-09-29",
  },
  devDayEvent: {
    sourceId: "openai-devday-2026-event",
    sourceType: "official_event",
    title: "OpenAI DevDay 2026 event page",
    url: "https://devday.openai.com/",
    authority: "official_event",
    verifiedAt: PLATFORM_VERIFIED_AT,
    effectiveDate: "2026-09-29",
  },
  codexSource: {
    sourceId: "openai-codex-tui-slash-command-85eabb59",
    sourceType: "source_code",
    title: "OpenAI Codex CLI/TUI slash command definitions (upstream main)",
    url: "https://github.com/openai/codex/blob/85eabb59dcc1ba7ee22de8172f4e90ce3af0e49d/codex-rs/tui/src/slash_command.rs",
    revision: "85eabb59dcc1ba7ee22de8172f4e90ce3af0e49d",
    authority: "official_source_code",
    verifiedAt: previouslyVerified,
  },
  desktopCommands: {
    sourceId: "codex-desktop-command-reference",
    sourceType: "help_center",
    title: "Codex desktop slash commands",
    url: "https://learn.chatgpt.com/docs/developer-commands",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  appServer: {
    sourceId: "codex-app-server-account-api",
    sourceType: "help_center",
    title: "Codex app-server account and usage methods",
    url: "https://learn.chatgpt.com/docs/app-server",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  bankedResetHelp: {
    sourceId: "codex-banked-and-global-reset-help",
    sourceType: "help_center",
    title: "How banked Codex resets work",
    url: "https://help.openai.com/en/articles/20001498-how-banked-codex-resets-work",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  purchasedResetHelp: {
    sourceId: "codex-purchased-instant-reset-help",
    sourceType: "help_center",
    title: "Paid weekly Work and Codex rate-limit resets",
    url: "https://help.openai.com/en/articles/20001507-paid-weekly-work-and-codex-rate-limit-resets",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  usageHelp: {
    sourceId: "using-codex-with-chatgpt-plan-help",
    sourceType: "help_center",
    title: "Using Codex with your ChatGPT plan",
    url: "https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  cloud: {
    sourceId: "codex-cloud-and-environments",
    sourceType: "help_center",
    title: "Codex Cloud and reusable cloud environments",
    url: "https://learn.chatgpt.com/docs/cloud",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  signIn: {
    sourceId: "sign-in-with-chatgpt-2026-09-28",
    sourceType: "developer_docs",
    title: "Integrating Sign in with ChatGPT in your Open Source App",
    url: "https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt",
    authority: "official_developer_docs",
    verifiedAt: previouslyVerified,
    effectiveDate: "2026-09-28",
  },
  daybreak: {
    sourceId: "openai-daybreak-access-guide",
    sourceType: "safety_document",
    title: "Daybreak security model access guide",
    url: "https://developers.openai.com/api/docs/guides/daybreak",
    authority: "official_safety_document",
    verifiedAt: previouslyVerified,
  },
  dots: {
    sourceId: "chatgpt-dots-official-docs",
    sourceType: "help_center",
    title: "ChatGPT dots documentation",
    url: "https://learn.chatgpt.com/docs/dots/computers-and-apps",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  space: {
    sourceId: "chatgpt-space-official-docs",
    sourceType: "help_center",
    title: "ChatGPT Space documentation",
    url: "https://learn.chatgpt.com/docs/space",
    authority: "official_help_center",
    verifiedAt: previouslyVerified,
  },
  codexReleaseNotes: {
    sourceId: "codex-cli-and-app-changelog",
    sourceType: "release_notes",
    title: "Codex CLI and app changelog",
    url: "https://learn.chatgpt.com/docs/changelog",
    authority: "official_release_notes",
    verifiedAt: previouslyVerified,
  },
} as const satisfies Record<string, PlatformSource>;

export type PlatformSourceId = keyof typeof PLATFORM_SOURCES;

export interface LocalCodexModel {
  id: string;
  displayName: string;
  reasoningEfforts: readonly string[];
  contextWindowTokens: number;
  maximumContextTokens: number;
  speedTiers: readonly string[];
}

/** Point-in-time machine snapshot; not a live query and not account eligibility. */
export const LOCAL_CODEX_RUNTIME = {
  observedAt: previouslyVerified,
  cliVersion: "0.158.0-alpha.2.1",
  desktopPackageVersion: "26.924.2738.0",
  sourceId: "localRuntime" satisfies PlatformSourceId,
  topLevelCommands: [
    "agents", "exec", "review", "login", "logout", "mcp", "plugin", "app-server", "remote-control", "app",
    "completion", "update", "doctor", "sandbox", "debug", "apply", "resume", "queue", "archive", "delete",
    "migrate-rollouts", "unarchive", "fork", "cloud", "exec-server", "features", "help",
  ],
} as const;

export const LOCAL_CODEX_MODELS: readonly LocalCodexModel[] = [
  { id: "gpt-6-astra", displayName: "GPT-6 Astra", reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
  { id: "gpt-6-sol", displayName: "GPT-6 Sol", reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
  { id: "gpt-6-luna", displayName: "GPT-6 Luna", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
  { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
  { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
  { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
  { id: "gpt-daybreak-blue-latest", displayName: "Daybreak Blue (local slug)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], contextWindowTokens: 272_000, maximumContextTokens: 272_000, speedTiers: [] },
  { id: "gpt-daybreak-red-latest", displayName: "Daybreak Red (local slug)", reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], contextWindowTokens: 372_000, maximumContextTokens: 372_000, speedTiers: [] },
  { id: "gpt-5.5", displayName: "GPT-5.5", reasoningEfforts: ["low", "medium", "high", "xhigh"], contextWindowTokens: 272_000, maximumContextTokens: 272_000, speedTiers: ["fast"] },
  { id: "gpt-5.4", displayName: "GPT-5.4 (bundled entry)", reasoningEfforts: ["low", "medium", "high", "xhigh"], contextWindowTokens: 272_000, maximumContextTokens: 1_000_000, speedTiers: ["fast"] },
  { id: "codex-auto-review", displayName: "Codex Auto Review", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], contextWindowTokens: 272_000, maximumContextTokens: 872_000, speedTiers: ["fast"] },
];

export const GPT_61_SOL = {
  id: "gpt-6.1-sol",
  displayName: "GPT-6.1 Sol",
  family: "GPT-6",
  generation: 6.1,
  apiStatus: "available" satisfies PlatformStatus,
  workCodexStatus: "available" satisfies PlatformStatus,
  accountAvailability: "unknown" satisfies PlatformStatus,
  installedCodexBundleObservation: "not_observed" as const,
  contextWindowTokens: 1_050_000,
  maximumOutputTokens: 128_000,
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] as const,
  unsupportedReasoningEfforts: ["none", "minimal"] as const,
  longContextThresholdTokens: 272_000,
  apiToolSurface: "Responses API",
  sourceIds: ["apiModel", "apiPricing", "workRateCard", "apiChangelog"] as const satisfies readonly PlatformSourceId[],
};

export function normalizeKnownModelIdentifier(identifier: string): string {
  const original = identifier.trim();
  if (!original) return identifier;
  const normalized = original.toLowerCase()
    .replace(/^openai[/:]/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/-(?:none|minimal|low|medium|high|xhigh|max|ultra)$/, "");
  const withoutGpt = normalized.replace(/^gpt-/, "");
  if (withoutGpt === "6.1-sol" || withoutGpt === "6.1-sol-latest") return "gpt-6.1-sol";
  const localMatch = LOCAL_CODEX_MODELS.find((model) => model.id === normalized);
  return localMatch?.id ?? original;
}

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export function reasoningEffortSupport(model: string, effort: string, surface: "api" | "installed-codex"):
  CapabilitySupport {
  const canonicalModel = normalizeKnownModelIdentifier(model);
  const normalizedEffort = effort.trim().toLowerCase().replace(/_/g, "-");
  if (canonicalModel === GPT_61_SOL.id) {
    if (surface !== "api") return "unknown";
    return (GPT_61_SOL.reasoningEfforts as readonly string[]).includes(normalizedEffort) ? "supported" : "unsupported";
  }
  const localModel = LOCAL_CODEX_MODELS.find((item) => item.id === canonicalModel);
  if (localModel && surface === "installed-codex") {
    return localModel.reasoningEfforts.includes(normalizedEffort) ? "supported" : "unsupported";
  }
  return "unknown";
}

export type ServiceTierId = "standard" | "batch" | "flex" | "fast" | "ultrafast" | "unknown";

/** Null/missing values remain unknown; only explicit documented aliases normalize. */
export function normalizeServiceTier(value: unknown): ServiceTierId {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  const normalized = value.trim().toLowerCase().replace(/[\s_:-]+/g, "");
  if (normalized === "standard" || normalized === "default") return "standard";
  if (normalized === "batch") return "batch";
  if (normalized === "flex") return "flex";
  if (normalized === "fast" || normalized === "priority" || normalized === "priorityfast") return "fast";
  if (normalized === "ultrafast") return "ultrafast";
  return "unknown";
}

export interface ServiceTierMetadata {
  id: Exclude<ServiceTierId, "unknown">;
  apiMultiplier: number | null;
  workCodexPurchasedCreditMultiplier: number | null;
  workCodexIncludedAllowanceMultiplier: number | null;
  modelsAndScope: string;
  status: PlatformStatus;
}

export const SERVICE_TIER_REGISTRY: readonly ServiceTierMetadata[] = [
  { id: "standard", apiMultiplier: 1, workCodexPurchasedCreditMultiplier: 1, workCodexIncludedAllowanceMultiplier: 1, modelsAndScope: "Baseline pricing; the account's applicable plan/rate card still governs actual usage.", status: "available" },
  { id: "batch", apiMultiplier: 0.5, workCodexPurchasedCreditMultiplier: null, workCodexIncludedAllowanceMultiplier: null, modelsAndScope: "API processing tier; no Codex runtime/account telemetry support is established here.", status: "available" },
  { id: "flex", apiMultiplier: 0.5, workCodexPurchasedCreditMultiplier: null, workCodexIncludedAllowanceMultiplier: null, modelsAndScope: "API processing tier; no Codex runtime/account telemetry support is established here.", status: "available" },
  { id: "fast", apiMultiplier: 2, workCodexPurchasedCreditMultiplier: 2, workCodexIncludedAllowanceMultiplier: 2.5, modelsAndScope: "Published for GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol, and GPT-6 Luna where available; the installed bundle advertises Fast only for its listed models.", status: "available" },
  { id: "ultrafast", apiMultiplier: 6, workCodexPurchasedCreditMultiplier: 6, workCodexIncludedAllowanceMultiplier: 8, modelsAndScope: "GPT-6 Astra only in API; Work/Codex credit card lists eligible Pro $500 and eligible Enterprise/Edu plans. Not present in this installed bundle's model tier list.", status: "available" },
];

export interface PlatformCapability {
  id: string;
  title: string;
  status: PlatformStatus;
  effectiveDate?: string;
  surface: string;
  accountAvailability: PlatformStatus;
  summary: string;
  sourceIds: readonly PlatformSourceId[];
}

export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  { id: "gpt-6.1-sol", title: "GPT-6.1 Sol", status: "available", effectiveDate: "2026-09-29", surface: "API; Work/Codex product and credit rate card", accountAvailability: "unknown", summary: "New GPT-6 family model for complex coding and professional work. Tool calling uses Responses API. Not observed in this machine's bundled Codex model catalog.", sourceIds: ["apiModel", "apiChangelog", "workRateCard", "localRuntime"] },
  { id: "gpt-6.1-multi-agent", title: "GPT-6.1 Sol multi-agent", status: "beta", effectiveDate: "2026-09-29", surface: "Responses API", accountAvailability: "unknown", summary: "The API changelog marks delegation to subagents as beta. Current local Codex telemetry does not expose a verified parent/child lifecycle graph.", sourceIds: ["apiChangelog"] },
  { id: "ultrafast", title: "Ultrafast processing", status: "available", effectiveDate: "2026-09-29", surface: "Responses API on GPT-6 Astra; Work/Codex on eligible plans", accountAvailability: "unknown", summary: "A processing tier, not a reasoning effort. API access is rate-limited and restricted to global/US residency. Work/Codex credit eligibility is plan-dependent. Not listed by this local bundle.", sourceIds: ["apiChangelog", "apiPricing", "workRateCard", "localRuntime"] },
  { id: "agents-api-computer-use", title: "Agents API computer use", status: "available", effectiveDate: "2026-09-29", surface: "Agents API / OpenAI-hosted browser", accountAvailability: "unknown", summary: "Officially added Sep 29. It is not a Codex desktop telemetry signal and adds no Command Center integration by itself.", sourceIds: ["apiChangelog"] },
  { id: "codex-cloud", title: "Codex Cloud environments", status: "available", surface: "Codex web, CLI, and supported integrations", accountAvailability: "unknown", summary: "Documented isolated task workspaces can configure repositories, dependencies, tools, and environment setup. This project has no authenticated cloud-task telemetry provider, so cloud activity is not counted here.", sourceIds: ["cloud"] },
  { id: "sign-in-with-chatgpt", title: "Sign in with ChatGPT", status: "available", effectiveDate: "2026-09-28", surface: "Eligible local/open-source integrations; selected private apps", accountAvailability: "unknown", summary: "Identity and optional ChatGPT-plan usage are separate permissions. This is documented as a future authentication option only; existing Command Center authentication is unchanged.", sourceIds: ["signIn"] },
  { id: "codex-voice-command", title: "Codex /voice command", status: "available", surface: "Codex CLI/TUI upstream source", accountAvailability: "unknown", summary: "The pinned upstream command source defines /voice. The local --help output does not enumerate slash menus, so availability on this install and any voice telemetry remain unknown.", sourceIds: ["codexSource", "localRuntime"] },
  { id: "gpt-5.5-retirement", title: "GPT-5.5 Codex retirement", status: "announced", effectiveDate: "2026-10-14", surface: "ChatGPT, Work, and Codex; API unaffected", accountAvailability: "unknown", summary: "OpenAI scheduled GPT-5.5 retirement for Oct 14, 2026. It is still present in this local bundle snapshot; the model picker and account eligibility were not inspected.", sourceIds: ["codexReleaseNotes", "localRuntime"] },
  { id: "gpt-5.4-codex-retirement", title: "GPT-5.4 Codex retirement", status: "unavailable", effectiveDate: "2026-08-31", surface: "Codex with ChatGPT sign-in; API-key use unaffected", accountAvailability: "unknown", summary: "OpenAI says GPT-5.4 and GPT-5.4 mini are no longer available in Codex when signed in with ChatGPT. This older model definition can still appear in a bundled catalog and does not establish account selection or API-key availability.", sourceIds: ["codexReleaseNotes", "localRuntime"] },
  { id: "daybreak", title: "Daybreak security models", status: "available", surface: "API / Work and Codex with Trusted Access approval", accountAvailability: "unknown", summary: "OpenAI requires Daybreak/Trusted Access approval; Red requires separate provisioning. The Blue/Red model slugs exist in this local bundle, but that alone does not prove account access.", sourceIds: ["daybreak", "workRateCard", "localRuntime"] },
];

export interface CommandMetadata {
  command: string;
  purpose: string;
  category: string;
  surface: "Codex CLI/TUI" | "Codex CLI/TUI debug build" | "Codex desktop";
  official: true;
  status: PlatformStatus;
  localObservation: "observed" | "not_observed" | "unknown";
  sourceId: PlatformSourceId;
  aliases?: readonly string[];
}

type CliCommandTuple = readonly [command: string, purpose: string, category: string, visibility?: "normal" | "debug", aliases?: readonly string[]];

const cliCommands: readonly CliCommandTuple[] = [
  ["/model", "Choose the model and reasoning effort.", "model"],
  ["/ide", "Manage IDE integration context.", "workspace"],
  ["/permissions", "Review or change approval and permission mode.", "safety"],
  ["/keymap", "Inspect or change keyboard shortcuts.", "settings"],
  ["/vim", "Toggle Vim-style input editing.", "settings"],
  ["/setup-default-sandbox", "Configure the default sandbox setup.", "safety"],
  ["/experimental", "View experimental Codex features.", "settings"],
  ["/approve", "Resolve an approval request for a tool or action.", "safety"],
  ["/memories", "Inspect or manage saved Codex memories.", "context"],
  ["/skills", "Discover and invoke available skills.", "extensions"],
  ["/import", "Import a prior conversation or session.", "session"],
  ["/hooks", "Inspect configured lifecycle hooks.", "extensions"],
  ["/review", "Review changes in the current workspace.", "review"],
  ["/rename", "Rename the current session.", "session"],
  ["/new", "Start a new session.", "session"],
  ["/archive", "Archive the current session.", "session"],
  ["/delete", "Delete a session.", "session"],
  ["/resume", "Resume a prior session.", "session"],
  ["/fork", "Fork the current session.", "session"],
  ["/worktree", "Manage isolated Git worktrees.", "workspace"],
  ["/app", "Open the Codex app integration where supported.", "integration"],
  ["/init", "Create or update project instruction files.", "workspace"],
  ["/compact", "Compact the current conversation context.", "context"],
  ["/recap", "Summarize recent session activity.", "session"],
  ["/plan", "Set or inspect the current plan.", "workflow"],
  ["/voice", "Start voice interaction.", "input"],
  ["/goal", "Manage the current goal.", "workflow"],
  ["/agents", "Inspect agent configuration or available agents.", "agents"],
  ["/side", "Ask a side question without changing the main task.", "workflow"],
  ["/btw", "Ask a brief contextual question.", "workflow"],
  ["/copy", "Copy the latest response.", "output"],
  ["/export", "Export conversation data.", "output"],
  ["/raw", "Toggle raw response display.", "output"],
  ["/tui", "Change terminal interface settings.", "settings"],
  ["/diff", "Show the current workspace diff.", "workspace"],
  ["/mention", "Mention or select a workspace resource.", "context"],
  ["/status", "Show session and runtime status.", "diagnostics"],
  ["/daemon", "Manage the Codex daemon connection.", "runtime"],
  ["/warnings", "Show current warnings.", "diagnostics"],
  ["/cd", "Change the current working directory.", "workspace"],
  ["/pwd", "Show the current working directory.", "workspace", "normal", ["/cwd"]],
  ["/usage", "Show local usage information.", "usage"],
  ["/debug-config", "Inspect effective debug configuration.", "diagnostics"],
  ["/title", "Set the session title.", "session"],
  ["/statusline", "Configure the terminal status line.", "settings"],
  ["/theme", "Change terminal theme.", "settings"],
  ["/pets", "Control terminal companion display.", "settings", "normal", ["/pet"]],
  ["/mcp", "Inspect MCP server connections.", "integrations"],
  ["/apps", "Browse connected apps.", "integrations"],
  ["/plugins", "Manage or inspect plugins.", "integrations"],
  ["/logout", "Sign out of the current Codex account.", "account"],
  ["/quit", "Exit Codex.", "session"],
  ["/exit", "Exit Codex.", "session"],
  ["/feedback", "Send product feedback.", "support"],
  ["/rollout", "Inspect rollout/debug details.", "diagnostics", "debug"],
  ["/ps", "Inspect running tasks.", "runtime"],
  ["/stop", "Stop or clean up a running task.", "runtime", "normal", ["/clean"]],
  ["/clear", "Clear the current terminal view.", "settings"],
  ["/test-approval", "Exercise approval UI in debug builds.", "safety", "debug"],
  ["/subagents", "Inspect child agents associated with the session.", "agents"],
];

export const CODEX_CLI_COMMANDS: readonly CommandMetadata[] = cliCommands.map(([command, purpose, category, visibility, aliases]) => ({
  command,
  purpose,
  category,
  surface: visibility === "debug" ? "Codex CLI/TUI debug build" : "Codex CLI/TUI",
  official: true,
  status: "unknown",
  localObservation: "unknown",
  sourceId: "codexSource",
  ...(aliases ? { aliases } : {}),
}));

const desktopCommands: readonly [string, string][] = [
  ["/approve", "Review an approval action."], ["/cloud", "Start or manage a cloud task."],
  ["/cloud-environment", "Choose or configure a cloud environment."], ["/compact", "Compact conversation context."],
  ["/feedback", "Send product feedback."], ["/fork", "Fork the current task."], ["/goal", "Manage the current goal."],
  ["/ide-context", "Manage IDE context."], ["/init", "Set up repository instructions."], ["/local", "Choose local execution."],
  ["/mcp", "Manage MCP connections."], ["/memories", "Manage saved memories."], ["/model", "Choose a model."],
  ["/personality", "Choose response style."], ["/plan", "Manage task planning."], ["/project", "Choose a project."],
  ["/reasoning", "Choose reasoning effort."], ["/review", "Review changes."], ["/side", "Ask a side question."],
  ["/status", "Show task status."], ["/worktree", "Manage an isolated worktree."],
];

export const CODEX_DESKTOP_COMMANDS: readonly CommandMetadata[] = desktopCommands.map(([command, purpose]) => ({
  command,
  purpose,
  category: "desktop",
  surface: "Codex desktop",
  official: true,
  status: "available",
  localObservation: "unknown",
  sourceId: "desktopCommands",
}));

export const CODEX_COMMAND_REGISTRY: readonly CommandMetadata[] = [...CODEX_CLI_COMMANDS, ...CODEX_DESKTOP_COMMANDS];

export const USAGE_RESET_SEMANTICS = [
  { id: "automatic-window", title: "Automatic usage-window reset", field: "rateLimits.primary / secondary", sourceId: "appServer", observation: "Account-specific window usage and reset time are shown only when returned." },
  { id: "banked", title: "Banked reset", field: "rateLimitResetCredits.availableCount; details[].resetType/status/expiresAt when present", sourceId: "appServer", observation: "Distinct from credits. Redeeming one resets applicable usage windows and may move the next weekly reset date; show only schedule values subsequently returned by the runtime. Detail rows may be capped, so availableCount remains authoritative." },
  { id: "global-promotional", title: "Global/promotional reset", field: "not exposed as a distinct documented app-server field", sourceId: "bankedResetHelp", observation: "OpenAI documents global resets as automatic and not banked; this reader cannot prove an account-specific promotional reset occurred." },
  { id: "purchased-instant", title: "Purchased instant reset", field: "not exposed as a distinct documented app-server field", sourceId: "purchasedResetHelp", observation: "OpenAI documents paid instant resets for eligible personal accounts; this reader cannot prove purchase or eligibility. Do not infer from credits or banked resets." },
  { id: "credits", title: "Credit balance", field: "account/usage/read credits", sourceId: "appServer", observation: "Separate account balance when returned; never derived from API-equivalent pricing." },
] as const;

export const TELEMETRY_BOUNDARIES = [
  { name: "Served processing tier", state: "unknown", detail: "The current ingestion/model rollups do not capture the API response service_tier." },
  { name: "Parent/child agent lifecycle", state: "unknown", detail: "An agent name may be observed, but parent IDs, lifecycle, and reliable delegation edges are not materialized." },
  { name: "Local/cloud/remote execution target", state: "unknown", detail: "No trusted execution-target field is currently normalized for this telemetry source." },
  { name: "Cloud-task telemetry", state: "unavailable", detail: "No authenticated Codex Cloud task telemetry provider is configured in this application." },
] as const;

export const OTHER_REVIEWED_SURFACES = [
  { title: "dots", status: "available" satisfies PlatformStatus, summary: "Official ChatGPT capability documentation exists; no Codex Command Center telemetry contract was found, so it is not integrated.", sourceId: "dots" satisfies PlatformSourceId },
  { title: "ChatGPT Space", status: "available" satisfies PlatformStatus, summary: "Official shared workspace/docs capability; unrelated to Codex telemetry and kept outside this dashboard.", sourceId: "space" satisfies PlatformSourceId },
] as const;

export function getPlatformSource(sourceId: PlatformSourceId): PlatformSource {
  return PLATFORM_SOURCES[sourceId];
}
