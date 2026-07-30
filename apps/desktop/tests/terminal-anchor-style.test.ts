/**
 * Terminal anchors have to be findable and hittable.
 *
 * Packaged acceptance could not wire D12 to D13: the anchors were a small dot at 85 %
 * opacity with no outline, and the clickable area was exactly that dot. On a header of
 * closely spaced pins that means hunting — and because a terminal's name only appears while
 * hovered, a pin you cannot reliably hover is a pin you cannot identify.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_HIT_TO_CORE_RATIO,
  TERMINAL_HIT_RADIUS,
  TERMINAL_HOVER_COLOR,
  TERMINAL_PENDING_COLOR,
  shouldShowTerminals,
  terminalAnchorAppearance,
} from '../src/renderer/app/circuit/terminal-anchor-style';

const look = (role: string, hovered = false, pending = false) =>
  terminalAnchorAppearance({ role, hovered, pending });

describe('the clickable target is generous', () => {
  it('is much larger than the drawn dot in every state', () => {
    for (const state of [look('signal'), look('signal', true), look('signal', false, true)]) {
      expect(state.hitRadius / state.coreRadius).toBeGreaterThanOrEqual(MIN_HIT_TO_CORE_RATIO);
    }
  });

  it('never drops below the baseline hit radius', () => {
    for (const role of ['power', 'ground', 'signal', 'passive', 'unknown']) {
      expect(look(role).hitRadius).toBeGreaterThanOrEqual(TERMINAL_HIT_RADIUS);
    }
  });

  it('keeps a hoverable target even when the dot itself is small', () => {
    // A board header pin is idle most of the time; that is exactly when it must stay easy
    // to reach, because hovering is how its name is discovered.
    expect(look('signal').hitRadius).toBeGreaterThan(look('signal').coreRadius * 2);
  });
});

describe('anchors read against the workspace', () => {
  it('draws a dark rim larger than the core, so the dot separates from the green PCB', () => {
    const anchor = look('signal');
    expect(anchor.rimRadius).toBeGreaterThan(anchor.coreRadius);
    expect(anchor.rimColor).toBe('#05070a');
  });

  it('gives each terminal role its own colour', () => {
    const colors = ['power', 'ground', 'signal', 'passive'].map((r) => look(r).color);
    expect(new Set(colors).size).toBe(4);
  });

  it('falls back to a visible colour for an unrecognised role', () => {
    expect(look('something-new').color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('board pins can always be reached', () => {
  const show = (o: Partial<Parameters<typeof shouldShowTerminals>[0]>) =>
    shouldShowTerminals({ isBoard: false, wiring: false, hovered: false, selected: false, ...o });

  it('shows the board header even when nothing is hovered, selected, or being wired', () => {
    // The regression that blocked packaged acceptance: <UnoR3Board/> is not a ComponentNode,
    // so it can never be hovered or selected. Gating its pins on those states left them
    // hidden until a wire was already in progress — which made starting a wire at a board
    // pin impossible, and made a board-only project impossible to wire at all.
    expect(show({ isBoard: true })).toBe(true);
  });

  it('still shows the board header in every other state', () => {
    for (const state of [{ wiring: true }, { hovered: true }, { selected: true }]) {
      expect(show({ isBoard: true, ...state })).toBe(true);
    }
  });

  it('keeps ordinary parts on demand, so the bench does not fill with dots', () => {
    expect(show({})).toBe(false);
  });

  it('reveals every legal target once a wire is in progress', () => {
    expect(show({ wiring: true })).toBe(true);
  });

  it('reveals a part on hover or selection', () => {
    expect(show({ hovered: true })).toBe(true);
    expect(show({ selected: true })).toBe(true);
  });
});

describe('the current interaction state is unambiguous', () => {
  it('marks the hovered terminal distinctly', () => {
    const anchor = look('signal', true);
    expect(anchor.color).toBe(TERMINAL_HOVER_COLOR);
    expect(anchor.coreRadius).toBeGreaterThan(look('signal').coreRadius);
    expect(anchor.showLabel).toBe(true);
  });

  it('keeps the pending terminal visible after the pointer moves away', () => {
    // Half-finished wire: the student must still be able to see which pin they grabbed.
    const anchor = look('signal', false, true);
    expect(anchor.color).toBe(TERMINAL_PENDING_COLOR);
    expect(anchor.coreRadius).toBeGreaterThan(look('signal').coreRadius);
    expect(anchor.showLabel).toBe(true);
  });

  it('hovering the pending terminal keeps showing it as the wire origin', () => {
    // Pending outranks hover here on purpose. Clicking this pin again cancels the wire, so
    // it should keep reading as "where your wire started" rather than turning into an
    // ordinary hover target. A different pin under the pointer still shows hover white.
    expect(look('signal', true, true).color).toBe(TERMINAL_PENDING_COLOR);
    expect(look('signal', true, false).color).toBe(TERMINAL_HOVER_COLOR);
  });

  it('shows no label for an idle terminal, so a full header does not become a wall of text', () => {
    expect(look('signal').showLabel).toBe(false);
  });
});
