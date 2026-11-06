# The type-script format

A **type script** is Claude's draft of a video's typography: a style for every line,
chosen for what the line means. It goes into the page as `window.TYPE_SCRIPT`; the user's
choices come back out as `window.TYPE_SCRIPT_RESULT`.

All technique ids come from the menu: `skills/kinetic-type/assets/menu.js`
(readable list: `skills/kinetic-type/references/menu.md`).

## Data in: `window.TYPE_SCRIPT`

Write this as JSON (for example `type-script/<slug>.json` in the video's project).

| Field | What it is |
|---|---|
| `title` | The video's name. It heads the page and names the saved choices. |
| `mode` | `"teaching"` (the default) or `"free"`. It only sets which styles the Swap panel offers; the user can flip it on the page. |
| `aspect` | `"16:9"` (the default), `"9:16"` or `"1:1"`. Shapes the player. |
| `houseOptions` | Exactly 3 `{ id, why }`: house-style candidates, each a **calm** technique (`calm: true` on the menu), with a one-line reason. |
| `house` | The id of Claude's first pick. It must be one of the 3 options; it defaults to the first. |
| `lines` | The lines, in order (below). |

Each line:

| Field | What it is |
|---|---|
| `t` | When the line starts, in seconds from 0 (Claude's estimate; there is no audio). |
| `dur` | How long it stays, in seconds. |
| `text` | The words on screen. |
| `key` | The key word accents act on, or `""`. Matching ignores case and `.,!?;:"'()“”‘’`, and only the first match counts. A key word that isn't in the line is harmless. |
| `style` | `"house"` (the default) or a technique id: the accent Claude suggests. Any technique is allowed. |
| `suggest` | `[{ id, why }]`: Claude's picks for this line, each with a one-line reason. They head the Swap panel. May be empty. |

### Example: Pythagoras

```json
{
  "title": "Pythagoras in 60 seconds",
  "mode": "teaching",
  "aspect": "16:9",
  "houseOptions": [
    { "id": "word-by-word-reveal", "why": "Calm and clear: words rise in as they're spoken." },
    { "id": "masking-and-reveals", "why": "Clean and professional: lines slide up from behind an edge." },
    { "id": "typewriter", "why": "Notebook feel: letters type on." }
  ],
  "house": "word-by-word-reveal",
  "lines": [
    { "t": 0, "dur": 4.5, "text": "Every right-angled triangle hides a secret.", "key": "secret", "style": "house",
      "suggest": [{ "id": "marker-highlight", "why": "Marks 'secret' without breaking the calm." }] },
    { "t": 4.5, "dur": 4.5, "text": "The longest side is the hypotenuse.", "key": "hypotenuse", "style": "emphasis-scaling",
      "suggest": [
        { "id": "emphasis-scaling", "why": "A new term: make it physically bigger." },
        { "id": "marker-highlight", "why": "Gentler: like a student's marker." }
      ] },
    { "t": 9, "dur": 3.5, "text": "Square the two short sides,", "key": "", "style": "house", "suggest": [] },
    { "t": 12.5, "dur": 3, "text": "add them together,", "key": "", "style": "house", "suggest": [] },
    { "t": 15.5, "dur": 4.5, "text": "and you get the longest side squared.", "key": "squared", "style": "house",
      "suggest": [{ "id": "marker-highlight", "why": "Links back to 'square' above." }] },
    { "t": 20, "dur": 5, "text": "a² + b² = c²", "key": "", "style": "stroke-write-on",
      "suggest": [
        { "id": "stroke-write-on", "why": "Drawn like on a board: the payoff moment." },
        { "id": "scramble", "why": "Decodes the 'secret' from line 1." }
      ] },
    { "t": 25, "dur": 4.5, "text": "But ONLY for right angles.", "key": "ONLY", "style": "stomp",
      "suggest": [
        { "id": "stomp", "why": "A warning should land hard." },
        { "id": "slice", "why": "'Only' cuts off the other triangles." }
      ] }
  ]
}
```

(The same file is `tests/fixtures/pythagoras.json`.)

## Making and opening the page

```bash
node skills/kinetic-type-director/scripts/make-page.mjs type-script/pythagoras.json type-script/pythagoras.html
```

This writes one self-contained HTML file: the menu, the previews and the data are inside it.
If the data has a problem, nothing is written; it lists every problem and exits with code 1.
It refuses:

- `houseOptions` that isn't exactly 3, has a repeat, or has a technique that isn't calm
- a `house` that isn't one of the 3 options
- any technique id (house option, `house`, line `style`, `suggest`) that isn't on the menu
- a line missing `text`, `t` or `dur` (`dur` must be more than 0)
- a `mode` or `aspect` that isn't one of the values above

The Claude desktop app's browser pane shows `file://` pages as still pictures, so serve the folder
(run it in the background) and open the page over http:

```bash
node skills/kinetic-type-director/scripts/serve.mjs type-script        # port 3018; or add a port
```

then open `http://127.0.0.1:3018/pythagoras.html`. A normal browser can also open the file directly.

## Result out: `window.TYPE_SCRIPT_RESULT`

The page rewrites this on every change, and saves the same object in the browser's
localStorage under `kt-type-script:<title>`. Reloading the page restores it.

```js
{
  title: "Pythagoras in 60 seconds",
  mode: "teaching",                 // the mode the page was left in
  house: "typewriter",              // the chosen house style
  lines: [                          // one per line, in order
    { text: "Every right-angled triangle hides a secret.", key: "hides", style: "house", note: "" },
    { text: "The longest side is the hypotenuse.", key: "hypotenuse", style: "emphasis-scaling", note: "" },
    // …
    { text: "But ONLY for right angles.", key: "ONLY", style: "slice", note: "Make it a bit funnier" }
  ],
  approved: true,                   // the user pressed "Looks good: send to Claude"
  draft: "e19687f3"                 // which draft these choices belong to (see below)
}
```

- `style` is `"house"` (use `house`) or a technique id.
- `note` is the user's "note for Claude" on that line (`""` if none).
- `approved` becomes `true` on "Looks good". Any later change to the video (house, a style, a key
  word, a note) sets it back to `false`; switching mode does not.
- `draft` is a fingerprint of the data the page was made from. Saved choices are only restored
  into the same draft: if Claude regenerates the page with new data under the same title, the page
  starts from the new suggestions. Fold the user's earlier choices into the new data if they should carry over.
- Saved choices belong to the page's address (`http://127.0.0.1:<port>`): reopen it on the same port.

### Reading it back

With the browser pane's JavaScript tool, on the open page:

```js
JSON.stringify(window.TYPE_SCRIPT_RESULT)
```

If that isn't possible, ask the user to press **Copy choices** and paste what it copies: a plain
list of the choices, followed by the same object as JSON.
