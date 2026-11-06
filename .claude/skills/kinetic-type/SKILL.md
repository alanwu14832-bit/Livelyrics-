---
name: kinetic-type
description: Use whenever words will appear on screen in a video - a title or intro, captions or subtitles, lower-thirds, labels, formulas, key terms, quotes, a lyric video or any kinetic typography - in Remotion or any other video tool, even when the user never says "typography". Puts the full range of text-animation techniques in front of you (slice, scramble, stomp, stroke write-on, marker highlight, odometer and about 75 more) so you choose by what the words mean instead of defaulting to fade, slide or pop. Includes ready-made Remotion components. For a whole kinetic-typography video made from a script, or when the user wants to plan and approve the type line by line, the kinetic-type-director skill runs the full process and builds on this one.
---

# Kinetic type

When words go on screen in a video, the first moves that come to mind are fade, slide and pop. They are fine, but they are the default, not a choice. This skill puts the full range in front of you, about 80 techniques in 18 families, so the choice is a real one.

It reminds; it doesn't direct. It adds no steps, pages or approvals to the job you were asked to do.

## Creative freedom first

Everything here is a default or a suggestion, never a rule. When a moment calls for something else, break the default and say why in one sentence (in your plan, a code comment or your reply). Techniques that aren't on the menu are fair game too. The menu exists to widen your options, not to box you in.

## Choose per moment, by meaning

Read the words before deciding how they move. Ask what the line is *doing*, then pick the technique whose meaning matches:

| The words... | Reach for |
|---|---|
| split, break or divide something | `slice`, `shatter` |
| work out an answer or reveal a secret | `scramble` |
| land with force, or count down | `stomp` |
| define or write a term for the first time | `stroke-write-on`, `marker-highlight` |
| show a number changing | `odometer` |
| describe something vanishing | `disintegrate`, `smoke-dissolve` |
| follow a graph or equation | `text-on-a-path`, `sine-wave-type` |

The "Reach for it when" column in the menu is written for exactly this question.

## How much variety

- **Teaching mode** (the default for lessons and explainers, and whenever the request doesn't say): one **house style** for every ordinary line, chosen from the techniques tagged **calm**, plus a **few accents** saved for the moments that matter: a key term, the answer, a warning. Techniques tagged **teach** make good accents. Few accents land harder than many.
- **Free rein** when the user asks for it ("be creative", "go wild", "surprise me"): anything on the menu is open, still chosen by meaning. Freedom doesn't mean using many. One bold, well-chosen technique can beat ten.
- If the video clearly isn't a lesson (a music video, a trailer) and no mode is named, choose what fits and say which way you went.

## Finishing touches and checks

- **Motion blur on fast moves.** Computer animation is perfectly sharp, so fast type can look jumpy. A little blur along the direction of travel makes it look filmed. Remotion has motion-blur tools (`@remotion/motion-blur`); install it at exactly the project's Remotion version, the same way as the packages under "Building it in Remotion" (`npm i -E @remotion/motion-blur@<version>`). Use it as a finishing touch on fast moves; on slow drifts it just looks out of focus.
- **Joined-up scripts break letter-level effects.** In Arabic, Persian and other scripts where a letter's shape depends on its neighbours, splitting a word into letters (cascade, scramble, anagram, random-order pop-on, 3D flip-in) breaks the letterforms. Animate whole words or lines instead.
- **Check the font has your accents.** For Afrikaans and other accented Latin text, make sure the font has the letters you need (ê, ë, ô, ï...) before animating them.

## Using the menu

Open `references/menu.md` (in this skill's folder) before choosing. It lists every technique, grouped into families, with:

- its name and **id** (the key in `KT_COMPONENTS`)
- a one-line **look** and a **reach for it when** cue
- tags: **calm** (a good house style), **teach** (a good teaching accent), **exit** (ends with the words gone, so it suits the end of a line or scene), **✚ new**
- how it's **built**: `component` (ready-made), or `example` (an annotated scene to adapt, path given)

Skim the family headings, then read the rows in the families that fit the moment.

`references/catalogue.md` is background reading: the research behind the menu, with sources, history and how hard each technique is to build. Open it only when you want depth.

## Building it in Remotion

1. Copy the `remotion/` folder from this skill's folder into the project as `src/kinetic-type/`.
2. Make sure the project has `remotion`, `@remotion/google-fonts` and `@remotion/layout-utils`, all at **exactly the project's Remotion version** (Remotion expects all its packages on one version). For example, on 4.0.536: `npm i -E @remotion/layout-utils@4.0.536` (`-E` saves the exact version instead of `^4.0.536`).
3. Look up a component by its menu id and render it inside a `<Sequence>`:

```tsx
import { Sequence } from "remotion";
import { KT_COMPONENTS } from "./kinetic-type";

const House = KT_COMPONENTS["tracking-in"];
const Accent = KT_COMPONENTS["slice"];

export const Intro: React.FC = () => (
  <>
    <Sequence durationInFrames={75}>
      <House text="Every whole can be shared" />
    </Sequence>
    <Sequence from={75} durationInFrames={60}>
      <Accent text="Split it in half" keyWord="half" />
    </Sequence>
  </>
);
```

- **Props** (`KTProps`): `text` (required), `keyWord` (gets the accent treatment), `fontFamily` (default Poppins), `color`, `accent`, `fontSize` (default fits the frame width).
- Each component starts at frame 0 of its `<Sequence>` and settles within about a second, so the Sequence's length sets how long the words stay. Two kinds behave differently: **exit** techniques end with the words gone by the Sequence's last frame, and the sound-paced ones (family 15) spread the words across the whole Sequence, so its length sets their pace.
- For `example` techniques, open the file named in the menu and adapt the scene.
- Other video tools: the menu and the way of choosing still apply; the ready-made components are Remotion only.

## See them, or direct a whole video

- **Gallery:** every technique with a live preview, at https://dricosnyman.github.io/kinetic-type-skills/
- **A whole video, or line-by-line direction:** when the job is a whole kinetic-typography video made from a script, or the user wants to plan, review and approve the typography of each line before anything is built, use the `kinetic-type-director` skill. It runs the full process and builds on this skill: it drafts a type script, shows it on a page they can edit, then builds the approved version with these components.
