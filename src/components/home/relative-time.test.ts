import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";

const now = new Date(2026, 8, 26, 15, 0, 0).getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatRelativeTime", () => {
  it("covers the usual ranges", () => {
    expect(formatRelativeTime(ago(5_000), now)).toBe("剛剛");
    expect(formatRelativeTime(ago(-60_000), now)).toBe("剛剛");
    expect(formatRelativeTime(ago(3 * 60_000), now)).toBe("3 分鐘前");
    expect(formatRelativeTime(ago(2 * 3600_000), now)).toBe("2 小時前");
    expect(formatRelativeTime(new Date(2026, 8, 25, 23, 0).toISOString(), now)).toBe("昨天");
    expect(formatRelativeTime(new Date(2026, 8, 22, 12, 0).toISOString(), now)).toBe("4 天前");
    expect(formatRelativeTime(new Date(2026, 5, 2, 12, 0).toISOString(), now)).toBe("6 月 2 日");
    expect(formatRelativeTime(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe("2025/12/31");
  });

  it("handles invalid timestamps", () => {
    expect(formatRelativeTime("not a date", now)).toBe("");
    expect(formatAbsoluteTime("nope")).toBe("");
  });

  it("formats an absolute tooltip", () => {
    expect(formatAbsoluteTime(new Date(2026, 0, 5, 9, 7).toISOString())).toBe("2026/01/05 09:07");
  });
});
