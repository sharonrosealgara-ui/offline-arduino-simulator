# Component footprints — dimensional provenance

Every physical dimension the circuit workspace draws, and where it came from.

This file exists because the alternative is numbers with no history. Earlier revisions of
this work carried figures that *looked* sourced and were not; anything here that could not
be read from a manufacturer document says so in its own row.

**No datasheet PDF is vendored.** These are copyrighted documents; we cite their official
URLs. The dimensions themselves are facts about hardware, not copyrightable expression —
the same position recorded in [NOTICE.md](NOTICE.md) for the board.

The reference part for each component is a **visual reference footprint**: one specific
orderable part chosen to stand for its class. Nothing here claims that every LED, resistor,
button, trimmer, servo or 1602 module shares these dimensions.

---

## Verification status

| Component | Reference part | Document reached | Figures read from it |
|---|---|---|---|
| LED | Kingbright WP7113ID | ✅ | ⚠️ notes only — see below |
| Resistor | Yageo CFR-25 | ✅ | ✅ full dimension table |
| Pushbutton | Omron B3F-1000 | ✅ | ✅ full package drawing |
| Potentiometer | Bourns 3386P-1-103LF | ❌ HTTP 403 | ❌ none |
| Servo | TowerPro SG90 Digital | ✅ | ✅ dimension table |
| LCD | Newhaven NHD-0216K1Z-FL-YBW | ✅ | ⚠️ partial — see below |

---

## LED — Kingbright WP7113ID

*T-1 3/4 (5 mm) Solid State Lamp*, spec DSAF0012 / 1101005042, Rev V.14A, 2026-01-08,
page 1 package drawing.
<https://www.kingbrightusa.com/images/catalog/SPEC/wp7113id.pdf>

| Dimension | Value (mm) | Provenance |
|---|---|---|
| Lens / body diameter | 5.0 | authorised figure |
| Flange diameter | 5.9 | authorised figure |
| Package length | 8.6 | authorised figure |
| Flange thickness | 1.0 | authorised figure |
| Lead pitch | 2.54 | authorised figure |
| Lead cross-section | 0.5 sq (+0.25/−0.1) | authorised figure |
| Unformed lead length | 27 min | authorised figure |
| General tolerance | ±0.25 unless otherwise noted | **read from the document text layer** |

Two notes were extracted verbatim from the PDF: *"Tolerance is ±0.25 (0.01″) unless
otherwise noted"* and *"Lead spacing is measured where the leads emerge from the package."*
The numeric drawing content is vector/CID-encoded and could not be machine-read here, so the
dimensions above are recorded as authorised rather than independently verified.

**Educational rendering convention:** leads are drawn short — long enough to reach the
simulator's terminal anchors and no further. The manufacturer's unformed lead length is
27 mm minimum. A part drawn with 27 mm of wire would dwarf the board and teach nothing, so
the leads are formed. This is a deliberate departure from the drawing, not a reading of it.

## Resistor — Yageo CFR-25

*Carbon Film Resistors, General Purpose, CFR Series — Product Specification*, **V.3,
2024-04-03**, page 2 of 16, "DIMENSIONS (Unit: mm)".
<https://yageogroup.com/content/datasheet/asset/file/YAGEO-CFR_DATASHEET>

| Dimension | Value (mm) | Provenance |
|---|---|---|
| Body length (L) | 6.3 ±0.5 | **read from the table** |
| Body diameter (D) | 2.4 ±0.2 | **read from the table** |
| Lead length (H) | 28 ±2.0 | **read from the table** |
| Lead diameter (d) | 0.55 ±0.05 | **read from the table** |

**Educational rendering convention:** the leads are formed to a 0.4 in (10.16 mm) span so
the part sits on the 0.1 in grid the rest of the workspace uses. Yageo's own forming options
(26 mm, 52.4 mm, 73 mm) are auto-insertion pitches and none of them is 0.4 in — this span is
a project convention derived from the documented grid, not a figure from the datasheet.

## Pushbutton — Omron B3F-1000

*Tactile Switch B3F*, Cat. No. **A070-E1-08**, page 4, "Dimensions (Unit: mm)", 6 × 6 mm
Models, Standard Flat Plunger Type (without Ground Terminal).
<https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf>

| Dimension | Value (mm) | Provenance |
|---|---|---|
| Body | 6 ±0.2 × 6 ±0.2 | **read from the drawing** |
| Height | 4.3 ±0.2 | **read from the drawing** |
| Plunger diameter | 3.5 | **read from the drawing** |
| PCB hole pattern | 6.5 ±0.1 × 4.5 ±0.1 | **read from the drawing** |
| Hole diameter | 1 ±0.1, four | **read from the drawing** |
| Blanket tolerance | ±0.4 unless otherwise specified | **read from the drawing note** |

The 6.5 × 4.5 mm hole pattern is the leg geometry. The two legs on each side of the switch
are permanently common — which is what `permanentlyCommonTerminals` in the component
registry already encodes, and why the legs sit 4.5 mm apart within a side and 6.5 mm across.

## Potentiometer — Bourns 3386P-1-103LF

10 kΩ top-adjust Trimpot, breadboard-friendly.
<https://www.bourns.com/docs/product-datasheets/3386.pdf>

**The document could not be retrieved (HTTP 403).** Every figure below is an authorised
value, none independently verified:

| Dimension | Value (mm) | Provenance |
|---|---|---|
| Body (square) | 9.53 × 9.53 | authorised figure |
| Terminal diameter | 0.51 ±0.05 | authorised figure |
| Terminal grid | 2.54 | authorised figure |
| Wiper | terminal 2 | authorised figure |

**One inference is recorded explicitly:** the three terminals are drawn **in line** at
2.54 mm pitch. That follows from the authorised "2.54 mm grid relationships" plus terminal 2
being the wiper, but the drawing itself was not readable, so the arrangement is the single
detail here that rests on inference rather than the document. If the 3386P drawing shows a
staggered arrangement, this is the value to correct.

## Servo — TowerPro SG90 Digital

Manufacturer product page, dimensional table.
<https://towerpro.com.tw/product/sg90-7/>

| Dimension | Value (mm) | Provenance |
|---|---|---|
| Overall | 23 × 12.2 × 29 | **read from the page** |
| Configuration table | A 30.3, B 22.7, C 27, D 12.2, E 32.3, F 17 | **read from the page** |
| Connector | JR (fits JR and Futaba) | **read from the page** |
| Lead length | 250 | **read from the page** |
| Weight | 9 g | **read from the page** |

The page gives 23 × 12.2 × 29 plainly but does not say which lettered dimension maps to
which axis, so the plain overall figures are used and the letters are recorded for whoever
next reads the drawing.

**Rendering convention:** the SG90 has no rigid pins. It has a 250 mm lead and a JR plug, so
the three electrical terminals are drawn as a short pigtail ending in a three-position
connector whose contacts sit on the terminal anchors. Depicting rigid pins in the case would
be depicting a part that does not exist. The pigtail is drawn far shorter than 250 mm for
the same reason the LED's leads are.

## LCD — Newhaven Display NHD-0216K1Z-FL-YBW

Mechanical drawing, **Revision 1A**, drawn and approved **2022-11-09** by K. Lewis.
"Unless otherwise specified: Dimensions are in Millimeters, Third Angle Projection."
<https://newhavendisplay.com/content/specs/NHD-0216K1Z-FL-YBW.pdf>

| Dimension | Value (mm) | Provenance |
|---|---|---|
| PCB outline | 80.00 ±0.5 × 36.00 ±0.5 | authorised figure |
| Bezel | 71.20 ±0.2 × 25.20 ±0.2 | authorised figure |
| Viewing area | 66.00 ±0.2 × 16.00 ±0.2 | authorised figure |
| Header | 1 × 16 at 2.54 pitch | authorised figure |
| Unspecified linear tolerance | ±0.3 | authorised figure |

**Read from the document:** the part number, Revision 1A, the 2022-11-09 drawing date, the
millimetres/third-angle note, and the pin assignment — Vss 1, Vdd 2, Vo 3, RS 4, R/W 5, E 6,
DB0 7 … DB7 14, A 15, K 16. That assignment matches the component registry's LCD terminal
order exactly, which is the useful cross-check: the header this draws is the header the
simulator already wires. The outline figures are vector-drawn and were not machine-readable,
so they are recorded as authorised.

The normally populated **top** header is represented, per the drawing's pin-1 location.
