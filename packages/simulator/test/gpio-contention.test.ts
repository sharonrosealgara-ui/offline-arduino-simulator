/**
 * GPIO_CONTENTION: two output pins wired together and driving opposite values.
 *
 * THE DEFECT THIS COVERS
 * Packaged acceptance wired D12 to D13, drove D12 HIGH and D13 LOW, and the Problems panel
 * said "No problems" — while D13 measurably read HIGH, proving the two pins really were on
 * one net and fighting.
 *
 * The runtime kept its Thevenin sources in a map keyed by NET id. Wiring two pins together
 * merges them into a single net, so both bindings shared a netId and the second pin's entry
 * overwrote the first. Exactly one source reached the solver, so the "two disagreeing
 * drivers" test could never fire — GPIO_CONTENTION was unreachable in practice, and the
 * electrical answer was wrong too (last writer won outright instead of the outputs loading
 * each other).
 *
 * The sources are now keyed by board pin. These tests cover both layers: the solver's
 * contention rule, and the runtime integration that has to preserve BOTH sources across the
 * net merge — which is where the bug actually lived.
 */
import { describe, expect, it } from 'vitest';
import { compileNetlist } from '../src/netlist-compiler';
import { CircuitRuntime } from '../src/circuit-runtime';
import { solveCircuit } from '../src/electrical-solver';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';
import type { CircuitDiagnostic } from '@offline-arduino/contracts/simulator';

const noopBoard = { setDigitalInput: () => undefined, setAnalogVoltage: () => undefined };

/** The exact wording a student sees. Pinned so it cannot drift silently. */
const CONTENTION_MESSAGE = 'Two output pins are driving different values; change wiring or pin mode.';

const OUTPUT_OHMS = 25;

/** Port B bit assignments on the Uno: D12 is B4, D13 is B5. */
const D12 = { port: 'B' as const, bit: 4 };
const D13 = { port: 'B' as const, bit: 5 };

const uno = () => ({ id: 'uno1', kind: 'uno-r3' as const, x: 0, y: 0, rotation: 0 as const, label: 'Uno', properties: {} });

/** D12 wired directly to D13 — the short the acceptance pass built by hand. */
const shorted: ProjectCircuit = {
  schemaVersion: 1,
  components: [uno()],
  wires: [
    {
      id: 'w1',
      from: { componentId: 'uno1', terminalId: 'D12' },
      to: { componentId: 'uno1', terminalId: 'D13' },
      colorRole: 'signal-yellow',
      waypoints: [],
    },
  ],
  junctions: [],
};

/** Same two pins, no wire between them. */
const unconnected: ProjectCircuit = {
  schemaVersion: 1,
  components: [uno()],
  wires: [],
  junctions: [],
};

function runtimeFor(circuit: ProjectCircuit): CircuitRuntime {
  return new CircuitRuntime(compileNetlist(circuit), noopBoard);
}

type Drive = 'output-low' | 'output-high' | 'input' | 'input-pullup';

/** Applies pin drives, settles, and returns the diagnostics the UI would receive. */
function diagnose(runtime: CircuitRuntime, drives: Array<[{ port: 'B'; bit: number }, Drive]>): CircuitDiagnostic[] {
  let cycle = 1;
  for (const [pin, drive] of drives) runtime.onBoardPinDriverChange(pin.port, pin.bit, drive, cycle++);
  runtime.settle(cycle);
  return runtime.takeDiagnostics();
}

const contention = (items: CircuitDiagnostic[]) => items.filter((d) => d.code === 'GPIO_CONTENTION');

describe('electrical solver: disagreeing drivers on one net', () => {
  it('flags a net driven both high and low', () => {
    const result = solveCircuit({
      fixedNets: new Map(),
      branches: [],
      sources: [
        { netId: 'n1', voltage: 5, ohms: OUTPUT_OHMS, driver: true },
        { netId: 'n1', voltage: 0, ohms: OUTPUT_OHMS, driver: true },
      ],
      leds: [],
      allNets: ['n1'],
    });

    expect([...result.contentionNets]).toEqual(['n1']);
  });

  it('settles the shorted net between the two drivers rather than letting one win', () => {
    // Two equal 25 ohm sources at 5 V and 0 V: the node lands midway. This is the physical
    // answer a real short gives, and it is what the previous last-writer-wins behaviour got
    // wrong.
    const result = solveCircuit({
      fixedNets: new Map(),
      branches: [],
      sources: [
        { netId: 'n1', voltage: 5, ohms: OUTPUT_OHMS, driver: true },
        { netId: 'n1', voltage: 0, ohms: OUTPUT_OHMS, driver: true },
      ],
      leds: [],
      allNets: ['n1'],
    });

    expect(result.voltages.get('n1')).toBeCloseTo(2.5, 3);
    expect(result.converged).toBe(true);
  });

  it('does not flag two drivers that agree', () => {
    const result = solveCircuit({
      fixedNets: new Map(),
      branches: [],
      sources: [
        { netId: 'n1', voltage: 5, ohms: OUTPUT_OHMS, driver: true },
        { netId: 'n1', voltage: 5, ohms: OUTPUT_OHMS, driver: true },
      ],
      leds: [],
      allNets: ['n1'],
    });

    expect([...result.contentionNets]).toEqual([]);
  });

  it('does not flag a single driver', () => {
    const result = solveCircuit({
      fixedNets: new Map(),
      branches: [],
      sources: [{ netId: 'n1', voltage: 5, ohms: OUTPUT_OHMS, driver: true }],
      leds: [],
      allNets: ['n1'],
    });

    expect([...result.contentionNets]).toEqual([]);
  });

  it('does not leak contention onto unrelated nets', () => {
    const result = solveCircuit({
      fixedNets: new Map(),
      branches: [],
      sources: [
        { netId: 'n1', voltage: 5, ohms: OUTPUT_OHMS, driver: true },
        { netId: 'n1', voltage: 0, ohms: OUTPUT_OHMS, driver: true },
        { netId: 'n2', voltage: 5, ohms: OUTPUT_OHMS, driver: true },
      ],
      leds: [],
      allNets: ['n1', 'n2'],
    });

    expect([...result.contentionNets]).toEqual(['n1']);
    expect(result.voltages.get('n2')).toBeCloseTo(5, 3);
  });
});

describe('runtime: both output sources survive the net merge', () => {
  it('reports GPIO_CONTENTION for two connected outputs driving opposite values', () => {
    // The exact packaged scenario: D12 HIGH, D13 LOW, wired together.
    const found = contention(diagnose(runtimeFor(shorted), [[D12, 'output-high'], [D13, 'output-low']]));

    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
  });

  it('produces the exact student-facing message', () => {
    const found = contention(diagnose(runtimeFor(shorted), [[D12, 'output-high'], [D13, 'output-low']]));

    expect(found[0].message).toBe(CONTENTION_MESSAGE);
  });

  it('detects the conflict regardless of which pin is driven first', () => {
    // Order mattered when the later write overwrote the earlier one.
    const a = contention(diagnose(runtimeFor(shorted), [[D12, 'output-high'], [D13, 'output-low']]));
    const b = contention(diagnose(runtimeFor(shorted), [[D13, 'output-low'], [D12, 'output-high']]));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('does not report contention when both outputs drive the same value', () => {
    expect(contention(diagnose(runtimeFor(shorted), [[D12, 'output-high'], [D13, 'output-high']]))).toEqual([]);
    expect(contention(diagnose(runtimeFor(shorted), [[D12, 'output-low'], [D13, 'output-low']]))).toEqual([]);
  });

  it('does not report contention when the opposing pin is an input', () => {
    // An input is high-impedance: it is not a driver, so there is no conflict to report.
    expect(contention(diagnose(runtimeFor(shorted), [[D12, 'output-high'], [D13, 'input']]))).toEqual([]);
  });

  it('does not report contention for an output against a pulled-up input', () => {
    // A 30k pull-up is not a fighting driver; treating it as one would flag ordinary
    // INPUT_PULLUP circuits.
    expect(contention(diagnose(runtimeFor(shorted), [[D12, 'output-low'], [D13, 'input-pullup']]))).toEqual([]);
  });

  it('does not report contention when the two pins are not wired together', () => {
    const found = contention(diagnose(runtimeFor(unconnected), [[D12, 'output-high'], [D13, 'output-low']]));
    expect(found).toEqual([]);
  });

  it('clears once the conflicting output is changed to match', () => {
    const runtime = runtimeFor(shorted);
    expect(contention(diagnose(runtime, [[D12, 'output-high'], [D13, 'output-low']]))).toHaveLength(1);

    // The student fixes the sketch: both pins now drive low.
    expect(contention(diagnose(runtime, [[D12, 'output-low']]))).toEqual([]);
  });

  it('clears once the conflicting pin is returned to input', () => {
    const runtime = runtimeFor(shorted);
    expect(contention(diagnose(runtime, [[D12, 'output-high'], [D13, 'output-low']]))).toHaveLength(1);

    expect(contention(diagnose(runtime, [[D12, 'input']]))).toEqual([]);
  });

  it('clears when the wire is removed and the circuit is recompiled', () => {
    // Deleting the wire rebuilds the netlist, which is how the app applies circuit edits.
    const before = contention(diagnose(runtimeFor(shorted), [[D12, 'output-high'], [D13, 'output-low']]));
    expect(before).toHaveLength(1);

    const after = contention(diagnose(runtimeFor(unconnected), [[D12, 'output-high'], [D13, 'output-low']]));
    expect(after).toEqual([]);
  });

  it('stays stable while the contention persists', () => {
    // A short must not diverge, NaN, or throw — the student needs to read the warning and
    // fix it while the simulation keeps running.
    const runtime = runtimeFor(shorted);
    diagnose(runtime, [[D12, 'output-high'], [D13, 'output-low']]);

    for (let cycle = 100; cycle < 2000; cycle += 100) {
      expect(() => runtime.settle(cycle)).not.toThrow();
    }

    // Still exactly one standing diagnostic, not a growing pile.
    runtime.onBoardPinDriverChange(D12.port, D12.bit, 'output-low', 3000);
    runtime.settle(3001);
    expect(contention(runtime.takeDiagnostics())).toEqual([]);
  });
});
