# Portfolio — Temuujin (Temo) Batbold

Static site built from the Figma file
[`dXLE4N41qRkrm3CmnVqxI7`, node `2:4`](https://www.figma.com/design/dXLE4N41qRkrm3CmnVqxI7/Untitled?node-id=2-4).

No build step, no dependencies. Three files:

| File | What's in it |
| --- | --- |
| `index.html` | The index page: all five tab panels |
| `styles.css` | Design tokens at the top, then layout → header → bio → tabs → rows → cards → prose |
| `script.js` | Tab switching, Work-row hover, the Ulaanbaatar clock |
| `article.css` | Article pages only. Loaded *after* `styles.css`, which holds the tokens |
| `article.js` | Article pages only: the side index tracks which section you're reading |
| `effects.css`, `effects.js` | Opt-in effects. Loaded everywhere, inert until switched on |
| `work/`, `writing/`, `apps/`, `games/` | One standalone HTML file per article |
| `images/` | Previews, app icons, game art, article figures — all placeholders |

## Run it

```bash
python3 -m http.server 4321 --directory .
```

Then open <http://localhost:4321>. (Open `index.html` directly and the CSS/JS won't load.)

## Edit it

**Add a project** — copy one `<li class="row">` in `index.html`:

```html
<li class="row"><a class="row-link" href="/work/my-project"><span class="row-title">Title</span><span class="row-year">2026</span></a></li>
```

**Fill in the other tabs** — `Research`, `Apps` and `About` each hold a
`Nothing here yet.` row. Replace it with `row` items the same way.

**Swap in real imagery** — see [images/README.md](images/README.md).

**Things left as placeholders**

- **All nine articles are placeholder copy** that describes itself, so it
  can't be shipped by accident. The six Writing entries are invented titles —
  replace or delete them.
- The four remaining Work rows still point at `#`; the first three have pages.
  All three Apps and all three Games have theirs.
- The `Lifetech Ti Mongolia` link is `#` — I didn't want to guess the URL.
- Twitter, LinkedIn, Github, Instagram and Youtube are all `#`.
- Achievement links stay `#` until their page design lands.
- The About intro is a draft assembled from what was already on the page.
- Everything in `images/` is a neutral placeholder, not real artwork.

## The tabs

Each tab behaves differently on purpose — see `styles.css`, which is ordered
the same way.

**Work** — a list that hugs each title rather than spanning the column, so the
right-hand half stays free for the preview. Hovering a row does two things:

- *The glass.* A single pane (`.row-glass`) that travels between rows rather
  than one per row — one `backdrop-filter` layer instead of seven. It matches
  each row's own width, and its specular highlight follows the pointer, which
  is the part that reads as *liquid* rather than as a frosted rectangle. Tune
  the material with the `--glass-*` tokens.
- *The preview.* Sized from each image's own proportions — a portrait
  screenshot stays portrait, a wide one stays wide — and it morphs between
  sizes as you move down the list. It sits just right of the list rather than
  out against the window edge, so it reads as belonging to the row you're on:
  `script.js` measures the longest row title and the tab row, and starts the
  preview 64px past whichever is wider. Vertically it is centred on the tab
  section rather than on the viewport, which keeps it clear of the bio
  paragraph. Hidden below 1240px, where there is no longer room beside the
  column.

Keyboard focus gets both, minus the travel animation — tabbing through a list
fires in bursts, and motion there only makes it feel slower.

**Writing** — no glass, no preview. Hovering one entry recedes the others. Rows
are a three-column grid: year gutter, title, date. Include the
`<span class="writing-year">` **only** on the first entry of each year — that
span is what draws the full-width rule above the group; every other row gets
the shorter rule that starts at the title. Full markup is in the comment above
the panel in `index.html`.

**Apps** — 1:1 cards, two to a row, each with its icon in the bottom-right
corner. `.card-app .card-body` reserves that corner so long copy never runs
underneath the icon.

**Games** — one card per row, a 16:9 visual above the text.

**About** — plain prose. Each heading and its list share a `.prose-block`
wrapper so the 32px block gap does not also open up between a heading and the
list it labels.

## Article pages

All four tabs use the same article template. Every article is a standalone
HTML file — `work/`, `writing/`, `apps/` or `games/`, one per slug. **To add
one, copy the nearest existing file** and replace the title, meta line, body
and links. Nothing is generated at build time, so what you see in the file is
what ships.

Apps and Games open their page from the card itself; `Previous`, `Next` and
`Similar` chain within the same folder.

**The back link returns you to the tab you came from**, not to Work. Each
article points at `../index.html#<folder>`, and the index reads that hash on
load. Switching tabs rewrites the hash with `history.replaceState`, so tab
changes don't stack up history entries but the browser's own Back button still
lands on the right tab. Add a new folder and its back link works the same way,
as long as the folder name matches the tab id after `tab-`.

Each page has, in order:

1. **Side index** — pinned in the left margin above 1180px, and collapsed to
   just the `↩ Index` link below that. It is built from the `<h2 id="…">`
   headings; keep the `<li>` list in `.side-index` matching them and
   `article.js` highlights the one you're reading.
2. **Title and date** — same weight and colour relationship as the name and
   role on the index page.
3. **Title meta** — the grey line under the title: a date for Writing, a year
   for Work, a short label for Apps and Games.
4. **Body** — 552px measure, roughly seventy-five characters a line. On Apps
   and Games the first paragraph is the real description from the card; the
   rest is template copy.
5. **Figures**, in two treatments:
   - `<figure class="figure">` wraps the image in `.figure-frame` — a tinted
     container with a 16px radius. For screenshots, mockups, device shots:
     anything that should read as an artefact.
   - `<figure class="figure figure-bare">` has no container at all. For
     charts, which are mostly whitespace already; a box around one just
     fences off the space it is using. Export the chart with a transparent
     background and it will sit on the page in both themes.
6. **Footnotes** — the disclaimers and asides. Mark them in the body with
   `<a class="note-ref" id="ref-N" href="#note-N">N</a>` and add a matching
   `<li id="note-N">` to `.notes`. Numbering is generated by CSS, so deleting
   one renumbers the rest; just keep the `ref-N`/`note-N` pairs in step.

   They travel **both ways**: the marker jumps down to the note, and the whole
   note — not just its ↵ arrow — jumps back to the line that called it. Both
   scroll smoothly, centre the target, and flash it briefly so you can see
   which line you landed on. Selecting a note's text doesn't trigger the jump,
   and a link inside a note opens the link instead.
7. **Similar articles**, then **Previous / Next**.

Links that leave the site get `target="_blank" rel="noopener noreferrer"`, and
the ↗ arrow is added automatically — never type one by hand.

In-page jumps scroll smoothly (`scroll-behavior: smooth` on `html`), switched
off automatically for anyone who asked for reduced motion.

## Effects

The site ships with effects **off**, and that state is the design of record.
The toggle at the far end of the header row turns them on.

**How the state travels.** It lives on `<html data-fx>`. A three-line inline
script in every page's `<head>` reads `localStorage` and sets the attribute
*before first paint*, so the page never flashes the wrong mode — which is why
that script is inline and blocking rather than in `script.js`. The button in
`script.js` only flips the attribute and writes to storage; everything else
reacts to the attribute.

**Where effects go.**

- `effects.css` — every rule scoped under `:root[data-fx]`, so the file costs
  nothing while the toggle is off.
- `effects.js` — watches the attribute with a `MutationObserver` and starts or
  stops itself. Add an effect by pushing `{ start, stop }` onto its `EFFECTS`
  array. **`stop()` must leave the page exactly as it found it** — no orphaned
  listeners, no leftover inline styles, no half-applied transforms. The
  effects-off state has to be reachable from any effects-on state.
- The pointer position is published as `--fx-x` / `--fx-y` on `<html>` for any
  effect that wants it.

Both files load on every page, including articles, so switching effects on
follows you around the site. The toggle itself only lives on the index.

### What's in there

**Variable proximity** — letters near the pointer gain weight and optical
size, falling off over a 25px radius. Ported from React Bits'
`<VariableProximity />` to vanilla JS (this site has no React, and no build
step to add it to), and rebuilt around two problems the original doesn't have
to solve:

- *It runs site-wide, not on one headline.* The original calls
  `getBoundingClientRect()` on every letter on every frame — fine for a dozen
  letters, ruinous for the ~2,900 on an article page. Here positions are
  measured once into flat `Float32Array`s and re-measured only when the body
  box changes (tab switch, resize, font load). A frame is then arithmetic plus
  a handful of style writes. Measured: **0 dropped frames** over a continuous
  pointer sweep across 1,684 letters.
- *It has to be reversible.* Text nodes are swapped for letter spans and
  swapped back on `stop()`. Verified byte-identical: `body.innerHTML` before
  and after a full on/off cycle are the same string.

Two departures worth knowing about:

- Letters stay `display: inline` (the original uses `inline-block`). Inline
  spans create no line-break opportunities, so wrapping, link underlines,
  `text-wrap: pretty`, selection and copy all behave exactly as with effects
  off. The weight change shifts a line's last character by under 2px and never
  re-wraps it.
- Text inside a flex or grid parent gets one `.fx-t` wrapper. Without it each
  letter becomes its own flex item and picks up the container's `gap` — the
  sidebar link renders as "I n d e x".

It drives **Inter's own axes** rather than pulling in Roboto Flex: every page
now requests `Inter:opsz,wght@14..32,100..900` — the real variable font rather
than three static instances — so `wght` and `opsz` are continuous. Each
element keeps its own resting weight and gains 450 from there, capped at 900,
so nothing looks different at rest. The tuning constants are at the top of the
effect in `effects.js`.

Skipped entirely on touch and under `prefers-reduced-motion`: no cursor, no
point — and no DOM churn either, since the split never happens.

**Click spark** — eight short lines burst from every click, ported from React
Bits' `<ClickSpark />`. Three changes for this site:

- One fixed, full-viewport canvas rather than a wrapper element per subtree,
  so a click anywhere sparks without restructuring the page. It carries
  `pointer-events: none`, so everything underneath stays clickable.
- It draws only while sparks are alive. The original runs an animation frame
  forever; here the shared loop is already running and an idle frame costs one
  array-length check.
- The backing store is scaled by `devicePixelRatio`, so the lines are crisp
  rather than soft on a retina screen.

The spark colour is read from `--text` on each burst, so it is dark on the
light theme and light on the dark one without watching for a change. It fires
on `pointerdown` rather than `click` — the spark should answer the press, not
wait for the release.

**Particle scroll** — everything below a formation line at 68% of the viewport
dissolves into drifting dust, and reassembles grain by grain as it scrolls up
past that line.

> **Why this isn't the original component.** Canvas UI's `<ParticleScroll />`
> gets its grains from the page's *pixels*: it lays the DOM out inside a canvas
> via `layoutsubtree`, rasterises it with `drawElementImage`, and pushes the
> result through a WebGL point shader. Both are experimental Chrome APIs behind
> a flag — `typeof ctx.drawElementImage` is `"undefined"` in this browser, in
> Safari, in Firefox and in stable Chrome. The component's own
> `supportsHtmlInCanvas()` catches that and silently degrades to **doing
> nothing at all**.

So this rasterises the page itself, which turns out not to need that API. The
DOM has already done the hard part — it knows where every word sits, in what
font, at what weight, in what colour — so each word is redrawn with `fillText`
into an offscreen strip, along with images (`drawImage`) and filled surfaces
like cards and figure frames (`roundRect`). The strip is sampled on a
`DENSITY`-pixel grid and every opaque cell becomes a grain carrying that
pixel's colour. The scatter, gravity, swirl, drift, stagger and settle maths
are ported straight from the point shader.

All twelve props are at the docs-demo values — `point` 0.68, `band` 420,
`density` 2, `size` 1.25, `spread` 220, `gravity` 0.35, `drift` 0.7, `swirl`
60, `stagger` 0.7, `fade` 0.85, `settle` 1.2, `smoothing` 0.6. `size` is the
grain size throughout rather than only when fully scattered — see below.

Four things that matter in the implementation:

- **Grains are written into an `ImageData` buffer**, not stroked one at a
  time. Cost is proportional to grains rather than to draw calls, which is what
  makes tens of thousands of them affordable. Measured on an article page:
  **120fps while scrolling, zero dropped frames, worst frame 9.4ms.**
- **Cells sample the strongest pixel they cover**, not their centre. A thin
  glyph stem mostly lands on partial coverage, and centre-sampling turns solid
  type into pale speckle.
- **An element and its grains share one progress value**, taken at the
  element's middle row. Letting each row run on its own schedule produced a
  chunky stage in the middle of the transition: rows that had landed were
  rebuilt at grain resolution while the element stayed hidden for the rows
  that hadn't, so you read a 2px bitmap of the type. Locked together, an
  element is either dust or itself.
- **Grains stay round and grain-sized the whole way, and cross-fade with the
  element.** The shader grows them to `density * 1.3` and squares them off so
  they tile back into the source image — which *is* that low-resolution
  rebuild. Here the dust fades out over the last stretch while the real
  element fades in over the same range, so the page goes from clean type to
  clean dust with nothing pixelated in between. The shader's extra
  `density * 3` jitter and its per-grain scroll-lag weight are kept.

**Only the zone that produces grains gets rasterised** — everything above the
formation line is settled and drawn by the page itself, so the strip is a
~650px window rather than a whole viewport, carrying 500px of slack either
way. That is the difference between re-cutting once a frame and once a screen:
before the fix, a fast scroll hit a 58ms frame; after it, 2,640px of fast
scrolling produced **zero frames over 20ms** (worst 17.5ms, p99 9.4ms).

Grains hash on their **document-space** cell, so a grain keeps its own scatter
no matter when the strip was last cut.

Constants at the top of the effect: `POINT`, `BAND`, `DENSITY`, `SIZE`,
`SPREAD`, `GRAVITY`, `DRIFT`, `SWIRL`, `STAGGER`, `FADE`, `SETTLE`,
`SMOOTHING`. `DENSITY` is the one to reach for first — lower means finer,
denser sand and more grains to push, and it drives both the rasterisation scan
and the per-frame blend.

**Cloth** — the Work preview hangs on a piece of fabric: it ripples in the
wind, catches directional light along its folds, and casts a soft contact
shadow. Ported from Canvas UI's `<Cloth />`.

This one ports **faithfully** rather than being reinterpreted. `<Cloth />`
needs `drawElementImage` only because it wraps arbitrary live HTML — and the
preview's content is a single image. An `<img>` uploads straight to WebGL with
`texImage2D`, so the experimental API isn't needed at all. The simulation, both
shaders and all thirteen prop values are the originals.

Two adaptations the placement required:

- **The two crossfading preview layers composite into one texture**, so
  swapping previews still dissolves rather than cutting.
- **The brush rides the pointer's y down the cloth's leading edge.** Your
  cursor is over the row list on the left and never over the preview itself,
  so a literal hit test would mean the fabric was never touched. Moving down
  the list now sends a wave down the cloth.

One performance note worth keeping: each preview is **rasterised once and
cached**. Re-rasterising an SVG is the expensive part, and the frame morphs its
size on every swap — pinning the texture to the image's own resolution rather
than the frame's stopped a morph from re-rasterising on every frame of it, and
took the worst frame from **207ms to 26ms** (p99 9.4ms, median 120fps).

The frame's own surface steps aside while the cloth is up: the cloth draws the
image, its own rounded hem and its own shadow, so `.preview-frame` goes
`visibility: hidden` — the layers keep their opacity transition, which is what
feeds the texture composite.

**Also in there:** a soft light that follows the cursor. That one is a
placeholder from before — replace it whenever.

### How the three share one text split

`textGrid` splits the page once and hands the result to whoever needs it.
Words are `inline-block` because `transform` does not apply to an inline box
and the particle scroll has to move them; letters inside stay `inline`. An
inline-block breaks the underline an ancestor `<a>` would draw through it, so
the word carries a copy of the parent's decoration.

Effects start in array order and **stop in reverse**, so the grid is built
first and torn down last. The proximity effect skips any letter whose word is
mid-flight — its cached centre is the word's home, not where the particle
scroll is currently drawing it.

**Two rules for anything added here.** Effects may not change layout, hide
content, or make anything harder to read; and if `prefers-reduced-motion` is
set, prefer the gentler variant even though effects are opt-in.

## Deploy

Hosted on **GitHub Pages** at `temode.art`. It's a pure static site with no
build step, so the repo *is* the deploy — `git push` publishes.

Files that exist only for hosting:

| File | Why |
| --- | --- |
| `CNAME` | Tells Pages which domain to serve. Deleting it unsets the custom domain |
| `.nojekyll` | Skips Jekyll processing — nothing here needs it, and it's faster |
| `404.html` | Pages serves this for unknown paths |

### First-time setup

1. Push the repo to GitHub. It must be **public** — Pages on a private repo
   needs a paid plan.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch*, branch `main`,
   folder `/ (root)`.
3. Same page, **Custom domain**: `temode.art`. GitHub then shows the exact DNS
   records it wants — use those, not a copy from elsewhere; they're the
   authoritative list.
4. At **Porkbun → Details → DNS**, delete the default parking records first
   (Porkbun pre-fills an ALIAS on the apex and a CNAME on `www`), then add:

   | Type | Host | Answer |
   | --- | --- | --- |
   | A | *(blank)* | `185.199.108.153` |
   | A | *(blank)* | `185.199.109.153` |
   | A | *(blank)* | `185.199.110.153` |
   | A | *(blank)* | `185.199.111.153` |
   | AAAA | *(blank)* | `2606:50c0:8000::153` |
   | AAAA | *(blank)* | `2606:50c0:8001::153` |
   | AAAA | *(blank)* | `2606:50c0:8002::153` |
   | AAAA | *(blank)* | `2606:50c0:8003::153` |
   | CNAME | `www` | `YOUR-USERNAME.github.io.` |

5. Wait for DNS (minutes to an hour), then tick **Enforce HTTPS** in the Pages
   settings. It stays greyed out until GitHub has issued the certificate.

Check propagation with `dig temode.art +short` — it should return the four A
records above.

### Deploying a change

```bash
git add -A && git commit -m "what changed" && git push
```

Live in under a minute.

### If you'd rather use Vercel

Nothing here needs it — there's no build step, no serverless functions, no
preview-deploy workflow — but it works the same way: import the repo, no build
command, output directory `.`. The DNS is simpler (one `A` on the apex to
`76.76.21.21`, `www` CNAME to `cname.vercel-dns.com`), and Vercel shows you the
records when you add the domain. `CNAME` and `.nojekyll` are harmlessly ignored.

Upload the whole folder anywhere static — Netlify, Vercel, GitHub Pages, Cloudflare
Pages. No configuration needed. `.claude/launch.json` is only for local preview and
doesn't need to ship.
