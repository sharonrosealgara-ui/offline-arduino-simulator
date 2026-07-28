/**
 * Project save → reopen round-trip.
 *
 * This is demo steps 13–15: build a circuit, snapshot it the way Save does, validate it
 * against the real on-disk schema, then load it back the way Open does and assert nothing
 * was lost. Exercises the actual `projectFileSchema` and the actual store bridge, so a
 * change that breaks persistence fails here rather than in front of a client.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { projectFileSchema } from '../src/main/projects/project-schema';
import { loadProjectIntoStore, snapshotProject } from '../src/renderer/app/project-bridge';
import { useAppStore } from '../src/renderer/state/store';

const BOARD = {
  id: 'uno1',
  kind: 'uno-r3' as const,
  x: 60,
  y: 60,
  rotation: 0 as const,
  label: 'Arduino Uno',
  properties: {},
};

const BLINK = `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`;

function resetStore(): void {
  useAppStore.setState((s) => ({
    project: { ...s.project, projectId: 'draft', name: 'Untitled Sketch', sketch: '', dirty: false },
    circuit: {
      components: [BOARD],
      wires: [],
      junctions: [],
      selectedIds: [],
      pendingWireFrom: null,
      placementKind: null,
    },
    history: { past: [], future: [] },
  }));
}

/** Builds the demo circuit: D13 → 220 Ω → LED → GND. */
function buildDemoCircuit(): void {
  const actions = useAppStore.getState().actions;
  const resistor = actions.addComponent('resistor', 470, 300);
  const led = actions.addComponent('led', 600, 300);

  actions.pickTerminal({ componentId: 'uno1', terminalId: 'D13' }, 'signal-yellow');
  actions.pickTerminal({ componentId: resistor, terminalId: 'a' }, 'signal-yellow');
  actions.pickTerminal({ componentId: resistor, terminalId: 'b' }, 'signal-yellow');
  actions.pickTerminal({ componentId: led, terminalId: 'anode' }, 'signal-yellow');
  actions.pickTerminal({ componentId: led, terminalId: 'cathode' }, 'ground-black');
  actions.pickTerminal({ componentId: 'uno1', terminalId: 'GND' }, 'ground-black');

  actions.setSketch(BLINK);
}

beforeEach(resetStore);

describe('save → reopen', () => {
  it('produces a snapshot the on-disk schema accepts', () => {
    buildDemoCircuit();
    const snapshot = snapshotProject();

    expect(() => projectFileSchema.parse(snapshot)).not.toThrow();
  });

  it('preserves the sketch and the full circuit across a serialize/parse cycle', () => {
    buildDemoCircuit();

    const before = useAppStore.getState();
    const beforeComponents = before.circuit.components;
    const beforeWires = before.circuit.wires;
    expect(beforeComponents).toHaveLength(3);
    expect(beforeWires).toHaveLength(3);

    // Exactly what Save writes and Open reads: JSON on disk, validated both ways.
    const written = JSON.stringify(projectFileSchema.parse(snapshotProject()), null, 2);
    resetStore();
    expect(useAppStore.getState().circuit.components).toHaveLength(1);

    const reopened = projectFileSchema.parse(JSON.parse(written));
    loadProjectIntoStore(reopened);

    const after = useAppStore.getState();
    expect(after.project.sketch).toBe(BLINK);
    expect(after.circuit.components).toEqual(beforeComponents);
    expect(after.circuit.wires).toEqual(beforeWires);
  });

  it('preserves edited component properties', () => {
    const actions = useAppStore.getState().actions;
    const resistor = actions.addComponent('resistor', 100, 100);
    actions.setComponentProperty(resistor, 'ohms', 1000);
    actions.setComponentLabel(resistor, 'Series R');

    const written = JSON.stringify(projectFileSchema.parse(snapshotProject()));
    resetStore();
    loadProjectIntoStore(projectFileSchema.parse(JSON.parse(written)));

    const restored = useAppStore.getState().circuit.components.find((c) => c.id === resistor);
    expect(restored?.properties.ohms).toBe(1000);
    expect(restored?.label).toBe('Series R');
  });

  it('preserves component rotation', () => {
    const actions = useAppStore.getState().actions;
    const led = actions.addComponent('led', 100, 100);
    actions.rotateComponent(led);
    actions.rotateComponent(led);

    const written = JSON.stringify(projectFileSchema.parse(snapshotProject()));
    resetStore();
    loadProjectIntoStore(projectFileSchema.parse(JSON.parse(written)));

    expect(useAppStore.getState().circuit.components.find((c) => c.id === led)?.rotation).toBe(180);
  });

  it('lands a reopened project in a clean, non-dirty state', () => {
    buildDemoCircuit();
    expect(useAppStore.getState().project.dirty).toBe(true);

    const written = JSON.stringify(projectFileSchema.parse(snapshotProject()));
    loadProjectIntoStore(projectFileSchema.parse(JSON.parse(written)));

    expect(useAppStore.getState().project.dirty).toBe(false);
  });

  it('assigns a real project id when saving a draft', () => {
    expect(useAppStore.getState().project.projectId).toBe('draft');
    const snapshot = snapshotProject();
    expect(snapshot.projectId).not.toBe('draft');
    expect(snapshot.projectId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('the saved circuit still compiles to a netlist', () => {
  it('round-trips into something compileNetlist accepts', async () => {
    buildDemoCircuit();
    const written = JSON.stringify(projectFileSchema.parse(snapshotProject()));
    resetStore();
    loadProjectIntoStore(projectFileSchema.parse(JSON.parse(written)));

    const { compileNetlist } = await import('@offline-arduino/simulator');
    const state = useAppStore.getState();
    const netlist = compileNetlist({
      schemaVersion: 1,
      components: state.circuit.components,
      wires: state.circuit.wires,
      junctions: state.circuit.junctions,
    });

    // A reopened project must be runnable, not merely loadable.
    expect(netlist.diagnostics.filter((d) => d.severity === 'fatal')).toEqual([]);
    expect(netlist.nets.length).toBeGreaterThan(0);
  });
});
