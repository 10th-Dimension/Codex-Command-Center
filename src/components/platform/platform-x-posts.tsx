"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

const X_ACCOUNTS = ["OpenAI", "OpenAIDevs"] as const;

function XEmbed({ title, src, height }: Readonly<{ title: string; src: string; height: number }>) {
  const [attempt, setAttempt] = useState(0);

  return <>
    {/* The embed document belongs to X, so its scripts keep the vendor origin. */}
    <iframe key={attempt} title={title} src={src} referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ display: "block", border: 0, width: "100%", height }} />
    <button type="button" className="platform-refresh-button" onClick={() => setAttempt((value) => value + 1)}>Reload embed</button>
  </>;
}

export function PlatformXPosts() {
  const [loaded, setLoaded] = useState(false);

  return <section className="platform-section" aria-labelledby="platform-x-title">
    <div className="platform-section-heading">
      <div><span>OPTIONAL SOCIAL CONTEXT · X</span><h2 id="platform-x-title">Official OpenAI posts</h2></div>
    </div>
    <div className="platform-panel platform-x-panel">
      <p>Story cards show a post only when an official release feed links it directly. We do not guess matches. Load these timelines for other recent social context.</p>
      {!loaded && <button type="button" className="platform-refresh-button" onClick={() => setLoaded(true)}>Load official X posts</button>}
      {loaded && <div className="platform-x-timelines">
        {X_ACCOUNTS.map((handle) => {
          const profileUrl = `https://x.com/${handle}`;
          const timeline = new URL(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`);
          timeline.search = new URLSearchParams({
            dnt: "true", theme: "dark", limit: "4", maxHeight: "460px",
            hideBorder: "true", hideFooter: "true", hideHeader: "true", transparent: "true",
          }).toString();
          return <div className="platform-x-timeline" key={handle}>
            <XEmbed title={`Posts by @${handle}`} height={460} src={timeline.href} />
            <a className="platform-x-direct-link" href={profileUrl} target="_blank" rel="noreferrer">Open @{handle} on X <ExternalLink size={11} /></a>
          </div>;
        })}
      </div>}
    </div>
  </section>;
}

function officialPost(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return null;
    const post = /^\/(OpenAI|OpenAIDevs)\/status\/(\d+)\/?$/i.exec(url.pathname);
    return post ? { id: post[2], url: `https://x.com/${post[1]}/status/${post[2]}` } : null;
  } catch {
    return null;
  }
}

export function PlatformXPost({ url }: Readonly<{ url: string }>) {
  const [expanded, setExpanded] = useState(false);
  const post = officialPost(url);
  if (!post) return null;
  const embed = new URL("https://platform.twitter.com/embed/Tweet.html");
  embed.search = new URLSearchParams({ id: post.id, theme: "dark", dnt: "true" }).toString();

  return <details className="platform-details platform-x-post-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Related official post on X <span>linked by source</span></summary>
    {expanded && <div className="platform-x-post-content">
      <XEmbed title="Related official X post" height={420} src={embed.href} />
      <a className="platform-x-direct-link" href={post.url} target="_blank" rel="noreferrer">Open post on X <ExternalLink size={11} /></a>
    </div>}
  </details>;
}
