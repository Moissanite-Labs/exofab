# Exofab · Forge screen · Four design directions

**Status:** design exploration, not production code.
**Example data:** every project name, person, agent, hash, time and count on these screens is fictional. The example project is *Tidepool, a field journal app for marine volunteers*. Each page labels itself "Example data".

| # | File | Mood |
|---|------|------|
| 1 | `1-crystal-lattice.html` | Dark, luminous; the Moissanite lab look |
| 2 | `2-workshop-bench.html` | Light, tactile; a maker's bench |
| 3 | `3-field-ledger.html` | Editorial and calm; a ship's log |
| 4 | `4-crystal-lattice-merged.html` | Crystal Lattice with the Field Ledger's signature and margin sources (chosen 2026-11-03) |

Screenshots are in `shots/<name>-desktop.png` (1440×900) and `shots/<name>-mobile.png` (390×844 @2x). Full-page and post-approval captures are in `shots/full/`.

## Shared model (all directions)

- **Crew:** 3 people (Maya Okafor, lead and "you"; Teo Lindqvist, design; Ana Ruiz, field volunteer) and 3 agents (Scout v0.6 research, drafts; Loom v0.4 prototyping, drafts; Keel v0.3 build/release, proposes). People and agents get the same size, weight and position. They differ only in form: warm/round for people, cool/angular for agents (D3 uses italic vs small caps). Every agent shows its permission scope ("drafts · can't send", "proposes · asks first").
- **Stages:** 001 Idea → 002 Shape → 003 Prototype (current, 11/12 parts) → 004 Build → 005 Ship.
- **Pending decision (Decision/Work order/Entry 07):** Keel proposes sending Prototype 3 (build 0.3.2) to 12 volunteer testers. Each version shows:
  1. Who proposed it and when
  2. Numbered reasoning
  3. Provenance: four sources with author, kind (human/agent) and short hash
  4. Consequences: who it reaches, what data, how to undo
  5. A preference note: "Learning a preference does not grant permission"
  6. Three actions: Approve, Decline, Send back/revise
- **Trace:** recent work, each item showing where it came from (source → author → hash). Approving adds a signed record `d07·f1a9`.
- **No dark patterns.** No countdowns, urgency copy, streaks or guilt. Decline is as easy to reach as approve and gets equal visual weight. Revoke stays available after approval, and the confirmation states how to undo.

### Approval choreography (shared beats, styled per direction)
1. Click/Enter on Approve. Both buttons disable to prevent a double submit; this is the **loading** state.
2. Signature moment, 0.6–1.4 s (D1 crystallize, D2 stamp, D3 handwritten signature).
3. The header status switches to approved/signed. An outcome line names who approved, what is happening, and the record id, followed by a **Revoke** control.
4. The new signed record is prepended to the trace.
5. Milestone: stage 003 completes and stage 004 becomes current. The micro-reward plays once, stays small and needs no dismissal (D1/D2 toasts include Close). An `aria-live` message announces it.
6. `prefers-reduced-motion`: every step happens instantly with no movement. The state change is the same.

### Decline choreography
Decline opens an optional reason textarea, which gets focus, plus Confirm and Back. Confirm shows "Nothing was sent. Keel kept the draft." Back returns focus to Decline.

### Shared accessibility
- Approve, decline, revise, pause and ring-key controls are native `<button>`s.
- `:focus-visible` gives a 2px outline with offset in a colour that passes 3:1 against its background.
- Pause toggles use `aria-pressed`. Stage progress uses `aria-current="step"`. Outcomes use `role=status`/`aria-live`.
- Colour is never the only signal: human vs agent is also shown by shape (or italic vs small caps), and status is always written out in text.
- Contrast was computed for the tightest text pairs, all ≥ 4.5:1. D1 tx3 on bg 6.0; D2 ink-3 on manila 5.4; D3 ink-3 on sea 4.6; D3 gold ornament 4.55 (decorative).

---

## Direction 1 · Crystal Lattice (`1-crystal-lattice.html`)

The project is drawn as a growing crystal. Each finished piece of work becomes a node in a hex lattice, and each stage is one ring around the core idea. The approval panel is the brightest object on the page.

### Tokens
| Token | Value | Use |
|---|---|---|
| `--bg` | `#08090a` | page |
| `--s1` / `--s2` | `#0e1012` / `#14171a` | panels / raised |
| `--line` | `#22262b` | borders, lattice guides |
| `--tx` / `--tx2` / `--tx3` | `#eceef0` / `#a9b0b9` / `#868e98` | text tiers |
| `--carbon` | `#f2ab6d` | people (carbon) |
| `--silicon` | `#7cc6f2` | agents (silicon) |
| `--ice` | `#e9f4ff` | primary action, current stage |
| `--ok` | `#8fe0b0` | approved |
| focus | `#ffd79a` 2px, offset 3px | |
| Fonts | Geist (UI), Geist Mono (labels `001 / FOUNDATION`), Instrument Serif italic (subtitle) | fallbacks: system-ui / ui-monospace / Georgia |
| Type scale | 11 mono label · 13 · 14 body · 15 · 20 decision title · 52 project title (mobile 40) | |
| Spacing | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 | |
| Radii | 4 chips · 8 buttons · 14 panels; avatars circle (human) / rotated square (agent) | |
| Motion | 140 ms (hover/press) · 320 ms (panel/state) · 900 ms+ (crystallize); `cubic-bezier(.16,1,.3,1)` out, `(.65,0,.35,1)` in-out | |

### Components and states
- **Stage track:** 5 segments with mono numerals. Done segments show a warm→cool gradient underline; the current one has an ice border; future ones are dimmed. Empty state: only 001 lit.
- **Lattice (SVG):** core = idea; ring 1 = shape; ring 2 = prototype (12 slots); ring 3 = build (forming); later rings are ghosted. People are circles and agents are diamonds. *Hover/focus:* tooltip with the title and author. *Pending:* a dashed rotating halo with a slow breathing pulse (paused under reduced motion). *Forming:* a dim outline. *Empty project:* the core node alone plus the dotted ghost ring.
- **Ring key:** pill buttons. Hover/focus highlights that ring's guide. On mobile they sit in a single horizontally scrolling row.
- **Crew card:** avatar shape + name + role + scope chip. The agent's version tag is in mono.
- **Live work row:** an author chip, a progress bar with a slow sheen (static under reduced motion), and a Pause/Resume toggle (`aria-pressed`). Paused rows dim and the sheen stops.
- **Decision panel (sticky):** a gradient hairline border.
  - Primary button: *default* ice fill · *hover* brighter with glow · *pressed* translateY(1px) · *focus* amber ring · *disabled* 45% opacity.
  - Ghost Decline; text link "Ask Keel to revise".
- **Provenance chip:** a dot (round for human, diamond for agent) + label + mono hash. Hover/focus highlights the matching lattice node.
- **Trace row:** hover/focus lights up the node it produced.

### Signature moment and milestone
Approve → 0–300 ms buttons disable and the label reads "approved" → 300 ms the pending node solidifies → ~400–2200 ms a spectral "fire" stroke runs once around ring 2 while each prototype node glints in sequence (60 ms stagger) → the stage track advances to 004 → a toast with a faceted gem reads "003 / Prototype crystallized · 12 pieces: 5 human · 7 agent". The toast has a Close button and no timer pressure.

---

## Direction 2 · Workshop Bench (`2-workshop-bench.html`)

A warm, physical maker's bench. Graph paper, a fabrication line, a pegboard for the crew and a cutting mat for live work. The decision is a manila work order you stamp by hand.

### Tokens
| Token | Value | Use |
|---|---|---|
| `--paper` | `#f2ece1` | page (with a 24px graph-paper grid) |
| `--card` | `#fffdf8` | cards |
| `--ink` / `--ink-2` / `--ink-3` | `#1c1a16` / `#4d473d` / `#5c5649` | text |
| `--rule` | `#d8cfbe` | hairlines |
| `--brass` | `#9a5b12` | people (brass tags, rounded) |
| `--steel` | `#2a4fa3` | agents (steel tags, chamfered corners) |
| `--manila` | `#f3dd9b` | work order ticket |
| `--stamp` | `#a3221b` | approval stamp |
| `--mat` | `#2f5a4c` | cutting mat |
| `--go` | `#2f6b3a` | "Passed" plates |
| focus | `#1f5bd6` 2px, offset 3px | |
| Fonts | Bricolage Grotesque (display 800), Instrument Sans (UI), IBM Plex Mono (labels, part numbers) | |
| Type scale | 11 mono · 14 · 15 body · 22 section · 26 ticket title · 76 project title (mobile 56) | |
| Spacing | 4 · 8 · 12 · 16 · 24 · 32 · 48 | |
| Radii | 2 plates · 8 buttons/tags · 14 panels; agent cards use `clip-path` chamfers in place of radius | |
| Elevation | hard offset shadow `0 4px 0 var(--ink)` on panels and buttons (it reads as thickness) | |
| Motion | 120 ms press · 260 ms state · 700 ms belt/stamp; press `cubic-bezier(.3,1.6,.5,1)` (slight overshoot), out `(.2,.9,.2,1)` | |

### Components and states
- **Title block:** engineering-drawing cells (Dwg, Rev, Crew, Parts).
- **Fabrication line:** a striped belt with puck P3 at 50%, five outlined numeral stations, and "Passed" plates on finished stations. Empty state: puck at station 01 and no plates.
- **Crew board:** pegboard tags with a hole and a permission line.
- **On the bench:** part cards on a cutting mat with striped gauges and Pause/Resume. *Empty:* a dashed "Free space on the bench" slot.
- **Buttons:** *default* hard shadow · *hover* lifts 1px · *pressed* shadow collapses to 0 and the button sinks · *focus* blue ring · *disabled* flat at 50%.
- **Parts log:** a bill-of-materials table, collapsing to stacked rows on mobile.
- **Work order (sticky right rail; first after the hero on mobile):** a grommet hole, reasons, parts used, "What happens", a sign-off zone and a preference note.

### Signature moment and milestone
Approve → the ticket thuds (2px drop, 120 ms) → the rubber stamp "APPROVED / M. OKAFOR · date" falls from scale 1.8 to .94 to 1 in 260 ms with a multiply blend → the header reads "Signed off" and the outcome shows a Revoke button → BOM row `d07·f1a9` slides in → the belt rolls from 50% to 75% (700 ms) → station 03 gets its Passed plate and the puck becomes B1 → a brass plate toast, "Station 03 · Prototype passed", appears with one light shine sweep.

---

## Direction 3 · Field Ledger (`3-field-ledger.html`)

A quiet living document set like a ship's log. Decisions are entries you sign, and provenance sits in the margin as numbered sidenotes. Progress is a tide gauge that rises as the project moves from idea to shipped.

### Tokens
| Token | Value | Use |
|---|---|---|
| `--paper` / `--paper-2` | `#f6f3ec` / `#efeadf` | page / hover |
| `--sea` | `#e3ecea` | consequences block, sidenote highlight |
| `--ink` / `--ink-2` / `--ink-3` | `#1f2328` / `#464b53` / `#636970` | text |
| `--rule` / `--rule-2` | `#d9d1c1` / `#bfb5a2` | hairlines |
| `--human` | `#9a3b26` | people: filled dot, names in *italic* |
| `--agent` | `#0d5c63` | agents: hollow diamond, names in SMALL CAPS |
| `--pen` | `#1d3a8a` | signature ink, primary hover, focus |
| `--gold` | `#8a6a1f` | chapter ornament ❦ |
| `--water` / `--water-2` | `#9cc3c0` / `#6fa6a3` | tide gauge |
| Fonts | Newsreader (text and display, optical sizes), IBM Plex Mono (labels, hashes), Allura (signature only) | fallbacks: Georgia / ui-monospace / cursive |
| Type scale | 10.5–12 mono small caps · 14.5 sidenotes · 18 body (mobile 17) · 20 standfirst · 34 entry headline (mobile 28) · 76 italic title (mobile 64) | |
| Spacing | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 | |
| Radii | 2 (deliberately square; the ledger is print-like); gauge tube 14 | |
| Layout | 220 rail · 640 measure · 280 margin, gaps 56. Below 1180 the margin drops under; below 760 one column, sidenotes become inline numbered notes and the gauge turns horizontal | |
| Motion | 150 ms hover · 400 ms fade-in · 1.1 s signature · 1.4 s tide rise; `cubic-bezier(.25,.8,.25,1)` and `(.45,0,.2,1)` | |

### Components and states
- **Masthead:** mono wordmark, a double rule, and the dotted-underline "Example data" label.
- **Tide gauge:** a vertical tube with water at the current stage, stage marks in Roman numerals, and "← tide is here". A slow surface wave plays (static under reduced motion). Empty project: water at the Idea mark.
- **Entry:** a status tag (unsigned / signed / declined), byline, headline, and reasoning with superscript refs. A ref is focusable; hover/focus highlights its sidenote. The "If you sign / What is shared / How to undo" block is followed by the signature line.
- **Buttons:**
  - Primary: ink fill · *hover* pen-blue with soft shadow · *pressed* 1px down · *focus* pen-blue ring · *disabled* 50%.
  - Secondary: outline · *hover* paper-2.
  - Text: italic underline ("Return to Keel with questions").
- **Being written now:** live rows with a blinking caret after the sentence, a mono progress line and Pause/Resume. Paused rows go grey and the caret stops.
- **The log:** time in the left gutter, author mark, sentence, and an italic provenance line with the hash.
- **Margin:** sources for entry 07, the pull-quote "Learning a preference does not grant permission.", and "Why this needs you".

### Signature moment and milestone
Approve → buttons disable → "Maya Okafor" writes itself across the signature line in blue ink (clip-path wipe in 24 steps over 1.1 s, so it reads as a pen) → the status becomes "signed" (green tag) and the outcome line plus "Revoke the invitations" fade in → the log gains a "NOW" entry → the tide rises from Prototype to Build (1.4 s) → a chapter close appears: a rule draws outwards, the ❦ ornament settles, and the line "Here ends Chapter III, Prototype." is followed by "12 pieces · 5 by people · 7 by agents · Chapter IV, Build, begins".

---

## Direction 4 · Crystal Lattice merged (chosen) (`4-crystal-lattice-merged.html`)

This is Crystal Lattice with Field Ledger's provenance and signature, redrawn in Crystal's visual language. Everything from Direction 1 still applies unless this section changes it. All content is example data.

### What changed vs Direction 1
- **Layout**
  - Desktop now has two rows instead of the 300 / 1fr / 400 grid. The top row is the crystal (`minmax(0,1fr)`) beside the decision (820 px, 760 px at ≤1360). Below it, a `.lower` row holds Crew, Live work and Trace (1fr / 1fr / 2fr, stretched to equal height).
  - ≤1180: one column with the decision first. The lower row becomes two columns, with Trace full width.
  - ≤760: everything stacks.
- **Lattice tidy-up**
  - The viewBox is tightened to `-204 -184 408 368`, so the crystal fills its panel.
  - Ghost dots appear only on rings 3–4, and the ring-4 guide is dashed.
  - Each forming node sits next to the bonded node it grows from and is joined to it by a dashed `.edge.grow`, so nothing floats.
  - The empty band under the lattice is gone. In its place, the **census strip** replaces the old ring-key pills.
- **Census strip (ring key)**
  - Five buttons, one per ring. Each shows the stage number, name, count and a human/agent split bar; the pending piece is shown as a dashed segment.
  - The current ring gets a glowing ice dot (desktop) or an ice inset bar (mobile).
  - Mobile shows it as a 5-row list.
  - Screen-reader text gives the ring and "current stage".
  - Footer: "18 bonded · 9 human · 9 agent · 1 awaits you · 3 forming". It updates to "19 bonded · 9 human · 10 agent · 3 forming" after signing.
- **Provenance threads:** dotted quadratic curves run from the pending node (Prototype ring) to each source node (1 Teo, 2 Ana, 3 Scout, 4 Loom).

### New / changed tokens
| Token | Value | Use |
|---|---|---|
| `--s0` | `#0a0c0e` | census tiles, inset wells |
| `--ok-dim` | `#12291d` | "Signed" pill fill |
| `--ink` | `#dff1ff` | signature stroke (gradient `#inkg` ice → silicon) |
| `--ink-glow` | `#7cc6f2` | signature glow: `drop-shadow(0 0 5px #7cc6f2aa) drop-shadow(0 0 14px #7cc6f244)` |
| `--note-hl` | `#14202b` | highlighted margin note fill, plus inset `#2a4658` hairline |
| `--ease-pen` | `cubic-bezier(.45,.05,.55,.95)` | pen-like motion |
| `--d-sign` | `1200ms` | signature draw |
| Ref chips | silicon `#7cc6f2` on `#11202b` (8.9:1) · carbon `#f2ab6d` on `#22180f` (9.0:1) · lit state inverts with a 10 px glow | superscript refs |
| Signature hint | `--tx3` `#868e98` on `#0e1012` (5.8:1) | "your signature goes here" |
| Font fallbacks | `Geist Fallback` (Arial/Liberation Sans, size-adjust 102.19%), `Geist Mono Fallback` (100%), `Instrument Serif Fallback` (Times/Liberation Serif, 86.39%), with measured ascent/descent overrides | cuts layout shift while Google Fonts load (loaded non-blocking via preload + `media=print` swap, `<noscript>` fallback) |

The rest is unchanged from D1: `--bg #08090a`, `--s1 #0e1012`, `--tx3 #868e98`, `--carbon #f2ab6d`, `--silicon #7cc6f2`, `--ice #e9f4ff`, `--ok #8fe0b0`, focus `#ffd79a`.

### Margin sources (component)
- **Structure**
  - One DOM list (`#notes`) sits in an `aside.margin` inside the decision. A container query on `.decision` (`container-type:inline-size`) places it:
    - ≥700 px container: a right margin column (≈236 px, left hairline) beside the reasoning.
    - Below that: inline under the "If you sign" block, with a **Hide / Show** toggle (`#srcToggle`, `aria-expanded`, `aria-controls="notes"`), open by default.
  - Each note shows its number chip, the human dot or agent diamond, the name, a PERSON / AGENT vN label, the source line, and `id · reviewed by <name>` in mono.
  - The reasoning has four superscript `.ref` links (`href="#src-n"`, each with an `aria-label` naming the source, e.g. "Source 1: Teo Lindqvist, design review round 3").
- **States**
  | State | Ref | Note | Crystal |
  |---|---|---|---|
  | rest | tinted chip (silicon = agent, carbon = person) | plain | thread dotted at 22% |
  | hover / focus on ref | chip inverts + glow | `.hl` fill `--note-hl` + inset hairline | source node `.hlring`, pending node ring, thread solid with `#spec` gradient, 2 px |
  | hover / focus on note | matching ref inverts | `.hl` | same as above |
  | focus-visible | 2 px `#ffd79a` outline | 2 px `#ffd79a` outline | n/a |
  | ref clicked while notes collapsed (mobile) | n/a | notes expand, then scroll and focus the note | n/a |
  | trace row hover / focus | n/a | n/a | lights the node it came from (unchanged from D1) |

### "If you sign" block and principle
- **Consequences block:** `dl.conseq` in three columns (one column ≤760), with these entries:
  - If you sign: "12 Point Lobos volunteers get an invite."
  - What is shared: "Build 0.3.2. Locations rounded to 1 km; no contacts."
  - How to undo: "Revoke anytime. The build expires in 30 days."
- **Principle:** `figure.principle` has a 2 px carbon→silicon rule, the quote "Learning a preference does not grant permission." in Instrument Serif italic 22 px (21 mobile), and a figcaption: "You approved a similar send on Oct 12. Keel noted that you prefer small cohorts, and is asking anyway."

### Signature (component)
- **Signature line:** a `×` mark, the hint, an absolutely positioned `svg#sig` (290 px wide, sitting 14 px below the line so the descenders cross it), and the caption "Signature · Maya Okafor, lead / approves sends to outsiders". Once signed, the caption reads "Signed hh:mm · record d07·f1a9".
- **Glyphs:** "Maya Okafor" comes from the Hershey *scripts* single-stroke font, converted to smooth Catmull-Rom bezier paths (10 strokes), plus one underline flourish. The paths are inline, with no font dependency.
- **States**
  | State | What you see |
  |---|---|
  | unsigned | hint visible, paths hidden |
  | signing | hint fades; strokes draw in order with a glowing nib (`#nib`) riding the pen point; buttons disabled, primary reads "Signing…" |
  | signed | full luminous ink with glow, hint gone |
  | revoked | ink at 35% opacity, glow removed, a `--tx2` strike line scales across (320 ms) |
  | declined | the line stays unsigned; the decision greys (`.closed`) |
  | reduced motion | name appears instantly; no nib, fire, glints or toast motion |

### Approval choreography (timings)
1. **t = 0** Sign & approve (click, Enter or Space)
   - All three actions disable and the primary reads "Signing…".
   - Polite live region: "Signing decision 07 as Maya Okafor."
2. **0 → 1200 ms** The signature draws.
   - Each stroke gets a share of 1200 ms proportional to its length (minimum 60 ms), with 40 ms pen-lift gaps.
   - Each stroke eases in and out.
   - The nib follows `getPointAtLength`.
3. **≈1200 ms finalize**
   - Header: "Decision 07 · approved". Pill: **Signed** (`--ok` on `--ok-dim`).
   - The outcome card appears with the stamp "✓ Signed by Maya Okafor (you) · time", the summary and **Revoke invites**. Focus moves to the outcome (`tabindex=-1`, no outline, border brightens).
   - The pending node solidifies (pulse removed, gradient fill, glint).
   - Trace gains "You signed decision 07 · d07·f1a9".
   - Live region: "Approved. Signed by Maya Okafor…".
4. **+250 ms (settle)** `.crystallized`
   - Prismatic fire strokes around the Prototype ring (1.8 s, dash draw then rest at 55%).
   - Ring-2 glints (1.4 s each, 60 ms stagger, 300 ms delay).
   - The stage track moves to Build. The census marks Prototype 12 of 12 and Build as current. The footer counts and the lattice `aria-label` update.
5. **+900 ms** The milestone toast slides up: "003 / Prototype *crystallized* · 12 pieces · 5 human · 7 agent. Next ring: Build."
   - Second live region: "Milestone: Prototype stage crystallized…".
   - The toast hides itself after 9 s, waiting while it is hovered or focused. Close returns focus to the outcome.
- **Decline:** opens an inline box with an **optional** reason (textarea, focused). Confirming does the following:
  - Pill: **Declined**; the dot goes grey.
  - Outcome: "Nothing was sent. Keel kept the draft and will not re-ask until something changes.", plus "Your note to Keel: "…"" when a reason was given (HTML-escaped).
  - Focus moves to the outcome, and the change is announced. Cancel returns focus to Decline.
- **Revoke** (available any time after signing):
  - The signature is struck and dims. Pill: **Revoked**; header: "invites revoked"; the dot goes grey.
  - The toast is dismissed.
  - Trace gains "You revoked the decision 07 invites · d07·r1".
  - Focus stays on the outcome, and the change is announced.
- **Ask Keel to revise:** the outcome line says the decision stays open; announced.
- **Reduced motion** (`prefers-reduced-motion: reduce`): every delay is 0 and transitions/animations are 1 ms. The name, fire end-state and toast appear at once.

### Verification for D4
- Screenshots:
  - `shots/4-crystal-lattice-merged-{desktop,mobile}.png`
  - `shots/full/4-crystal-lattice-merged-{desktop,mobile}-full.png`
  - `shots/full/4-crystal-lattice-merged-{desktop,mobile}-approved.png`
- `overflow.js` at 390 px: scrollWidth 390, with no overflowing elements.
- Scripted checks in Playwright Chromium, with no console or page errors:
  - hover on a ref lights the ref, note, node and thread
  - focus on a note lights the same set
  - keyboard approve shows the focus ring, the mid-draw nib and the outcome focus
  - both live regions announce
  - revoke works
  - mobile Hide toggle works
  - decline with a reason is echoed back
  - reduced motion is instant
- Lighthouse 12, mobile form factor, served from a local `http.server`, Playwright Chromium 1248:
  - **Performance 97, Accessibility 100**
  - FCP / LCP 1.7 s, TBT 0 ms, CLS 0.088
  - The remaining flags are text compression and document latency, which are artefacts of the local Python server.
- Not verified:
  - Real screen readers (VoiceOver/NVDA)
  - Safari/Firefox rendering of the SVG filters and container queries
  - Real font-loading on slow networks beyond the Lighthouse throttle

---

## Not verified
- Lighthouse was run only for Direction 4 (mobile: Performance 97, Accessibility 100). Directions 1–3 were not measured.
- Fonts are installed locally on the build machine, so the screenshots show the intended faces. Google Fonts loading and the system-font fallback were not checked in a clean browser.
- Not tested with a screen reader. Keyboard focus order was reviewed in the markup but not walked through on video.
- Contrast was computed for the main text pairs only, not for every state (for example hover tints).
