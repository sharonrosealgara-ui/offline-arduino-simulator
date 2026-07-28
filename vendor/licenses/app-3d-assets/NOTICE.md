# 3D hardware representations — attribution record

**Component.** Every 3D object rendered in the circuit workspace: the Arduino-compatible
Uno R3 board, the full-size solderless breadboard, and the component library (LED,
resistor, pushbutton, potentiometer, jumper wire, 16×2 character LCD, servo).

**Origin.** All of it is **original work authored for this project**, defined as procedural
three.js geometry in TypeScript. Source of record:

- `apps/desktop/src/renderer/app/circuit/hardware/UnoR3Board.tsx`
- `apps/desktop/src/renderer/app/circuit/hardware/Breadboard.tsx`
- `apps/desktop/src/renderer/app/circuit/hardware/parts.tsx`
- `apps/desktop/src/renderer/app/circuit/hardware/labels.ts`

**License.** MIT, same as the rest of this repository. See `/LICENSE`.

## What was deliberately NOT used

- No Arduino product photography, marketing renders, or box art.
- No downloaded or purchased 3D models, from any marketplace or model library.
- No CDN-hosted models, textures, HDRIs, or fonts. There are no binary asset files at all:
  every mesh is generated at runtime from primitive geometry, so there is nothing to
  license, attribute, or fetch.
- No copied Arduino silkscreen artwork. Pin legends are rendered from plain text using the
  application's own bundled typeface stack.

## Trademark position

"Arduino" is a trademark of Arduino SA. This project is **not** affiliated with,
endorsed by, or sponsored by Arduino SA. The board model is an *Arduino-compatible*
representation: it reproduces the functional layout that makes the hardware recognisable
and teachable — header positions, pin numbering, the DIP-28 MCU, USB and barrel-jack
placement — and does not reproduce Arduino SA's logo, the infinity-symbol mark, or its
distinctive silkscreen branding.

The board is described in the UI as "Arduino Uno R3" solely as a nominative reference to
the target hardware the simulator emulates, which is the accurate description of what the
compiler targets (ATmega328P at 16 MHz).

## Dimensional reference

Proportions follow the publicly documented Uno R3 mechanical envelope — 68.6 mm × 53.4 mm
board outline, 2.54 mm header pitch, standard 830-tie-point breadboard geometry. Dimensions
and pin numbering are facts about the hardware, not copyrightable expression.
