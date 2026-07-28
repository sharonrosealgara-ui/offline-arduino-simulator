/**
 * Circuit authoring actions: placement, movement, rotation, deletion, wiring, undo/redo.
 *
 * These cover the behaviours the client demo depends on (add an LED and resistor, wire
 * them, undo a mistake) plus the invariants that keep the netlist compilable — notably
 * that deleting a component cannot leave a wire dangling on a terminal that no longer
 * exists, and that the board itself is never removable.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/state/store';

const BOARD = { id: 'uno1', kind: 'uno-r3' as const, x: 60, y: 60, rotation: 0 as const, label: 'Arduino Uno', properties: {} };

function reset(): void {
  useAppStore.setState({
    circuit: {
      components: [BOARD],
      wires: [],
      junctions: [],
      selectedIds: [],
      pendingWireFrom: null,
      placementKind: null,
    },
    history: { past: [], future: [] },
  });
  useAppStore.setState((s) => ({ project: { ...s.project, dirty: false } }));
}

const actions = () => useAppStore.getState().actions;
const circuit = () => useAppStore.getState().circuit;

beforeEach(reset);

describe('component placement', () => {
  it('adds a component with catalog defaults and selects it', () => {
    const id = actions().addComponent('resistor', 200, 300);

    const component = circuit().components.find((c) => c.id === id);
    expect(component).toBeDefined();
    expect(component?.kind).toBe('resistor');
    expect(component?.properties.ohms).toBe(220);
    expect(circuit().selectedIds).toEqual([id]);
  });

  it('snaps placement to the authoring grid', () => {
    const id = actions().addComponent('led', 203, 297);
    const component = circuit().components.find((c) => c.id === id);
    expect(component?.x).toBe(205);
    expect(component?.y).toBe(295);
  });

  it('generates unique, readable ids and de-duplicated labels', () => {
    const first = actions().addComponent('led', 100, 100);
    const second = actions().addComponent('led', 150, 100);

    expect(first).toBe('led-1');
    expect(second).toBe('led-2');
    expect(circuit().components.find((c) => c.id === second)?.label).toBe('LED 2');
  });

  it('clears the armed placement kind after placing', () => {
    actions().armPlacement('led');
    expect(circuit().placementKind).toBe('led');
    actions().addComponent('led', 100, 100);
    expect(circuit().placementKind).toBeNull();
  });

  it('marks the project dirty', () => {
    expect(useAppStore.getState().project.dirty).toBe(false);
    actions().addComponent('led', 100, 100);
    expect(useAppStore.getState().project.dirty).toBe(true);
  });
});

describe('rotation', () => {
  it('advances in quarter turns and wraps at 360', () => {
    const id = actions().addComponent('led', 100, 100);
    const rotation = (): number => circuit().components.find((c) => c.id === id)!.rotation;

    actions().rotateComponent(id);
    expect(rotation()).toBe(90);
    actions().rotateComponent(id);
    actions().rotateComponent(id);
    expect(rotation()).toBe(270);
    actions().rotateComponent(id);
    expect(rotation()).toBe(0);
  });
});

describe('wiring', () => {
  it('requires two picks to create a wire', () => {
    const led = actions().addComponent('led', 200, 200);

    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    expect(circuit().wires).toHaveLength(0);
    expect(circuit().pendingWireFrom).toEqual({ componentId: 'uno1', terminalId: 'D13' });

    actions().pickTerminal({ componentId: led, terminalId: 'anode' });
    expect(circuit().wires).toHaveLength(1);
    expect(circuit().pendingWireFrom).toBeNull();
  });

  it('cancels when the same terminal is picked twice', () => {
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });

    expect(circuit().wires).toHaveLength(0);
    expect(circuit().pendingWireFrom).toBeNull();
  });

  it('refuses a duplicate wire between the same two terminals, in either direction', () => {
    const led = actions().addComponent('led', 200, 200);

    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    actions().pickTerminal({ componentId: led, terminalId: 'anode' });
    expect(circuit().wires).toHaveLength(1);

    // Same pair, reversed order.
    actions().pickTerminal({ componentId: led, terminalId: 'anode' });
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    expect(circuit().wires).toHaveLength(1);
  });

  it('carries the colour role through to the created wire', () => {
    const led = actions().addComponent('led', 200, 200);
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'GND' }, 'ground-black');
    actions().pickTerminal({ componentId: led, terminalId: 'cathode' }, 'ground-black');

    expect(circuit().wires[0]?.colorRole).toBe('ground-black');
  });

  it('arming a placement cancels an in-progress wire', () => {
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    actions().armPlacement('resistor');
    expect(circuit().pendingWireFrom).toBeNull();
  });
});

describe('deletion', () => {
  it('removes every wire attached to a deleted component', () => {
    const led = actions().addComponent('led', 200, 200);
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    actions().pickTerminal({ componentId: led, terminalId: 'anode' });
    actions().pickTerminal({ componentId: led, terminalId: 'cathode' });
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'GND' });
    expect(circuit().wires).toHaveLength(2);

    actions().deleteComponents([led]);

    expect(circuit().components.map((c) => c.id)).toEqual(['uno1']);
    // A wire referencing a terminal that no longer exists would break netlist compilation.
    expect(circuit().wires).toHaveLength(0);
  });

  it('never deletes the board', () => {
    actions().deleteComponents(['uno1']);
    expect(circuit().components.map((c) => c.id)).toContain('uno1');
  });

  it('deletes wires on their own without touching components', () => {
    const led = actions().addComponent('led', 200, 200);
    actions().pickTerminal({ componentId: 'uno1', terminalId: 'D13' });
    actions().pickTerminal({ componentId: led, terminalId: 'anode' });
    const wireId = circuit().wires[0]!.id;

    actions().deleteWires([wireId]);

    expect(circuit().wires).toHaveLength(0);
    expect(circuit().components).toHaveLength(2);
  });
});

describe('undo and redo', () => {
  it('reverses a placement and replays it', () => {
    actions().addComponent('led', 100, 100);
    expect(circuit().components).toHaveLength(2);

    actions().undo();
    expect(circuit().components).toHaveLength(1);

    actions().redo();
    expect(circuit().components).toHaveLength(2);
  });

  it('collapses one drag into a single undo step', () => {
    const id = actions().addComponent('led', 100, 100);

    // First move of a drag is the undoable one; the rest coalesce into it.
    actions().moveComponent(id, 150, 100, { coalesce: false });
    actions().moveComponent(id, 200, 100, { coalesce: true });
    actions().moveComponent(id, 250, 100, { coalesce: true });
    expect(circuit().components.find((c) => c.id === id)?.x).toBe(250);

    actions().undo();
    expect(circuit().components.find((c) => c.id === id)?.x).toBe(100);
  });

  it('clears the redo stack once a new edit is made', () => {
    actions().addComponent('led', 100, 100);
    actions().undo();
    expect(useAppStore.getState().history.future).toHaveLength(1);

    actions().addComponent('resistor', 200, 200);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });

  it('drops selection ids that undo removed', () => {
    const id = actions().addComponent('led', 100, 100);
    expect(circuit().selectedIds).toEqual([id]);

    actions().undo();
    expect(circuit().selectedIds).toEqual([]);
  });

  it('is a no-op at the ends of the history', () => {
    expect(() => actions().undo()).not.toThrow();
    expect(() => actions().redo()).not.toThrow();
    expect(circuit().components).toHaveLength(1);
  });

  it('does not step back into a previous project after loading one', () => {
    actions().addComponent('led', 100, 100);
    expect(useAppStore.getState().history.past.length).toBeGreaterThan(0);

    actions().setCircuit([BOARD], [], []);

    expect(useAppStore.getState().history.past).toHaveLength(0);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });
});

describe('property editing', () => {
  it('writes through to the component the netlist compiler reads', () => {
    const id = actions().addComponent('resistor', 100, 100);
    actions().setComponentProperty(id, 'ohms', 1000);
    expect(circuit().components.find((c) => c.id === id)?.properties.ohms).toBe(1000);
  });

  it('renames a component', () => {
    const id = actions().addComponent('led', 100, 100);
    actions().setComponentLabel(id, 'Status LED');
    expect(circuit().components.find((c) => c.id === id)?.label).toBe('Status LED');
  });
});
