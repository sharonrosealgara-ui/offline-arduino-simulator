import { describe, expect, it } from 'vitest';
import { compileNetlist } from '../src/netlist-compiler';
import { CircuitRuntime } from '../src/circuit-runtime';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';

const bareUno: ProjectCircuit = {
  schemaVersion: 1,
  components: [{ id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }],
  wires: [],
  junctions: [],
};

function makeRuntime(): CircuitRuntime {
  const netlist = compileNetlist(bareUno);
  return new CircuitRuntime(netlist, { setDigitalInput: () => undefined, setAnalogVoltage: () => undefined });
}

/** Drive D13 (PB5) to a level at a cycle and settle. */
function driveD13(rt: CircuitRuntime, level: 'output-high' | 'output-low', cycle: number): void {
  rt.onBoardPinDriverChange('B', 5, level, cycle);
  rt.settle(cycle);
}

describe('CircuitRuntime cycle-accurate edge capture', () => {
  it('records transitions at their exact cycle, ordered, with correct level', () => {
    const rt = makeRuntime();
    // Ensure initial settle at cycle 0 to clear 'X' states.
    rt.settle(0);
    rt.takeDisplayDelta(); // clear initial edges

    driveD13(rt, 'output-high', 100);
    driveD13(rt, 'output-low', 200);
    driveD13(rt, 'output-high', 350);
    const d13 = rt.takeDisplayDelta().pinEdges.filter((e) => e.boardPin === 'D13');
    expect(d13.map((e) => e.cycle)).toEqual([100, 200, 350]);
    expect(d13.map((e) => e.logic)).toEqual([1, 0, 1]);
  });

  it('deduplicates same-level events (no edge when the level is unchanged)', () => {
    const rt = makeRuntime();
    rt.settle(0);
    rt.takeDisplayDelta();

    driveD13(rt, 'output-high', 100);
    driveD13(rt, 'output-high', 150); // same level → no new edge
    const d13 = rt.takeDisplayDelta().pinEdges.filter((e) => e.boardPin === 'D13');
    expect(d13).toHaveLength(1);
    expect(d13[0].cycle).toBe(100);
  });

  it('drains exactly once: a second take yields no repeated edges', () => {
    const rt = makeRuntime();
    rt.settle(0);
    rt.takeDisplayDelta();

    driveD13(rt, 'output-high', 100);
    driveD13(rt, 'output-low', 200);
    const first = rt.takeDisplayDelta().pinEdges.filter((e) => e.boardPin === 'D13');
    expect(first).toHaveLength(2);
    driveD13(rt, 'output-high', 300);
    const second = rt.takeDisplayDelta().pinEdges.filter((e) => e.boardPin === 'D13');
    expect(second.map((e) => e.cycle)).toEqual([300]); // only the new edge
  });

  it('accumulates across settles until drained (survives skipped frames)', () => {
    const rt = makeRuntime();
    rt.settle(0);
    rt.takeDisplayDelta();

    driveD13(rt, 'output-high', 100);
    driveD13(rt, 'output-low', 200);
    driveD13(rt, 'output-high', 300);
    // No takeDisplayDelta between drives → all three must be present in one drain.
    const d13 = rt.takeDisplayDelta().pinEdges.filter((e) => e.boardPin === 'D13');
    expect(d13.map((e) => e.cycle)).toEqual([100, 200, 300]);
  });

  it('bounded capture: stops recording and flags overflow at the edge budget', () => {
    const rt = makeRuntime();
    rt.settle(0);
    rt.takeDisplayDelta();

    rt.setLogicCaptureConfig(true, 2);
    driveD13(rt, 'output-high', 100);
    driveD13(rt, 'output-low', 200);
    driveD13(rt, 'output-high', 300); // exceeds budget → dropped + overflow
    const delta = rt.takeDisplayDelta();
    const d13 = delta.pinEdges.filter((e) => e.boardPin === 'D13');
    expect(d13).toHaveLength(2);
    expect(delta.pinEdgeOverflow).toBe(true);
  });

  it('does not record when capture is disabled', () => {
    const rt = makeRuntime();
    rt.settle(0);
    rt.takeDisplayDelta();

    rt.setLogicCaptureConfig(false, 200_000);
    driveD13(rt, 'output-high', 100);
    driveD13(rt, 'output-low', 200);
    const d13 = rt.takeDisplayDelta().pinEdges.filter((e) => e.boardPin === 'D13');
    expect(d13).toHaveLength(0);
  });
});
