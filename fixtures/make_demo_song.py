# Generates a synthetic "song" WAV for testing: 120 BPM, quiet intro, verse, loud chorus, breakdown, chorus, outro.
import math, struct, wave, random, sys
sr = 22050
bpm = 120.0
beat = 60.0 / bpm
out = sys.argv[1] if len(sys.argv) > 1 else "demo-song.wav"
# (name, bars, loudness, drums, bass, chords)
sections = [("intro", 4, 0.25, False, False, True), ("verse", 8, 0.5, True, True, True),
            ("chorus", 8, 1.0, True, True, True), ("breakdown", 4, 0.3, False, True, True),
            ("chorus", 8, 1.0, True, True, True), ("outro", 4, 0.2, False, False, True)]
total_beats = sum(s[1] * 4 for s in sections)
n = int(total_beats * beat * sr) + sr
buf = [0.0] * n
random.seed(7)
chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66)]
t0 = 0.0
for name, bars, loud, drums, bass, pads in sections:
    for b in range(bars * 4):
        start = t0 + b * beat
        i0 = int(start * sr)
        chord = chords[(b // 4) % 4]
        if drums:
            # kick on every beat
            for k in range(int(0.18 * sr)):
                tt = k / sr
                f = 55 + 90 * math.exp(-tt * 30)
                v = math.sin(2 * math.pi * f * tt) * math.exp(-tt * 18) * 0.9 * loud
                if i0 + k < n: buf[i0 + k] += v
            # hat on offbeats
            j0 = int((start + beat / 2) * sr)
            for k in range(int(0.05 * sr)):
                v = (random.random() * 2 - 1) * math.exp(-k / sr * 80) * 0.25 * loud
                if j0 + k < n: buf[j0 + k] += v
            if b % 2 == 1:  # snare
                for k in range(int(0.12 * sr)):
                    v = (random.random() * 2 - 1) * math.exp(-k / sr * 25) * 0.45 * loud
                    if i0 + k < n: buf[i0 + k] += v
        if bass:
            for k in range(int(beat * sr)):
                tt = k / sr
                v = math.sin(2 * math.pi * chord[0] / 4 * tt) * 0.35 * loud * min(1, tt * 50) * math.exp(-tt * 2)
                if i0 + k < n: buf[i0 + k] += v
        if pads:
            for k in range(int(beat * sr)):
                tt = start + k / sr
                v = sum(math.sin(2 * math.pi * f * tt) for f in chord) * 0.06 * (0.4 + loud)
                if i0 + k < n: buf[i0 + k] += v
    t0 += bars * 4 * beat
peak = max(abs(x) for x in buf) or 1
with wave.open(out, "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x / peak * 0.9)) * 32767)) for x in buf))
print(out, round(n / sr, 2), "s")
