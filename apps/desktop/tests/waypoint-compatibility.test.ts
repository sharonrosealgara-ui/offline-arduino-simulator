/**
 * What moving a terminal anchor does to a wire that was drawn before it moved.
 *
 * The project schema accepts waypoints, so a hand-authored but schema-valid file can contain
 * them even though the current UI never creates one. That makes them part of the loading
 * compatibility boundary, and the reason this suite is executable rather than a calculation
 * in a document: B6 moves three parts' anchors, and the question "does an old wire still
 * look right?" has to be answered against the real geometry, not an estimate of it.
 *
 * Classification is by observable geometry:
 *
 *   UNSAFE      the last segment newly enters a body it did not previously enter,
 *               or it doubles back on itself (turn > 150 degrees),
 *               or its endpoint no longer meets a conductor
 *   ACCEPTABLE  the endpoint moves far enough to notice, or the run bends sharply,
 *               but nothing crosses a body and nothing detaches
 *   SAFE        neither
 *
 * B6 must not land if any case is UNSAFE.
 */
import { describe, expect, it } from 'vitest';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import {
  bodyBoundsMm,
  conductorAttachmentMm,
  type BoundsMm,
  type TerminalAnchor,
} from '../src/renderer/app/circuit/hardware/component-bounds';
import { schematicToMm } from '../src/renderer/app/circuit/hardware/geometry-units';

/**
 * The anchors as they were before B6, in schematic units.
 *
 * Recorded here because the comparison needs both states. These are the values a project
 * saved before this change was drawn against.
 */
const ANCHORS_BEFORE_B6: Record<string, Record<string, { x: number; y: number }>> = {
  resistor: {
    a: { x: 0, y: 0 },
    b: { x: 10, y: 0 },
  },
  pushbutton: {
    a1: { x: 0, y: 0 },
    a2: { x: 10, y: 0 },
    b1: { x: 0, y: 10 },
    b2: { x: 10, y: 10 },
  },
  potentiometer: {
    a: { x: 0, y: 0 },
    wiper: { x: 5, y: 10 },
    b: { x: 10, y: 0 },
  },
};

const AFFECTED = Object.keys(ANCHORS_BEFORE_B6) as ComponentKind[];
const ROTATIONS = [0, 90, 180, 270] as const;

/** The four waypoint patterns, positioned relative to the anchor as it was. */
const PATTERNS: Record<string, (old: { x: number; y: number }) => Array<{ x: number; y: number }>> = {
  'immediately outside the old terminal': (old) => [{ x: old.x + 5, y: old.y }],
  'beside the component body': (old) => [{ x: old.x, y: old.y + 20 }],
  'on the opposite side of the body': (old) => [{ x: old.x - 35, y: old.y }],
  'multiple L-shaped waypoints': (old) => [
    { x: old.x + 25, y: old.y + 25 },
    { x: old.x + 25, y: old.y },
  ],
};

function rotate(p: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function rotateBounds(bounds: BoundsMm, degrees: number): BoundsMm {
  const corners = [
    { x: bounds.minX, y: bounds.minZ },
    { x: bounds.maxX, y: bounds.minZ },
    { x: bounds.minX, y: bounds.maxZ },
    { x: bounds.maxX, y: bounds.maxZ },
  ].map((c) => rotate(c, degrees));
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minZ: Math.min(...corners.map((c) => c.y)),
    maxZ: Math.max(...corners.map((c) => c.y)),
  };
}

/** Does the segment pass through the interior of the box? Endpoints on the edge do not count. */
function segmentEntersBody(
  from: { x: number; y: number },
  to: { x: number; y: number },
  box: BoundsMm,
): boolean {
  const steps = 200;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (x > box.minX && x < box.maxX && y > box.minZ && y < box.maxZ) return true;
  }
  return false;
}

function headingDegrees(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

type Verdict = 'SAFE' | 'ACCEPTABLE' | 'UNSAFE';

interface Assessment {
  verdict: Verdict;
  movedMm: number;
  turnDegrees: number;
  newlyEntersBody: boolean;
  meetsConductor: boolean;
}

function assess(
  kind: ComponentKind,
  terminalId: string,
  waypoints: Array<{ x: number; y: number }>,
  degrees: number,
): Assessment {
  const before = ANCHORS_BEFORE_B6[kind][terminalId];
  const registry = getComponentDefinition(kind)!.terminals as TerminalAnchor[];
  const after = registry.find((t) => t.id === terminalId)!;

  // Everything is expressed in millimetres so the body and the wire share a frame.
  const oldAnchor = rotate({ x: schematicToMm(before.x), y: schematicToMm(before.y) }, degrees);
  const newAnchor = rotate({ x: schematicToMm(after.x), y: schematicToMm(after.y) }, degrees);
  const last = rotate(
    { x: schematicToMm(waypoints[waypoints.length - 1].x), y: schematicToMm(waypoints[waypoints.length - 1].y) },
    degrees,
  );

  const body = rotateBounds(bodyBoundsMm(kind, registry)!, degrees);
  const enteredBefore = segmentEntersBody(last, oldAnchor, body);
  const entersAfter = segmentEntersBody(last, newAnchor, body);

  let turn = 0;
  if (waypoints.length >= 2) {
    const previous = rotate(
      { x: schematicToMm(waypoints[waypoints.length - 2].x), y: schematicToMm(waypoints[waypoints.length - 2].y) },
      degrees,
    );
    const delta = headingDegrees(previous, last) - headingDegrees(last, newAnchor);
    // Normalise into (-180, 180]. A plain `% 360` keeps the sign of the dividend in JS, so
    // a left turn of 90 degrees reads as 270 and every L-shaped path looks like a reversal.
    turn = Math.abs((((delta % 360) + 540) % 360) - 180);
  }

  // The anchor must still be the end of a real conductor after the move.
  const attachment = conductorAttachmentMm(kind, terminalId, registry);
  const meetsConductor = attachment !== undefined;

  const moved = Math.hypot(newAnchor.x - oldAnchor.x, newAnchor.y - oldAnchor.y);
  const newlyEntersBody = entersAfter && !enteredBefore;

  let verdict: Verdict = 'SAFE';
  if (newlyEntersBody || !meetsConductor || turn > 150) verdict = 'UNSAFE';
  else if (moved > 6 || turn > 100 || entersAfter) verdict = 'ACCEPTABLE';

  return { verdict, movedMm: moved, turnDegrees: turn, newlyEntersBody, meetsConductor };
}

describe('every schema-valid waypoint case survives the anchor move', () => {
  const cases: Array<[ComponentKind, string, string, number]> = [];
  for (const kind of AFFECTED) {
    for (const terminalId of Object.keys(ANCHORS_BEFORE_B6[kind])) {
      for (const pattern of Object.keys(PATTERNS)) {
        for (const rotation of ROTATIONS) {
          cases.push([kind, terminalId, pattern, rotation]);
        }
      }
    }
  }

  it('covers every affected terminal, pattern and rotation', () => {
    // 9 terminals x 4 patterns x 4 rotations.
    expect(cases.length).toBe(144);
  });

  it.each(cases)('%s:%s — %s at %i degrees', (kind, terminalId, pattern, rotation) => {
    const waypoints = PATTERNS[pattern](ANCHORS_BEFORE_B6[kind][terminalId]);
    const result = assess(kind, terminalId, waypoints, rotation);

    expect(result.newlyEntersBody, 'the wire would newly cross the body').toBe(false);
    expect(result.meetsConductor, 'the anchor no longer meets a conductor').toBe(true);
    expect(result.turnDegrees, 'the wire doubles back on itself').toBeLessThanOrEqual(150);
    expect(result.verdict).not.toBe('UNSAFE');
  });
});

describe('the moves themselves are the ones intended', () => {
  it('gives the resistor a 0.4 inch formed lead span', () => {
    const terminals = getComponentDefinition('resistor')!.terminals;
    const a = terminals.find((t) => t.id === 'a')!;
    const b = terminals.find((t) => t.id === 'b')!;
    // 40 units = 10.16 mm = 0.4 in, the breadboard span the body actually fits.
    expect(Math.abs(b.x - a.x)).toBe(40);
    expect(schematicToMm(Math.abs(b.x - a.x))).toBeCloseTo(10.16, 6);
  });

  it('puts the pushbutton legs on the Omron 6.5 x 4.5 pattern', () => {
    const terminals = getComponentDefinition('pushbutton')!.terminals;
    const at = (id: string) => terminals.find((t) => t.id === id)!;
    // Legs on one side are 4.5 mm apart; the two sides are 6.5 mm apart.
    expect(schematicToMm(Math.abs(at('a2').x - at('a1').x))).toBeCloseTo(4.57, 1);
    expect(schematicToMm(Math.abs(at('b1').y - at('a1').y))).toBeCloseTo(6.6, 1);
  });

  it('puts the trimmer pins in line at 2.54 mm', () => {
    const terminals = getComponentDefinition('potentiometer')!.terminals;
    const at = (id: string) => terminals.find((t) => t.id === id)!;
    expect(at('a').y).toBe(at('wiper').y);
    expect(at('wiper').y).toBe(at('b').y);
    expect(schematicToMm(at('wiper').x - at('a').x)).toBeCloseTo(2.54, 6);
    expect(schematicToMm(at('b').x - at('wiper').x)).toBeCloseTo(2.54, 6);
  });

  it('leaves the wiper as terminal 2, between the ends', () => {
    // Bourns 3386P: terminal 2 is the wiper. Electrical identity is unchanged; only where
    // it is drawn moved.
    const terminals = getComponentDefinition('potentiometer')!.terminals;
    expect(terminals.map((t) => t.id)).toEqual(['a', 'wiper', 'b']);
  });
});

describe('nothing electrical moved with the anchors', () => {
  it.each(AFFECTED)('%s keeps its terminal identity', (kind) => {
    const definition = getComponentDefinition(kind)!;
    const expected = Object.keys(ANCHORS_BEFORE_B6[kind]);
    expect(definition.terminals.map((t) => t.id)).toEqual(expected);
  });

  it('keeps the pushbutton common-terminal groups', () => {
    // The two legs on each physical side stay permanently common — the whole reason a
    // four-leg switch behaves like a two-terminal one.
    expect(getComponentDefinition('pushbutton')!.permanentlyCommonTerminals).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
  });

  it.each(AFFECTED)('%s keeps its terminal roles', (kind) => {
    const roles = getComponentDefinition(kind)!.terminals.map((t) => `${t.id}:${t.role}`);
    const expected: Record<string, string[]> = {
      resistor: ['a:passive', 'b:passive'],
      pushbutton: ['a1:passive', 'a2:passive', 'b1:passive', 'b2:passive'],
      potentiometer: ['a:passive', 'wiper:signal', 'b:passive'],
    };
    expect(roles).toEqual(expected[kind]);
  });
});
