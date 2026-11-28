// Round 28: whether the offline composer checks its own picture by default (self-check.ts). On in
// production; the unit tests switch it off in the vitest setup (every `offlineDesign` would otherwise
// render the program on the CPU several times) and ask for it where they test it.

export const selfCheckConfig = { enabled: true };
