import { describe, expect, it } from "vitest";
import { defaultBible } from "@/lib/band";
import type { ProjectSummary, SetItem, Show } from "@/lib/types";
import {
  AUTO_STANDBY_ID,
  DEFAULT_PREFS,
  arm,
  go,
  initialLive,
  itemAfter,
  loadShowLiveSession,
  parsePrefs,
  parseShowLiveSession,
  railItems,
  readinessIssues,
  reconcileLive,
  saveShowLiveSession,
  standbyItem,
  take,
  takeStandby,
} from "./show-live";

const look = { scene: "gradient" as const, colorway: ["#000000", "#224488", "#ff5577"] as [string, string, string], media: null };
const items: SetItem[] = [
  { id: "walkin", kind: "walk-in", title: "進場", look: { ...look, text: "樂團", durationHint: 300 } },
  { id: "song1", kind: "song", projectId: "p1" },
  { id: "mc", kind: "interlude", title: "串場", look },
  { id: "song2", kind: "song", projectId: "p2" },
  { id: "walkout", kind: "walk-out", title: "散場", look: { ...look, text: "謝謝大家" } },
];

function summary(id: string, over: Partial<ProjectSummary> = {}): ProjectSummary {
  return { id, title: id === "p1" ? "第一首" : "第二首", artist: "", duration: 200, status: "ready", updatedAt: "", hasPlan: true, lyricLines: 10, palette: ["#101018", "#4455cc", "#ff5a36"], ...over };
}

describe("arm, take and GO", () => {
  it("starts with nothing on air and the first item armed", () => {
    expect(initialLive(items)).toEqual({ current: null, armed: "walkin", takenAt: null });
    expect(initialLive([])).toEqual({ current: null, armed: null, takenAt: null });
  });

  it("GO takes the armed item and arms the following one", () => {
    let live = initialLive(items);
    live = go(live, items, 1000)!;
    expect(live).toEqual({ current: "walkin", armed: "song1", takenAt: 1000 });
    live = go(live, items, 2000)!;
    expect(live).toEqual({ current: "song1", armed: "mc", takenAt: 2000 });
  });

  it("GO past the end does nothing", () => {
    let live = take(initialLive(items), items, "walkout", 5000);
    expect(live.armed).toBeNull();
    expect(go(live, items, 6000)).toBeNull();
    live = { ...live, armed: "gone" };
    expect(go(live, items, 6000)).toBeNull();
  });

  it("a click arms any item; unknown ids are ignored", () => {
    const live = take(initialLive(items), items, "song1", 1);
    expect(arm(live, items, "walkout").armed).toBe("walkout");
    expect(arm(live, items, "nope")).toBe(live);
    expect(arm(live, items, "mc")).toBe(live); // already armed: same object
  });

  it("re-takes an earlier song from the rail", () => {
    let live = take(initialLive(items), items, "song2", 1); // song 2 on air
    live = takeStandby(live, items, AUTO_STANDBY_ID, 2)!; // it fell apart
    live = arm(live, items, "song2");
    live = go(live, items, 3)!;
    expect(live).toEqual({ current: "song2", armed: "walkout", takenAt: 3 });
  });

  it("itemAfter follows the setlist order", () => {
    expect(itemAfter(items, "song1")).toBe("mc");
    expect(itemAfter(items, "walkout")).toBeNull();
    expect(itemAfter(items, AUTO_STANDBY_ID)).toBeNull();
    expect(itemAfter(items, null)).toBeNull();
  });
});

describe("standby", () => {
  it("uses the show's own standby look when it has one", () => {
    const withStandby: SetItem[] = [...items, { id: "wait", kind: "standby", title: "技術暫停", look }];
    expect(standbyItem({ items: withStandby }, null).id).toBe("wait");
  });

  it("otherwise builds one from the band's bible", () => {
    const s = standbyItem({ items }, { name: "樂團", bible: defaultBible(), assets: [] });
    expect(s.id).toBe(AUTO_STANDBY_ID);
    expect(s.kind).toBe("standby");
    expect(s.look.colorway).toHaveLength(3);
    expect(s.look.text).toBeUndefined(); // a safe screen: no words
    expect(standbyItem({ items }, null).id).toBe(AUTO_STANDBY_ID);
  });

  it("keeps what was armed (usually the next song)", () => {
    const live = take(initialLive(items), items, "song1", 1); // armed: mc
    expect(takeStandby(live, items, AUTO_STANDBY_ID, 2)).toEqual({ current: AUTO_STANDBY_ID, armed: "mc", takenAt: 2 });
  });

  it("arms the item after a standby that was itself armed", () => {
    const withStandby: SetItem[] = [items[0], items[1], { id: "wait", kind: "standby", title: "待機", look }, items[3]];
    const live = take(initialLive(withStandby), withStandby, "song1", 1); // armed: wait
    expect(takeStandby(live, withStandby, "wait", 2)).toEqual({ current: "wait", armed: "song2", takenAt: 2 });
  });

  it("does nothing when standby is already on air", () => {
    const live = { current: AUTO_STANDBY_ID, armed: "mc", takenAt: 1 };
    expect(takeStandby(live, items, AUTO_STANDBY_ID, 2)).toBeNull();
  });
});

describe("recovery and the session", () => {
  it("reconciles a restored state with a changed setlist", () => {
    expect(reconcileLive({ current: "song1", armed: "mc", takenAt: 5 }, items)).toEqual({ current: "song1", armed: "mc", takenAt: 5 });
    expect(reconcileLive({ current: "deleted", armed: "gone", takenAt: 5 }, items)).toEqual({ current: null, armed: "walkin", takenAt: null });
    expect(reconcileLive({ current: "song2", armed: "gone", takenAt: 5 }, items)).toEqual({ current: "song2", armed: "walkout", takenAt: 5 });
    expect(reconcileLive({ current: AUTO_STANDBY_ID, armed: "mc", takenAt: 9 }, items)).toEqual({ current: AUTO_STANDBY_ID, armed: "mc", takenAt: 9 });
  });

  it("round-trips the session and repairs garbage", () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    saveShowLiveSession("show1", { current: "song1", armed: "mc", takenAt: 123, transition: "cut", autoPlay: true }, store);
    expect(loadShowLiveSession("show1", store)).toEqual({ current: "song1", armed: "mc", takenAt: 123, transition: "cut", autoPlay: true });
    expect(loadShowLiveSession("other", store)).toBeNull();
    expect(parseShowLiveSession("{bad")).toBeNull();
    expect(parseShowLiveSession("[]")).toBeNull();
    expect(parseShowLiveSession(JSON.stringify({ current: "<script>", armed: 7, takenAt: -1, transition: "spin", autoPlay: "yes" }))).toEqual({
      current: null,
      armed: null,
      takenAt: null,
      ...DEFAULT_PREFS,
    });
    expect(parsePrefs({ transition: "cut" })).toEqual({ transition: "cut", autoPlay: false });
  });
});

describe("rail rows and readiness", () => {
  const show: Pick<Show, "items" | "arc"> = {
    items,
    arc: { engine: "offline", createdAt: "", overview: "", songs: [{ itemId: "song2", projectId: "p2", position: 1, role: "peak", energy: 0.9, emphasis: "accent", note: "" }] },
  };
  const songs = new Map([
    ["p1", summary("p1", { lyricLines: 0 })],
    ["p2", summary("p2")],
  ]);

  it("describes every item: kind, number, length, readiness, arc role, colours", () => {
    const rows = railItems(show, songs);
    expect(rows.map((r) => r.id)).toEqual(["walkin", "song1", "mc", "song2", "walkout"]);
    expect(rows[0]).toMatchObject({ kind: "walk-in", title: "進場", songNumber: null, seconds: 300, status: null, text: "樂團", swatch: look.colorway });
    expect(rows[1]).toMatchObject({ kind: "song", title: "第一首", songNumber: 1, seconds: 200, status: "missing-lyrics", arcRole: null });
    expect(rows[3]).toMatchObject({ songNumber: 2, status: "ready", arcRole: "peak", swatch: ["#101018", "#4455cc", "#ff5a36"] });
    expect(rows[2].seconds).toBeNull();
  });

  it("lists the songs that are not ready (a deleted one too)", () => {
    const withMissing: SetItem[] = [...items, { id: "song3", kind: "song", projectId: "gone" }];
    expect(readinessIssues(withMissing, songs)).toEqual([
      { itemId: "song1", title: "第一首", status: "missing-lyrics" },
      { itemId: "song3", title: "作品已刪除", status: "missing" },
    ]);
    expect(readinessIssues(items, new Map([["p1", summary("p1")], ["p2", summary("p2")]]))).toEqual([]);
  });
});
