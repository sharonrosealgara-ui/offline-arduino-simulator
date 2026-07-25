/**
 * Potentiometer resistance-divider math. Source: spec §11.3.
 *
 * For total resistance R and clamped wiper position p:
 *   R(A,W) = max(Rmin, R*p)
 *   R(W,B) = max(Rmin, R*(1-p))
 *
 * The general conductance solver (electrical-solver.ts) remains authoritative for the
 * resulting voltage — this module only derives the two branch resistances from the
 * component's position, which circuit-runtime feeds into the solver each time the
 * control changes.
 */
export interface PotentiometerBranches {
  aToWiperOhms: number;
  wiperToBOhms: number;
}

export function clampPosition(position: number): number {
  if (!Number.isFinite(position)) return 0.5;
  return Math.max(0, Math.min(1, position));
}

export function computePotentiometerBranches(
  totalOhms: number,
  minimumOhms: number,
  position: number,
): PotentiometerBranches {
  const p = clampPosition(position);
  return {
    aToWiperOhms: Math.max(minimumOhms, totalOhms * p),
    wiperToBOhms: Math.max(minimumOhms, totalOhms * (1 - p)),
  };
}
