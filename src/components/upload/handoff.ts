// Hand the lyrics chosen on the home page to the process page (which sends them as
// ProcessRequest.lyricsText). sessionStorage survives the client navigation and a refresh
// of the process page, and never leaves this browser tab.

export function lyricsHandoffKey(projectId: string): string {
  return `livelyrics:lyrics:${projectId}`;
}

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): MinimalStorage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    // disabled storage (privacy settings) throws on access
    return null;
  }
}

/** Returns false when the text could not be stored (storage disabled / quota). */
export function storeLyricsHandoff(projectId: string, text: string, storage: MinimalStorage | null = session()): boolean {
  if (!storage || !text.trim()) return false;
  try {
    storage.setItem(lyricsHandoffKey(projectId), text);
    return true;
  } catch {
    return false;
  }
}

export function readLyricsHandoff(projectId: string, storage: MinimalStorage | null = session()): string | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(lyricsHandoffKey(projectId));
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}

export function clearLyricsHandoff(projectId: string, storage: MinimalStorage | null = session()): void {
  if (!storage) return;
  try {
    storage.removeItem(lyricsHandoffKey(projectId));
  } catch {
    /* ignore */
  }
}
