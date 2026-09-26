// "3 分鐘前" style timestamps for the project library (deterministic, no Intl dependency).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  // clock skew between server and browser: treat the near future as "now"
  if (diff < 45_000) return "剛剛";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} 分鐘前`;
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) return `${Math.max(1, Math.floor(diff / HOUR))} 小時前`;
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** Full local timestamp for tooltips. */
export function formatAbsoluteTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
