/**
 * The dormant breadboard-attachment validator.
 *
 * Every valid terminal and hole below is read from the authoritative sources — the component
 * registry and the breadboard model — rather than typed out. A test that restates `'anode'`
 * or `'A1'` as a literal would keep passing after the real definition changed underneath it,
 * which is the failure this suite exists to prevent.
 *
 * `holesInSameGroup` is the renderer's helper (apps/desktop) and a package test must not reach
 * into the application, so same-group holes come from `breadboardGroupMemberships()` in
 * contracts — the generator that helper is itself derived from, so the two cannot disagree.
 *
 * Sentinel ids ('nope', 'Z99', 'ghost') appear only where the point is that they resolve to
 * nothing.
 */
import { describe, expect, it } from 'vitest';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { breadboardGroupMemberships, breadboardHoleIds } from '@offline-arduino/contracts/breadboard';
import { getComponentDefinition } from '../src/circuit-model/component-registry';
import {
  validateBreadboardAttachments,
  type AttachmentIssue,
} from '../src/circuit-model/breadboard-attachment';

// ---- authoritative fixtures -------------------------------------------------------------
const LED_TERMINALS = getComponentDefinition('led')!.terminals.map((t) => t.id);
const RESISTOR_TERMINALS = getComponentDefinition('resistor')!.terminals.map((t) => t.id);
const ANODE = LED_TERMINALS[0];
const CATHODE = LED_TERMINALS[1];
const RES_A = RESISTOR_TERMINALS[0];

const HOLES = breadboardHoleIds();
const HOLE_A = HOLES[0];
const HOLE_B = HOLES[1];
/** Two openings that are electrically common but physically distinct. */
const GROUP = breadboardGroupMemberships().find((g) => g.length >= 2)!;
const GROUP_1 = GROUP[0];
const GROUP_2 = GROUP[1];

type Attachments = CircuitComponent['terminalAttachments'];

const hole = (breadboardId: string, holeId: string) =>
  ({ kind: 'breadboard-hole', breadboardId, holeId }) as const;

const led = (id: string, terminalAttachments?: Attachments): CircuitComponent =>
  ({ id, kind: 'led', x: 0, y: 0, rotation: 0, label: id, properties: {}, ...(terminalAttachments ? { terminalAttachments } : {}) }) as CircuitComponent;

const resistor = (id: string, terminalAttachments?: Attachments): CircuitComponent =>
  ({ id, kind: 'resistor', x: 0, y: 0, rotation: 0, label: id, properties: {}, ...(terminalAttachments ? { terminalAttachments } : {}) }) as CircuitComponent;

const board = (id = 'bb1', terminalAttachments?: Attachments): CircuitComponent =>
  ({ id, kind: 'breadboard', x: 0, y: 0, rotation: 0, label: id, properties: {}, ...(terminalAttachments ? { terminalAttachments } : {}) }) as CircuitComponent;

const wire = (id: string, from: [string, string], to: [string, string]): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

const codes = (issues: readonly AttachmentIssue[]): string[] => issues.map((i) => i.code);

/** Every fixture whose attachments are semantically wrong, reused by the no-throw test. */
const invalidCircuits = (): { components: CircuitComponent[]; wires: CircuitWire[] }[] => [
  { components: [board(), led('led1', { nope: hole('bb1', HOLE_A) })], wires: [] },
  { components: [led('led1', { [ANODE]: hole('ghost', HOLE_A) })], wires: [] },
  { components: [led('led1', { [ANODE]: hole('led2', HOLE_A) }), led('led2')], wires: [] },
  { components: [board(), led('led1', { [ANODE]: hole('bb1', 'Z99') })], wires: [] },
  { components: [board('bb1', { [HOLE_A]: hole('bb1', HOLE_B) })], wires: [] },
  { components: [led('led1', { [ANODE]: hole('led1', HOLE_A) })], wires: [] },
  {
    components: [board(), led('led1', { [ANODE]: hole('bb1', HOLE_A) })],
    wires: [wire('w1', ['uno1', 'D13'], ['bb1', HOLE_A])],
  },
];

describe('validateBreadboardAttachments — valid circuits', () => {
  it('accepts an empty circuit', () => {
    const result = validateBreadboardAttachments({ components: [], wires: [] });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts components and wires carrying no attachments at all', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1'), resistor('r1')],
      wires: [wire('w1', ['led1', ANODE], ['bb1', HOLE_A])],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts one real LED terminal in one real hole', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', HOLE_A) })],
      wires: [],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe('validateBreadboardAttachments — referential failures', () => {
  it('rejects a terminal the component definition does not declare', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { nope: hole('bb1', HOLE_A) })],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['SOURCE_TERMINAL_UNKNOWN']);
    expect(result.ok).toBe(false);
  });

  it('rejects a target that is not in the circuit', () => {
    const result = validateBreadboardAttachments({
      components: [led('led1', { [ANODE]: hole('ghost', HOLE_A) })],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['TARGET_COMPONENT_MISSING']);
    expect(result.issues[0].breadboardId).toBe('ghost');
  });

  it('rejects a target that is not a breadboard', () => {
    const result = validateBreadboardAttachments({
      components: [led('led1', { [ANODE]: hole('led2', HOLE_A) }), led('led2')],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['TARGET_NOT_A_BREADBOARD']);
  });

  it('rejects a hole the board does not have', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', 'Z99') })],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['TARGET_HOLE_UNKNOWN']);
    expect(result.issues[0].holeId).toBe('Z99');
  });

  it('rejects a breadboard used as an attachment source', () => {
    // A board's holes exist so wires can land in them; the board has no lead of its own.
    const result = validateBreadboardAttachments({
      components: [board('bb1', { [HOLE_A]: hole('bb2', HOLE_B) }), board('bb2')],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['SOURCE_MAY_NOT_BE_BREADBOARD']);
  });

  it('rejects a component plugged into itself, and reports nothing else', () => {
    const result = validateBreadboardAttachments({
      components: [led('led1', { [ANODE]: hole('led1', HOLE_A) })],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['SELF_ATTACHMENT']);
    expect(result.issues).toHaveLength(1);
  });
});

describe('validateBreadboardAttachments — physical occupancy', () => {
  it('reports the later of two leads claiming one opening', () => {
    const result = validateBreadboardAttachments({
      components: [
        board(),
        led('led1', { [ANODE]: hole('bb1', HOLE_A) }),
        resistor('r1', { [RES_A]: hole('bb1', HOLE_A) }),
      ],
      wires: [],
    });
    expect(codes(result.issues)).toEqual(['HOLE_TAKEN_BY_LEAD']);
    // 'led1' sorts before 'r1', so the LED is canonical and the resistor is reported.
    expect(result.issues[0].componentId).toBe('r1');
    expect(result.issues[0].conflictsWith).toEqual({ kind: 'lead', componentId: 'led1', terminalId: ANODE });
  });

  it("reports a lead conflicting with a wire's from endpoint", () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', HOLE_A) })],
      wires: [wire('w1', ['bb1', HOLE_A], ['led2', CATHODE])],
    });
    expect(codes(result.issues)).toEqual(['HOLE_TAKEN_BY_WIRE']);
    expect(result.issues[0].conflictsWith).toEqual({ kind: 'wire', wireId: 'w1' });
  });

  it("reports a lead conflicting with a wire's to endpoint", () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', HOLE_A) })],
      wires: [wire('w1', ['led2', CATHODE], ['bb1', HOLE_A])],
    });
    expect(codes(result.issues)).toEqual(['HOLE_TAKEN_BY_WIRE']);
    expect(result.issues[0].conflictsWith).toEqual({ kind: 'wire', wireId: 'w1' });
  });

  it('reports one issue per distinct wire in the opening, in sorted order', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', HOLE_A) })],
      wires: [wire('w2', ['bb1', HOLE_A], ['led2', ANODE]), wire('w1', ['bb1', HOLE_A], ['led3', ANODE])],
    });
    expect(codes(result.issues)).toEqual(['HOLE_TAKEN_BY_WIRE', 'HOLE_TAKEN_BY_WIRE']);
    expect(result.issues.map((i) => (i.conflictsWith?.kind === 'wire' ? i.conflictsWith.wireId : null))).toEqual(['w1', 'w2']);
  });

  it('counts one wire referencing the opening through both endpoints only once', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', HOLE_A) })],
      wires: [wire('w1', ['bb1', HOLE_A], ['bb1', HOLE_A])],
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].conflictsWith).toEqual({ kind: 'wire', wireId: 'w1' });
  });

  it('accepts a lead and a wire in electrically common but physically different holes', () => {
    const result = validateBreadboardAttachments({
      components: [board(), led('led1', { [ANODE]: hole('bb1', GROUP_1) })],
      wires: [wire('w1', ['bb1', GROUP_2], ['led2', ANODE])],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts two leads in different holes of one electrical group', () => {
    const result = validateBreadboardAttachments({
      components: [
        board(),
        led('led1', { [ANODE]: hole('bb1', GROUP_1) }),
        resistor('r1', { [RES_A]: hole('bb1', GROUP_2) }),
      ],
      wires: [],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe('validateBreadboardAttachments — determinism and purity', () => {
  it('suppresses issues that depend on an already-failed lookup', () => {
    const result = validateBreadboardAttachments({
      components: [
        board(),
        led('led1', { [ANODE]: hole('ghost', 'Z99') }),
        resistor('r1', { nope: hole('bb1', 'Z99') }),
        led('led2', { [ANODE]: hole('led3', 'Z99') }),
        led('led3'),
      ],
      // A wire sits in the hole all three would have claimed; none may report occupancy,
      // because none of them got far enough to claim it.
      wires: [wire('w1', ['bb1', HOLE_A], ['led3', CATHODE])],
    });
    expect(codes(result.issues)).toEqual([
      'TARGET_COMPONENT_MISSING',
      'TARGET_NOT_A_BREADBOARD',
      'SOURCE_TERMINAL_UNKNOWN',
    ]);
    expect(result.issues.every((i) => i.conflictsWith === undefined)).toBe(true);
  });

  it('returns a byte-equivalent issue array when the input is shuffled', () => {
    const components = [
      board(),
      led('led1', { [ANODE]: hole('bb1', HOLE_A) }),
      resistor('r1', { [RES_A]: hole('bb1', HOLE_A) }),
      led('led2', { [ANODE]: hole('bb1', 'Z99') }),
    ];
    const wires = [wire('w2', ['bb1', HOLE_A], ['led3', ANODE]), wire('w1', ['bb1', HOLE_A], ['led4', ANODE])];

    const forward = validateBreadboardAttachments({ components, wires });
    const reversed = validateBreadboardAttachments({
      components: [...components].reverse(),
      wires: [...wires].reverse(),
    });
    expect(JSON.stringify(reversed.issues)).toBe(JSON.stringify(forward.issues));
    expect(forward.issues.length).toBeGreaterThan(1);
  });

  it('leaves the entire input unmodified', () => {
    const circuit = {
      components: [
        board(),
        led('led1', { [ANODE]: hole('bb1', HOLE_A) }),
        resistor('r1', { [RES_A]: hole('bb1', HOLE_A), nope: hole('bb1', 'Z99') }),
      ],
      wires: [wire('w1', ['bb1', HOLE_A], ['led2', ANODE])],
    };
    const before = JSON.parse(JSON.stringify(circuit));
    validateBreadboardAttachments(circuit);
    expect(JSON.parse(JSON.stringify(circuit))).toEqual(before);
  });

  it('reports every semantically invalid fixture without ever throwing', () => {
    for (const circuit of invalidCircuits()) {
      const result = validateBreadboardAttachments(circuit);
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
