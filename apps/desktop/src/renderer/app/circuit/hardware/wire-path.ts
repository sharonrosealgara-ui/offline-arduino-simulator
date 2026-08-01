/**
 * The path a jumper takes between two terminals.
 *
 * A wire sags between its ends, which is what makes it read as a physical jumper rather
 * than a laser beam. The sag used to be unbounded relative to the scene floor: on any run
 * longer than about 2.5 in it pulled the midpoint below the opaque bench, so the tube passed
 * underneath and only its two ends stayed visible. In the Blink circuit the Uno-to-resistor
 * wire dropped to −0.253 in, a full 0.158 in beneath a bench at −0.095 in, and read as two
 * separate segments each stopping in midair.
 *
 * A jumper rests on the bench; it does not pass through it. The midpoint is therefore
 * clamped so the *thickest* tube still clears the surface — clearing the centreline alone
 * would leave the lower half of every wire buried.
 *
 * Exported as a pure function so the renderer and the tests use one path, and the tests can
 * sample the real curve instead of restating this arithmetic.
 */
import * as THREE from 'three';
import { BENCH_SURFACE_Y } from './scene-layout';

/** Radius of a rendered wire tube, world inches. */
export const WIRE_RADIUS = 0.02;
/** A selected wire is drawn slightly thicker, and must clear the bench too. */
export const WIRE_RADIUS_SELECTED = 0.026;

/** The radius NetWire draws with. */
export function wireRadius(selected: boolean): number {
  return selected ? WIRE_RADIUS_SELECTED : WIRE_RADIUS;
}

/**
 * Slack above the geometric minimum.
 *
 * Small enough to stay invisible — two thousandths of an inch is a twentieth of a hair —
 * and large enough to absorb the floating-point error in curve sampling, so a tube that is
 * mathematically touching never renders as intersecting.
 */
export const WIRE_CLEARANCE_EPSILON = 0.002;

/**
 * The lowest a wire's centreline may sit.
 *
 * Derived from the *selected* radius, the thickest a wire is ever drawn, so selecting a wire
 * cannot push it into the bench.
 */
export const WIRE_MIN_CENTRE_Y = BENCH_SURFACE_Y + WIRE_RADIUS_SELECTED + WIRE_CLEARANCE_EPSILON;

/** Sag is proportional to span, up to a limit, so long runs do not droop without end. */
export const WIRE_SAG_PER_INCH = 0.18;
export const WIRE_MAX_SAG = 0.45;

/**
 * The curve NetWire renders as a tube.
 *
 * One sagged control point per span, then a Catmull-Rom through the result. Endpoints are
 * passed through untouched: only the inserted midpoints are ever clamped, so a terminal
 * keeps the exact position the wiring layer computed for it.
 */
export function buildWireCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 | null {
  if (points.length < 2) return null;

  const sagged: THREE.Vector3[] = [];
  const midIndices: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    sagged.push(from);

    const mid = from.clone().add(to).multiplyScalar(0.5);
    const sag = Math.min(WIRE_MAX_SAG, from.distanceTo(to) * WIRE_SAG_PER_INCH);
    // Rest on the bench rather than sink through it.
    mid.y = Math.max(mid.y - sag, WIRE_MIN_CENTRE_Y);
    midIndices.push(sagged.length);
    sagged.push(mid);
  }
  sagged.push(points[points.length - 1]);

  let curve = new THREE.CatmullRomCurve3(sagged, false, 'catmullrom', 0.5);

  /*
   * A Catmull-Rom spline dips below the control points it passes through, so clamping the
   * midpoint is not on its own a guarantee: measured against the bundled circuits the drawn
   * path overshot its clamped midpoint by around 0.003 in, which was enough to put the
   * bottom of the tube back under the bench.
   *
   * The guarantee therefore comes from the rendered path, not from the control points:
   * sample it, and if it dips, lift the sagged midpoints by exactly the shortfall and
   * rebuild. Endpoints are never touched, so a terminal keeps its computed position.
   */
  const shortfall = WIRE_MIN_CENTRE_Y - lowestSampledY(curve);
  if (shortfall > 0) {
    for (const index of midIndices) sagged[index].y += shortfall;
    curve = new THREE.CatmullRomCurve3(sagged, false, 'catmullrom', 0.5);
  }

  return curve;
}

/** Finer than any caller samples, so the minimum found here is the minimum they will see. */
const CLEARANCE_SAMPLES = 192;

function lowestSampledY(curve: THREE.CatmullRomCurve3): number {
  let lowest = Infinity;
  for (let i = 0; i <= CLEARANCE_SAMPLES; i += 1) {
    lowest = Math.min(lowest, curve.getPoint(i / CLEARANCE_SAMPLES).y);
  }
  return lowest;
}
