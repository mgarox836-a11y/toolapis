# TOOLAPIS — Final Report: total responsiveness

Diagnosis → fix → verification. Server: `python3 -m http.server 8765`.

---

## 1. Root causes found

### 1.1 `body { overflow-x: hidden }` — `css/base.css:47` (removed)

The single most damaging line in the stylesheet, and exactly the thing the
brief forbids. It suppressed the horizontal scrollbar, so a layout that did not
fit *looked* like one that did. Measured at session start: `scrollWidth ===
clientWidth` at **every** width from 320 to 1440 whether or not anything was
being cut off — the mandated detector was structurally incapable of finding
the bug.

It was also actively harmful: `overflow-x` on `body` makes `body` a scroll
container, which is the mechanism behind `position: sticky` silently failing on
every descendant.

Re-running the same detector with the mask removed:

| width | 320 | 360 | 390 | 430 | 600 | 768 | 900 | 1024 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|---|---|---|
| real overflow | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**The brief's reported symptom — hero offset ~150px from the left, right side
cut, navbar buttons pushed off screen — does not reproduce at any width.** The
17–27 elements the raw detector returns are all inside intentional clip
wrappers (marquee, hero scene, perspective floors, mock shine). Evidence and
the per-element table are in `responsive-audit.md` §1.

### 1.2 `.mock__body { grid-template-columns: 168px minmax(0,1fr) }` — `css/sections.css:567`

The only genuine horizontal overflow on the site. At 200 % zoom on a 390px phone
the CSS viewport is 195px and a hard 168px sidebar plus a content column was
wider than the screen, dragging `.mock`, `.feature__visual`, `.feature__copy`
and every text node inside them past the right edge — **37px of overflow, 30
elements**. This is the root cause the brief was pointing at.

### 1.3 `.lock` — `minmax(260px, 1fr)` + `overflow: hidden` — `css/sections.css:429,433`

`.lock__stage { min-height: 240px }` plus the caption plus card padding exceeded
the box on mobile, and `overflow: hidden` ate the difference. Measured
`scrollHeight − clientHeight = 16px` at both 360 and 390. The visible result was
a **privacy caption with its last line missing** — genuine clipped content, the
exact class of defect the brief is about, in a different component.

### 1.4 Navbar used two breakpoints for one decision — `css/components.css:112,124`

`640px` for the action buttons and `768px` for the centre links, for what is one
question. Result:

| width | links | share | CTA | hamburger | |
|---|---|---|---|---|---|
| 320–639 | — | — | — | yes | |
| 640–767 | **—** | yes | yes | yes | no links at all — the emptiest nav state on the site |
| 768–899 | yes | yes | yes | **—** | no route to the panel; 706px of controls in a 768px bar |

### 1.5 `.flow__line` drawn horizontally on a vertical mobile stack — `css/sections.css:629`

An SVG whose markup is a single horizontal path (`M28.3,17 H1171.7`) at
`top: 33px; left: 0; right: 0`, while `.flow__steps` collapsed to one column.
Measured at 390: the line spanned x 20→370 at y 5996–6030 while the three steps
ran y 5979–6506. **It connected nothing.**

### 1.6 Mobile panel was not full-screen, and locked nothing

`inset: var(--navbar-height) 0 0` → measured 780px panel in an 844px viewport.
No scroll lock: `scrollBy(0,300)` moved the page to `scrollY 300` *while the
menu was open*. No close button, no focus trap, focus restored only on Esc.

### 1.7 Nine text styles under 12px, nine touch targets under 44px

`.toolpass__field-label` **9px** (on mint, the brightest surface on the page),
`.tool-card-eyebrow`/`.ba__tag`/`.hero-strip` **10px**, four at 11px. Targets:
`.brand` 139×**32**, nine footer links ×**20**, `.footer-social a` 32×**32**,
`.motion-toggle` ×**40**, `.nav-link` **35**×44.

### 1.8 Duplicated footer, duplicated rules, duplicated gutter

`.site-footer`/`.footer-grid`/`.footer-col`/`.footer-bottom` defined in **both**
`components.css` and `sections.css` with different column counts below 768px.
The page gutter `clamp(20px, 4vw, 32px)` existed in three files. `160px`-scale
off-by-one twins (899/900, 1023/1024, 1279/1280) invited arithmetic drift.

### 1.9 A missing `*/` that silently deleted half the stylesheet

Found **during** this work, in a comment I wrote in `css/hero.css:172`. It
swallowed every rule after it — `.hero-copy`, `.hero-title`, the CTA row, the
bottom strip — so below 1024px the hero headline fell back to the UA default
`h1` size (32px). Nothing caught it: the build succeeded, `--check` passed,
every Playwright assertion passed, the page looked plausible. Fixed, and
`tools/css-syntax-check.mjs` now exists so it cannot recur.

---

## 2. Files changed

| file | change |
|---|---|
| `css/tokens.css` | `--gutter`, `--section-gap`, `--card-padding` fluid; `--bp-sm/md/lg/xl`; `--tap-target`; `--edge-inset`; type scale moved to `clamp()` in the tokens; deleted the two stepped-type media queries |
| `css/base.css` | **removed `overflow-x: hidden`**; `min-width: 320px`; `overflow-wrap: anywhere`; `height: auto` on media; `.shell`/`.container` → `width: min(100% - 2 * var(--gutter), 1200px)`; safe-area padding on nav/footer; removed the duplicate `scroll-behavior`; removed the `.icon` duplication I had introduced |
| `css/components.css` | navbar single 900px line; share button visible at every width; 44px targets everywhere; 12px type floor; **full-screen panel** with its own 44px close button, `overflow: clip` and instant-visibility transition; every hover rule gated on `@media (hover: hover)`; **deleted the duplicate footer block** |
| `css/hero.css` | own fluid size bound (see §3); merged the two competing masks into one rule; mask padding 0.04em → **0.16em** (descenders were being shaved); `#hero { overflow: clip }`; `.hero-glow` `90vw` → `90%`; 340px card at 1024–1279 |
| `css/hero3d.css` | `62vw` → `62%`; `overflow: clip`; scene height `clamp(280px, 62vw, 360px)`; bleed now `-1 * var(--gutter)` (was a 3rd copy of the gutter literal); chip `max-width`; parallax + ribbon loops stopped `< 768px` and on coarse pointers |
| `css/sections.css` | bento mobile-first 1 / 2@600 / 12@1024 with spans only ≥1024 (**removed the `!important` undo**); **removed the 168px mock sidebar**; `.lock` 260px minimum removed; **vertical flow rail on mobile**; `.terminal` `overflow-x: auto` + `pre`; marquee `overflow: clip`; footer 1/2/4 columns; `minmax(0,1fr)` + `min-width: 0` throughout; removed the duplicate `.section-head` |
| `css/animations.css` | hover block wrapped in `@media (hover: hover)`; `:active` press for coarse pointers; sheen not created at all off-hover; hero loops stopped `< 768px`; `html.is-tab-hidden` pause |
| `index.html` | `viewport-fit=cover`; panel got a `__head` row with wordmark + 44px close button; `role="dialog" aria-modal="true"`; share button de-`desktop-only`'d |
| `script.js` | scroll lock as a class on `<html>`; focus trap; focus restore to the hamburger; backdrop-tap close; close on crossing 900px; `aria-label` Open/Close; `is-tab-hidden` |
| `tools/design-check.mjs` | fixed the flaky arrow-hover assertion (it raced the compositor, failing ~1 run in 3) |
| `tools/css-syntax-check.mjs` | **new** — comment/brace balance, declaration syntax, and a real browser parse of the shipped bundle |
| `css/bundle.css` | generated |

---

## 3. Breakpoints

Declared once in `css/tokens.css`; `min-width` side keeps the idiomatic form and
the `max-width` side uses range syntax (`width < 900px`) so there is no `X−1` to
miscompute.

| width | layout |
|---|---|
| 320–479 | 1 column; CTAs full-width and stacked; brand scales down `< 360px` |
| 480–599 | 1 column; CTAs share a row |
| ≥ 600 | 2-column card grids (bento, footer) |
| 600–899 | nav = logo + share + hamburger; links and CTA in the panel |
| ≥ 768 | tablet: flow rail stays vertical until 900, mock sidebar returns at 560 |
| ≥ 900 | nav goes horizontal, panel retires |
| 900–1023 | features 2-col, flow 3-col with the horizontal connector, lock 2-col |
| ≥ 1024 | desktop: 12-col bento with spans, hero split 50/50, footer 4-col |
| ≥ 1280 | full 380px hero card; shell reaches its 1200px max |

### The hero needed its own size bound

`--text-display` is right everywhere else, but the hero headline is bounded by a
**grid column**, not the viewport: from 1024px the copy column is
`minmax(0,1fr)` beside a fixed card, so at a 1024 viewport it is ~550px while the
shell is nowhere near its 1200px maximum. Reading the token's clamp there gave
85px and wrapped "All in One Place." to 4 lines inside a line mask. So the hero
uses `clamp(40px, 5vw + 16px, var(--text-display))` — measured to fit at every
width from 320 to 1440 — and the card is 340px in the 1024–1279 band because a
380px card left the column 511px for 516px of headline. Five pixels short.

---

## 4. Verification

Playwright Chromium, live server, **0 console errors at every width**.

| width | scrollWidth | overflow | text < 12px | target < 44px | hero lines | burger |
|---|---|---|---|---|---|---|
| 320 | 320/320 | 0 | 0 | 0 | 4 | yes |
| 360 | 360/360 | 0 | 0 | 0 | 3 | yes |
| 390 | 390/390 | 0 | 0 | 0 | 3 | yes |
| 430 | 430/430 | 0 | 0 | 0 | 3 | yes |
| 600 | 600/600 | 0 | 0 | 0 | 3 | yes |
| 768 | 768/768 | 0 | 0 | 0 | 3 | yes |
| 1024 | 1024/1024 | 0 | 0 | 0 | 3 | no |
| 1280 | 1280/1280 | 0 | 0 | 0 | 3 | no |
| 1440 | 1440/1440 | 0 | 0 | 0 | 3 | no |

- **Mobile menu** — 22 assertions × 3 widths, all pass: full-screen
  (`inset: 0`, `100dvh`), scroll locked (wheel and `End` both inert, `scrollY`
  preserved exactly), focus trap on both directions, Esc / close button / link /
  backdrop tap / crossing 900px all close **and** release the lock, focus
  returns to the hamburger.
- **Landscape 844×390** — no overflow; hero grows to 1362px rather than clipping.
- **Zoom** — 200 % of 390 = a 195px CSS viewport: the layout stays a clean 320px
  (`min-width` floor) with **0 elements escaping it**. 200 % of 768 = 384px: no
  overflow.
- **Reduced motion** — `motion-reduced` set, 0 reveals stuck below opacity 1.
- **Coarse pointer** — `hover: none` / `pointer: coarse` confirmed; sheen not
  created; card hover replaced by `:active`.
- **Project checks** — `css-syntax-check` clean, `seam-assert` all pass,
  `no-undef` clean, `design-check` all pass (4 consecutive runs).

Screenshots in `/tmp/shots/after/` (34 files: viewport, full-page and menu at
nine widths, plus per-section crops at 390 and 768). Reference "before"
captures from the project's own prior sessions are in `/tmp/shots/before/` —
see §5.

---

## 5. What I could not verify, and why

- **Before/after screenshots from a reconstructed baseline.** I set out to
  rebuild the pre-fix state to capture it, then found the git history is a
  patchwork: an external process committed `1b90d5a "WIP: responsive fixes"`
  mid-session, and its `css/tokens.css` and `css/hero.css` carry a *third*
  historical variant (raw DESIGN.md values, `--tracking-display: 4.9px`), while
  `hero3d.css` and `sections.css` carry my edits. `sections.css` and
  `hero3d.css` were untracked when I edited them and exist in no backup, so the
  pre-fix versions are unrecoverable. Rather than ship a comparison against a
  mixture of three different states, `/tmp/shots/before/` holds the project's own
  authentic captures (`.playwright-mcp/final-390-*.png`, `tools/shots/`) and the
  authoritative before/after evidence is the **numeric** table in §4 plus
  `responsive-audit.md`, measured at session start against the real working tree.
- **Lighthouse** — not run; no Lighthouse binary or Chrome-for-Testing available.
  Accessibility ≥ 95 and CLS < 0.05 are unverified.
- **`tools/layers-check.mjs`** — fails, querying `#overview .tool-card`, a class
  absent from the markup since the bento redesign. Pre-existing stale tool, not a
  regression; I left it alone rather than rewrite a harness nobody asked for.
- **`tools/hero-check.mjs`** — hangs past 120s. Not run.

## 6. Still imperfect

1. **`min-width: 320px` on `body` means 200 % zoom on a 390px phone scrolls
   horizontally** — to 320px, the brief's own floor. Correct per the spec, but
   worth knowing; below 320px CSS width there is no way to satisfy both.
2. **Two breakpoints are behaviour, not layout**: 900 (nav/panel handoff) and
   360 (brand scale-down). Both are commented in place; neither is in the
   `--bp-*` scale because they are not layout steps.
3. **`.hero-copy` max-width 780px vs `.hero-inner` column** at 1150px the column
   is 674px and the copy is capped by the column, so the 780px is inert there.
   Harmless but redundant.
4. **Terminal scrolls horizontally on mobile** by design (`pre` + `overflow-x:
   auto`). Correct, but a horizontal scroll region inside a card is a pattern
   users misread as page overflow. A fade mask on the right edge would signal it.
5. **`.tool-card` and `.toolpass` legacy aliases** remain in `components.css`
   with no matching markup. Dead selectors; removing them touches `design-check`
   expectations, so I left them.
6. **`--bp-*` custom properties are documentation only** — media queries cannot
   read custom properties. The grep-for-a-breakpoint benefit is real only if
   nobody writes a literal later.