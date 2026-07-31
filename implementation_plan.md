# Visual Fidelity — Phased Implementation Plan

Companion to [visual_fidelity_audit.md](visual_fidelity_audit.md). Baseline `6b65c38`,
branch `agents/offline-arduino-simulator-v1-visual-fidelity`. Nothing below has been
implemented; this is the proposal.

## Invariants for every phase

These are load-bearing and must be provably untouched at each commit:

- compiler behaviour and diagnostics; AVR simulation; GPIO and electrical logic;
- project Open / Save / Save As semantics and the save-failure dialog;
- IPC and preload security boundaries (including the session path-grant model);
- terminal (serial) behaviour; bundled examples; the `.oasproj.json` project format;
- version **0.1.0**;
- fully offline: no CDN, no remote fonts, no runtime-downloaded assets;
- no AI-generated imagery replacing programmatic SVG or procedural 3D geometry.

**Standing gate for every phase:** `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build` must pass, and the 297 existing tests must stay green. Any phase whose diff
touches `packages/simulator/`, `apps/desktop/src/main/`, or `apps/desktop/src/preload/` is
out of scope by definition — visual work should not reach those trees. The one permitted
exception is Phase C's `frameloop` change, which stays inside the renderer.

---

# Phase A — Design tokens, layout, accessibility, responsive resizing

Foundation first: later phases snap to the scale this phase establishes.

### A1. Token scale
**Files:** `apps/desktop/src/renderer/styles/global.css` (new `--space-*`, `--radius-*`,
`--font-size-*` tokens).
**Do:** add scales (space 2/4/6/8/12/16/24; radius 4/6/8/12; font-size 12/13/14/16/20 with
12 px as the hard floor). Do **not** change any existing colour token — they are measured
AA-passing (audit S2).
**Acceptance:** tokens exist and are documented; no colour value changes in the diff.
**Risk:** none. **Coverage:** none needed yet.

### A2. Typography floor — audit F13
**Files:** `styles/workbench.css`, `app/logic/LogicAnalyzerCanvas.tsx`,
`components/RuntimeDiagnostics.tsx`, `components/ProblemsView.tsx`.
**Do:** replace every `font-size` below 12 px and all four fractional sizes with scale
tokens. State-bearing text (WIRED/OPEN chips, severity badges) goes to 12 px minimum.
**Acceptance:** no `font-size` under 12 px anywhere in the renderer.
**Risk:** row heights grow slightly — check the inspector terminal list does not overflow at
1366×768. **Coverage:** new `styles-contract.test.ts` parsing both CSS files and failing on
any sub-floor `font-size`.

### A3. Hit targets — audit F15
**Files:** `styles/workbench.css` (`.iconBtn`, `.btn--compact`, `.viewportBtn`,
`.placedRow__select`, `.linkBtn`), `styles/global.css` (extend the min-height rule to
`select`), plus the contradictory comment at `workbench.css:10`.
**Do:** settle one minimum (recommend **32 px** as an honest, reachable compromise — see
*Decisions*), raise offenders via padding so icon sizes are unchanged, and make both file
headers state the same number.
**Acceptance:** every interactive class meets the floor; the two comments agree.
**Risk:** the inspector's per-part row grows; verify the placed-parts list still fits.
**Coverage:** extend `styles-contract.test.ts` to assert the floor.

### A4. Responsive grid — audit F1
**Files:** `styles/global.css` (`.workbench` tracks), `app/AppShell.tsx` (splitter
`pxToValue` must measure the same basis).
**Do:** make the editor and canvas share the flexible region (`minmax(0, Nfr)` or a
`--editor-width` computed after panel widths), preserving the 25–70 % clamp.
**Acceptance:** at 1280 / 1366 / 1440 / 1920 the canvas track is never narrower than the
editor track at the default split; the inspector is never pushed off-screen.
**Risk:** the splitter's percentage semantics change basis — the restore-default value (42)
must still land where users expect. **Coverage:** `workbench-layout.test.ts` (jsdom)
asserting computed track widths at the four widths.

### A5. Narrow-viewport panels — audit F3
**Files:** `styles/global.css` (the `max-width: 1240px` block), `app/AppShell.tsx`.
**Do:** stop `display: none`-ing panels the toggles claim to control. Either overlay them on
demand below the breakpoint, or disable the toggles with an explanatory title.
**Acceptance:** no viewport width at which pressing a panel toggle changes `aria-pressed`
without changing what is on screen.
**Risk:** an overlay panel above the 3D canvas must not swallow the pointer events the
canvas needs for placement and wiring. **Coverage:** jsdom test at 1200 px asserting toggle
→ visible panel, or a disabled control.

### A6. Accessible names — audit F17
**Files:** `app/panels/ComponentLibrary.tsx`, `serial/VirtualSerialMonitor.tsx`.
**Do:** visually-hidden text beside the unsaved dot; a real label or `aria-label` on the
serial send input.
**Acceptance:** both reachable via `getByLabelText`.
**Risk:** none — **must not** alter serial send behaviour. **Coverage:** add to the existing
jsdom suites.

**Phase A commits**
1. `refactor: add spacing, radius, and type scales`
2. `fix: raise text and hit targets to the stated minimums`
3. `fix: give the circuit workspace a fair share of the workbench`
4. `fix: stop panel toggles silently doing nothing on narrow screens`
5. `fix: name the unsaved indicator and serial input for screen readers`

---

# Phase B — Arduino board and electronic-component fidelity

### B1. Datasheet-driven part sizing — audit F4
**Files:** `app/circuit/DynamicNetlist3D.tsx` (LED ~L620-655, resistor ~L665-690, pot
~L700-730, servo ~L745-775, LCD ~L795-820, pushbutton ~L885-915); reuse `mm()` from
`app/circuit/hardware/uno-geometry.ts`.
**Do:** express every body in datasheet millimetres — LCD1602 80 × 36 mm, SG90 servo
22.8 × 12.2 × 32.5 mm, 5 mm LED ⌀5 mm, ¼ W resistor ⌀2.3 × 6.3 mm, tactile switch 6 × 6 mm
(already correct). Move terminal anchors with the bodies in the same commit.
**Acceptance:** each body's world size equals its datasheet value within 5 %; every terminal
anchor still sits on its part; wires visibly attach.
**Risk:** **no electrical risk** — the netlist keys off terminal ids. Visual risk is real:
anchors drifting off resized bodies. A larger LCD also changes scene composition, so the
camera `fit` needs re-checking.
**Coverage:** new `component-dimensions.test.ts` (world size vs datasheet table); extend
`terminal-anchor-style.test.ts` to assert anchors stay within body bounds.

### B2. Board palette — **blocked on a decision** (see *Decisions*)
**Files:** `app/circuit/hardware/uno-geometry.ts` (`BOARD_PALETTE`).
**Do:** nothing until Sharon rules on the trademark-versus-familiarity question.
**Risk:** trademark, not technical.

### B3. Leave the geometry alone
No change to `uno-geometry.ts` dimensions, header pitch, the 0.16" offset, mounting holes,
or ICSP positions. This is recorded as an explicit non-goal so a later "tidy-up" does not
quietly flatten it.

**Phase B commits**
1. `fix: size components from their datasheets`
2. `test: pin component dimensions and terminal anchors`

---

# Phase C — Wiring, interaction feedback, editor, terminal, diagnostics

### C1. Monaco theming — audit F11
**Files:** `editor/MonacoSketchEditor.tsx`, new `editor/monaco-theme.ts`.
**Do:** define light and dark themes from the app tokens; select by `prefers-color-scheme`
and follow changes live.
**Acceptance:** in dark mode the editor background matches `--bg-panel`; diagnostics markers
from `useMonacoDiagnostics` stay visible in both.
**Risk:** none to model or store sync — **do not touch** `external-sketch-sync.ts` or the
`ResizeObserver` relayout. **Coverage:** test asserting the dark theme is applied when the
media query matches, and that marker severities keep their colours.

### C2. Themed 3D viewport — audit F5
**Files:** `app/components/CircuitCanvas3D.tsx` (backdrop, bench, grid),
`styles/workbench.css` (overlay chrome).
**Do:** token-driven backdrop with a light-mode studio palette. Board and part materials
**unchanged**.
**Acceptance:** viewport chrome reads correctly in both themes; solder mask, silkscreen, and
pin colours are byte-identical in the diff.
**Risk:** low. **UNVERIFIED** until seen — the light palette is a judgement call.
**Coverage:** visual regression in both themes.

### C3. Logic-analyzer colours — audit F12
**Files:** `app/logic/LogicAnalyzerCanvas.tsx` (L28-31, 145, 191-197).
**Do:** resolve waveform, cursor, and marker colours from tokens as the text colours already
are.
**Acceptance:** no colour literal remains in the drawing path; cursor ≥ 3:1 against the panel
in both themes.
**Risk:** none — **must not** touch sampling, decoding, or `exportVCD`.
**Coverage:** unit test that every drawing colour resolves from a custom property.

### C4. Keyboard-operable circuit — audit F16
**Files:** `app/panels/Inspector.tsx` (placed-parts list → roving tabindex + selection),
`app/hooks/useAppShortcuts.ts` (unchanged if selection reaches the store).
**Do:** make the existing placed-parts list a real selection surface so R / Delete / Esc
become reachable without a mouse. Do **not** rebuild 3D picking.
**Acceptance:** a keyboard-only user can select, rotate, and delete a part.
**Risk:** none to simulation; must not disturb the pushbutton hold control's
press/release pairing (`useMomentaryControl`) — that has its own safety suite.
**Coverage:** jsdom test performing select → rotate → delete entirely by keyboard.

### C5. On-demand rendering — audit F19
**Files:** `app/components/CircuitCanvas3D.tsx`, `app/circuit/DynamicNetlist3D.tsx`
(invalidate on display deltas), `app/circuit/CameraRig.tsx`.
**Do:** `frameloop="demand"` plus `invalidate()` on display deltas, camera motion, drag,
selection, and placement.
**Acceptance:** idle scene draws no frames; a running Blink still animates the L LED and any
placed LED for 60 s without stalling.
**Risk:** **the highest-risk item in this plan.** A missed invalidation looks exactly like a
simulation bug even though the simulation is fine. If coverage cannot be made convincing,
ship the cheaper half (cadence tied to `lowSpecMode`) and leave `always` in place.
**Coverage:** test that each display delta triggers exactly one invalidate; mandatory
packaged human acceptance watching an LED.

### C6. Toolbar hierarchy — audit F9, F10
**Files:** `app/CommandBar.tsx`, `styles/global.css`.
**Do:** group separators and a secondary tier for view controls; overflow the least-used
controls below ~1400 px. Reflect Save-vs-Save-As in the status bar wording.
**Acceptance:** the six workbench verbs stay one row at all four target widths; every
existing handler is called from the same place.
**Risk:** none if handlers are untouched — save semantics and the failure dialog stay exactly
as merged. **Coverage:** existing suites plus a one-row assertion per width.

### C7. Actionable empty states — audit F14
**Files:** `components/ProblemsView.tsx`, `serial/VirtualSerialMonitor.tsx`.
**Do:** offer the action the text already names, calling the existing controller verb.
**Risk:** none. **Coverage:** jsdom test that the button calls the same function as the
toolbar.

### C8. 2D renderer — **blocked on a decision** (audit F7, see *Decisions*)

**Phase C commits**
1. `fix: theme the code editor with the rest of the app`
2. `fix: make the 3D workspace follow the app theme`
3. `fix: draw logic-analyzer waveforms from theme tokens`
4. `feat: make circuit parts selectable from the keyboard`
5. `perf: stop redrawing the 3D workspace when nothing changes`
6. `fix: give the toolbar a readable hierarchy`
7. `fix: let empty states do the thing they suggest`

---

# Phase D — Packaged visual regression and human acceptance

### D1. Visual regression harness
**Files:** new `apps/desktop/tests/visual/` plus a config entry.
**Do:** deterministic renders of the workbench chrome at 1280 / 1366 / 1440 / 1920 in both
themes. Component-level jsdom snapshots for panels, toolbar, status bar, dialogs; a separate
opt-in path for 3D (WebGL is not reproducible in CI — treat 3D as human-verified, not
snapshotted).
**Acceptance:** the suite fails on an unintended chrome change and is stable across runs.
**Risk:** flaky snapshots are worse than none — keep 3D out.

### D2. Full validation
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run smoke:compile`,
`npm run verify:toolchains`, `node scripts/check-licenses.cjs`, then `npm run dist:win`;
report both artifacts with byte size, timestamp, and SHA-256.

### D3. Packaged human acceptance (Sharon)
Windows scaling at 100 / 125 / 150 %, both OS themes, at each of the four resolutions:

1. Editor matches the OS theme; 3D workspace matches the OS theme.
2. Canvas is not the narrowest pane at 1280 and 1366.
3. Panel toggles do something visible at every width, or are visibly disabled.
4. LCD, servo, and LED read at believable size beside the Uno.
5. Every part's wires still attach to its terminals.
6. Blink runs 60 s with the L LED animating (guards C5).
7. Select, rotate, and delete a part using only the keyboard.
8. Save, Save As, cancel, and a forced write failure behave exactly as accepted at
   `6b65c38` — the failure dialog wording unchanged.
9. Serial output, Problems, and Logic Analyzer readable in both themes.
10. Application closes with no orphan processes.

### D4. Non-goals for this milestone
No breadboard; no board-palette change; no new component kinds; no project-format change;
no version change.

---

# Decisions needing Sharon's approval

1. **The 2D renderer (audit F7).** Raise it to parity — real headers, resistor bands, LED
   polarity, per-kind proportions, matching palette — or remove the toggle and ship 3D only?
   Parity is roughly a day of drawing work on `ComponentGlyph.tsx`; removal is an hour but
   drops the only view that currently works with a keyboard (until C4) and the only view
   that works without WebGL. **Recommendation:** keep it and raise it, because a WebGL
   fallback matters on low-spec classroom hardware.

2. **Board palette (audit B2).** The solder mask is deliberately a generic teal
   (`#0f6b5c`), not Arduino SA's brand colour, with the trademark position recorded in
   `vendor/licenses/app-3d-assets/NOTICE.md`. Clients may expect the familiar colour.
   Keep the deliberate distance, or move closer and accept the trademark question?
   **Recommendation:** keep it — the current choice is defensible and documented.

3. **Breadboard (audit F6).** Genuine category expectation, but a new component kind
   touching the netlist compiler, project schema, and simulator. Out of scope here.
   Schedule separately, or drop?

4. **Hit-target minimum (A3).** The project states 36 × 36 but ships 26 px icon buttons.
   Adopt 36 (largest change, most rows grow), or settle at 32 as an honest floor?
   **Recommendation:** 32, then revisit if acceptance finds it tight.

5. **On-demand rendering (C5).** Real battery and thermal win on classroom laptops, but a
   missed invalidation mimics a simulation bug. Take it with the full test regime, or take
   the safer cadence-only change?
   **Recommendation:** attempt `demand` behind the coverage above; fall back if acceptance
   shows any stall.

6. **Phase ordering.** Phase A changes shared CSS that B and C build on. Land A as its own
   reviewed, human-accepted increment first, or run A+B+C as one branch with a single
   acceptance pass at the end? **Recommendation:** A first, separately — it is the phase
   most likely to shift layout in ways only eyes will catch.
