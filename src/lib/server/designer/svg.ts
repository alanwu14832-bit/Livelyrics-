// Motif SVG: a strict allowlist sanitizer for model-written SVG, and a deterministic
// generated emblem used when the model's SVG is missing or unusable.
//
// The sanitizer never passes input through: it tokenizes the markup, keeps only
// allowlisted elements and attributes whose values match strict per-attribute
// grammars (no quotes, "<", "&", ":" or "url(" can survive), and re-serializes the
// result. Anything unknown is dropped together with its subtree; DOCTYPE / ENTITY /
// CDATA make the whole document invalid.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Inputs larger than this are rejected outright. */
export const MAX_SVG_INPUT = 20_000;
/** Sanitized output larger than this is rejected. */
export const MAX_SVG_OUTPUT = 12_000;
const MAX_ELEMENTS = 400;
const MAX_DEPTH = 16;

const ALLOWED_ELEMENTS = new Set(["svg", "g", "path", "circle", "rect", "polygon", "polyline", "line", "ellipse"]);
const DRAWABLE = new Set(["path", "circle", "rect", "polygon", "polyline", "line", "ellipse"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript"]);

const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const NUMBER_RE = new RegExp(`^${NUM}$`);
const LENGTH_RE = new RegExp(`^${NUM}(?:px|%)?$`);
const NUMBER_LIST_RE = new RegExp(`^${NUM}(?:(?:\\s*,\\s*|\\s+)${NUM})*$`);
const VIEWBOX_RE = new RegExp(`^${NUM}(?:\\s*,\\s*|\\s+)${NUM}(?:\\s*,\\s*|\\s+)${NUM}(?:\\s*,\\s*|\\s+)${NUM}$`);
const PATH_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]+$/;
const POINTS_RE = /^[0-9eE.,+\-\s]+$/;
const TRANSFORM_RE = new RegExp(
  `^\\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\\s*\\(\\s*${NUM}(?:(?:\\s*,\\s*|\\s+)${NUM}){0,5}\\s*\\)\\s*,?\\s*)+$`,
);
const PAINT_KEYWORDS = new Set(["none", "currentcolor", "transparent"]);
const HEX_PAINT_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED_PAINT = new Set(["white", "black", "red", "green", "blue", "yellow", "orange", "purple", "gray", "grey", "silver", "gold"]);

type Validator = (value: string) => string | null;

const enumOf =
  (...values: string[]): Validator =>
  (v) =>
    values.includes(v) ? v : null;

const match =
  (re: RegExp, maxLen = 64): Validator =>
  (v) =>
    v.length <= maxLen && re.test(v) ? v.replace(/\s+/g, " ").trim() : null;

/**
 * fill / stroke: keywords pass through; any concrete color becomes currentColor so the
 * renderer can tint the motif with the section colorway (the schema asks for currentColor).
 */
const paint: Validator = (v) => {
  const lower = v.toLowerCase();
  if (PAINT_KEYWORDS.has(lower)) return lower === "currentcolor" ? "currentColor" : lower;
  if (HEX_PAINT_RE.test(v) || NAMED_PAINT.has(lower) || /^rgba?\(\s*[\d.%\s,]+\)$/i.test(v)) return "currentColor";
  return null;
};

const opacity: Validator = (v) => {
  if (!NUMBER_RE.test(v)) return null;
  const n = Math.max(0, Math.min(1, Number(v)));
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : null;
};

const PRESENTATION: Record<string, Validator> = {
  fill: paint,
  stroke: paint,
  "fill-opacity": opacity,
  "stroke-opacity": opacity,
  opacity,
  "fill-rule": enumOf("nonzero", "evenodd"),
  "clip-rule": enumOf("nonzero", "evenodd"),
  "stroke-width": match(LENGTH_RE),
  "stroke-linecap": enumOf("butt", "round", "square"),
  "stroke-linejoin": enumOf("miter", "round", "bevel", "arcs", "miter-clip"),
  "stroke-miterlimit": match(NUMBER_RE),
  "stroke-dasharray": (v) => (v === "none" ? v : match(NUMBER_LIST_RE, 200)(v)),
  "stroke-dashoffset": match(LENGTH_RE),
  "vector-effect": enumOf("none", "non-scaling-stroke"),
  "shape-rendering": enumOf("auto", "optimizeSpeed", "crispEdges", "geometricPrecision"),
  transform: match(TRANSFORM_RE, 300),
};

const len = match(LENGTH_RE);

const ELEMENT_ATTRS: Record<string, Record<string, Validator>> = {
  svg: {
    viewBox: match(VIEWBOX_RE, 120),
    preserveAspectRatio: match(/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/),
  },
  g: {},
  path: { d: match(PATH_RE, 8000), pathLength: match(NUMBER_RE) },
  circle: { cx: len, cy: len, r: len },
  ellipse: { cx: len, cy: len, rx: len, ry: len },
  rect: { x: len, y: len, width: len, height: len, rx: len, ry: len },
  line: { x1: len, y1: len, x2: len, y2: len },
  polygon: { points: match(POINTS_RE, 4000) },
  polyline: { points: match(POINTS_RE, 4000) },
};

interface Node {
  name: string;
  attrs: Array<[string, string]>;
  children: Node[];
}

interface RawTag {
  kind: "open" | "close";
  name: string;
  attrs: Array<[string, string]>;
  selfClosing: boolean;
}

const NAME_RE = /[A-Za-z_][\w:.-]*/y;
const ATTR_NAME_RE = /[^\s"'<>/=]+/y;

/** Read one tag starting at s[i] === "<". Returns the tag and the index after it, or null when malformed. */
function readTag(s: string, i: number): { tag: RawTag; next: number } | null {
  let p = i + 1;
  let kind: RawTag["kind"] = "open";
  if (s[p] === "/") {
    kind = "close";
    p++;
  }
  NAME_RE.lastIndex = p;
  const nm = NAME_RE.exec(s);
  if (!nm) return null;
  const name = nm[0];
  p = NAME_RE.lastIndex;
  const attrs: Array<[string, string]> = [];
  let selfClosing = false;
  for (;;) {
    while (p < s.length && /\s/.test(s[p])) p++;
    if (p >= s.length) return null;
    if (s[p] === ">") {
      p++;
      break;
    }
    if (s[p] === "/" && s[p + 1] === ">") {
      selfClosing = true;
      p += 2;
      break;
    }
    if (s[p] === "<") return null;
    ATTR_NAME_RE.lastIndex = p;
    const an = ATTR_NAME_RE.exec(s);
    if (!an) return null;
    p = ATTR_NAME_RE.lastIndex;
    while (p < s.length && /\s/.test(s[p])) p++;
    let value = "";
    if (s[p] === "=") {
      p++;
      while (p < s.length && /\s/.test(s[p])) p++;
      const q = s[p];
      if (q === '"' || q === "'") {
        const end = s.indexOf(q, p + 1);
        if (end < 0) return null;
        value = s.slice(p + 1, end);
        p = end + 1;
      } else {
        const start = p;
        while (p < s.length && !/[\s>]/.test(s[p]) && !(s[p] === "/" && s[p + 1] === ">")) p++;
        value = s.slice(start, p);
      }
    }
    attrs.push([an[0], value]);
  }
  return { tag: { kind, name, attrs, selfClosing }, next: p };
}

function cleanAttrs(element: string, raw: Array<[string, string]>): Array<[string, string]> {
  const specific = ELEMENT_ATTRS[element] ?? {};
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [name, rawValue] of raw) {
    if (seen.has(name)) continue;
    // values may never contain markup / entity / scheme characters
    if (/[<>"'&`\\:]/.test(rawValue) || /url\s*\(/i.test(rawValue)) continue;
    const value = rawValue.trim();
    if (!value) continue;
    const validator = specific[name] ?? PRESENTATION[name];
    if (!validator) continue;
    const ok = validator(value);
    if (ok == null) continue;
    seen.add(name);
    out.push([name, ok]);
  }
  return out;
}

function hasDrawable(node: Node): boolean {
  return DRAWABLE.has(node.name) || node.children.some(hasDrawable);
}

function serialize(node: Node, root: boolean): string {
  const attrs = [...node.attrs];
  if (root) {
    if (!attrs.some(([n]) => n === "viewBox")) attrs.unshift(["viewBox", "0 0 100 100"]);
    attrs.unshift(["xmlns", SVG_NS]);
  }
  const attrText = attrs.map(([n, v]) => ` ${n}="${v}"`).join("");
  if (node.children.length === 0) return root ? `<svg${attrText}></svg>` : `<${node.name}${attrText}/>`;
  return `<${node.name}${attrText}>${node.children.map((c) => serialize(c, false)).join("")}</${node.name}>`;
}

/**
 * Sanitize a model-written motif SVG. Returns a safe, self-contained SVG string, or
 * null when the input is unusable (not an SVG, forbidden constructs, nothing drawable,
 * too large).
 */
export function sanitizeSvg(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > MAX_SVG_INPUT) return null;

  let root: Node | null = null;
  // open elements; `node: null` marks a dropped subtree (not allowlisted, or not a container)
  const stack: Array<{ name: string; node: Node | null }> = [];
  let count = 0;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break; // trailing text is ignored
    // text nodes are ignored entirely (the motif must not contain text)
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (s[lt + 1] === "!") return null; // DOCTYPE, ENTITY, CDATA
    if (s[lt + 1] === "?") {
      const end = s.indexOf("?>", lt + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    const read = readTag(s, lt);
    if (!read) return null;
    i = read.next;
    const { tag } = read;

    // raw-text elements: skip their content verbatim (it may contain "<")
    if (tag.kind === "open" && !tag.selfClosing && RAW_TEXT.has(tag.name.toLowerCase())) {
      const close = s.toLowerCase().indexOf(`</${tag.name.toLowerCase()}`, i);
      if (close < 0) return null;
      const gt = s.indexOf(">", close);
      if (gt < 0) return null;
      i = gt + 1;
      continue;
    }

    if (tag.kind === "close") {
      // close up to the matching open element; stray close tags are ignored
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === tag.name) {
          stack.length = k;
          break;
        }
      }
      if (root && stack.length === 0) break;
      continue;
    }

    if (!root) {
      if (tag.name !== "svg") return null;
      root = { name: "svg", attrs: cleanAttrs("svg", tag.attrs), children: [] };
      if (tag.selfClosing) break;
      stack.push({ name: "svg", node: root });
      continue;
    }
    if (stack.length === 0) break; // content after the root element closed
    if (stack.length >= MAX_DEPTH) return null;

    // only <svg>/<g> may have children; everything inside a dropped element is dropped
    const parent = stack[stack.length - 1].node;
    const container = parent && (parent.name === "svg" || parent.name === "g") ? parent : null;
    const keep = container !== null && ALLOWED_ELEMENTS.has(tag.name) && !stack.some((e) => e.node === null);
    if (!keep) {
      if (!tag.selfClosing) stack.push({ name: tag.name, node: null });
      continue;
    }
    if (++count > MAX_ELEMENTS) return null;
    // a nested <svg> is flattened into a group
    const name = tag.name === "svg" ? "g" : tag.name;
    const node: Node = { name, attrs: cleanAttrs(name, tag.attrs), children: [] };
    container.children.push(node);
    if (!tag.selfClosing) stack.push({ name: tag.name, node });
  }

  if (!root || !hasDrawable(root)) return null;
  const out = serialize(root, true);
  return out.length <= MAX_SVG_OUTPUT ? out : null;
}

// ---------------------------------------------------------------------------
// Generated emblems
// ---------------------------------------------------------------------------

/** Small stable 32-bit FNV-1a hash. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type EmblemStyle = "sun" | "crystal" | "orbit" | "wave" | "bloom" | "shard";
export const EMBLEM_STYLES: readonly EmblemStyle[] = ["sun", "crystal", "orbit", "wave", "bloom", "shard"];

const f = (n: number) => String(Math.round(n * 10) / 10);

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

function starPoints(n: number, outer: number, inner: number, rotate = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const [x, y] = polar(50, 50, i % 2 === 0 ? outer : inner, rotate + (i * 180) / n);
    pts.push(`${f(x)},${f(y)}`);
  }
  return pts.join(" ");
}

function polygonPoints(n: number, r: number, rotate = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = polar(50, 50, r, rotate + (i * 360) / n);
    pts.push(`${f(x)},${f(y)}`);
  }
  return pts.join(" ");
}

/**
 * A simple geometric emblem (viewBox 0 0 100 100, currentColor only), deterministic
 * from `seed`. `style` picks the archetype; default is derived from the seed.
 */
export function generateMotifSvg(seed: string, style?: EmblemStyle): string {
  const h = hashString(seed || "livelyrics");
  const rnd = seededRandom(h);
  const kind = style ?? EMBLEM_STYLES[h % EMBLEM_STYLES.length];
  const parts: string[] = [];
  const ring = (r: number, w: number, dash?: string) =>
    parts.push(
      `<circle cx="50" cy="50" r="${f(r)}" fill="none" stroke="currentColor" stroke-width="${f(w)}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
    );

  switch (kind) {
    case "sun": {
      const rays = 8 + Math.floor(rnd() * 3) * 4;
      ring(44, 2);
      parts.push(`<circle cx="50" cy="50" r="${f(14 + rnd() * 6)}" fill="currentColor"/>`);
      for (let i = 0; i < rays; i++) {
        const deg = (i * 360) / rays;
        const long = i % 2 === 0;
        const [x1, y1] = polar(50, 50, 24, deg);
        const [x2, y2] = polar(50, 50, long ? 38 : 32, deg);
        parts.push(
          `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="currentColor" stroke-width="${long ? 2.6 : 1.6}" stroke-linecap="round"/>`,
        );
      }
      break;
    }
    case "crystal": {
      const n = 5 + Math.floor(rnd() * 3);
      ring(45, 1.5, "1 3");
      parts.push(`<polygon points="${polygonPoints(n, 38)}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>`);
      parts.push(`<polygon points="${polygonPoints(n, 25, 180 / n)}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`);
      parts.push(`<polygon points="${starPoints(n, 14, 6)}" fill="currentColor"/>`);
      break;
    }
    case "orbit": {
      const tilt = Math.floor(rnd() * 60);
      parts.push(`<circle cx="50" cy="50" r="12" fill="currentColor"/>`);
      for (let i = 0; i < 3; i++) {
        parts.push(
          `<ellipse cx="50" cy="50" rx="40" ry="${f(12 + i * 4)}" fill="none" stroke="currentColor" stroke-width="1.6" transform="rotate(${tilt + i * 60} 50 50)"/>`,
        );
      }
      for (let i = 0; i < 4; i++) {
        const [x, y] = polar(50, 50, 30 + rnd() * 12, rnd() * 360);
        parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.4 + rnd() * 1.6)}" fill="currentColor"/>`);
      }
      break;
    }
    case "wave": {
      ring(44, 2.2);
      const lines = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < lines; i++) {
        const y = 36 + i * (28 / Math.max(1, lines - 1));
        const amp = 5 + rnd() * 4;
        parts.push(
          `<path d="M16 ${f(y)} C28 ${f(y - amp)} 38 ${f(y - amp)} 50 ${f(y)} S72 ${f(y + amp)} 84 ${f(y)}" fill="none" stroke="currentColor" stroke-width="${f(2.8 - i * 0.4)}" stroke-linecap="round"/>`,
        );
      }
      parts.push(`<circle cx="50" cy="20" r="3" fill="currentColor"/>`);
      break;
    }
    case "bloom": {
      const petals = 6 + Math.floor(rnd() * 3);
      for (let i = 0; i < petals; i++) {
        parts.push(
          `<ellipse cx="50" cy="29" rx="7.5" ry="17" fill="currentColor" fill-opacity="0.55" transform="rotate(${f((i * 360) / petals)} 50 50)"/>`,
        );
      }
      parts.push(`<circle cx="50" cy="50" r="9" fill="currentColor"/>`);
      ring(45, 1.2, "2 3");
      break;
    }
    case "shard": {
      ring(45, 1.8);
      const n = 5 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const a = (i * 360) / n + rnd() * 12;
        const [x1, y1] = polar(50, 50, 8, a - 14);
        const [x2, y2] = polar(50, 50, 36 + rnd() * 6, a);
        const [x3, y3] = polar(50, 50, 8, a + 14);
        parts.push(
          `<polygon points="${f(x1)},${f(y1)} ${f(x2)},${f(y2)} ${f(x3)},${f(y3)}" fill="currentColor" fill-opacity="${f(0.6 + rnd() * 0.4)}"/>`,
        );
      }
      parts.push(`<circle cx="50" cy="50" r="5" fill="currentColor"/>`);
      break;
    }
  }
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">${parts.join("")}</svg>`;
}
