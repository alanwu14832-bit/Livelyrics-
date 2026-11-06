// Round 22 (N6): the section change takes its look from the song, not one soft white beam for all.

import { describe, expect, it } from "vitest";
import { offlineDesign } from "@/lib/server/designer/offline";
import { AUDIT_SONGS, auditInput } from "@/lib/server/designer/testing/audit-songs";
import { resolveColorway } from "./resolve";
import { CHARACTER_CODE, FALL, songCharacter, transitionLook } from "./transition-look";

const plans = Object.fromEntries(AUDIT_SONGS.map((s) => [s.key, offlineDesign(auditInput(s))]));

describe("round 22: the song's transition character", () => {
  it("the designer gives each genre its own character", () => {
    expect(plans.ballad.transitionCharacter).toBe("swell");
    expect(plans.punk.transitionCharacter).toBe("cut");
    expect(plans.citypop.transitionCharacter).toBe("scan");
    expect(plans.folk.transitionCharacter).toBe("tide");
    expect(plans.demo.transitionCharacter).toBe("sweep");
  });

  it("a falling change dissolves, a rising one wears the song's character, the light only when it rises", () => {
    for (const [key, plan] of Object.entries(plans)) {
      plan.sections.forEach((s, i) => {
        if (i === 0) return;
        const look = transitionLook(plan, i, resolveColorway(plan, s))!;
        const rise = s.energy - plan.sections[i - 1].energy;
        expect(look.rise).toBeCloseTo(rise, 5);
        if (rise <= -FALL) expect(look.character, `${key} s${i}`).toBe(CHARACTER_CODE.dissolve);
        else expect(look.character, `${key} s${i}`).toBe(CHARACTER_CODE[songCharacter(plan)]);
        // the edge is a colour of the song, never white
        const l = 0.2126 * look.tint[0] + 0.7152 * look.tint[1] + 0.0722 * look.tint[2];
        expect(l, `${key} s${i}`).toBeLessThanOrEqual(0.751);
        expect(Math.max(...look.tint) - Math.min(...look.tint), `${key} s${i} tint is grey`).toBeGreaterThan(0.05);
      });
    }
  });

  it("four genres' first rising change differ in character, angle or tint", () => {
    const firsts = ["ballad", "punk", "citypop", "folk"].map((k) => {
      const plan = plans[k];
      const i = plan.sections.findIndex((s, j) => j > 0 && s.energy - plan.sections[j - 1].energy > 0.1);
      return transitionLook(plan, i, resolveColorway(plan, plan.sections[i]))!;
    });
    expect(new Set(firsts.map((l) => l.character)).size).toBe(4);
  });

  it("older plans read a character from their type system", () => {
    const old = { ...plans.punk, transitionCharacter: undefined };
    expect(["cut", "scan", "tide", "swell", "sweep"]).toContain(songCharacter(old));
    expect(songCharacter(null)).toBe("sweep");
    expect(transitionLook(old, null, [])).toBeNull();
  });
});
