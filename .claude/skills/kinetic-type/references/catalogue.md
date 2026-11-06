> **Background reading.** The research behind `menu.md`, kept for depth and sources. Nothing here is a rule the skill asks you to follow, including the reading-time figures.

# Slice, Scramble, Shatter: Kinetic Type's Full Toolbox

Your original 11 techniques are the trunk of the tree. The research found **well over 100 more named techniques**, and they sort into **17 families**. Slicing a word is one of them. So are scrambling letters until they "decode", rolling digits like an odometer, letters that swell and thin as if breathing, neon that flickers on, type that sticks to a wall in live footage, captions that light up word by word, and words that crumble into dust. Most of the new techniques mix three choices you can learn on their own. The first is **what unit moves**: the whole line, a word, or a single letter. The second is **what changes**: position, the letter's shape, its material, or how many copies there are. The third is **what drives the timing**: the clock, the music or voice, the camera, or the viewer. The clearest expert framework is Barbara Brownie's. She splits **motion typography**, where letters travel, from **fluid typography**, where the letters themselves change shape ([Wikipedia](https://en.wikipedia.org/wiki/Kinetic_typography)). That split also shows you which tool to use. Roughly half the catalogue is easy in Remotion, because it comes down to moving and clipping text with frame maths. Materials, particles, 3D surfaces and text tracked into live footage are still much easier in After Effects or 3D software. Three rules hold everything together: **easing** (natural speeding up and slowing down), **reading time of about 3 words per second**, and **no more than 3 flashes in any one second**.

> **Update, 16 October 2026.** A sweep of kinetic-typography projects on GitHub added four entries, marked **✚**: fit-to-box type (family 13), motion blur and the joined-up-script limit (in "The rules underneath"), and research AI that generates animated type (family 17).

## Experts sort kinetic type by behaviour, not by look

Academics call text that changes over time **temporal typography**. A useful first distinction is between kinetic typography and **serial presentation**. In serial presentation, still text cards simply follow one another, as in the scrolling credits of *The Sopranos* ([Wikipedia](https://en.wikipedia.org/wiki/Kinetic_typography)). The researcher Y. Y. Wong argued that moving type should be classified by **behaviour (how it moves), not appearance (font, colour)** ([Wikipedia](https://en.wikipedia.org/wiki/Kinetic_typography)). Barbara Brownie built on that idea.

**Brownie's two branches:**

| Branch | What happens | Sub-types | Her examples |
|---|---|---|---|
| **Motion typography** | Whole letters or words travel around the frame. | **Scrolling** (like the *Star Wars* crawl) and **dynamic layout**, where words move relative to each other in 2D or 3D. | Most title sequences |
| **Fluid typography** | The letter's shape changes, often without the letter going anywhere. | **Construction**: the letter is built from parts. | Channel 4's "4" idents, where the 4 is assembled from flying blocks |
| | | **Metamorphosis**: one form reshapes into another. | Eduardo Kac's *Astray in Deimos*, where "EERIE" becomes "MIST" |
| | | **Revelation**: the shape already exists but stays hidden until the viewpoint changes. | Kac's *Multiple* |

Sources: [Fusion Journal](https://fusion-journal.com/issue/001-fusion/fluid-characters-in-temporal-typography/) for the sub-types and examples. A 2013 paper of hers adds a fourth sub-type, **convergence** ([UH Research Archive](https://uhra.herts.ac.uk/id/eprint/22234/)). Our research saw only the abstract, so how convergence differs from construction is unconfirmed.

Brownie's key idea is the difference between **global** change and **local** change. Global change is about where whole words sit and move. Local change is about what happens inside a single letter. Her book *Transforming Type* (Bloomsbury, 2014) is the main text on this, with chapters on legibility and on reactive and generative type ([UH Research Archive](https://uhra.herts.ac.uk/handle/2299/15883)).

The older picture-books by Bellantoni and Woolman (*Type in Motion*, 1999) use a looser umbrella. They call it "moving type": type that "moves, transforms, mutates, duplicates, blurs, or interacts". Brownie criticises them for sorting examples **by medium rather than behaviour** ([Fusion Journal](https://fusion-journal.com/issue/001-fusion/fluid-characters-in-temporal-typography/)). Carnegie Mellon's *Kinetic Typography Engine* (UIST 2002) treated effects as small **behaviours that you chain together**. It reproduced more than 30 professional examples that way ([CMU](https://www.cs.cmu.edu/~johnny/kt)). That is close to how you would build a library of reusable Remotion components.

**A working map for you.** This combines the sources above.

| Level | What it is | Examples |
|---|---|---|
| 1. Serial presentation | Cards appear one after another | Word-by-word slides |
| 2. Motion typography | Units travel | Most of families 1–4 and 12–13 below |
| 3. Fluid typography | Letters change shape, material or look | Families 5–11 |
| 4. Reactive or contextual | Type responds to footage, sound, data or the viewer | Families 14–17 |

Two more choices run across all four levels. One is the **unit you animate** (block, line, word or letter). The other is the **property you animate**:

| Kind of property | Examples |
|---|---|
| Spatial | Position, scale, rotation, skew, camera |
| Visual | Opacity, colour, blur, stroke versus fill, masks, texture |
| Typographic | Tracking, weight, width, slant |
| Shape | The outline itself |
| Temporal | Stagger, hold time, rhythm, audio sync |
| Count | Echoes, duplicates, character swaps |

Industry practitioners don't use any of these frameworks. They name effects by how they look ("typewriter", "mask reveal", "scramble"). The catalogue below uses those everyday names, sorted into behaviour-based families.

## How to read the catalogue

**Key to the "Remotion" column.** These ratings are my own judgement, based on the build methods in the sources. They are not a published scale.

| Rating | Meaning |
|---|---|
| **Easy** | A few lines of frame maths: `interpolate()` or `spring()` driving CSS transforms, opacity or `clip-path` on `<span>`s |
| **Medium** | Needs one extra ingredient: SVG paths or filters, measuring text, audio data, seeded randomness, or overlay footage |
| **Hard** | Possible in code but fiddly, e.g. path morphing, shaders, particles, `@remotion/three` |
| **AE** | Far easier in After Effects or a plugin. Render it there and drop the clip into Remotion |
| **3D** | Needs Blender, Cinema 4D or a camera tracker for a convincing result |
| **Web** | Driven by the viewer's scroll or mouse. It doesn't exist in a rendered video, though you can fake the look |
| **Camera** | Made physically (paper, objects) and filmed |

**Two marks to watch for:**

- Rows in *italics* starting **ORIGINAL 11** are techniques you already know. They're included so you can see where they fit. Every other row is new.
- **†** marks a technique the researchers listed from common practice but could not tie to a source. It is plausible and widely named, but treat the details as unconfirmed.

**Words you'll meet** (each one explained once here):

| Term | Plain meaning |
|---|---|
| **Keyframe** | A value pinned at a moment in time. The software fills in the in-between frames. |
| **Easing** | How a movement speeds up and slows down instead of moving at constant speed. |
| **Stagger / offset** | Every letter does the same move, each starting a little later than the one before. |
| **Mask / `clip-path`** | A shape that hides everything outside it, like a stencil. |
| **Track matte** | In After Effects: one layer used as a stencil for the layer below. |
| **Precomp** | In After Effects: a group of layers packaged as one layer. |
| **Expression** | A small piece of code in After Effects that sets a value automatically. |
| **Range Selector** | After Effects' "sliding window" that decides which letters an animation affects right now. |
| **`spring()`** | Remotion's physics-style motion. Values overshoot and settle like a ball on a spring. |
| **Displacement map** | A grey image that tells each pixel how far to shift. Bright areas push further. |
| **Shader** | A tiny program that runs on the graphics card to decide the colour of every pixel. |
| **Particle system** | Software that spawns thousands of tiny dots and moves them by rules (wind, gravity). |
| **Camera / planar tracking** | Software follows how the real camera moved, or how a flat surface moved, so added text can stick to the footage. |
| **Rotoscoping (roto)** | Cutting a person out of footage frame by frame. |
| **Variable font / axis** | One font file containing a whole range of styles, controlled by sliders called axes (weight, width, slant). |

**Your original 11, and where they sit:**

| Original technique | Family below |
|---|---|
| Motion typography | Brownie's whole first branch |
| Fluid typography | Brownie's whole second branch; family 5 |
| Word-by-word reveal | Families 1 and 15 |
| Emphasis scaling | Family 1 |
| Camera-move | Families 13 and 14 |
| Physics-based | Family 3 |
| Typewriter / handwritten | Families 4 and 11 |
| Text-as-image | Families 8 and 11 |
| Glitch / distortion | Families 6 and 10 |
| Masking and reveals | Family 2 |
| 3D extrusion | Family 9 |

## The catalogue: 17 families of techniques

### 1. Letter choreography: every letter does the same move, a beat apart

This is the backbone of letter-level kinetic type. Change the **order** (left to right, from the centre, random) and the **move** (fade, rise, flip, bounce), and you get most of this family.

**Maths hook.** Letter *n* starts at time *t₀ + n·Δt*, an arithmetic sequence. A wave is the same idea with a sine: *y = A·sin(ωt − kn)*. Random order is just a permutation (a reshuffle) of the letter numbers. In Remotion, each letter's progress is `clamp((frame − i·delay) / duration)`, where `i` is the letter's position in the word. That one line is the code version of After Effects' Range Selector.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: word-by-word reveal, emphasis scaling* | *You know these* | *—* | *Easy* | *The letter-level versions below are their finer-grained cousins* |
| **Cascade / stagger** (letter-by-letter, character offset) | Letters drop or fade in one after another, like dominoes | AE: text animator plus Range Selector offset ([ProVideo Coalition](https://www.provideocoalition.com/cmg_hidden_gems_chapter_21_textacy/)). Web: GSAP SplitText `stagger` ([GSAP](https://gsap.com/docs/v3/Plugins/SplitText/)) | Easy | Almost any title. The single most useful technique to master |
| **Random-order pop-on** | Letters twinkle on in a scattered order | AE: Range Selector, then Advanced, then *Randomize Order* plus *Random Seed* ([ProVideo Coalition](https://www.provideocoalition.com/cmg_hidden_gems_chapter_21_textacy/)) | Easy (shuffle the order with Remotion's seeded `random()`) | Playful or magical reveals |
| **Wave / ripple text** | Letters bob up and down in a travelling "Mexican wave" | Looping stagger ([Motion.dev: Split Text Wavy](https://motion.dev/tutorials/js-split-text-wavy)) | Easy (one sine per letter) | Music, loading screens, playful headings |
| **3D flip-in** (per-character rotate-in) | Each letter flips forward like a card turning over | Letters start at `rotationX: -90`, then stagger in with an overshoot ease ([Tessl GSAP guide](https://tessl.io/registry/tessl/npm-gsap/3.13.0/files/docs/text-animation.md)) | Easy (CSS `perspective` + `rotateX`) | Energetic intros |
| **Wiggle / jitter / flicker** | Letters shiver nervously, or blink like a faulty sign | AE *Wiggly selector*. Adobe shows a random on/off flicker version ([Adobe](https://helpx.adobe.com/after-effects/desktop/animating-text/text-animation-examples/examples-resources-text-animation.html)) | Easy (seeded noise per letter) | Cold, nervous, horror moods. Keep flicker under 3 flashes per second |
| **Tracking in / out** † (letter-spacing animation) | Letters start spread wide and slowly drift together: the classic trailer title | AE *Tracking* animator; CSS `letter-spacing` | Easy | Cinematic, serious openers |
| **Stomp** | Words slam in hard on every beat | Sold as "stomp typography" templates ([Envato](https://elements.envato.com/stomp-typography-EA2BN8N)) | Easy (`spring()` from a big scale down to 100%) | Promos, hype reels |
| **Squash-and-stretch / jelly bounce** † | Each letter squashes when it lands and wobbles back | Opposite X and Y scaling plus an overshoot ease | Easy (`spring()` with low damping) | Cartoon or child-friendly content |

### 2. Cuts, slices and masks: text cut by a line or seen through a window

This is where "slicing a word" lives. **Slice, cut, slit and split text are the same idea.** You make two copies of the word. Each copy is clipped so it shows only one side of a cut line. Then the two copies slide apart ([AEJuice](https://aejuice.com/blog/how-to-make-cut-effects-in-after-effects)).

**Tip.** The cut reads best with a diagonal line and a short pause before the halves separate, so the eye registers "this was one word" first. That is a researcher's judgement, consistent with AEJuice's "line them up, then move apart a few frames later".

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: masking and reveals* | *You know this* | *—* | *Easy* | *The rows below are named variants of it* |
| **Slice / cut text** (split text, slit text, sliced text) | A line slashes through a word; the halves hold, then slide apart (or slide together to "heal") | Two clipped copies moved in opposite directions. Web version: two `clip-path` halves ([KokonutUI](https://kokonutui.com/components/sliced-text)). Scroll version: [Codrops](https://tympanus.net/codrops/2023/12/05/on-scroll-sliced-text-animation/) | Easy (two stacked copies with polygon `clip-path`) | "Broken", "divided", before/after. **Saul Bass's *Psycho* (1960)**: bars cut and pull the names apart, which suggests a split mind ([Art of the Title](https://www.artofthetitle.com/title/psycho/)). Most sources say the bars are horizontal; Filmsite says vertical ([Filmsite](https://filmsite.org/titles-saulbass.html)) |
| **Multi-slice / "Textual Slice"** | Each letter is cut into many thin coloured slivers that shift independently | [Mattrunks tutorial](https://mattrunks.com/en/tutorials/after-effects/textual-slice) | Medium | Stylish fashion or music titles |
| **Shred / Venetian-blinds reveal** | The word appears in stripes, like light through blinds | AE *Venetian Blinds* effect with the text as a matte ([Photofocus](https://photofocus.com/software/after-effects-get-creative-with-venetian-blinds-transition/)). Its strips are always equal; uneven strips need other methods ([Adobe Community](https://community.adobe.com/t5/after-effects-discussions/how-to-animate-a-text-shredding/m-p/15006978)) | Easy–Medium (N clipped strips, staggered) | Tech looks, transitions |
| **Slide-up line mask** (mask reveal per character) | Letters rise from behind an invisible floor, as if cut off at the baseline | SplitText's `mask` option wraps each piece in a clipping box ([GSAP](https://gsap.com/docs/v3/Plugins/SplitText/)) | Easy (`overflow: hidden` wrapper + `translateY`) | The "clean corporate" title and lower third |
| **Split-screen halves** † | The top half of a word is in one colour or scene, the bottom half in another | A slice where each half gets a different fill | Easy | Comparisons, two sides of an argument |
| **Stencil / knockout** (video inside letters) | The letters become windows with video playing inside, or holes punched in a solid block | AE track mattes ([Tutvid](https://tutvid.com/after-effects/zoom-text-intro-transition-effect-effects-cc/)); a different video in each letter ([Larry Jordan](https://larryjordan.com/?p=146395)) | Medium (SVG mask over video) | Topic intros, travel |
| **Zoom-through-letter** (fly through the O) | The camera pushes through a letter's hole into the next scene | Text as a matte plus a 3D camera push timed to a sound hit ([Tutvid](https://tutvid.com/after-effects/zoom-text-intro-transition-effect-effects-cc/)). Common pitfall: scaling drifts off-centre unless the zoom centre sits inside the hole ([Creative COW](https://creativecow.net/?p=240981)) | Medium (`transform-origin` inside the hole) | Transitions. *Stranger Things* chapter titles tunnel into the image ([Promax Brief](https://oldbrief.promax.org/article/design-dissect-stranger-things-titles)). **Maths hook:** an enlargement about a centre |

### 3. Breaking apart and building up

**Think of it as a scale from big pieces to tiny ones.** Shatter gives glass shards. CC Pixel Polly gives polygons. Particle systems give dust. Playing any of them backwards gives "assemble".

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: physics-based* | *Letters fall, bounce, collide* | *—* | *Medium* | *This family destroys the letter itself instead of moving it* |
| **Shatter / explode** | The word breaks like glass into flying shards | AE *Shatter*, "Glass" pattern, low strength (about 0.05 as a starting point) ([AEJuice](https://aejuice.com/blog/how-to-make-text-shatter-in-after-effects)) | AE | Impact moments, "myth busted" |
| **Crumble** † | Pieces break off and fall with gravity | Probably Shatter plus gravity (unconfirmed) | AE | Collapse, failure |
| **Polygon break** | Letters split into triangles that tumble away | Built-in *CC Pixel Polly* ([LinkedIn Learning](https://origin-www.lynda.com/After-Effects-tutorials/Disintegrate-text-using-particles/758640/791311-4.html)) | AE | Stylised exits |
| **Disintegrate / dust / "Thanos snap"** | Letters erode into drifting dust, or sand that piles on the floor | Trapcode Particular, with light dust in wind or heavy falling sand ([Lester Banks](https://lesterbanks.com/2010/10/after-effects-text-to-sand-effect-using-particular/)). Not push-button: each stage takes manual work ([Adobe Community](https://community.adobe.com/t5/after-effects-discussions/how-do-you-make-text-disintegrate-from-the-bottom-up-and-fall-into-a-pile-of-sand/m-p/12724897)) | AE (plugin) | Endings, loss, "gone" |
| **Particle assemble** | A cloud of dots swirls and settles into letters | Sample points from text drawn on a canvas, then animate them as Three.js points ([Codrops](https://tympanus.net/codrops/2022/11/08/3d-typing-effects-with-three-js/)) | Hard | Revealing a key word or logo. **Maths hook:** each dot interpolates from a random start to its own target point |

### 4. Characters that change in place

The letter keeps its slot, but what is *in* the slot changes. This family suits Remotion very well, because it is mostly string handling.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: typewriter* | *Characters appear one by one* | *—* | *Easy* | *—* |
| **Scramble / decode** (cipher, hacker, "Matrix" text) | "X7#q@" flickers and resolves into "HELLO", one letter locking at a time | AE preset *Decoder Fade In*, driven by Character Offset ([Adobe Community](https://community.adobe.com/t5/after-effects/a-difficult-request-scrambling-letters-animation/m-p/11773455)). The preset keeps spaces and capitals, which can give the answer away ([Adobe Community](https://community.adobe.com/t5/after-effects/decoder-expression-linear-to-random-resolution/td-p/11033156)). JavaScript walkthrough: [Cruip](https://cruip.com/making-a-text-scramble-animation-with-javascript/) | Easy (letters before the "lock" index are real; the rest are random, seeded per frame) | Tech branding, revealing an answer, "cracking the code" puzzles |
| **Odometer / rolling digits** (slot machine) | Digits spin vertically like a car odometer, then land | AE: a tall strip of 0–9 scrolled by an expression ([Creative COW](https://creativecow.net/?p=1873760)). Web: [21st.dev Rolling Text](https://21st.dev/@educalvolpz/components/rolling-text.md) | Easy–Medium (0–9 column inside a clipped window) | Statistics, scores, prices |
| **Number counter** † | A number counts up to 1,000,000 | AE slider plus `Math.round` expression | Easy (`Math.round(interpolate(...))`) | Explainer statistics. A natural first "code-driven" animation |
| **Split-flap / Solari board** | An airport departures board: hinged cards flip through letters until the right one shows | aescripts *SolariText* plugin ([aescripts](https://aescripts.com/solaritext/)) | Medium (two half-cards rotating on X) | Travel, lists, "next up" |
| **Anagram / letter rearrange** (Magic Move by character) | "LISTEN" rearranges into "SILENT": shared letters glide to their new spots, extras fade | Keynote *Magic Move* with *By Character* matching ([Apple Support](https://support.apple.com/guide/keynote-iphone/tanff5ae749e/ios)). Keynote's old Anagram transition is gone ([Apple Community](https://discussions.apple.com/thread/2030384)) | Medium (measure each letter's x-position with `measureText()` ([Remotion](https://www.remotion.dev/docs/layout-utils/measure-text)), then interpolate) | Wordplay. **Maths hook:** rearranging the terms of an equation |
| **Letters converge into a title** | Separate letters glide slowly together to form the title | Separate letter layers with position keyframes and a glow. *Stranger Things* (Imaginary Forces, 2017 Emmy) ([ArtCenter](https://artcenter.edu/connect/dot-magazine/articles/graphic-design-alumna-michelle-dougherty-wins-emmy-main-title-design-netflix-stranger-things.html)) | Easy | Series openers, logos |

### 5. Shape-shifting letters: Brownie's fluid typography in practice

**The headline development here is variable fonts.** On the web you animate them with CSS `font-variation-settings`. Staggering the change per letter makes boldness ripple across a word ([CSS IRL](https://css-irl.info/variable-font-animation-with-css-and-splitting-js/)). Roboto Flex (free on Google Fonts) is a good practice font ([Framer](https://marketplace.framer.com/marketplace/components/v-fontanimation)). After Effects added native *Variable Font Axes* animators in a November 2025 beta ([Adobe Community](https://community.adobe.com/t5/after-effects-beta-discussions/introducing-variable-font-animation-in-after-effects-beta-26-0x40/m-p/15601677)), with a per-letter Range Selector ([Adobe Help](https://helpx.adobe.com/after-effects/desktop/variable-font-axes/work-with-variable-font-axes/working-with-variable-font-axes.html)). Whether it has reached the stable release is not confirmed.

**Maths hook.** Each axis is linear interpolation between two "master" designs, thin and heavy.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: fluid typography* | *Letterforms change* | *—* | *—* | *The rows are its named sub-types and tools* |
| **Variable-font breathing / weight pulse** | Letters swell from hairline to heavy and back, or a wave of boldness ripples through the word | CSS keyframes on the `wght` axis ([CSS IRL](https://css-irl.info/variable-font-animation-with-css-and-splitting-js/)); ready "Breathing Text" component ([21st.dev](https://21st.dev/@danielpetho/components/breathing-text)) | Easy (interpolate `fontVariationSettings`; needs a variable font) | Pulsing to a beat, emphasis without movement |
| **Width stretch / slant lean / optical-size morph** † | Letters stretch wide, lean forward as if running, or shift style with size | The same method, on the `wdth`, `slnt` and `opsz` axes | Easy | Cartoon energy, "speed" |
| **Construction** | A letter assembles itself from modular parts | Channel 4's "4" from flying blocks ([Fusion Journal](https://fusion-journal.com/issue/001-fusion/fluid-characters-in-temporal-typography/)) | Medium (SVG pieces) | Logos. A "+" sign building itself |
| **Metamorphosis / outline morph** | One letter's outline melts into another's | GSAP MorphSVG ([Codrops](https://tympanus.net/codrops/?p=93244)); Kac's "EERIE" → "MIST" ([Fusion Journal](https://fusion-journal.com/issue/001-fusion/fluid-characters-in-temporal-typography/)) | Hard (convert the font to SVG paths, then interpolate the paths) | An *x* transforming into a *2* |
| **Revelation** | The letter is hidden in plain sight until the viewpoint shifts | Kac's *Multiple* ([Fusion Journal](https://fusion-journal.com/issue/001-fusion/fluid-characters-in-temporal-typography/)) | 3D | "Aha" moments |

### 6. Warp and distortion: letters bend but keep their material

Most of this family comes from a handful of After Effects effects, or from shaders on the web.

**Maths hook.** A displacement map is literally a function from position to offset: each pixel moves by the value read from a grey image.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: glitch / distortion* | *Digital-error distortion* | *—* | *—* | *These are the smooth, organic warps* |
| **Line boil** (boiling lines) | Clean outlines jitter subtly, like hand-drawn animation | *Turbulent Displace* (amount about 5–10, size about 20–60) ([PremiumBeat](https://www.premiumbeat.com/blog/wiggle-text-line-boil/)), stepped to about 5 fps with *Posterize Time* ([Creative COW](https://creativecow.net/?p=1852893)) | Medium (SVG `feTurbulence` + `feDisplacementMap`, changing the seed every few frames) | Making computer type feel human. **Chalkboard maths** |
| **Wave / flag warp** † | Text ripples like a flag | AE *Wave Warp* | Medium | Dreamy moods |
| **Ripple / pond drop** † | Rings pass through the text | AE *Ripple* | Medium | Transitions, "impact" |
| **Bulge / magnify** | Part of a word swells as if under a lens | AE *Bulge*; interactive React Three Fiber version ([Codrops](https://tympanus.net/codrops/hub/author/roman)) | Medium–Hard | Zooming in on a detail |
| **Twirl / swirl** † | Letters spiral into a whirlpool | AE *Twirl* | AE | Scene transitions |
| **Mesh / envelope warp** † | A word bends to wrap around a shape, such as a ball | *Mesh Warp* or Puppet pins | AE | Logos on objects |
| **Heat haze** | Text shimmers like hot air over a road | WebGL fragment shader ([Codrops](https://tympanus.net/codrops/tag/fire)) | Hard | Desert, summer, "pressure" |
| **Shader distortion** (liquid, sliding, channel split) | Letters ripple or smear as if under liquid glass | Blotter.js demos ([Codrops](https://tympanus.net/codrops/2019/02/06/text-distortion-effects-using-blotter-js/)) | Hard | Experimental, artsy titles |

### 7. Line, light and shadow: the best effort-to-impact ratio

These treat letters as lines to be drawn, or as objects that light falls on. Most of them are cheap, and they make flat text feel physical.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| **Stroke write-on** (outline draws itself) | A pen traces each letter's outline | AE *Create Shapes from Text* + *Trim Paths* ([PremiumBeat](https://www.premiumbeat.com/blog/animate-text-stroke-after-effects)); web `stroke-dashoffset` | Easy–Medium (SVG text or paths with an animated dash) | Explainers. It mirrors writing on a board |
| **Outline-to-fill** † | The outline draws first, then the colour fills in | Write-on followed by a fill fade | Easy–Medium | Maths explainers |
| **Neon sign with flicker** | Glass tubes buzz on, letter by letter, then glow | Free Video Copilot **Saber** plugin, *Neon* preset, animate *Start Offset* ([Noble Desktop](https://www.nobledesktop.com/learn/adobe/neon-text-effect)); per-letter flicker via *Mask Randomization* ([PremiumBeat](https://www.premiumbeat.com/blog/video-tutorial-create-retro-horror-movie-titles-in-after-effects/)) | Medium (layered glow + seeded flicker) | 80s, night, retro horror |
| **Light trail / energy type** | A glowing spark travels the letter outlines, leaving a streak or crackling energy | Saber applied to a text layer, animating Start and End ([Webdew](https://www.webdew.com/blog/how-to-use-saber-in-after-effects)) | AE | Sci-fi, gaming |
| **Light sweep / shine** | A band of light glides across the text like a reflection on polished metal | AE *CC Light Sweep* ([PremiumBeat](https://www.premiumbeat.com/blog/light-sweep-in-adobe-after-effects-creates-dramatic-effect)), or a blurred masked solid in Add mode ([Ledet](https://www.ledet.com/after-effects-tip-of-the-week-create-a-cinematic-light-sweep-on-text/)) | Easy (moving gradient clipped to the text) | Logos, awards, "premium" |
| **Light rays / god rays** | Rays stream out from behind the title | *CC Radial Fast Blur* + blend modes ([AEJuice](https://aejuice.com/blog/how-to-animate-passing-light-on-text-in-after-effects/)) | AE | Epic-trailer look |
| **Long shadow** | A long diagonal shadow trails off each letter (flat-design style) | Minimax, Transform and Venetian Blinds; free preset ([Motion Array](https://motionarray.com/learn/after-effects/long-shadows-in-after-effects-and-free-preset/)) | Easy (many stacked text-shadows generated in a loop) | Bold flat graphics |
| **Spotlight reveal** † | A circle of light roams a dark frame and finds the word | Feathered mask or 3D spot light | Easy (radial-gradient mask) | Mystery, "the key idea is…" |
| **Cast shadow / glow / lens-flare hit** † | Shadows swing as a light moves; text glows; a flare pops on impact | AE 3D lights, *Glow*, *Lens Flare* | Easy (glow) to AE | Polish on any title |

### 8. Elemental materials: letters made of, revealed by, or destroyed into a substance

There are three build routes. **Real footage used as a matte**: ink, smoke or fire decides where the text shows. **Displacement**: the text is pushed around by noise or water. **Particles**: the letters become grains. Sources here are thinner than for other families.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: text-as-image* | *Related, but there the letters form a picture* | *—* | *—* | *—* |
| **Ink-in-water reveal** | Text appears only where swirling ink spreads | Ink footage above the text as a track matte ([Adobe Community](https://community.adobe.com/t5/after-effects/colour-change-iridescent-gradient-animation/m-p/9997454)) | Medium (with stock footage) | Beauty, art, calm intros |
| **Emerging from water** | A logo settles out of rippling water | Water layer as a displacement map, animated down to zero ([Creative COW](https://creativecow.net/?p=12432)) | AE | Brand reveals |
| **Water reflection** | Text reflected in a gently rippling surface | *Fractal Noise* driving a displacement ([AEJuice](https://aejuice.com/blog/how-to-add-a-water-reflection-in-after-effects)) | AE | Calm, nature |
| **Fire / frost text** | Letters burn, or ice creeps over them | [AEJuice: fire](https://aejuice.com/blog/how-to-create-fire-text-in-after-effects/); [PremiumBeat: ice](https://www.premiumbeat.com/blog/ice-after-effects) | AE | Seasonal promos, drama |
| **Smoke text** † | Letters form from, or dissolve into, wisps of smoke | Smoke footage as a matte + noise displacement | AE | Mystery, perfume |
| **Ink bleed** † | Letter edges spread like ink on blotting paper | Growing choker + turbulent displacement | Medium (SVG filter) | Literary, historical |
| **Liquid fill** † | Letters fill up with liquid like a glass | A wavy mask rising inside the letters | Medium | **Progress and percentages**, e.g. "75% full" |
| **Melt / drip** † | Letters droop and drip | 2D *Liquify* or a 3D fluid simulation | AE/3D | Heat, horror, "melting brain" |
| **Growing vines** | Vines grow and twist into letterforms | *CC Bend It* on masked stems ([AEJuice](https://aejuice.com/blog/how-to-animate-growing-plants-in-after-effects)); high-end version in Houdini ([SideFX](https://www.sidefx.com/gallery/procedural-vine-growth)) | AE | Nature, growth, spring |

### 9. 3D surfaces: what the letter is made of

There is a trend tension here. Inflated, glass and metal 3D type is still everywhere: designers "routinely" simulate glass, metal, fabric and fluid ([G2](https://learn.g2.com/graphic-design-trends?hsLang=en)). But some 2026 commentators list glossy 3D blobs as **fading**, in favour of grain and hand-made marks ([Made Good Designs](https://madegooddesigns.com/graphic-design-trends-2026/)).

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: 3D extrusion* | *Gives letters depth* | *—* | *—* | *This family is about the surface* |
| **Glass** | Clear, refracting letters bending the background | A 2D fake with AE *Caustics* ([Motion Array](https://motionarray.com/learn/after-effects/3d-glass-text-after-effects/)), or real refraction in Cinema 4D ([Greyscale Gorilla](https://greyscalegorilla.com/blog/glass-refraction-3d-logo-animation)) | AE/3D | Premium tech |
| **Inflated / balloon / puffy** | Soft, bloated letters that puff up like balloons | Blender cloth *Pressure* setting (from 2.82) ([BlenderNation](https://www.blendernation.com/2020/02/19/daily-blender-tip-balloon-objects-with-cloth-pressure/)); "bloated & playful" trend ([Design & Paper](https://www.designandpaper.com/the-most-weird-wonderful-typography-trends-were-expecting-to-take-off-this-year/)) | 3D | Playful brands, kids |
| **Chrome / liquid metal** † | Mirror-like letters reflecting a bright environment | 3D with an environment photo (HDRI) and high metalness | 3D | Music, Y2K style |
| **Holographic / iridescent** † | A rainbow sheen shifts like a foil sticker | Animated gradient over a bevel, or a 3D "thin-film" shader | Medium (fake) / 3D | Fashion, tech |
| **Clay / jelly / gummy** † | Matte lumpy clay, or translucent wobbling jelly | Clay: stop-motion or 3D with texture. Jelly: soft-body simulation | 3D | Playful, tactile |
| **Gold / embossed plate** † | Bevelled metal letters with a passing shine | *Bevel Alpha* + gradient + light sweep | AE | Awards, luxury |
| **Text wrapped on a 3D shape** | Words wrap around a spinning torus, sphere or tube | Text rendered into a texture on a Three.js mesh, distorted by shaders ([Codrops](https://tympanus.net/codrops/?p=49770)) | Hard (`@remotion/three`) | Hypnotic loops |
| **AI material looks (stills)** | "Chrome" or "lava" applied to editable text from a prompt | Adobe Firefly *Text Effects* ([Packt](https://www.packtpub.com/article-hub/generating-text-effects-with-adobe-firefly)) | Use as an image | Thumbnails, still frames only |

### 10. Screen and print looks: type as if shown on a specific device

**Most of these share one idea.** Chop the image into a grid of cells, then redraw each cell as a dot, a character or an LED according to its brightness ([skills.sh](https://www.skills.sh/avnehsbhatia/ultraui/ascii-dither-halftone)).

**Maths hook.** This is **quantisation**: rounding continuous values to a coarse set of levels.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: glitch* | *Broken signal* | *—* | *—* | *These imitate a particular screen or print process* |
| **RGB / chromatic split** | Red, green and blue copies of the word drift apart slightly | Common in glitch packs ([Envato](https://elements.envato.com/glitch-text-animation-fcpx-K22MPRP)) | Easy (three tinted copies with blend modes) | Music, tech |
| **Pixelate / mosaic reveal** † | Chunky blocks sharpen into crisp text | AE *Mosaic*, animated | Medium | 8-bit, retro-game titles |
| **Dot-matrix / LED board** | Text made of lit dots on a grid, like a scoreboard | Canvas "Dot Text" component ([21st.dev](https://21st.dev/@jahed/components/dot-text.md)) | Medium | Sports, transport, data |
| **Halftone / ASCII** | Letters made of dots of varying size, or of tiny characters | Brightness mapped to dot size or to a character ramp ([skills.sh](https://www.skills.sh/avnehsbhatia/ultraui/ascii-dither-halftone)) | Medium–Hard | Pop-art comic look; "code art" |
| **CRT / VHS** | Scanlines, colour bleed, tracking wobble, a "PLAY ▶" overlay | Templates ([Gumroad](https://pantersource.gumroad.com/l/vhs-text-ae)); otherwise stacked effects † | Medium (overlay footage + offsets) | Nostalgia, 80s–90s |
| **Datamosh** | Pixels from one shot smear into the next as the video "breaks" | aescripts Datamosh plugin; popularised by *Yamborghini High* ([aescripts](https://aescripts.com/learn/how-to-datamosh-directly-in-after-effects)) | AE (plugin) | Music videos |
| **Dithering / risograph texture** † | A two-colour pixel-noise look, or grainy misregistered print | Shaders; grain overlays + channel offsets | Medium–Hard | Indie, editorial |

### 11. Hand-made and analogue: visible human imperfection

Real-world craft can't be fully faked, but its signature can: a slightly jittery frame rate, paper texture, every frame a little different. Trend writing for 2026 is moving this way ([Made Good Designs](https://madegooddesigns.com/graphic-design-trends-2026/)).

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: typewriter / handwritten, text-as-image* | *—* | *—* | *—* | *—* |
| **Cut-paper stop-motion** | Paper letters hop and shuffle in real space | Photograph frame by frame. *The History of Typography* used **291 hand-cut letters, 2,454 photos and 140 hours** ([Laughing Squid](https://laughingsquid.com/?p=285144)); machine-cut version ([Dragonframe](https://www.dragonframe.com/?p=31028)) | Camera | Craft, education, history |
| **Stamped / printed characters** | Figures and type built from hand-carved stamps | *Catch Me If You Can* (Kuntzel + Deygas, 2002) ([Art of the Title](https://www.artofthetitle.com/title/catch-me-if-you-can/)) | Camera/AE | Warm, retro, playful |
| **Lettering in real objects** | Credits written in mustard on hot dogs | *Napoleon Dynamite* (2004) ([Art of the Title](https://www.artofthetitle.com/title/napoleon-dynamite/)) | Camera | Humour, food, everyday maths (numbers in beans) |
| **Faux film texture** (grain, jitter, scratches) | Type that trembles with film grain, dust and colour shifts | *Stranger Things* recreated optical-film flaws with scanned 35mm grain ([Art of the Title](https://www.artofthetitle.com/title/stranger-things/)); *Se7en*'s scratched, jittery type ([Art of the Title](https://www.artofthetitle.com/designer/kyle-cooper/)) | Medium (grain overlay video + seeded jitter) | Period pieces, horror |
| **Frame-by-frame lettering** † | Hand-drawn letters that squash and transform freely, often "on twos" (12 drawings per second) | Procreate Dreams, Toon Boom, Adobe Animate | Draw elsewhere | Expressive one-word moments |
| **Ransom-note collage** † | Mismatched magazine letters that jitter in place | Scanned letter images swapped every 2–3 frames | Easy–Medium | Zines, punk, "clues" |
| **Chalk / pencil texture** † | Textured strokes that write on, with line boil | Textured stroke reveal + line boil | Medium | **Chalkboard maths explainers** |

### 12. Paths and geometry: text that follows a line

**Maths hook.** Path text is the gateway to maths-flavoured kinetic type: a sentence riding a parabola, a sine wave, or a golden spiral.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| **Text on a path** | Letters follow a curve and slide along it like a train | SVG `<textPath>` ([Codrops](https://tympanus.net/codrops/hub/tag/textpath)); AE *Path Options* † | Easy–Medium (animate `startOffset`) | **Running an equation along its own graph** |
| **Orbiting / circular badge** † | A ring of words rotates around a logo or face | A circle path, then rotate it | Easy | Badges, calls to action |
| **Spiral / vortex** † | Words spiral into the centre, shrinking | A spiral path + scale | Medium | Hypnotic intros |
| **Cylinder / sphere wrap, twisting ribbon** † | Words wrap a rotating column or globe, or a text banner twists through space | Per-character 3D, CC Cylinder, or Blender/Three.js | Hard/3D | Global or "around the world" themes |
| **Scroll trails** | Letters bend along a path with outlined ghosts trailing behind | GSAP + Three.js ([Codrops](https://tympanus.net/codrops/?p=123703)) | Web | Websites |

### 13. Repetition, layout and loops

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: camera-move* | *Camera travels through type* | *—* | *—* | *Tunnels and Droste below are close cousins* |
| **Echo / trail** | A moving word leaves a tail of fading copies | "Echo Text" components ([shadcn](https://www.shadcn.io/text/echo-text)) | Easy (draw the word N times, each copy reading the position from a few frames earlier) | Speed, energy, social posts |
| **Outline repeater stack** | A word stacked 10–20 times in outline, like a stack of plates | Text to shapes + *Repeater* ([Adobe](https://www.adobe.com/learn/after-effects/web/draw-complex-shapes)) | Easy | Depth on a budget |
| **Repetition stack** | One word repeated at shrinking sizes, with one accent colour | [Swiper template](https://studio.swiperjs.com/templates/kinetic-typography) | Easy | Posters, emphasis |
| **Text tunnel** | Words fly endlessly toward and past the viewer | [Framer: Zoom Text Tunnel](https://www.framer.com/marketplace/components/zoom-text-tunnel/) | Medium | Hypnotic loops. **Maths hook:** exponential scaling |
| **Droste / infinite zoom** | The frame contains a smaller copy of itself, forever | Nested precomps ([Tuts+](https://photography.tutsplus.com/tutorials/endlessly-zoom-into-your-own-droste-effect--ae-12897)); named after Droste cocoa ([Adobe](https://adobe.com/creativecloud/photography/discover/droste-effect.html)) | Medium | **Maths hook:** self-similarity, geometric series |
| **Kinetic poster** | One word on a Swiss-style grid in a short seamless loop, high contrast | Mat Voyce's grid posters ([Abduzeedo](https://abduzeedo.com/type-motion-mat-voyce-animates-experimental-kinetic-typography-stickers)); 1080×1350 Instagram packs ([Gumroad](https://nawazalamgir.gumroad.com/l/motionposters)) | Easy–Medium | The best "learn layout in motion" exercise |
| ✚ **Fit-to-box type** (text fitting) | Each word's size and weight adjust by themselves so it fills a rectangle exactly, edge to edge; as the box changes shape, the words re-fit | A fitting engine that measures the text and solves for the size (and variable-font weight) that fills the box ([tightset on GitHub](https://github.com/dmoptimal/tightset)) | Medium (measure text, then scale; Remotion's `@remotion/layout-utils` has a `fitText()` helper — check the docs) | Tight wall-to-wall posters, big statement words, titles that must fill a frame |
| **Marquee / ticker** † | A band of text scrolls sideways forever | Duplicated string + modulo offset | Easy | News strips, "SALE" banners |
| **Seamless loop** † | The last frame matches the first, so it plays forever | Motion with a full period, e.g. a sine over the loop length | Easy | Social loops, backgrounds |
| **Modular / bento grid, kaleidoscope, split-screen panels** † | Words slide between boxes like a sliding puzzle; text mirrored around a centre; one word running across panels | Layout grids; mirror effects | Easy–Medium | Lists, comparisons |
| **Type as transition / match cut** † | A giant letter fills the frame and becomes the window into the next shot | Text as matte + scale-up (see zoom-through) | Medium | Chapter changes |

### 14. Text living inside live footage (integrated or "situational" type)

Text here behaves as if it physically exists in the filmed world. This family runs through *Panic Room* (2002), *Stranger than Fiction* (2006), *Fringe*, *Zombieland* (2009) and *Sherlock* (2010).

**Tool note.** This is the family where Remotion needs help most. Track and roto in After Effects, then combine the layers in Remotion.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| **Match-moved floating titles** | Huge letters hang between buildings and stay locked in place as the camera moves | AE *3D Camera Tracker*, then "Create Text and Camera" ([Adobe](https://www.adobe.com/learn/after-effects/web/create-video-visual-effects)). Works only on fixed scenery ([Adobe Community](https://community.adobe.com/t5/after-effects-discussions/background-color-behind-3d-text/m-p/12922061)) | AE | *Panic Room* ([Art of the Title](https://www.artofthetitle.com/title/panic-room/)); *Fringe* ([DIY Photography](https://www.diyphotography.net/?p=20101)) |
| **Planar-tracked text** (sign replacement) | Text "printed" on a moving wall, billboard or phone screen | Mocha planar tracking; Align Surface works in the free Mocha AE ([Boris FX](https://borisfx.com/videos/sign-replacement-with-mocha-pro-align-surface-and-insert-module/)) | AE | Product videos |
| **Situational type** | Type sits in the scene and the action hits it: blood splatters on "Double Tap" | Track + 3D text + occlusion. The type became "a character" ([Art of the Title](https://www.artofthetitle.com/title/zombieland/)) | AE/3D | *Zombieland* rules |
| **Thought HUD** | Thin lines, counters and labels attached to objects, as if inside someone's head | Tracked 2D/3D graphics, by MK12 ([Art of the Title](https://www.artofthetitle.com/title/stranger-than-fiction)) | AE | **Annotating a real object with measurements**, the most reusable idea for maths |
| **Floating text messages** | An SMS hovers beside the actor instead of cutting to a phone | Plain text placed in the frame, sometimes tracked ([Den of Geek](https://www.denofgeek.com/tv/sherlock-visual-language-director-paul-mcguigan)) | Easy (static) | *Sherlock* |
| **Text behind subject** | A big title sits behind a person who stands in front of it | Cut the person out (roto) and layer them above the text; CapCut automates this ([CapCut](https://www.capcut.com/template-detail/textbehindsubject/7507937836256070973)) | Medium (needs a cut-out made elsewhere) | Magazine-cover openers |
| **Tracked lower thirds** † | A name label follows a moving person | Point tracker + null | AE | Interviews |

### 15. Text driven by sound

**The key skill is timing.** Text appears or gets emphasis on the syllable or the beat.

**Maths hook.** Mapping loudness to size is a linear function that maps one interval onto another. A forum example maps amplitude 2–35 onto scale 100–400% ([Adobe Community](https://community.adobe.com/t5/after-effects-discussions/key-frames-on-audio-beats/m-p/12538705)).

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| *ORIGINAL 11: word-by-word reveal* | *Becomes this family when timed to speech* | *—* | *—* | *—* |
| **Lyric video** | Lyrics shrink, cycle through window grids and slide past the camera in time with the song | Prince, *Sign o' the Times* (1987), "widely considered the first-ever lyric video" ([Grammy](https://www.grammy.com/news/list-how-much-do-you-know-about-princes-sign-o-the-times/); [PGDA](https://assets.peoplesgdarchive.org/item/8843/prince-sign-o-the-times-music-video)) | Easy | Songs, chants, mnemonics |
| **Word-highlight captions** ("Hormozi style") | 2–3 bold words at a time; the spoken word turns yellow and grows | Auto-captions, then recolour and enlarge the key word ([Submagic](https://www.submagic.co/blog/how-to-make-alex-hormozi-captions)) | Easy (from a word-timed transcript) | Shorts and Reels; viewers with the sound off |
| **Karaoke highlight** † | A whole line is visible and a colour fill sweeps across each word as it's sung | Top copy revealed by a moving clip | Easy | Sing-alongs, reading practice |
| **Audio-reactive text** | Text pulses with the music's loudness | AE *Convert Audio to Keyframes*, then link Scale to it ([AEJuice](https://aejuice.com/blog/how-to-make-text-react-to-music-in-after-effects)). Isolate the bass first for kick-only pulses ([Adobe Community](https://community.adobe.com/t5/after-effects-discussions/key-frames-on-audio-beats/m-p/12538705)) | Medium (read audio amplitude per frame) | Music, intros |
| **Beat-synced cuts** † | Every text change lands exactly on a beat | Beat markers | Easy (a list of beat frames) | Hype edits |
| **Dialogue kinetic type** ("Say What Again" genre) | Every spoken line set in type; size equals loudness, motion equals emotion | Jarratt Moody's 2007 SCAD class piece on *Pulp Fiction* ([starchamber](https://starchamber.com/2007/02/22/say-what-again-typeset-dialogue/)) | Easy–Medium | Speeches, quotes, an energetic quadratic-formula explanation |

### 16. Text as character, data and interface

Little sourcing exists for this family, but it plays to Remotion's biggest strength. Remotion *is* React, the language of user interfaces.

| Technique (also called) | What it looks like | How it's made | Remotion | Good use |
|---|---|---|---|---|
| **Letters with personality** † | Words blink, walk, react, even get eyes and limbs | Shape-layer rigs (Duik, Joysticks 'n Sliders) | AE | Kids' content, mascots |
| **Charts made of type** † | Bar lengths built from repeated words or numbers | Repetition laid out on a data grid | Easy–Medium | **Statistics lessons** |
| **Chat bubbles / search-bar typing / screen UI** † | iMessage bubbles pop in with typing dots; a Google box types a query | Ordinary UI components animated in | Easy | Storytelling, "what students ask" |

### 17. Code, interaction and AI

| Technique (also called) | What it looks like | How it's made | Remotion | Good use · Example |
|---|---|---|---|---|
| **Oscillating / sine type** | Letters drift on overlapping sine waves | p5.js sketch with video tutorial ([Patt Vira](https://editor.p5js.org/pattvira/sketches/4BroUvdr8)) | Easy | **Trigonometry, visibly** |
| **Generative type** (points, flow fields, tiles) † | Letters made of dots pushed by noise, lines flowing inside letter shapes, or modular tiles flipping | p5.js `textToPoints()`, Cavalry ([Creative Coding Utrecht](https://creativecodingutrecht.nl/en/archive/iterations-2023-workshop-generative-kinetic-typography)) | Hard | Art pieces, backgrounds |
| **Audio-reactive generative** | Frequency data (from a sound analysis called FFT) drives the type | p5.js FFT sketch ([p5.js](https://editor.p5js.org/kaisiang.sin/sketches/uZv6AOFEw)) | Medium | Visualisers |
| **Scroll-linked type** | Text animates as you scroll and reverses when you scroll back | CSS `animation-timeline: view()` ([MDN](https://developer.mozilla.org/docs/Web/CSS/animation-timeline/view)) | Web | "Scroll to solve" lesson pages |
| **Cursor-reactive, sticky scrollytelling, AR text** † | Letters flee or fatten near the mouse; a headline pins while words change; 3D words anchored in your room | JavaScript + variable fonts; Lens Studio for AR | Web/phone | Interactive sites |
| **AI-assisted type** | Still material looks (Firefly), then animated with AI video tools | Our research found **no mature AI tool for animated kinetic type**. Firefly makes stills ([Packt](https://www.packtpub.com/article-hub/generating-text-effects-with-adobe-firefly)) | — | Texture and idea generation only, for now |
| ✚ **AI-generated animation (research)** | You type a prompt and a model produces a short video of the word moving and changing, while keeping it readable | *Kinetic Typography Diffusion Model* (KineTy), a 2024 research model (ECCV 2024) with public code ([KineTy on GitHub](https://github.com/SeonmiP/KineTy)). It needs a powerful graphics card and is a research demo, not an everyday tool | — | Watch this space: the first step toward AI that animates type, not just styles it |

## The rules underneath: easing, 3 words a second, 3 flashes a second

**Easing is the first thing to get right.** Linear motion feels robotic. "Slow-in/slow-out" fixes it ([Graduate School USA](https://www.graduateschool.edu/learn/premiere-pro/animation-principles-motion)). The common recipe ([Made Good Designs](https://madegooddesigns.com/motion-design-principles/)):

| Movement | Easing | Why |
|---|---|---|
| Entering the screen | Ease-out | Arrives fast, settles gently |
| Leaving the screen | Ease-in | Starts gently, speeds away |
| Moving within the frame | Ease-in-out | Gentle at both ends |

Watch the names: animation books and After Effects use "ease" terms differently from CSS, so check which convention a tutorial follows ([Uni. of Applied Arts Vienna](https://computerstudio.uni-ak.ac.at/tutorials/motion-design-01/)).

**Anticipation and overshoot add weight.** Anticipation is a small dip before the main move. Overshoot means a word scales past 100% and settles back. Overused, both make motion feel "bouncy and slow" ([Made Good Designs](https://madegooddesigns.com/motion-design-principles/)).

**✚ Motion blur sells speed.** A real camera smears anything that moves fast during a frame. Computer animation is perfectly sharp by default, so fast type can look jumpy or "stroby". Adding blur along the direction of movement is not a technique of its own; it is a finishing touch that makes almost every family look more filmed and less computer-made. Code-based projects now do this per letter ([motion-launch-videos on GitHub](https://github.com/Kimeur/motion-launch-videos)), and Remotion has its own motion-blur tools (check remotion.dev for the current package). Use it on fast moves only: a slow drift with blur just looks out of focus.

**✚ Check the script before choosing letter-level effects.** In joined-up scripts such as Arabic and Persian, a letter's shape depends on its neighbours. Split the word into separate letters, as cascade, scramble or anagram do, and the letters fall apart into the wrong forms. Projects for those scripts use whole-word or whole-line motion and special text-shaping tools instead ([persian-motion-director on GitHub](https://github.com/atmirrr/persian-motion-director)). Afrikaans uses the Latin alphabet, so every family works; just check that your font has ê, ë, ô and the other accented letters before you animate them.

**In Remotion,** all of this lives in `interpolate(frame, [start, end], [from, to], { easing: Easing.bezier(...) })`. Use `"clamp"` to stop values overshooting their target ([Remotion docs](https://www.remotion.dev/docs/animating-properties)). One rule matters more than any other when you borrow web tutorials: **don't use CSS transitions or CSS animations**. Anything not driven by `useCurrentFrame()` can flicker when the video renders ([Remotion docs](https://www.remotion.dev/docs/animating-properties)). Treat GSAP and CSS demos as visual references, then rebuild them with frame maths.

**Reading time is the hard limit.** BBC subtitle guidance works at **160–180 words per minute, about 3 words per second** ([Clevercast](https://clevercast.com/bbc-subtitling-guidelines)). That gives a rough rule for your videos:

- A word needs to be on screen and *still* for at least about 0.3 seconds to be read.
- A six-word line needs about 2 seconds of readable hold, which is 60 frames at 30 fps.
- Formulas and numbers need extra time, because viewers decode symbols more slowly (a researcher's inference, not a measured figure).
- If the narration says the words, the text can sync exactly to speech. If the text adds something unspoken, it needs its own reading time on top.

**The safety rule is three flashes.** WCAG 2.3.1 says nothing may flash **more than three times in any one-second period**, unless the flashes are small or dim enough to fall below set thresholds ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)):

- **Size:** roughly a 341×256-pixel area.
- **Brightness:** a luminance change of 10% or more counts as a flash.
- **Red:** saturated red has its own, stricter test.

Test at fullscreen, and test loops while they loop. This applies directly to flicker, neon, glitch, stomp and strobe-like scramble effects.

**Restraint beats effects.** Saul Bass limited *Psycho* to "on, off, left, right, up, down, black, white" ([Art of the Title](https://www.artofthetitle.com/title/psycho/)). Current branding advice is one animated heading per screen, with a still fallback for viewers who turn motion off ([Piktochart](https://piktochart.com/blog/graphic-design-trends-2025/)). Let only one thing move at a time. Use order of arrival as a hierarchy tool, alongside size, weight and colour.

## Eighteen landmark works, each teaching one lesson

[Art of the Title](https://www.artofthetitle.com/designer/saul-bass/) is the single best study resource. A good habit for each piece below: write down its unit of animation, which properties move, its easing, its rhythm source and its "one idea". Then rebuild 5 seconds of it in Remotion.

| Work (year) | Maker | Lesson | Families |
|---|---|---|---|
| *Vertigo* (1958) | Saul Bass with John Whitney | Mathematical curves (Lissajous figures) as title imagery ([Art of the Title](https://www.artofthetitle.com/title/vertigo/)) | 12 |
| *North by Northwest* (1959) | Saul Bass | Credits fly in from off-screen; often called the first truly kinetic feature title ([Wikipedia](https://en.wikipedia.org/wiki/Kinetic_typography)) | 1, 14 |
| *Anatomy of a Murder* (1959) | Saul Bass | Take the title literally as a graphic concept ([Art of the Title](https://www.artofthetitle.com/title/anatomy-of-a-murder/)) | 2 |
| *Psycho* (1960) | Saul Bass | Slicing; a tiny vocabulary of moves ([Art of the Title](https://www.artofthetitle.com/title/psycho/)) | 2 |
| Channel 4 idents (from 1982) | Martin Lambie-Nairn | Construction: the "4" built from flying blocks ([Fusion Journal](https://fusion-journal.com/issue/001-fusion/fluid-characters-in-temporal-typography/)) | 5 |
| *Sign o' the Times* (1987) | Prince / Bill Konersman | The first lyric video ([Grammy](https://www.grammy.com/news/list-how-much-do-you-know-about-princes-sign-o-the-times/)) | 15 |
| *Se7en* (1995) | Kyle Cooper | Texture and disturbance as emotion ([Art of the Title](https://www.artofthetitle.com/designer/kyle-cooper/)) | 11 |
| *Panic Room* (2002) | The Picture Mill | Titles that exist inside the city ([Art of the Title](https://www.artofthetitle.com/title/panic-room/)) | 14 |
| *Catch Me If You Can* (2002) | Kuntzel + Deygas | Handmade stamps, modern Bass ([Art of the Title](https://www.artofthetitle.com/title/catch-me-if-you-can/)) | 11 |
| *Napoleon Dynamite* (2004) | Concept credited to Aaron Ruell | Lettering in condiments ([Art of the Title](https://www.artofthetitle.com/title/napoleon-dynamite/)) | 11 |
| *Night Watch* subtitles (2004) | — | Red captions dissolve like blood in water ([Wikipedia](https://en.wikipedia.org/wiki/Kinetic_typography)) | 5, 8 |
| *Stranger than Fiction* (2006) | MK12 | Thought-HUD graphics on real objects ([Art of the Title](https://www.artofthetitle.com/title/stranger-than-fiction)) | 14 |
| "Say What Again" (2007) | Jarratt Moody (often misattributed to Jarrett Heather) | Size equals loudness ([starchamber](https://starchamber.com/2007/02/22/say-what-again-typeset-dialogue/)) | 15 |
| *Zombieland* (2009) | Logan / Ben Conrad | Type as a character in 3D space ([Art of the Title](https://www.artofthetitle.com/title/zombieland/)) | 14 |
| *Sherlock* (2010) | Paul McGuigan | Floating texts with no cut to a phone ([Den of Geek](https://www.denofgeek.com/tv/sherlock-visual-language-director-paul-mcguigan)) | 14 |
| *The History of Typography* (2013) | Ben Barrett-Forrest | Paper stop-motion ([Laughing Squid](https://laughingsquid.com/?p=285144)) | 11 |
| *Stranger Things* (2016) | Imaginary Forces | Slow converging letters; period look from texture ([Art of the Title](https://www.artofthetitle.com/title/stranger-things/)) | 4, 11 |
| Mat Voyce, Gydient | Contemporary | Kinetic poster loops on grids ([Abduzeedo](https://abduzeedo.com/type-motion-mat-voyce-animates-experimental-kinetic-typography-stickers); [It's Nice That](https://www.itsnicethat.com/articles/tra-giang-nguyen-graphic-design-270821)) | 13 |

Of these, *Psycho*, "Say What Again", Prince-style lyrics and the kinetic posters are the most reproducible in pure Remotion. *Se7en* and *Stranger Things* are partly reproducible with texture overlays. *Zombieland* and *Panic Room* need tracking and 3D.

## A ten-step path from stagger to fluid type

Design schools teach this craft through short, constrained exercises:

- One word whose motion expresses its meaning.
- Film dialogue set to type ("Say What Again" was a class assignment ([starchamber](https://starchamber.com/2007/02/22/say-what-again-typeset-dialogue/))).
- Kinetic posters (taught as a course at HAW Hamburg ([It's Nice That](https://www.itsnicethat.com/articles/tra-giang-nguyen-graphic-design-270821))).
- Onomatopoeia studies ([Audrey Lilia Studio](https://audreyliliastudio.cargo.site/MOTION)).

The path below orders the catalogue by build difficulty, Remotion-first. It is a synthesis, not a published curriculum. Each step is a 5–15 second clip, and each one adds a reusable component to your own library, e.g. `<Stagger>`, `<MaskReveal>`, `<Slice>`, `<Scramble>`, `<KaraokeLine>`.

| Step | Exercise | Techniques practised | What it teaches |
|---|---|---|---|
| 1 | **One word, one meaning.** Animate "val", "groei", "skaam", "infinite" using only position, scale, rotation and opacity | Motion basics | Motion carries meaning |
| 2 | **Easing study.** One word enters five ways: linear, ease-out, ease-in-out, spring, posterized | Easing, `spring()` | An eye for timing |
| 3 | **Stagger study.** One line animated by letter, by word and by line, with 1-, 2- and 4-frame delays | Family 1 (cascade, wave, random order, flip-in) | The arithmetic-sequence engine |
| 4 | **The *Psycho* constraint.** Rebuild a title using only bars, black and white, and slides | Family 2 (slice, slide-up mask, shred) | Restraint; clipping |
| 5 | **Change in place.** A statistic counts up; an answer decodes; digits roll | Family 4 (scramble, counter, odometer) | String handling per frame |
| 6 | **Hold-time drill + captions.** Caption 30 seconds of narration at no more than 3 words per second | Family 15 (word-highlight, karaoke) | Readability rules |
| 7 | **Polish pass.** Add a light sweep, a long shadow, grain and line boil to step 4 | Families 6, 7, 11 | Cheap upgrades to perceived quality |
| 8 | **Kinetic poster loop.** One grid, one word, a seamless 4–6 second loop | Family 13 (echo, repeater, loop) | Layout in motion; first frame equals last |
| 9 | **Maths on a path.** Run "y = x²" along its own parabola, then try a Droste zoom | Families 12, 13 | Geometry as motion |
| 10 | **Fluid type.** Morph "x" into "2"; build a "+" from parts; pulse a variable-font weight | Family 5 | SVG paths; Brownie's fluid branch |

After step 10, take one job into After Effects. A 3D Camera Tracker title on a wall, or a Saber neon sign, are good first choices. Composite the result into Remotion so you learn how the two tools hand off.

**Unverified Remotion details.** Some package names used above come from general knowledge of Remotion, not from this research: `random()`, `@remotion/three`, `@remotion/paths`, `@remotion/media-utils` and its caption tools. Check them on remotion.dev before relying on them. Cavalry's free tier is also unsettled: one source says it has been fully free for individuals since April 2026 ([LottieFiles](https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case)), another describes a limited free tier ([Super Render Farm](https://superrendersfarm.com/article/cavalry-motion-design-review-2026)).

## Conclusion

The jump from 11 techniques to over 100 looks large. It shrinks once you see that the catalogue is mostly a grid: a few units (letter, word, line) times a few levers (move, clip, swap, reshape, re-material, repeat) times a few timing sources (clock, voice, beat, camera, viewer). Brownie's motion/fluid split works as a practical tool guide as well as a theory. Motion typography and character swapping are code-native, so Remotion handles them elegantly. Fluid change and material looks lean on paths, shaders, plugins or 3D. Live-footage integration needs tracking tools. Knowing which side of that line a technique sits on tells you, before you start, whether it's an afternoon in React or a detour through After Effects.

For a maths teacher the deeper opportunity is that many of these techniques *are* school mathematics in disguise:

| Technique | Maths underneath |
|---|---|
| Stagger | A sequence |
| Wave | A sine function |
| Zoom-through | An enlargement about a centre |
| Audio reactivity | A linear mapping between intervals |
| Halftone | Quantisation |
| Droste zoom | A geometric series |

The same visual vocabulary that makes a title sequence striking also maps onto algebra: terms converging, a factor splitting, an *x* metamorphosing into its value. That makes kinetic type unusually well suited to the "make hard things understandable" work you care about. The remaining gaps are in sourcing more than in technique. Several layout and interface techniques still need first-hand verification. AI for animated type exists so far only as research (KineTy, 2024), not as a tool you can use day to day.
