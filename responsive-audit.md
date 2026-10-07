# TOOLAPIS — Responsiveness Audit (BEFORE fixes)

Server: `python3 -m http.server 8765` → `http://localhost:8765/index.html`
Probe: Playwright Chromium, widths 320/360/390/430/500/600/640/700/767/768/899/900/1024/1280/1440,
plus 844×390 landscape and 200 % zoom.

---

## 0. Viewport meta

`index.html:80`

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

Present and correct on the two things that matter (`width=device-width`,
`initial-scale=1`). **Missing `viewport-fit=cover`**, which section 2/4 of the
brief requires for `env(safe-area-inset-*)` to be meaningful on notched
devices. Fix: add it.

---

## 1. The reported symptom does not reproduce as a horizontal scroll

The brief's screenshots (hero offset ~150 px from the left edge, right side
cut off, share/CTA/hamburger pushed off screen) are **not reproducible at any
tested width**, and the reason is the second-order finding below.

### 1a. `body { overflow-x: hidden }` is hiding the measurement

`css/base.css:47`

```css
body {
  ...
  overflow-x: hidden;   /* <-- line 47 */
}
```

This is exactly the anti-pattern the brief forbids. Consequence: the mandated
detector always returns `scrollWidth === clientWidth` at **every** width,
whether or not the layout actually fits. Measured:

| width | `documentElement.scrollWidth` | `clientWidth` | apparent overflow |
|-------|------------------------------|---------------|-------------------|
| 320   | 320 | 320 | 0 |
| 360   | 360 | 360 | 0 |
| 390   | 390 | 390 | 0 |
| 430   | 430 | 430 | 0 |
| 500   | 500 | 500 | 0 |
| 600   | 600 | 600 | 0 |
| 768   | 768 | 768 | 0 |
| 1024  | 1024 | 1024 | 0 |
| 1280  | 1280 | 1280 | 0 |
| 1440  | 1440 | 1440 | 0 |

Re-running the same probe with `body { overflow-x: visible !important }`
injected:

| width | real overflow after un-masking | unclipped offenders |
|-------|----------------------------------|---------------------|
| 320 – 1440 | **0** | **0** |

So the page genuinely does not overflow horizontally at the nine target
widths. The brief's screenshots must come from either the pre-redesign build
(`_backup_pre_redesign*/`) or a viewport narrower than 320 px. Both are
consistent with the layout being sound at ≥ 320 px while `overflow-x: hidden`
keeps the diagnostic blind.

### 1b. The offenders that DO appear are all inside intentional clip wrappers

With the mask still in place, the raw detector returns 17–27 elements. Every
single one is inside a clipping ancestor and is correct by design:

| element | file:line | clipped by | verdict |
|---|---|---|---|
| `.marquee__track` + 14 `.marquee__item` + 2 `.marquee__group` | `css/sections.css:39`, `:49`, `:54` | `.marquee { overflow: hidden }` `sections.css:34` | **intended** — a marquee is wider than the page by definition |
| `.hero-scene__floor` | `css/hero3d.css:108` (`inset: 42% -40% -70% -10%`) | `.hero-scene { overflow: hidden }` `hero3d.css:40` | **intended** — perspective floor bleeds |
| 5 × `path` in `.hero-ribbon` | `css/hero3d.css:123` (`overflow: visible`) | `.hero-scene` | **intended** — ribbon fades to transparent at both ends |
| 3 × `.mock__shine` | `css/sections.css:596` (`translateX(-100%)`) | `.mock { overflow: hidden }` `sections.css:536` | **intended** — pre-shine offset |
| `.cta-band__floor` | `css/sections.css:774` (`inset: 46% -30% -60% -30%`) | `.cta-band { overflow: hidden }` `sections.css:764` | **intended** |
| `.hero-glow` | `css/hero.css:71` (`right: -6%`) | `#hero { overflow: hidden }` `hero.css:30` | **intended** |

After removing the `body` mask and re-running, **zero** unclipped offenders at
320 / 360 / 390 / 500 / 600 / 768 / 900 / 1024 / 1280 / 1440.

---

## 2. Real defects found (these DO need fixing)

### 2a. Zoom / very narrow viewports genuinely overflow

200 % browser zoom is equivalent to halving the CSS viewport. At 390 px
desktop → **195 px CSS**, the layout overflows by **37 px**:

```
vw=195 sw=232  (overflow 37px)
```

Culprits, in order:

| # | element | file:line | why |
|---|---|---|---|
| 1 | `.mock__body { grid-template-columns: 168px minmax(0,1fr) }` | `css/sections.css:567` | **fixed 168 px column**. At 195 px viewport the mock's own sidebar alone is wider than the space. Root cause of ~20 of the 30 overflow elements (`.mock`, `.feature__visual`, `.feature__copy`, all their text descendants). |
| 2 | `.feature` grid track | `css/sections.css:493` | `grid-template-columns: 1fr` with no `minmax(0, …)`; the 168 px child forces the track wider than the viewport |
| 3 | `.lock { grid-template-columns: minmax(260px, 1fr) minmax(0, 1.1fr) }` | `css/sections.css:429` | **fixed 260 px minimum**; at <768 the `max-width:767px` override sets `1fr`, but `.lock__stage { min-height: 240px }` (`sections.css:448`) plus caption still overflows by 16 px (measured `lockOverflowPx: 16` at 360 and 390) |
| 4 | `#navbar > .shell` flex row | `css/components.css:38` | no `min-width: 0` on `.brand`; brand is `flex: 0 0 auto` (`components.css:52`) with `white-space: nowrap` wordmark (`components.css:76`). At 195 px `.navbar-actions` overflows to `r=227` (vw 195) |
| 5 | `.motion-toggle` | `css/components.css:707` | fixed 40 px min-height and nowrap label; label overflows to `r=202` |
| 6 | `.toolpass { width: min(360px, 100%) }` | `css/components.css:486` | OK today, but the 360 px is a fixed px floor that only survives because `100%` wins — fragile |

Note the brief's 200 % zoom check is on the acceptance list, so 2a must be
fixed even though it is not visible at ≥ 320 px.

### 2b. Mobile menu is missing required behaviour

`script.js:240–279` + `css/components.css:605–639`. Measured at 390×844 with
the menu open:

| requirement | status |
|---|---|
| opens on hamburger click | ✅ |
| `aria-expanded` flips | ✅ |
| closes on Esc | ✅ (`script.js:273`) |
| closes on link click | ✅ (`script.js:269`) |
| closes on outside click | ✅ (`script.js:270`) |
| **`position: fixed; inset: 0; height: 100dvh`** | ❌ `inset: var(--navbar-height) 0 0` — measured height 780 px, viewport 844 px. It is *not* full-screen. |
| **background `#070707`** | ✅ |
| **close button 44 px** | ❌ none in the markup |
| **scroll lock while open** | ❌ `scrollY` went `0 → 300` while the menu was open; `documentElement` overflow is `visible`, body is `static`. Nothing locks. |
| **focus trap** | ❌ none |
| **focus returns to hamburger on close** | partial — only on the Esc path (`script.js:276`) |
| **stagger animation** | ✅ `animations.css:288–292` |
| **`viewport-fit=cover` safe area** | ❌ |
| link font 32 px display | ✅ measured 81 px tall rows |

### 2c. Navbar breakpoint is incoherent (two competing answers)

`css/components.css` uses **640** and **768**; the brief specifies **900** for
"links + CTA move into the panel". Measured:

| width | centre links | share btn | HD Enhancer CTA | hamburger |
|---|---|---|---|---|
| 320–639 | hidden | hidden | hidden | shown |
| 640–767 | **hidden** | shown | shown | shown |
| 768–899 | shown | shown | shown | **hidden** |
| 900+ | shown | shown | shown | hidden |

Problems:
- **640–767 px has no centre links at all** — the widest, emptiest nav state.
- **768–899 px shows all four groups and no hamburger**, so there is no way to
  reach the panel that also holds the mobile CTAs; at 768 px the nav row is
  `311px links + 44px share + 136px CTA + brand 139px + gaps` = 706 px of a
  768 px bar, only 62 px of slack.
- Brief §4 wants: `< 900 px` → logo + share + hamburger, links and CTA in the
  panel. Nothing currently implements that.
- Brief §3 wants `min-width: 600 px` as a breakpoint; **640 px appears
  nowhere** in the brief's scheme.

### 2d. Text below 12 px

Brief §7: "tidak ada teks < 12 px". Measured at every width:

| element | size | file:line |
|---|---|---|
| `.toolpass__field-label` | **9 px** | `css/components.css:522` |
| `.tool-card-eyebrow` (`i`) | **10 px** | `css/components.css:345` |
| `.ba__tag` | **10 px** | `css/sections.css:208` |
| `.hero-strip-left/right` | **10 px** | `css/hero.css:276` |
| `.toolpass__label` | 11 px | `css/components.css:503` |
| `.ba__stats` | 11 px | `css/sections.css:271` |
| `.mock__url` | 11 px | `css/sections.css:562` |
| `.feed__avatar` | 11 px | `css/sections.css:376` |

### 2e. Touch targets below 44 px

Brief §7: "Target sentuh ≥ 44 px". Measured offenders:

| element | measured | file:line |
|---|---|---|
| `.brand` (navbar logo) | 139×**32** | `css/components.css:48` |
| `.footer-col a` ×9 | e.g. 61×**20** | `css/sections.css:830` |
| `.footer-social a` ×2 | 32×**32** | `css/sections.css:867` |
| `.motion-toggle` | 163×**40** | `css/components.css:707` |
| `.nav-link` | **35**×44 | `css/components.css:82` |
| `.acc__btn` min-height | ~40 px at mobile | `css/sections.css:706` (`padding: 24px 0` — passes, but no explicit floor) |

### 2f. `flow` connector is horizontal on mobile

`css/sections.css:629` positions `.flow__line` at `top: 33px; left: 0; right: 0`
— a horizontal 280–350 px line — while `.flow__steps` collapses to one column
at `< 900 px` (`sections.css:653`). Measured at 390 px: line spans
`l=20 r=370` at `y=5996–6030`, but the three steps run at `y=5979–6506`
vertically. The connector is drawn **across the top of a vertical stack**,
connecting nothing. Brief §4 requires a vertical rail on the left.

### 2g. `.lock` overflows its own box by 16 px on mobile

`.lock { overflow: hidden }` (`sections.css:433`) + `min-height: 260px`
(`:432`). Measured `scrollHeight − clientHeight = 16 px` at 360 and 390 px.
The clip hides 16 px of the caption/panel — this is exactly the "konten
terpotong" class of bug the brief is about, in a different component.

### 2h. `.terminal` uses `pre-wrap` rather than a scroll container

`css/sections.css:299` — `.terminal__line { white-space: pre-wrap }`. This
happens not to overflow today, but `adb reverse tcp:8000 tcp:8000` at 13 px
mono is 30 chars ≈ 234 px, which fits only because the line wraps. Brief §4
wants `overflow-x: auto` inside the block; also `.terminal` has no
`max-width: 100%`.

### 2i. `.hero-title-line` / `.word-mask` clip their own text

`css/hero.css:196–202`. `overflow: hidden` on a line mask is correct for the
reveal, but the measured detector reports `SPAN.accent "Web Tools"` as
clipped at **every** width. Root cause: `.word-mask { padding-bottom: 0.04em }`
is thinner than the descender box of the 400-weight display face at 44–88 px,
so the bottom of "Web Tools" is genuinely shaved. Same for all `.word-reveal`
spans. Needs more bottom padding, not removal of the mask.

### 2j. `html { scroll-behavior: smooth }` unconditional

`css/base.css:27`. `animations.css:335–336` then re-states it per motion class.
The base rule wins on cascade for anyone who has not set a class, so smooth
scroll survives `prefers-reduced-motion` in the pre-class window. Minor, but
it is a duplicate source of truth for the same decision.

### 2k. No `(hover: hover)` / `(pointer: coarse)` gating in CSS

Brief §3 and §5 require hover effects to be gated on `hover: hover` and touch
targets on `pointer: coarse`. Every hover rule in `components.css` and
`sections.css` (`.card:hover`, `.btn:hover`, `.spot-card:hover::before`,
`.footer-col a:hover`, `.motion-toggle:hover`, …) is ungated. JS already
checks `(pointer: fine)` (`script.js:41`, `hero3d.js:48`, `motion-fx.js:82`,
`hero-extras.js:42`) and `widgets.js:376` checks `!('ontouchstart' in window)`,
so the CSS is the only ungated half.

### 2l. Marquee speed / clip

`.marquee { overflow: hidden }` (`sections.css:34`) — brief §4 asks for
`overflow: clip` (no scroll container). Font is already 12 px ✓, duration 38 s
✓, and it does not widen the page ✓. Only the clip primitive needs changing.

### 2m. Fluid-type clamps not applied to the display face at small sizes

`css/base.css:115` — `.t-display { font-size: clamp(44px, 8.6vw, var(--text-display)) }`.
Brief §2 wants `clamp(40px, 9vw + 8px, 88px)`; the 44 px floor is above the
brief's 40 px, which is the wrong direction at 320 px. `.hero-title`
(`hero.css:190`) uses `clamp(44px, 6.6vw, …)` — same floor issue. Brief §4
wants max 5 lines at 360 px; measured **4 lines** ✓ already.

### 2n. Missing universal container / gutter token

Brief §2 asks for `.container { width: min(100% - 2 * var(--gutter), 1200px) }`
with `--gutter: clamp(16px, 5vw, 40px)`. The project has `.shell`
(`css/base.css:203`) with `padding-inline: clamp(20px, 4vw, 32px)` — a
*different* gutter value, and the same value is duplicated as a literal in
`hero3d.css:59` and `hero.css:274`. Three sources for one number.

---

## 3. What is already correct

Worth recording so the fixes do not regress it:

- No horizontal overflow at 320–1440 px (verified with the mask removed).
- Hero headline: 4 lines at 360 px (budget is 5), never clipped horizontally.
- `#hero { min-height: 100svh }` — already `svh`, not `vh` ✓.
- Bento collapses to 1 column `< 900 px` ✓, spans only apply `≥ 1024 px` ✓.
- Bento cards use auto height, `min-height` nowhere ✓.
- `.feed__title` / `.feed__meta`: `min-width: 0` + nowrap + ellipsis ✓.
- `.feed__dot` has `flex: none` ✓.
- `.terminal` 13 px mono, `--color-graphite` ✓.
- `.bento > * { min-width: 0 }` ✓ (`sections.css:97`).
- `.ba` has `aspect-ratio: 16/10` and a real `<input type="range">` for
  keyboard + pointer ✓ (`sections.css:172`, `index.html:471`).
- Footer already 4 columns ≥ 768 px ✓ (`sections.css:819`).
- Marquee font 12 px, 38 s, does not widen the page ✓.
- 844×390 landscape: no overflow, hero grows past `100svh` rather than
  clipping ✓.
- 0 console errors at every width and in landscape ✓.
- `overflow-wrap` / `min-width: 320px` / `box-sizing` on body — **partially**
  present (`box-sizing` ✓ `base.css:16`; `min-width: 320px` ✗;
  `overflow-wrap: anywhere` ✗).

---

## 4. Plan of attack

1. **`css/tokens.css`** — add `--gutter`, mobile-first fluid type
   (`clamp()` in the token itself), `--section-gap` fluid, unify the three
   media queries into the brief's 600/768/1024/1280 scheme.
2. **`css/base.css`** — remove `overflow-x: hidden`; add `min-width: 320px`,
   `overflow-wrap: anywhere`, `img/svg/video/canvas { height: auto }`;
   `.shell` → the brief's `width: min(100% - 2 * var(--gutter), 1200px)`
   form; safe-area-aware padding for nav/footer; remove the duplicated
   `scroll-behavior`.
3. **`css/components.css`** — navbar single breakpoint at 900 px; 44 px
   targets; 12 px minimum type; full-screen mobile panel with a close button;
   `@media (hover: hover)` gating; remove the duplicated footer block that
   also lives in `sections.css`.
4. **`css/hero.css` / `css/hero3d.css`** — fluid display clamp, vertical
   scene height, `overflow: clip`, safe-area, `(hover: hover)` parallax,
   fewer animated elements `< 768 px`.
5. **`css/sections.css`** — `minmax(0, 1fr)` everywhere, `.mock__body`
   fluid, `.lock` no fixed min, **vertical** flow connector on mobile,
   `.terminal` `overflow-x: auto`, marquee `overflow: clip`.
6. **`css/animations.css`** — `(pointer: coarse)` and `(hover: hover)`
   gating; pause loops off-viewport.
7. **`index.html`** — add `viewport-fit=cover`, add the panel close button.
8. **`script.js`** — scroll lock via a class on `<html>`, focus trap, focus
   restore on every close path.
9. Rebuild `css/bundle.css`, then re-run the full probe + screenshots.
