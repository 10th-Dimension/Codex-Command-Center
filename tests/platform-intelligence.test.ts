import assert from "node:assert/strict";
import test from "node:test";

import { refreshPlatformIntelligence, type PlatformIntelligenceStore } from "../src/lib/platform/intelligence";

class MemoryStore implements PlatformIntelligenceStore {
  readonly values = new Map<string, string>();

  async get(key: string) { return this.values.get(key) ?? null; }
  async put(key: string, value: string) { this.values.set(key, value); }
}

test("official story feeds attach only direct OpenAI X post links", async () => {
  const stories = [
    `<item><title>Introducing GPT-6.2</title><link>https://openai.com/index/gpt-62</link><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Read <a href="https://x.com/OpenAI/status/1234567890123456789">the launch post</a>.</p>]]></description></item>`,
    `<item><title>Codex gains a new capability</title><link>https://openai.com/index/codex-capability</link><pubDate>Tue, 20 Oct 2026 13:00:00 GMT</pubDate><description><![CDATA[<p>See <a href="https://twitter.com/OpenAIDevs/status/9876543210987654321">the developer post</a>.</p> Also <a href="https://x.com/OtherAccount/status/1111111111111111111">another post</a>.</description></item>`,
    `<item><title>Another new model launch</title><link>https://openai.com/index/model-launch</link><pubDate>Tue, 20 Oct 2026 14:00:00 GMT</pubDate><description><![CDATA[<p>Discussion: <a href="https://x.com/OtherAccount/status/2222222222222222222">not an OpenAI post</a>.</p></description></item>`,
  ].join("");
  const store = new MemoryStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://openai.com/news/rss.xml") return new Response(`<rss><channel>${stories}</channel></rss>`);
    if (url.endsWith("changelog/rss.xml")) return new Response("<rss><channel></channel></rss>");
    return new Response("# Changelog\n", { headers: { "content-type": "text/markdown" } });
  };

  try {
    const snapshot = await refreshPlatformIntelligence(store, new Date("2026-10-21T12:00:00.000Z"));
    const linked = snapshot.stories.filter((story) => story.xPostUrl);
    assert.deepEqual(linked.map((story) => [story.title, story.xPostUrl]), [
      ["Codex gains a new capability", "https://x.com/OpenAIDevs/status/9876543210987654321"],
      ["Introducing GPT-6.2", "https://x.com/OpenAI/status/1234567890123456789"],
    ]);
    assert.equal(snapshot.stories.find((story) => story.title === "Another new model launch")?.xPostUrl, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
