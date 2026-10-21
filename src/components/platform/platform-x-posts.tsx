"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

type XWidgetsWindow = Window & {
  twttr?: { widgets?: { load: (element?: HTMLElement) => Promise<unknown> } };
};

const X_ACCOUNTS = [
  { handle: "OpenAI", url: "https://x.com/OpenAI" },
  { handle: "OpenAIDevs", url: "https://x.com/OpenAIDevs" },
] as const;

export function PlatformXPosts() {
  const [loaded, setLoaded] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded || !root.current) return;
    return loadXWidgets(root.current);
  }, [loaded]);

  return <section className="platform-section" aria-labelledby="platform-x-title">
    <div className="platform-section-heading">
      <div><span>OPTIONAL SOCIAL CONTEXT · X</span><h2 id="platform-x-title">Official OpenAI posts</h2></div>
    </div>
    <div className="platform-panel platform-x-panel">
      <p>Story cards show a post only when an official release feed links it directly. We do not guess matches. Load these timelines for other recent social context.</p>
      {!loaded && <button type="button" className="platform-refresh-button" onClick={() => setLoaded(true)}>Load official X posts</button>}
      {loaded && <div className="platform-x-timelines" ref={root}>
        {X_ACCOUNTS.map(({ handle, url }) => <div className="platform-x-timeline" key={handle}>
          <a className="twitter-timeline" data-theme="dark" data-dnt="true" data-tweet-limit="4" data-height="460" data-chrome="noheader nofooter noborders transparent" href={url}>
            Posts by @{handle}
          </a>
          <a className="platform-x-direct-link" href={url} target="_blank" rel="noreferrer">Open @{handle} on X <ExternalLink size={11} /></a>
        </div>)}
      </div>}
    </div>
  </section>;
}

export function PlatformXPost({ url }: Readonly<{ url: string }>) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || !root.current) return;
    return loadXWidgets(root.current);
  }, [expanded]);

  return <details className="platform-details platform-x-post-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Related official post on X <span>linked by source</span></summary>
    {expanded && <div className="platform-x-post-content" ref={root}>
      <blockquote className="twitter-tweet" data-theme="dark"><a href={url} target="_blank" rel="noreferrer">View this post on X</a></blockquote>
      <a className="platform-x-direct-link" href={url} target="_blank" rel="noreferrer">Open post on X <ExternalLink size={11} /></a>
    </div>}
  </details>;
}

function loadXWidgets(root: HTMLElement) {
  const windowWithWidgets = window as XWidgetsWindow;
  const existingScript = document.querySelector<HTMLScriptElement>("script[data-platform-x-widget]");
  const loadWidgets = () => { void windowWithWidgets.twttr?.widgets?.load(root); };

  if (windowWithWidgets.twttr?.widgets) {
    loadWidgets();
    return;
  }

  const script = existingScript ?? document.createElement("script");
  if (!existingScript) {
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.dataset.platformXWidget = "true";
    document.body.appendChild(script);
  }
  script.addEventListener("load", loadWidgets, { once: true });
  return () => script.removeEventListener("load", loadWidgets);
}
