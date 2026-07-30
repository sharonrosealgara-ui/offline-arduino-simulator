/**
 * The board's `L` indicator must follow D13 and must look obviously different when lit.
 *
 * Packaged acceptance reported the L LED as "does not blink" while D13 was measurably
 * toggling 0 <-> 1. The state path was correct all along; what failed was legibility — a
 * true-to-scale 3.2 mm lens, roughly ten pixels at normal zoom, in a row with two identical
 * dead indicators, with barely any difference between lit and unlit.
 *
 * So these tests assert two separate things:
 *   1. the pin -> brightness contract (D13, and only a real logic high, lights it);
 *   2. that ON and OFF are separated by a large, specified margin, so "technically
 *      animating but visually identical" cannot come back.
 */
import { describe, expect, it } from 'vitest';
import type { PinDisplayDelta } from '@offline-arduino/contracts/simulator';
import {
  BUILTIN_LED_PIN,
  MIN_ON_OFF_EMISSIVE_SEPARATION,
  builtinLedTarget,
  builtinLedVisuals,
} from '../src/renderer/app/circuit/hardware/builtin-led-state';

const pin = (logic: 0 | 1 | 'X'): PinDisplayDelta => ({
  boardPin: BUILTIN_LED_PIN,
  mode: 'output',
  logic,
  volts: logic === 1 ? 5 : 0,
});

describe('D13 drives the built-in L LED', () => {
  it('is wired to D13, the pin Blink toggles', () => {
    expect(BUILTIN_LED_PIN).toBe('D13');
  });

  it('lights when D13 is high', () => {
    expect(builtinLedTarget(pin(1))).toBe(1);
  });

  it('is dark when D13 is low', () => {
    expect(builtinLedTarget(pin(0))).toBe(0);
  });

  it('is dark when the pin has never been reported', () => {
    // No simulation running, or the worker has not sent this pin yet.
    expect(builtinLedTarget(undefined)).toBe(0);
  });

  it('is dark when the level is unknown, rather than inventing activity', () => {
    expect(builtinLedTarget(pin('X'))).toBe(0);
  });

  it('follows a full blink cycle', () => {
    const cycle: Array<0 | 1> = [0, 1, 0, 1, 0];
    expect(cycle.map((l) => builtinLedTarget(pin(l)))).toEqual([0, 1, 0, 1, 0]);
  });
});

describe('lit and unlit are visually unmistakable', () => {
  const off = builtinLedVisuals(0);
  const on = builtinLedVisuals(1);

  it('emits nothing at all when off', () => {
    // Any residual glow makes the LED read as a third dim state next to TX and RX.
    expect(off.emissiveIntensity).toBe(0);
    expect(off.haloOpacity).toBe(0);
    expect(off.lightIntensity).toBe(0);
  });

  it('separates on from off by a wide emissive margin', () => {
    expect(on.emissiveIntensity - off.emissiveIntensity).toBeGreaterThanOrEqual(
      MIN_ON_OFF_EMISSIVE_SEPARATION,
    );
  });

  it('spills light onto the board when lit, so the eye is drawn to it', () => {
    expect(on.lightIntensity).toBeGreaterThan(1);
  });

  it('shows a halo when lit and none when dark', () => {
    expect(on.haloOpacity).toBeGreaterThan(0.4);
    expect(on.haloScale).toBeGreaterThan(off.haloScale);
  });

  it('brightens monotonically, so a mid-blink frame is never brighter than fully on', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((b) => builtinLedVisuals(b).emissiveIntensity);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
  });

  it('clamps out-of-range brightness instead of over-driving the material', () => {
    expect(builtinLedVisuals(-5).emissiveIntensity).toBe(0);
    expect(builtinLedVisuals(9).emissiveIntensity).toBe(on.emissiveIntensity);
  });
});
