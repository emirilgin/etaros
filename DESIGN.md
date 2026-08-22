# Etaros — design system

Written from the built interface, not ahead of it. Authority is `index.html`; this file
describes what is there so the next change does not have to re-derive it.

## Register

macOS-native, played straight. The bar is the system apps and Claude: an application you leave
open for hours, legible at rest, that never performs. `philosophy.md` binds this — "no theatre,
no skull icons, no INTRUSION DETECTED" is a design rule, not only a copy rule.

Dark is the default because the scene is a normal room, often evening, with the app open
beside real work. A light theme exists and must keep working.

## Colour

| Token | Dark | Light | Job |
|---|---|---|---|
| `--bg` | `#0A0D11` | `#F7F9FB` | Window ground |
| `--bg-hi` | `#0E1217` | `#EFF3F7` | Titlebar, status strip |
| `--surface` | `#12171E` | `#FFFFFF` | Sidebar, controls |
| `--card` | `#151B23` | `#F4F7FA` | Raised panels |
| `--border` / `--border2` | `#212A35` / `#2E3946` | `#DCE4EC` / `#C4D0DC` | Hairline / emphasis |
| `--accent` | `#4CC2FF` | `#0A7CC4` | **Only ever "this is the action"** |
| `--green` `--amber` `--red` | `#3DD68C` `#F5B849` `#FF6259` | darker equivalents | Verdict states only |
| `--t1`…`--t4` | `#E9EFF6` `#97A5B4` `#8794A4` `#7A8899` | `#0D1620` `#4C5B6B` `#5A6875` `#63707D` | Text ramp |

Restrained strategy: neutrals plus one accent. Semantic colour never decorates — green, amber
and red appear only when something has been judged. Text tokens are set so the lowest step
still clears 4.5:1 on the lightest surface it lands on; they are not free to darken for effect.

**Ink on accent is `#08131B`, never white.** White on `#4CC2FF` is 2.01:1.

## Type

System stack, matching the platform: `-apple-system, BlinkMacSystemFont, 'Segoe UI'`.

| Token | Size | Use |
|---|---|---|
| `--fs-display` | 30px | Empty-state line. `-.032em`, `text-wrap:balance` |
| `--fs-title` | 19px | Section headings |
| `--fs-body` | 15px | Messages, composer |
| `--fs-sub` | 13.5px | Supporting sentence, max 34ch |
| `--fs-meta` | 11.5px | Status strip, chips, hints |

Real steps (~1.25), so a heading reads as one. Monospace (`--mono`) is for **measurements
only** — counts and figures, `tabular-nums` so the strip does not twitch. Words stay in the
system face; mono as atmosphere is a costume.

## Icons

Drawn SVG, one 1.5 stroke, 14px via `.ico`, aligned to text with a 6px gap. No Unicode glyphs,
no emoji. `⟳ ⌫ ◇ ◆` were all replaced.

## Elevation

`--sh-1/2/3`, all offset plus blur, all neutral black. No coloured glow — a chromatic halo is
decoration, and on a security product a red one is theatre.

## Composition

- Titlebar 44px, sidebar 252px on `--surface` with a `--border2` edge, so the panel reads as a
  panel rather than a slightly different black.
- Status strip under the titlebar: state, where analysis runs, count, retention. This is how
  silence stays legible — the app is quiet because nothing is wrong, not because it is off.
- **Empty conversation** (`#chat-panel.is-empty`, toggled by `setEmptyLayout()` in
  `renderer.js`): feed stops claiming leftover height and the composer joins the block, so
  mark, line, sentence, openers and input read as one centred group. `7vh` bottom padding
  because a block on the true midline reads low. The moment a message exists, the feed grows
  and the composer settles to the floor on its own.
- Six openers, one primary (`.is-primary`, `order:-1`). Without a lead they read as a wall.
- Composer measure capped at 680px.

## Motion

120–150ms, exponential ease-out, mechanical rather than animated. One authored moment per
state change. Nothing loops: the danger icon enters once and stops, and honours
`prefers-reduced-motion`.

## Known debt

- **Light theme still has ~20 contrast failures** from colours hardcoded outside the token
  system. Pre-existing; dark is clean at 0.
- `#search-go-btn` / `#search-ai-btn` are dead CSS from the removed search BrowserView — no
  markup, no JS.
- `#drop-preview-img` ships with an empty `src`. Hidden container, so never a broken box, but
  the detector flags it.
