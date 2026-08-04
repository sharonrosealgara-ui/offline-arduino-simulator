// @vitest-environment jsdom
/**
 * What the breadboard is still not allowed to touch.
 *
 * C1B refused every breadboard project because nothing could draw one. C2B can draw and wire
 * one in 2D, so those refusals are gone and the assertions here have moved with them: a
 * breadboard project now LOADS, and the boundary that remains is the 3D one. C3 has no
 * geometry and C4 has no attachment portals, so no breadboard terminal may reach the 3D
 * renderer, the scene obstacles or the Phase B wire router.
 *
 * The validation that was never about breadboards — the terminal budget — still applies and
 * is still tested here.
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

describe('the breadboard is offered, and the budget still applies', () => {
  it('is present in the component catalog exactly once', () => {
    expect(COMPONENT_CATALOG.filter((e) => e.kind === 'breadboard')).toHaveLength(1);
    expect(catalogEntry('breadboard')).toBeDefined();
  });

  it('leaves every other placeable catalog entry in place', () => {
    // The Uno is not in the library — it is always present rather than placed.
    for (const kind of ['led', 'resistor', 'pushbutton', 'potentiometer', 'lcd1602', 'servo'] as const) {
      expect(`${kind}:${Boolean(catalogEntry(kind))}`).toBe(`${kind}:true`);
    }
  });
});

describe('a breadboard project loads now', () => {
  it('is accepted rather than refused', () => {
    expect(canLoadProject(project([SENTINEL, breadboard])).ok).toBe(true);
    const result = loadProjectIntoStore(project([SENTINEL, breadboard]));
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().circuit.components.some((c) => c.kind === 'breadboard')).toBe(true);
  });

  it('is still refused when it would exceed the terminal budget, changing nothing', () => {
    const over = [SENTINEL, breadboard, { ...breadboard, id: 'bb2' }, { ...breadboard, id: 'bb3' }, { ...breadboard, id: 'bb4' }];
    const verdict = canLoadProject(project(over));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('1500');

    const before = JSON.stringify(useAppStore.getState().circuit);
    expect(loadProjectIntoStore(project(over)).ok).toBe(false);
    expect(JSON.stringify(useAppStore.getState().circuit)).toBe(before);
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
