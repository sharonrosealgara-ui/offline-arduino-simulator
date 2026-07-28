/**
 * Resistor colour-code derivation.
 *
 * The 3D part renders its bands from these values, so a wrong answer here teaches a
 * student to misread real hardware. The canonical classroom values are checked explicitly.
 */
import { describe, expect, it } from 'vitest';
import { resistorBands, formatOhms } from '../src/renderer/app/circuit/hardware/resistor-bands';

const BLACK = '#1b1b1b';
const BROWN = '#6b3b17';
const RED = '#c62828';
const ORANGE = '#e65100';
const YELLOW = '#f9d423';
const GREEN = '#2e7d32';
const BLUE = '#1565c0';
const GOLD = '#d4af37';

describe('resistorBands', () => {
  it('codes 220 Ω as red-red-brown-gold', () => {
    expect(resistorBands(220).colors).toEqual([RED, RED, BROWN, GOLD]);
  });

  it('codes 330 Ω as orange-orange-brown-gold', () => {
    expect(resistorBands(330).colors).toEqual([ORANGE, ORANGE, BROWN, GOLD]);
  });

  it('codes 1 kΩ as brown-black-red-gold', () => {
    expect(resistorBands(1000).colors).toEqual([BROWN, BLACK, RED, GOLD]);
  });

  it('codes 10 kΩ as brown-black-orange-gold', () => {
    expect(resistorBands(10_000).colors).toEqual([BROWN, BLACK, ORANGE, GOLD]);
  });

  it('codes 4.7 kΩ as yellow-violet-red-gold', () => {
    const [first, second, multiplier] = resistorBands(4700).colors;
    expect(first).toBe(YELLOW);
    expect(second).toBe('#6a1b9a'); // violet
    expect(multiplier).toBe(RED);
  });

  it('codes 1 MΩ as brown-black-green-gold', () => {
    expect(resistorBands(1_000_000).colors).toEqual([BROWN, BLACK, GREEN, GOLD]);
  });

  it('codes 56 Ω as green-blue-black-gold', () => {
    expect(resistorBands(56).colors).toEqual([GREEN, BLUE, BLACK, GOLD]);
  });

  it('always emits exactly four bands', () => {
    for (const ohms of [1, 47, 220, 4700, 100_000, 9_900_000]) {
      expect(resistorBands(ohms).colors).toHaveLength(4);
    }
  });

  it('never emits an undefined band colour for any plausible value', () => {
    for (let ohms = 1; ohms < 2_000_000; ohms = Math.ceil(ohms * 1.37)) {
      const { colors } = resistorBands(ohms);
      for (const color of colors) {
        expect(color, `ohms=${ohms}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('degrades safely on invalid input rather than rendering an impossible code', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { colors } = resistorBands(bad);
      expect(colors).toHaveLength(4);
      expect(colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    }
  });

  it('carries a rounding carry into the exponent instead of emitting three digits', () => {
    // 998 rounds to 100 x 10^1, which must normalise to 10 x 10^2 (brown-black-red).
    expect(resistorBands(998).colors.slice(0, 3)).toEqual([BROWN, BLACK, RED]);
  });
});

describe('formatOhms', () => {
  it('scales to Ω, kΩ, and MΩ', () => {
    expect(formatOhms(220)).toBe('220 Ω');
    expect(formatOhms(4700)).toBe('4.7 kΩ');
    expect(formatOhms(10_000)).toBe('10 kΩ');
    expect(formatOhms(1_000_000)).toBe('1 MΩ');
  });

  it('renders invalid resistances as a dash rather than NaN', () => {
    expect(formatOhms(Number.NaN)).toBe('— Ω');
    expect(formatOhms(0)).toBe('— Ω');
  });
});
