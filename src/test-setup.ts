// Vitest setup: tests never reach the free public sources. A fetch to MusicBrainz, Wikipedia,
// Wikimedia or Wikidata fails at once (like an unreachable host); tests that exercise the lookups
// pass their own fetch (the free research and its lookups take one).

const realFetch = globalThis.fetch;
const BLOCKED = /(^|\.)(musicbrainz\.org|wikipedia\.org|wikimedia\.org|wikidata\.org|coverartarchive\.org|archive\.org|ytimg\.com|youtube\.com)$/i;

// phase 8: the research step's collection of the band's images is off unless a test turns it on
// (those tests pass a fake network: the collector never reaches the internet in tests)
process.env.LIVELYRICS_VISUALS ??= "off";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* not a URL: let the real fetch report it */
  }
  if (BLOCKED.test(host)) throw new TypeError(`fetch failed: tests do not reach ${host}`);
  return realFetch(input, init);
}) as typeof fetch;
