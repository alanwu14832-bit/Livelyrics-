import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  canonicalUrl,
  continuationContent,
  describeError,
  describeRefusal,
  extractSearchQueries,
  extractSources,
  fallbackSwitches,
  searchErrors,
  textAfterLastFallback,
  textOf,
} from "./messages";
import { cite, fallbackBlock as fallback, refusalDetails, search, searchResult, text, thinking } from "./testing/fake-claude";

describe("sources", () => {
  it("collects cited sources first, then search results, de-duplicated", () => {
    const content: BetaContentBlock[] = [
      search("s1", "樂團 演唱會 舞台"),
      searchResult("s1", [
        ["https://www.example.com/a/?utm_source=x", "A 頁"],
        ["https://band.example/live#top", "Live"],
        ["ftp://nope.example/file", "ftp"],
      ]),
      text("樂團的招牌色是綠色。", [cite("https://band.example/live", "現場報導"), cite("https://example.com/a", null)]),
      searchResult("s2", [["https://example.com/a", "A again"]]),
    ];
    expect(extractSources(content)).toEqual([
      { title: "現場報導", url: "https://band.example/live" },
      { title: "example.com", url: "https://example.com/a" },
    ]);
    expect(canonicalUrl("https://WWW.Example.com/a/?utm_medium=b&x=1#frag")).toBe("https://example.com/a?x=1");
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
  });

  it("extracts search queries and errors", () => {
    const content: BetaContentBlock[] = [
      search("s1", "  告五人 MV  "),
      search("s2", "告五人 MV"),
      search("s3", "告五人 舞台設計"),
      { type: "web_search_tool_result", tool_use_id: "s3", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    ];
    expect(extractSearchQueries(content)).toEqual(["告五人 MV", "告五人 舞台設計"]);
    expect(searchErrors(content)).toEqual(["max_uses_exceeded"]);
  });
});

describe("text + fallbacks", () => {
  it("joins text and finds fallback switches", () => {
    const content: BetaContentBlock[] = [text("前半"), fallback("claude-opus-5", "claude-opus-4-8"), text("後半")];
    expect(textOf(content)).toBe("前半後半");
    expect(textAfterLastFallback(content)).toBe("後半");
    expect(fallbackSwitches(content)).toEqual([{ from: "claude-opus-5", to: "claude-opus-4-8" }]);
  });
});

describe("continuationContent", () => {
  it("echoes a paused turn as request blocks and trims the final text", () => {
    const out = continuationContent([thinking("想一下"), text("先搜尋。 "), search("s1", "q"), searchResult("s1", [["https://a.example", "A"]]), search("s2", "q2")]);
    expect(out.map((b) => b.type)).toEqual(["thinking", "text", "server_tool_use", "web_search_tool_result", "server_tool_use"]);
    expect(continuationContent([text("結尾空白  \n")])).toEqual([{ type: "text", text: "結尾空白" }]);
    expect(continuationContent([text(""), text("   ")])).toEqual([]);
  });

  it("applies the fallback echo rules before the last fallback block", () => {
    const out = continuationContent([
      thinking("declined model thinking"),
      text("部分文字"),
      search("s1", "paired"),
      searchResult("s1", [["https://a.example", "A"]]),
      search("s2", "unpaired"),
      fallback("claude-opus-5", "claude-opus-4-8"),
      thinking("fallback model thinking"),
      search("s3", "after"),
    ]);
    expect(out.map((b) => (b.type === "server_tool_use" ? `stu:${b.id}` : b.type))).toEqual([
      "text",
      "stu:s1",
      "web_search_tool_result",
      "thinking",
      "stu:s3",
    ]);
  });

  it("keeps citations on echoed text", () => {
    const [b] = continuationContent([text("有來源", [cite("https://a.example", "A")])]);
    expect(b).toMatchObject({ type: "text", citations: [{ type: "web_search_result_location", url: "https://a.example" }] });
  });
});

describe("descriptions", () => {
  it("describes refusals and SDK errors in Traditional Chinese", () => {
    expect(describeRefusal(refusalDetails("cyber"))).toContain("資安");
    expect(describeRefusal(null)).toBe("Claude 婉拒了這個請求");
    const headers = new Headers();
    expect(describeError(new Anthropic.RateLimitError(429, { type: "error" }, "rate", headers))).toContain("429");
    expect(describeError(new Anthropic.AuthenticationError(401, { type: "error" }, "bad key sk-ant-secret", headers))).not.toContain("sk-ant");
    expect(describeError(new Anthropic.APIConnectionError({ message: "down" }))).toContain("無法連線");
    expect(describeError(new Error("x".repeat(500))).length).toBeLessThanOrEqual(200);
    expect(describeError("weird")).toBe("未知錯誤");
  });
});
