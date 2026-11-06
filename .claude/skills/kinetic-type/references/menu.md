# Technique menu

<!-- GENERATED from assets/menu.js by scripts/build-menu.mjs. Edit menu.js, then re-run the script. -->

Every technique, grouped into families. Each name is followed by its id (the key used in `KT_COMPONENTS` and in type scripts).

- **calm**: a good house style, used for most lines.
- **teach**: a suggested accent in teaching mode, for key terms, answers and warnings.
- **exit**: the technique ends with the words gone, so it suits the end of a line or scene. The words are readable first, then destroyed by the last frame; zoom through a letter ends on a full frame of the accent colour.
- **✚ new**: added after the showcase videos.
- **build**: `component` = ready-made in `remotion/index.ts`; `example` = an annotated scene to adapt; `elsewhere` = needs After Effects or 3D software.

## 0 · The basics

The original 11 kinetic typography styles, plus a marker highlight.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Motion typography** `motion-typography`<br>also: motion type, dynamic layout | Whole words slide, scale, rotate or bounce into place; the letters themselves never change shape. | There's a narrator or a lyric and the words should move along with it. | component |
| **Fluid typography** `fluid-typography`<br>also: morphing type, metamorphosis | The letters themselves change shape — they morph, stretch, melt or turn into things. | One word deserves a 'wow' moment: a title, a logo reveal, a single big idea. | component |
| **Word-by-word reveal** `word-by-word-reveal` · calm<br>also: word-by-word, word pop-on | Each word appears at the exact moment the narrator says it. | A narrated script where the timing of each word matters — pauses and punchlines included. | component |
| **Camera-move typography** `camera-move-typography`<br>also: camera fly-through, infinite canvas | Phrases are laid out across a huge canvas and a virtual camera flies from one to the next. | Longer narration that should feel like one continuous, flowing shot. | example: `remotion/examples/camera-move-typography.tsx` |
| **Emphasis scaling** `emphasis-scaling` · teach<br>also: emphasis, size contrast | Important words grow bigger, bolder or coloured; quiet words shrink. | The text should sound like the voice — a shout, a whisper, a bit of sarcasm — on one or two key words. | component |
| **Marker highlight** `marker-highlight` · teach<br>also: highlighter, marker sweep | A highlighter bar sweeps in behind the key word, like a marker pen on paper. | One word in the line is the one to remember — a new term, an answer, a key idea. | component |
| **Physics-based** `physics-based` · teach<br>also: physics drop, gravity text | Words behave like objects with weight — they fall, bounce, stack and collide. | The words describe something physical or funny — if someone falls out of bed, so do the words. | component |
| **Typewriter / handwritten** `typewriter` · calm<br>also: typing, handwriting, letter by letter | Text appears letter by letter — typed, or drawn as if by hand. | Diaries, letters, quotes, or anything that should feel personal or nostalgic. | component |
| **Text-as-image** `text-as-image`<br>also: calligram, typographic illustration | Words are arranged into the shape of the thing they describe. | One memorable moment where the picture counts more than the sentence — a poster, a logo. | example: `remotion/examples/text-as-image.tsx` |
| **Glitch / distortion** `glitch`<br>also: digital glitch, RGB split | Text shakes, flickers, splits into red and blue copies and breaks into slices. | Something is wrong, broken or digital — tech, gaming, errors, horror. | component |
| **Masking and reveals** `masking-and-reveals` · calm<br>also: mask reveal, wipe, rise from behind an edge | Text is hidden behind an edge, a shape or a wipe, then revealed. | Clean, professional titles: documentary, corporate, lower-thirds. | component |
| **3D extrusion** `3d-extrusion`<br>also: 3D text, extruded type | Letters get depth like solid objects and turn around in 3D space. | A big title, logo or intro that should feel solid and heavy. | component |

## 1 · Letter choreography

Every letter does the same move, a beat apart. The backbone of letter-level type.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Cascade / stagger** `cascade` · calm<br>also: letter cascade, character offset | Every letter does the same move, each one starting a beat later. | Almost any title, when the letters should arrive with a bit of life. | component |
| **Random-order pop-on** `random-order-pop-on`<br>also: random pop-on, sparkle in | Letters pop in one at a time, in a shuffled order. | Something playful, magical or surprising appears. | component |
| **Wave / ripple** `wave`<br>also: ripple text, sine wave | Each letter bobs on a wave, slightly behind its neighbour. | Water, music, sound, or a relaxed, floaty mood. | component |
| **3D flip-in** `3d-flip-in`<br>also: card flip, per-character rotate-in | Letters turn over like cards, one after another. | A reveal that should feel like turning over an answer card. | component |
| **Tracking in** `tracking-in` · calm<br>also: tracking in / out, letter-spacing animation | Letters start far apart and slowly drift together — the movie-trailer look. | A calm, cinematic title that should feel big and important. | component |
| **Simple fade** `simple-fade` · calm<br>also: fade in | The whole line fades in gently, with no other movement. | The words should arrive quietly and let the content do the talking. | component |
| **Stomp** `stomp` · teach<br>also: slam, beat stomp | Words slam in hard on every beat. | A point needs punch — a strong claim, a countdown, a rhythm you want felt. | component |

## 2 · Cuts, slices and masks

Text cut by a line, shown in strips, or seen through a window.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Slice / cut** `slice` · teach<br>also: split text, slit text, sliced text | A line cuts the word; the two halves slide apart. | Something splits, breaks or is divided. | component |
| **Shred / strip reveal** `shred`<br>also: Venetian-blinds reveal, strips | The word arrives in thin strips from alternating sides. | A slick, energetic entrance, or a transition between scenes. | component |
| **Knockout / stencil** `knockout`<br>also: stencil, video inside letters | The letters are windows — a moving picture shows through them. | The word and an image belong together, and the title is the view into the scene. | component |
| **Zoom through a letter** `zoom-through-a-letter` · exit<br>also: fly through the O | The camera dives through the hole in a letter, like the O, into the next scene. | A title should lead straight into whatever comes next. | component |

## 3 · Breaking apart and building up

The letter itself is destroyed or built — from big shards down to tiny grains.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Shatter** `shatter` · exit<br>also: explode | The word cracks like glass and the pieces fly. | An impact moment — something breaks, ends or is proved wrong. | component |
| **Disintegrate / dust** `disintegrate` · exit<br>also: dust, Thanos snap | Letters erode into grains that drift away. | Something fades out of existence — gone, forgotten, over. | component |
| **Particle assemble** `particle-assemble`<br>also: particles in | Scattered dots fly in and settle into a word. | A key word should feel built up or discovered — a dramatic reveal. | component |

## 4 · Characters that change in place

Each letter keeps its slot — but what is in the slot changes.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Scramble / decode** `scramble` · teach<br>also: cipher, hacker text, Matrix text | Random characters lock into the real word one by one. | An answer, code or secret is being worked out or revealed. | component |
| **Odometer / rolling digits** `odometer`<br>also: rolling digits, slot machine | A strip of digits 0–9 rolls behind a window, like a car's mileage counter. | A number is changing or counting up — a statistic, a score, a result. | component |
| **Split-flap board** `split-flap-board`<br>also: Solari board, departures board | Hinged cards flip through the alphabet, like an airport departures board. | Travel, destinations, schedules, or an announcement with a retro feel. | component |
| **Anagram / letter rearrange** `anagram`<br>also: letter rearrange, magic move | The same letters glide to new places — LISTEN becomes SILENT. | Wordplay, or showing that one thing is secretly made of another. | component |

## 5 · Shape-shifting letters

Fluid typography in practice: the letter's own shape changes.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Variable-font breathing** `variable-font-breathing`<br>also: weight pulse, breathing type | A wave of boldness ripples through the word as the font's weight slider moves. | A word needs emphasis or a pulse on the beat without moving. | component |
| **Width stretch / slant lean** `width-stretch`<br>also: slant lean, width axis | The word goes thin, then wide, then leans forward, using the font's own sliders. | A word should feel like it's stretching, speeding up or leaning into action. | component |
| **Construction** `construction`<br>also: letter assembly, built from parts | A letter assembles itself from separate pieces. | Something is being built, put together or designed — logos and idents. | component |
| **Outline morph** `outline-morph`<br>also: metamorphosis, shape morph | Each letter starts as a different letter, and its outline melts like liquid into the real one. | You're showing one thing turning into another, or a word taking its final shape. | component |

## 6 · Warp and distortion

Letters bend, wave and wobble — but stay the same material.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Line boil** `line-boil`<br>also: boiling lines, wiggle | The edges shiver a few times a second, like hand-drawn animation. | Digital type should feel hand-drawn, alive or a little nervous. | component |
| **Flag wave** `flag-wave`<br>also: flag warp, wave warp | The word is cut into thin strips that each ride a wave, like a flag in the wind. | A dreamy, floaty mood, or anything about wind, water or flags. | component |
| **Bulge / magnify** `bulge`<br>also: magnify, lens | A lens passes over the word and swells whatever is under it. | You're zooming in on a detail or looking at something closely. | component |

## 7 · Line, light and shadow

Letters treated as lines to draw, or as objects light falls on.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Stroke write-on** `stroke-write-on` · teach<br>also: write-on, outline draws itself | The outline draws itself like a pen, then the colour fills in. | A word is being written, defined or drawn for the first time. | component |
| **Neon sign** `neon-sign`<br>also: neon flicker | Glowing tubes buzz on letter by letter, with a faulty flicker. | Night-time, city, diner or arcade moods. | component |
| **Light sweep** `light-sweep` · teach<br>also: shine, glint | A band of light slides across the word, like a reflection on metal. | A word should feel polished, valuable or finished — the final answer. | component |
| **Long shadow** `long-shadow`<br>also: flat shadow | A long diagonal shadow grows out of each letter. | Flat text should suddenly feel solid, for very little effort. | component |
| **Spotlight reveal** `spotlight-reveal`<br>also: spotlight | A circle of light roams the dark and finds the word. | Something hidden is searched for and found — a mystery, a big reveal. | component |

## 8 · Elemental materials

Letters made of, revealed by, or destroyed into a substance — liquid, ink, water, smoke.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Liquid fill** `liquid-fill`<br>also: fill up, progress fill | A wavy surface rises inside the letters, like water filling a glass. | Progress, percentages or something filling up. | component |
| **Ink bleed** `ink-bleed`<br>also: ink spread | The edges swell and roughen like ink soaking into paper. | A calm, organic or literary mood — writing, history, old letters. | component |
| **Water reflection** `water-reflection`<br>also: reflection | A flipped copy sits below the word, rippling as if on water. | A calm, peaceful or reflective moment. | component |
| **Smoke dissolve** `smoke-dissolve` · exit<br>also: smoke text | Letters swirl, blur and drift up until they're gone. | Something mysterious vanishes, or a thought drifts away. | component |

## 9 · 3D surfaces

What the letter is made of: chrome, foil, balloon — or wrapped onto a shape.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Chrome** `chrome`<br>also: liquid metal, mirror finish | A mirror-like metal look inside the letters, faked with a sky-and-ground gradient. | Big, shiny titles — music, retro-future, anything that should feel expensive. | component |
| **Holographic** `holographic`<br>also: iridescent, foil | A rainbow sheen slides across, like a foil sticker. | Fashion, collectables, or a playful, shiny brand feel. | component |
| **Inflated / puffy** `inflated`<br>also: puffy, balloon | Letters swell like balloons, with soft highlights that suggest roundness. | Playful, soft, toy-like or celebratory moments. | component |
| **Wrapped on a cylinder** `wrapped-on-a-cylinder`<br>also: cylinder wrap, text on a 3D shape | Each letter sits on a spinning circle in 3D, wrapping round like a label on a can. | Something rotates, cycles or repeats — or a title should feel tactile. | component |

## 10 · Screen and print looks

Type as if shown on a particular device or printed a particular way.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **LED board / dot-matrix** `led-board`<br>also: dot-matrix, LED | A grid of dots where only the ones inside the letters light up. | Sport scores, stations, transport or retro electronics. | component |
| **Pixelate reveal** `pixelate-reveal`<br>also: mosaic reveal, pixelate | Chunky blocks sharpen into crisp text as the grid gets finer. | Retro games, or something coming into focus or loading. | component |
| **Halftone** `halftone`<br>also: comic dots, Ben-Day dots | The word is rebuilt from dots — more ink, bigger dot — like comic-book printing. | A comic, pop-art or printed-poster feel. | component |
| **ASCII** `ascii`<br>also: ASCII art, text art | Each cell becomes a character: "." for light, "@" for dark. | Code, hacker or old-computer aesthetics. | component |
| **VHS / CRT** `vhs`<br>also: CRT, tape look, scanlines | Colour fringes, a rolling noise band and scanlines, like an 80s video tape. | Nostalgia, home videos, the 80s and 90s. | component |

## 11 · Hand-made and analogue

Visible human imperfection: paper, collage, film grain, chalk.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Ransom-note collage** `ransom-note-collage`<br>also: ransom note, cut-out letters | Every letter is cut from a different magazine, jittering in place. | Zines, punk, mystery or a DIY scrapbook feel. | component |
| **Paper stop-motion** `paper-stop-motion`<br>also: cut-paper stop-motion, stop-motion | Real-feeling paper cards that move at a choppy 8 frames a second. | Warm, crafty or childlike moments with a hand-made feel. | component |
| **Faux film** `faux-film`<br>also: film grain, old film | Grain, flicker, scratches and a wobbling frame, like old cinema. | History, nostalgia, silent-film comedy or a vintage title card. | component |
| **Chalk** `chalk`<br>also: chalkboard, pencil texture | Grainy strokes write themselves on, on a chalkboard. | Classroom moments, or a warm, hand-made feel. | component |

## 12 · Paths and geometry

Text that follows a line: a curve, a circle, a spiral.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Text on a path** `text-on-a-path`<br>also: path text, text on a curve | Letters ride along a curve — for example a sentence running along y = sin x. | An equation or label belongs on its own graph, or the words should follow a route. | component |
| **Circular badge** `circular-badge`<br>also: orbiting text, rotating badge | Words run round a circle that slowly rotates. | Badges, stamps, seals and calls to action. | component |
| **Spiral** `spiral`<br>also: vortex | Text flows inward along a spiral, closing in on the centre as it turns. | A dizzy or hypnotic moment, or something winding down to a single point. | component |

## 13 · Repetition, layout and loops

One word, many copies — trails, stacks, tunnels and endless loops.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Echo / trail** `echo`<br>also: trail, motion trail | Faded copies of the word show where it was a moment ago. | Speed, energy, or showing that something moved. | component |
| **Outline stack** `outline-stack`<br>also: outline repeater, repetition stack | The same word stacked in outline, like plates — depth on a budget. | A poster-style title that needs energy and depth. | component |
| **Text tunnel** `text-tunnel`<br>also: infinite zoom, tunnel | Copies of the word grow outward so they seem to fly at you forever. | Something feels endless or hypnotic — or you're showing exponential growth. | component |
| **Marquee / kinetic poster** `marquee`<br>also: ticker, kinetic poster | Bands of text scroll in opposite directions and wrap around in a seamless loop. | Social posters, banners, backgrounds and loops. | component |
| **Fit-to-box** `fit-to-box` · ✚ new<br>also: fit-to-box type, text fitting | Each word's size adjusts itself so it fills a rectangle exactly, edge to edge; when the box changes shape, the words re-fit. | A big statement or poster-style title should fill the frame wall to wall. | component |

## 14 · Text living inside footage

Type behaves as if it physically exists in the filmed world.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Match-moved title** `match-moved-title`<br>also: floating title, tracked title | The title sits at its own depth in the scene and moves with the camera, as if it's really there. | A title should feel part of the place — an opening shot, a location, a new chapter. | example: `remotion/examples/match-moved-title.tsx` |
| **Text behind subject** `text-behind-subject`<br>also: behind the subject | A person walks in front of the title — they're cut out and layered on top. | A title should feel part of the story, sitting in the world rather than on top of it. | example: `remotion/examples/text-behind-subject.tsx` |
| **Labels in the scene** `labels-in-the-scene`<br>also: HUD, annotations | Thin lines attach labels and measurements to a real object. | You're pointing out real things — measurements, maths on objects, the parts of something. | example: `remotion/examples/labels-in-the-scene.tsx` |

## 15 · Text driven by sound

Words appear, change colour or punch exactly on the syllable or the beat.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Word-highlight captions** `word-highlight-captions`<br>also: social captions, Hormozi-style captions | Two or three words at a time; the word being spoken pops. | Shorts and Reels, especially for viewers watching with the sound off. | component |
| **Karaoke sweep** `karaoke-sweep`<br>also: karaoke highlight, sing-along | Colour fills each word exactly as it's sung. | Lyric videos, sing-alongs or chants. | component |
| **Beat pulse** `beat-pulse`<br>also: audio-reactive text, beat sync | The word punches on every beat; its size follows the loudness. | Music intros, or anything cut to a beat. | component |

## 16 · Text as character, data and interface

Words that act like characters, form charts, or look like the apps we use every day.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Letters with personality** `letters-with-personality`<br>also: living letters, character type | The O's become eyes — words that blink, look around and flinch. | Storytelling, or a word that should react like a character. | example: `remotion/examples/letters-with-personality.tsx` |
| **Chart made of type** `chart-made-of-type`<br>also: type chart, typographic chart | Each bar is a word repeated; the length of the bar is the data. | Statistics and comparisons where the label and the number are the same thing. | example: `remotion/examples/chart-made-of-type.tsx` |
| **Chat bubbles** `chat-bubbles`<br>also: text messages, messaging screen | Messages pop in, with 'typing…' dots before each reply. | A conversation, a question someone might ask, or two sides of an argument. | example: `remotion/examples/chat-bubbles.tsx` |
| **Search-bar typing** `search-bar-typing`<br>also: search query, search box | A query types itself and suggestions drop down. | The 'what everyone asks' moment — a question people really search for. | example: `remotion/examples/search-bar-typing.tsx` |

## 17 · Code, interaction and AI

Type driven by formulas, data or the viewer.

| Name (aka) | Look | Reach for it when | Build |
|---|---|---|---|
| **Sine-wave type** `sine-wave-type`<br>also: oscillating type, sine type | Each letter's height comes from a formula, so you can see the trigonometry. | Maths should be visible — waves, functions, anything periodic. | component |
| **Cursor-reactive** `cursor-reactive`<br>also: mouse-reactive, interactive type | Letters near the mouse get heavier — a web effect, shown here as a fake. | An interactive web page, or a recording of one. | component |
| **Generative flow** `generative-flow`<br>also: flow field, generative type | The word is made of dots that a swirling flow field pushes around. | An art piece, an abstract opening, or showing forces and fields. | example: `remotion/examples/generative-flow.tsx` |
| **Scroll-linked** `scroll-linked`<br>also: scroll-driven type, scrollytelling | On a web page, the text builds up as the visitor scrolls. | An interactive lesson page or web story, or a recording of one. | component |
