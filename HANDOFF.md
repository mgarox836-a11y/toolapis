# HANDOFF — TOOLAPIS responsiveness pass

Status: **complete**. See `RESPONSIVE-REPORT.md` for the full report and
`responsive-audit.md` for the before-state measurements.

## Latest pass — the five-second entrance

Added 2026-10-10. Every load and every refresh now opens with a full-screen
entrance that runs for five seconds end to end, and every block of the page
arrives out of focus and resolves. **Read this section before touching
`css/animations.css`, `js/intro.js`, `css/intro.css` or the `<head>` scripts in
`index.html`** — three of the design decisions below were made because a
straightforward implementation of them broke the page in ways that only two of
the project's own checks could see.

### The schedule

`--intro-total`, `--intro-handover` and `--intro-exit` live on `:root` in
`css/intro.css` and are the only copy. `js/intro.js` reads them back; nothing
in JavaScript re-declares them.

| t | what |
|---|---|
| 0.00 | overlay fades up over Void Canvas; `intro-active`; the background goes `inert` |
| 0.26–1.16 | wordmark resolves from `blur(14px)` |
| 0.70 / 0.90 | progress rail, then the tabular counter and status line |
| 0–2.50 | rail fills 0→100%, counter climbs, status cycles through four lines |
| 2.50 | **handover** — overlay starts lifting, background released, `intro-complete` |
| 2.60–4.95 | navbar → eyebrow → headline → subtitle → CTA, each `blur(14px) → 0` |

The rail and counter deliberately measure `--intro-handover`, not
`--intro-total`. Measured against the whole entrance they stop dead at ~62% with
the rail half empty, which reads as a frozen progress bar; measured against the
overlay's own window the rail is full at the exact moment it stops being visible,
which is the only ending it could have that looks deliberate.

### Three decisions that are not obvious

**1. The entrance locks the scroll, and the lock costs nothing while the page is
at rest.**
Three layers, all released in one place — `finishIntro` in the `<head>` bootstrap —
and none of them is a per-frame loop:

1. `overflow: hidden` on `<html>` for exactly as long as `intro-active` is set, with
   the scrollbar's width handed back as `padding-right` (`--intro-gutter`, read once
   at DOMContentLoaded, the first moment the document is tall enough to own a
   scrollbar). A document with no scrollbar is ~10px wider than one with it, so a
   bare `overflow: hidden` slides the whole page sideways when it is applied and
   again when it is removed — twice per load, on every browser with classic
   scrollbars. The padding makes the content box identical locked and unlocked;
   measured, the shift is 0px.
2. Non-passive `wheel` / `touchmove` / `keydown` handlers that `preventDefault()`, so
   a scroll never starts. `Esc`, `Enter` and `Tab` are passed straight through — they
   are how the visitor skips and how they move focus.
3. One `scroll` listener that calls `scrollTo(0,0)` only when `scrollY !== 0`. This
   is the layer that catches a scrollbar drag and a scripted `scrollTo`, neither of
   which layer 2 can see, and it is the only thing in the lock that touches scroll
   position at all.

`history.scrollRestoration` is `'manual'` for the duration, and `scrollTo(0,0)` is
called at the four moments that matter — first script, DOMContentLoaded, `load`,
`pageshow` — so Chrome's own restore-on-refresh cannot drop the visitor mid-page
underneath the overlay. Measured: reloading from `scrollY=4000` reads `0` at every
sample through the entrance.

**`scrollbar-gutter: stable` was tried and rejected.** It is the textbook
compensation and it is wrong here: it reserves the gutter *unconditionally*, so it
changes the layout of the **unlocked** page too. Measured at 1366 with the page at
rest, the shell moved from left 83 to left 78 — five pixels off centre for the rest
of the page's life, on every browser, for every visitor including the ones who asked
for reduced motion. The compensation above costs 0px and exists only while the
entrance does.

Scrolling is **not** an exit any more. It used to be, and that was the bug this
whole pass exists for: the first gesture was cancelled by the lock and every
gesture after it scrolled, since the same gesture was what released the lock — so
the visitor got a document moving under a panel that was halfway out. The Skip
button, a tap, `Esc`, `Enter` and `Space` all still end it, and the Skip control is
right there saying what it does.

**2. `tl-display-settle` no longer animates `letter-spacing`.**
It did, and it re-ran text layout on every frame of a content-sized box. For
900ms that was invisible. The entrance gave the words a ~3s delay with a `both`
fill, which held the from-state for the whole entrance: the headline laid out
22px narrower than it rests at, for four and a half seconds, on every load.
`tools/check-overflow.mjs` caught it as the h1 measuring differently on a fresh
load than on a resized one. The keyframe is opacity + transform now, which is
also what the header comment of `css/animations.css` has always claimed.

**3. The release lives in the `<head>`, the choreography lives in the module.**
`index.html` defines `window.__tlIntro.release()` and `.finish()`; `js/intro.js`
calls them and owns no version of either. If the module never runs — CDN down, an
exception during import, a syntax error — the bootstrap's own 5.8s timer still
clears the classes and the `inert`, because the failure mode of the alternative
is a full-viewport layer over a page with a background that cannot be focused or
clicked. The release statement is the FIRST thing `finish()` does, before the
compress path, because an exception after it leaves the visitor exactly in that
state.

### What the entrance does when it is ended early

`html.intro-compressed { --intro-speed: 0.18 }` multiplies every delay in the load
choreography, so the hero's 5s schedule compresses to ~900ms from the press —
answered at the speed of the gesture. It only applies while the overlay is still
up: every hero delay is later than the handover, so nothing has begun and a
shorter schedule simply starts sooner. Once the hero is in flight, rescaling
would replay the blocks that had already finished, so it is not applied.

**The class is `intro-compressed` and the name is load-bearing.** An earlier pass
wrote `intro-skip` onto `<html>` here, and the Skip *button* in `css/intro.css` is
also styled `.intro-skip` — with `opacity: 0` in its skin. A class selector matches
`<html>` when `<html>` carries the class, so every visitor who skipped got
`opacity: 0` on the document element: a permanently invisible page showing nothing
but the user-agent canvas, `rgb(18,18,18)`, because the page declares
`color-scheme: dark`. Measured by re-injecting the old rule at runtime — pixels go
from `rgb(7,7,7)` variance 903.88 to `rgb(18,18,18)` variance 0. Both halves are
kept as insurance: the state class has a name nothing else uses, and the button's
skin is scoped to `#intro-skip`, which cannot match `<html>` under any
circumstances.

### Accessibility, stated plainly

- `html.motion-reduced` skips the entrance **entirely**. Not shortened. Someone
  who has been told this page shows them a five-second panel every visit does not
  want a faster one. The `<head>` bootstrap never adds `intro-active` in that
  case, so there is no frame of it.
- A deep link (`#flow`) skips it too: the visitor clicked a link to a section.
- The background is `inert` + `aria-hidden` while the panel is up; focus starts
  on the Skip button and moves to `#main-content` when the panel leaves.
- `?motion=off`, a stored preference, a bfcache restore, a hidden tab, any key,
  any click and any scroll all end it. There is no state in which a visitor
  cannot get out of it in one gesture.

### Files

| file | what changed |
|---|---|
| `css/intro.css` | **new.** The skin + the clock custom properties. Registered in `tools/build-css.mjs` SOURCES between `animations.css` and `components.css`. |
| `js/intro.js` | **new.** The timeline, the readout, every way out. No imports. |
| `index.html` | `#intro-overlay` markup; the inline `<head>` bootstrap (classes, `inert`, ceiling, `window.__tlIntro`); `tabindex="-1"` on `<main>`; the module tag. |
| `css/animations.css` | the 5s load choreography + blur; `--reveal-blur: 12px` for scroll reveals; `load-rise`/`load-fade` keyframes; the letter-spacing removal; `filter: none !important` added to the two failsafes that cancel the load reveal. |
| `js/reveal.js` | handovers are QUEUED while `intro-active` is set, and flushed on `toolapis:intro-complete` — otherwise the first screen reveals behind the panel and arrives flat. `recover()` / `passVisible()` then sweep **anything unrevealed whose top is above the fold, in view or already behind the visitor** — the answer to the question an IntersectionObserver cannot answer, since a block that travelled across the viewport during the hold was above the root when it was first sampled and below it the next time, and `isIntersecting` was false for both. Blocks already behind are revealed with no transition; blocks in view keep their stagger, compressed to six steps. `startSelfHeal()` then re-checks computed opacity on screen 700ms after the handover and every 1.5s for six seconds. |
| `js/motion-fx.js` | the hero words no longer carry their own `i * 80` timers; the stagger is `animation-delay` on `tl-display-settle`, which holds its from-state through the delay. |
| `tools/check-motion.mjs` | `waitForEntrance()`; six new assertions per context (holds the screen, has a Skip control + inert background, releases the page, leaves nothing inert, never touches `overflow`, the hero lands); the scroll-reveal test now waits for the entrance and asserts the blur resolves; `?motion=off` asserts the panel never takes the screen. |
| `tools/hero-edge-check.mjs` | waits for `intro-done` before grading, and hides `#intro-overlay`. Without this it graded the progress rail — a 320px × 2px rectangle, i.e. exactly the "long straight run of discontinuity" it exists to catch — and failed 8 of 10 viewports. |
| `tools/check-intro-scroll.mjs` | **new.** `npm run check:intro-scroll`, the gate for the blank screen. Every entrance input at every timing, plus the entrance's own duration (5.0s ± 0.15s, measured on the document timeline from `[data-load-reveal]`, not from the overlay disappearing), all four Skip paths, both re-refreshes, bfcache, the hidden tab, `?intro=off`, a deep link and both motion states. It asserts nothing is invisible in the viewport, no layer is on top at **five** points, `<html>` is never transparent, the lock held `scrollY` at 0 and then released it, and the screenshot is not a flat fill. `--full` is the whole 60-run input matrix; the default is an 8-run subset, because the matrix costs ~21s a run and a 22-minute gate is a gate nobody runs. |
| `tools/diagnose-intro-scroll.mjs` | evidence pass, not a gate. Prints scrollY, overlay state, hidden-block count and the element at the centre of the screen for every input at every timing, into `/tmp/shots/intro-scroll/`. |

### Known state of the gates on this machine

Measured 2026-10-11 against the server on `http://127.0.0.1:8765/`:

| gate | result | time |
|---|---|---|
| `check:intro-scroll` (quick) | **205 passed, 0 failed** | **191s** |
| `check:intro-scroll --no-inputs` | **95 passed, 0 failed** | 113s |
| `check:motion` | **114 passed**, 2 skipped (machine too loaded) | ~13 min |
| `check:hero-edge` | **10/10** viewports | 61s |
| `check:fluid` | **177/177** | 361s |
| `check:css` | all sources parse cleanly | — |
| `build:css --check` | bundle up to date | — |
| `diagnose-intro-scroll.mjs` | 32 scenarios, 0 errors | ~5 min |

The entrance measured **4950ms** end to end on the document timeline against the
5.0s ± 0.15s the design specifies, from the five `[data-load-reveal]` blocks.

**`check:intro-scroll` has two modes and the difference is 60 runs against 8.**
`--full` is the whole input matrix and costs roughly **22 minutes**, which is why
it is not the default: a gate that takes that long is a gate nobody runs. The
quick default keeps all four gesture shapes — `wheel` and `space` for the
`preventDefault` layer, `end` for a jump that leaves the first screen behind, and
`dragscroll` for the one input that bypasses that layer entirely — at the two
timings the file already treats as the interesting ones. `extras()` runs in both
modes and is where the invariants are.

**Port mismatch — pre-existing, not fixed by this pass.**
`check-overflow.mjs`, `hero-edge-check.mjs` and `check-motion.mjs` all default to
`http://localhost:5500/`, while `HANDOFF.md`, `check-intro-scroll.mjs` and the
documented local server use `8765`. On a machine serving 8765, `npm run check`
fails at `check:motion` with `ERR_CONNECTION_REFUSED` before reaching anything
else. Every number in the table above was taken with `--url
http://127.0.0.1:8765/` passed explicitly. Align the defaults before trusting
`npm run check` unattended.

**One environment limit worth knowing.** This box uses overlay scrollbars:
`innerWidth - clientWidth` is `0` at every width, including with
`--disable-features=OverlayScrollbar`, and there is no Xvfb. So the classic-scrollbar
claims above — the ~10px slide and the 0px of the `--intro-gutter` compensation —
**cannot be verified here** and need a real Chrome desktop. What *is* verifiable
here is the `scrollbar-gutter: stable` rejection: injecting it moves the shell from
left 83 to left 78 at rest, which is the permanent 5px the entrance does not have.

`filter: blur()` on the scroll reveals was measured the same way and is worth
about 10–15% of the live page's throttled frame rate; `will-change: filter` was
worth a further ~6% and was dropped, which is why `.rv-anim` promotes only
`opacity, transform`. The blur RADIUS is not the lever — 6px, 8px and 12px
measure the same — so `--reveal-blur` is set by design, not by budget.

## Latest pass — TOOL PASS card removed, hero edge fixed

See "2026-10-09 · TOOL PASS removal + hero edge" at the bottom.

### The liquid glass pass was CANCELLED and never landed

There is **no glass pass to revert**. Verified, not assumed:

| check | result |
|---|---|
| `HEAD` | `675b65d "WIP: before liquid glass"` — *is* the pre-glass checkpoint |
| working tree | clean, incl. `--untracked-files=all` |
| `git stash list` | empty |
| 7 dangling commits (`git fsck`) | old stashes from prior passes; none contain `glass.css` |
| `css/glass.css`, `GLASS-REPORT.md`, `tools/glass-check.mjs` | never existed |
| `--glass-*` tokens, `.glass--*`, `?glass=` JS, `hardwareConcurrency`/`deviceMemory` | none |
| `check:glass` script, glass in `tools/build-css.mjs` | none |

The visual work was already DESIGN.md-correct. A `backup-before-glass-revert`
branch points at `675b65d` regardless.

**`.glass-panel` is not glass.** The name survives deliberately: `script.js`
measures it as a card obstacle. It is a flat `#0d0e12` plate with a `1px #d9dae5`
border — a DESIGN.md Dark Surface Card — and it sets `backdrop-filter: none` as an
explicit assertion. `tools/design-check.mjs` asserts no `backdrop-filter` anywhere.

## How to run it

```bash
cd /home/user/toolapis
nohup python3 -m http.server 8765 >/tmp/serve.log 2>&1 &   # MUST be running
touch css/bundle.css && node tools/build-css.mjs            # after every css/ edit
node tools/build-css.mjs --check                             # must pass
```

`css/bundle.css` is GENERATED (see `tools/build-css.mjs`). Never edit it. If the
build script refuses with *"older than its sources AND differs from them"*, run
`touch css/bundle.css` first to clear stale mtimes, then rebuild.

## Checks

```bash
npm run check                      # build:css + check:css + check:motion + check:fluid
                                   #   + check:hero-edge + check:intro-scroll (quick)
npm run check:intro-scroll         # the blank-screen gate, quick subset
npm run check:intro-scroll:full    # the full 60-run input matrix (~22 min)
npm run check:hero-edge            # hero has no hard rectangular edge (needs the server up)
node tools/diagnose-intro-scroll.mjs   # evidence pass, not a gate
```

All of them need the local server up (default `http://127.0.0.1:8765/`).

## Files changed

| file | what |
|---|---|
| `css/tokens.css` | `--gutter`, `--section-gap`, `--card-padding` fluid; `--bp-sm/md/lg/xl`; `--tap-target`; `--edge-inset`; type scale moved to `clamp()` in the tokens; removed the two old stepped type media queries |
| `css/base.css` | **removed `body { overflow-x: hidden }`**; `min-width: 320px`; `overflow-wrap: anywhere`; media `height: auto`; `.shell`/`.container` = `width: min(100% - 2 * gutter, 1200px)`; safe-area padding for nav/footer; removed duplicate `scroll-behavior` |
| `css/components.css` | navbar single 900px breakpoint; share button visible at all widths; 44px targets; 12px minimum type; **full-screen mobile panel** with its own close button; `overflow: clip` everywhere; all hover rules gated on `@media (hover: hover)`; **deleted the duplicate footer block** (now only in `sections.css`) |
| `css/hero.css` | display size from the token (40px floor, was 44px); line-mask bottom padding 0.06em → 0.16em (descenders were being shaved); `#hero { overflow: clip }`; `.hero-glow` `90vw` → `90%`; strip gutter de-duplicated; `svh` confirmed |
| `css/hero3d.css` | `width: min(760px, 62vw)` → `62%`; `overflow: clip`; scene height `clamp(280px, 62vw, 360px)`; margin bleed now `-1 * var(--gutter)` (was a 3rd copy of the gutter literal); chip `max-width`; parallax + ribbon animation stopped `< 768px`; parallax also gated on `hover: none / pointer: coarse` |
| `css/sections.css` | bento mobile-first (1 / 2 @600 / 12 @1024, spans only ≥1024 — removed the `!important` undo); **removed `.mock__body` 168px sidebar** (root cause of the real overflow); `.lock` 260px minimum removed (was clipping 16px of the caption); **vertical flow rail on mobile**; `.terminal` `overflow-x: auto` + `pre`; marquee `overflow: clip`; footer 1/2/4 columns; `minmax(0,1fr)` + `min-width: 0` throughout |
| `css/animations.css` | hover motion block wrapped in `@media (hover: hover)`; `:active` press for coarse pointers; sheen `content: none` off hover; hero loops stopped `< 768px`; new `html.is-tab-hidden` pause |
| `index.html` | `viewport-fit=cover`; mobile panel got a `__head` row with wordmark + 44px close button; `role="dialog" aria-modal="true"`; share button de-`desktop-only`'d |
| `script.js` | scroll lock as a class on `<html>`; focus trap; focus restore to hamburger; backdrop-tap close; close on crossing 900px; `aria-label` Open/Close; `is-tab-hidden` on `visibilitychange` |

## Breakpoints (single source of truth, `css/tokens.css`)

`600` · `768` · `1024` · `1280` — plus `900` for the navbar/panel handoff,
which is a *behaviour* boundary rather than a layout one.

## Root causes found

1. **`body { overflow-x: hidden }` (base.css:47)** — masked every measurement.
   `scrollWidth === clientWidth` measured true at *every* width even while
   elements were cut off. Removed.
2. **`.mock__body { grid-template-columns: 168px … }`** — the only genuine
   horizontal overflow on the site (37px at 200% zoom on a 390px phone, 30
   overflowing elements). Fixed.
3. **`.lock` 260px minimum + `overflow: hidden`** — silently ate 16px of the
   privacy caption at 360/390px.
4. **Navbar used 640px and 768px for one decision** — 640–767px had no centre
   links and no hamburger.
5. **`.flow__line` drawn horizontally on a vertical mobile stack** — connected
   nothing.
6. **Mobile panel was not full-screen and had no scroll lock, no close button,
   no focus trap.**
7. Nine text styles under 12px; nine touch targets under 44px.
8. Duplicated footer rules in `components.css` AND `sections.css`, with
   different column counts.

## Remaining

Nothing outstanding. Not done deliberately, and documented in the report:
- Lighthouse (no binary / Chrome-for-Testing available)
- a reconstructed before-state screenshot baseline (unrecoverable, see report §5)
- `tools/layers-check.mjs` (stale tool, pre-existing failure)
- `tools/hero-check.mjs` (hangs past 120s)

## New tool added this session

`tools/css-syntax-check.mjs` — comment balance, brace balance, declaration
syntax, and a real browser parse of the shipped bundle. It exists because a
single missing `*/` in `css/hero.css` silently deleted every rule after it and
NOTHING caught it: build passed, `--check` passed, every Playwright assertion
passed. Run it after any css/ edit:

```bash
node tools/css-syntax-check.mjs
```

## Known non-regressions (pre-existing, not mine)

- `tools/layers-check.mjs` fails: it queries `#overview .tool-card`, a class that
  has not existed in the markup since the bento redesign. Stale tool.
- `tools/design-check.mjs` "button arrow slides 4px on hover" is flaky — it reads
  the transform 450ms into a 200ms transition and demands exactly `, 4, 0)`. Fails
  ~1 run in 3 on an idle machine with an unchanged stylesheet. Re-confirmed on an
  unchanged stylesheet after the TOOL PASS pass (3 runs: pass, `3.70606`, pass).

---

## 2026-10-09 · TOOL PASS removal + hero edge

### (A) The TOOL PASS card is gone

The hero's mint Phosphor Accent Card (FROM → TO, barcode, two launch pills). It
was **the hero's only filled accent surface**, and at 1366 it was also the thing
that read as "a blue block with a hard right edge" — a solid panel with a ~174/255
luminance step across 345px. A card has edges; the report mistook it for a glow.

Removed, with no dead code left behind:

| file | change |
|---|---|
| `index.html` | `.hero-boarding.toolpass` markup; `<script defer src="js/hero-extras.js">` |
| `js/hero-extras.js` | **deleted** — 70 lines whose only effect was this card's parallax |
| `css/toolpass.css` | **deleted**; unregistered from `tools/build-css.mjs` SOURCES |
| `css/components.css` | `.toolpass*`, `.hero-barcode*`, the `.toolpass .hero-pill-outline` pills |
| `css/animations.css` | barcode scan + the `tl-scan` / `tl-flip` keyframes, now orphaned |
| `css/hero.css` | the 340/380px grid track, reduced-motion selectors |
| `css/base.css` | comment only |

**Preserved:** "Get started", "See how in 30s", the navbar HD Enhancer CTA (6 HD
Enhancer links, 3 gnirehtet links, 0 broken in-page anchors).

**Hero rebalanced** — the card was the only thing in the second grid track, so
`grid-template-columns: minmax(0, 1fr) 340px` → one column. The copy column grows
to the full shell and the scene supplies the right half. Headline height is
unchanged at 290px (no re-wrap). The three chips were all sitting in the scene's
**left third dodging the card**; they now surround the light instead.

### (B) The hero had a second, real hard edge

Not the card. At **1920 and 2560** the glow genuinely terminated on a straight
vertical line:

- `css/hero3d.css` `.hero-scene__ground` masked its left, top and bottom edges
  but held `#000` to `100%` on the right, on the reasoning that the scene box
  bleeds off-screen so "the right edge never needs one". True at 1366 (box right
  1427) and 1440 (1464); **false** at 1920 (1793) and 2560 (2272), where the box
  edge lands inside the viewport.
- `.hero-scene`'s bleed was a fixed `-12%` of a box capped at 760px, so it stopped
  clearing the screen once the shell passed its maximum.

**The clip was not the cause.** Forcing `overflow: visible` at runtime left the
edge exactly where it was: a gradient with no ramp on one side has that side
whatever box contains it.

Two fixes:
1. the right ramp, and the **left** ramp lengthened to `28%` (measured: the old
   `transparent 0%` still stepped 42/255 over 111px where the box edge resolved);
2. the bleed now tracks the shell's own margin —
   `inset: 0 calc(-1 * ((100vw - 100%) / 2 + 8%)) 0 auto` — so the box clears the
   viewport at every width. `100vw` over-bleeds by the scrollbar, which is the
   safe direction.

### New tool — `tools/hero-edge-check.mjs` (`npm run check:hero-edge`)

Screenshots the hero at 1366/1440/1920/2560 × zoom 80/100/125%, hides everything
that is not painted light, and fails on a luminance step >6/255 holding for >80px.

**It is validated against the defect, not just against the fix** — run against
the pre-fix CSS (`git checkout 675b65d -- css/hero3d.css`) it fails exactly where
it should:

```
FAIL  1920 · 100%   vertical@1792 run=526px peak=20
FAIL  2560 · 100%   vertical@2271 run=842px peak=28
FAIL  1920 · 80%    vertical@1792 run=526px peak=20
FAIL  1920 · 125%   vertical@1792 run=526px peak=21
```

and passes on all ten once fixed. Getting there took four wrong designs, each of
which passed the broken stylesheet and so had to be discarded — bounding-box
pixel masks (a 1px hairline dropped by a size floor; `.hub-ground` below the fold
vetoing every column; the toast silencing a 717px run 300px away; a
no-background `<section>` masking the whole hero). Two rules that earned their
place: a **sustained** step is required, not a single-pixel one (the ribbon's
track rendered luma 16 between two columns of 8.1 — a 1px line, not a boundary);
and **lines are not fills** (`.hero-horizon`, the floor grid and the ribbon are
drawn as straight lines on purpose, so grading them grades the design).

### Checks after this pass

`npm run check` — build:css up to date · 565 rules parse · **177/177** fluid ·
**10/10** hero-edge. Console errors **0** at 1440/1024/768/390.
- `tools/hero-check.mjs` hangs (>120s). Not run.
---

## Motion policy — animations are now FORCED ON for every visitor (owner decision)

**The decision, in one line:** this site does not honour the operating system's
"reduce motion" setting. Every visitor gets every animation. The only way to turn
motion off is the **"Reduce motion" button** — in the footer and in the mobile
menu.

This replaces the previous rule, which was the opposite and which the owner has
now overridden.

### Why it changed

The old behaviour was one line of CSS:

```css
@media (prefers-reduced-motion: reduce) {
  html:not(.motion-on) * { animation-duration: 1ms !important;
                          animation-iteration-count: 1 !important; ... }
}
```

A visitor whose laptop was configured once, years ago, landed on a dead page —
every loop collapsed to a single 1ms iteration, the marquee stood still, the
ribbon stopped, the typewriter finished instantly — and there was **no control
anywhere to undo it**. An OS-level preference is a statement about the whole
desktop, not about this page, and it is not a licence to remove the design.

### What was removed, and where

| File | Removed |
|---|---|
| `css/animations.css` | the `@media (prefers-reduced-motion: reduce)` block |
| `css/hero.css` | the same block, for `.hero-glow` / `.hero-grid-lines` |
| `css/section-bg.css` | the same block, for the whole `.section-bg` subtree |
| `index.html` | `matchMedia('(prefers-reduced-motion: reduce)')` in the inline `<head>` bootstrap |
| `js/config.js` | `respectReducedMotion` is now `false` and must stay false |
| `js/motion.js` | `OS_QUERY`, `osPrefersReduced()`, `watchOsPreference()`, and the step-5 branch in `decide()`. Precedence is now storage → `?motion=` → `true`. |
| `js/motion-fx.js` | `REDUCED_QUERY` and the `matchMedia` branch in `still()` — it was consulting the OS outside the policy module, a second source of truth |

The ~42 `html.motion-reduced { … }` rules were **kept**. They can now only be
reached by the visitor pressing the button, and they are the finished state the
toggle lands on.

### The escape hatch

`html[data-motion]` is `on` or `off` (the two words the button's `aria-pressed`
uses, so the attribute and the accessibility tree cannot disagree). Off means:
loops stopped, parallax stopped, transitions reduced to a 150ms fade, and
everything that would otherwise be mid-animation snapped to its finished value.

Two copies of the control, both found by `.motion-toggle`, both kept in sync by
`js/motion-toggle.js`:

- `index.html` — footer's "Preferences" column, plus the visible explainer
  *"Animations on. Turn off if motion bothers you."*
- `index.html` — the mobile menu, as the first control under the two CTAs

Both are real `<button>`s, `aria-pressed`, 44px min-height, keyboard- and
touch-operable, no reload. The choice is stored in `localStorage`, falling back
to `sessionStorage`, falling back to not remembering — a control that throws on
read is worse than one that forgets.

### Safety, now that motion runs for everyone

| Rule | How it is met |
|---|---|
| WCAG 2.3.1, no flash >3Hz | measured, not asserted: `tools/check-motion.mjs` reads every infinite animation's own duration from the timeline **and** samples opacity for 3s. Worst observed: `.pt-dot` at 0.83Hz, `.terminal__caret` 0.91Hz. |
| No large-area fast motion | parallax capped at 12px (`js/hero3d.js` `MAX_SHIFT`), reveal travel 24px/16px, nothing full-screen scales or rotates. |
| Decorative loop duration | `sig-link`, `mock-pulse-dot`, `node-pulse`, `tl-pulse` (status dots) and `hub-breathe` lengthened to 6s. `caret-blink` / `sig-caret` left at ~1s — they are terminal cursors, and 0.9Hz is the convention. |
| WCAG 2.2.2, pause mechanism | the "Reduce motion" button. `?motion=off` and a stored preference are the other two paths in. |

`.pt-dot` went from 900ms to 1200ms: it was the fastest purely decorative cycle
on the page (1.11Hz) and bought nothing a slower breath does not.

### Perf note — the ribbon

`css/hero3d.css` carried this comment:

> `stroke-dashoffset` … is compositor-friendly and never triggers layout

**That was wrong.** `stroke-dashoffset` is a paint property; it re-rasterises the
stroked path every frame. What made it expensive was `filter: drop-shadow()` on
the same two paths — a filter over an element that repaints every frame, over the
whole 760×520 scene. Measured at 4x CPU throttle, scroll went **15fps → 30fps**
when those two filter declarations were deleted and nothing else changed. The
glow is now geometry (a half-pixel wider stroke over the existing static
tracks). `tools/check-motion.mjs` holds a cost gate at 50% of the machine's own
4x ceiling so it cannot be re-added unnoticed.

### What is deliberately still switched off, and why

- **`@media (width < 768px)`** — the hero glow, grid drift, ribbon and chips stop
  on phones. A viewport/perf decision, not a motion preference.
- **Off-screen and hidden-tab pauses** (`html.is-tab-hidden`,
  `#hero.is-paused`, `.section.is-active`) — battery, not preference.

### Checks

`npm run check:motion` (new) — 69 assertions. Desktop and mobile, each with
`reducedMotion: 'reduce'` **and** `'no-preference'`: `motion-on` present,
`data-motion="on"`, `getAnimations()` non-empty, marquee translating, ribbon dash
travelling, reveal reaching opacity, section backdrop `running`, load-reveal
animated, no overflow, no console errors, blink ceiling. Then the toggle: two
controls, both 44px, both `aria-pressed`, `?motion=off` at `DOMContentLoaded`,
tap, reload persistence with no first-frame flip, Enter, Space, flip back, loops
running again.

`tools/design-check.mjs` §8 is now the **inverse** of what it used to be — it
asserts the animations are ALIVE under `prefers-reduced-motion: reduce`.

### Two bugs found while proving it, both fixed

**1 · The 3s reveal failsafe could destroy the reveal it was protecting.**
`index.html` ran a single `setTimeout` at 3000ms: if `html.js` and
`data-reveal-live` were both not yet set, it added `html.reveal-all`, which snaps
every `.reveal` to opacity 1 with `!important`. Both halves are deferred/module
scripts on a page that also fetches Google Fonts and a CDN script, so a slow load
looked identical to a broken one — and the whole scroll-reveal choreography was
silently destroyed for the life of that page. Measured: 1 in 6 fresh loads lost
it. It now polls every 250ms and only concludes "broken" after
`readyState === 'complete'`.

**2 · The motion toggle could not restart a section you were already looking at.**
`js/section-bg.js` `unwind()` drops `.is-active` when motion is turned off, and
the IntersectionObserver never put it back — it only fires when something
*changes*, and from its point of view the section had not moved. Measured: 43
loops running, toggle off, toggle on, still 21 until the visitor happened to
scroll. Added `resync()`, which re-derives visibility from current geometry;
`js/section-mocks.js` got a matching `resume()`. `wire()` was also building a
fresh observer per toggle with no teardown — three cycles meant three observers
writing the same class.

### Final check results

| Check | Result |
|---|---|
| `npm run check:motion` | **77/77** pass |
| `npm run check:fluid` | **177/177** pass |
| `npm run check:css` | 564 rules parse cleanly |
| `npm run build:css -- --check` | bundle up to date |
| `tools/design-check.mjs` | all pass (375px and 1366px) |
| `tools/no-undef.mjs` | clean |
| console errors | 0 |

FPS on this box, software rasterisation, no GPU: desktop ~41fps live vs ~44
ceiling unthrottled, mobile a steady 60. Under 4x throttle the cost gate holds
at 58% (desktop) and 102% (mobile) of the machine's own motion-off ceiling.

**The absolute FPS floors are skipped when the machine is loaded past 1.5x its
core count**, and this box is routinely at 2-3x: the same motion-off page
measured 48fps and 19fps thirty seconds apart with no code change. Skipping is
reported, never hidden, and the relative cost gate still runs — a skipped
absolute floor is not a passed one.
