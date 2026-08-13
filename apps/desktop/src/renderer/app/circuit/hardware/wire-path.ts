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
 * Where the liftable interior points sit within a span.
 *
 * Quarter points and near-end points as well as the midpoint, so the correction can raise a
 * wire's approach to a connector and not merely its middle. A wire leaving a power pin and
 * heading east passes over the analog header within 11% of its length; without a control
 * point that close to the end, the lift cannot reach that stretch at all.
 */
export const SPAN_INTERIOR_FRACTIONS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;

/**
 * The curve NetWire renders as a tube.
 *
 * One sagged control point per span, then a Catmull-Rom through the result. Endpoints are
 * passed through untouched: only the inserted midpoints are ever clamped, so a terminal
 * keeps the exact position the wiring layer computed for it.
 */
export function buildWireCurve(
  points: THREE.Vector3[],
  clearance: WireClearanceContext = BENCH_CLEARANCE,
): THREE.CatmullRomCurve3 | null {
  return buildWireCurveWithDiagnostics(points, clearance)?.curve ?? null;
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
 * The requirement a wire must clear is a STEP function — it jumps at every obstacle edge — so
 * this is not merely about curve smoothness. Between two samples a curve can cross into a
 * raised region entirely unseen. At 512 samples an independent 733-point grid found dips up
 * to 6.7e-4 in that production had stepped over. 4096 puts the sample spacing well below the
 * smallest obstacle feature on the board.
 */
export const WIRE_CLEARANCE_SAMPLES = 4096;

/**
 * When the correction is close enough to stop.
 *
 * The lift converges geometrically and lands within a few billionths of an inch of the
 * target, but never exactly on it — comparing for equality would spin the loop to its budget
 * and hand a converged curve to the fallback, which is precisely what happened the first
 * time this was written. A millionth of an inch is five orders of magnitude below the epsilon
 * it is measured against, so stopping here costs nothing real.
 *
 * Note what this tolerance does NOT cover: the required height is a step function at every
 * obstacle edge, so a denser grid can find a dip of around 1e-6 in between two of the samples
 * production measured. That is a property of sampling a discontinuous constraint, not of the
 * convergence loop — tightening this constant does not change it. The 0.002 in epsilon is
 * what absorbs it, leaving the tube clear of the physical surface by 0.00199 in.
 */
export const WIRE_CLEARANCE_TOLERANCE = 1e-6;

/**
 * What a wire must clear along its route.
 *
 * Returns the minimum WIRE-CENTRE height at a point — radius and epsilon already included,
 * never a bare surface height. The default is the bench alone; the board supplies a
 * position-dependent rule (see scene-obstacles.ts) so a wire rises only where something is
 * actually in its way.
 */
export interface WireClearanceContext {
  requiredCentreYAt(point: THREE.Vector3): number;
}

/** Bench only: the rule for a wire with no obstacle anywhere near it. */
export const BENCH_CLEARANCE: WireClearanceContext = {
  requiredCentreYAt: () => WIRE_MIN_CENTRE_Y,
};

export interface WireCurveResult {
  curve: THREE.CatmullRomCurve3;
  /** Corrective passes used. 0 means the natural sag already cleared the bench. */
  iterations: number;
  /** Lowest centreline height of the returned curve. */
  lowestCentreY: number;
  /** Worst remaining gap between the curve and what it had to clear. 0 or above means clear. */
  worstMarginY: number;
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
export function buildWireCurveWithDiagnostics(
  points: THREE.Vector3[],
  clearance: WireClearanceContext = BENCH_CLEARANCE,
): WireCurveResult | null {
  if (points.length < 2) return null;

  const control: THREE.Vector3[] = [];
  const interior: number[] = [];
  /** Each interior point's height with no sag at all — the deterministic fallback. */
  const flatY: number[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    control.push(from);

    const sag = Math.min(WIRE_MAX_SAG, from.distanceTo(to) * WIRE_SAG_PER_INCH);
    /*
     * Three interior points per span rather than one.
     *
     * A single midpoint cannot shape the path near an endpoint, and that is exactly where
     * some routes need shaping: a wire plugs into a header pin at 0.3315 in while clearing a
     * neighbouring header needs 0.3795 in, so its approach has to ride over the adjacent pins
     * and drop in at its own. Lifting one central point leaves that approach untouched —
     * Blink's ground wire clipped the analog header 0.0204 in deep for precisely this reason.
     *
     * Sag is shaped by sin(pi*u) so the droop still peaks in the middle and eases toward the
     * ends: the wire keeps the profile of a hanging jumper, it just has local control now.
     */
    for (const u of SPAN_INTERIOR_FRACTIONS) {
      const point = from.clone().lerp(to, u);
      flatY.push(point.y);
      point.y = Math.max(point.y - sag * Math.sin(Math.PI * u), WIRE_MIN_CENTRE_Y);
      interior.push(control.length);
      control.push(point);
    }
  }
  control.push(points[points.length - 1]);

  const rebuild = (): THREE.CatmullRomCurve3 =>
    new THREE.CatmullRomCurve3(control, false, 'catmullrom', 0.5);

  let curve = rebuild();
  let measured = measure(curve, clearance);
  let iterations = 0;

  while (measured.margin < -WIRE_CLEARANCE_TOLERANCE && iterations < WIRE_MAX_CLEARANCE_ITERATIONS) {
    const shortfall = -measured.margin;
    for (const index of interior) control[index].y += shortfall;
    curve = rebuild();
    measured = measure(curve, clearance);
    iterations += 1;
  }

  /*
   * Deterministic terminal state: if the budget is spent, take the sag out altogether and
   * hold every interior point at least as high as the route's greatest requirement. A path
   * with no downward bend cannot dive under what it has to clear.
   *
   * The lift is a single uniform TRANSLATION rather than a per-point clamp. The clamp form,
   * `Math.max(flatY[i], highest)`, flattened every interior point of a span onto one height
   * whenever `highest` dominated — and a wire ending in a breadboard hole has a span whose
   * ends share an x and a z exactly (the anchor and the portal directly above it). Flattening
   * that span's five interior points produced five coincident control points, hence
   * zero-length curve segments, handed straight to TubeGeometry.
   *
   * Translating by `highest - min(flatY)` keeps every relative difference intact, so points
   * that were distinct stay distinct, while still putting the lowest of them exactly on
   * `highest` and therefore all of them at or above it. That is the same guarantee the clamp
   * gave, without the collapse — and it needs no epsilon, so there is no new tolerance to
   * justify or to drift.
   */
  let usedFallback = false;
  if (measured.margin < -WIRE_CLEARANCE_TOLERANCE) {
    usedFallback = true;
    const highest = highestRequired(curve, clearance);
    const lowestFlat = Math.min(...flatY);
    const lift = Math.max(0, highest - lowestFlat);
    for (let i = 0; i < interior.length; i += 1) {
      control[interior[i]].y = flatY[i] + lift;
    }
    curve = rebuild();
    measured = measure(curve, clearance);
  }

  return {
    curve,
    iterations,
    lowestCentreY: measured.lowest,
    worstMarginY: measured.margin,
    clears: measured.margin >= -WIRE_CLEARANCE_TOLERANCE,
    usedFallback,
  };
}

/**
 * The worst point on the path: how far its centreline sits below what it must clear there.
 *
 * Measured per sample rather than against one global floor, because the floor is a function
 * of position now — high over the board, bench height everywhere else.
 */
function measure(
  curve: THREE.CatmullRomCurve3,
  clearance: WireClearanceContext,
): { lowest: number; margin: number } {
  let lowest = Infinity;
  let margin = Infinity;
  for (let i = 0; i <= WIRE_CLEARANCE_SAMPLES; i += 1) {
    const point = curve.getPoint(i / WIRE_CLEARANCE_SAMPLES);
    lowest = Math.min(lowest, point.y);
    margin = Math.min(margin, point.y - clearance.requiredCentreYAt(point));
  }
  return { lowest, margin };
}

/** The tallest clearance the route demands anywhere along it. */
function highestRequired(curve: THREE.CatmullRomCurve3, clearance: WireClearanceContext): number {
  let highest = -Infinity;
  for (let i = 0; i <= WIRE_CLEARANCE_SAMPLES; i += 1) {
    highest = Math.max(highest, clearance.requiredCentreYAt(curve.getPoint(i / WIRE_CLEARANCE_SAMPLES)));
  }
  return highest;
}
