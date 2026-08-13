/**
 * Every bundled circuit, checked for the hazards a scale or size change can introduce.
 *
 * The board is fixed by uno-geometry.ts while everything else converts through the
 * schematic scale, so changing that scale moves legacy content *relative to the board*.
 * Proving the saved bytes are untouched proves nothing about what a student sees. This
 * suite is what gates the scale correction: it runs the real fixtures — five packaged
 * examples and five in-app starter templates — through the real geometry.
 *
 * The terminal check deliberately uses the FOOTPRINT, not the body. Real parts have leads
 * outside their bodies; demanding otherwise would demand they be drawn wrong.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { CircuitComponent, CircuitWire, CircuitJunction } from '@offline-arduino/contracts/circuit';
import { STARTER_TEMPLATES } from '../src/renderer/app/dialogs/examples-data';
import { footprintBoundsMm, type BoundsMm } from '../src/renderer/app/circuit/hardware/component-bounds';
import { mmToWorld, schematicToWorld } from '../src/renderer/app/circuit/hardware/geometry-units';
import { BOARD_HALF_W, BOARD_HALF_D } from '../src/renderer/app/circuit/hardware/uno-geometry';

interface Fixture {
  name: string;
  components: CircuitComponent[];
  wires: CircuitWire[];
  junctions: CircuitJunction[];
}

const examplesRoot = path.resolve(__dirname, '../../../resources/examples');

function packagedFixtures(): Fixture[] {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // `schemas/` sits alongside the examples and holds no circuit.
    .filter((entry) => existsSync(path.join(examplesRoot, entry.name, 'circuit.json')))
    .map((entry) => {
      const circuit = JSON.parse(
        readFileSync(path.join(examplesRoot, entry.name, 'circuit.json'), 'utf8'),
      );
      return {
        name: `packaged/${entry.name}`,
        components: circuit.components ?? [],
        wires: circuit.wires ?? [],
        junctions: circuit.junctions ?? [],
      };
    });
}

function starterFixtures(): Fixture[] {
  return STARTER_TEMPLATES.map((template) => ({
    name: `starter/${template.id}`,
    components: template.circuit.components as CircuitComponent[],
    wires: template.circuit.wires as CircuitWire[],
    junctions: (template.circuit.junctions ?? []) as CircuitJunction[],
  }));
}

const FIXTURES = [...packagedFixtures(), ...starterFixtures()];

/** Rotate a local point by the component's rotation, as both renderers do. */
function rotate(x: number, y: number, degrees: number): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** A placed component's footprint in world inches, axis-aligned after rotation. */
function worldFootprint(component: CircuitComponent, origin: { x: number; y: number }): BoundsMm | null {
  const definition = getComponentDefinition(component.kind);
  if (!definition) return null;
  const bounds = footprintBoundsMm(component.kind, definition.terminals);
  if (!bounds) return null;

  const corners = [
    { x: bounds.minX, z: bounds.minZ },
    { x: bounds.maxX, z: bounds.minZ },
    { x: bounds.minX, z: bounds.maxZ },
    { x: bounds.maxX, z: bounds.maxZ },
  ].map((corner) => rotate(mmToWorld(corner.x), mmToWorld(corner.z), component.rotation));

  const cx = schematicToWorld(component.x - origin.x);
  const cz = schematicToWorld(component.y - origin.y);
  return {
    minX: cx + Math.min(...corners.map((c) => c.x)),
    maxX: cx + Math.max(...corners.map((c) => c.x)),
    minZ: cz + Math.min(...corners.map((c) => c.y)),
    maxZ: cz + Math.max(...corners.map((c) => c.y)),
  };
}

function overlaps(a: BoundsMm, b: BoundsMm): boolean {
  return !(a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ);
}

function boardBounds(): BoundsMm {
  return { minX: -BOARD_HALF_W, maxX: BOARD_HALF_W, minZ: -BOARD_HALF_D, maxZ: BOARD_HALF_D };
}

function placed(fixture: Fixture): Array<{ component: CircuitComponent; bounds: BoundsMm }> {
  const uno = fixture.components.find((c) => c.kind === 'uno-r3');
  const origin = { x: uno?.x ?? 300, y: uno?.y ?? 250 };
  return fixture.components
    .filter((c) => c.kind !== 'uno-r3')
    .map((component) => ({ component, bounds: worldFootprint(component, origin)! }))
    .filter((entry) => entry.bounds !== null);
}

describe('the bundled circuits are all covered', () => {
  it('finds ten fixtures', () => {
    // Five packaged examples plus five starter templates. If a fixture is added the suite
    // must grow with it, or the new circuit ships unchecked.
    expect(FIXTURES.length).toBe(10);
  });

  it('reads a board and at least one wire or part from each', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.components.some((c) => c.kind === 'uno-r3')).toBe(true);
    }
  });
});

describe.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
  it('places no component on top of the board', () => {
    for (const { component, bounds } of placed(fixture)) {
      expect(
        overlaps(bounds, boardBounds()),
        `${component.id} (${component.kind}) overlaps the Uno`,
      ).toBe(false);
    }
  });

  it('places no component on top of another', () => {
    const parts = placed(fixture);
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        expect(
          overlaps(parts[i].bounds, parts[j].bounds),
          `${parts[i].component.id} overlaps ${parts[j].component.id}`,
        ).toBe(false);
      }
    }
  });

  it('keeps every junction clear of a component body', () => {
    const uno = fixture.components.find((c) => c.kind === 'uno-r3');
    const origin = { x: uno?.x ?? 300, y: uno?.y ?? 250 };
    for (const junction of fixture.junctions) {
      const p = {
        x: schematicToWorld(junction.point.x - origin.x),
        z: schematicToWorld(junction.point.y - origin.y),
      };
      for (const { component, bounds } of placed(fixture)) {
        const inside = p.x > bounds.minX && p.x < bounds.maxX && p.z > bounds.minZ && p.z < bounds.maxZ;
        expect(inside, `junction ${junction.id} sits inside ${component.id}`).toBe(false);
      }
    }
  });

  it('stays inside a workable camera frame', () => {
    const all = [...placed(fixture).map((p) => p.bounds), boardBounds()];
    const width = Math.max(...all.map((b) => b.maxX)) - Math.min(...all.map((b) => b.minX));
    const depth = Math.max(...all.map((b) => b.maxZ)) - Math.min(...all.map((b) => b.minZ));
    // OrbitControls caps distance at 14 world inches; content this size always frames.
    expect(Math.max(width, depth)).toBeLessThan(12);
  });

  it('references only terminals the registry defines', () => {
    for (const wire of fixture.wires) {
      for (const end of [wire.from, wire.to]) {
        const component = fixture.components.find((c) => c.id === end.componentId);
        expect(component, `wire ${wire.id} references missing ${end.componentId}`).toBeDefined();
        const definition = getComponentDefinition(component!.kind)!;
        expect(
          definition.terminals.some((t) => t.id === end.terminalId),
          `wire ${wire.id} references unknown terminal ${end.componentId}:${end.terminalId}`,
        ).toBe(true);
      }
    }
  });
});

describe('every terminal anchor lies within its own footprint', () => {
  it.each(
    ['led', 'resistor', 'pushbutton', 'potentiometer', 'servo', 'lcd1602'] as const,
  )('%s', (kind) => {
    const definition = getComponentDefinition(kind)!;
    const bounds = footprintBoundsMm(kind, definition.terminals)!;
    for (const terminal of definition.terminals) {
      const x = terminal.x * 0.254;
      const z = terminal.y * 0.254;
      const grace = 1e-9;
      expect(x).toBeGreaterThanOrEqual(bounds.minX - grace);
      expect(x).toBeLessThanOrEqual(bounds.maxX + grace);
      expect(z).toBeGreaterThanOrEqual(bounds.minZ - grace);
      expect(z).toBeLessThanOrEqual(bounds.maxZ + grace);
    }
  });
});
