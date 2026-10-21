"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

type XWidgetsWindow = Window & {
  twttr?: { widgets?: { load: (element?: HTMLElement) => Promise<unknown> } };
};

const X_ACCOUNTS = [
  { handle: "OpenAI", profileUrl: "https://x.com/OpenAI", timelineUrl: "https://x.com/OpenAI?ref_src=twsrc%5Etfw" },
  { handle: "OpenAIDevs", profileUrl: "https://x.com/OpenAIDevs", timelineUrl: "https://x.com/OpenAIDevs?ref_src=twsrc%5Etfw" },
] as const;

const X_EMBED_RENDER_TIMEOUT_MS = 8_000;
let xWidgetsScript: Promise<void> | undefined;

export function PlatformXPosts() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded || !root.current) return;
    return loadXWidgets(root.current, () => setLoadError(true));
  }, [loaded, attempt]);

  return <section className="platform-section" aria-labelledby="platform-x-title">
    <div className="platform-section-heading">
      <div><span>OPTIONAL SOCIAL CONTEXT · X</span><h2 id="platform-x-title">Official OpenAI posts</h2></div>
    </div>
    <div className="platform-panel platform-x-panel">
      <p>Story cards show a post only when an official release feed links it directly. We do not guess matches. Load these timelines for other recent social context.</p>
      {!loaded && <button type="button" className="platform-refresh-button" onClick={() => { setLoadError(false); setLoaded(true); }}>Load official X posts</button>}
      {loadError && <div className="platform-x-load-error" role="status">
        <p>X’s embedded timeline did not load. You can open either official profile directly or try loading again.</p>
        <button type="button" className="platform-refresh-button" onClick={() => { setLoadError(false); setAttempt((value) => value + 1); }}>Try again</button>
      </div>}
      {loaded && <div className="platform-x-timelines" ref={root}>
        {X_ACCOUNTS.map(({ handle, profileUrl, timelineUrl }) => <div className="platform-x-timeline" key={handle}>
          <a className="twitter-timeline" data-theme="dark" data-dnt="true" data-tweet-limit="4" data-height="460" data-chrome="noheader nofooter noborders transparent" href={timelineUrl}>
            Posts by @{handle}
          </a>
          <a className="platform-x-direct-link" href={profileUrl} target="_blank" rel="noreferrer">Open @{handle} on X <ExternalLink size={11} /></a>
        </div>)}
      </div>}
    </div>
  </section>;
}

export function PlatformXPost({ url }: Readonly<{ url: string }>) {
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || !root.current) return;
    return loadXWidgets(root.current, () => setLoadError(true));
  }, [expanded, attempt]);

  return <details className="platform-details platform-x-post-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Related official post on X <span>linked by source</span></summary>
    {expanded && <div className="platform-x-post-content" ref={root}>
      <blockquote className="twitter-tweet" data-theme="dark"><a href={url} target="_blank" rel="noreferrer">View this post on X</a></blockquote>
      {loadError && <div className="platform-x-load-error" role="status">
        <p>X’s post embed did not load. Use the direct link below to open it or try again.</p>
        <button type="button" className="platform-refresh-button" onClick={() => { setLoadError(false); setAttempt((value) => value + 1); }}>Try again</button>
      </div>}
      <a className="platform-x-direct-link" href={url} target="_blank" rel="noreferrer">Open post on X <ExternalLink size={11} /></a>
    </div>}
  </details>;
}

function loadXWidgets(root: HTMLElement, onError: () => void) {
  const windowWithWidgets = window as XWidgetsWindow;
  let active = true;

  void ensureXWidgetsScript(windowWithWidgets)
    .then(async () => {
      if (active) {
        const load = windowWithWidgets.twttr?.widgets?.load(root);
        if (load) void load.catch(() => { if (active) onError(); });
        if (active && !await waitForXEmbed(root)) onError();
      }
    })
    .catch(() => {
      if (active) onError();
    });

  return () => { active = false; };
}

function ensureXWidgetsScript(windowWithWidgets: XWidgetsWindow): Promise<void> {
  if (windowWithWidgets.twttr?.widgets) return Promise.resolve();
  if (xWidgetsScript) return xWidgetsScript;

  const existingScript = document.querySelector<HTMLScriptElement>("script[data-platform-x-widget]");
  const script = existingScript ?? document.createElement("script");
  xWidgetsScript = new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      if (windowWithWidgets.twttr?.widgets) resolve();
      else {
        script.remove();
        reject(new Error("X embed script loaded without its widget API."));
      }
    };
    const onError = () => {
      script.remove();
      reject(new Error("X embed script could not be loaded."));
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });

    if (!existingScript) {
      script.src = "https://platform.x.com/widgets.js";
      script.async = true;
      script.charset = "utf-8";
      script.referrerPolicy = "no-referrer";
      script.dataset.platformXWidget = "true";
      document.body.appendChild(script);
    }
  }).catch((error: unknown) => {
    xWidgetsScript = undefined;
    throw error;
  });

  return xWidgetsScript;
}

async function waitForXEmbed(root: HTMLElement) {
  const deadline = Date.now() + X_EMBED_RENDER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const renderedFrame = root.querySelector<HTMLIFrameElement>("iframe.twitter-timeline-rendered, iframe.twitter-tweet-rendered");
    if (renderedFrame) {
      const bounds = renderedFrame.getBoundingClientRect();
      const style = window.getComputedStyle(renderedFrame);
      if (bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none") return true;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  return false;
}
