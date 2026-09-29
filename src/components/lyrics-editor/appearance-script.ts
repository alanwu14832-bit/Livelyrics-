// Server-safe half of the editor's 外觀 setting (see appearance.ts): the storage key and the
// pre-paint script src/app/layout.tsx inlines, so a stored 淺色 / 深色 choice is on <html> before the
// first paint of /p/[id]/lyrics (no flash of the system appearance before hydration).

export const APPEARANCE_KEY = "livelyrics:editor-appearance";

export const APPEARANCE_SCRIPT = `try{if(/^\\/p\\/[^/]+\\/lyrics\\/?$/.test(location.pathname)){var v=localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)});if(v==="light"||v==="dark")document.documentElement.setAttribute("data-theme",v)}}catch(e){}`;
