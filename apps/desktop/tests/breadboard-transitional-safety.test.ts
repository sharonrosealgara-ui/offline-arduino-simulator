// @vitest-environment jsdom
/**
 * A breadboard cannot get into the workspace yet, and cannot get in by the back door either.
 *
 * The schema deliberately accepts one — the format is frozen and correct. What does not
 * exist is any way to SEE a breadboard: C2 has not built the 2D rendering or interaction and
 * C3 has not built the 3D geometry. So a loaded breadboard would be an invisible component
 * that changes a circuit's electrical behaviour, which is worse than a refusal.
 *
 * "It is not in the catalog" is not a proof, which is why these tests go at the load
 * boundary as well: a hand-written or imported v2 file is a real route into application
 * state and has to be refused there, before anything is replaced.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { COMPONENT_CATALOG, catalogEntry } from '../src/renderer/app/circuit/component-catalog';
import { canLoadProject } from '../src/renderer/app/project-load-guard';
import { loadProjectIntoStore } from '../src/renderer/app/project-bridge';
import { useAppStore } from '../src/renderer/state/store';
import type { ProjectFileDTO } from '../src/preload/electron-api-types';

const SENTINEL = { id: 'uno1', kind: 'uno-r3', x: 60, y: 60, rotation: 0, label: 'Arduino Uno', properties: {} };

function project(components: unknown[], schemaVersion: 1 | 2 = 2): ProjectFileDTO {
  return {
    schemaVersion,
    projectId: 'p-1',
    name: 'Imported',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    boardId: 'uno',
    sources: { 'Sketch.ino': '// imported\n' },
    circuit: { schemaVersion, components, wires: [], junctions: [] },
  } as ProjectFileDTO;
}

const breadboard = { id: 'bb1', kind: 'breadboard', x: 300, y: 300, rotation: 0, label: 'Breadboard', properties: {} };
const led = { id: 'led1', kind: 'led', x: 200, y: 160, rotation: 0, label: 'LED', properties: {} };

/** A recognisable workspace, so "nothing was mutated" is checkable rather than assumed. */
function seedWorkspace(): void {
  useAppStore.setState((s) => ({
    project: { ...s.project, name: 'Existing', sketch: 'void setup() {}\n', projectId: 'existing' },
    circuit: { ...s.circuit, components: [SENTINEL] as never, wires: [], junctions: [], selectedIds: ['uno1'] },
  }));
}

beforeEach(seedWorkspace);

describe('the breadboard is not offered to students yet', () => {
  it('is absent from the component catalog', () => {
    expect(COMPONENT_CATALOG.some((e) => e.kind === 'breadboard')).toBe(false);
    expect(catalogEntry('breadboard')).toBeUndefined();
  });

  it('leaves every other placeable catalog entry in place', () => {
    // The Uno is not in the library — it is always present rather than placed — so it is
    // deliberately absent from this list.
    for (const kind of ['led', 'resistor', 'pushbutton', 'potentiometer', 'lcd1602', 'servo'] as const) {
      expect(`${kind}:${Boolean(catalogEntry(kind))}`).toBe(`${kind}:true`);
    }
  });

  it('cannot be armed for placement through the normal authoring path', () => {
    // The library UI can only arm a kind it can render from the catalog, and there is no
    // entry to click. This asserts the gap the UI depends on.
    const kinds = COMPONENT_CATALOG.map((e) => e.kind);
    expect(kinds).not.toContain('breadboard');
  });
});

describe('importing a project containing a breadboard', () => {
  it('is refused, with a reason that says when it will work', () => {
    const verdict = canLoadProject(project([SENTINEL, breadboard]));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/breadboard/i);
    expect(verdict.reason).toMatch(/next update|cannot display/i);
    expect(verdict.reason).toMatch(/not been changed/i);
  });

  it('counts them, so the message is true for more than one', () => {
    const verdict = canLoadProject(project([SENTINEL, breadboard, { ...breadboard, id: 'bb2' }]));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('2 breadboards');
  });

  it('leaves the workspace completely untouched', () => {
    const before = JSON.stringify(useAppStore.getState().circuit);
    const beforeProject = JSON.stringify(useAppStore.getState().project);

    const result = loadProjectIntoStore(project([SENTINEL, breadboard]));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(useAppStore.getState().circuit)).toBe(before);
    expect(JSON.stringify(useAppStore.getState().project)).toBe(beforeProject);
  });

  it('leaves no partial component behind', () => {
    loadProjectIntoStore(project([SENTINEL, breadboard, led]));
    const components = useAppStore.getState().circuit.components;
    expect(components).toHaveLength(1);
    expect(components[0].id).toBe('uno1');
    expect(components.some((c) => c.kind === 'breadboard')).toBe(false);
    expect(components.some((c) => c.id === 'led1')).toBe(false);
  });

  it('is refused whether the breadboard is first, last or alone', () => {
    for (const components of [[breadboard], [breadboard, SENTINEL], [SENTINEL, led, breadboard]]) {
      expect(canLoadProject(project(components)).ok).toBe(false);
    }
  });
});

describe('everything else still opens', () => {
  it('loads a non-breadboard v2 project normally', () => {
    const result = loadProjectIntoStore(project([SENTINEL, led]));
    expect(result.ok).toBe(true);
    const components = useAppStore.getState().circuit.components;
    expect(components.map((c) => c.id).sort()).toEqual(['led1', 'uno1']);
    expect(useAppStore.getState().project.name).toBe('Imported');
  });

  it('loads a v1 project normally', () => {
    const result = loadProjectIntoStore(project([SENTINEL, led], 1));
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().circuit.components).toHaveLength(2);
  });

  it('loads an empty circuit normally', () => {
    expect(loadProjectIntoStore(project([])).ok).toBe(true);
    expect(useAppStore.getState().circuit.components).toEqual([]);
  });

  it('survives a project whose circuit is missing entirely', () => {
    const malformed = { ...project([]), circuit: undefined } as unknown as ProjectFileDTO;
    expect(canLoadProject(malformed).ok).toBe(true);
  });
});

describe('breadboard terminals never reach the 3D layers in this milestone', () => {
  it('contributes no obstacle volume, so the router knows nothing about it', async () => {
    // Imported for its public surface rather than grepped: a breadboard volume appearing
    // here would be C4 arriving early.
    const obstacles = await import('../src/renderer/app/circuit/hardware/scene-obstacles');
    const ids = obstacles.unoObstacleVolumes().map((v) => v.id);
    expect(ids.some((id) => id.includes('breadboard'))).toBe(false);
    expect(ids).toHaveLength(12);
  });

  it('does not let rail hole ids leak into the Uno header lookup', async () => {
    const obstacles = await import('../src/renderer/app/circuit/hardware/scene-obstacles');
    for (const rail of ['TP1', 'TN25', 'BP13', 'BN25', 'J30']) {
      expect(`${rail}:${obstacles.headerVolumeIdForPin(rail)}`).toBe(`${rail}:undefined`);
    }
  });

  it('records that hole ids overlap Uno pin names, and that instance qualification is what separates them', async () => {
    // 'A1' is a breadboard hole AND the Uno's analog pin 1. The strings genuinely collide,
    // so nothing may resolve a terminal by id alone — identity is `componentId:terminalId`
    // throughout, which is what keeps `bb1:A1` and `uno1:A1` different nodes. This is worth
    // pinning now because C3 and C4 will be tempted to look holes up by bare id.
    const obstacles = await import('../src/renderer/app/circuit/hardware/scene-obstacles');
    expect(obstacles.headerVolumeIdForPin('A1')).toBe('header-analog');

    const { terminalKey } = await import('@offline-arduino/simulator');
    expect(terminalKey('bb1', 'A1')).not.toBe(terminalKey('uno1', 'A1'));
  });

  it('has no physical geometry, so nothing could render it', async () => {
    const geometry = await import('../src/renderer/app/circuit/hardware/component-geometry');
    expect(geometry.componentPhysical('breadboard' as never)).toBeUndefined();
  });
});
