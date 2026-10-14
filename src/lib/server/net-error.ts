// Round 20 (m3): a network failure in plain Chinese. Node's fetch says 「fetch failed」 with a cause
// such as 「connect ECONNREFUSED 127.0.0.1:443」 — that string must never reach the operator (the
// process log, the research notes, a banner). The code is kept only as a short tag the support side
// can read, never the address.

const CODES: Array<[RegExp, string]> = [
  [/ECONNREFUSED/, "對方的伺服器拒絕連線（可能暫時關閉）"],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, "找不到伺服器（網路或 DNS 有問題）"],
  [/ECONNRESET|socket hang up|other side closed|UND_ERR_SOCKET/i, "連線被中斷"],
  [/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timed? ?out/i, "連線逾時"],
  [/ENETUNREACH|EHOSTUNREACH|ENETDOWN/, "網路無法連到對方"],
  [/CERT|SSL|TLS|self[- ]signed/i, "安全連線（憑證）有問題"],
  [/EPROTO|UND_ERR/i, "連線出了問題"],
];

/** The whole message chain of an error (its cause included), for matching. */
function chain(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 4 && e != null; i++) {
    if (e instanceof Error) {
      parts.push(`${e.name} ${e.message} ${(e as { code?: unknown }).code ?? ""}`);
      e = e.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(" | ");
}

/** A raw network failure (Node's 「fetch failed」, a socket error code) rather than a message we wrote. */
export function isRawNetworkError(err: unknown): boolean {
  return /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|socket hang up|UND_ERR/i.test(chain(err));
}

/** 「對方的伺服器拒絕連線（可能暫時關閉）」 for ECONNREFUSED, etc.; 「網路無法連線」 when nothing more is known. */
export function networkErrorText(err: unknown): string {
  const text = chain(err);
  for (const [re, zh] of CODES) if (re.test(text)) return zh;
  return "網路無法連線";
}
