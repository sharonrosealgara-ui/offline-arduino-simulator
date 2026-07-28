/**
 * Physical geometry of the Arduino-compatible Uno R3 board, in world units.
 *
 * WORLD UNIT = 1 INCH (25.4 mm). Chosen because every dimension that matters on this board
 * is defined in imperial: the 0.1" header pitch, the 0.16" offset between the two digital
 * header blocks, the 0.6" DIP-28 row spacing. Working in inches keeps the pin grid exact
 * instead of accumulating float error from millimetre conversions.
 *
 * The board is centred on the local origin, laid out in the XZ plane with +Y up:
 *
 *        -Z  digital header (D0..D13, GND, AREF, SDA, SCL)
 *         ^
 *   USB  -X ---- board ---- +X  ICSP
 *         v
 *        +Z  power header (IOREF..VIN) and analog header (A0..A5)
 *
 * These are facts about the hardware, not copied artwork — see
 * vendor/licenses/app-3d-assets/NOTICE.md for the licensing and trademark position.
 */

/** Millimetres to world units. */
export const mm = (millimetres: number): number => millimetres / 25.4;

/** Standard 2.54 mm header pitch. */
export const HEADER_PITCH = 0.1;

// --- Board outline ------------------------------------------------------------------
export const BOARD_WIDTH = mm(68.6); // 2.700"
export const BOARD_DEPTH = mm(53.4); // 2.102"
export const BOARD_THICKNESS = mm(1.6);
export const BOARD_HALF_W = BOARD_WIDTH / 2;
export const BOARD_HALF_D = BOARD_DEPTH / 2;

/** Top surface of the PCB; everything mounted sits on this plane. */
export const PCB_TOP = BOARD_THICKNESS / 2;

// --- Header rows --------------------------------------------------------------------
/** Centre-line of the digital header row (far edge). */
export const DIGITAL_ROW_Z = -0.95;
/** Centre-line of the power + analog header row (near edge). */
export const ANALOG_ROW_Z = 0.95;

/** Female header body: 0.1" square in plan, standing ~0.32" proud of the PCB. */
export const HEADER_BODY_HEIGHT = 0.32;
export const HEADER_BORE = 0.04;

export interface BoardPinPosition {
  /** Terminal id — matches the component registry / UNO_PIN_MAP where electrical. */
  id: string;
  /** Silkscreen legend. */
  label: string;
  x: number;
  z: number;
  role: 'digital' | 'analog' | 'power' | 'ground' | 'other';
}

/**
 * Builds a contiguous 0.1"-pitch run of pins starting at `startX` and marching in `step`.
 * Real headers are exact pitch within a block; only the blocks themselves are offset.
 */
function run(
  labels: readonly (readonly [id: string, label: string, role: BoardPinPosition['role']])[],
  startX: number,
  z: number,
  step = -HEADER_PITCH,
): BoardPinPosition[] {
  return labels.map(([id, label, role], index) => ({
    id,
    label,
    x: startX + index * step,
    z,
    role,
  }));
}

/**
 * Digital side, read left→right on a physical board with the USB facing left:
 * SCL SDA AREF GND 13 12 11 10 9 8 | gap | 7 6 5 4 3 2 1 0
 *
 * The gap between D7 and D8 is the well-known 0.16" offset that makes the Uno header
 * layout non-uniform; reproducing it is what lets a real shield footprint make sense.
 */
const DIGITAL_HIGH_BLOCK = run(
  [
    ['D0', '0', 'digital'],
    ['D1', '1', 'digital'],
    ['D2', '2', 'digital'],
    ['D3', '~3', 'digital'],
    ['D4', '4', 'digital'],
    ['D5', '~5', 'digital'],
    ['D6', '~6', 'digital'],
    ['D7', '7', 'digital'],
  ],
  1.25,
  DIGITAL_ROW_Z,
);

const DIGITAL_LOW_BLOCK_START = 1.25 - 7 * HEADER_PITCH - 0.16;

const DIGITAL_LOW_BLOCK = run(
  [
    ['D8', '8', 'digital'],
    ['D9', '~9', 'digital'],
    ['D10', '~10', 'digital'],
    ['D11', '~11', 'digital'],
    ['D12', '12', 'digital'],
    ['D13', '13', 'digital'],
    ['GND_D', 'GND', 'ground'],
    ['AREF', 'AREF', 'other'],
    ['SDA', 'SDA', 'other'],
    ['SCL', 'SCL', 'other'],
  ],
  DIGITAL_LOW_BLOCK_START,
  DIGITAL_ROW_Z,
);

/** Analog side: A5..A0 right→left, then the power header further toward the USB end. */
const ANALOG_BLOCK = run(
  [
    ['A5', 'A5', 'analog'],
    ['A4', 'A4', 'analog'],
    ['A3', 'A3', 'analog'],
    ['A2', 'A2', 'analog'],
    ['A1', 'A1', 'analog'],
    ['A0', 'A0', 'analog'],
  ],
  1.05,
  ANALOG_ROW_Z,
);

const POWER_BLOCK = run(
  [
    ['VIN', 'VIN', 'power'],
    ['GND2', 'GND', 'ground'],
    ['GND', 'GND', 'ground'],
    ['5V', '5V', 'power'],
    ['3.3V', '3V3', 'power'],
    ['RESET', 'RST', 'other'],
    ['IOREF', 'IOREF', 'other'],
    ['NC', 'NC', 'other'],
  ],
  0.35,
  ANALOG_ROW_Z,
);

export const DIGITAL_PINS: readonly BoardPinPosition[] = [...DIGITAL_LOW_BLOCK, ...DIGITAL_HIGH_BLOCK];
export const ANALOG_PINS: readonly BoardPinPosition[] = ANALOG_BLOCK;
export const POWER_PINS: readonly BoardPinPosition[] = POWER_BLOCK;

/** Every headered pin on the board. */
export const UNO_BOARD_PINS: readonly BoardPinPosition[] = [
  ...DIGITAL_PINS,
  ...ANALOG_PINS,
  ...POWER_PINS,
];

const pinIndex = new Map(UNO_BOARD_PINS.map((pin) => [pin.id, pin]));

/**
 * Physical position of a board terminal.
 *
 * The component registry exposes the rails as '5V', '3.3V' and 'GND' (see
 * packages/simulator/src/board/uno.ts). Those ids resolve to the power header positions
 * above, so a wire drawn to the 5V rail lands on the real 5V pin.
 */
export function unoPinPosition(terminalId: string): BoardPinPosition | undefined {
  return pinIndex.get(terminalId);
}

// --- Silkscreen label strips --------------------------------------------------------
/** A header legend strip: where it sits and what it reads. */
export interface LabelStrip {
  labels: string[];
  centerX: number;
  centerZ: number;
  width: number;
  height: number;
}

const STRIP_HEIGHT = 0.12;
/** Legends sit just inboard of their header, as on the real silkscreen. */
const STRIP_INSET = 0.135;

function stripFor(pins: readonly BoardPinPosition[], side: 'digital' | 'analog'): LabelStrip {
  const xs = pins.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  // Cells are pitch-wide and centred on their pin, so the strip spans half a pitch either side.
  const width = maxX - minX + HEADER_PITCH;
  return {
    // Strip cells run left→right, but the pin arrays march right→left.
    labels: [...pins].sort((a, b) => a.x - b.x).map((p) => p.label),
    centerX: (minX + maxX) / 2,
    centerZ: side === 'digital' ? DIGITAL_ROW_Z + STRIP_INSET : ANALOG_ROW_Z - STRIP_INSET,
    width,
    height: STRIP_HEIGHT,
  };
}

export const LABEL_STRIPS: readonly LabelStrip[] = [
  stripFor(DIGITAL_LOW_BLOCK, 'digital'),
  stripFor(DIGITAL_HIGH_BLOCK, 'digital'),
  stripFor(ANALOG_BLOCK, 'analog'),
  stripFor(POWER_BLOCK, 'analog'),
];

// --- Fixed board features -----------------------------------------------------------
export const USB_CONNECTOR = {
  center: [-BOARD_HALF_W + 0.16, PCB_TOP + 0.21, -0.55] as const,
  size: [mm(16), mm(11), mm(12)] as const,
};

export const POWER_JACK = {
  center: [-BOARD_HALF_W + 0.18, PCB_TOP + 0.17, 0.62] as const,
  size: [mm(14), mm(11), mm(9)] as const,
};

/** ATmega328P in a 28-pin 0.6"-wide DIP. */
export const MCU = {
  center: [0.32, PCB_TOP + mm(2), 0.34] as const,
  bodyWidth: mm(35.5),
  bodyDepth: mm(7.5),
  bodyHeight: mm(4),
  rowSpacing: 0.6,
  pinsPerRow: 14,
  pinPitch: HEADER_PITCH,
};

/** 2x3 ICSP header for the ATmega328P, on the far edge from the USB. */
export const ICSP_MAIN = { centerX: 1.16, centerZ: 0.0 };
/** 2x3 ICSP header for the USB-serial bridge, beside the USB connector. */
export const ICSP_USB = { centerX: -0.94, centerZ: -0.78 };

export const RESET_BUTTON = { x: -1.02, z: -0.8, size: mm(6), height: mm(4.3) };

/** Indicator LEDs. `L` follows D13; the rest are decorative-but-honest board features. */
export const INDICATOR_LEDS = {
  L: { x: -0.5, z: -0.3, color: '#ffb01f' },
  TX: { x: -0.5, z: -0.46, color: '#ffb01f' },
  RX: { x: -0.5, z: -0.6, color: '#ffb01f' },
  ON: { x: -0.62, z: 0.3, color: '#7cf07c' },
} as const;

export const CRYSTAL = { x: -0.16, z: -0.02, width: mm(11), depth: mm(4.5), height: mm(3.5) };
export const REGULATOR = { x: -0.66, z: 0.62, width: mm(10), depth: mm(6), height: mm(4.5) };

/** Uno mounting-hole pattern (the famously non-symmetric one). */
export const MOUNTING_HOLES: readonly (readonly [number, number])[] = [
  [-BOARD_HALF_W + mm(14.0), -BOARD_HALF_D + mm(2.5)],
  [-BOARD_HALF_W + mm(15.3), BOARD_HALF_D - mm(3.0)],
  [BOARD_HALF_W - mm(2.6), -BOARD_HALF_D + mm(15.2)],
  [BOARD_HALF_W - mm(2.6), BOARD_HALF_D - mm(5.1)],
];

export const MOUNTING_HOLE_RADIUS = mm(1.6);

// --- Palette ------------------------------------------------------------------------
/**
 * Deliberately a generic Arduino-*compatible* teal-green solder mask rather than a
 * reproduction of Arduino SA's exact brand colour.
 */
export const BOARD_PALETTE = {
  soldermask: '#0f6b5c',
  soldermaskEdge: '#0a4d42',
  silkscreen: '#eef4f2',
  headerPlastic: '#15161a',
  headerBore: '#050506',
  goldPad: '#c8a83c',
  tinnedPin: '#c9ced6',
  icBody: '#131417',
  connectorMetal: '#adb4bd',
  jackPlastic: '#101114',
  buttonCap: '#2f6fce',
  crystalCan: '#b9c0c8',
  regulatorTab: '#2a2d33',
  ledOff: '#4a3a12',
} as const;
