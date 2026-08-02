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

/**
 * The surface a wire is drawn against.
 *
 * The 3D workspace is always dark — its bench is #171a1f whatever the OS theme says. The 2D
 * canvas follows the theme. They are separate questions and this type keeps them separate.
 */
export type WireRenderContext = 'dark' | 'light';

/** The selection colour, shared by every role. */
export const WIRE_SELECTED_HEX = '#38bdf8';

/**
 * Rendering-only substitutions. WIRE_HEX above stays the electrical identity.
 *
 * Ground is the only entry, and only on dark. A real jumper to GND is black, and against the
 * bench that is 1.06:1 — a wire you cannot see is a wire a student cannot trace. Slate reads
 * at 6.80:1 there. On light the original black is 14.47:1 and needs no help, so it keeps it;
 * the two contexts differ on purpose and parity between them is not a goal.
 *
 * Nothing else appears here, which is what keeps servo pigtails and part bodies out of it:
 * they read WIRE_HEX directly and never pass through this table.
 */
const DISPLAY_OVERRIDES: Record<WireRenderContext, Partial<Record<WireColorRole, string>>> = {
  dark: { 'ground-black': '#94a3b8' },
  light: {},
};

/** One lighter step, same hue family — the same wire brightened, not a different wire. */
const HOVER_OVERRIDES: Record<WireRenderContext, Partial<Record<WireColorRole, string>>> = {
  dark: { 'ground-black': '#cbd5e1' },
  light: {},
};

/** What a wire of this role looks like at rest. */
export function wireDisplayHex(role: WireColorRole, context: WireRenderContext): string {
  return DISPLAY_OVERRIDES[context][role] ?? WIRE_HEX[role];
}

/** What it looks like under the pointer. Roles with no override are deliberately unchanged. */
export function wireHoverHex(role: WireColorRole, context: WireRenderContext): string {
  return HOVER_OVERRIDES[context][role] ?? wireDisplayHex(role, context);
}

/**
 * The one place a wire's drawn colour is decided, for both canvases.
 *
 * Selection outranks hover and is cyan for every role — slate is a visibility fix, not a
 * selection signal. With no state set this returns the resting colour, so pointer-out
 * restores exactly what was there before the pointer arrived.
 */
export function wireRenderHex(
  role: WireColorRole,
  context: WireRenderContext,
  state: { selected?: boolean; hovered?: boolean } = {},
): string {
  if (state.selected) return WIRE_SELECTED_HEX;
  if (state.hovered) return wireHoverHex(role, context);
  return wireDisplayHex(role, context);
}

/** Roles whose stored name reads badly in the Inspector. */
const ROLE_LABELS: Partial<Record<WireColorRole, string>> = {
  'ground-black': 'Black (GND)',
};

/** How a role is named to a student. The wire is still stored as `ground-black`. */
export function wireRoleLabel(role: WireColorRole): string {
  return ROLE_LABELS[role] ?? role.replace('-', ' ');
}
