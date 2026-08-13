# Breadboard geometry and topology — dimensional provenance

The simulator's breadboard is a **generic educational 400 tie-point solderless breadboard**.
It carries no manufacturer name, logo, trademark, printed part number or copied artwork. The
documents below are the pinned *dimensional and topological* reference only; nothing from
them is reproduced as branding or as artwork.

No third-party 3D model, mesh, texture or image is used, and none will be. The breadboard,
when it is built, will be procedural three.js geometry authored for this project, exactly as
every other object in the workspace already is.

Neither PDF is committed to this repository. Their redistribution terms are not stated in the
documents, so they are cited by URL only. The application has **no runtime or build-time
network dependency** on them.

---

## Sources

### S1 — primary

| | |
|---|---|
| Title | BB400 — Solderless Plug-in BreadBoard with 400 tie-points and 4 power rails (Product Datasheet) |
| Publisher | BusBoard Prototype Systems Ltd. |
| URL | https://www.busboard.com/documents/datasheets/BPS-DAT-%28BB400%29-Datasheet.pdf |
| Revision | **Rev 6** — internal document id `BPS-DAT-(BB400)-0001 Rev 6 Datasheet` |
| Copyright line | © 2015 BusBoard Prototype Systems Ltd. |
| Accessed | 2026-08-04 |
| Extent | 3 pages, complete text extracted and read |

### S2 — supporting (internal connections and body size)

| | |
|---|---|
| Title | BB300, BB400, BB400T — Plug-in Solderless BreadBoards (Product Datasheet) |
| Publisher | BusBoard Prototype Systems Ltd. |
| URL | https://www.busboard.com/documents/datasheets/BPS-DAT-%28BB300%29-Datasheet.pdf |
| Revision | **Rev 5** — internal document id `BPS-DAT-(BB300+BB400)-0001 Rev 5 Datasheet.doc` |
| Copyright line | © 2014 BusBoard Prototype Systems Ltd. |
| Accessed | 2026-08-04 |
| Extent | 3 pages, complete text extracted and read |

Note on which document says what: the **body envelope is not in S1**. S1 Rev 6 states no
overall dimensions at all. The envelope comes from S2, which covers both products and gives
the BB400 size explicitly. This distinction is recorded because it would otherwise be easy to
attribute the figure to the wrong document.

---

## DOCUMENTED — stated verbatim in the sources

| Value | Statement | Source |
|---|---|---|
| Total tie points | "400 total tie points"; "400 connection tie-points (i.e. 400 wire insertion holes)" | S1 |
| Circuit area | "a 300 tie-point IC circuit area" | S1, S2 |
| Terminal groups | "connected in 60 vertical columns … with **5 connected holes in each**. This is the circuit area." | S2 |
| Circuit columns (BB400) | "The BB400 and BB400T breadboards have 60 vertical columns in the circuit area (the green lines)" | S1, S2 |
| Power rails | "plus four 25 tie-point power rails"; "4 'rails' or distribution strips for power and ground running horizontally (the red and blue lines)" | S1, S2 |
| Distribution strips | "two 50 tie-point distribution strips providing four power rails"; "2 Distribution strips (100 tie-points)" | S1, S2 |
| Hole pitch | "Hole Pitch: 0.1" / 2.54 mm"; "Hole Pitch/Style: 0.1" (2.54 mm), Square Wire Holes" | S1, S2 |
| Hole style | "Square Wire Holes" | S1, S2 |
| Housing | "The housing is made of white ABS plastic"; "White ABS Plastic with Color Printed Legend" | S1, S2 |
| Body envelope | "Size: 3.3 x 2.1 x 0.3in (**84 x 54.3 x 8.5mm**)" | **S2 only** |
| Legend | "a printed legend giving numbers and letters for columns and rows" | S1 |
| Orientation | circuit columns run **vertically**; rails run **horizontally** | S2 |
| Rail continuity | four rails of 25 tie-points each, described as continuous distribution strips; **no segmentation, split or break is mentioned in either document** | S1, S2 |
| Rail usability | "A distribution strip can be used to carry a signal if it is not needed for power or ground." | S1, S2 |

Additional documented values not needed by the geometry model, recorded for completeness:
insertion wire size 21–26 AWG / 0.016–0.028 in / 0.4–0.7 mm, 0.025 in square post headers,
contacts phosphor bronze with plated nickel, 50 000 insertions, rated 36 V / 2 A, metal back
plate 0.031 in / 0.8 mm, ABS heat distortion 84 °C.

---

## DERIVED — computed from documented values, no new measurement

| Value | Derivation |
|---|---|
| Terminal-strip holes | 400 total − 100 rail = **300** (also stated directly) |
| Numbered columns | 300 holes ÷ 10 rows = **30** |
| Rows | 60 groups × 5 holes ÷ 30 columns = **10** rows, in two banks of 5 |
| Holes per rail | 100 rail holes ÷ 4 rails = **25** (also stated directly) |
| Column-to-column span | 29 × 2.54 mm = **73.66 mm** across 30 columns |
| Within-bank row span | 4 × 2.54 mm = **10.16 mm** for rows A–E and F–J |
| Total groups | 60 terminal + 4 rail = **64** |

---

## APPROXIMATED — *not* documented; visual choices, not manufacturer measurements

Every value in this table is a rendering decision made by this project. **None of it may be
presented as a measurement taken from BusBoard documentation.** Each is chosen to sit on the
documented 2.54 mm lattice so the hole grid stays internally consistent.

| Value | Chosen | Why, and what is genuinely unknown |
|---|---|---|
| E-to-F hole-centre spacing | 7.62 mm (3 × documented pitch) | **Neither document states it.** Chosen as the integer pitch multiple that matches the 0.3 in DIP straddle the circuit area is designed around. |
| Visible plastic trench width | narrower than the hole-centre spacing above | **Not documented.** The opening a student sees is a separate quantity from the E-to-F centre distance and must never be conflated with it. Fixed in C3. |
| Rail offset / alignment vs circuit area | rails centred on the body length, holes at uniform 2.54 mm pitch | **Not documented.** No half-pitch (1.27 mm) offset is claimed, because no source confirms one. |
| Rail hole grouping | none modelled in C1A | Real boards commonly break each 25-hole rail into five visual groups of five. The gap width is **not documented**; C1A models rail holes at uniform pitch and defers the visual grouping to C3. It is cosmetic — all 25 holes are one electrical node either way. |
| Which rail row is positive | inner row positive, outer row negative | **Not documented.** A rendering convention only. |
| Row order along the depth axis | A–E bank adjacent to the top distribution strip | **Not documented.** Fixed and documented in `packages/contracts/src/breadboard.ts` so that 2D and 3D cannot disagree. |
| Body edge margins | not modelled in C1A | Derivable only once rail offsets are fixed. Deferred to C3. |
| Hole opening size | not modelled in C1A | Documented insertion wire range (0.4–0.7 mm) constrains it but does not state it. |
| Body and legend colours | white ABS is documented; exact hex is not | Colour choice deferred to C3. |

---

## Trademark and naming position

"BusBoard", "BPS", "BB300", "BB400" and "BB400T" are trademarks of BusBoard Prototype
Systems Ltd. This project is not affiliated with, endorsed by, or sponsored by BusBoard
Prototype Systems Ltd.

The simulator's component is named generically — a "400 tie-point breadboard". Hole pitch,
tie-point counts, group topology and body dimensions are facts about a commodity part, not
copyrightable expression, and the near-identical layout is shared across the whole category.
No BusBoard part number, logo, legend artwork, colour scheme or product photograph is
reproduced.

---

## 3D geometry (Phase C3) — what is canonical and what is drawn

The 3D breadboard exists internally as procedural three.js geometry authored for this
project. **No third-party model, mesh, texture or image is used, and no asset is downloaded
at build or run time.** The rendering is generic: no manufacturer name, part number, logo,
legend artwork or product photograph is reproduced.

**From the canonical contract** (`packages/contracts/src/breadboard.ts`, converted through the
shared unit helper): the 400 hole identities and their local positions, the 64 group
memberships, the hole pitch, and the 84 x 54.3 x 8.5 mm body envelope.

**Visual approximations — design choices, not measurements:** body thickness above the bench
and its edge treatment, hole opening size and recess depth, the visible centre-channel width
(a *separate* quantity from the documented 7.62 mm E-to-F hole-centre distance, and never to
be conflated with it), rail stripe geometry and offsets, printed markings, and every colour,
roughness and material property.

**Instance-order and picking contract.** All 400 openings are drawn as a single
`THREE.InstancedMesh`. Instance *i* is canonical hole *i* — the same order the 2D view uses —
because an instanced mesh reports only an integer when picked, and that integer is the only
link between a click and a terminal id. `resolveInstanceTerminal` returns
`{ componentId, terminalId }` and returns null rather than guessing for a missing,
non-integer or out-of-range instance. Identity is always qualified by component instance:
`bb1:A1`, `bb2:A1` and `uno1:A1` are three different terminals.

**Still gated.** This geometry exists internally only. A project containing a breadboard
cannot enter the production 3D Workspace, because C4 has not yet supplied the obstacle
volumes and hole-specific wire-attachment portals a wire ending in a hole would need. The
application gate stays until it does.
