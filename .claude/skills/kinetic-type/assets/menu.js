/*
 * The technique menu: the single source of truth for every kinetic type technique.
 *
 * Works two ways:
 *   - in a browser, as <script src="menu.js">, it sets window.KT_MENU and window.KT_FAMILIES
 *   - in Node, require("./menu.js") returns { KT_MENU, KT_FAMILIES }
 *
 * Each entry: { id, name, aka, family, calm, teach, exit, look, reachFor, build, example?, isNew }
 *   id       kebab-case of the name before any " / " (e.g. "Slice / cut" -> "slice")
 *   calm     suitable as a house style
 *   teach    suggested as an accent in teaching mode (never also calm)
 *   exit     the technique ends with the words gone (destroyed, or dived through)
 *   build    "component" (in remotion/index.ts), "example" (an annotated scene in
 *            remotion/examples/<id>.tsx) or "elsewhere" (After Effects / 3D)
 *   isNew    added after the showcase videos (marked ✚)
 *
 * After editing, run: node scripts/build-menu.mjs   (regenerates references/menu.md)
 */
(function (root) {
  "use strict";

  var KT_FAMILIES = [
    { num: 0, name: "The basics", gloss: "The original 11 kinetic typography styles, plus a marker highlight." },
    { num: 1, name: "Letter choreography", gloss: "Every letter does the same move, a beat apart. The backbone of letter-level type." },
    { num: 2, name: "Cuts, slices and masks", gloss: "Text cut by a line, shown in strips, or seen through a window." },
    { num: 3, name: "Breaking apart and building up", gloss: "The letter itself is destroyed or built — from big shards down to tiny grains." },
    { num: 4, name: "Characters that change in place", gloss: "Each letter keeps its slot — but what is in the slot changes." },
    { num: 5, name: "Shape-shifting letters", gloss: "Fluid typography in practice: the letter's own shape changes." },
    { num: 6, name: "Warp and distortion", gloss: "Letters bend, wave and wobble — but stay the same material." },
    { num: 7, name: "Line, light and shadow", gloss: "Letters treated as lines to draw, or as objects light falls on." },
    { num: 8, name: "Elemental materials", gloss: "Letters made of, revealed by, or destroyed into a substance — liquid, ink, water, smoke." },
    { num: 9, name: "3D surfaces", gloss: "What the letter is made of: chrome, foil, balloon — or wrapped onto a shape." },
    { num: 10, name: "Screen and print looks", gloss: "Type as if shown on a particular device or printed a particular way." },
    { num: 11, name: "Hand-made and analogue", gloss: "Visible human imperfection: paper, collage, film grain, chalk." },
    { num: 12, name: "Paths and geometry", gloss: "Text that follows a line: a curve, a circle, a spiral." },
    { num: 13, name: "Repetition, layout and loops", gloss: "One word, many copies — trails, stacks, tunnels and endless loops." },
    { num: 14, name: "Text living inside footage", gloss: "Type behaves as if it physically exists in the filmed world." },
    { num: 15, name: "Text driven by sound", gloss: "Words appear, change colour or punch exactly on the syllable or the beat." },
    { num: 16, name: "Text as character, data and interface", gloss: "Words that act like characters, form charts, or look like the apps we use every day." },
    { num: 17, name: "Code, interaction and AI", gloss: "Type driven by formulas, data or the viewer." },
  ];

  // Only the fields that differ from the defaults are written out; see DEFAULTS below.
  var ENTRIES = [
    // ── 0 · The basics ──────────────────────────────────────────────
    { id: "motion-typography", name: "Motion typography", aka: ["motion type", "dynamic layout"], family: 0,
      look: "Whole words slide, scale, rotate or bounce into place; the letters themselves never change shape.",
      reachFor: "There's a narrator or a lyric and the words should move along with it." },
    { id: "fluid-typography", name: "Fluid typography", aka: ["morphing type", "metamorphosis"], family: 0,
      look: "The letters themselves change shape — they morph, stretch, melt or turn into things.",
      reachFor: "One word deserves a 'wow' moment: a title, a logo reveal, a single big idea." },
    { id: "word-by-word-reveal", name: "Word-by-word reveal", aka: ["word-by-word", "word pop-on"], family: 0, calm: true,
      look: "Each word appears at the exact moment the narrator says it.",
      reachFor: "A narrated script where the timing of each word matters — pauses and punchlines included." },
    { id: "camera-move-typography", name: "Camera-move typography", aka: ["camera fly-through", "infinite canvas"], family: 0, build: "example",
      look: "Phrases are laid out across a huge canvas and a virtual camera flies from one to the next.",
      reachFor: "Longer narration that should feel like one continuous, flowing shot." },
    { id: "emphasis-scaling", name: "Emphasis scaling", aka: ["emphasis", "size contrast"], family: 0, teach: true,
      look: "Important words grow bigger, bolder or coloured; quiet words shrink.",
      reachFor: "The text should sound like the voice — a shout, a whisper, a bit of sarcasm — on one or two key words." },
    { id: "marker-highlight", name: "Marker highlight", aka: ["highlighter", "marker sweep"], family: 0, teach: true,
      look: "A highlighter bar sweeps in behind the key word, like a marker pen on paper.",
      reachFor: "One word in the line is the one to remember — a new term, an answer, a key idea." },
    { id: "physics-based", name: "Physics-based", aka: ["physics drop", "gravity text"], family: 0, teach: true,
      look: "Words behave like objects with weight — they fall, bounce, stack and collide.",
      reachFor: "The words describe something physical or funny — if someone falls out of bed, so do the words." },
    { id: "typewriter", name: "Typewriter / handwritten", aka: ["typing", "handwriting", "letter by letter"], family: 0, calm: true,
      look: "Text appears letter by letter — typed, or drawn as if by hand.",
      reachFor: "Diaries, letters, quotes, or anything that should feel personal or nostalgic." },
    { id: "text-as-image", name: "Text-as-image", aka: ["calligram", "typographic illustration"], family: 0, build: "example",
      look: "Words are arranged into the shape of the thing they describe.",
      reachFor: "One memorable moment where the picture counts more than the sentence — a poster, a logo." },
    { id: "glitch", name: "Glitch / distortion", aka: ["digital glitch", "RGB split"], family: 0,
      look: "Text shakes, flickers, splits into red and blue copies and breaks into slices.",
      reachFor: "Something is wrong, broken or digital — tech, gaming, errors, horror." },
    { id: "masking-and-reveals", name: "Masking and reveals", aka: ["mask reveal", "wipe", "rise from behind an edge"], family: 0, calm: true,
      look: "Text is hidden behind an edge, a shape or a wipe, then revealed.",
      reachFor: "Clean, professional titles: documentary, corporate, lower-thirds." },
    { id: "3d-extrusion", name: "3D extrusion", aka: ["3D text", "extruded type"], family: 0,
      look: "Letters get depth like solid objects and turn around in 3D space.",
      reachFor: "A big title, logo or intro that should feel solid and heavy." },

    // ── 1 · Letter choreography ─────────────────────────────────────
    { id: "cascade", name: "Cascade / stagger", aka: ["letter cascade", "character offset"], family: 1, calm: true,
      look: "Every letter does the same move, each one starting a beat later.",
      reachFor: "Almost any title, when the letters should arrive with a bit of life." },
    { id: "random-order-pop-on", name: "Random-order pop-on", aka: ["random pop-on", "sparkle in"], family: 1,
      look: "Letters pop in one at a time, in a shuffled order.",
      reachFor: "Something playful, magical or surprising appears." },
    { id: "wave", name: "Wave / ripple", aka: ["ripple text", "sine wave"], family: 1,
      look: "Each letter bobs on a wave, slightly behind its neighbour.",
      reachFor: "Water, music, sound, or a relaxed, floaty mood." },
    { id: "3d-flip-in", name: "3D flip-in", aka: ["card flip", "per-character rotate-in"], family: 1,
      look: "Letters turn over like cards, one after another.",
      reachFor: "A reveal that should feel like turning over an answer card." },
    { id: "tracking-in", name: "Tracking in", aka: ["tracking in / out", "letter-spacing animation"], family: 1, calm: true,
      look: "Letters start far apart and slowly drift together — the movie-trailer look.",
      reachFor: "A calm, cinematic title that should feel big and important." },
    { id: "simple-fade", name: "Simple fade", aka: ["fade in"], family: 1, calm: true,
      look: "The whole line fades in gently, with no other movement.",
      reachFor: "The words should arrive quietly and let the content do the talking." },
    { id: "stomp", name: "Stomp", aka: ["slam", "beat stomp"], family: 1, teach: true,
      look: "Words slam in hard on every beat.",
      reachFor: "A point needs punch — a strong claim, a countdown, a rhythm you want felt." },

    // ── 2 · Cuts, slices and masks ──────────────────────────────────
    { id: "slice", name: "Slice / cut", aka: ["split text", "slit text", "sliced text"], family: 2, teach: true,
      look: "A line cuts the word; the two halves slide apart.",
      reachFor: "Something splits, breaks or is divided." },
    { id: "shred", name: "Shred / strip reveal", aka: ["Venetian-blinds reveal", "strips"], family: 2,
      look: "The word arrives in thin strips from alternating sides.",
      reachFor: "A slick, energetic entrance, or a transition between scenes." },
    { id: "knockout", name: "Knockout / stencil", aka: ["stencil", "video inside letters"], family: 2,
      look: "The letters are windows — a moving picture shows through them.",
      reachFor: "The word and an image belong together, and the title is the view into the scene." },
    { id: "zoom-through-a-letter", name: "Zoom through a letter", aka: ["fly through the O"], family: 2, exit: true,
      look: "The camera dives through the hole in a letter, like the O, into the next scene.",
      reachFor: "A title should lead straight into whatever comes next." },

    // ── 3 · Breaking apart and building up ──────────────────────────
    { id: "shatter", name: "Shatter", aka: ["explode"], family: 3, exit: true,
      look: "The word cracks like glass and the pieces fly.",
      reachFor: "An impact moment — something breaks, ends or is proved wrong." },
    { id: "disintegrate", name: "Disintegrate / dust", aka: ["dust", "Thanos snap"], family: 3, exit: true,
      look: "Letters erode into grains that drift away.",
      reachFor: "Something fades out of existence — gone, forgotten, over." },
    { id: "particle-assemble", name: "Particle assemble", aka: ["particles in"], family: 3,
      look: "Scattered dots fly in and settle into a word.",
      reachFor: "A key word should feel built up or discovered — a dramatic reveal." },

    // ── 4 · Characters that change in place ─────────────────────────
    { id: "scramble", name: "Scramble / decode", aka: ["cipher", "hacker text", "Matrix text"], family: 4, teach: true,
      look: "Random characters lock into the real word one by one.",
      reachFor: "An answer, code or secret is being worked out or revealed." },
    { id: "odometer", name: "Odometer / rolling digits", aka: ["rolling digits", "slot machine"], family: 4,
      look: "A strip of digits 0–9 rolls behind a window, like a car's mileage counter.",
      reachFor: "A number is changing or counting up — a statistic, a score, a result." },
    { id: "split-flap-board", name: "Split-flap board", aka: ["Solari board", "departures board"], family: 4,
      look: "Hinged cards flip through the alphabet, like an airport departures board.",
      reachFor: "Travel, destinations, schedules, or an announcement with a retro feel." },
    { id: "anagram", name: "Anagram / letter rearrange", aka: ["letter rearrange", "magic move"], family: 4,
      look: "The same letters glide to new places — LISTEN becomes SILENT.",
      reachFor: "Wordplay, or showing that one thing is secretly made of another." },

    // ── 5 · Shape-shifting letters ──────────────────────────────────
    { id: "variable-font-breathing", name: "Variable-font breathing", aka: ["weight pulse", "breathing type"], family: 5,
      look: "A wave of boldness ripples through the word as the font's weight slider moves.",
      reachFor: "A word needs emphasis or a pulse on the beat without moving." },
    { id: "width-stretch", name: "Width stretch / slant lean", aka: ["slant lean", "width axis"], family: 5,
      look: "The word goes thin, then wide, then leans forward, using the font's own sliders.",
      reachFor: "A word should feel like it's stretching, speeding up or leaning into action." },
    { id: "construction", name: "Construction", aka: ["letter assembly", "built from parts"], family: 5,
      look: "A letter assembles itself from separate pieces.",
      reachFor: "Something is being built, put together or designed — logos and idents." },
    { id: "outline-morph", name: "Outline morph", aka: ["metamorphosis", "shape morph"], family: 5,
      look: "Each letter starts as a different letter, and its outline melts like liquid into the real one.",
      reachFor: "You're showing one thing turning into another, or a word taking its final shape." },

    // ── 6 · Warp and distortion ─────────────────────────────────────
    { id: "line-boil", name: "Line boil", aka: ["boiling lines", "wiggle"], family: 6,
      look: "The edges shiver a few times a second, like hand-drawn animation.",
      reachFor: "Digital type should feel hand-drawn, alive or a little nervous." },
    { id: "flag-wave", name: "Flag wave", aka: ["flag warp", "wave warp"], family: 6,
      look: "The word is cut into thin strips that each ride a wave, like a flag in the wind.",
      reachFor: "A dreamy, floaty mood, or anything about wind, water or flags." },
    { id: "bulge", name: "Bulge / magnify", aka: ["magnify", "lens"], family: 6,
      look: "A lens passes over the word and swells whatever is under it.",
      reachFor: "You're zooming in on a detail or looking at something closely." },

    // ── 7 · Line, light and shadow ──────────────────────────────────
    { id: "stroke-write-on", name: "Stroke write-on", aka: ["write-on", "outline draws itself"], family: 7, teach: true,
      look: "The outline draws itself like a pen, then the colour fills in.",
      reachFor: "A word is being written, defined or drawn for the first time." },
    { id: "neon-sign", name: "Neon sign", aka: ["neon flicker"], family: 7,
      look: "Glowing tubes buzz on letter by letter, with a faulty flicker.",
      reachFor: "Night-time, city, diner or arcade moods." },
    { id: "light-sweep", name: "Light sweep", aka: ["shine", "glint"], family: 7, teach: true,
      look: "A band of light slides across the word, like a reflection on metal.",
      reachFor: "A word should feel polished, valuable or finished — the final answer." },
    { id: "long-shadow", name: "Long shadow", aka: ["flat shadow"], family: 7,
      look: "A long diagonal shadow grows out of each letter.",
      reachFor: "Flat text should suddenly feel solid, for very little effort." },
    { id: "spotlight-reveal", name: "Spotlight reveal", aka: ["spotlight"], family: 7,
      look: "A circle of light roams the dark and finds the word.",
      reachFor: "Something hidden is searched for and found — a mystery, a big reveal." },

    // ── 8 · Elemental materials ─────────────────────────────────────
    { id: "liquid-fill", name: "Liquid fill", aka: ["fill up", "progress fill"], family: 8,
      look: "A wavy surface rises inside the letters, like water filling a glass.",
      reachFor: "Progress, percentages or something filling up." },
    { id: "ink-bleed", name: "Ink bleed", aka: ["ink spread"], family: 8,
      look: "The edges swell and roughen like ink soaking into paper.",
      reachFor: "A calm, organic or literary mood — writing, history, old letters." },
    { id: "water-reflection", name: "Water reflection", aka: ["reflection"], family: 8,
      look: "A flipped copy sits below the word, rippling as if on water.",
      reachFor: "A calm, peaceful or reflective moment." },
    { id: "smoke-dissolve", name: "Smoke dissolve", aka: ["smoke text"], family: 8, exit: true,
      look: "Letters swirl, blur and drift up until they're gone.",
      reachFor: "Something mysterious vanishes, or a thought drifts away." },

    // ── 9 · 3D surfaces ─────────────────────────────────────────────
    { id: "chrome", name: "Chrome", aka: ["liquid metal", "mirror finish"], family: 9,
      look: "A mirror-like metal look inside the letters, faked with a sky-and-ground gradient.",
      reachFor: "Big, shiny titles — music, retro-future, anything that should feel expensive." },
    { id: "holographic", name: "Holographic", aka: ["iridescent", "foil"], family: 9,
      look: "A rainbow sheen slides across, like a foil sticker.",
      reachFor: "Fashion, collectables, or a playful, shiny brand feel." },
    { id: "inflated", name: "Inflated / puffy", aka: ["puffy", "balloon"], family: 9,
      look: "Letters swell like balloons, with soft highlights that suggest roundness.",
      reachFor: "Playful, soft, toy-like or celebratory moments." },
    { id: "wrapped-on-a-cylinder", name: "Wrapped on a cylinder", aka: ["cylinder wrap", "text on a 3D shape"], family: 9,
      look: "Each letter sits on a spinning circle in 3D, wrapping round like a label on a can.",
      reachFor: "Something rotates, cycles or repeats — or a title should feel tactile." },

    // ── 10 · Screen and print looks ─────────────────────────────────
    { id: "led-board", name: "LED board / dot-matrix", aka: ["dot-matrix", "LED"], family: 10,
      look: "A grid of dots where only the ones inside the letters light up.",
      reachFor: "Sport scores, stations, transport or retro electronics." },
    { id: "pixelate-reveal", name: "Pixelate reveal", aka: ["mosaic reveal", "pixelate"], family: 10,
      look: "Chunky blocks sharpen into crisp text as the grid gets finer.",
      reachFor: "Retro games, or something coming into focus or loading." },
    { id: "halftone", name: "Halftone", aka: ["comic dots", "Ben-Day dots"], family: 10,
      look: "The word is rebuilt from dots — more ink, bigger dot — like comic-book printing.",
      reachFor: "A comic, pop-art or printed-poster feel." },
    { id: "ascii", name: "ASCII", aka: ["ASCII art", "text art"], family: 10,
      look: "Each cell becomes a character: \".\" for light, \"@\" for dark.",
      reachFor: "Code, hacker or old-computer aesthetics." },
    { id: "vhs", name: "VHS / CRT", aka: ["CRT", "tape look", "scanlines"], family: 10,
      look: "Colour fringes, a rolling noise band and scanlines, like an 80s video tape.",
      reachFor: "Nostalgia, home videos, the 80s and 90s." },

    // ── 11 · Hand-made and analogue ─────────────────────────────────
    { id: "ransom-note-collage", name: "Ransom-note collage", aka: ["ransom note", "cut-out letters"], family: 11,
      look: "Every letter is cut from a different magazine, jittering in place.",
      reachFor: "Zines, punk, mystery or a DIY scrapbook feel." },
    { id: "paper-stop-motion", name: "Paper stop-motion", aka: ["cut-paper stop-motion", "stop-motion"], family: 11,
      look: "Real-feeling paper cards that move at a choppy 8 frames a second.",
      reachFor: "Warm, crafty or childlike moments with a hand-made feel." },
    { id: "faux-film", name: "Faux film", aka: ["film grain", "old film"], family: 11,
      look: "Grain, flicker, scratches and a wobbling frame, like old cinema.",
      reachFor: "History, nostalgia, silent-film comedy or a vintage title card." },
    { id: "chalk", name: "Chalk", aka: ["chalkboard", "pencil texture"], family: 11,
      look: "Grainy strokes write themselves on, on a chalkboard.",
      reachFor: "Classroom moments, or a warm, hand-made feel." },

    // ── 12 · Paths and geometry ─────────────────────────────────────
    { id: "text-on-a-path", name: "Text on a path", aka: ["path text", "text on a curve"], family: 12,
      look: "Letters ride along a curve — for example a sentence running along y = sin x.",
      reachFor: "An equation or label belongs on its own graph, or the words should follow a route." },
    { id: "circular-badge", name: "Circular badge", aka: ["orbiting text", "rotating badge"], family: 12,
      look: "Words run round a circle that slowly rotates.",
      reachFor: "Badges, stamps, seals and calls to action." },
    { id: "spiral", name: "Spiral", aka: ["vortex"], family: 12,
      look: "Text flows inward along a spiral, closing in on the centre as it turns.",
      reachFor: "A dizzy or hypnotic moment, or something winding down to a single point." },

    // ── 13 · Repetition, layout and loops ───────────────────────────
    { id: "echo", name: "Echo / trail", aka: ["trail", "motion trail"], family: 13,
      look: "Faded copies of the word show where it was a moment ago.",
      reachFor: "Speed, energy, or showing that something moved." },
    { id: "outline-stack", name: "Outline stack", aka: ["outline repeater", "repetition stack"], family: 13,
      look: "The same word stacked in outline, like plates — depth on a budget.",
      reachFor: "A poster-style title that needs energy and depth." },
    { id: "text-tunnel", name: "Text tunnel", aka: ["infinite zoom", "tunnel"], family: 13,
      look: "Copies of the word grow outward so they seem to fly at you forever.",
      reachFor: "Something feels endless or hypnotic — or you're showing exponential growth." },
    { id: "marquee", name: "Marquee / kinetic poster", aka: ["ticker", "kinetic poster"], family: 13,
      look: "Bands of text scroll in opposite directions and wrap around in a seamless loop.",
      reachFor: "Social posters, banners, backgrounds and loops." },
    { id: "fit-to-box", name: "Fit-to-box", aka: ["fit-to-box type", "text fitting"], family: 13, isNew: true,
      look: "Each word's size adjusts itself so it fills a rectangle exactly, edge to edge; when the box changes shape, the words re-fit.",
      reachFor: "A big statement or poster-style title should fill the frame wall to wall." },

    // ── 14 · Text living inside footage ─────────────────────────────
    { id: "match-moved-title", name: "Match-moved title", aka: ["floating title", "tracked title"], family: 14, build: "example",
      look: "The title sits at its own depth in the scene and moves with the camera, as if it's really there.",
      reachFor: "A title should feel part of the place — an opening shot, a location, a new chapter." },
    { id: "text-behind-subject", name: "Text behind subject", aka: ["behind the subject"], family: 14, build: "example",
      look: "A person walks in front of the title — they're cut out and layered on top.",
      reachFor: "A title should feel part of the story, sitting in the world rather than on top of it." },
    { id: "labels-in-the-scene", name: "Labels in the scene", aka: ["HUD", "annotations"], family: 14, build: "example",
      look: "Thin lines attach labels and measurements to a real object.",
      reachFor: "You're pointing out real things — measurements, maths on objects, the parts of something." },

    // ── 15 · Text driven by sound ───────────────────────────────────
    { id: "word-highlight-captions", name: "Word-highlight captions", aka: ["social captions", "Hormozi-style captions"], family: 15,
      look: "Two or three words at a time; the word being spoken pops.",
      reachFor: "Shorts and Reels, especially for viewers watching with the sound off." },
    { id: "karaoke-sweep", name: "Karaoke sweep", aka: ["karaoke highlight", "sing-along"], family: 15,
      look: "Colour fills each word exactly as it's sung.",
      reachFor: "Lyric videos, sing-alongs or chants." },
    { id: "beat-pulse", name: "Beat pulse", aka: ["audio-reactive text", "beat sync"], family: 15,
      look: "The word punches on every beat; its size follows the loudness.",
      reachFor: "Music intros, or anything cut to a beat." },

    // ── 16 · Text as character, data and interface ──────────────────
    { id: "letters-with-personality", name: "Letters with personality", aka: ["living letters", "character type"], family: 16, build: "example",
      look: "The O's become eyes — words that blink, look around and flinch.",
      reachFor: "Storytelling, or a word that should react like a character." },
    { id: "chart-made-of-type", name: "Chart made of type", aka: ["type chart", "typographic chart"], family: 16, build: "example",
      look: "Each bar is a word repeated; the length of the bar is the data.",
      reachFor: "Statistics and comparisons where the label and the number are the same thing." },
    { id: "chat-bubbles", name: "Chat bubbles", aka: ["text messages", "messaging screen"], family: 16, build: "example",
      look: "Messages pop in, with 'typing…' dots before each reply.",
      reachFor: "A conversation, a question someone might ask, or two sides of an argument." },
    { id: "search-bar-typing", name: "Search-bar typing", aka: ["search query", "search box"], family: 16, build: "example",
      look: "A query types itself and suggestions drop down.",
      reachFor: "The 'what everyone asks' moment — a question people really search for." },

    // ── 17 · Code, interaction and AI ───────────────────────────────
    { id: "sine-wave-type", name: "Sine-wave type", aka: ["oscillating type", "sine type"], family: 17,
      look: "Each letter's height comes from a formula, so you can see the trigonometry.",
      reachFor: "Maths should be visible — waves, functions, anything periodic." },
    { id: "cursor-reactive", name: "Cursor-reactive", aka: ["mouse-reactive", "interactive type"], family: 17,
      look: "Letters near the mouse get heavier — a web effect, shown here as a fake.",
      reachFor: "An interactive web page, or a recording of one." },
    { id: "generative-flow", name: "Generative flow", aka: ["flow field", "generative type"], family: 17, build: "example",
      look: "The word is made of dots that a swirling flow field pushes around.",
      reachFor: "An art piece, an abstract opening, or showing forces and fields." },
    { id: "scroll-linked", name: "Scroll-linked", aka: ["scroll-driven type", "scrollytelling"], family: 17,
      look: "On a web page, the text builds up as the visitor scrolls.",
      reachFor: "An interactive lesson page or web story, or a recording of one." },
  ];

  var DEFAULTS = { aka: [], calm: false, teach: false, exit: false, build: "component", isNew: false };

  var KT_MENU = ENTRIES.map(function (e) {
    var entry = Object.assign({}, DEFAULTS, e);
    if (entry.build === "example" && !entry.example) entry.example = "remotion/examples/" + entry.id + ".tsx";
    return entry;
  });

  if (typeof module === "object" && module.exports) module.exports = { KT_MENU: KT_MENU, KT_FAMILIES: KT_FAMILIES };
  if (root) {
    root.KT_MENU = KT_MENU;
    root.KT_FAMILIES = KT_FAMILIES;
  }
})(typeof window !== "undefined" ? window : null);
