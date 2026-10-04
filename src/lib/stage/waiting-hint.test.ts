import { describe, expect, it } from "vitest";
import { WAITING_HINT_MS, waitingHintVisible } from "./waiting-hint";

describe("the projection's waiting pill", () => {
  it("shows for at most 5 s after the window opens, only while no console answered", () => {
    expect(WAITING_HINT_MS).toBeLessThanOrEqual(5000);
    expect(waitingHintVisible(false, 0)).toBe(true);
    expect(waitingHintVisible(false, WAITING_HINT_MS - 1)).toBe(true);
    expect(waitingHintVisible(false, WAITING_HINT_MS)).toBe(false);
    expect(waitingHintVisible(false, 60 * 60 * 1000)).toBe(false); // a sleeping laptop: never back on the wall
    expect(waitingHintVisible(true, 0)).toBe(false);
  });
});
