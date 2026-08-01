/**
 * The colour every wire role is drawn in.
 *
 * Shared because two things need it: the wires a student draws, and the fixed-colour leads
 * on parts that are colour-coded in the real world (a servo's brown/red/orange pigtail).
 * Keeping one table means a servo's red lead is the same red as a wire to 5 V.
 */
import type { WireColorRole } from '@offline-arduino/contracts/circuit';

export const WIRE_HEX: Record<WireColorRole, string> = {
  'vcc-red': '#d1352b',
  'ground-black': '#1c1f24',
  'signal-yellow': '#e0b400',
  'signal-blue': '#2b74d1',
  'signal-green': '#1f9d55',
  'signal-orange': '#e07a1f',
  'signal-purple': '#8a4fd1',
};
