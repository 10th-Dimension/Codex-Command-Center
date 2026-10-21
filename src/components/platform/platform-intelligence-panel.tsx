"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PlatformIntelligenceSnapshot } from "@/lib/platform/intelligence";
import { PlatformXPost } from "@/components/platform/platform-x-posts";

type ApiResult = { available: true; snapshot: PlatformIntelligenceSnapshot } | { available: false; reason: string };

export function PlatformIntelligencePanel() {
  const [snapshot, setSnapshot] = useState<PlatformIntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/platform/intelligence", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json() as ApiResult;
        if (!response.ok || !result.available) throw new Error("Platform intelligence storage is not connected in this runtime.");
        if (active) setSnapshot(result.snapshot);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load the latest platform intelligence.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/platform/intelligence", { method: "POST", cache: "no-store", credentials: "same-origin" });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.available) throw new Error("Platform intelligence storage is not connected in this runtime.");
      setSnapshot(result.snapshot);
      const failedSources = result.snapshot.sources.filter((source) => source.status === "error").length;
      setMessage(failedSources ? `Refresh finished with ${failedSources} source unavailable; saved stories were kept.` : "Official sources checked just now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh the official sources.");
    } finally {
      setRefreshing(false);
    }
  }

  const failures = snapshot?.sources.filter((source) => source.status === "error").length ?? 0;

  return <section className="platform-section" aria-labelledby="platform-intelligence-title">
    <div className="platform-section-heading platform-intelligence-heading">
      <div><span>OFFICIAL FEEDS · AUTOMATIC CHECK EVERY 6 HOURS</span><h2 id="platform-intelligence-title">Latest AI product intelligence</h2></div>
      <button type="button" className="platform-refresh-button" onClick={() => void refresh()} disabled={refreshing}>
        <RefreshCw size={13} className={refreshing ? "platform-refresh-spinning" : undefined} />
        {refreshing ? "Checking…" : "Refresh now"}
      </button>
    </div>

    <div className="platform-panel platform-intelligence-panel">
      <div className="platform-intelligence-meta">
        <p>Major OpenAI, API, model, and Codex updates from official sources. Repeat checks update the same headlines; they do not create telemetry rows. A public announcement does not prove staged access on your account.</p>
        {snapshot && <small>Last checked <time dateTime={snapshot.lastCheckedAt}>{new Date(snapshot.lastCheckedAt).toLocaleString()}</time> · {snapshot.stories.length} saved · {Math.min(snapshot.stories.length, 12)} shown</small>}
      </div>

      {message && <p className="platform-intelligence-message" role="status">{message}</p>}
      {failures > 0 && <p className="platform-intelligence-warning" role="status">{failures} official source{failures === 1 ? " is" : "s are"} unavailable. The last saved headlines remain visible.</p>}

      {loading && <p className="platform-unavailable">Loading saved headlines…</p>}
      {!loading && message?.includes("not connected") && <p className="platform-unavailable">This runtime has no platform feed storage binding.</p>}
      {!loading && snapshot?.stories.length ? <div className="platform-intelligence-grid">
        {snapshot.stories.slice(0, 12).map((story) => <article className="platform-intelligence-story" key={story.id}>
          <div className="platform-intelligence-story-meta"><span>{story.sourceName}</span><time dateTime={story.publishedAt}>{new Date(story.publishedAt).toLocaleDateString()}</time></div>
          <h3>{safeStoryLink(story.url) ? <a href={safeStoryLink(story.url) ?? undefined} target="_blank" rel="noreferrer">{story.title}</a> : story.title}</h3>
          {story.excerpt && <p>{story.excerpt}</p>}
          {safeXPostLink(story.xPostUrl) && <PlatformXPost url={safeXPostLink(story.xPostUrl) ?? ""} />}
        </article>)}
      </div> : null}
      {!loading && snapshot && snapshot.stories.length === 0 && <p className="platform-unavailable">No matching product headlines have been returned by these sources yet. Use Refresh now to check them.</p>}

      <div className="platform-intelligence-sources" aria-label="Source check status">
        {snapshot?.sources.map((source) => <span key={source.id} className={source.status === "ok" ? "is-ok" : "is-error"} title={source.url}>
          <i aria-hidden="true" />{source.name}
        </span>)}
      </div>
    </div>
  </section>;
}

function safeStoryLink(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol === "https:" && (
      host === "openai.com" || host.endsWith(".openai.com") || host === "chatgpt.com" || host.endsWith(".chatgpt.com")
    )) return url.toString();
  } catch {
    // Invalid or unexpected source URLs are not rendered as links.
  }
  return null;
}

function safeXPostLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol === "https:" && ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)
      && /^\/(OpenAI|OpenAIDevs)\/status\/\d+\/?$/i.test(url.pathname)) return url.toString();
  } catch {
    // Unexpected URLs are not rendered as embedded posts.
  }
  return null;
}
