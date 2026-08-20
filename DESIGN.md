# Tetra — design system

Light, quiet, and built the way iOS builds a screen. Every value below was
measured rather than eyeballed: contrast from sRGB relative luminance, colour
separation via the Viénot–Brettel–Mollon dichromat transform, and the colour
ramp generated on a fixed OKLCH lightness ladder.

The tokens live in [frontend/src/index.css](frontend/src/index.css) and
[frontend/tailwind.config.js](frontend/tailwind.config.js). This file explains
the decisions behind them.

---

## The one structural idea

**The page is grey and the cards are white.**

That inversion is the largest single lever on whether an interface reads as
Apple's or as a generic web app, and it is the *opposite* of Material, where
surfaces get lighter as they rise. White on `#F5F6F8` is a 1.09:1 step — barely
a step at all, which is exactly right. Get it right and elevation needs almost
no shadow: the App Store separates a card from the page with nothing more.

Consequences that follow from it:

- A card is `bg-card` with a hairline `border-border` and a very soft ambient
  shadow. Never both a heavy border and a shadow — that is the tell of a system
  that hasn't decided which one conveys depth.
- A surface nested *inside* a card goes **down**, not up: `bg-subtle`. There is
  no fourth elevation and there should never be one.
- Nothing exceeds `0.14` shadow alpha, nothing uses spread, and every blur
  radius is at least three times its y-offset.

## Colour

**The canvas is starved of chroma so one hue can be an event.** The page carries
a chroma of roughly 0.004; the primary carries 0.221. That sixty-fold ratio *is*
what "pop" means. It is not achieved by adding hues — every product that reads
as premium here (Linear, Stripe, Ramp, Monzo) uses exactly one.

| Role | Token | Value |
| --- | --- | --- |
| Page | `bg-background` | `#F5F6F8` |
| Card | `bg-card` | `#FFFFFF` |
| Well inside a card | `bg-subtle` | `#F4F5F8` |
| Hairline | `border-border` | `#E4E4E9` — 1.27:1 |
| Ink | `text-foreground` | `#16161A` — 18:1 |
| Reading text | `text-muted-foreground` | `#5B5C66` — 6.6:1 |
| Non-text only | `text-faint` | `#8A8B95` — 3.4:1 |
| Primary | `bg-primary` | `#5055EB` — 5.47:1, white text passes AA |
| The pop | `text-pop` | `#AB4AFB` |

**Hierarchy is carried by weight and opacity, never by colour.** Headline and
body are the same size in iOS; only the weight differs. Colour means "actionable"
or "status" and nothing else, which is why no body text in this app is ever the
primary hue.

### Green and red

The default fintech pair (`#16A34A` / `#DC2626`) collapses to a ΔE of **0.055**
under deuteranopia — for roughly one man in sixteen, a gain and a loss are the
same swatch. So green is pulled toward teal and red toward vermillion:

- `--positive` `#00A77F`, `--positive-text` `#008665`
- `--destructive` `#F96245`, `--destructive-text` `#D54124`

That lands at ΔE **0.156**, nearly triple the separation, and still reads
unmistakably as green and red to everyone else. Each family carries a **fill**
(bars, dots, icons) and a **text** grade at 4.5:1 — using the fill for text is
the classic way a good palette fails an audit.

Colour is never the only channel regardless: every delta in the app carries a
sign and an arrow.

### Charts

Eight hues, found by exhaustive search under three constraints held at once:
≥3:1 on both white and the page grey, ≥0.115 ΔE apart in normal vision, and
worst-case dichromat separation maximised. They beat Okabe-Ito on protanopia
(0.087 vs 0.083) and tie on deuteranopia, while every swatch clears 3:1 — which
three of Okabe-Ito's do not.

**The lightness alternation is the load-bearing part.** The slots run
L ≈ 0.46 / 0.62 / 0.54 / 0.62 / 0.62 / 0.46 / 0.58 / 0.46, and that zigzag is
what a dichromat actually reads. Contrast-locking Okabe-Ito to a flat lightness
collapses its separation from 0.091 to 0.007. So: **assign by slot, never
re-sort into a tidy ramp, never generate a ninth.**

A category's hue comes from its *name* (`colorForName`), not its rank. Assigning
by position means a category changes colour the moment a payment reorders the
list, which destroys the reader's ability to follow one thing across two charts.

## Typography

**Inter**, variable, with the optical-size axis loaded:

```
https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap
```

The `opsz,wght@14..32,100..900` range matters. Request a bare family and Google
serves a pinned instance, the axis silently disappears, and large type renders as
small type scaled up. `-apple-system` leads the stack so Apple hardware gets the
genuine article.

The scale is Apple's Dynamic Type ladder. Sizes are in px because on a phone the
browser reports the layout viewport in CSS pixels equal to iOS points — `17px`
here is literally Apple's 17pt Body.

| Token | Size | Weight | Tracking |
| --- | --- | --- | --- |
| `text-display` | 40 | 700 | −0.032em |
| `text-title-1` | 28 | 700 | −0.024em |
| `text-title-2` | 22 | 700 | −0.02em |
| `text-title-3` | 20 | 600 | −0.019em |
| `text-headline` | 17 | 600 | −0.017em |
| `text-body` | 17 | 400 | −0.014em |
| `text-row` | 17 | 400 | −0.014em, tighter leading for list rows |
| `text-callout` | 16 | 400 | −0.014em |
| `text-subhead` | 15 | 400 | −0.011em |
| `text-footnote` | 13 | 400 | −0.004em |
| `text-caption` | 12 | 400 | 0 |
| `text-micro` | 11 | 600 | +0.006em |
| `text-overline` | 11 | 700 | +0.07em, uppercase |

Two notes on the tracking column. Apple's own curve is non-obvious — tightest at
17–20pt and *loosening* again at 34 — because SF Pro's optical-size axis has
already tightened the letterforms by display sizes. Inter carries the same axis
and `font-optical-sizing: auto` feeds it. But Inter's axis **clamps at 32**, so
`display` carries a manually heavier −0.032em; without it a large balance figure
looks scaled rather than set.

### Numerals

Inter's proportional digits span 833 to 1323 units — a `1` is dramatically
narrower than a `0`. In a right-aligned money column that makes digits jitter
between rows, and any figure that animates visibly shudders as digits swap. The
`.tnum` class maps all ten to one advance.

Applied to money, table cells, stat values and axis labels — and **never to
prose**, where proportional figures genuinely read better. That is exactly what
iOS does: monospaced digits are opt-in per label, not a global.

### Formatting money

Four formatters, in [frontend/src/lib/money.ts](frontend/src/lib/money.ts):

| Function | Output | Where |
| --- | --- | --- |
| `exact` | `₹12,34,567.89` | Ledgers, edit forms, chart tooltips |
| `smart` | `₹4,786` or `₹4,786.50` | List rows, chips, day headers |
| `rounded` | `₹12,34,568` | Stat tiles, headlines, prose |
| `compact` | `₹1.2L` | Axis ticks, dense labels |

**The locale is derived from the currency, never from the user.**
`Intl.NumberFormat('en-IN', {currency: 'USD', notation: 'compact'})` returns
`$12.3L` — a real bug waiting in any app that picks them independently. The
corollary is a nice one: `en-IN` already speaks Indian natively, emitting `₹1.2L`
and `₹1.2Cr` on its own. There is no lakh/crore arithmetic anywhere in this
codebase, and any that appears is a bug that hasn't been noticed yet.

## Geometry and motion

A strict 4pt grid: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 44. Nothing uses a 5, 6, 10,
14, 18 or 30.

Radii: `sm` 8, `md` 12, `lg` 16, `xl` 20 (cards), `2xl` 24 (hero cards),
capsule for every button and chip — the iOS 26 control shape.

Motion tokens are `linear()` easings computed from SwiftUI's own spring
parameters (ω = 2π/duration, ζ = 1 − bounce). The reason to bother: nothing on
iOS decelerates linearly, every arrival is asymptotic, and a cubic-bezier can
imply a spring but cannot produce the settle. `--ease-ios` (0.32, 0.72, 0, 1) is
the sheet-and-navigation curve.

Only `transform` and `opacity` are animated. Never height, never top.

**Reduced motion means cross-dissolve, not "no animation"** — a transition that
vanishes entirely removes the causal link between a tap and its result, which is
worse for comprehension than the movement was. Transforms are killed; opacity is
kept.

## Materials

Glass belongs to the **functional layer only** — the top bar and the floating tab
bar. Apple's guidance is explicit about this, and for a money app it is doubly
true: a translucent background behind a column of figures destroys the contrast
that makes them scannable. Every card, table and chart in this app stays on
opaque white.

The `inset 0 1px 0 rgba(255,255,255,.6)` highlight in `.glass` is doing more work
than the blur — it is the specular top edge of a piece of glass.

Deliberately skipped as gimmick: SVG displacement-map "refraction", cursor-tracked
speculars, morphing blobs between adjacent buttons, and glass on content cards.

## The responsiveness rules that must not be broken

These were hard-won and are load-bearing. Every one of them has a comment at its
site explaining why.

1. **`overflow-x: clip` on both `html` and `body`.** Clipping body alone hands
   the overflow to html by the viewport propagation rules, and the page pans
   sideways anyway. `clip`, not `hidden` — `hidden` makes the element a scroll
   container and silently kills every `position: sticky` descendant.
2. **`min-w-0` on every flex child that contains text.** A flex child defaults to
   `min-width: auto`, so one long unbroken string forces the column wider than
   the viewport.
3. **`grid-cols-[minmax(0,1fr)]` on the dialog.** A grid track defaults to "as
   wide as the widest child"; pinning it inverts that so children shrink to the
   dialog rather than the dialog growing to the children.
4. **16px minimum font size on touch inputs.** iOS Safari zooms the viewport on
   focus for anything smaller and never zooms back.
5. **`overscroll-behavior: contain` on every inner scroller.** Without it a swipe
   past the end of a filter row hands the gesture to the document.
6. **`dvh`, never `vh`.** iOS resolves `vh` against the toolbar-retracted
   viewport, leaving ~100px of phantom scroll.
7. **44px minimum touch targets**, tightening to the denser pointer scale at `md`.
8. **`touch-action: manipulation` and no tap highlight** on every control, and no
   text selection on buttons — a mis-timed tap that selects text instead of
   pressing is the single biggest reason a web app feels "not tactile".
9. **Safe-area insets** via `--topbar-height` and `--tabbar-height`, so the
   numbers live in exactly one place.

A screenshot pass across all ten routes at 393px and 1440px asserts zero
horizontal overflow and zero console errors.

## Anti-patterns this design deliberately avoids

- **Binary red/green scoring.** Pace framing throughout: "running ahead", not
  "over budget". Red means "you failed", and people delete apps that call them
  failures.
- **A dashboard-first home screen.** A wall of charts has no verb in it. Home
  opens with a *decision* (how much can I spend today), then *judgement*, then
  record.
- **Streaks on outcomes.** The streak counts logging days — the one thing the
  person fully controls — never no-spend days or days under budget.
- **Gradients as decoration.** A gradient is a claim about depth that a flat
  surface makes better, and it is the first thing that dates an interface.
- **Insights that restate the screen.** Every insight must name a decision and
  carry a figure.
