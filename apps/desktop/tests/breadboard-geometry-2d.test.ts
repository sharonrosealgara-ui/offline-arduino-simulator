/**
 * Where a click lands, and where an arrow key goes.
 *
 * All of it is pure, so it is tested without a DOM. The property worth stating plainly:
 * `resolveHoleAt` is allowed to return null. A board that always snapped to the nearest hole
 * would attach a wire to a hole the student never aimed at and give them no way to express
 * "I missed" — so the rejection band between capture regions is a feature with its own tests,
 * not an accident of the radius.
 */
import { describe, expect, it } from 'vitest';
import { createBreadboardModel } from '@offline-arduino/contracts/breadboard';
import { mmToSchematicUnits } from '@offline-arduino/contracts/units';
import {
  FOCUSED_PIXELS_PER_UNIT,
  HOLE_CAPTURE_RADIUS_UNITS,
  HOLE_PITCH_UNITS,
  MIN_TARGET_CSS_PX,
  breadboardBodyRect,
  breadboardHolePoints,
  breadboardRows,
  firstNavigableHole,
  focusedTargetMetrics,
  focusedViewBox,
  holeCanvasPosition,
  locateHole,
  moveHole,
  resolveHoleAt,
  toBoardLocal,
  toCanvas,
} from '../src/renderer/app/circuit/breadboard-geometry';

const model = createBreadboardModel();
const at = (x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0) => ({ x, y, rotation });
const ROTATIONS = [0, 90, 180, 270] as const;

describe('geometry comes from the canonical model, converted not restated', () => {
  it('produces exactly the 400 canonical holes in canonical order', () => {
    const points = breadboardHolePoints();
    expect(points).toHaveLength(400);
    expect(points.map((p) => p.id)).toEqual(model.holes.map((h) => h.id));
    expect(points.map((p) => p.order)).toEqual(model.holes.map((_, i) => i));
  });

  it('converts every hole through the shared unit helper', () => {
    for (const hole of model.holes) {
      const point = breadboardHolePoints().find((p) => p.id === hole.id)!;
      expect(point.x).toBeCloseTo(mmToSchematicUnits(hole.x), 9);
      expect(point.y).toBeCloseTo(mmToSchematicUnits(hole.y), 9);
      expect(point.groupId).toBe(hole.groupId);
    }
  });

  it('puts the pitch at exactly 10 schematic units', () => {
    expect(HOLE_PITCH_UNITS).toBeCloseTo(10, 9);
  });

  it('converts the documented body envelope, centred on the origin', () => {
    const body = breadboardBodyRect();
    expect(body.w).toBeCloseTo(mmToSchematicUnits(84), 9);
    expect(body.h).toBeCloseTo(mmToSchematicUnits(54.3), 9);
    expect(body.x).toBeCloseTo(-body.w / 2, 9);
    expect(body.y).toBeCloseTo(-body.h / 2, 9);
  });

  it('fits every hole inside the body', () => {
    const body = breadboardBodyRect();
    for (const hole of breadboardHolePoints()) {
      expect(Math.abs(hole.x)).toBeLessThan(body.w / 2);
      expect(Math.abs(hole.y)).toBeLessThan(body.h / 2);
    }
  });
});

describe('the transform and its inverse', () => {
  it.each(ROTATIONS)('round-trips every hole at %i degrees', (rotation) => {
    const component = at(300, 250, rotation);
    for (const hole of breadboardHolePoints()) {
      const canvas = toCanvas(hole, component);
      const back = toBoardLocal(canvas, component);
      expect(back.x).toBeCloseTo(hole.x, 9);
      expect(back.y).toBeCloseTo(hole.y, 9);
    }
  });

  it.each(ROTATIONS)('actually moves the board at %i degrees', (rotation) => {
    const a = holeCanvasPosition('A1', at(300, 250, rotation))!;
    const b = holeCanvasPosition('A1', at(500, 250, rotation))!;
    expect(b.x - a.x).toBeCloseTo(200, 9);
  });

  it('turns the board rather than leaving it upright', () => {
    const upright = holeCanvasPosition('A1', at(0, 0, 0))!;
    const turned = holeCanvasPosition('A1', at(0, 0, 90))!;
    // +X maps to +Y under a quarter turn.
    expect(turned.x).toBeCloseTo(-upright.y, 9);
    expect(turned.y).toBeCloseTo(upright.x, 9);
  });

  it('returns nothing for an id that is not a hole', () => {
    for (const id of ['K1', 'A31', 'A0', 'TP26', 'GND', '5V']) {
      expect(`${id}:${holeCanvasPosition(id, at(0, 0))}`).toBe(`${id}:undefined`);
    }
  });

  it('treats D13 as a real hole, because it is one', () => {
    // D13 is row D, column 13 — and also the Uno's digital pin 13. The strings collide, so
    // a bare id can never identify a terminal; only componentId:terminalId can. Worth a
    // test of its own: it is an easy way to write a wrong assertion.
    expect(holeCanvasPosition('D13', at(0, 0))).toBeDefined();
    expect(breadboardHolePoints().some((h) => h.id === 'D13')).toBe(true);
    for (const id of ['A0', 'A1', 'A5', 'D13', 'D2']) {
      const isHole = breadboardHolePoints().some((h) => h.id === id);
      // A0 is an Uno pin but NOT a hole (columns start at 1); A1 and D13 are both.
      expect(`${id}:${isHole}`).toBe(`${id}:${id === 'A0' ? 'false' : 'true'}`);
    }
  });
});

describe('pointer resolution', () => {
  it.each(ROTATIONS)('resolves a click on every hole centre at %i degrees', (rotation) => {
    const component = at(300, 250, rotation);
    for (const hole of breadboardHolePoints()) {
      const canvas = toCanvas(hole, component);
      expect(`${hole.id}:${resolveHoleAt(canvas, component)}`).toBe(`${hole.id}:${hole.id}`);
    }
  });

  it('gives the same hole id however the board is placed or turned', () => {
    for (const rotation of ROTATIONS) {
      for (const [x, y] of [[0, 0], [300, 250], [880, 40]] as const) {
        const component = at(x, y, rotation);
        const canvas = holeCanvasPosition('E14', component)!;
        expect(resolveHoleAt(canvas, component)).toBe('E14');
      }
    }
  });

  it('accepts a point just inside the capture radius and rejects one just outside', () => {
    const component = at(300, 250);
    const centre = holeCanvasPosition('C7', component)!;
    const inside = { x: centre.x + HOLE_CAPTURE_RADIUS_UNITS - 0.01, y: centre.y };
    const outside = { x: centre.x + HOLE_CAPTURE_RADIUS_UNITS + 0.01, y: centre.y };
    expect(resolveHoleAt(inside, component)).toBe('C7');
    expect(resolveHoleAt(outside, component)).toBeNull();
  });

  it('rejects the midpoint between two adjacent holes in the same row', () => {
    const component = at(300, 250);
    const a = holeCanvasPosition('C7', component)!;
    const b = holeCanvasPosition('C8', component)!;
    expect(resolveHoleAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, component)).toBeNull();
  });

  it('rejects the midpoint between two adjacent rows', () => {
    const component = at(300, 250);
    const a = holeCanvasPosition('C7', component)!;
    const b = holeCanvasPosition('D7', component)!;
    expect(resolveHoleAt({ x: a.x, y: (a.y + b.y) / 2 }, component)).toBeNull();
  });

  it('rejects a point over the body but far from any hole', () => {
    const component = at(300, 250);
    const trench = holeCanvasPosition('E15', component)!;
    const gap = holeCanvasPosition('F15', component)!;
    expect(resolveHoleAt({ x: trench.x, y: (trench.y + gap.y) / 2 }, component)).toBeNull();
  });

  it('rejects a point entirely off the board', () => {
    expect(resolveHoleAt({ x: -9000, y: -9000 }, at(300, 250))).toBeNull();
  });

  it('breaks an exact tie by canonical order', () => {
    const component = at(300, 250);
    const a = breadboardHolePoints().find((h) => h.id === 'C7')!;
    const b = breadboardHolePoints().find((h) => h.id === 'C8')!;
    // Equidistant from both, but inside a capture radius wide enough to reach each.
    const midpoint = toCanvas({ x: (a.x + b.x) / 2, y: a.y }, component);
    const generous = HOLE_PITCH_UNITS; // reaches both centres exactly
    const winner = resolveHoleAt(midpoint, component, generous);
    expect(winner).toBe(a.order < b.order ? 'C7' : 'C8');
    expect(winner).toBe('C7');
  });

  it('leaves a real rejection band — capture regions never touch', () => {
    expect(2 * HOLE_CAPTURE_RADIUS_UNITS).toBeLessThan(HOLE_PITCH_UNITS);
  });
});

describe('keyboard navigation rows', () => {
  const rows = breadboardRows();

  it('derives fourteen physical rows from the canonical coordinates', () => {
    expect(rows).toHaveLength(14);
    expect(rows.flat()).toHaveLength(400);
  });

  it('gives strips 30 holes and rails 25', () => {
    const lengths = rows.map((r) => r.length);
    expect(lengths.filter((l) => l === 30)).toHaveLength(10);
    expect(lengths.filter((l) => l === 25)).toHaveLength(4);
  });

  it('orders every row left to right', () => {
    for (const row of rows) {
      for (let i = 1; i < row.length; i += 1) expect(row[i].x).toBeGreaterThan(row[i - 1].x);
    }
  });

  it('starts navigation on a real hole', () => {
    expect(breadboardHolePoints().some((h) => h.id === firstNavigableHole())).toBe(true);
  });

  it('moves along a row and clamps at both ends instead of wrapping', () => {
    expect(moveHole('A1', 'right')).toBe('A2');
    expect(moveHole('A2', 'left')).toBe('A1');
    expect(moveHole('A1', 'left')).toBe('A1');
    expect(moveHole('A30', 'right')).toBe('A30');
  });

  it('steps between adjacent rows within a bank', () => {
    expect(moveHole('B7', 'down')).toBe('C7');
    expect(moveHole('C7', 'up')).toBe('B7');
  });

  it('crosses the centre separation only by moving, never by connection', () => {
    expect(moveHole('E9', 'down')).toBe('F9');
    expect(locateHole('E9')!.row + 1).toBe(locateHole('F9')!.row);
  });

  it('picks the nearest X when stepping between a 30-hole row and a 25-hole rail row', () => {
    const rowOf = (id: string) => breadboardRows()[locateHole(id)!.row];
    const topRail = rowOf('TN1');
    const firstStrip = rowOf('A1');
    expect(topRail).toHaveLength(25);
    expect(firstStrip).toHaveLength(30);

    for (const source of ['A1', 'A7', 'A15', 'A24', 'A30']) {
      const target = moveHole(source, 'up');
      const sourceX = breadboardHolePoints().find((h) => h.id === source)!.x;
      const targetX = breadboardHolePoints().find((h) => h.id === target)!.x;
      const best = Math.min(...topRail.map((h) => Math.abs(h.x - sourceX)));
      expect(`${source}->${target}`).toBe(`${source}->${target}`);
      expect(Math.abs(targetX - sourceX)).toBeCloseTo(best, 9);
    }
  });

  it('is deterministic — the same move always gives the same hole', () => {
    for (const arrow of ['left', 'right', 'up', 'down'] as const) {
      expect(moveHole('E9', arrow)).toBe(moveHole('E9', arrow));
    }
  });

  it('clamps at the top and bottom rows', () => {
    const rowsNow = breadboardRows();
    const topId = rowsNow[0][0].id;
    const bottomId = rowsNow[rowsNow.length - 1][0].id;
    expect(moveHole(topId, 'up')).toBe(topId);
    expect(moveHole(bottomId, 'down')).toBe(bottomId);
  });

  it('leaves an unknown id alone rather than guessing', () => {
    for (const id of ['K1', 'A31', 'A0', 'TP26']) {
      expect(`${id}:${moveHole(id, 'right')}`).toBe(`${id}:${id}`);
      expect(`${id}:${locateHole(id)}`).toBe(`${id}:undefined`);
    }
  });
});

describe('focused selection meets the target-size floor', () => {
  it('gives each selection region at least 32 CSS pixels', () => {
    const metrics = focusedTargetMetrics();
    expect(metrics.targetPx).toBeGreaterThanOrEqual(MIN_TARGET_CSS_PX);
    expect(metrics.meetsMinimum).toBe(true);
  });

  it('keeps adjacent regions non-overlapping with a real gap between them', () => {
    const metrics = focusedTargetMetrics();
    expect(metrics.centreSpacingPx).toBeGreaterThan(metrics.targetPx);
    expect(metrics.rejectionBandPx).toBeGreaterThan(0);
  });

  it('reports honestly when a magnification is too small', () => {
    const tooSmall = focusedTargetMetrics(1);
    expect(tooSmall.meetsMinimum).toBe(false);
    expect(tooSmall.targetPx).toBeLessThan(MIN_TARGET_CSS_PX);
  });

  it('centres a bounded viewport on the current hole rather than the whole board', () => {
    const component = at(300, 250);
    const view = focusedViewBox('E14', component, { width: 360, height: 240 })!;
    const centre = holeCanvasPosition('E14', component)!;
    expect(view.x + view.width / 2).toBeCloseTo(centre.x, 9);
    expect(view.y + view.height / 2).toBeCloseTo(centre.y, 9);
    expect(view.width).toBeCloseTo(360 / FOCUSED_PIXELS_PER_UNIT, 9);
    // Smaller than the board, which is the point of a bounded viewport.
    expect(view.width).toBeLessThan(breadboardBodyRect().w);
  });

  it('follows the cursor as it moves', () => {
    const component = at(300, 250);
    const a = focusedViewBox('A1', component, { width: 360, height: 240 })!;
    const b = focusedViewBox('A30', component, { width: 360, height: 240 })!;
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('returns nothing for a hole that does not exist', () => {
    expect(focusedViewBox('K1', at(0, 0), { width: 100, height: 100 })).toBeUndefined();
  });
});
