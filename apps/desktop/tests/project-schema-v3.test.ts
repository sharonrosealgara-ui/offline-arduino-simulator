/**
 * Project schema v3: a component terminal may record the breadboard hole it is plugged into.
 *
 * v3 is dormant by design. It is validated and migratable here, and nothing writes one — the
 * save path, `parseProjectFile` and the IPC DTO all still say v2. So these tests are about the
 * shape and the migration only; there is deliberately no assertion that the app produces a v3
 * file, because it must not yet.
 *
 * The version literal is the whole point of the bump. A v2 reader meeting `terminalAttachments`
 * would strip it silently — zod objects drop unknown keys — and hand back a project whose parts
 * had quietly come unplugged. `projectFileSchemaV2` requiring `schemaVersion: 2` is what turns
 * that silent loss into a refusal, so it is pinned below rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectToV3,
  migrateProjectV1ToV2,
  migrateProjectV2ToV3,
  parseProjectFile,
  projectFileSchemaV1,
  projectFileSchemaV2,
  projectFileSchemaV3,
  type ProjectFileV1,
  type ProjectFileV2,
  type ProjectFileV3,
} from '../src/main/projects/project-schema';

const META = {
  projectId: 'p1',
  name: 'Attachment fixture',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  boardId: 'uno' as const,
  sources: { 'Sketch.ino': 'void setup(){}\nvoid loop(){}\n' },
};

const UNO = {
  id: 'uno1', kind: 'uno-r3' as const, x: 300, y: 250,
  rotation: 0 as const, label: 'Uno', properties: {},
};

const LED = {
  id: 'led1', kind: 'led' as const, x: 620, y: 250,
  rotation: 90 as const, label: 'LED', properties: { colour: 'red', bright: true, mcd: 120 },
};

const BOARD = {
  id: 'bb1', kind: 'breadboard' as const, x: 620, y: 250,
  rotation: 0 as const, label: 'Breadboard', properties: {},
};

const WIRE = {
  id: 'w1',
  from: { componentId: 'uno1', terminalId: 'D13' },
  to: { componentId: 'bb1', terminalId: 'E15' },
  colorRole: 'signal-yellow' as const,
  waypoints: [{ x: 400, y: 200 }],
};

const v1File = (): ProjectFileV1 => ({
  ...META,
  schemaVersion: 1,
  circuit: { schemaVersion: 1, components: [UNO, LED], wires: [], junctions: [] },
});

const v2File = (): ProjectFileV2 => ({
  ...META,
  schemaVersion: 2,
  circuit: { schemaVersion: 2, components: [UNO, LED, BOARD], wires: [WIRE], junctions: [] },
});

/** A v3 file, built as raw data so the schema — not the type — is what accepts it. */
const v3Raw = (attachments?: unknown): unknown => ({
  ...META,
  schemaVersion: 3,
  circuit: {
    schemaVersion: 3,
    components: [
      UNO,
      BOARD,
      attachments === undefined ? LED : { ...LED, terminalAttachments: attachments },
    ],
    wires: [WIRE],
    junctions: [],
  },
});

const hole = (holeId: string) => ({ kind: 'breadboard-hole', breadboardId: 'bb1', holeId });

/** The attachments of the one component that carries them, as parsed. */
const parsedAttachments = (file: ProjectFileV3): Record<string, unknown> | undefined =>
  file.circuit.components.find((c) => c.id === 'led1')?.terminalAttachments;

describe('project schema v3 — shape', () => {
  it('accepts a v3 project with no attachments at all', () => {
    const parsed = projectFileSchemaV3.safeParse(v3Raw());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsedAttachments(parsed.data)).toBeUndefined();
  });

  it('accepts a single breadboard-hole attachment', () => {
    const parsed = projectFileSchemaV3.safeParse(v3Raw({ anode: hole('E15') }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsedAttachments(parsed.data)).toEqual({
        anode: { kind: 'breadboard-hole', breadboardId: 'bb1', holeId: 'E15' },
      });
    }
  });

  it('accepts several terminals of one component, each in its own hole', () => {
    const parsed = projectFileSchemaV3.safeParse(
      v3Raw({ anode: hole('E15'), cathode: hole('E20') }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const got = parsedAttachments(parsed.data)!;
      expect(Object.keys(got).sort()).toEqual(['anode', 'cathode']);
      expect(got.cathode).toEqual({ kind: 'breadboard-hole', breadboardId: 'bb1', holeId: 'E20' });
    }
  });

  it('survives parse -> serialize -> parse unchanged', () => {
    const attachments = { anode: hole('E15'), cathode: hole('J3') };
    const first = projectFileSchemaV3.parse(v3Raw(attachments));
    const round = projectFileSchemaV3.parse(JSON.parse(JSON.stringify(first)));
    expect(round).toEqual(first);
    expect(parsedAttachments(round)).toEqual(attachments);
  });
});

describe('project schema v3 — rejection', () => {
  const rejects = (attachments: unknown): void => {
    expect(projectFileSchemaV3.safeParse(v3Raw(attachments)).success).toBe(false);
  };

  it('rejects an attachment kind this build does not understand', () => {
    rejects({ anode: { kind: 'screw-terminal', breadboardId: 'bb1', holeId: 'E15' } });
  });

  it('rejects an empty terminal key', () => {
    rejects({ '': hole('E15') });
  });

  it('rejects an empty breadboardId', () => {
    rejects({ anode: { kind: 'breadboard-hole', breadboardId: '', holeId: 'E15' } });
  });

  it('rejects an empty holeId', () => {
    rejects({ anode: { kind: 'breadboard-hole', breadboardId: 'bb1', holeId: '' } });
  });

  it('rejects malformed attachment values', () => {
    rejects({ anode: 'E15' });
    rejects({ anode: null });
    rejects({ anode: {} });
    rejects({ anode: { kind: 'breadboard-hole', breadboardId: 'bb1' } });
    rejects({ anode: { kind: 'breadboard-hole', holeId: 'E15' } });
    rejects([hole('E15')]);
  });
});

describe('project schema v3 — migration', () => {
  it('raises v2 to v3 without inventing attachments', () => {
    const migrated = migrateProjectV2ToV3(v2File());
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.circuit.schemaVersion).toBe(3);
    for (const component of migrated.circuit.components) {
      expect(component.terminalAttachments).toBeUndefined();
      expect('terminalAttachments' in component).toBe(false);
    }
    expect(projectFileSchemaV3.safeParse(migrated).success).toBe(true);
  });

  it('chains v1 -> v2 -> v3, changing only the version numbers', () => {
    const source = v1File();
    const chained = migrateProjectToV3(source);
    const stepwise = migrateProjectV2ToV3(migrateProjectV1ToV2(source));
    expect(chained).toEqual(stepwise);
    expect(chained.schemaVersion).toBe(3);
    expect(chained.circuit.schemaVersion).toBe(3);
    // Everything that is not a version number is the same project.
    const { schemaVersion: _sv, circuit: _c, ...chainedMeta } = chained;
    const { schemaVersion: _sv1, circuit: _c1, ...sourceMeta } = source;
    expect(chainedMeta).toEqual(sourceMeta);
  });

  it('carries every component and wire field across untouched', () => {
    const migrated = migrateProjectToV3(v2File());
    expect(migrated.circuit.components).toEqual(v2File().circuit.components);
    expect(migrated.circuit.wires).toEqual(v2File().circuit.wires);
    expect(migrated.circuit.junctions).toEqual(v2File().circuit.junctions);
    expect(migrated.sources).toEqual(META.sources);
  });

  it('leaves data that is already v3 exactly as it was', () => {
    const already = projectFileSchemaV3.parse(v3Raw({ anode: hole('E15') }));
    const again = migrateProjectToV3(already);
    expect(again).toBe(already); // identity, not merely equality
    expect(migrateProjectToV3(again)).toEqual(already);
    expect(parsedAttachments(again)).toEqual({
      anode: { kind: 'breadboard-hole', breadboardId: 'bb1', holeId: 'E15' },
    });
  });
});

describe('project schema v3 — older readers stay strict', () => {
  it('the v2 reader refuses a v3 file outright', () => {
    expect(projectFileSchemaV2.safeParse(v3Raw({ anode: hole('E15') })).success).toBe(false);
    expect(projectFileSchemaV2.safeParse(v3Raw()).success).toBe(false);
  });

  it('the v1 reader refuses a v3 file outright', () => {
    expect(projectFileSchemaV1.safeParse(v3Raw()).success).toBe(false);
  });

  it('still reads v1 and v2 projects, and still hands back v2', () => {
    const fromV1 = parseProjectFile(v1File());
    expect(fromV1.ok).toBe(true);
    if (fromV1.ok) {
      expect(fromV1.migratedFrom).toBe(1);
      expect(fromV1.project.schemaVersion).toBe(2);
    }
    const fromV2 = parseProjectFile(v2File());
    expect(fromV2.ok).toBe(true);
    if (fromV2.ok) {
      expect(fromV2.migratedFrom).toBeNull();
      expect(fromV2.project.schemaVersion).toBe(2);
    }
  });

  it('refuses to load a v3 file while v3 is dormant, with an explaining message', () => {
    // Nothing writes v3, so no user can hold one. Reading it would imply the app understands
    // attachments, which it does not yet — the refusal is the honest answer, not a gap.
    const result = parseProjectFile(v3Raw({ anode: hole('E15') }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('version 3');
    expect(CURRENT_PROJECT_SCHEMA_VERSION).toBe(2);
  });
});
