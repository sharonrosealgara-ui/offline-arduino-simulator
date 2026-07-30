/**
 * How the board's `L` indicator translates D13's logic level into something a student can
 * actually see.
 *
 * WHY THIS IS A SEPARATE MODULE
 * The mapping used to live inside a `useFrame` callback that wrote straight to three.js
 * material properties. That is untestable without a GPU, and it hid a real defect: D13 was
 * driving the lens correctly, but the lit and unlit states were so close together that
 * packaged acceptance reported the LED as "not blinking". The lens is a true-to-scale
 * 3.2 x 1.6 mm part, roughly ten pixels at normal zoom, sitting in a row of two identical
 * dead indicators (TX and RX), with the unlit colour barely distinguishable from the
 * surrounding SMD components.
 *
 * Splitting the mapping out means the contract "D13 high means visibly lit" is asserted by
 * tests rather than by eye, and the ON/OFF separation is a number that cannot silently
 * regress.
 *
 * The ELECTRICAL meaning is unchanged: the indicator follows D13's logic level and nothing
 * else. Only the visual gain changed.
 */
import type { PinDisplayDelta } from '@offline-arduino/contracts/simulator';

/** The board pin the `L` indicator is wired to on real Uno hardware. */
export const BUILTIN_LED_PIN = 'D13';

/**
 * Target brightness for the indicator, 0 or 1.
 *
 * Only a solid logic high lights it. An unknown level ('X'), a pin the worker has not
 * reported yet, or no simulation at all all read as off — the indicator must never invent
 * activity the firmware is not producing.
 */
export function builtinLedTarget(pin: PinDisplayDelta | undefined): 0 | 1 {
  return pin?.logic === 1 ? 1 : 0;
}

export interface BuiltinLedVisuals {
  /** Emissive gain on the lens itself. */
  emissiveIntensity: number;
  /** Point light that spills onto the surrounding PCB. */
  lightIntensity: number;
  /** Additive halo opacity; 0 leaves no trace when unlit. */
  haloOpacity: number;
  /** Halo scale multiplier, so the lit state also reads as bigger. */
  haloScale: number;
}

/**
 * Minimum emissive separation between fully off and fully on. The test suite pins this so
 * a future tweak cannot quietly return the indicator to "technically animating, visually
 * identical".
 */
export const MIN_ON_OFF_EMISSIVE_SEPARATION = 4;

/**
 * Maps smoothed brightness (0..1) to the three things that make the state obvious at a
 * glance: the lens glow, light spilling onto the board, and a halo that grows.
 *
 * Off is deliberately *fully* dark — no residual glow — so the two states cannot be
 * confused with each other or with the neighbouring dead indicators.
 */
export function builtinLedVisuals(brightness: number): BuiltinLedVisuals {
  const b = Math.max(0, Math.min(1, brightness));
  return {
    emissiveIntensity: b * 6.5,
    lightIntensity: b * 1.35,
    haloOpacity: b * 0.55,
    // Stays small when dark; the halo only becomes a feature once the LED is actually lit.
    haloScale: 0.55 + b * 0.85,
  };
}
