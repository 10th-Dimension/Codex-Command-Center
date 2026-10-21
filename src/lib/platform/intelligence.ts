export type PlatformFeedSourceId = "openai_news" | "openai_api" | "openai_codex";

export interface PlatformIntelligenceStory {
  id: string;
  sourceId: PlatformFeedSourceId;
  sourceName: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
}

export interface PlatformFeedStatus {
  id: PlatformFeedSourceId;
  name: string;
  url: string;
  status: "ok" | "error";
  itemCount: number;
  lastCheckedAt: string;
}

export interface PlatformIntelligenceSnapshot {
  version: 1;
  lastCheckedAt: string;
  stories: PlatformIntelligenceStory[];
  sources: PlatformFeedStatus[];
}

export interface PlatformIntelligenceStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

type FeedSource = {
  id: PlatformFeedSourceId;
  name: string;
  url: string;
  format: "rss" | "markdown";
  allowedHosts: readonly string[];
};

const SOURCES: readonly FeedSource[] = [
  {
    id: "openai_news",
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    format: "rss",
    allowedHosts: ["openai.com"],
  },
  {
    id: "openai_api",
    name: "OpenAI API changelog",
    url: "https://developers.openai.com/api/docs/changelog.md",
    format: "markdown",
    allowedHosts: ["developers.openai.com"],
  },
  {
    id: "openai_codex",
    name: "ChatGPT and Codex changelog",
    url: "https://developers.openai.com/codex/changelog/rss.xml",
    format: "rss",
    allowedHosts: ["developers.openai.com", "learn.chatgpt.com"],
  },
];

const SNAPSHOT_KEY = "platform-intelligence-v1";
const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 45;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_STORIES = 40;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export const PLATFORM_REFRESH_CRON = "0 */6 * * *";

export async function readPlatformIntelligence(store: PlatformIntelligenceStore): Promise<PlatformIntelligenceSnapshot | null> {
  try {
    const value = await store.get(SNAPSHOT_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function refreshPlatformIntelligence(
  store: PlatformIntelligenceStore,
  now = new Date(),
): Promise<PlatformIntelligenceSnapshot> {
  const previous = await readPlatformIntelligence(store);
  const checkedAt = now.toISOString();
  const results = await Promise.all(SOURCES.map((source) => loadSource(source, now)));
  const storiesById = new Map<string, PlatformIntelligenceStory>();

  for (const story of previous?.stories ?? []) storiesById.set(story.id, story);
  for (const result of results) {
    for (const story of result.stories) storiesById.set(story.id, story);
  }

  const cutoff = now.getTime() - MAX_AGE_MS;
  const stories = dedupeStories([...storiesById.values()])
    .filter((story) => Date.parse(story.publishedAt) >= cutoff)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, MAX_STORIES);

  const snapshot: PlatformIntelligenceSnapshot = {
    version: 1,
    lastCheckedAt: checkedAt,
    stories,
    sources: results.map((result) => ({
      id: result.source.id,
      name: result.source.name,
      url: result.source.url.replace(/\.md$/, ""),
      status: result.error ? "error" : "ok",
      itemCount: result.stories.length,
      lastCheckedAt: checkedAt,
    })),
  };

  await store.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: SNAPSHOT_TTL_SECONDS });
  return snapshot;
}

async function loadSource(source: FeedSource, now: Date): Promise<{ source: FeedSource; stories: PlatformIntelligenceStory[]; error: boolean }> {
  try {
    const response = await fetch(source.url, {
      headers: {
        accept: source.format === "markdown" ? "text/markdown,text/plain;q=0.9" : "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9",
        "user-agent": "Codex-Command-Center-Platform-Feed/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok || !isAllowedHost(response.url || source.url, source.allowedHosts)) {
      return { source, stories: [], error: true };
    }

    const content = await readBoundedBody(response);
    if (source.format === "rss" && !/<(?:rss|feed)\b/i.test(content.slice(0, 16_000))) {
      return { source, stories: [], error: true };
    }
    if (source.format === "markdown" && !/^#\s+Changelog\b/m.test(content.slice(0, 4_000))) {
      return { source, stories: [], error: true };
    }
    const stories = source.format === "markdown"
      ? parseApiChangelog(content, source, now)
      : parseRss(content, source, now);
    return { source, stories, error: false };
  } catch {
    return { source, stories: [], error: true };
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("Feed is too large.");
  if (!response.body) throw new Error("Feed has no body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Feed is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function parseRss(body: string, source: FeedSource, now: Date): PlatformIntelligenceStory[] {
  const blocks = body.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  const stories: PlatformIntelligenceStory[] = [];

  for (const block of blocks.slice(0, 180)) {
    const title = cleanText(readTag(block, "title"));
    const rawLink = readTag(block, "link") || readAtomLink(block);
    const url = normalizeStoryUrl(rawLink, source.allowedHosts);
    const dateValue = readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated") || readTag(block, "dc:date");
    const publishedAt = parsePublishedDate(dateValue, now);
    const description = cleanText(readTag(block, "description") || readTag(block, "summary") || readTag(block, "content:encoded"));

    if (!title || !url || !publishedAt || !isRecent(publishedAt, now) || !isRelevant(source.id, title, description)) continue;
    stories.push(makeStory(source, title, description, url, publishedAt));
  }

  return stories;
}

function parseApiChangelog(markdown: string, source: FeedSource, now: Date): PlatformIntelligenceStory[] {
  const lines = markdown.split(/\r?\n/);
  const stories: PlatformIntelligenceStory[] = [];
  let monthIndex = -1;
  let year = 0;
  let dateHeading = "";
  let content: string[] = [];

  const flush = () => {
    if (!dateHeading || content.length === 0 || monthIndex < 0 || year < 2000) return;
    const day = Number(dateHeading.match(/\d{1,2}/)?.[0]);
    if (!Number.isInteger(day)) return;
    const publishedAt = new Date(Date.UTC(year, monthIndex, day, 12)).toISOString();
    if (!isRecent(publishedAt, now)) return;

    const paragraphs = content.join("\n").trim().split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    const label = paragraphs[0] && /^(Feature|Update|Fix|Deprecation|Removal|Change)\b/i.test(paragraphs[0]) ? paragraphs.shift() ?? "" : "";
    const description = paragraphs.map(markdownToText).filter(Boolean);
    const title = description.shift() ?? label;
    const excerpt = description.join(" ").trim();
    if (!title || !isRelevant(source.id, title, `${label} ${excerpt}`)) return;

    const month = new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toLowerCase();
    const url = `${source.url.replace(/\.md$/, "")}#${month}-${day}`;
    stories.push(makeStory(source, title, `${label}${excerpt ? ` · ${excerpt}` : ""}`, url, publishedAt));
  };

  for (const line of lines) {
    const month = line.match(/^##\s+([A-Za-z]+),\s+(\d{4})\s*$/);
    if (month) {
      flush();
      content = [];
      dateHeading = "";
      monthIndex = new Date(`${month[1]} 1, ${month[2]} UTC`).getUTCMonth();
      year = Number(month[2]);
      continue;
    }
    const date = line.match(/^###\s+([A-Za-z]+\s+\d{1,2})\s*$/);
    if (date) {
      flush();
      dateHeading = date[1];
      content = [];
      continue;
    }
    if (/^##\s+/.test(line)) {
      flush();
      content = [];
      dateHeading = "";
      continue;
    }
    if (dateHeading) content.push(line);
  }
  flush();
  return stories;
}

function isRelevant(sourceId: PlatformFeedSourceId, title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  if (sourceId === "openai_api") return true;
  if (sourceId === "openai_codex") {
    return /\b(codex|chatgpt|gpt[-\s]?\d|model|agent|voice|computer use|api)\b/i.test(text);
  }

  const heading = title.trim();
  if (/^(how|using|customer story|case study|openai acquires|partnering with)\b/i.test(heading)) return false;
  const product = /\b(chatgpt|codex|gpt[-\s]?\d|sora|openai api|openai models?)\b/i.test(text);
  const releaseSignal = /\b(new|launch(?:ed|es|ing)?|introduc(?:e|es|ed|ing)|release|available|roll(?:ing)? out|expand(?:s|ed|ing)?|adds?|update|feature|capabilit(?:y|ies)|model)\b/i.test(text);
  return product && releaseSignal;
}

function makeStory(source: FeedSource, titleValue: string, excerptValue: string, url: string, publishedAt: string): PlatformIntelligenceStory {
  const title = truncate(titleValue, 180);
  const excerpt = truncate(cleanText(excerptValue), 340);
  const id = `${source.id}:${url}`;
  return { id, sourceId: source.id, sourceName: source.name, title, excerpt, url, publishedAt };
}

function dedupeStories(stories: PlatformIntelligenceStory[]): PlatformIntelligenceStory[] {
  const byUrl = new Map<string, PlatformIntelligenceStory>();
  const byHeadlineDate = new Set<string>();
  const output: PlatformIntelligenceStory[] = [];
  for (const story of stories) {
    const headline = story.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const date = story.publishedAt.slice(0, 10);
    const headlineDate = `${date}:${headline}`;
    if (byUrl.has(story.url) || byHeadlineDate.has(headlineDate)) continue;
    byUrl.set(story.url, story);
    byHeadlineDate.add(headlineDate);
    output.push(story);
  }
  return output;
}

function isAllowedHost(urlValue: string, allowedHosts: readonly string[]): boolean {
  try {
    const url = new URL(urlValue);
    return url.protocol === "https:" && allowedHosts.some((allowedHost) => url.hostname === allowedHost || url.hostname.endsWith(`.${allowedHost}`));
  } catch {
    return false;
  }
}

function normalizeStoryUrl(value: string, allowedHosts: readonly string[]): string | null {
  try {
    const url = new URL(decodeXml(value.trim()), `https://${allowedHosts[0]}`);
    if (!isAllowedHost(url.toString(), allowedHosts)) return null;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function readTag(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"));
  return match?.[1] ?? "";
}

function readAtomLink(block: string): string {
  const match = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i);
  return match?.[1] ? decodeXml(match[1]) : "";
}

function cleanText(value: string): string {
  return decodeXml(decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownToText(value: string): string {
  return cleanText(value.replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^\s*[-*+]\s+/gm, ""));
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function parsePublishedDate(value: string, now: Date): string | null {
  const timestamp = Date.parse(cleanText(value));
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return new Date(timestamp).toISOString();
}

function isRecent(value: string, now: Date): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= now.getTime() - MAX_AGE_MS && timestamp <= now.getTime() + 24 * 60 * 60 * 1000;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function isSnapshot(value: unknown): value is PlatformIntelligenceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PlatformIntelligenceSnapshot>;
  return snapshot.version === 1
    && typeof snapshot.lastCheckedAt === "string"
    && Array.isArray(snapshot.stories)
    && Array.isArray(snapshot.sources);
}
