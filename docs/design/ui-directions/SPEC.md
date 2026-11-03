# Exofab · Forge screen · Three design directions

**Status:** design exploration, not production code.
**Example data:** every project name, person, agent, hash, time and count on these screens is fictional. The example project is *Tidepool, a field journal app for marine volunteers*. Each page labels itself "Example data".

| # | File | Mood |
|---|------|------|
| 1 | `1-crystal-lattice.html` | Dark, luminous; the Moissanite lab look |
| 2 | `2-workshop-bench.html` | Light, tactile; a maker's bench |
| 3 | `3-field-ledger.html` | Editorial and calm; a ship's log |

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

## Not verified
- Lighthouse was not run. Each page is a single HTML file with inline CSS/JS, no libraries and only Google Fonts, so a mobile score of 80+ is plausible but not measured.
- Fonts are installed locally on the build machine, so the screenshots show the intended faces. Google Fonts loading and the system-font fallback were not checked in a clean browser.
- Not tested with a screen reader. Keyboard focus order was reviewed in the markup but not walked through on video.
- Contrast was computed for the main text pairs only, not for every state (for example hover tints).
