/**
 * A component lead plugged into a breadboard hole, as the compiler sees it.
 *
 * C5.1 gave the lead a way to be recorded and C5.2 a way to be judged; neither made it
 * electrically real. Until it is, a circuit carrying one compiles as though the part were
 * floating — not an incomplete answer but a wrong one, which is why this slice exists before
 * anything can author an attachment.
 *
 * Everything here goes through the real exported `compileNetlist`. Group membership, hole ids
 * and terminal ids are read from the canonical model and the trusted registry, never restated,
 * and no test reimplements union-find, grouping or validation — the point is to observe what
 * the shipped compiler does, not to re-derive it.
 *
 * Nothing in production can reach this path yet: nothing authors an attachment and the v2
 * writer strips the field. These tests are the only caller.
 */
import { describe, expect, it } from 'vitest';
import {
  breadboardGroupMemberships,
  createBreadboardModel,
  railGroupId,
  stripGroupId,
} from '@offline-arduino/contracts/breadboard';
import type { CircuitComponent, CircuitWire, ProjectCircuit } from '@offline-arduino/contracts/circuit';
import { compileNetlist, NETLIST_LIMITS } from '../src/netlist-compiler';
import { getComponentDefinition, terminalKey } from '../src/circuit-model/component-registry';
import { terminalCountFor } from '../src/circuit-model/terminal-budget';

const model = createBreadboardModel();
const holesOf = (groupId: string): string[] => model.groups.find((g) => g.id === groupId)!.holeIds;

/** Two holes of one A–E strip, and one hole of the F–J strip in the same column. */
const STRIP_AE = holesOf(stripGroupId(5, 'AE'));
const STRIP_FJ = holesOf(stripGroupId(5, 'FJ'));
const TOP_POSITIVE = holesOf(railGroupId('top', 'positive'));
const BOTTOM_NEGATIVE = holesOf(railGroupId('bottom', 'negative'));

const ANODE = getComponentDefinition('led')!.terminals[0].id;
const CATHODE = getComponentDefinition('led')!.terminals[1].id;
const RES_A = getComponentDefinition('resistor')!.terminals[0].id;

type Attachments = CircuitComponent['terminalAttachments'];
const plug = (breadboardId: string, holeId: string) =>
  ({ kind: 'breadboard-hole', breadboardId, holeId }) as const;

const uno = (id = 'uno1'): CircuitComponent =>
  ({ id, kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }) as CircuitComponent;
const breadboard = (id = 'bb1'): CircuitComponent =>
  ({ id, kind: 'breadboard', x: 300, y: 300, rotation: 0, label: 'Breadboard', properties: {} }) as CircuitComponent;
const led = (id: string, terminalAttachments?: Attachments): CircuitComponent =>
  ({ id, kind: 'led', x: 500, y: 200, rotation: 0, label: 'LED', properties: {}, ...(terminalAttachments ? { terminalAttachments } : {}) }) as CircuitComponent;
const resistor = (id: string, terminalAttachments?: Attachments): CircuitComponent =>
  ({ id, kind: 'resistor', x: 500, y: 400, rotation: 0, label: 'R', properties: {}, ...(terminalAttachments ? { terminalAttachments } : {}) }) as CircuitComponent;

const wire = (id: string, from: [string, string], to: [string, string]): CircuitWire =>
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

/** The net a terminal landed on, or undefined when it landed on none. */
const nodeOf = (result: ReturnType<typeof compileNetlist>, componentId: string, terminalId: string) =>
  result.nets.find((n) => n.terminals.includes(terminalKey(componentId, terminalId)))?.id;

const attachmentErrors = (result: ReturnType<typeof compileNetlist>) =>
  result.diagnostics.filter((d) => d.code === 'INVALID_ATTACHMENT');

describe('breadboard attachments in the netlist — valid connectivity', () => {
  it('leaves an attachment-free circuit byte-identical', () => {
    // The guard on everything else here: adding a third union site must not disturb a
    // circuit that has no attachments to union.
    const plain = circuit([uno(), breadboard(), led('led1')], [wire('w1', ['uno1', 'D13'], ['bb1', STRIP_AE[0]])]);
    const a = compileNetlist(plain);
    const b = compileNetlist(plain);
    expect(a.topologyHash).toBe(b.topologyHash);
    expect(JSON.stringify(a.nets)).toBe(JSON.stringify(b.nets));
    expect(a.diagnostics.filter((d) => d.code === 'INVALID_ATTACHMENT')).toEqual([]);
    expect(nodeOf(a, 'uno1', 'D13')).toBe(nodeOf(a, 'bb1', STRIP_AE[0]));
  });

  it('puts an attached lead on the hole’s net', () => {
    const result = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]) })]),
    );
    expect(attachmentErrors(result)).toEqual([]);
    expect(nodeOf(result, 'led1', ANODE)).toBe(nodeOf(result, 'bb1', STRIP_AE[0]));
  });

  it('gives a lead the same connectivity a jumper to that hole would', () => {
    const viaLead = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]) })], [
        wire('w1', ['uno1', 'D13'], ['bb1', STRIP_AE[2]]),
      ]),
    );
    const viaJumper = compileNetlist(
      circuit([uno(), breadboard(), led('led1')], [
        wire('w1', ['uno1', 'D13'], ['bb1', STRIP_AE[2]]),
        wire('w2', ['led1', ANODE], ['bb1', STRIP_AE[0]]),
      ]),
    );
    // Same strip, so in both circuits the LED and the Uno pin end up commoned.
    expect(nodeOf(viaLead, 'led1', ANODE)).toBe(nodeOf(viaLead, 'uno1', 'D13'));
    expect(nodeOf(viaJumper, 'led1', ANODE)).toBe(nodeOf(viaJumper, 'uno1', 'D13'));
  });

  it('commons two leads plugged into one strip', () => {
    const result = compileNetlist(
      circuit([
        uno(),
        breadboard(),
        led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]) }),
        resistor('r1', { [RES_A]: plug('bb1', STRIP_AE[3]) }),
      ]),
    );
    expect(attachmentErrors(result)).toEqual([]);
    expect(nodeOf(result, 'led1', ANODE)).toBe(nodeOf(result, 'r1', RES_A));
  });

  it('keeps the two banks either side of the centre gap separate', () => {
    const result = compileNetlist(
      circuit([
        uno(),
        breadboard(),
        led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]) }),
        resistor('r1', { [RES_A]: plug('bb1', STRIP_FJ[0]) }),
      ]),
    );
    expect(attachmentErrors(result)).toEqual([]);
    expect(nodeOf(result, 'led1', ANODE)).not.toBe(nodeOf(result, 'r1', RES_A));
  });

  it('joins a rail attachment to its whole run and to no other rail', () => {
    const result = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', TOP_POSITIVE[0]) })]),
    );
    const railNet = result.nets.find((n) => n.terminals.includes(terminalKey('led1', ANODE)))!;
    for (const holeId of TOP_POSITIVE) {
      expect(railNet.terminals).toContain(terminalKey('bb1', holeId));
    }
    expect(TOP_POSITIVE).toHaveLength(25);
    for (const holeId of BOTTOM_NEGATIVE) {
      expect(railNet.terminals).not.toContain(terminalKey('bb1', holeId));
    }
  });
});

describe('breadboard attachments in the netlist — invalid claims are reported, never wired', () => {
  it('refuses a target that is not a breadboard', () => {
    const result = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('led2', STRIP_AE[0]) }), led('led2')]),
    );
    expect(attachmentErrors(result)).toHaveLength(1);
    expect(attachmentErrors(result)[0].message).toContain('TARGET_NOT_A_BREADBOARD');
    expect(nodeOf(result, 'led1', ANODE)).not.toBe(nodeOf(result, 'led2', ANODE));
  });

  it('refuses a hole the board does not have', () => {
    const result = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', 'Z99') })]),
    );
    expect(attachmentErrors(result)).toHaveLength(1);
    expect(attachmentErrors(result)[0].message).toContain('TARGET_HOLE_UNKNOWN');
    // The LED keeps a net of its own; nothing was joined to the board.
    const anodeNet = result.nets.find((n) => n.terminals.includes(terminalKey('led1', ANODE)))!;
    expect(anodeNet.terminals).toEqual([terminalKey('led1', ANODE)]);
  });

  it('refuses a lead for a hole a wire already occupies', () => {
    const occupied = STRIP_AE[0];
    const result = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', occupied) })], [
        wire('w1', ['uno1', 'D13'], ['bb1', occupied]),
      ]),
    );
    expect(attachmentErrors(result)).toHaveLength(1);
    expect(attachmentErrors(result)[0].message).toContain('HOLE_TAKEN_BY_WIRE');
    // The wire still connects; only the rejected lead is left out.
    expect(nodeOf(result, 'uno1', 'D13')).toBe(nodeOf(result, 'bb1', occupied));
    expect(nodeOf(result, 'led1', ANODE)).not.toBe(nodeOf(result, 'bb1', occupied));
  });
});

describe('breadboard attachments in the netlist — determinism and accounting', () => {
  it('changes the topology hash, and is stable under reordering', () => {
    const without = compileNetlist(circuit([uno(), breadboard(), led('led1')]));
    const withLead = compileNetlist(
      circuit([uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]) })]),
    );
    expect(withLead.topologyHash).not.toBe(without.topologyHash);

    const components = [
      uno(),
      breadboard(),
      led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]), [CATHODE]: plug('bb1', STRIP_FJ[0]) }),
      resistor('r1', { [RES_A]: plug('bb1', STRIP_AE[1]) }),
    ];
    const wires = [wire('w1', ['uno1', 'D13'], ['bb1', STRIP_AE[4]]), wire('w2', ['uno1', 'GND'], ['bb1', STRIP_FJ[4]])];
    const forward = compileNetlist(circuit(components, wires));
    const shuffled = compileNetlist(circuit([...components].reverse(), [...wires].reverse()));
    expect(shuffled.topologyHash).toBe(forward.topologyHash);
    expect(JSON.stringify(shuffled.nets)).toBe(JSON.stringify(forward.nets));
  });

  it('does not change the terminal universe or the budget', () => {
    const components = [uno(), breadboard(), led('led1', { [ANODE]: plug('bb1', STRIP_AE[0]) })];
    const bare = [uno(), breadboard(), led('led1')];
    // An attachment is a connection, not a terminal: the count is identical either way.
    expect(terminalCountFor(components)).toBe(terminalCountFor(bare));

    const attached = compileNetlist(circuit(components));
    const plain = compileNetlist(circuit(bare));
    const terminalsOf = (r: ReturnType<typeof compileNetlist>) =>
      r.nets.flatMap((n) => n.terminals).sort();
    expect(terminalsOf(attached)).toEqual(terminalsOf(plain));
    expect(terminalsOf(attached).length).toBeLessThanOrEqual(NETLIST_LIMITS.maxTerminals);
    expect(attached.diagnostics.some((d) => d.code === 'TOO_MANY_TERMINALS')).toBe(false);
  });

  it('carries the validator issue kind and the offending identifiers into every diagnostic', () => {
    const result = compileNetlist(
      circuit([
        uno(),
        breadboard(),
        // Two bad leads on ONE component: both must survive as separate diagnostics.
        led('led1', { [ANODE]: plug('bb1', 'Z99'), [CATHODE]: plug('ghost', STRIP_AE[0]) }),
        resistor('r1', { nope: plug('bb1', STRIP_AE[0]) }),
      ]),
    );
    const errors = attachmentErrors(result);
    expect(errors).toHaveLength(3);
    expect(new Set(errors.map((d) => d.id)).size).toBe(3);
    expect(errors.every((d) => d.severity === 'error')).toBe(true);
    expect(errors.every((d) => d.componentIds?.length === 1)).toBe(true);

    const forAnode = errors.find((d) => d.message.includes(ANODE))!;
    expect(forAnode.message).toContain('led1');
    expect(forAnode.message).toContain('bb1');
    expect(forAnode.message).toContain('Z99');
    expect(forAnode.message).toContain('TARGET_HOLE_UNKNOWN');
    expect(errors.find((d) => d.message.includes('ghost'))!.message).toContain('TARGET_COMPONENT_MISSING');
    expect(errors.find((d) => d.message.includes('nope'))!.message).toContain('SOURCE_TERMINAL_UNKNOWN');
    // Nothing invalid was wired: the board's own group count is untouched by these claims.
    expect(breadboardGroupMemberships()).toHaveLength(model.groups.length);
    expect(nodeOf(result, 'r1', RES_A)).not.toBe(nodeOf(result, 'bb1', STRIP_AE[0]));
  });
});
