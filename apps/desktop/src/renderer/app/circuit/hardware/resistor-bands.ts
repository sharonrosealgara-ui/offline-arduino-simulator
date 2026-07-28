/**
 * IEC 60062 resistor colour code.
 *
 * The band colours are computed from the component's actual `ohms` property, so a 220R
 * resistor really is red-red-brown and a 10k really is brown-black-orange. A student can
 * read the value off the 3D part and get the right answer — which is the entire point of
 * rendering bands rather than a generic beige cylinder with stripes.
 */

/** Digit colours 0-9, in standard order. */
const DIGIT_COLORS = [
  '#1b1b1b', // 0 black
  '#6b3b17', // 1 brown
  '#c62828', // 2 red
  '#e65100', // 3 orange
  '#f9d423', // 4 yellow
  '#2e7d32', // 5 green
  '#1565c0', // 6 blue
  '#6a1b9a', // 7 violet
  '#757575', // 8 grey
  '#f5f5f5', // 9 white
] as const;

const MULTIPLIER_COLORS: Record<number, string> = {
  [-2]: '#c0c0c0', // silver
  [-1]: '#d4af37', // gold
  0: DIGIT_COLORS[0],
  1: DIGIT_COLORS[1],
  2: DIGIT_COLORS[2],
  3: DIGIT_COLORS[3],
  4: DIGIT_COLORS[4],
  5: DIGIT_COLORS[5],
  6: DIGIT_COLORS[6],
  7: DIGIT_COLORS[7],
};

/** ±5 % gold tolerance band — the default for the through-hole parts modelled here. */
const TOLERANCE_GOLD = '#d4af37';

export interface ResistorBands {
  /** Four band colours, first digit → tolerance. */
  colors: [string, string, string, string];
  /** Human-readable value, e.g. "220 Ω" or "10 kΩ". */
  text: string;
}

/** Formats a resistance the way it is written on a schematic. */
export function formatOhms(ohms: number): string {
  if (!Number.isFinite(ohms) || ohms <= 0) return '— Ω';
  if (ohms >= 1e6) return `${trim(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${trim(ohms / 1e3)} kΩ`;
  return `${trim(ohms)} Ω`;
}

function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Derives the four-band code for a resistance.
 *
 * Values outside the representable range (below 1 Ω with a silver multiplier, or above
 * 99 x 10^7) are clamped to the nearest representable code rather than rendering an
 * impossible band combination.
 */
export function resistorBands(ohms: number): ResistorBands {
  const text = formatOhms(ohms);

  if (!Number.isFinite(ohms) || ohms <= 0) {
    return { colors: [DIGIT_COLORS[0], DIGIT_COLORS[0], DIGIT_COLORS[0], TOLERANCE_GOLD], text };
  }

  // Normalise to two significant digits: ohms = d1d2 x 10^exponent.
  let exponent = Math.floor(Math.log10(ohms)) - 1;
  exponent = Math.min(7, Math.max(-2, exponent));
  let significand = Math.round(ohms / 10 ** exponent);

  // Rounding can push 99.6 -> 100; carry into the exponent instead of emitting 3 digits.
  if (significand >= 100 && exponent < 7) {
    significand = Math.round(significand / 10);
    exponent += 1;
  }
  significand = Math.min(99, Math.max(10, significand));

  const first = Math.floor(significand / 10);
  const second = significand % 10;

  return {
    colors: [
      DIGIT_COLORS[first] ?? DIGIT_COLORS[0],
      DIGIT_COLORS[second] ?? DIGIT_COLORS[0],
      MULTIPLIER_COLORS[exponent] ?? DIGIT_COLORS[0],
      TOLERANCE_GOLD,
    ],
    text,
  };
}
