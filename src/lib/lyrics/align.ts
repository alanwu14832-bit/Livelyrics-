// Phrase-aligned timing for untimed lyric lines (round 14). The idea comes from two MIT-licensed
// lyric-video tools: tuidra-musicvideo-maker's lyrics_matcher.py fixes the high-confidence matches
// first and interpolates the rest between them in order (here the human taps are the fixed
// anchors), and chrimage/ai-lyric-video-generator treats instrumental intros / breaks / outros as
// their own segments (here a line ends with its sung part when a real gap follows). No speech
// recognition: the 人聲 curve (AudioAnalysis.vocal) says where the voice is; the lines of a run are
// laid over the phrases inside their window in order by dynamic programming — lines start at
// phrase onsets (or split a long phrase at a dip), each line's sung time follows its length
// (`lineWeight`) at a rate estimated from the window, and a line that would span a long vocal gap
// pays for it. Pure; shared by the server pipeline and the lyric editor.

export interface Phrase {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
}

export interface AlignParams {
  /** hysteresis of the phrase detector on the 0..1 curve */
  on: number;
  off: number;
  /** seconds: shorter phrases are dropped, shorter gaps merged */
  minPhrase: number;
  mergeGap: number;
  /** the duration model: σ = sigmaAbs + sigmaRel · expected */
  sigmaAbs: number;
  sigmaRel: number;
  /** a line starting inside a phrase (not at an onset) */
  splitCost: number;
  /** a line spanning a vocal gap longer than gapFree pays gapCost per second over */
  gapFree: number;
  gapCost: number;
  /**
   * per sung second left unassigned (before the first line, between two lines, after the last):
   * skipCost for the first skipFree seconds of a stretch, skipSteep after that; a stretch of more
   * than maxSkip sung seconds is never skipped between two lines
   */
  skipCost: number;
  skipFree: number;
  skipSteep: number;
  maxSkip: number;
  /** seconds */
  minLine: number;
  /** a line sings at most maxLineFactor × its expected time (+ 3 s) */
  maxLineFactor: number;
  /** a dip inside a phrase must fall this far below both sides (0..1) to be a cheap split */
  dipDepth: number;
  /** singing rates tried, as multiples of the window's sung time per weight unit (the best fit wins) */
  rates: number[];
  /** …and with a song-level rate: multiples of it (the window's own rate is tried too) */
  songRates: number[];
  /** a gap longer than tailFree seconds between two lines of a run costs tailCost per second over */
  tailFree: number;
  tailCost: number;
  /** a line starting more than priorFree seconds from its prior (RunLine.prior) costs priorCost per second over */
  priorFree: number;
  priorCost: number;
}

export const DEFAULT_ALIGN: AlignParams = {
  on: 0.5,
  off: 0.32,
  minPhrase: 0.3,
  mergeGap: 0.25,
  sigmaAbs: 0.6,
  sigmaRel: 0.35,
  splitCost: 1.5,
  gapFree: 1.2,
  gapCost: 1.5,
  skipCost: 0.6,
  skipFree: 8,
  skipSteep: 2,
  maxSkip: 25,
  minLine: 0.6,
  maxLineFactor: 2.5,
  dipDepth: 0.1,
  rates: [0.6, 0.8, 1],
  songRates: [1],
  tailFree: 2,
  tailCost: 1,
  priorFree: 10,
  priorCost: 0.5,
};

/** Phrases of a 0..1 curve at `rate` frames per second (hysteresis, minimum lengths, small gaps merged). */
export function detectPhrases(curve: ArrayLike<number>, rate: number, params: Pick<AlignParams, "on" | "off" | "minPhrase" | "mergeGap"> = DEFAULT_ALIGN, from = 0, to = Infinity): Phrase[] {
  const i0 = Math.max(0, Math.floor(from * rate));
  const i1 = Math.min(curve.length, Math.ceil(Math.min(to, curve.length / rate) * rate));
  const raw: Phrase[] = [];
  let open = -1;
  for (let i = i0; i < i1; i++) {
    const v = curve[i];
    if (open < 0 && v >= params.on) {
      // the onset is where the rise began (back to the off level)
      let s = i;
      while (s > i0 && curve[s - 1] >= params.off && curve[s - 1] < curve[s]) s--;
      open = Math.max(s, raw.length ? Math.round(raw[raw.length - 1].end * rate) : i0);
    } else if (open >= 0 && v < params.off) {
      raw.push({ start: open / rate, end: i / rate });
      open = -1;
    }
  }
  if (open >= 0) raw.push({ start: open / rate, end: i1 / rate });
  const merged: Phrase[] = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && p.start - last.end < params.mergeGap) last.end = p.end;
    else merged.push({ ...p });
  }
  return merged.filter((p) => p.end - p.start >= params.minPhrase).map((p) => ({ start: round3(p.start), end: round3(p.end) }));
}

function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/**
 * Sung seconds of a curve between two times, the way the aligner counts them: the curve inside
 * phrases, a quarter of it outside.
 */
export function sungSeconds(curve: ArrayLike<number>, rate: number, from = 0, to = Infinity, params: AlignParams = DEFAULT_ALIGN): number {
  const phrases = detectPhrases(curve, rate, params, from, to);
  const f0 = Math.max(0, Math.floor(from * rate));
  const f1 = Math.min(curve.length, Math.ceil(Math.min(to, curve.length / rate) * rate));
  let inside = 0;
  let all = 0;
  for (let f = f0; f < f1; f++) all += Math.min(1, Math.max(0, Number(curve[f]) || 0));
  for (const p of phrases) {
    for (let f = Math.max(f0, Math.round(p.start * rate)); f < Math.min(f1, Math.round(p.end * rate)); f++) inside += Math.min(1, Math.max(0, Number(curve[f]) || 0));
  }
  return (inside + 0.25 * (all - inside)) / rate;
}

export interface RunLine {
  /** lineWeight of the text */
  weight: number;
  /**
   * where today's proportional spread would start the line: starting further than priorFree
   * seconds from it costs priorCost per second (so a misleading curve never moves a whole song)
   */
  prior?: number;
}

export interface AlignRequest {
  curve: ArrayLike<number>;
  rate: number;
  /** the window: the previous timed line's start (or the song start) … the next timed line's start (or the song end) */
  from: number;
  to: number;
  /** the timed line right before the run (its start is `from`), if any */
  prev: RunLine | null;
  /** a timed line right after the run (its start is `to`) */
  hasNext: boolean;
  lines: RunLine[];
  /** the whole song's sung seconds per weight unit (`sungSeconds` / all line weights): a window full of solo reads no slower */
  songRate?: number;
}

export interface AlignResult {
  /** per run line: start, and the end of its sung part when a real gap follows (else null) */
  starts: number[];
  ends: Array<number | null>;
  /** the previous line's sung end, when a real gap follows it */
  prevEnd: number | null;
  phrases: Phrase[];
  cost: number;
}

interface Candidate {
  t: number;
  cost: number;
}

/** A gap at least this long after a line's sung part makes the line end there. */
export const REAL_GAP_SECONDS = 2;
/** The words stay this long after the last sung frame. */
const END_HOLD = 0.4;

/**
 * Lay the lines of one untimed run over the phrases inside its window, in order. Returns null
 * when the curve cannot carry them (no phrases, fewer candidate starts than lines).
 */
export function alignRun(req: AlignRequest, params: AlignParams = DEFAULT_ALIGN): AlignResult | null {
  const { curve, rate, from, to, prev, hasNext, lines } = req;
  const K = lines.length;
  if (K === 0 || !(to > from) || !(rate > 0)) return null;
  const f0 = Math.max(0, Math.floor(from * rate));
  const f1 = Math.min(curve.length, Math.ceil(to * rate));
  if (f1 - f0 < 4) return null;
  const phrases = detectPhrases(curve, rate, params, from, to);
  if (phrases.length === 0) return null;

  // frame activity (inside a phrase) and the soft curve, as prefix sums over the window
  const n = f1 - f0;
  const active = new Uint8Array(n);
  for (const p of phrases) {
    for (let f = Math.max(f0, Math.round(p.start * rate)); f < Math.min(f1, Math.round(p.end * rate)); f++) active[f - f0] = 1;
  }
  const soft = new Float64Array(n + 1);
  const act = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, Math.max(0, Number(curve[f0 + i]) || 0));
    soft[i + 1] = soft[i] + (active[i] ? v : 0.25 * v);
    act[i + 1] = act[i] + active[i];
  }
  const nextAct = new Int32Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) nextAct[i] = active[i] ? i : nextAct[i + 1];
  const prevAct = new Int32Array(n + 1).fill(-1);
  for (let i = 0; i < n; i++) prevAct[i + 1] = active[i] ? i : prevAct[i];
  const idx = (t: number) => Math.max(0, Math.min(n, Math.round(t * rate) - f0));
  const sung = (a: number, b: number) => (soft[idx(b)] - soft[idx(a)]) / rate;

  // candidate starts: phrase onsets (free), clear dips inside phrases, and a 0.5 s grid inside long phrases
  const cands: Candidate[] = [];
  const at = (f: number) => Number(curve[f]) || 0;
  const dipSpan = Math.max(2, Math.round(0.4 * rate));
  for (const p of phrases) {
    // (a phrase found from the window's first frame may begin a fraction of a frame before `from`)
    if (p.start > from + 1e-6 || !prev) cands.push({ t: Math.max(from, p.start), cost: 0 });
    const a = Math.round(p.start * rate) + Math.round(params.minLine * rate);
    const b = Math.round(p.end * rate) - Math.round(0.3 * rate);
    let lastGrid = -Infinity;
    for (let f = a; f < b; f++) {
      const v = at(f);
      let dip = v < at(f - 1) && v <= at(f + 1);
      if (dip) {
        let left = 0;
        let right = 0;
        for (let k = 1; k <= dipSpan; k++) {
          left = Math.max(left, at(f - k));
          right = Math.max(right, at(f + k));
        }
        dip = left - v >= params.dipDepth && right - v >= params.dipDepth;
      }
      if (dip) cands.push({ t: f / rate, cost: params.splitCost * (0.4 + v) });
      else if (f / rate - lastGrid >= 0.5) {
        cands.push({ t: f / rate, cost: params.splitCost * (1 + v) });
        lastGrid = f / rate;
      }
    }
  }
  cands.sort((x, y) => x.t - y.t || x.cost - y.cost);
  const C = cands.filter((c, i) => c.t > from + (prev ? params.minLine : -1) && c.t < to - (hasNext ? params.minLine : 0) && (i === 0 || c.t - cands[i - 1].t > 1e-6));
  const m = C.length;
  if (m < K) return null;
  const cf = Int32Array.from(C, (c) => idx(c.t));
  const cs = Float64Array.from(cf, (f) => soft[f]);
  const ct = Float64Array.from(C, (c) => c.t);

  // phrase ends inside the window: a line may stop there and leave what follows (a solo, ad-libs,
  // an outro) unassigned at skipCost per sung second, instead of stretching over it
  const endT: number[] = [];
  for (const p of phrases) if (p.end > from && p.end < to - 1e-6) endT.push(p.end);
  endT.push(to);
  const P = endT.length;
  const pf = Int32Array.from(endT, (t) => idx(t));

  // the singing rate (sung seconds per weight unit): the window's own, and slower readings of it
  const wSum = lines.reduce((s, l) => s + l.weight, 0) + (prev ? prev.weight : 0);
  const totalSung = sung(from, to);
  if (!(totalSung > 0.5) || !(wSum > 0)) return null;
  const fromIdx = idx(from);
  const toIdx = idx(to);
  /**
   * Leaving s sung seconds unassigned (a solo, ad-libs, an intro the curve mistook for a voice):
   * cheap for a short stretch, steep beyond skipFree — a whole verse is never skipped.
   */
  const skipCost = (s: number) => (s <= params.skipFree ? params.skipCost * s : params.skipCost * params.skipFree + params.skipSteep * (s - params.skipFree));
  const skip = (ia: number, ib: number) => skipCost((soft[ib] - soft[ia]) / rate);
  const INF = Infinity;
  /** line k starting at candidate j, against where the proportional spread starts it */
  const prior = (k: number, j: number) => {
    const p = lines[k].prior;
    if (p == null || !(params.priorCost > 0)) return 0;
    const d = Math.abs(ct[j] - p) - params.priorFree;
    return d > 0 ? params.priorCost * d : 0;
  };

  interface Solution {
    cost: number;
    starts: number[];
    /** per line: the phrase end it stops at before a skipped stretch (-1: runs to the next start) */
    stops: number[];
    prevStop: number;
  }

  const solve = (r: number): Solution | null => {
    /** a line's duration model at this rate: expected sung seconds, 1 / σ and the 2·log σ term */
    interface LineModel {
      d: number;
      inv: number;
      base: number;
    }
    const modelOf = (weight: number): LineModel => {
      const d = r * weight;
      const sigma = params.sigmaAbs + params.sigmaRel * d;
      return { d, inv: 1 / sigma, base: 2 * Math.log(sigma) };
    };
    /** negative log-likelihood (×2) of a line sung over the window frames [ia, ib) */
    const seg = (lm: LineModel, ia: number, ib: number, ta: number, tb: number): number => {
      if (tb - ta < params.minLine) return INF;
      const x = ((soft[ib] - soft[ia]) / rate - lm.d) * lm.inv;
      let c = x * x + lm.base;
      // a vocal gap inside the line's sung part (voice, gap, voice): the line would hold over it
      const first = nextAct[ia];
      const last = prevAct[ib];
      if (first < ib && last >= ia && last > first) {
        const inner = (last - first + 1 - (act[last + 1] - act[first])) / rate;
        if (inner > params.gapFree) c += params.gapCost * (inner - params.gapFree);
      }
      return c;
    };
    /** a line never sings longer than this (curve units × frames), whatever follows it */
    const limitOf = (weight: number) => Math.max(3, params.maxLineFactor * r * weight + 3) * rate;
    /** lines of a run follow each other: a long gap before the next line of the run costs (not before a timed line) */
    const tail = (gap: number) => (gap > params.tailFree ? params.tailCost * (gap - params.tailFree) : 0);
    /** the gap between the last sung frame of [ia, ib) and tb */
    const tailOf = (ia: number, ib: number, ta: number, tb: number) => {
      const last = prevAct[ib];
      return tail(tb - (last >= ia ? (f0 + last + 1) / rate : ta));
    };
    const maxSkip = params.maxSkip * rate;
    /**
     * For candidate j and the last end `ep` at or before it: the best stop e of a line — its cost,
     * the skipped stretch up to ct[j] and the tail cost of the gap — as [cost, e]. Stops further back
     * than maxSkip sung seconds are not looked at (skipping that much costs more than any placement).
     */
    const bestStop = (stops: Float64Array, j: number, ep: number): [number, number] => {
      let best = INF;
      let arg = -1;
      for (let e = ep; e >= 0; e--) {
        const skipped = cs[j] - soft[pf[e]];
        if (skipped > maxSkip) break;
        if (stops[e] === INF) continue;
        const c = stops[e] + skipCost(skipped / rate) + tail(ct[j] - endT[e]);
        if (c < best) {
          best = c;
          arg = e;
        }
      }
      return [best, arg];
    };

    // S[k][j]: lines before k placed, line k starts at candidate j; E[k][e]: line k stops at end e
    const S = Array.from({ length: K }, () => new Float64Array(m).fill(INF));
    const SB = Array.from({ length: K }, () => new Int32Array(m).fill(-1));
    const E = Array.from({ length: K }, () => new Float64Array(P).fill(INF));
    const EB = Array.from({ length: K }, () => new Int32Array(P).fill(-1));
    if (!prev) {
      for (let j = 0; j < m; j++) S[0][j] = skip(fromIdx, cf[j]) + C[j].cost + prior(0, j);
    } else {
      // the timed line before the run sings from `from`: straight into the first line, or it stops first
      const limit = limitOf(prev.weight);
      const pm = modelOf(prev.weight);
      const prevStops = new Float64Array(P).fill(INF);
      for (let e = 0; e < P; e++) if (soft[pf[e]] - soft[fromIdx] <= limit) prevStops[e] = seg(pm, fromIdx, pf[e], from, endT[e]);
      let ep = -1;
      for (let j = 0; j < m; j++) {
        while (ep + 1 < P && endT[ep + 1] <= ct[j]) ep++;
        let lead = cs[j] - soft[fromIdx] <= limit ? seg(pm, fromIdx, cf[j], from, ct[j]) + tailOf(fromIdx, cf[j], from, ct[j]) : INF;
        let via = -1;
        const [stopped, e] = bestStop(prevStops, j, ep);
        if (stopped < lead) {
          lead = stopped;
          via = e;
        }
        if (lead < INF) {
          S[0][j] = lead + C[j].cost + prior(0, j);
          // -1: straight; ≤ -2: the previous line stopped at end −2 − code
          SB[0][j] = via < 0 ? -1 : -2 - via;
        }
      }
    }
    for (let k = 0; k < K; k++) {
      const w = lines[k].weight;
      const limit = limitOf(w);
      const lm = modelOf(w);
      const row = S[k];
      // line k stops at a phrase end within its sung limit
      let e0 = 0;
      for (let i = 0; i < m; i++) {
        if (row[i] === INF) continue;
        while (e0 < P && endT[e0] <= ct[i]) e0++;
        for (let e = e0; e < P; e++) {
          if (soft[pf[e]] - cs[i] > limit) break;
          const c = row[i] + seg(lm, cf[i], pf[e], ct[i], endT[e]);
          if (c < E[k][e]) {
            E[k][e] = c;
            EB[k][e] = i;
          }
        }
      }
      if (k + 1 >= K) break;
      // line k + 1 starts straight after line k, or after line k stopped and a stretch was skipped
      const next = S[k + 1];
      const nb = SB[k + 1];
      let ep = -1;
      for (let j = k + 1; j < m; j++) {
        while (ep + 1 < P && endT[ep + 1] <= ct[j]) ep++;
        const [stopped, stopE] = bestStop(E[k], j, ep);
        let bestCost = stopped;
        let arg = stopE >= 0 ? -2 - stopE : -1;
        for (let i = j - 1; i >= k; i--) {
          if (cs[j] - cs[i] > limit) break;
          if (row[i] === INF) continue;
          const c = row[i] + seg(lm, cf[i], cf[j], ct[i], ct[j]) + tailOf(cf[i], cf[j], ct[i], ct[j]);
          if (c < bestCost) {
            bestCost = c;
            arg = i;
          }
        }
        if (bestCost < INF && arg !== -1) {
          next[j] = bestCost + C[j].cost + prior(k + 1, j);
          nb[j] = arg;
        }
      }
    }
    // the last line stops at an end (then the rest of the window is skipped), or — before a timed
    // line — runs straight into it
    let total = INF;
    let lastStart = -1;
    let lastStop = -1;
    for (let e = 0; e < P; e++) {
      const c = E[K - 1][e] + skip(pf[e], toIdx);
      if (c < total) {
        total = c;
        lastStop = e;
        lastStart = EB[K - 1][e];
      }
    }
    if (hasNext) {
      const limit = limitOf(lines[K - 1].weight);
      const lm = modelOf(lines[K - 1].weight);
      for (let i = m - 1; i >= K - 1; i--) {
        if (soft[toIdx] - cs[i] > limit) break;
        if (S[K - 1][i] === INF) continue;
        const c = S[K - 1][i] + seg(lm, cf[i], toIdx, ct[i], to);
        if (c < total) {
          total = c;
          lastStart = i;
          lastStop = -1;
        }
      }
    }
    if (lastStart < 0 || !Number.isFinite(total)) return null;
    const startIdx = new Array<number>(K);
    const stops = new Array<number>(K).fill(-1);
    startIdx[K - 1] = lastStart;
    stops[K - 1] = lastStop;
    for (let k = K - 1; k > 0; k--) {
      const b = SB[k][startIdx[k]];
      if (b >= 0) startIdx[k - 1] = b;
      else {
        const stop = -2 - b;
        stops[k - 1] = stop;
        startIdx[k - 1] = EB[k - 1][stop];
      }
      if (startIdx[k - 1] < 0) return null;
    }
    const b0 = SB[0][startIdx[0]];
    return { cost: total, starts: startIdx.map((i) => ct[i]), stops, prevStop: b0 <= -2 ? -2 - b0 : -1 };
  };

  let best: Solution | null = null;
  const r0 = totalSung / wSum;
  const tried = req.songRate && req.songRate > 0 ? [...params.songRates.map((f) => f * req.songRate!), r0] : params.rates.map((f) => f * r0);
  for (const [n, r] of tried.entries()) {
    // an untimed song's window is the song: its own rate is the song rate (solve it once)
    if (tried.slice(0, n).some((x) => Math.abs(x - r) <= 1e-9 * Math.max(1, r))) continue;
    const sol = solve(r);
    if (sol && (!best || sol.cost < best.cost)) best = sol;
  }
  if (!best) return null;
  const starts = best.starts.map(round3);

  // a line ends with its sung part when a real gap follows (the stage clears the words over an
  // interlude): where it stopped before a skipped stretch, else the last active frame of its span
  const sungEnd = (a: number, b: number): number | null => {
    const last = prevAct[idx(b)];
    if (last < idx(a)) return null;
    const e = (f0 + last + 1) / rate;
    return b - e >= REAL_GAP_SECONDS ? round3(Math.min(b, e + END_HOLD)) : null;
  };
  const endOf = (stop: number, a: number, b: number): number | null => {
    if (stop < 0) return sungEnd(a, b);
    return b - endT[stop] >= REAL_GAP_SECONDS ? round3(Math.min(b, endT[stop] + END_HOLD)) : null;
  };
  const ends = starts.map((s, k) => endOf(best.stops[k], s, k + 1 < K ? starts[k + 1] : to));
  const prevEnd = prev ? endOf(best.prevStop, from, starts[0]) : null;
  return { starts, ends, prevEnd, phrases, cost: best.cost };
}
