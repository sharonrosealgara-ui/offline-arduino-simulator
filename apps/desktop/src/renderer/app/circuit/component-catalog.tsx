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
 */
import type { ComponentKind } from '@offline-arduino/contracts/circuit';

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

const LedThumb = (
  <svg {...svgProps}>
    <path d="M11 18h10v-3a5 5 0 0 0-10 0z" fill="#ff5a4d" stroke="#7f1d1d" strokeWidth="1.2" />
    <line x1="13" y1="18" x2="13" y2="27" stroke="#9ca3af" strokeWidth="1.6" />
    <line x1="19" y1="18" x2="19" y2="24" stroke="#9ca3af" strokeWidth="1.6" />
    <line x1="21" y1="15" x2="21" y2="18" stroke="#111827" strokeWidth="1.6" />
    <text x="7" y="10" fontSize="7" fill="#f87171">+</text>
  </svg>
);

const ResistorThumb = (
  <svg {...svgProps}>
    <line x1="2" y1="16" x2="8" y2="16" stroke="#9ca3af" strokeWidth="1.6" />
    <line x1="24" y1="16" x2="30" y2="16" stroke="#9ca3af" strokeWidth="1.6" />
    <rect x="8" y="11" width="16" height="10" rx="3" fill="#d9c08a" stroke="#8a6d3b" strokeWidth="1" />
    <rect x="11" y="11" width="2" height="10" fill="#c62828" />
    <rect x="14.5" y="11" width="2" height="10" fill="#c62828" />
    <rect x="18" y="11" width="2" height="10" fill="#6b3b17" />
    <rect x="21.5" y="11" width="1.5" height="10" fill="#d4af37" />
  </svg>
);

const ButtonThumb = (
  <svg {...svgProps}>
    <rect x="8" y="10" width="16" height="14" rx="2" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.2" />
    <circle cx="16" cy="17" r="4.5" fill="#e11d48" stroke="#881337" strokeWidth="1" />
    <line x1="8" y1="24" x2="6" y2="28" stroke="#9ca3af" strokeWidth="1.4" />
    <line x1="24" y1="24" x2="26" y2="28" stroke="#9ca3af" strokeWidth="1.4" />
  </svg>
);

const PotThumb = (
  <svg {...svgProps}>
    <rect x="7" y="14" width="18" height="10" rx="1.5" fill="#1f2937" stroke="#0f172a" strokeWidth="1" />
    <circle cx="16" cy="12" r="6" fill="#374151" stroke="#111827" strokeWidth="1.2" />
    <line x1="16" y1="12" x2="16" y2="7" stroke="#fbbf24" strokeWidth="2" />
    <line x1="10" y1="24" x2="10" y2="28" stroke="#9ca3af" strokeWidth="1.4" />
    <line x1="16" y1="24" x2="16" y2="28" stroke="#9ca3af" strokeWidth="1.4" />
    <line x1="22" y1="24" x2="22" y2="28" stroke="#9ca3af" strokeWidth="1.4" />
  </svg>
);

const LcdThumb = (
  <svg {...svgProps}>
    <rect x="3" y="8" width="26" height="16" rx="1.5" fill="#0f5132" stroke="#052e16" strokeWidth="1" />
    <rect x="6" y="11" width="20" height="10" fill="#7fa63a" />
    <rect x="7.5" y="13" width="11" height="1.6" fill="#12180a" />
    <rect x="7.5" y="17" width="8" height="1.6" fill="#12180a" />
  </svg>
);

const ServoThumb = (
  <svg {...svgProps}>
    <rect x="7" y="12" width="15" height="12" rx="1.5" fill="#1e3a8a" stroke="#172554" strokeWidth="1" />
    <rect x="4" y="14" width="21" height="2.5" fill="#1e40af" />
    <circle cx="18" cy="10" r="3.5" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="1" />
    <rect x="18" y="9" width="9" height="2" rx="1" fill="#f3f4f6" />
    <line x1="7" y1="19" x2="3" y2="19" stroke="#d1352b" strokeWidth="1.4" />
    <line x1="7" y1="21.5" x2="3" y2="21.5" stroke="#5b3a1e" strokeWidth="1.4" />
  </svg>
);

// ---------------------------------------------------------------------------------------
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
];

const byKind = new Map(COMPONENT_CATALOG.map((entry) => [entry.kind, entry]));

export function catalogEntry(kind: ComponentKind): CatalogEntry | undefined {
  return byKind.get(kind);
}
