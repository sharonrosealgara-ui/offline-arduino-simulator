/**
 * The component catalog: everything the library panel and inspector need to describe a
 * part, plus its offline thumbnail.
 *
 * Thumbnails are inline SVG drawn in this file. That keeps them crisp at any DPI, adds zero
 * bytes of binary asset, needs no CDN, and means there is no third-party artwork to license
 * — the same position recorded in vendor/licenses/app-3d-assets/NOTICE.md.
 *
 * Only kinds the simulator can actually stamp into a netlist appear here. If a part is in
 * this list, placing it produces a component the solver understands; nothing here is a
 * preview of an unimplemented feature.
 *
 * SCALE, DELIBERATELY, IS NOT SHARED BETWEEN ICONS
 * -----------------------------------------------
 * Each thumbnail is normalised into its own 32x32 box: the parts keep their real
 * proportions and their orientation and polarity cues, but an LED is not drawn 1/16th the
 * size of an LCD. True relative scale would leave the LED a dot and the resistor a hair,
 * which is useless in a list you pick from. The workspace is where real scale belongs.
 */
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import { componentPhysical } from './hardware/component-geometry';

/**
 * Fits a part's real footprint into the icon box.
 *
 * Returns the width and height to draw at, in the 32-unit viewBox, preserving the aspect
 * ratio taken from the shared physical table. Nothing here restates a dimension.
 */
function fitToIcon(kind: ComponentKind, margin = 3): { w: number; h: number; x: number; y: number } {
  const physical = componentPhysical(kind);
  const box = 32 - margin * 2;
  if (!physical) return { w: box, h: box, x: margin, y: margin };
  const aspect = physical.body.width / physical.body.depth;
  const w = aspect >= 1 ? box : box * aspect;
  const h = aspect >= 1 ? box / aspect : box;
  return { w, h, x: (32 - w) / 2, y: (32 - h) / 2 };
}

export interface CatalogTerminal {
  id: string;
  label: string;
  hint: string;
}

export interface CatalogEntry {
  kind: ComponentKind;
  name: string;
  summary: string;
  /** Short guidance shown in the inspector — the thing students get wrong. */
  guidance: string;
  terminals: CatalogTerminal[];
  /** Editable properties surfaced by the inspector. */
  properties: CatalogProperty[];
  rotatable: boolean;
  thumbnail: JSX.Element;
}

export type CatalogProperty =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: ReadonlyArray<{ value: string; label: string }> };

// ---------------------------------------------------------------------------------------
// Thumbnails — 32x32 viewBox, currentColor-aware so they follow the panel theme.
// ---------------------------------------------------------------------------------------
const svgProps = {
  viewBox: '0 0 32 32',
  width: 30,
  height: 30,
  'aria-hidden': true,
  focusable: false,
} as const;

const LedThumb = (() => {
  const f = fitToIcon('led');
  // The flange is the widest feature, so the lens is sized to leave room for it.
  const r = Math.min(f.w, f.h) / 2 / 1.18;
  const cx = 16;
  const cy = 15;
  return (
    <svg {...svgProps}>
      {/* Lens, flange and the flat — the same cathode cue the workspace draws. */}
      <circle cx={cx} cy={cy} r={r * 1.18} fill="#ff5a4d" opacity="0.3" stroke="#7f1d1d" strokeWidth="0.8" />
      <circle cx={cx} cy={cy} r={r} fill="#ff5a4d" stroke="#7f1d1d" strokeWidth="1.1" />
      <rect x={cx + r * 0.72} y={cy - r * 0.7} width={r * 0.32} height={r * 1.4} fill="#0f172a" opacity="0.8" />
      <line x1={cx - 2.6} y1={cy + r} x2={cx - 2.6} y2="30" stroke="#9ca3af" strokeWidth="1.6" />
      <line x1={cx + 2.6} y1={cy + r} x2={cx + 2.6} y2="27" stroke="#9ca3af" strokeWidth="1.6" />
    </svg>
  );
})();

const ResistorThumb = (() => {
  const f = fitToIcon('resistor');
  const h = Math.max(7, f.h);
  const y = 16 - h / 2;
  return (
    <svg {...svgProps}>
      <line x1="1" y1="16" x2={f.x} y2="16" stroke="#9ca3af" strokeWidth="1.6" />
      <line x1={f.x + f.w} y1="16" x2="31" y2="16" stroke="#9ca3af" strokeWidth="1.6" />
      <rect x={f.x} y={y} width={f.w} height={h} rx={h * 0.35} fill="#d9c08a" stroke="#8a6d3b" strokeWidth="1" />
      {['#c62828', '#c62828', '#6b3b17', '#d4af37'].map((c, i) => (
        <rect key={c + i} x={f.x + f.w * (0.18 + i * 0.16)} y={y} width={f.w * 0.09} height={h} fill={c} />
      ))}
    </svg>
  );
})();

const ButtonThumb = (() => {
  const f = fitToIcon('pushbutton');
  return (
    <svg {...svgProps}>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="2" fill="#1c1f24" stroke="#495057" strokeWidth="1.1" />
      <circle cx="16" cy="16" r={f.w * 0.29} fill="#e11d48" stroke="#881337" strokeWidth="1" />
      {/* Four legs on the 6.5 x 4.5 pattern, in proportion. */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy]) => (
        <circle key={`${sx}${sy}`} cx={16 + sx * f.w * 0.37} cy={16 + sy * f.h * 0.27} r="1.5" fill="#c9ced6" stroke="#4b5563" strokeWidth="0.5" />
      ))}
    </svg>
  );
})();

const PotThumb = (() => {
  const f = fitToIcon('potentiometer');
  return (
    <svg {...svgProps}>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="1.5" fill="#1f4fa0" stroke="#173a75" strokeWidth="1" />
      {/* Top-adjust screw, offset from centre as on the real trimmer. */}
      <circle cx={f.x + f.w * 0.32} cy="16" r={f.w * 0.17} fill="#d8dde3" stroke="#8b939c" strokeWidth="0.8" />
      <line
        x1={f.x + f.w * 0.32 - f.w * 0.17}
        y1={16 - f.w * 0.12}
        x2={f.x + f.w * 0.32 + f.w * 0.17}
        y2={16 + f.w * 0.12}
        stroke="#2b2f36"
        strokeWidth="1.4"
      />
      {/* Three pins in line at 2.54 mm pitch. */}
      {[-1, 0, 1].map((i) => (
        <circle key={i} cx={16 + i * f.w * 0.27} cy={Math.min(f.y + f.h + 1.6, 30.4)} r="1.5" fill="#c9ced6" stroke="#4b5563" strokeWidth="0.5" />
      ))}
    </svg>
  );
})();

const LcdThumb = (() => {
  const f = fitToIcon('lcd1602');
  const physical = componentPhysical('lcd1602')!;
  const viewW = f.w * (physical.features.viewWidth / physical.body.width);
  const viewH = f.h * (physical.features.viewDepth / physical.body.depth);
  return (
    <svg {...svgProps}>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="1.5" fill="#0f5132" stroke="#052e16" strokeWidth="1" />
      <rect
        x={16 - viewW / 2}
        y={f.y + f.h * 0.18}
        width={viewW}
        height={viewH}
        fill="#7fa63a"
        stroke="#8f959d"
        strokeWidth="0.8"
      />
      <rect x={16 - viewW / 2 + 1} y={f.y + f.h * 0.28} width={viewW * 0.62} height="1.4" fill="#12180a" />
      <rect x={16 - viewW / 2 + 1} y={f.y + f.h * 0.48} width={viewW * 0.44} height="1.4" fill="#12180a" />
      {/* The 16-way header along one edge. */}
      <rect x={f.x} y={f.y + f.h - 2.2} width={f.w} height="2.2" fill="#15161a" />
    </svg>
  );
})();

const ServoThumb = (() => {
  const physical = componentPhysical('servo')!;
  // The mounting tabs are wider than the case, so they set the fit.
  const tabRatio = physical.features.tabSpan / physical.body.width;
  const f = fitToIcon('servo', 3 + (26 - 26 / tabRatio) / 2);
  const tabW = f.w * tabRatio;
  return (
    <svg {...svgProps}>
      <rect x={16 - tabW / 2} y={f.y + f.h * 0.22} width={tabW} height={f.h * 0.16} fill="#1e40af" />
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="1.5" fill="#1e3a8a" stroke="#172554" strokeWidth="1" />
      {/* Horn above the case, on the shaft. */}
      <circle cx={16 + f.w * 0.22} cy={f.y + 3.4} r="2.6" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="0.8" />
      <rect x={16 + f.w * 0.22} y={f.y + 2.6} width="8" height="1.7" rx="0.8" fill="#f3f4f6" />
      {/* Three-wire pigtail in the JR colours, keyed to VCC / GND / signal. */}
      <line x1={f.x} y1={f.y + f.h * 0.58} x2="1.5" y2={f.y + f.h * 0.58} stroke="#d1352b" strokeWidth="1.3" />
      <line x1={f.x} y1={f.y + f.h * 0.72} x2="1.5" y2={f.y + f.h * 0.72} stroke="#1c1f24" strokeWidth="1.3" />
      <line x1={f.x} y1={f.y + f.h * 0.86} x2="1.5" y2={f.y + f.h * 0.86} stroke="#e07a1f" strokeWidth="1.3" />
    </svg>
  );
})();

// ---------------------------------------------------------------------------------------

/** A breadboard in miniature: two banks, the centre channel, and a rail line each side. */
const BreadboardThumb = (
  <svg viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Breadboard">
    <rect x="2" y="7" width="28" height="18" rx="2" fill="#eef0ec" stroke="#495057" strokeWidth="1" />
    <line x1="3.5" y1="9.5" x2="28.5" y2="9.5" stroke="#d1352b" strokeWidth="0.8" />
    <line x1="3.5" y1="22.5" x2="28.5" y2="22.5" stroke="#2b74d1" strokeWidth="0.8" />
    <rect x="4" y="15" width="24" height="2" fill="#c9ced6" />
    {[12, 13.6, 18.4, 20].map((y) =>
      [6, 9, 12, 15, 18, 21, 24, 27].map((x) => (
        <rect key={`${x}-${y}`} x={x - 0.5} y={y - 0.5} width="1" height="1" fill="#495057" />
      )),
    )}
  </svg>
);

// Catalog
// ---------------------------------------------------------------------------------------
export const COMPONENT_CATALOG: readonly CatalogEntry[] = [
  {
    kind: 'led',
    name: 'LED (5 mm)',
    summary: 'Light-emitting diode. Conducts one way only.',
    guidance:
      'Polarity matters: the long lead is the anode (+) and the flat edge marks the cathode (−). Always pair it with a series resistor.',
    terminals: [
      { id: 'anode', label: 'Anode (+)', hint: 'Long lead — connect toward the positive side' },
      { id: 'cathode', label: 'Cathode (−)', hint: 'Flat edge / short lead — connect toward ground' },
    ],
    properties: [
      {
        key: 'color',
        label: 'Colour',
        type: 'select',
        options: [
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
          { value: 'blue', label: 'Blue' },
          { value: 'yellow', label: 'Yellow' },
          { value: 'white', label: 'White' },
        ],
      },
    ],
    rotatable: true,
    thumbnail: LedThumb,
  },
  {
    kind: 'resistor',
    name: 'Resistor',
    summary: 'Limits current. Bands show the value.',
    guidance:
      'A 220 Ω resistor in series with an LED on a 5 V pin gives roughly 14 mA — comfortably inside the ATmega328P’s 40 mA per-pin limit. Resistors are not polarised.',
    terminals: [
      { id: 'a', label: 'Terminal A', hint: 'Either lead — a resistor has no polarity' },
      { id: 'b', label: 'Terminal B', hint: 'Either lead — a resistor has no polarity' },
    ],
    properties: [{ key: 'ohms', label: 'Resistance', type: 'number', min: 1, max: 1_000_000, step: 1, unit: 'Ω' }],
    rotatable: true,
    thumbnail: ResistorThumb,
  },
  {
    kind: 'pushbutton',
    name: 'Pushbutton',
    summary: 'Momentary tactile switch, four legs.',
    guidance:
      'The two legs on each side are permanently joined inside the switch. Use INPUT_PULLUP and switch to ground to avoid a floating input.',
    terminals: [
      { id: 'a1', label: 'Leg A1', hint: 'Permanently common with A2' },
      { id: 'a2', label: 'Leg A2', hint: 'Permanently common with A1' },
      { id: 'b1', label: 'Leg B1', hint: 'Permanently common with B2' },
      { id: 'b2', label: 'Leg B2', hint: 'Permanently common with B1' },
    ],
    properties: [],
    rotatable: true,
    thumbnail: ButtonThumb,
  },
  {
    kind: 'potentiometer',
    name: 'Potentiometer',
    summary: 'Adjustable voltage divider.',
    guidance:
      'Wire the outer legs to 5 V and GND, and the wiper to an analog pin. analogRead() then returns 0–1023 as you turn the knob.',
    terminals: [
      { id: 'a', label: 'Terminal A', hint: 'One end of the track — often 5 V' },
      { id: 'wiper', label: 'Wiper', hint: 'The moving contact — read this with an analog pin' },
      { id: 'b', label: 'Terminal B', hint: 'The other end of the track — often GND' },
    ],
    properties: [
      { key: 'ohms', label: 'Track resistance', type: 'number', min: 100, max: 1_000_000, step: 100, unit: 'Ω' },
      { key: 'initialPosition', label: 'Knob position', type: 'number', min: 0, max: 1, step: 0.01 },
    ],
    rotatable: true,
    thumbnail: PotThumb,
  },
  {
    kind: 'lcd1602',
    name: 'LCD 16×2',
    summary: 'HD44780 character display.',
    guidance:
      'Drive it with the bundled LiquidCrystal library in 4-bit mode (RS, E, D4–D7). VSS and K go to ground; VDD and A go to 5 V.',
    terminals: [
      { id: 'VSS', label: 'VSS', hint: 'Ground' },
      { id: 'VDD', label: 'VDD', hint: '5 V supply' },
      { id: 'VO', label: 'VO', hint: 'Contrast — usually a potentiometer wiper' },
      { id: 'RS', label: 'RS', hint: 'Register select' },
      { id: 'RW', label: 'RW', hint: 'Read/write — tie to ground to write' },
      { id: 'E', label: 'E', hint: 'Enable strobe' },
      { id: 'D4', label: 'D4', hint: 'Data bit 4 (4-bit mode)' },
      { id: 'D5', label: 'D5', hint: 'Data bit 5 (4-bit mode)' },
      { id: 'D6', label: 'D6', hint: 'Data bit 6 (4-bit mode)' },
      { id: 'D7', label: 'D7', hint: 'Data bit 7 (4-bit mode)' },
      { id: 'A', label: 'Backlight A', hint: 'Backlight anode — 5 V' },
      { id: 'K', label: 'Backlight K', hint: 'Backlight cathode — ground' },
    ],
    properties: [],
    rotatable: true,
    thumbnail: LcdThumb,
  },
  {
    kind: 'servo',
    name: 'Servo',
    summary: 'Hobby servo, 0–180°.',
    guidance:
      'Brown/black to GND, red to 5 V, orange/yellow to a digital pin. Use the bundled Servo library; the horn follows the commanded angle.',
    terminals: [
      { id: 'vcc', label: 'VCC', hint: 'Red — 5 V' },
      { id: 'gnd', label: 'GND', hint: 'Brown or black — ground' },
      { id: 'signal', label: 'Signal', hint: 'Orange or yellow — pulse input from a digital pin' },
    ],
    properties: [
      { key: 'minAngle', label: 'Minimum angle', type: 'number', min: 0, max: 180, step: 1, unit: '°' },
      { key: 'maxAngle', label: 'Maximum angle', type: 'number', min: 0, max: 180, step: 1, unit: '°' },
    ],
    rotatable: true,
    thumbnail: ServoThumb,
  },
  {
    kind: 'breadboard',
    name: '400-Tie-Point Breadboard',
    summary: 'Solderless breadboard. Each five-hole strip is joined inside; the four rails are separate.',
    guidance:
      'Each column of five holes on one side of the centre channel is joined internally — nothing crosses the channel, so the two halves are separate. The four rails along the edges are four separate runs. One hole takes one wire; if a hole is full the board suggests free holes joined to the same points. Jumper wires only for now: plugging component legs straight into holes comes later, and 3D breadboard support arrives in the next milestone.',
    terminals: [],
    properties: [],
    rotatable: true,
    thumbnail: BreadboardThumb,
  },
];

const byKind = new Map(COMPONENT_CATALOG.map((entry) => [entry.kind, entry]));

export function catalogEntry(kind: ComponentKind): CatalogEntry | undefined {
  return byKind.get(kind);
}
