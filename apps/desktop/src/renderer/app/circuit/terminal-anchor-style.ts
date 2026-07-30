/**
 * Size and colour of the 3D terminal anchors students click to wire a circuit.
 *
 * WHY THIS EXISTS
 * Packaged acceptance could not wire D12 to D13: the anchors were a 0.028-unit dot drawn at
 * 85 % opacity with no outline, so against the dark workspace grid — and against the green
 * PCB they sit on — they were both hard to see and hard to hit. The clickable area was
 * exactly the visible dot, which on a header of closely spaced pins meant hunting.
 *
 * Two separate problems, two separate numbers:
 *   - what you can SEE  -> a bright core with a dark rim, so it reads on any background;
 *   - what you can HIT  -> a much larger invisible sphere, so hovering and clicking are
 *     forgiving. Pointer targets should be generous even when the drawn dot is small.
 *
 * Wiring behaviour and the netlist are untouched; this is purely how the anchor presents
 * itself.
 */

/** Radius of the drawn dot. */
export const TERMINAL_CORE_RADIUS = 0.032;

/**
 * Radius of the invisible sphere that actually receives pointer events. Deliberately much
 * larger than the dot — a pin you cannot reliably hover is a pin you cannot identify,
 * because the name only appears on hover.
 */
export const TERMINAL_HIT_RADIUS = 0.085;

/**
 * The hit target must stay comfortably larger than the dot. Asserted by the tests so a
 * later size tweak cannot quietly shrink the clickable area back to the visible one.
 */
export const MIN_HIT_TO_CORE_RATIO = 2;

/** Near-black rim drawn just behind the core so it separates from the green PCB. */
export const TERMINAL_RIM_COLOR = '#05070a';

/**
 * Outline radius as a multiple of the core. Header pins sit on a 0.1 inch pitch, which is
 * 0.1 world units, so the outline has to stay well inside that or neighbouring pins merge
 * into one blob and become impossible to tell apart.
 */
export const TERMINAL_RIM_SCALE = 1.35;

/**
 * Should a component's terminal anchors be drawn right now?
 *
 * The Arduino board is the exception that matters. It is rendered by <UnoR3Board/> rather
 * than as a <ComponentNode/>, so it carries no hover or click handlers — it can never be
 * hovered and can never be selected. Gating its pins on hover/selection/wiring therefore
 * left them permanently hidden until a wire was ALREADY in progress, which made starting a
 * wire at a board pin impossible: you needed another part to begin from, and in a project
 * containing only the Uno you could not wire anything at all. Packaged acceptance hit
 * exactly this when trying to connect D12 to D13.
 *
 * The board's header is the primary wiring target in almost every circuit, so its pins are
 * always shown. Everything else stays on demand, so a busy bench does not turn into a field
 * of dots.
 */
export function shouldShowTerminals({
  isBoard,
  wiring,
  hovered,
  selected,
}: {
  isBoard: boolean;
  wiring: boolean;
  hovered: boolean;
  selected: boolean;
}): boolean {
  return isBoard || wiring || hovered || selected;
}

const ROLE_COLOR: Record<string, string> = {
  power: '#ff6b6b',
  ground: '#cbd5e1',
  signal: '#5cc8ff',
  passive: '#b9f24d',
};

const FALLBACK_COLOR = '#5cc8ff';
/** The terminal the pending wire started from. */
export const TERMINAL_PENDING_COLOR = '#facc15';
/** The terminal under the pointer. */
export const TERMINAL_HOVER_COLOR = '#ffffff';

export interface TerminalAnchorAppearance {
  coreRadius: number;
  hitRadius: number;
  rimRadius: number;
  color: string;
  rimColor: string;
  /** Whether the floating name plate should be drawn. */
  showLabel: boolean;
}

/**
 * Resolves how one anchor should look.
 *
 * Hovered and pending states get their own colours rather than a subtle tint: when a
 * student is halfway through a connection, which pin they grabbed must be unambiguous.
 * Anchors are always drawn fully opaque — the previous 85 % made them recede into the grid.
 */
export function terminalAnchorAppearance({
  role,
  hovered,
  pending,
}: {
  role: string;
  hovered: boolean;
  pending: boolean;
}): TerminalAnchorAppearance {
  const color = pending
    ? TERMINAL_PENDING_COLOR
    : hovered
      ? TERMINAL_HOVER_COLOR
      : (ROLE_COLOR[role] ?? FALLBACK_COLOR);

  // Grow on hover so the pin being targeted is obvious, and while pending so the wire's
  // origin stays findable after the pointer moves away.
  const emphasis = hovered ? 1.7 : pending ? 1.45 : 1;
  const coreRadius = TERMINAL_CORE_RADIUS * emphasis;

  return {
    coreRadius,
    // The hit sphere never shrinks below the baseline, so small dots stay easy to grab.
    hitRadius: Math.max(TERMINAL_HIT_RADIUS, coreRadius * MIN_HIT_TO_CORE_RATIO),
    rimRadius: coreRadius * TERMINAL_RIM_SCALE,
    color,
    rimColor: TERMINAL_RIM_COLOR,
    showLabel: hovered || pending,
  };
}
