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
  return buildWireCurveWithDiagnostics(points)?.curve ?? null;
}

/**
 * How many times the path may be lifted and re-sampled before the fallback takes over.
 *
 * A Catmull-Rom is affine in its control points, so lifting the interior points by the
 * measured shortfall recovers most of it in one pass and the remainder converges quickly.
 * The budget exists so the loop is bounded by construction, not because it is expected to
 * be spent: on every geometry tested it finishes in one or two passes.
 */
export const WIRE_MAX_CLEARANCE_ITERATIONS = 8;

/**
 * How densely the path is measured.
 *
 * Callers that verify clearance must sample no more densely than this, and on a nested grid
 * (128, 256, 512 …), so every point they can see is a point this already measured. If a test
 * sampled finer it could find a dip production never looked at.
 */
export const WIRE_CLEARANCE_SAMPLES = 512;

/**
 * When the correction is close enough to stop.
 *
 * The lift converges geometrically and lands within a few billionths of an inch of the
 * target, but never exactly on it — comparing for equality would spin the loop to its budget
 * and hand a converged curve to the fallback, which is precisely what happened the first
 * time this was written. A millionth of an inch is five orders of magnitude below the
 * epsilon it is measured against, so stopping here costs nothing real.
 */
export const WIRE_CLEARANCE_TOLERANCE = 1e-6;

export interface WireCurveResult {
  curve: THREE.CatmullRomCurve3;
  /** Corrective passes used. 0 means the natural sag already cleared the bench. */
  iterations: number;
  /** Lowest centreline height of the returned curve. */
  lowestCentreY: number;
  /** Whether the returned curve meets the clearance target. */
  clears: boolean;
  /** True if the iteration budget ran out and the sag was removed instead. */
  usedFallback: boolean;
}

/**
 * The curve NetWire renders, plus what it took to get there.
 *
 * Clamping the sagged midpoint is not on its own a guarantee: a Catmull-Rom dips below the
 * control points it passes through, and measured against the bundled circuits the drawn path
 * overshot its clamped midpoint by about 0.003 in — enough to put the bottom of the tube back
 * under the bench. So the guarantee comes from the rendered path. Sample it, lift the interior
 * points by the shortfall, rebuild, and measure again, until the tube itself clears.
 *
 * Only interior points ever move. Endpoints are the terminal positions the wiring layer
 * computed and are passed through untouched, in every branch including the fallback.
 */
export function buildWireCurveWithDiagnostics(points: THREE.Vector3[]): WireCurveResult | null {
  if (points.length < 2) return null;

  const control: THREE.Vector3[] = [];
  const interior: number[] = [];
  /** Each interior point's height with no sag at all — the deterministic fallback. */
  const flatY: number[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    control.push(from);

    const mid = from.clone().add(to).multiplyScalar(0.5);
    flatY.push(mid.y);
    const sag = Math.min(WIRE_MAX_SAG, from.distanceTo(to) * WIRE_SAG_PER_INCH);
    // Rest on the bench rather than sink through it.
    mid.y = Math.max(mid.y - sag, WIRE_MIN_CENTRE_Y);
    interior.push(control.length);
    control.push(mid);
  }
  control.push(points[points.length - 1]);

  const rebuild = (): THREE.CatmullRomCurve3 =>
    new THREE.CatmullRomCurve3(control, false, 'catmullrom', 0.5);

  let curve = rebuild();
  let lowest = lowestSampledY(curve);
  let iterations = 0;

  while (lowest < WIRE_MIN_CENTRE_Y - WIRE_CLEARANCE_TOLERANCE && iterations < WIRE_MAX_CLEARANCE_ITERATIONS) {
    const shortfall = WIRE_MIN_CENTRE_Y - lowest;
    for (const index of interior) control[index].y += shortfall;
    curve = rebuild();
    lowest = lowestSampledY(curve);
    iterations += 1;
  }

  // Deterministic terminal state: if the budget is spent, take the sag out altogether and
  // hold the interior points at the clearance height. A path with no downward bend cannot
  // dive under the bench, so this always terminates in a defined, safe shape.
  let usedFallback = false;
  if (lowest < WIRE_MIN_CENTRE_Y - WIRE_CLEARANCE_TOLERANCE) {
    usedFallback = true;
    for (let i = 0; i < interior.length; i += 1) {
      control[interior[i]].y = Math.max(flatY[i], WIRE_MIN_CENTRE_Y);
    }
    curve = rebuild();
    lowest = lowestSampledY(curve);
  }

  return {
    curve,
    iterations,
    lowestCentreY: lowest,
    clears: lowest >= WIRE_MIN_CENTRE_Y - WIRE_CLEARANCE_TOLERANCE,
    usedFallback,
  };
}

function lowestSampledY(curve: THREE.CatmullRomCurve3): number {
  let lowest = Infinity;
  for (let i = 0; i <= WIRE_CLEARANCE_SAMPLES; i += 1) {
    lowest = Math.min(lowest, curve.getPoint(i / WIRE_CLEARANCE_SAMPLES).y);
  }
  return lowest;
}
