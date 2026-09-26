import { describe, expect, it } from "vitest";
import { EMBLEM_STYLES, generateMotifSvg, MAX_SVG_INPUT, sanitizeSvg } from "./svg";

const ok = (inner: string, attrs = ' viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`;

/** Nothing executable, external or stylable may survive. */
function assertInert(out: string | null) {
  if (out == null) return;
  expect(out).not.toMatch(/<script|<foreignObject|<style|<image|<use|<a[\s>]|<animate|<set|<text|<iframe/i);
  expect(out).not.toMatch(/\son[a-z]+\s*=/i);
  expect(out).not.toMatch(/href|javascript:|data:|url\(|style=|&|<!|<\?/i);
  // only allowlisted element names remain
  for (const m of out.matchAll(/<\/?([a-zA-Z][\w:.-]*)/g)) {
    expect(["svg", "g", "path", "circle", "rect", "polygon", "polyline", "line", "ellipse"]).toContain(m[1]);
  }
}

describe("sanitizeSvg", () => {
  it("keeps a clean emblem and normalizes the root", () => {
    const out = sanitizeSvg('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="2"/></svg>');
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    );
  });

  it("adds a default viewBox, drops width/height and converts concrete colors to currentColor", () => {
    const out = sanitizeSvg('<svg width="300" height="300"><rect x="10" y="10" width="80" height="80" fill="#FF0000" stroke="red"/></svg>');
    expect(out).toContain('viewBox="0 0 100 100"');
    expect(out).not.toContain('width="300"');
    expect(out).toContain('fill="currentColor"');
    expect(out).toContain('stroke="currentColor"');
  });

  it("strips event handlers, scripts and foreignObject", () => {
    const payloads = [
      ok('<circle cx="5" cy="5" r="4" onload="alert(1)" onclick="x()"/>'),
      ok('<script>alert(1)</script><circle cx="5" cy="5" r="4"/>'),
      ok('<foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject><circle cx="5" cy="5" r="4"/>'),
      ok('<g><script type="text/javascript">if (a<b) alert(1)</script></g><rect x="1" y="1" width="3" height="3"/>'),
      '<svg onload="alert(1)"><path d="M0 0L10 10"/></svg>',
      ok('<a href="javascript:alert(1)"><circle cx="5" cy="5" r="4"/></a><path d="M0 0L1 1"/>'),
      ok('<use href="#x" xlink:href="data:image/svg+xml;base64,PHN2Zz4="/><path d="M0 0L1 1"/>'),
      ok('<image href="https://evil.example/x.png"/><path d="M0 0L1 1"/>'),
      ok('<path d="M0 0L1 1" style="fill:url(javascript:alert(1))"/>'),
      ok('<path d="M0 0L1 1" fill="url(#grad)"/>'),
      ok('<path d="M0 0L1 1"><animate attributeName="href" values="javascript:alert(1)"/></path>'),
      ok('<circle cx="5" cy="5" r="4"><set attributeName="onmouseover" to="alert(1)"/></circle>'),
      ok('<text x="0" y="10">hello</text><path d="M0 0L1 1"/>'),
      ok('<style>@import url(https://evil.example/x.css);</style><path d="M0 0L1 1"/>'),
      ok('<path d="M0 0L1 1" transform="rotate(10) url(x)"/>'),
      ok('<circle cx="5" cy="5" r="4" fill="&#106;avascript"/>'),
      ok('<circle cx="5" cy="5" r="expression(alert(1))"/><path d="M0 0L1 1"/>'),
      ok("<circle cx='5' cy=\"5\" r=4 fill=currentColor/>"),
      ok('<svg onload="alert(1)"><circle cx="5" cy="5" r="4"/></svg>'),
      ok('<circle cx="5" cy="5" r="4" data-x="1" class="a" id="b" xml:base="https://evil.example/"/>'),
    ];
    for (const p of payloads) {
      const out = sanitizeSvg(p);
      assertInert(out);
    }
    expect(sanitizeSvg(payloads[0])).toContain("<circle");
    expect(sanitizeSvg(payloads[3])).toContain("<rect");
    expect(sanitizeSvg(payloads[17])).toContain('r="4"');
    // a nested <svg> becomes a group
    expect(sanitizeSvg(payloads[18])).toContain("<g><circle");
  });

  it("rejects DOCTYPE / ENTITY / CDATA documents", () => {
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "boom">]><svg><path d="M0 0L1 1"/></svg>')).toBeNull();
    expect(sanitizeSvg('<svg><![CDATA[<script>alert(1)</script>]]><path d="M0 0L1 1"/></svg>')).toBeNull();
  });

  it("tolerates comments and an XML declaration", () => {
    const out = sanitizeSvg('<?xml version="1.0"?><!-- hi --><svg><!-- <script>x</script> --><path d="M0 0L1 1"/></svg>');
    expect(out).toContain("<path");
    assertInert(out);
  });

  it("rejects non-SVG roots, empty drawings and oversized input", () => {
    expect(sanitizeSvg('<html><svg><path d="M0 0"/></svg></html>')).toBeNull();
    expect(sanitizeSvg("<svg></svg>")).toBeNull();
    expect(sanitizeSvg('<svg><g><text>only text</text></g></svg>')).toBeNull();
    expect(sanitizeSvg("not svg at all")).toBeNull();
    expect(sanitizeSvg(null)).toBeNull();
    expect(sanitizeSvg(ok(`<path d="M0 0L1 1"/>${" ".repeat(MAX_SVG_INPUT)}`))).toBeNull();
  });

  it("rejects malformed tags instead of guessing", () => {
    expect(sanitizeSvg('<svg><path d="M0 0L1 1></svg>')).toBeNull();
    expect(sanitizeSvg("<svg><circle cx=5 <script>")).toBeNull();
  });

  it("validates attribute grammars", () => {
    const out = sanitizeSvg(
      ok(
        '<path d="M10 10 L20 20 Z" fill-rule="evenodd" stroke-linecap="bogus" opacity="3" transform="translate(5,5) rotate(45 50 50)"/>' +
          '<polygon points="1,2 3,4 5,6" stroke-dasharray="2 4"/><circle cx="1e1" cy="50%" r="-"/>',
      ),
    );
    expect(out).toContain('fill-rule="evenodd"');
    expect(out).not.toContain("bogus");
    expect(out).toContain('opacity="1"');
    expect(out).toContain('transform="translate(5,5) rotate(45 50 50)"');
    expect(out).toContain('stroke-dasharray="2 4"');
    expect(out).toContain('cx="1e1"');
    expect(out).not.toContain('r="-"');
  });

  it("caps element count", () => {
    expect(sanitizeSvg(ok('<circle cx="1" cy="1" r="1"/>'.repeat(401)))).toBeNull();
  });
});

describe("generateMotifSvg", () => {
  it("is deterministic, compact and survives the sanitizer unchanged", () => {
    for (const style of EMBLEM_STYLES) {
      const a = generateMotifSvg("示範之歌|Livelyrics Band", style);
      expect(a).toBe(generateMotifSvg("示範之歌|Livelyrics Band", style));
      expect(a.length).toBeLessThan(2500);
      expect(sanitizeSvg(a)).toBe(a);
    }
    expect(generateMotifSvg("a")).not.toBe(generateMotifSvg("b"));
  });
});
