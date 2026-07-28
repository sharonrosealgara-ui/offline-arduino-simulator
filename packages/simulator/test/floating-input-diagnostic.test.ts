/**
 * FLOATING_INPUT diagnostic scoping.
 *
 * Every ATmega328P pin resets to INPUT with no pull-up, so a naive "input mode + floating
 * net" rule fires on every pin the sketch has not configured. On the Blink example that
 * produced 19 identical warnings, which buried real findings and made a correct circuit
 * look broken.
 *
 * The rule is now scoped to pins the student actually wired into the circuit.
 */
import { describe, expect, it } from 'vitest';
import { compileNetlist } from '../src/netlist-compiler';
import { CircuitRuntime } from '../src/circuit-runtime';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';

const noopBoard = { setDigitalInput: () => undefined, setAnalogVoltage: () => undefined };

/** Blink: D13 -> 220R -> LED -> GND. Every other header pin is unwired. */
const blink: ProjectCircuit = {
  schemaVersion: 1,
  components: [
    { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
    { id: 'r1', kind: 'resistor', x: 100, y: 0, rotation: 0, label: 'R', properties: { ohms: 220 } },
    { id: 'led1', kind: 'led', x: 200, y: 0, rotation: 0, label: 'LED', properties: { color: 'red' } },
  ],
  wires: [
    { id: 'w1', from: { componentId: 'uno1', terminalId: 'D13' }, to: { componentId: 'r1', terminalId: 'a' }, colorRole: 'signal-yellow', waypoints: [] },
    { id: 'w2', from: { componentId: 'r1', terminalId: 'b' }, to: { componentId: 'led1', terminalId: 'anode' }, colorRole: 'signal-yellow', waypoints: [] },
    { id: 'w3', from: { componentId: 'led1', terminalId: 'cathode' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
  ],
  junctions: [],
};

/** A pushbutton wired to D2 and ground, with no pull-up — a genuinely floating input. */
const buttonNoPullup: ProjectCircuit = {
  schemaVersion: 1,
  components: [
    { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
    { id: 'btn1', kind: 'pushbutton', x: 100, y: 0, rotation: 0, label: 'Button', properties: {} },
  ],
  wires: [
    { id: 'w1', from: { componentId: 'uno1', terminalId: 'D2' }, to: { componentId: 'btn1', terminalId: 'a1' }, colorRole: 'signal-yellow', waypoints: [] },
    { id: 'w2', from: { componentId: 'btn1', terminalId: 'b1' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
  ],
  junctions: [],
};

function settle(circuit: ProjectCircuit): CircuitRuntime {
  const runtime = new CircuitRuntime(compileNetlist(circuit), noopBoard);
  runtime.settle(0);
  return runtime;
}

function floatingWarnings(runtime: CircuitRuntime): string[] {
  return runtime
    .takeDiagnostics()
    .filter((d) => d.code === 'FLOATING_INPUT')
    .map((d) => d.id);
}

describe('FLOATING_INPUT', () => {
  it('does not warn about unwired header pins on a correct Blink circuit', () => {
    // Before the fix this produced one warning per unconfigured pin (19 of them).
    expect(floatingWarnings(settle(blink))).toEqual([]);
  });

  it('does not warn on a bare board with nothing wired at all', () => {
    const bare: ProjectCircuit = {
      schemaVersion: 1,
      components: [{ id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }],
      wires: [],
      junctions: [],
    };
    expect(floatingWarnings(settle(bare))).toEqual([]);
  });

  it('still warns when a wired input pin has no defined level', () => {
    // This is the case the diagnostic exists to catch, and it must survive the scoping.
    const warnings = floatingWarnings(settle(buttonNoPullup));
    expect(warnings).toContain('FLOATING_INPUT:D2');
  });

  it('reports at most one warning per pin', () => {
    const warnings = floatingWarnings(settle(buttonNoPullup));
    expect(new Set(warnings).size).toBe(warnings.length);
  });
});
