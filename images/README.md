# Images

Three kinds, all placeholders right now. Replace them.

| Folder | What it holds | Shape |
| --- | --- | --- |
| `work/` | The hover preview for each Work row | **Any.** Portrait or landscape |
| `apps/` | App icons, one per card | Square |
| `games/` | Key art, one per game | Landscape, 16:9 |
| `article/` | Figures inside article pages | Any |

## work/ — hover previews

Each preview is sized from its own proportions, so a tall phone screenshot
stays tall and a wide one stays wide. Nothing is cropped; the frame reshapes
around the image and morphs as you move down the list.

The longest edge renders at about 520px, so **1600px on the long side** is
plenty even on a retina screen.

Wire a row to its image with `data-preview` in `index.html`:

```html
<a class="row-link" href="/work/today-in-tino" data-preview="images/work/today-in-tino.jpg">
```

A row whose `data-preview` is missing or fails to load simply shows no preview
— the glass highlight still works. So delete the attribute on any row that
doesn't have a snapshot yet.

## apps/ — icons

Square, rendered at 44px with an 11px corner radius. **256×256** is enough.
The card's border radius doesn't clip them, so ship the icon with whatever
corner shape it already has.

## games/ — key art

Rendered full-column width at **16:9** with `object-fit: cover`, so an
off-ratio image is cropped rather than squashed. **1600×900** or larger.

## Swapping a file

Drop the new file in (`.jpg`, `.png` and `.webp` all work), point the `src` or
`data-preview` at the new filename, and delete the leftover `.svg`.

## article/ — figures

Two treatments, and the difference matters:

- **Framed** (`.figure-frame`) — screenshots, mockups, device shots. They sit
  in a tinted container with a rounded corner, so export them with their own
  background.
- **Bare** (`.figure-bare`) — charts. No container: export with a
  **transparent** background so the page shows through, and put a
  `@media (prefers-color-scheme: dark)` block inside the SVG so the strokes
  flip with the theme. The placeholder `chart-line.svg` does exactly that —
  copy its `<style>` block.

Render width is 552px, so 1100px on the long side is enough.
