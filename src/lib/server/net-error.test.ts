import { describe, expect, it } from "vitest";
import { isRawNetworkError, networkErrorText } from "./net-error";

const fetchFailed = (cause: string) => new TypeError("fetch failed", { cause: Object.assign(new Error(cause), { code: cause.split(" ")[1] }) });

describe("round 20 (m3) · network errors in plain Chinese", () => {
  it("never passes the raw socket error through", () => {
    for (const raw of ["connect ECONNREFUSED 127.0.0.1:3199", "getaddrinfo ENOTFOUND lrclib.net", "read ECONNRESET", "connect ETIMEDOUT 1.2.3.4:443"]) {
      const text = networkErrorText(fetchFailed(raw));
      expect(text).not.toMatch(/E[A-Z]{4,}|127\.0\.0\.1|lrclib\.net|\d+\.\d+\.\d+\.\d+/);
      expect(text).toMatch(/\p{Script=Han}/u);
      expect(isRawNetworkError(fetchFailed(raw))).toBe(true);
    }
    expect(networkErrorText(fetchFailed("connect ECONNREFUSED 127.0.0.1:9"))).toContain("拒絕連線");
    expect(networkErrorText(fetchFailed("getaddrinfo ENOTFOUND x"))).toContain("找不到伺服器");
    expect(networkErrorText(new Error("something else"))).toBe("網路無法連線");
    expect(isRawNetworkError(new Error("無法連線到 LRCLIB（連線被中斷）"))).toBe(false);
  });
});
