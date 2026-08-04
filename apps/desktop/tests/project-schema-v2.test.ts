/**
 * Project format version 2, and the promise that version 1 still opens.
 *
 * The bump exists for one reason: a project may now contain a breadboard, and a build that
 * predates it must refuse the file rather than silently drop a component that changes the
 * circuit. That only works if the two readers are genuinely different — if v1 quietly
 * accepted a breadboard the version number would be decoration. The first test here is
 * therefore the one that matters most: v1 rejects it.
 *
 * Everything is exercised through the exported parser and migration rather than by reading
 * source text, so these tests describe behaviour a caller can rely on.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectV1ToV2,
  parseProjectFile,
  projectCircuitSchemaV1,
  projectCircuitSchemaV2,
  projectFileSchemaV1,
  projectFileSchemaV2,
} from '../src/main/projects/project-schema';

/** A representative v1 project, kept as the backward-compatibility fixture. */
const V1_PROJECT = {
  schemaVersion: 1,
  projectId: 'p-1',
  name: 'Blink',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  boardId: 'uno',
  sources: { 'Sketch.ino': 'void setup() {}\nvoid loop() {}\n' },
  circuit: {
    schemaVersion: 1,
    components: [
      { id: 'uno1', kind: 'uno-r3', x: 120, y: 120, rotation: 0, label: 'Arduino Uno', properties: {} },
      { id: 'led1', kind: 'led', x: 200, y: 160, rotation: 90, label: 'LED', properties: { color: 'red' } },
    ],
    wires: [
      {
        id: 'w1',
        from: { componentId: 'uno1', terminalId: 'D13' },
        to: { componentId: 'led1', terminalId: 'anode' },
        colorRole: 'signal-yellow',
        waypoints: [{ x: 10, y: 20 }],
      },
    ],
    junctions: [],
  },
} as const;

const withBreadboard = (version: 1 | 2) => ({
  ...V1_PROJECT,
  schemaVersion: version,
  circuit: {
    ...V1_PROJECT.circuit,
    schemaVersion: version,
    components: [
      ...V1_PROJECT.circuit.components,
      { id: 'bb1', kind: 'breadboard', x: 300, y: 300, rotation: 0, label: 'Breadboard', properties: {} },
    ],
  },
});

describe('1-2: the two readers really differ', () => {
  it('still parses a valid v1 project', () => {
    expect(projectFileSchemaV1.safeParse(V1_PROJECT).success).toBe(true);
  });

  it('rejects a breadboard in a v1 file — the whole point of the version bump', () => {
    const result = projectFileSchemaV1.safeParse(withBreadboard(1));
    expect(result.success).toBe(false);
  });

  it('rejects a breadboard in a v1 circuit even on its own', () => {
    expect(projectCircuitSchemaV1.safeParse(withBreadboard(1).circuit).success).toBe(false);
  });

  it('accepts a breadboard in a v2 file', () => {
    expect(projectFileSchemaV2.safeParse(withBreadboard(2)).success).toBe(true);
    expect(projectCircuitSchemaV2.safeParse(withBreadboard(2).circuit).success).toBe(true);
  });

  it('still rejects the kinds neither version knows', () => {
    const bogus = { ...withBreadboard(2) };
    bogus.circuit.components[2] = { ...bogus.circuit.components[2], kind: 'oscilloscope' } as never;
    expect(projectFileSchemaV2.safeParse(bogus).success).toBe(false);
  });
});

describe('3-4: migration', () => {
  it('is deterministic — the same input gives byte-identical output', () => {
    const a = JSON.stringify(migrateProjectV1ToV2(V1_PROJECT as never));
    const b = JSON.stringify(migrateProjectV1ToV2(V1_PROJECT as never));
    expect(a).toBe(b);
  });

  it('changes the two version numbers and nothing else', () => {
    const migrated = migrateProjectV1ToV2(V1_PROJECT as never);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.circuit.schemaVersion).toBe(2);

    const strip = (p: unknown) => {
      const clone = JSON.parse(JSON.stringify(p));
      delete clone.schemaVersion;
      delete clone.circuit.schemaVersion;
      return clone;
    };
    expect(strip(migrated)).toEqual(strip(V1_PROJECT));
  });

  it('preserves every component and wire exactly', () => {
    const migrated = migrateProjectV1ToV2(V1_PROJECT as never);
    expect(migrated.circuit.components).toEqual(V1_PROJECT.circuit.components);
    expect(migrated.circuit.wires).toEqual(V1_PROJECT.circuit.wires);
    expect(migrated.circuit.wires[0].waypoints).toEqual([{ x: 10, y: 20 }]);
    expect(migrated.sources).toEqual(V1_PROJECT.sources);
  });

  it('does not invent fields the format has not promised', () => {
    const migrated = migrateProjectV1ToV2(V1_PROJECT as never) as Record<string, unknown>;
    expect(Object.keys(migrated).sort()).toEqual(Object.keys(V1_PROJECT).sort());
    const circuit = migrated.circuit as Record<string, unknown>;
    expect(Object.keys(circuit).sort()).toEqual(['components', 'junctions', 'schemaVersion', 'wires']);
  });

  it('leaves a migrated project valid against the v2 reader', () => {
    expect(projectFileSchemaV2.safeParse(migrateProjectV1ToV2(V1_PROJECT as never)).success).toBe(true);
  });
});

describe('5-7: the parser is the single entry point', () => {
  it('migrates a v1 file on the way in and says so', () => {
    const result = parseProjectFile(V1_PROJECT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.project.schemaVersion).toBe(2);
  });

  it('passes a native v2 file through unmigrated', () => {
    const native = migrateProjectV1ToV2(V1_PROJECT as never);
    const result = parseProjectFile(native);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBeNull();
    expect(result.project).toEqual(native);
  });

  it('round-trips a native v2 project deterministically', () => {
    const native = migrateProjectV1ToV2(V1_PROJECT as never);
    const once = parseProjectFile(JSON.parse(JSON.stringify(native)));
    const twice = parseProjectFile(JSON.parse(JSON.stringify(native)));
    expect(once.ok && twice.ok).toBe(true);
    if (!once.ok || !twice.ok) return;
    // Byte-identical between runs is the property that matters: a project saved twice must
    // produce the same file. Key ORDER is zod's, not the input's, so comparing the
    // serialised form back to the pre-parse object would test zod's field ordering rather
    // than determinism — the content equality below is the real check.
    expect(JSON.stringify(once.project)).toBe(JSON.stringify(twice.project));
    expect(once.project).toEqual(native);

    // And re-parsing its own output is a fixed point, which is what a save/load cycle does.
    const again = parseProjectFile(JSON.parse(JSON.stringify(once.project)));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(JSON.stringify(again.project)).toBe(JSON.stringify(once.project));
  });

  it('accepts a v2 project that contains a breadboard — the format is capable', () => {
    const result = parseProjectFile(withBreadboard(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.circuit.components.some((c) => c.kind === 'breadboard')).toBe(true);
  });

  it('refuses a future version with a message a student can act on', () => {
    const future = { ...withBreadboard(2), schemaVersion: 3 };
    const result = parseProjectFile(future);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('3');
    expect(result.error).toMatch(/newer|cannot open|Update the app/i);
  });

  it('reports the current version as 2', () => {
    expect(CURRENT_PROJECT_SCHEMA_VERSION).toBe(2);
  });
});

describe('8: malformed input fails atomically', () => {
  it.each([
    ['a v1 file with a bad rotation', { ...V1_PROJECT, circuit: { ...V1_PROJECT.circuit, components: [{ ...V1_PROJECT.circuit.components[0], rotation: 45 }] } }],
    ['a v2 file with a non-finite coordinate', { ...migrateProjectV1ToV2(V1_PROJECT as never), circuit: { ...migrateProjectV1ToV2(V1_PROJECT as never).circuit, components: [{ ...V1_PROJECT.circuit.components[0], x: Number.NaN }] } }],
    ['a missing boardId', { ...V1_PROJECT, boardId: undefined }],
    ['not an object at all', 'nonsense'],
    ['null', null],
  ])('rejects %s and returns no project', (_label, input) => {
    const result = parseProjectFile(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('project');
  });

  it('names where a v2 file went wrong instead of blaming v1', () => {
    const broken = migrateProjectV1ToV2(V1_PROJECT as never) as Record<string, unknown>;
    const result = parseProjectFile({ ...broken, name: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('name');
  });
});
