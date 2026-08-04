/**
 * The breadboard as the compiler sees it: 400 terminals, 64 groups, and nothing crossing the
 * centre gap.
 *
 * These go through `compileNetlist` rather than inspecting the registry's tables, because
 * what matters to a student is which points end up on the same electrical node — not how the
 * registry spelled it. The end-to-end test at the bottom is the one that would have caught a
 * wrong group: two ordinary component terminals, wired into two DIFFERENT holes of one
 * five-hole strip, must come out on one node without any wire joining them directly.
 *
 * Jumper wires only. Nothing here inserts a component lead into a hole — that is C5.
 */
import { describe, expect, it } from 'vitest';
import {
  createBreadboardModel,
  railGroupId,
  stripGroupId,
} from '@offline-arduino/contracts/breadboard';
import type { CircuitComponent, CircuitWire, ProjectCircuit } from '@offline-arduino/contracts/circuit';
import { compileNetlist, NETLIST_LIMITS } from '../src/netlist-compiler';
import { getComponentDefinition, terminalKey } from '../src/circuit-model/component-registry';
import {
  checkTerminalBudget,
  checkLoadedTerminalBudget,
  terminalCountFor,
  terminalCountForKind,
} from '../src/circuit-model/terminal-budget';

const model = createBreadboardModel();
const definition = getComponentDefinition('breadboard')!;

const uno = (id = 'uno1'): CircuitComponent =>
  ({ id, kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }) as CircuitComponent;
const breadboard = (id: string, x = 300, y = 300, rotation = 0): CircuitComponent =>
  ({ id, kind: 'breadboard', x, y, rotation, label: 'Breadboard', properties: {} }) as CircuitComponent;
const led = (id: string): CircuitComponent =>
  ({ id, kind: 'led', x: 500, y: 200, rotation: 0, label: 'LED', properties: {} }) as CircuitComponent;
const resistor = (id: string): CircuitComponent =>
  ({ id, kind: 'resistor', x: 500, y: 400, rotation: 0, label: 'R', properties: {} }) as CircuitComponent;

let wireSeq = 0;
const wire = (
  from: [string, string],
  to: [string, string],
  id = `w${(wireSeq += 1)}`,
): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

const circuit = (components: CircuitComponent[], wires: CircuitWire[] = []): ProjectCircuit => ({
  schemaVersion: 2,
  components,
  wires,
  junctions: [],
});

/** The net id a terminal ends up on, or undefined when the compile was fatal. */
function nodeOf(result: ReturnType<typeof compileNetlist>, componentId: string, terminalId: string) {
  const key = terminalKey(componentId, terminalId);
  return result.nets.find((n) => n.terminals.includes(key))?.id;
}

describe('9-13: the registry is derived from the canonical model', () => {
  it('registers exactly 400 terminals', () => {
    expect(definition.terminals).toHaveLength(400);
    expect(terminalCountForKind('breadboard')).toBe(400);
  });

  it('registers exactly the canonical hole ids', () => {
    expect(new Set(definition.terminals.map((t) => t.id))).toEqual(new Set(model.holes.map((h) => h.id)));
  });

  it('registers exactly 64 permanently common groups', () => {
    expect(definition.permanentlyCommonTerminals).toHaveLength(64);
    expect(definition.permanentlyCommonTerminals!.filter((g) => g.length === 5)).toHaveLength(60);
    expect(definition.permanentlyCommonTerminals!.filter((g) => g.length === 25)).toHaveLength(4);
  });

  it('registers memberships that match the canonical model exactly', () => {
    const registered = definition.permanentlyCommonTerminals!.map((g) => [...g].sort().join(','));
    const canonical = model.groups.map((g) => [...g.holeIds].sort().join(','));
    expect(new Set(registered)).toEqual(new Set(canonical));
  });

  it('places anchors at the canonical positions, converted not restated', () => {
    // Schematic units: 2.54 mm of pitch is exactly 10 units, so adjacent columns differ by 10.
    const a1 = definition.terminals.find((t) => t.id === 'A1')!;
    const a2 = definition.terminals.find((t) => t.id === 'A2')!;
    expect(a2.x - a1.x).toBeCloseTo(10, 9);
    const e15 = definition.terminals.find((t) => t.id === 'E15')!;
    const f15 = definition.terminals.find((t) => t.id === 'F15')!;
    expect(f15.y - e15.y).toBeCloseTo(30, 9); // three pitches across the centre gap
  });

  it('adds no runtime element — a breadboard is connectivity, not a part', () => {
    expect(definition.stamp({} as CircuitComponent, () => 'n')).toBeNull();
    const result = compileNetlist(circuit([uno(), breadboard('bb1')]));
    expect(result.elements.filter((e) => (e as { id?: string }).id === 'bb1')).toHaveLength(0);
  });
});

describe('31-33: what shares a node and what must not', () => {
  const result = compileNetlist(circuit([uno(), breadboard('bb1')]));

  it('puts all five holes of every strip on one node, for all 30 columns', () => {
    for (let column = 1; column <= 30; column += 1) {
      for (const [bank, rows] of [
        ['AE', ['A', 'B', 'C', 'D', 'E']],
        ['FJ', ['F', 'G', 'H', 'I', 'J']],
      ] as const) {
        const nodes = new Set(rows.map((r) => nodeOf(result, 'bb1', `${r}${column}`)));
        expect(`${stripGroupId(column, bank)} nodes=${nodes.size}`).toBe(`${stripGroupId(column, bank)} nodes=1`);
        expect([...nodes][0]).toBeDefined();
      }
    }
  });

  it('keeps the two sides of the centre gap on different nodes, for all 30 columns', () => {
    for (let column = 1; column <= 30; column += 1) {
      const ae = nodeOf(result, 'bb1', `A${column}`);
      const fj = nodeOf(result, 'bb1', `F${column}`);
      expect(`col${column}:${ae === fj}`).toBe(`col${column}:false`);
    }
  });

  it('keeps each rail continuous across all 25 of its holes', () => {
    for (const prefix of ['TP', 'TN', 'BP', 'BN']) {
      const nodes = new Set(
        Array.from({ length: 25 }, (_, i) => nodeOf(result, 'bb1', `${prefix}${i + 1}`)),
      );
      expect(`${prefix} nodes=${nodes.size}`).toBe(`${prefix} nodes=1`);
    }
  });

  it('keeps all four rails mutually isolated', () => {
    // Rails are taken from the canonical groups rather than named by hand, so this follows
    // the model if it ever changes rather than silently testing stale ids.
    const railIds = (['top', 'bottom'] as const).flatMap((side) =>
      (['positive', 'negative'] as const).map((polarity) => railGroupId(side, polarity)),
    );
    expect(railIds).toHaveLength(4);

    const nodes = railIds.map((groupId) => {
      const group = model.groups.find((g) => g.id === groupId)!;
      expect(group.holeIds).toHaveLength(25);
      return nodeOf(result, 'bb1', group.holeIds[0]);
    });
    expect(new Set(nodes).size).toBe(4);
    expect(nodes.every(Boolean)).toBe(true);
  });

  it('keeps rails isolated from the terminal strips', () => {
    expect(nodeOf(result, 'bb1', 'TP1')).not.toBe(nodeOf(result, 'bb1', 'A1'));
    expect(nodeOf(result, 'bb1', 'BN25')).not.toBe(nodeOf(result, 'bb1', 'J30'));
  });

  it('represents all 64 groups even when nothing is plugged in', () => {
    const groupNodes = new Set(model.holes.map((h) => nodeOf(result, 'bb1', h.id)));
    expect(groupNodes.size).toBe(64);
    expect(groupNodes.has(undefined)).toBe(false);
  });
});

describe('34: two breadboards are two breadboards', () => {
  const result = compileNetlist(circuit([uno(), breadboard('bb1'), breadboard('bb2', 600, 300)]));

  it('never joins the same hole id across separate instances', () => {
    for (const id of ['A1', 'E1', 'J30', 'TP1', 'BN25']) {
      expect(`${id}:${nodeOf(result, 'bb1', id) === nodeOf(result, 'bb2', id)}`).toBe(`${id}:false`);
    }
  });

  it('keeps the grouping inside each instance intact', () => {
    expect(nodeOf(result, 'bb2', 'A7')).toBe(nodeOf(result, 'bb2', 'E7'));
    expect(nodeOf(result, 'bb1', 'A7')).toBe(nodeOf(result, 'bb1', 'E7'));
  });
});

describe('35: determinism', () => {
  const components = [uno(), breadboard('bb1'), led('led1')];
  const wires = [wire(['uno1', 'D13'], ['bb1', 'A5'], 'wa'), wire(['bb1', 'E5'], ['led1', 'anode'], 'wb')];

  it('produces the same topology hash however the input is ordered', () => {
    const forward = compileNetlist(circuit([...components], [...wires]));
    const reversed = compileNetlist(circuit([...components].reverse(), [...wires].reverse()));
    expect(reversed.topologyHash).toBe(forward.topologyHash);
  });

  it('produces the same topology hash on repeated compilation', () => {
    expect(compileNetlist(circuit(components, wires)).topologyHash).toBe(
      compileNetlist(circuit(components, wires)).topologyHash,
    );
  });

  it('is unaffected by moving or quarter-turn rotating the board', () => {
    const base = compileNetlist(circuit([uno(), breadboard('bb1', 300, 300, 0), led('led1')], wires));
    for (const [x, y, rotation] of [[900, 40, 90], [12, 700, 180], [-400, -50, 270]] as const) {
      const moved = compileNetlist(circuit([uno(), breadboard('bb1', x, y, rotation), led('led1')], wires));
      expect(`${x},${y},${rotation}:${moved.topologyHash}`).toBe(`${x},${y},${rotation}:${base.topologyHash}`);
    }
  });
});

describe('36: end to end, through the board rather than around it', () => {
  // led1.anode -> A5, and E5 -> r1.a. Nothing wires the LED to the resistor directly; the
  // only thing joining them is the five-hole strip they are both plugged into.
  const components = [uno(), breadboard('bb1'), led('led1'), resistor('r1')];
  const wires = [wire(['led1', 'anode'], ['bb1', 'A5'], 'w_led'), wire(['bb1', 'E5'], ['r1', 'a'], 'w_res')];
  const result = compileNetlist(circuit(components, wires));

  it('compiles without a fatal diagnostic', () => {
    expect(result.diagnostics.filter((d) => d.severity === 'fatal')).toEqual([]);
  });

  it('lands both component terminals on one node via two different holes', () => {
    const anode = nodeOf(result, 'led1', 'anode');
    const resistorA = nodeOf(result, 'r1', 'a');
    expect(anode).toBeDefined();
    expect(anode).toBe(resistorA);
    expect(anode).toBe(nodeOf(result, 'bb1', 'C5'));
  });

  it('does not join them through a hole on the far side of the gap', () => {
    expect(nodeOf(result, 'led1', 'anode')).not.toBe(nodeOf(result, 'bb1', 'F5'));
  });

  it('breaks the connection when the jumper is deleted, and restores it when rebuilt', () => {
    const without = compileNetlist(circuit(components, [wires[0]]));
    expect(nodeOf(without, 'led1', 'anode')).not.toBe(nodeOf(without, 'r1', 'a'));

    const rebuilt = compileNetlist(circuit(components, [wires[0], wire(['bb1', 'E5'], ['r1', 'a'], 'w_res')]));
    expect(nodeOf(rebuilt, 'led1', 'anode')).toBe(nodeOf(rebuilt, 'r1', 'a'));
    expect(rebuilt.topologyHash).toBe(result.topologyHash);
  });

  it('is unchanged by recompiling — a reset rebuilds the same topology', () => {
    expect(compileNetlist(circuit(components, wires)).topologyHash).toBe(result.topologyHash);
  });
});

describe('37-38: the terminal budget', () => {
  it('counts exactly, using registered terminal counts', () => {
    expect(terminalCountForKind('uno-r3')).toBe(getComponentDefinition('uno-r3')!.terminals.length);
    expect(terminalCountFor([uno(), led('led1')])).toBe(
      terminalCountForKind('uno-r3') + terminalCountForKind('led'),
    );
    expect(terminalCountFor([uno(), breadboard('bb1')])).toBe(terminalCountForKind('uno-r3') + 400);
  });

  it('keeps the limit at 1500', () => {
    expect(NETLIST_LIMITS.maxTerminals).toBe(1500);
  });

  it('reports current, proposed and limit on a refusal', () => {
    const three = [uno(), breadboard('b1'), breadboard('b2'), breadboard('b3')];
    const verdict = checkTerminalBudget(three, 'breadboard');
    expect(verdict.withinLimit).toBe(false);
    expect(verdict.current).toBe(terminalCountFor(three));
    expect(verdict.proposed).toBe(verdict.current + 400);
    expect(verdict.limit).toBe(1500);
    expect(verdict.message).toContain(String(verdict.proposed));
    expect(verdict.message).toContain(String(verdict.current));
    expect(verdict.message).toContain('1500');
  });

  it('accepts a circuit that still fits', () => {
    const two = [uno(), breadboard('b1'), breadboard('b2')];
    const verdict = checkTerminalBudget(two, 'breadboard');
    expect(verdict.proposed).toBeLessThanOrEqual(1500);
    expect(verdict.withinLimit).toBe(true);
    expect(verdict.message).toBeNull();
  });

  it('refuses a loaded project that is already over the limit', () => {
    const over = [uno(), breadboard('b1'), breadboard('b2'), breadboard('b3'), breadboard('b4')];
    const verdict = checkLoadedTerminalBudget(over);
    expect(verdict.withinLimit).toBe(false);
    expect(verdict.message).toContain('1500');
    expect(checkLoadedTerminalBudget([uno(), breadboard('b1')]).withinLimit).toBe(true);
  });

  it('is refused by the compiler too, so the limit cannot be sidestepped', () => {
    const over = [uno(), breadboard('b1'), breadboard('b2'), breadboard('b3'), breadboard('b4')];
    const result = compileNetlist(circuit(over));
    expect(result.diagnostics.some((d) => d.code === 'TOO_MANY_TERMINALS' && d.severity === 'fatal')).toBe(true);
    expect(result.nets).toEqual([]);
  });
});

describe('schema versions the compiler accepts', () => {
  it('compiles both version 1 and version 2 circuits', () => {
    expect(compileNetlist({ ...circuit([uno()]), schemaVersion: 1 }).diagnostics.some((d) => d.code === 'SCHEMA_VERSION_UNSUPPORTED')).toBe(false);
    expect(compileNetlist(circuit([uno()])).diagnostics.some((d) => d.code === 'SCHEMA_VERSION_UNSUPPORTED')).toBe(false);
  });

  it('refuses an unknown version with an actionable message', () => {
    const result = compileNetlist({ ...circuit([uno()]), schemaVersion: 7 } as ProjectCircuit);
    const diagnostic = result.diagnostics.find((d) => d.code === 'SCHEMA_VERSION_UNSUPPORTED');
    expect(diagnostic?.severity).toBe('fatal');
    expect(diagnostic?.message).toContain('7');
    expect(result.nets).toEqual([]);
  });
});
