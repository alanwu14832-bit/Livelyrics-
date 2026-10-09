// The projection window's 「等待控制台連線…」 pill (m6). It is on the LED wall itself, so it shows only
// while the operator is placing a freshly opened window (at most WAITING_HINT_MS) and never again: a
// console that is closed, backgrounded or on a laptop that went to sleep must not leave text on the
// wall. The console says 「投影未連線」 / 「投影已連線」 in its own top bar instead.

/** how long a projection window that has not heard from a console shows the pill */
export const WAITING_HINT_MS = 5000;

/** Whether the pill is visible `elapsedMs` after the window opened. */
export function waitingHintVisible(connected: boolean, elapsedMs: number): boolean {
  return !connected && elapsedMs >= 0 && elapsedMs < WAITING_HINT_MS;
}
