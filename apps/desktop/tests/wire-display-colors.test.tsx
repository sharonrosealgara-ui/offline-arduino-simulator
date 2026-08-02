// @vitest-environment jsdom
/**
 * A GND wire you can actually see, without lying about what it is.
 *
 * Ground wires were drawn #1c1f24 — a real black jumper. Against the workspace bench
 * (#171a1f) that is 1.06:1 and against the dark app background 1.02:1: not "hard to see",
 * invisible. A student tracing a circuit could not follow their own ground net.
 *
 * The fix is a RENDERING substitution, so the tests below are mostly about what did NOT
 * change. WIRE_HEX is still the electrical identity; servo pigtails are still JR black;
 * part bodies that happen to share the hex are untouched; every non-ground role is byte
 * identical. Light mode keeps the black too — at 14.47:1 it never needed help, and the two
 * contexts are allowed to differ.
 */
import { describe, expect, it } from 'vitest';
import type { WireColorRole } from '@offline-arduino/contracts/circuit';
import {
  WIRE_HEX,
  WIRE_SELECTED_HEX,
  wireDisplayHex,
  wireHoverHex,
  wireRenderHex,
  wireRoleLabel,
  type WireRenderContext,
} from '../src/renderer/app/circuit/hardware/wire-colors';

const ROLES = Object.keys(WIRE_HEX) as WireColorRole[];
const NON_GROUND = ROLES.filter((r) => r !== 'ground-black');
const CONTEXTS: WireRenderContext[] = ['dark', 'light'];

/** WCAG relative luminance, so the visibility claims are measured rather than asserted. */
function luminance(hex: string): number {
  const parts = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('the electrical identity is untouched', () => {
  it('ground is still black in the physical table', () => {
    expect(WIRE_HEX['ground-black']).toBe('#1c1f24');
  });

  it('every other physical colour is exactly what it was', () => {
    expect(WIRE_HEX).toEqual({
      'vcc-red': '#d1352b',
      'ground-black': '#1c1f24',
      'signal-yellow': '#e0b400',
      'signal-blue': '#2b74d1',
      'signal-green': '#1f9d55',
      'signal-orange': '#e07a1f',
      'signal-purple': '#8a4fd1',
    });
  });
});

describe('what a ground wire is drawn as', () => {
  it('is slate on dark, where black was invisible', () => {
    expect(wireDisplayHex('ground-black', 'dark')).toBe('#94a3b8');
  });

  it('stays black on light, where black was already the strongest choice', () => {
    expect(wireDisplayHex('ground-black', 'light')).toBe('#1c1f24');
  });

  it('brightens one step under the pointer, on dark', () => {
    expect(wireHoverHex('ground-black', 'dark')).toBe('#cbd5e1');
  });

  it('is cyan when selected, like every other wire', () => {
    expect(wireRenderHex('ground-black', 'dark', { selected: true })).toBe('#38bdf8');
    expect(WIRE_SELECTED_HEX).toBe('#38bdf8');
  });

  it('never uses slate as the selection signal', () => {
    // Selection outranks hover: pointing at an already-selected wire must not demote it.
    expect(wireRenderHex('ground-black', 'dark', { selected: true, hovered: true })).toBe('#38bdf8');
  });
});

describe('pointer-out restores the resting colour', () => {
  it.each(CONTEXTS)('on %s, for ground', (context) => {
    const resting = wireRenderHex('ground-black', context);
    expect(wireRenderHex('ground-black', context, { hovered: true, selected: false })).not.toBe(
      undefined,
    );
    // The state the component holds after onPointerOut is {selected:false, hovered:false}.
    expect(wireRenderHex('ground-black', context, { selected: false, hovered: false })).toBe(resting);
    expect(resting).toBe(wireDisplayHex('ground-black', context));
  });

  it.each(ROLES)('leaves %s exactly where it started', (role) => {
    for (const context of CONTEXTS) {
      const before = wireRenderHex(role, context);
      wireRenderHex(role, context, { hovered: true });
      expect(wireRenderHex(role, context, { hovered: false })).toBe(before);
    }
  });
});

describe('nothing but ground moved', () => {
  it.each(NON_GROUND)('%s renders its physical colour in both contexts', (role) => {
    for (const context of CONTEXTS) {
      expect(wireDisplayHex(role, context)).toBe(WIRE_HEX[role]);
    }
  });

  it.each(NON_GROUND)('%s has no separate hover colour', (role) => {
    for (const context of CONTEXTS) {
      expect(wireHoverHex(role, context)).toBe(WIRE_HEX[role]);
    }
  });

  it('ground is the only role whose display differs from its physical colour', () => {
    const moved = ROLES.filter((r) => wireDisplayHex(r, 'dark') !== WIRE_HEX[r]);
    expect(moved).toEqual(['ground-black']);
  });

  it('light differs from the physical table for no role at all', () => {
    const moved = ROLES.filter((r) => wireDisplayHex(r, 'light') !== WIRE_HEX[r]);
    expect(moved).toEqual([]);
  });
});

describe('the substitution is measurably worth making', () => {
  const BENCH = '#171a1f';
  const DARK_APP = '#1b1d22';
  const LIGHT_CANVAS = '#eef0f3';

  it('black on the dark bench was effectively invisible', () => {
    expect(contrast(WIRE_HEX['ground-black'], BENCH)).toBeLessThan(1.2);
    expect(contrast(WIRE_HEX['ground-black'], DARK_APP)).toBeLessThan(1.2);
  });

  it('slate clears 4.5:1 on every dark surface it is drawn against', () => {
    const slate = wireDisplayHex('ground-black', 'dark');
    for (const surface of [BENCH, DARK_APP, '#252930', '#15161a', '#2b2e35']) {
      expect(contrast(slate, surface)).toBeGreaterThan(4.5);
    }
  });

  it('the hover step is lighter than the resting colour, not merely different', () => {
    expect(luminance(wireHoverHex('ground-black', 'dark'))).toBeGreaterThan(
      luminance(wireDisplayHex('ground-black', 'dark')),
    );
  });

  it('light mode keeps the contrast the substitution would have cost it', () => {
    expect(contrast(wireDisplayHex('ground-black', 'light'), LIGHT_CANVAS)).toBeGreaterThan(14);
    // The reason the light context is exempt: slate there would be a large regression.
    expect(contrast('#94a3b8', LIGHT_CANVAS)).toBeLessThan(3);
  });
});

describe('the Inspector names the wire honestly', () => {
  it('calls ground "Black (GND)" — the colour it electrically is', () => {
    expect(wireRoleLabel('ground-black')).toBe('Black (GND)');
  });

  it.each(NON_GROUND)('leaves %s reading as before', (role) => {
    expect(wireRoleLabel(role)).toBe(role.replace('-', ' '));
  });
});
