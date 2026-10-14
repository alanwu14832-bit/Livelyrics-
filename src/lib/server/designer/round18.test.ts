// Round 18 (M2) — not the same picture recoloured: the library's last looks (form, texture, type
// voice, font pair, palette family, climax scene) weigh the next song's choices down by their count,
// a shout song prints bars / a brush stroke, a ballad lays a horizon or strata, and the choruses climb
// (another scene, a denser and livelier program state) instead of repeating the first.

import { describe, expect, it } from "vitest";
import type { DesignPlan } from "@/lib/types";
import { FORM_IDS } from "@/lib/stage/program/composer";
import { analyzeFindings } from "./findings";
import { freshHue, offlineDesign } from "./offline";
import { hueFamily, lookOfPlan, paletteFamily, recentFactor, type RecentLook } from "./recent";
import { formWeights, isBallad, sceneForms } from "./scene-program";
import { AUDIT_SONGS, auditInput, auditSong } from "./testing/audit-songs";
import { fixtureInput, SONG_FIXTURES } from "./testing/songs";
import { chooseVoice, freshFonts } from "./type-design";

/** Design songs in order, each seeing the library's looks before it (as the pipeline passes them). */
function catalogue(inputs: Array<ReturnType<typeof auditInput>>): DesignPlan[] {
  const forms: string[] = [];
  const looks: RecentLook[] = [];
  return inputs.map((input) => {
    const plan = offlineDesign({ ...input, recentForms: [...forms], recentLooks: [...looks] });
    forms.unshift(plan.sceneProgram!.recipe!.split("/")[0]);
    looks.unshift(lookOfPlan(plan));
    return plan;
  });
}

const maxCount = (xs: readonly string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return Math.max(...m.values());
};

describe("round 18 · variety across the library", () => {
  const plans = catalogue(AUDIT_SONGS.map(auditInput));
  const looks = plans.map(lookOfPlan);

  it("no form, texture, voice, font pair or palette family is worn by more than two of the audit songs", () => {
    for (const key of ["form", "texture", "voice", "fonts", "palette"] as const) {
      const xs = looks.map((l) => l[key] ?? "?");
      expect(maxCount(xs), `${key}: ${xs.join(",")}`).toBeLessThanOrEqual(2);
    }
  });

  it("a shout song prints bars or a brush stroke; a ballad lays a horizon or strata", () => {
    const punk = sceneForms(analyzeFindings(auditInput(auditSong("punk"))));
    expect(["bars", "brush"]).toContain(punk[0]);
    const ballad = analyzeFindings(auditInput(auditSong("ballad")));
    expect(isBallad(ballad)).toBe(true);
    expect(["horizon", "strata"]).toContain(sceneForms(ballad)[0]);
    expect(isBallad(analyzeFindings(auditInput(auditSong("demo"))))).toBe(false);
  });

  it("every form is drawn at least once across a spread of genres", () => {
    // the five fixtures with their own genres, then re-tagged with neighbouring ones
    const spread: Array<[string, string]> = [
      ["night-bus", "city pop"],
      ["tide", "folk"],
      ["last-light", "post-rock"],
      ["static-youth", "punk"],
      ["rain-station", "dream pop"],
      ["rain-station", "ballad"],
      ["static-youth", "hardcore punk"],
      ["last-light", "metal"],
      ["night-bus", "electronic"],
      ["tide", "ambient"],
      ["static-youth", "emo"],
      ["night-bus", "jazz"],
    ];
    const inputs = spread.map(([id, genre], i) => {
      const f = SONG_FIXTURES.find((x) => x.id === id)!;
      return fixtureInput({ ...f, id: `${f.id}-${i}`, title: `${f.title}${i}`, genre });
    });
    const forms = catalogue(inputs).map((p) => p.sceneProgram!.recipe!.split("/")[0]);
    for (const f of FORM_IDS) expect(forms, forms.join(",")).toContain(f);
  });

  it("each chorus after the first changes scene or climbs in the program (denser, livelier)", () => {
    for (const plan of plans) {
      const choruses = plan.sections.filter((s) => s.kind === "chorus");
      for (let i = 1; i < choruses.length; i++) {
        const a = plan.sceneProgram!.sections.find((s) => s.sectionId === choruses[i - 1].id)!;
        const b = plan.sceneProgram!.sections.find((s) => s.sectionId === choruses[i].id)!;
        expect(choruses[i].scene !== choruses[i - 1].scene || b.params[1] > a.params[1], plan.keyVisual.title).toBe(true);
        expect(b.params[1]).toBeGreaterThan(a.params[1]);
        expect(b.params[3]).toBeGreaterThan(a.params[3]);
      }
    }
  });
});

describe("round 18 · the recency rules", () => {
  const looks = (xs: Array<Partial<RecentLook>>): RecentLook[] => xs as RecentLook[];

  it("counts within the window: one use is a nudge, two nearly a ban, the eighth song back is forgotten", () => {
    const l = looks([{ voice: "mv-card" }, { voice: "ink" }, { voice: "mv-card" }]);
    expect(recentFactor(l, "voice", "glitch")).toBe(1);
    expect(recentFactor(l, "voice", "ink")).toBe(0.45);
    expect(recentFactor(l, "voice", "mv-card")).toBe(0.04);
    expect(recentFactor(looks([{}, {}, {}, {}, {}, {}, {}, { voice: "ink" }]), "voice", "ink")).toBe(1);
  });

  it("the voice gives way to the genre's second grammar once the library wore it twice", () => {
    const f = analyzeFindings(auditInput(auditSong("demo")));
    expect(chooseVoice(f, true).voice).toBe("mv-card");
    expect(chooseVoice(f, true, looks([{ voice: "mv-card" }, { voice: "mv-card" }])).voice).not.toBe("mv-card");
  });

  it("a font pair worn twice gives way to another pair the voice speaks", () => {
    const pair = { cjk: "noto-sans-tc" as const, latin: "space-grotesk" as const };
    expect(freshFonts("mv-card", pair, looks([{ fonts: "noto-sans-tc+space-grotesk" }]))).toEqual(pair);
    const next = freshFonts("mv-card", pair, looks([{ fonts: "noto-sans-tc+space-grotesk" }, { fonts: "noto-sans-tc+space-grotesk" }]));
    expect(`${next.cjk}+${next.latin}`).not.toBe("noto-sans-tc+space-grotesk");
  });

  it("a hue family worn twice moves to a neighbouring family; families read from the primary", () => {
    expect(paletteFamily("#5075b2")).toBe("blue");
    expect(paletteFamily("#808080")).toBe("neutral");
    expect(freshHue(220, looks([{ palette: "blue" }]))).toBe(220);
    const moved = freshHue(220, looks([{ palette: "blue" }, { palette: "blue" }]));
    expect(hueFamily(moved)).not.toBe("blue");
    expect(Math.abs(moved - 220) % 300).toBeLessThanOrEqual(60);
  });

  it("the form weights fall by count", () => {
    const f = analyzeFindings(auditInput(auditSong("folk")));
    const w = formWeights(f);
    expect(formWeights(f, { recentForms: ["bars", "strata", "strata"] }).strata).toBeLessThan(w.strata * 0.05);
  });
});
