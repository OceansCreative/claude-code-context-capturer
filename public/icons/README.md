# Icons

The "A2" logo (2026-07 refresh): capture-frame corner brackets around a
terminal `>_` prompt — "capture the web for your CLI agent" in one mark.

- `icon-128.png`, `icon-48.png`, `icon-32.png` — full design
- `icon-16.png` — simplified variant: brackets dropped, `>_` only. All four
  brackets plus the glyph turn to mush at 16px, so the toolbar icon keeps
  just the prompt.

## Palette

- Charcoal background: `#262421`
- Coral (brackets / underscore): `#D97757`
- Cream (chevron): `#F0EEE6`

## Regenerating

SVG sources live in `docs/brand/` (`icon-a2.svg`, `icon-a2-16px.svg`).
Render them to the four PNGs with any SVG rasterizer, or via puppeteer:
load the SVG in a page sized to the target dimensions and screenshot with
`omitBackground: true` (keeps the rounded corners transparent).

Required sizes: 16 / 32 / 48 / 128, referenced from `src/manifest.config.ts`
(both `action.default_icon` and `icons`). 128px doubles as the Chrome Web
Store listing icon.
