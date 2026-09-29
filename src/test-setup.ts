// Vitest setup: tests never reach the free public sources. A fetch to MusicBrainz, Wikipedia,
// Wikimedia or Wikidata fails at once (like an unreachable host); tests that exercise the lookups
// pass their own fetch (the free research and its lookups take one).

const realFetch = globalThis.fetch;
const BLOCKED = /(^|\.)(musicbrainz\.org|wikipedia\.org|wikimedia\.org|wikidata\.org)$/i;

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
