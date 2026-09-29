// The lyric-vs-picture contrast of a rendered stage frame (phase 7's legibility guarantee).
//
// measureContrast(page, frame, probe): two PNG screenshots (Buffers) of the same moment of the song
// — `frame` over the picture being checked, `probe` over a flat mid-grey program. The type is laid
// out the same in both (the layout does not depend on the picture), so the probe tells where the
// glyphs are: over flat grey the letters are the pixels that stand out furthest from the grey, in
// the ink's direction (the darkened pocket around light ink goes the other way); other pixels that
// move in the ink's direction are the type's own light (glow, glitch echo, RGB fringe, labels) and
// are not counted as picture. In `frame`, the ratio is the WCAG contrast of the median glyph pixel
// against the 90th-percentile picture pixel in a ring 3 px – 1.2 % of the short side around the
// glyphs (light ink; the 10th percentile for dark ink). Returns { ratio, ink, ring, glyphs, ringPx,
// decor, dark }. Runs in the page (a 2D canvas decodes the PNGs), so it needs no dependency.

/** A scene program that draws flat mid-grey (the probe's picture). */
const PROBE_PROGRAM = "vec3 scene(vec2 fc) {\n  return vec3(0.5);\n}\n";

async function measureContrast(page, frame, probe) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const W = ia.naturalWidth;
      const H = ia.naturalHeight;
      const px = (im) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, W, H).data;
      };
      const A = px(ia);
      const P = px(ib);
      const LUT = new Float32Array(256).map((_, i) => {
        const x = i / 255;
        return x < 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      const lum = (d, i) => 0.2126 * LUT[d[i]] + 0.7152 * LUT[d[i + 1]] + 0.0722 * LUT[d[i + 2]];
      const N = W * H;
      const La = new Float32Array(N);
      const Sp = new Float32Array(N);
      for (let p = 0; p < N; p++) {
        La[p] = lum(A, p * 4);
        Sp[p] = Math.sqrt(lum(P, p * 4));
      }
      // the probe's grey (its most common level)
      const hist = new Uint32Array(256);
      for (let p = 0; p < N; p++) hist[Math.min(255, Math.floor(Sp[p] * 256))]++;
      let mode = 0;
      for (let k = 1; k < 256; k++) if (hist[k] > hist[mode]) mode = k;
      const grey = (mode + 0.5) / 256;
      // the ink's direction: the side of the grey the most extreme pixels lie on
      const devs = [];
      for (let p = 0; p < N; p++) {
        const d = Sp[p] - grey;
        if (Math.abs(d) > 0.04) devs.push(d);
      }
      if (devs.length < 40) return { ratio: null, glyphs: 0 };
      devs.sort((u, v) => Math.abs(v) - Math.abs(u));
      const top = devs.slice(0, Math.max(40, Math.floor(devs.length * 0.02)));
      const lightInk = top.filter((d) => d > 0).length >= top.length / 2;
      const sgn = lightInk ? 1 : -1;
      const same = top.filter((d) => Math.sign(d) === sgn).map(Math.abs).sort((u, v) => u - v);
      const inkDev = same[Math.floor(same.length / 2)];
      const glyph = new Uint8Array(N);
      const decor = new Uint8Array(N);
      for (let p = 0; p < N; p++) {
        const d = (Sp[p] - grey) * sgn;
        if (d > inkDev * 0.72) glyph[p] = 1;
        else if (d > 0.03) decor[p] = 1;
      }
      const gl = [];
      for (let p = 0; p < N; p++) if (glyph[p]) gl.push(La[p]);
      if (gl.length < 40) return { ratio: null, glyphs: gl.length };
      // distance bands around the glyphs: 1–2 px is the antialiased edge, 3–R px is the ring
      const R = Math.max(5, Math.round(Math.min(W, H) * 0.012));
      const near = new Uint8Array(N);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!glyph[y * W + x]) continue;
          for (let dy = -R; dy <= R; dy++)
            for (let dx = -R; dx <= R; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const q = yy * W + xx;
              const d2 = dx * dx + dy * dy;
              if (d2 <= 4) near[q] = 2;
              else if (d2 <= R * R && near[q] === 0) near[q] = 1;
            }
        }
      const ringL = [];
      let decorN = 0;
      for (let p = 0; p < N; p++) {
        if (near[p] !== 1 || glyph[p]) continue;
        if (decor[p]) {
          decorN++;
          continue;
        }
        ringL.push(La[p]);
      }
      gl.sort((u, v) => u - v);
      ringL.sort((u, v) => u - v);
      const g = gl[Math.floor(gl.length / 2)];
      const ring = ringL.length ? ringL[Math.floor(ringL.length * (lightInk ? 0.9 : 0.1))] : 0;
      const ratio = (Math.max(g, ring) + 0.05) / (Math.min(g, ring) + 0.05);
      return { ratio, ink: g, ring, glyphs: gl.length, ringPx: ringL.length, decor: decorN, dark: !lightInk };
    },
    { a: `data:image/png;base64,${frame.toString("base64")}`, b: `data:image/png;base64,${probe.toString("base64")}` },
  );
}

module.exports = { measureContrast, PROBE_PROGRAM };
