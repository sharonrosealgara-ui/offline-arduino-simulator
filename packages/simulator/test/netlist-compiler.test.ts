import { describe, expect, it } from 'vitest';
import { compileNetlist } from '../src/netlist-compiler';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';

function baseProject(overrides: Partial<ProjectCircuit> = {}): ProjectCircuit {
  return {
    schemaVersion: 1,
    components: [{ id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }],
    wires: [],
    junctions: [],
    ...overrides,
  };
}

describe('compileNetlist', () => {
  it('requires exactly one Uno', () => {
    const noUno = compileNetlist(baseProject({ components: [] }));
    expect(noUno.diagnostics.some((d) => d.code === 'UNO_COUNT_INVALID')).toBe(true);

    const twoUnos = compileNetlist(
      baseProject({
        components: [
          { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
          { id: 'uno2', kind: 'uno-r3', x: 10, y: 0, rotation: 0, label: 'Uno', properties: {} },
        ],
      }),
    );
    expect(twoUnos.diagnostics.some((d) => d.code === 'UNO_COUNT_INVALID')).toBe(true);
  });

  it('produces D0-D13 and A0-A5 board pin bindings for a bare Uno', () => {
    const netlist = compileNetlist(baseProject());
    const boardPins = netlist.boardPins.map((b) => b.boardPin).sort();
    const expected = [
      'D0', 'D1', 'D10', 'D11', 'D12', 'D13', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
      'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
    ].sort();
    expect(boardPins).toEqual(expected);
    const d13 = netlist.boardPins.find((b) => b.boardPin === 'D13')!;
    expect(d13.port).toBe('B');
    expect(d13.bit).toBe(5);
    const a0 = netlist.boardPins.find((b) => b.boardPin === 'A0')!;
    expect(a0.adcChannel).toBe(0);
  });

  it('does not connect wires that merely cross without a junction', () => {
    // Two independent resistors, each wired to the Uno, with no shared terminal/junction.
    const project = baseProject({
      components: [
        { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
        { id: 'r1', kind: 'resistor', x: 5, y: 5, rotation: 0, label: 'R1', properties: {} },
        { id: 'r2', kind: 'resistor', x: 15, y: 5, rotation: 0, label: 'R2', properties: {} },
      ],
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'D2' }, to: { componentId: 'r1', terminalId: 'a' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w2', from: { componentId: 'uno1', terminalId: 'D3' }, to: { componentId: 'r2', terminalId: 'a' }, colorRole: 'signal-blue', waypoints: [] },
      ],
    });
    const netlist = compileNetlist(project);
    const d2Net = netlist.boardPins.find((b) => b.boardPin === 'D2')!.netId;
    const d3Net = netlist.boardPins.find((b) => b.boardPin === 'D3')!.netId;
    expect(d2Net).not.toBe(d3Net);
  });

  it('merges nets via an explicit junction', () => {
    const project = baseProject({
      components: [
        { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
        { id: 'r1', kind: 'resistor', x: 5, y: 5, rotation: 0, label: 'R1', properties: {} },
        { id: 'r2', kind: 'resistor', x: 15, y: 5, rotation: 0, label: 'R2', properties: {} },
      ],
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'D2' }, to: { componentId: 'r1', terminalId: 'a' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w2', from: { componentId: 'r2', terminalId: 'a' }, to: { componentId: 'r1', terminalId: 'b' }, colorRole: 'signal-yellow', waypoints: [] },
      ],
      junctions: [{ id: 'j1', wireIds: ['w1', 'w2'], point: { x: 5, y: 5 } }],
    });
    const netlist = compileNetlist(project);
    const d2Net = netlist.boardPins.find((b) => b.boardPin === 'D2')!.netId;
    const r2aNet = netlist.nets.find((n) => n.terminals.includes('r2:a'))!.id;
    expect(d2Net).toBe(r2aNet);
  });

  it('is stable under component movement (topologyHash unchanged)', () => {
    const project = baseProject({
      components: [
        { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
        { id: 'led1', kind: 'led', x: 5, y: 5, rotation: 0, label: 'LED', properties: {} },
      ],
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'D13' }, to: { componentId: 'led1', terminalId: 'anode' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w2', from: { componentId: 'uno1', terminalId: 'GND' }, to: { componentId: 'led1', terminalId: 'cathode' }, colorRole: 'ground-black', waypoints: [] },
      ],
    });
    const a = compileNetlist(project);
    const moved: ProjectCircuit = {
      ...project,
      components: project.components.map((c) => (c.id === 'led1' ? { ...c, x: 999, y: 42 } : c)),
      wires: project.wires.map((w) => ({ ...w, waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }] })),
    };
    const b = compileNetlist(moved);
    expect(a.topologyHash).toBe(b.topologyHash);
  });

  it('flags a rail short as fatal before Run', () => {
    const project = baseProject({
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: '5V' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'vcc-red', waypoints: [] },
      ],
    });
    const netlist = compileNetlist(project);
    expect(netlist.diagnostics.some((d) => d.code === 'POWER_RAIL_SHORT' && d.severity === 'fatal')).toBe(true);
  });

  it('keeps GND electrically GND even when wired with a red wire, and warns', () => {
    // Wire color is a convention/hint only; connectivity must not change based on color.
    const project = baseProject({
      components: [
        { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
        { id: 'r1', kind: 'resistor', x: 5, y: 5, rotation: 0, label: 'R1', properties: {} },
      ],
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'GND' }, to: { componentId: 'r1', terminalId: 'a' }, colorRole: 'vcc-red', waypoints: [] },
      ],
    });
    const netlist = compileNetlist(project);
    const net = netlist.nets.find((n) => n.terminals.includes('r1:a'))!;
    expect(net.rail).toBe('GND');
    expect(netlist.diagnostics.some((d) => d.code === 'WIRE_COLOR_CONVENTION')).toBe(true);
  });
});
