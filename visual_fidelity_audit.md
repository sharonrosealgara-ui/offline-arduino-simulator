# Visual Fidelity Audit — Offline Arduino Simulator 0.1.0

Branch `agents/offline-arduino-simulator-v1-visual-fidelity`, audited at `6b65c38`.
No product code was modified.

## Method and its limits

This is a **source-level audit**: every finding below cites a file and line and is derived
from the CSS, component source, and 3D geometry actually shipped. Contrast ratios were
computed from the token values; sizes were computed from the world-unit geometry against
real part datasheet dimensions.

**No rendered screenshots were observed.** This session cannot host the packaged GUI (the
installed app exits immediately with no window and no log output when launched from here),
so anything that can only be judged by looking — perceived colour harmony, hover/active
feel, 3D lighting quality, real font rendering at each resolution — is marked
**UNVERIFIED** and rated on source evidence alone. Those need a human at the desktop before
any of them is treated as settled. Findings not so marked are determinate from source.

## Summary

**No Critical issues.** The foundations are better than the brief assumes: the design-token
layer passes WCAG AA everywhere it is used, the Uno board geometry is dimensionally
faithful, and the offline/no-CDN discipline holds throughout. The gap to "polished
client-ready" is concentrated in four places:

1. two renderers that disagree with each other (3D vs the 2D fallback),
2. two panes that ignore the app theme (Monaco editor, 3D viewport),
3. a responsive model that starves the circuit workspace at classroom resolutions,
4. component scale that is right for the board and wrong for the parts on it.

18 findings: 6 High, 8 Medium, 4 Low. Three strengths worth protecting are recorded at the
end.

---

## 1. Overall three-pane desktop layout

### F1 — Editor width is a percentage of the whole window, so the workspace starves — High

- **Where:** [global.css:186-208](apps/desktop/src/renderer/styles/global.css#L186-L208), `--editor-width: 42%`; splitter feed in [AppShell.tsx:90](apps/desktop/src/renderer/app/AppShell.tsx#L90).
- **Current:** grid columns are `library | 42% | 6px | 1fr | inspector`. The 42% is taken from the *full* grid width, before the fixed side panels. At 1280 px: 188 + 538 + 6 + 232 = 964, leaving **316 px** for the 3D workspace. At 1366: **366 px**. At 1920: 690 px.
- **Impact:** the primary object of the product — the circuit — gets the smallest pane on exactly the machines the product targets. A 3D board view 316 px wide cannot show an Uno plus wired parts legibly.
- **Fix:** make the editor track a fraction of the *flexible* region (`minmax(0, Xfr)` against the canvas track, or compute `--editor-width` from the space left after the panels). Keep the 25–70 % clamp semantics.
- **Simulation risk:** none. Pure CSS grid track sizing.
- **Coverage:** jsdom test asserting computed track widths at the four target widths; visual regression at 1280 and 1920.

### F2 — Command bar wraps to multiple rows at classroom widths — Medium

- **Where:** [global.css:103-118](apps/desktop/src/renderer/styles/global.css#L103-L118) (`flex-wrap: wrap`), 17 controls in [CommandBar.tsx](apps/desktop/src/renderer/app/CommandBar.tsx) (Open, Save, Save As, Examples, Documentation, Verify, Run/Pause, Step, Reset, Stop, status dot + text, Undo, Redo, 2 panel toggles, Low-spec checkbox, flash/rev readout).
- **Current:** wrapping is deliberate and documented, but the set has grown (Save As was added this week) and each extra row costs ~34 px of vertical space at 720 p.
- **Impact:** at 1280×720 the toolbar plausibly occupies two to three rows, squeezing the 280 px-minimum top row.
- **Fix:** demote secondary controls (Low-spec, flash readout, panel toggles) into an overflow menu below ~1400 px; keep the six workbench verbs always visible.
- **Simulation risk:** none, provided Low-spec keeps routing through `simulationClient.setLowSpec`.
- **Coverage:** jsdom test that the primary verb set stays in one row at each target width.
- **UNVERIFIED:** exact wrap points depend on rendered font metrics.

### F3 — Panel toggles become dead controls below 1240 px — High

- **Where:** [global.css:225-234](apps/desktop/src/renderer/styles/global.css#L225-L234).
- **Current:** `@media (max-width: 1240px) { .libraryPane, .inspectorPane { display: none } }` overrides the store's `layout.trayVisible` / `inspectorVisible`. The toolbar toggles still render, still flip `aria-pressed`, and change nothing on screen.
- **Impact:** a control that visibly reports success while doing nothing is worse than an absent one. On a 1280-wide laptop the student can never reach the component library or inspector.
- **Fix:** below the breakpoint, present the panels as overlay drawers on demand rather than deleting them; or disable the toggles with an explanatory tooltip so the state is honest.
- **Simulation risk:** none.
- **Coverage:** test asserting toggle + narrow viewport produces either a visible panel or a disabled control — never a silent no-op.

---

## 2. Arduino Uno visual accuracy and component proportions

### S1 — Board geometry is genuinely faithful — strength, protect it

[uno-geometry.ts](apps/desktop/src/renderer/app/circuit/hardware/uno-geometry.ts) works in
real inches: 68.6 × 53.4 × 1.6 mm board, exact 0.1" header pitch, the 0.16" D7→D8 offset
that makes shield footprints correct, DIP-28 on 0.6" rows, the non-symmetric Uno mounting
holes, ICSP positions. Nothing here should be "improved" for looks.

### F4 — Part sizes are inconsistent with the board they sit on — High

- **Where:** [DynamicNetlist3D.tsx](apps/desktop/src/renderer/app/circuit/DynamicNetlist3D.tsx) — LCD `boxGeometry [1.0, 0.05, 0.44]` (L799), servo `[0.5, 0.2, 0.24]` (L749), LED dome `sphereGeometry [0.055]` (L623), pushbutton `[0.24, 0.12, 0.24]` (L889).
- **Current** (world unit = 1 inch, board exact): LCD1602 renders 25.4 × 11.2 mm against a real module of **80 × 36 mm** — about **32 %**. Servo body 12.7 × 6.1 mm against an SG90's 22.8 × 12.2 mm — about **55 %**. LED dome ⌀2.8 mm against the catalog's own "LED (5 mm)" — about **56 %**. The pushbutton at 6.1 × 6.1 mm is **correct**.
- **Impact:** next to a dimensionally exact board, wrong part scale reads as toy-like to anyone who knows the hardware — and it teaches wrong intuitions about what fits on a breadboard. The inconsistency (one part right, three shrunk by different amounts) is what makes it look like an oversight rather than a style.
- **Fix:** derive every body from datasheet millimetres via the existing `mm()` helper, as the board already does. Re-anchor terminal offsets to the new bodies in the same change.
- **Simulation risk:** **none electrically** — the netlist keys off terminal ids, not geometry. The real risk is *visual*: terminal anchors that no longer sit on the part. Move bodies and anchors together and check wire attachment.
- **Coverage:** unit test asserting each body's world size equals its datasheet mm within tolerance; a terminal-anchor test that every anchor stays within its body's bounding box.

---

## 3. Breadboard / circuit-canvas appearance and spatial clarity

### F5 — The 3D viewport ignores the app theme — Medium

- **Where:** [CircuitCanvas3D.tsx:145](apps/desktop/src/renderer/app/components/CircuitCanvas3D.tsx#L145) (`radial-gradient(#1f2027 → #0c0d10)`), bench `#171a1f` (L110), overlay chips `rgba(12,14,18,0.82)` in [workbench.css:437-498](apps/desktop/src/renderer/styles/workbench.css#L437-L498).
- **Current:** the canvas and its overlays are hardcoded dark. In the default **light** theme the workspace is a black rectangle between white panels.
- **Impact:** the app looks like two products stitched together; on classroom projectors a dark viewport also loses contrast.
- **Fix:** drive the backdrop, bench, and grid from theme tokens with a light-mode studio palette; keep overlay chips readable in both (they currently rely on being over dark).
- **Simulation risk:** none. Materials on the board/parts should not change — only backdrop, bench, grid, overlay chrome.
- **Coverage:** visual regression of the viewport in both themes.
- **UNVERIFIED:** whether a light backdrop actually flatters the teal solder mask is a judgement call needing eyes.

### F6 — No breadboard exists — Medium (scope decision)

- **Where:** [component-catalog.tsx:114-232](apps/desktop/src/renderer/app/circuit/component-catalog.tsx#L114-L232) — six kinds, no breadboard; parts float on a bench plane.
- **Current:** wires run point-to-point through the air between floating parts.
- **Impact:** the brief names "breadboard/circuit-canvas appearance". A simulator aimed at beginners that has no breadboard diverges from what students use physically and from what clients expect from the category.
- **Fix:** out of scope for a fidelity pass — a breadboard is a new component kind with netlist, schema, and simulator implications. **Flagged for Sharon's decision**, not planned here.
- **Simulation risk:** high if attempted — new component kind touches the netlist compiler and project schema.
- **Coverage:** n/a until scoped.

---

## 4. LEDs, resistors, buttons, potentiometers, LCD, servo, wires, connection points

### F7 — The 2D renderer is a different, much cruder product — High

- **Where:** [ComponentGlyph.tsx](apps/desktop/src/renderer/circuit/renderers/ComponentGlyph.tsx), reachable from [CircuitPane.tsx:35](apps/desktop/src/renderer/app/components/CircuitPane.tsx#L35) via the viewport toggle.
- **Current:** in 2D the Uno is a plain rounded rectangle (`#0b7285`) with the words ARDUINO UNO and **no headers or pins drawn at all** (L74-81); the resistor has **no colour bands** (L96-103) although [resistor-bands.ts](apps/desktop/src/renderer/app/circuit/hardware/resistor-bands.ts) exists and the catalog thumbnail shows them; the LED is a symmetric circle with **no cathode flat** (L84-95) despite the catalog teaching that polarity matters; the pushbutton's four legs and the potentiometer's three legs are not drawn; every non-Uno part is 60 × 40 px regardless of kind (L42-61), so an LED is the same size as a servo. The board colour also disagrees with the 3D solder mask (`#0f6b5c`).
- **Impact:** a student who switches to 2D — a documented, one-click mode — lands in a visibly unfinished view that contradicts what the panels just taught them about polarity and band colours.
- **Fix:** decide the 2D view's status (below), then either raise it to the same drawing standard using the existing band/polarity helpers, or remove the toggle.
- **Simulation risk:** none. Glyphs are presentational; selection and wiring go through the store.
- **Coverage:** snapshot tests per kind; a test that resistor bands in 2D match `resistor-bands.ts` for the same ohms.

### F8 — Terminal hit targets and wire gauge are tuned by eye, not by rule — Low

- **Where:** [DynamicNetlist3D.tsx:242](apps/desktop/src/renderer/app/circuit/DynamicNetlist3D.tsx#L242) (`tubeGeometry` radius 0.02 / 0.026 selected), L333-352 (`hitRadius` / `rimRadius` / `coreRadius` from [terminal-anchor-style.ts](apps/desktop/src/renderer/app/circuit/terminal-anchor-style.ts)).
- **Current:** wire radius 0.02" = 0.5 mm, close to real 22 AWG (0.64 mm) — reasonable. Anchor radii are a separate ad-hoc scale.
- **Impact:** minor; mostly a maintainability and consistency issue as parts are rescaled in F4.
- **Fix:** express both in millimetres alongside the F4 rescale so they stay proportionate.
- **Simulation risk:** none, but anchor `hitRadius` affects how easy wiring is — do not shrink it.
- **Coverage:** extend the existing [terminal-anchor-style.test.ts](apps/desktop/tests/terminal-anchor-style.test.ts).

---

## 5. Toolbar hierarchy, project / compiler / simulation controls

### F9 — All controls share one visual weight — Medium

- **Where:** [CommandBar.tsx:66-114](apps/desktop/src/renderer/app/CommandBar.tsx#L66-L114).
- **Current:** three groups (project, compile/run, view) are separated only by a 12 px margin. Run is the sole `btn--primary`; Verify, Save, Save As, Open, Examples, Documentation are visually identical.
- **Impact:** no reading order. A student scanning for "the button that makes it go" gets one colour cue in a row of eleven identical buttons.
- **Fix:** group separators, a secondary tier for view controls, and a consistent icon-plus-label rhythm. Do not add a second primary colour.
- **Simulation risk:** none if handlers are untouched.
- **Coverage:** the existing suites already assert behaviour; add a visual regression of the bar.

### F10 — Save vs Save As affordance is title-only — Low

- **Where:** [CommandBar.tsx:71-88](apps/desktop/src/renderer/app/CommandBar.tsx#L71-L88).
- **Current:** the Save tooltip changes with `sourcePath` ("Save to this project's file" vs "Choose where to save"), but nothing visible distinguishes the two states.
- **Impact:** the tooltip is the only signal that Ctrl+S will open a dialog rather than write silently.
- **Fix:** reflect it in the status bar wording, which already tracks the same state.
- **Simulation risk:** none. **Must not** alter save semantics or the failure dialog.
- **Coverage:** extend [project-save-status.test.ts](apps/desktop/tests/project-save-status.test.ts).

---

## 6. Code editor integration

### F11 — Monaco is always light, whatever the OS theme — High

- **Where:** [MonacoSketchEditor.tsx:71-81](apps/desktop/src/renderer/editor/MonacoSketchEditor.tsx#L71-L81) — `monaco.editor.create` is called with **no `theme` option**, and no `defineTheme`/`setTheme` call exists anywhere in [editor/](apps/desktop/src/renderer/editor/).
- **Current:** Monaco falls back to its default `vs` (light) theme while the rest of the app follows `prefers-color-scheme`. In dark mode the editor is a white slab occupying ~42 % of the window.
- **Impact:** the single most visible theme break in the product, on the pane students look at most.
- **Fix:** define light and dark Monaco themes from the app tokens and switch with the same media query; keep the bundled-worker/no-CDN setup untouched.
- **Simulation risk:** none. Theming does not touch the model, diagnostics markers, or the store sync.
- **Coverage:** test asserting `setTheme` is called with the dark theme when `prefers-color-scheme: dark` matches.
- Font choices are fine: 14 px / 21 px line height, `Cascadia Code` → `Consolas` → generic mono, all OS-local. Relayout is correctly driven by a `ResizeObserver` ([MonacoSketchEditor.tsx:135](apps/desktop/src/renderer/editor/MonacoSketchEditor.tsx#L135)) — no finding.

---

## 7. Serial Monitor and Diagnostics readability

### F12 — Logic-analyzer canvas colours are hardcoded for a dark background — Medium

- **Where:** [LogicAnalyzerCanvas.tsx:28-31](apps/desktop/src/renderer/app/logic/LogicAnalyzerCanvas.tsx#L28-L31) (protocol colours), L145 (`#22d3ee`), L191-197 (`#fbbf24`).
- **Current:** text colours are correctly read from CSS custom properties (L108-110) — good — but waveform strokes, the cursor, and marker fills are fixed. Amber `#fbbf24` on a light panel is roughly **1.9:1**.
- **Impact:** in light theme the cursor and markers are close to invisible.
- **Fix:** read these from tokens too, with a light-theme variant.
- **Simulation risk:** none — presentational only; sampling and VCD export untouched.
- **Coverage:** unit test that every canvas colour resolves from a token, not a literal.

### F13 — Secondary text falls well below the stated 14 px floor — Medium

- **Where:** [global.css:5](apps/desktop/src/renderer/styles/global.css#L5) states "Minimum body text 14px". Actual: `.terminalList__state` **10 px** ([workbench.css:331](apps/desktop/src/renderer/styles/workbench.css#L331)), `.diagList__sev` 10 px, `.viewportLegend kbd` **10.5 px**, `.viewportLegend` 11.5 px, `.partCard__summary` 11 px, `.sidePanel__heading` 11 px, `.diagnosticRow__badge` 11 px, logic analyzer labels 11 px, status bar 12 px, `.paneHeader` 12 px uppercase.
- **Impact:** on a 1366×768 classroom laptop at 100 % scale, 10 px uppercase with letter-spacing is at the edge of legibility — and these carry state (WIRED/OPEN, severity).
- **Fix:** a typographic scale with a hard 12 px floor for any text conveying state, 14 px for body.
- **Simulation risk:** none.
- **Coverage:** a CSS lint test failing any `font-size` below the floor.

### F14 — Empty states inform but do not act — Low

- **Where:** [ProblemsView.tsx:16](apps/desktop/src/renderer/components/ProblemsView.tsx#L16), [VirtualSerialMonitor.tsx:72](apps/desktop/src/renderer/serial/VirtualSerialMonitor.tsx#L72), [Inspector.tsx:47](apps/desktop/src/renderer/app/panels/Inspector.tsx#L47).
- **Current:** plain sentences ("No problems. Press Verify to compile your sketch.") with no actionable control.
- **Impact:** minor; the wording is genuinely good. A button would shorten the path.
- **Fix:** offer the named action as a button in the empty state.
- **Simulation risk:** none if it calls the existing controller verbs.
- **Coverage:** jsdom test that the empty-state action invokes the same controller function as the toolbar.

---

## 8-10. Interaction, status, accessibility

### S2 — Token contrast passes AA — strength

Computed against [global.css:8-42](apps/desktop/src/renderer/styles/global.css#L8-L42), light theme on `--bg-panel`: secondary text **8.2:1**, accent **5.8:1**, danger **6.5:1**, success **5.4:1**, warning **5.0:1**. Dark theme secondary text **7.9:1**. All ≥ 4.5:1. Do not "brighten" these during a restyle.

### S3 — State is not communicated by colour alone — strength

Status items pair colour with an icon and a word ([StatusBar.tsx](apps/desktop/src/renderer/app/StatusBar.tsx), [global.css:169-182](apps/desktop/src/renderer/styles/global.css#L169-L182)); diagnostic badges print the severity word; the armed part card adds a border and inset bar, not just a tint.

### F15 — Interactive targets contradict the project's own minimum — Medium

- **Where:** [global.css:73-76](apps/desktop/src/renderer/styles/global.css#L73-L76) sets `button { min-height: 36px; min-width: 36px }` and the header claims "minimum interactive target 36x36 (prefer 40x40)". More specific rules override it: `.iconBtn` **26 × 26** ([workbench.css:182-196](apps/desktop/src/renderer/styles/workbench.css#L182-L196)), `.btn--compact` **26 px** (L400-405), `.viewportBtn` **28 px** (L447-460), `.placedRow__select` **30 px** (L167-180), `.linkBtn` `min-height: 0` (L407-417). [workbench.css:10](apps/desktop/src/renderer/styles/workbench.css#L10) even documents a different rule ("Interactive targets are >= 26px"), so the two files disagree in writing.
- **Impact:** the rotate/delete icon buttons — the per-part destructive controls — are the smallest targets in the app.
- **Fix:** settle one number, raise the offenders to it (padding, not icon size), and make the two comments agree. `<select>` elements also need an explicit min-height; the global rule only covers `button`.
- **Simulation risk:** none.
- **Coverage:** CSS lint test asserting no interactive class declares a min-height below the floor.

### F16 — Parts cannot be selected from the keyboard in the 3D view — High

- **Where:** selection is pointer-only in [DynamicNetlist3D.tsx](apps/desktop/src/renderer/app/circuit/DynamicNetlist3D.tsx) (mesh `onClick`); [useAppShortcuts.ts:69-84](apps/desktop/src/renderer/app/hooks/useAppShortcuts.ts#L69-L84) makes R / Delete act on `circuit.selectedIds`; the overlay legend advertises those keys ([ViewportOverlay.tsx:16-25](apps/desktop/src/renderer/app/circuit/ViewportOverlay.tsx#L16-L25)).
- **Current:** a keyboard-only user can never populate `selectedIds` in the default 3D mode, so every advertised key is unreachable. The 2D glyphs *are* focusable (`tabIndex={0}`, [ComponentGlyph.tsx:29-31](apps/desktop/src/renderer/circuit/renderers/ComponentGlyph.tsx#L29-L31)) — the fallback view is more accessible than the primary one.
- **Impact:** the circuit workspace is not keyboard-operable. This is the audit's most serious accessibility finding.
- **Fix:** a focusable parts list that drives selection (the inspector's placed-parts list is already the natural surface — give its rows roving focus and wire selection), so R / Delete / Esc become reachable without touching the 3D picking code.
- **Simulation risk:** none — selection is store state; component control values are separate.
- **Coverage:** jsdom test driving selection, rotate, and delete entirely by keyboard.

### F17 — Two state signals have no accessible text — Medium

- **Where:** the unsaved dot `●` with only `title="Unsaved changes"` ([ComponentLibrary.tsx:32-36](apps/desktop/src/renderer/app/panels/ComponentLibrary.tsx#L32-L36)); the serial send box is placeholder-only ([VirtualSerialMonitor.tsx:76-84](apps/desktop/src/renderer/serial/VirtualSerialMonitor.tsx#L76-L84)).
- **Impact:** `title` on a non-interactive `<span>` is not reliably announced and never appears on keyboard focus; a placeholder is not an accessible name.
- **Fix:** visually-hidden text on the dot; an `aria-label` or visible label on the input.
- **Simulation risk:** none.
- **Coverage:** `getByLabelText` assertions in the existing jsdom suites.

### F18 — Zoom and text scaling are untested — Medium, **UNVERIFIED**

- **Where:** layout is px-based throughout; `.appShell { height: 100vh }` ([global.css:93-101](apps/desktop/src/renderer/styles/global.css#L93-L101)).
- **Current:** with fixed px panel widths and a vh-locked shell, Windows display scaling at 125 %/150 % — common on classroom laptops — behaves like a proportionally narrower window, which walks straight into F1 and F3.
- **Fix:** verify at 100/125/150 % after F1 and F3 land; move panel widths to `rem` if they prove brittle.
- **Coverage:** packaged human acceptance at each scaling factor.

---

## 11. Offline classroom usability on low-spec Windows laptops

### F19 — The 3D canvas renders continuously even when nothing changes — High

- **Where:** [CircuitCanvas3D.tsx:154](apps/desktop/src/renderer/app/components/CircuitCanvas3D.tsx#L154) — `frameloop="always"`.
- **Current:** the WebGL scene redraws every frame whether or not the simulation is running, a part moved, or an LED changed.
- **Impact:** on an integrated-GPU classroom laptop this is continuous GPU and CPU load — heat, fan noise, and battery drain during a lesson where the screen may be static for minutes. Low-spec mode reduces quality but not frame cadence.
- **Fix:** `frameloop="demand"` with explicit `invalidate()` on store-driven display deltas, camera motion, and drag; or drive cadence from `lowSpecMode`.
- **Simulation risk:** **none to the AVR simulation**, which runs in its worker — but this is the one fix here that can *look* like a simulation bug if invalidation is missed (an LED that stops updating). Needs the most careful test coverage of anything in this audit.
- **Coverage:** test that a display delta triggers exactly one invalidate; packaged acceptance watching a Blink LED for 60 s.

### S4 — Offline and performance discipline is already right — strength

No CDN, no remote fonts, no `.glb`: every mesh is procedural and every label is a canvas
texture drawn with OS fonts ([CircuitCanvas3D.tsx:1-22](apps/desktop/src/renderer/app/components/CircuitCanvas3D.tsx#L1-L22)); Monaco and its workers
are bundled locally ([monaco-setup.ts](apps/desktop/src/renderer/editor/monaco-setup.ts)); catalog thumbnails are inline SVG
([component-catalog.tsx:38-109](apps/desktop/src/renderer/app/circuit/component-catalog.tsx#L38-L109)). Header pins and MCU leads are
instanced, DPR is capped at 1.5, and low-spec drops shadows and antialiasing. None of this
should regress.

---

## 12. Distance from a polished client-ready simulator

Ranked by what a client would notice first:

1. **Theme incoherence** (F11, F5) — a white editor beside a black viewport beside white panels reads as unfinished before any detail is examined.
2. **Two renderers of different quality** (F7) — one click reveals a visibly cruder product.
3. **Part scale** (F4) — an exact board carrying under-scale parts undermines the precision the board earns.
4. **Workspace starvation at classroom resolutions** (F1, F3) — the circuit is the product; it should not be the smallest pane.
5. **No breadboard** (F6) — the clearest category expectation gap, and the only one that is a product decision rather than a polish task.
6. **Toolbar hierarchy and typographic scale** (F9, F13, G-level tokens) — the difference between "functional" and "designed".

---

## Design-token gap underlying much of the above

There is no spacing, radius, or type scale. Padding values in use: 1, 2, 3, 4, 5, 6, 7, 8,
9, 10, 11, 12, 15, 16, 17, 18, 20, 22 px. Radii: 3, 4, 5, 6, 7, 8, 11, 12 px. Font sizes:
10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14 px — including four fractional sizes that round
inconsistently at 100 % on low-DPI panels. Colour tokens exist and are good; everything
else is ad hoc. Phase A addresses this first because F9, F13, F15, and the light-theme work
all depend on having a scale to snap to.
