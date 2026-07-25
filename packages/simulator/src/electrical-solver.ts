/**
 * Bounded conductance (nodal analysis) solver for the classroom DC/digital circuit
 * model. NOT SPICE: no AC analysis, capacitors, inductors, transistor bias, or
 * parasitics. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §10.
 *
 * Every unknown node's voltage is solved via Gaussian elimination with partial
 * pivoting over sum_j G_ij (Vi - Vj) = Ii, bounded to 64 unknowns per connected
 * subgraph. GPIO outputs and pull-ups are modeled as Thevenin sources (fixed voltage
 * through a source resistance) rather than literal branches to another node.
 */

export const SOLVER_LIMITS = {
  maxUnknownNodesPerSubgraph: 64,
  pivotEpsilon: 1e-9,
  maxLedIterations: 3,
  /** Educational GPIO output source resistance (spec §10.1). */
  outputResistanceOhms: 25,
  /** Internal pull-up resistance to 5V (spec §10.1). */
  pullUpResistanceOhms: 30_000,
} as const;

export interface SolverBranch {
  /** Net id. May reference a fixed-voltage net; the solver treats it as a constant. */
  a: string;
  b: string;
  ohms: number;
}

export interface SolverSource {
  netId: string;
  voltage: number;
  ohms: number;
}

export interface SolverLed {
  id: string;
  anode: string;
  cathode: string;
  forwardV: number;
  dynamicOhms: number;
}

export interface SolveInput {
  /** Fixed-voltage nets (5V rail -> 5, 3.3V rail -> 3.3, GND -> 0). */
  fixedNets: Map<string, number>;
  branches: SolverBranch[];
  sources: SolverSource[];
  leds: SolverLed[];
  /** Every net id that should get a result, including isolated/floating ones. */
  allNets: string[];
  /** Previous on/off assumption per LED id, to seed iteration and reduce flicker. */
  previousLedState?: Map<string, boolean>;
}

export interface SolveResult {
  /** Solved voltage for every net in `allNets` (fixed nets pass through unchanged). */
  voltages: Map<string, number>;
  ledOn: Map<string, boolean>;
  ledCurrentAmps: Map<string, number>;
  floatingNets: Set<string>;
  /** Nets driven by two-or-more disagreeing Thevenin sources (GPIO contention). */
  contentionNets: Set<string>;
  converged: boolean;
  outOfRangeNets: Set<string>;
}

class DenseLinearSystem {
  readonly n: number;
  private a: Float64Array;
  private b: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.a = new Float64Array(n * n);
    this.b = new Float64Array(n);
  }

  addConductance(i: number, g: number): void {
    this.a[i * this.n + i] += g;
  }

  addCoupling(i: number, j: number, g: number): void {
    this.a[i * this.n + i] += g;
    this.a[j * this.n + j] += g;
    this.a[i * this.n + j] -= g;
    this.a[j * this.n + i] -= g;
  }

  addCurrentInto(i: number, amps: number): void {
    this.b[i] += amps;
  }

  /** Gaussian elimination with partial pivoting. Returns null if singular/non-finite. */
  solve(): Float64Array | null {
    const n = this.n;
    const a = this.a;
    const b = this.b;

    for (let col = 0; col < n; col += 1) {
      let pivotRow = col;
      let pivotValue = Math.abs(a[col * n + col]);
      for (let row = col + 1; row < n; row += 1) {
        const value = Math.abs(a[row * n + col]);
        if (value > pivotValue) {
          pivotValue = value;
          pivotRow = row;
        }
      }
      if (pivotValue < SOLVER_LIMITS.pivotEpsilon) return null;

      if (pivotRow !== col) {
        for (let k = 0; k < n; k += 1) {
          const tmp = a[col * n + k];
          a[col * n + k] = a[pivotRow * n + k];
          a[pivotRow * n + k] = tmp;
        }
        const tmpB = b[col];
        b[col] = b[pivotRow];
        b[pivotRow] = tmpB;
      }

      const pivot = a[col * n + col];
      for (let row = col + 1; row < n; row += 1) {
        const factor = a[row * n + col] / pivot;
        if (factor === 0) continue;
        for (let k = col; k < n; k += 1) {
          a[row * n + k] -= factor * a[col * n + k];
        }
        b[row] -= factor * b[col];
      }
    }

    const x = new Float64Array(n);
    for (let row = n - 1; row >= 0; row -= 1) {
      let sum = b[row];
      for (let k = row + 1; k < n; k += 1) sum -= a[row * n + k] * x[k];
      const diag = a[row * n + row];
      if (diag === 0 || !Number.isFinite(diag)) return null;
      x[row] = sum / diag;
      if (!Number.isFinite(x[row])) return null;
    }
    return x;
  }
}

/** Union-find restricted to nets that participate in at least one branch/LED edge. */
class NetGrouping {
  private parent = new Map<string, string>();

  ensure(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const p = this.parent.get(id);
    if (p === undefined) {
      this.parent.set(id, id);
      return id;
    }
    if (p !== id) {
      const root = this.find(p);
      this.parent.set(id, root);
      return root;
    }
    return id;
  }

  union(a: string, b: string): void {
    this.ensure(a);
    this.ensure(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function solveCircuit(input: SolveInput): SolveResult {
  const { fixedNets, branches, sources, leds, allNets } = input;
  const voltages = new Map<string, number>();
  const ledOn = new Map<string, boolean>();
  const ledCurrentAmps = new Map<string, number>();
  const floatingNets = new Set<string>();
  const contentionNets = new Set<string>();
  const outOfRangeNets = new Set<string>();
  let converged = true;

  for (const [net, volts] of fixedNets) voltages.set(net, volts);

  // Group unknown (non-fixed) nets that are connected via a branch or LED edge.
  const grouping = new NetGrouping();
  const isUnknown = (net: string): boolean => !fixedNets.has(net);
  const edges: Array<{ a: string; b: string }> = [
    ...branches.map((br) => ({ a: br.a, b: br.b })),
    ...leds.map((led) => ({ a: led.anode, b: led.cathode })),
  ];
  for (const edge of edges) {
    if (isUnknown(edge.a)) grouping.ensure(edge.a);
    if (isUnknown(edge.b)) grouping.ensure(edge.b);
    if (isUnknown(edge.a) && isUnknown(edge.b)) grouping.union(edge.a, edge.b);
  }
  for (const source of sources) {
    if (isUnknown(source.netId)) grouping.ensure(source.netId);
  }

  const groups = new Map<string, Set<string>>();
  for (const net of allNets) {
    if (!isUnknown(net)) continue;
    if (!grouping.find) continue;
    grouping.ensure(net);
    const root = grouping.find(net);
    const set = groups.get(root) ?? new Set<string>();
    set.add(net);
    groups.set(root, set);
  }

  // Nets with no branch/source at all are floating.
  const netsWithAnyEdge = new Set<string>();
  for (const edge of edges) {
    netsWithAnyEdge.add(edge.a);
    netsWithAnyEdge.add(edge.b);
  }
  for (const source of sources) netsWithAnyEdge.add(source.netId);
  for (const net of allNets) {
    if (isUnknown(net) && !netsWithAnyEdge.has(net)) {
      floatingNets.add(net);
      voltages.set(net, 0);
    }
  }

  for (const [, members] of groups) {
    if (members.size === 0) continue;
    if (members.size > SOLVER_LIMITS.maxUnknownNodesPerSubgraph) {
      for (const net of members) {
        voltages.set(net, 0);
        outOfRangeNets.add(net);
      }
      converged = false;
      continue;
    }

    const memberList = [...members].sort();
    const index = new Map(memberList.map((net, i) => [net, i]));

    const groupBranches = branches.filter((br) => index.has(br.a) || index.has(br.b));
    const groupSources = sources.filter((s) => index.has(s.netId));
    const groupLeds = leds.filter((led) => index.has(led.anode) || index.has(led.cathode));

    // Track per-source-net contributions to detect GPIO contention (two disagreeing drivers).
    const sourceVoltsByNet = new Map<string, number[]>();
    for (const source of groupSources) {
      const list = sourceVoltsByNet.get(source.netId) ?? [];
      list.push(source.voltage);
      sourceVoltsByNet.set(source.netId, list);
    }
    for (const [net, volts] of sourceVoltsByNet) {
      const min = Math.min(...volts);
      const max = Math.max(...volts);
      if (max - min > 0.5) contentionNets.add(net);
    }

    // LED iteration: seed from previous state, default ON.
    const ledAssumption = new Map<string, boolean>();
    for (const led of groupLeds) {
      ledAssumption.set(led.id, input.previousLedState?.get(led.id) ?? true);
    }

    let solved: Float64Array | null = null;
    for (let iteration = 0; iteration < SOLVER_LIMITS.maxLedIterations; iteration += 1) {
      const system = new DenseLinearSystem(memberList.length);

      const stampToFixedOrUnknown = (net: string, g: number, targetVoltsIfFixed: number): void => {
        const i = index.get(net);
        if (i !== undefined) {
          system.addConductance(i, g);
        }
        // if net is fixed and not in `index`, the caller already folded it into RHS.
        void targetVoltsIfFixed;
      };

      for (const br of groupBranches) {
        if (br.ohms <= 0) continue;
        const g = 1 / br.ohms;
        const ai = index.get(br.a);
        const bi = index.get(br.b);
        if (ai !== undefined && bi !== undefined) {
          system.addCoupling(ai, bi, g);
        } else if (ai !== undefined && bi === undefined) {
          const vb = fixedNets.get(br.b) ?? 0;
          system.addConductance(ai, g);
          system.addCurrentInto(ai, g * vb);
        } else if (bi !== undefined && ai === undefined) {
          const va = fixedNets.get(br.a) ?? 0;
          system.addConductance(bi, g);
          system.addCurrentInto(bi, g * va);
        }
        stampToFixedOrUnknown(br.a, 0, 0);
      }

      for (const source of groupSources) {
        const i = index.get(source.netId);
        if (i === undefined || source.ohms <= 0) continue;
        const g = 1 / source.ohms;
        system.addConductance(i, g);
        system.addCurrentInto(i, g * source.voltage);
      }

      for (const led of groupLeds) {
        const on = ledAssumption.get(led.id) ?? true;
        if (!on) continue; // open circuit while off
        const g = 1 / Math.max(led.dynamicOhms, 1e-6);
        const ai = index.get(led.anode);
        const ki = index.get(led.cathode);
        if (ai !== undefined && ki !== undefined) {
          system.addCoupling(ai, ki, g);
          system.addCurrentInto(ai, g * led.forwardV);
          system.addCurrentInto(ki, -g * led.forwardV);
        } else if (ai !== undefined) {
          const vk = fixedNets.get(led.cathode) ?? 0;
          system.addConductance(ai, g);
          system.addCurrentInto(ai, g * (led.forwardV + vk));
        } else if (ki !== undefined) {
          const va = fixedNets.get(led.anode) ?? 0;
          system.addConductance(ki, g);
          system.addCurrentInto(ki, g * (va - led.forwardV));
        }
      }

      solved = system.solve();
      if (!solved) break;

      let flipped = false;
      for (const led of groupLeds) {
        const ai = index.get(led.anode);
        const ki = index.get(led.cathode);
        const va = ai !== undefined ? solved[ai] : fixedNets.get(led.anode) ?? 0;
        const vk = ki !== undefined ? solved[ki] : fixedNets.get(led.cathode) ?? 0;
        const wasOn = ledAssumption.get(led.id) ?? true;
        const current = (va - vk - led.forwardV) / Math.max(led.dynamicOhms, 1e-6);
        if (wasOn && current <= 0) {
          ledAssumption.set(led.id, false);
          flipped = true;
        } else if (!wasOn && va - vk > led.forwardV) {
          ledAssumption.set(led.id, true);
          flipped = true;
        }
      }
      if (!flipped) break;
      if (iteration === SOLVER_LIMITS.maxLedIterations - 1) converged = false;
    }

    if (!solved) {
      converged = false;
      for (const net of memberList) {
        voltages.set(net, 0);
        outOfRangeNets.add(net);
      }
      continue;
    }

    for (const net of memberList) {
      const i = index.get(net)!;
      const raw = solved[i];
      const clamped = Math.max(-0.5, Math.min(5.5, raw));
      if (clamped !== raw) outOfRangeNets.add(net);
      voltages.set(net, clamped);
    }

    for (const led of groupLeds) {
      const on = ledAssumption.get(led.id) ?? false;
      ledOn.set(led.id, on);
      if (!on) {
        ledCurrentAmps.set(led.id, 0);
        continue;
      }
      const va = voltages.get(led.anode) ?? fixedNets.get(led.anode) ?? 0;
      const vk = voltages.get(led.cathode) ?? fixedNets.get(led.cathode) ?? 0;
      const current = Math.max(0, (va - vk - led.forwardV) / Math.max(led.dynamicOhms, 1e-6));
      ledCurrentAmps.set(led.id, current);
    }
  }

  // LEDs entirely inside the fixed-net domain (both terminals are rails) never entered
  // a group; resolve them directly.
  for (const led of leds) {
    if (ledOn.has(led.id)) continue;
    const va = voltages.get(led.anode) ?? fixedNets.get(led.anode);
    const vk = voltages.get(led.cathode) ?? fixedNets.get(led.cathode);
    if (va === undefined || vk === undefined) continue;
    const current = (va - vk - led.forwardV) / Math.max(led.dynamicOhms, 1e-6);
    const on = current > 0;
    ledOn.set(led.id, on);
    ledCurrentAmps.set(led.id, on ? current : 0);
  }

  return { voltages, ledOn, ledCurrentAmps, floatingNets, contentionNets, converged, outOfRangeNets };
}

/** 5V-domain digital logic thresholds (spec §10.3). Returns 'X' to retain-previous semantics upstream. */
export function classifyLogic(
  volts: number | null,
  previous: 0 | 1 | 'X',
): 0 | 1 | 'X' {
  if (volts === null) return 'X';
  if (volts <= 1.5) return 0;
  if (volts >= 3.0) return 1;
  return previous;
}

export function voltsToAdcCode(volts: number, vref: number): number {
  const raw = Math.floor((volts / vref) * 1024);
  return Math.max(0, Math.min(1023, raw));
}
