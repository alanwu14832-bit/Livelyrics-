---
name: kinetic-type-director
description: Use when the user asks for a kinetic typography video (or a lyric, quote or lesson video where the words are the main visual) made from a script, or asks to direct, plan, review or approve the typography line by line before it is built. Drafts a "type script" (a text-animation technique for every line, chosen for its meaning), shows it as an interactive page in the built-in browser where the user previews and swaps styles, reads their choices back, then builds the approved version in Remotion. Not for simply adding captions or a title to a video; that is the kinetic-type skill on its own.
---

# Kinetic type director

You direct the typography of a whole video with the user. You draft a **type script**: a technique for every line, picked for what the line means. The user sees it as a page, previews and changes it, and approves it. Then you build exactly what they approved, in Remotion.

**Creative freedom first.** Everything below is a default, not a rule. When a moment calls for something else, do it and say why in that line's one-line reason. The user keeps the final say through the page.

In the steps, `<skill>` means this skill's folder (Claude Code shows it as the base directory when the skill loads). The `kinetic-type` skill sits next to it, at `<skill>/../kinetic-type`.

## 1. Load `kinetic-type` first

Load the `kinetic-type` skill (Skill tool) and open its `references/menu.md`. Every technique id you use comes from that menu, and its build section is how you build in step 6. Don't keep your own list.

## 2. Gather

- **The script.** If the user hasn't given it, ask for it. Split it into on-screen lines, one phrase or thought each. The user's own line breaks win.
- **Aspect ratio:** `16:9` unless they say otherwise (`9:16` for phone video, `1:1` square).
- **Mode:** teaching unless they say otherwise. "Be creative", "go wild" or "surprise me" means free rein.
- **Timing.** Estimate when each line starts (`t`) and how long it stays (`dur`), in seconds, from how long it would take to say aloud, with a beat where a pause helps. It's a guess: there's no audio, and the voice-over is recorded later.

Don't hold things up with questions you can answer with a default. Say which defaults you used.

## 3. Draft the type script

- **Three house options:** three **calm** techniques (tagged calm on the menu) that suit the topic and tone, each with a one-line reason. Your first pick is `house`. (The page only accepts calm house options; a bolder look can still be any line's `style`.)
- **Every line:** `style` is `"house"` or an accent id, `key` is the word that matters most (or `""`), and `suggest` lists your picks for that line, each with a one-line reason. Ordinary lines can have an empty `suggest`.
- **Teaching mode** (the default): the house style carries the ordinary lines, and a few accents mark the moments that matter: a key term, the answer, a warning. Techniques tagged teach make good accents. Few accents land harder than many.
- **Free rein:** anything on the menu, still chosen by meaning. Freedom doesn't mean using many.
- **Exits** (tagged exit: shatter, disintegrate, smoke dissolve, zoom through a letter) end with the words gone. Place them where the words should leave, such as the end of a scene or the last line, and say so in the reason.
- Breaking a default is fine. Put the why in the reason, for example "Free-rein pick in a lesson: the answer deserves a bang."

## 4. Make the page and open it

Run these commands from the root folder of the user's video project.

1. Write the data as `type-script/<slug>.json` in the project. `<slug>` is a short kebab-case name, such as `pythagoras`. The fields, with a full example, are in `references/type-script-format.md`.
2. Make the page:
   ```bash
   node "<skill>/scripts/make-page.mjs" type-script/<slug>.json type-script/<slug>.html
   ```
   If it refuses, it lists every problem and writes nothing. Fix the data and run it again.
3. Serve the folder over http, as a **background** command (the browser pane shows `file://` pages as still pictures):
   ```bash
   node "<skill>/scripts/serve.mjs" type-script <port>
   ```
   Pick a port for this project (3018 is the default) and **always use the same port for the same project**. The page saves the user's choices per address, so a different port shows a fresh page. If the port says it's busy, the server is probably still running from earlier, so just open the page.
4. Open `http://127.0.0.1:<port>/<slug>.html` in the built-in browser: `preview_start` with that `url`, or `navigate` if the pane is already open.

If there's no built-in browser, give the user the path to `type-script/<slug>.html` to open in their own browser, and use the "Copy choices" fallback in step 5.

## 5. Hand over, then read the choices

Tell the user, in a few lines, what you drafted (the house pick and the accents) and how to use the page:
- click a word to make it the key word
- Swap changes a line's style
- "+ note for Claude" leaves a note on a line
- "Looks good: send to Claude" approves

Ask them to say **"done"** when they're finished.

When they do, read the result with the browser's `javascript_tool` on the open page:

```js
JSON.stringify(window.TYPE_SCRIPT_RESULT)
```

It holds `{ title, mode, house, lines: [{ text, key, style, note }], approved, draft }`. `style: "house"` means the chosen `house`. If you can't read it, ask the user to press **Copy choices** and paste what it copies. The JSON object is at the end.

- **Check `approved === true` before building.** If it's false, they didn't press "Looks good", or changed something after it. Ask whether to go ahead or wait.
- **Notes** are the user's requests for that line. Follow them in the build. If one changes the plan, say how you read it.
- Save what you read as `type-script/<slug>.choices.json`, so the choices survive the session.

**When the page needs regenerating** (new lines, changed text or timing, or a fresh free-rein draft they asked for):
1. Read `TYPE_SCRIPT_RESULT` first. A page made from changed data starts fresh.
2. Fold their earlier choices into the new data:
   - Their house pick goes into `house`, and into `houseOptions` if it isn't there (swap out one of the other two).
   - Their styles and key words go onto the matching lines (`style`, `key`). If they picked a style you didn't suggest, add it to that line's `suggest` too, with their reason if they gave one.
   - The data has no field for notes, so act on each note in the new draft, and say how in that line's reason (for example "You asked for more punch: stomp instead of fade").
3. Regenerate the page, then reload it on the **same port**.

## 6. Build in Remotion

Follow `kinetic-type`'s "Building it in Remotion" section: copy its `remotion/` folder into the project as `src/kinetic-type/`, and install the packages it names at the project's exact Remotion version. Use `npm i -E` so npm saves the exact version (plain `npm i` saves `^4.0.536`, which can later drift to a newer, mismatched version). Then write one composition for the video, in its own file such as `src/<Name>.tsx`:

- **Size:** 1920×1080 for 16:9, 1080×1920 for 9:16, 1080×1080 for 1:1. Use 30 fps. The length is the end of the last line (`t + dur`).
- **Background:** the components are see-through, so put the page's paper colour behind them (`C.paper` from `src/kinetic-type/kit`). Dark techniques bring their own dark background.
- **Each line** goes in a `<Sequence>` at its estimated time, using `KT_COMPONENTS` with the approved style and key word:

```tsx
import { AbsoluteFill, Sequence } from "remotion";
import { KT_COMPONENTS } from "./kinetic-type";
import { C } from "./kinetic-type/kit";

const FPS = 30;
const HOUSE = "word-by-word-reveal"; // the approved house
const LINES = [
  // t and dur from type-script/<slug>.json; key and style from the approved choices
  { t: 0, dur: 4.5, text: "Every right-angled triangle hides a secret.", key: "hides", style: "house" },
  { t: 25, dur: 4.5, text: "But ONLY for right angles.", key: "ONLY", style: "slice" },
];

export const TypeVideo: React.FC = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    {LINES.map((l, i) => {
      const Comp = KT_COMPONENTS[l.style === "house" ? HOUSE : l.style];
      return (
        <Sequence key={i} from={Math.round(l.t * FPS)} durationInFrames={Math.round(l.dur * FPS)}>
          <Comp text={l.text} keyWord={l.key || undefined} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
```

- If a style isn't in `KT_COMPONENTS`, it's an `example` technique. Adapt the scene named in the menu for that line.
- Register it in `src/Root.tsx` as a `<Composition>` with the size, fps and length above. In a fresh project, it replaces the template's placeholder composition.

## 7. Preview, then render only when asked

- Check your own work first: render a still from the middle of a few lines (`npx remotion still <id> out/check.png --frame=<n>`) and look at them.
- Then let the user watch it: run `npx remotion studio --no-open` in the background (without `--no-open`, it also pops open their own web browser). Open the address it prints (normally `http://localhost:3000`) in the built-in browser.
- **Render only when they ask:** `npx remotion render <id> out/<slug>.mp4`.

If they want changes after watching, small ones go straight into the composition. For bigger ones, go back to step 4 with their choices folded in.
