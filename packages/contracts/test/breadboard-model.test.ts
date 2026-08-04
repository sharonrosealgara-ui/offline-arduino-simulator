/**
 * The breadboard model is the thing everything else will trust, so it is checked exhaustively
 * rather than sampled.
 *
 * The property that matters most is the one a student would notice first if it were wrong:
 * nothing crosses the centre gap. A breadboard whose two banks were quietly joined would
 * "work" in simulation and fail on the bench, which is worse than not shipping one at all —
 * the reason the README gave for having no breadboard in the first place.
 *
 * The second theme here is what this module must NOT yet do. C1A is a verified source of
 * truth, not a half-exposed feature, so several tests assert absence: no ComponentKind, no
 * schema change, no barrel export, nothing reachable from the running application.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BANK_SPAN_MM,
  BODY_DEPTH_MM,
  BODY_HEIGHT_MM,
  BODY_LENGTH_MM,
  BREADBOARD_DIMENSION_PROVENANCE,
  CENTRE_GAP_MM,
  COLUMN_COUNT,
  COLUMN_SPAN_MM,
  HOLE_PITCH_MM,
  RAIL_COUNT,
  RAIL_GROUP_SIZE,
  TERMINAL_GROUP_COUNT,
  TERMINAL_GROUP_SIZE,
  TERMINAL_STRIP_HOLES,
  TOTAL_HOLES,
  breadboardGroupIdForHole,
  breadboardGroupMemberships,
  breadboardHoleIds,
  createBreadboardModel,
  railGroupId,
  stripGroupId,
} from '../src/breadboard';

const model = createBreadboardModel();
const TOL = 1e-9;
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

const STRIP_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
const AE = new Set(['A', 'B', 'C', 'D', 'E']);
const FJ = new Set(['F', 'G', 'H', 'I', 'J']);

describe('1-3: hole identity', () => {
  it('has exactly 400 holes', () => {
    expect(model.holes).toHaveLength(TOTAL_HOLES);
    expect(TOTAL_HOLES).toBe(400);
  });

  it('gives every hole a unique id', () => {
    const ids = model.holes.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every id inside the 64-character terminal-id limit the project schema enforces', () => {
    for (const hole of model.holes) {
      expect(hole.id.length).toBeGreaterThan(0);
      expect(hole.id.length).toBeLessThanOrEqual(64);
    }
  });

  it('produces exactly the A1-J30 strip ids', () => {
    const expected = new Set<string>();
    for (const row of STRIP_ROWS) for (let c = 1; c <= 30; c += 1) expected.add(`${row}${c}`);
    const actual = new Set(model.holes.filter((h) => h.groupId.startsWith('strip:')).map((h) => h.id));
    expect(actual).toEqual(expected);
    expect(actual.size).toBe(TERMINAL_STRIP_HOLES);
  });

  it('produces exactly the TP/TN/BP/BN rail ids, 25 of each', () => {
    for (const prefix of ['TP', 'TN', 'BP', 'BN']) {
      const expected = new Set(Array.from({ length: 25 }, (_, i) => `${prefix}${i + 1}`));
      const actual = new Set(model.holes.map((h) => h.id).filter((id) => new RegExp(`^${prefix}\\d+$`).test(id)));
      expect(actual).toEqual(expected);
    }
  });

  it('has no id outside those two families', () => {
    const ok = /^(?:[A-J](?:[1-9]|[12][0-9]|30)|(?:TP|TN|BP|BN)(?:[1-9]|1[0-9]|2[0-5]))$/;
    for (const hole of model.holes) expect(hole.id).toMatch(ok);
  });
});

describe('4-7: groups', () => {
  it('has exactly 64 groups with unique, stable, human-readable ids', () => {
    expect(model.groups).toHaveLength(64);
    const ids = model.groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(64);
    for (const id of ids) expect(id).toMatch(/^(strip:(?:[1-9]|[12][0-9]|30):(?:AE|FJ)|rail:(?:top|bottom):(?:positive|negative))$/);
  });

  it('has exactly 60 terminal-strip groups of five', () => {
    const strips = model.groups.filter((g) => g.kind === 'strip');
    expect(strips).toHaveLength(TERMINAL_GROUP_COUNT);
    for (const g of strips) expect(g.holeIds).toHaveLength(TERMINAL_GROUP_SIZE);
    expect(strips.length * TERMINAL_GROUP_SIZE).toBe(TERMINAL_STRIP_HOLES);
  });

  it('has exactly four rail groups of 25', () => {
    const rails = model.groups.filter((g) => g.kind === 'rail');
    expect(rails).toHaveLength(RAIL_COUNT);
    for (const g of rails) expect(g.holeIds).toHaveLength(RAIL_GROUP_SIZE);
  });

  it('puts every hole in exactly one group, with no group naming a hole that does not exist', () => {
    const seen = new Map<string, number>();
    for (const g of model.groups) for (const id of g.holeIds) seen.set(id, (seen.get(id) ?? 0) + 1);

    expect(seen.size).toBe(TOTAL_HOLES);
    for (const [id, count] of seen) expect(`${id}:${count}`).toBe(`${id}:1`);

    const holeIds = new Set(model.holes.map((h) => h.id));
    for (const id of seen.keys()) expect(holeIds.has(id)).toBe(true);
    for (const hole of model.holes) expect(seen.has(hole.id)).toBe(true);
  });

  it('agrees between each hole\'s groupId and that group\'s membership list', () => {
    const byId = new Map(model.groups.map((g) => [g.id, g]));
    for (const hole of model.holes) {
      expect(byId.get(hole.groupId)?.holeIds).toContain(hole.id);
      expect(breadboardGroupIdForHole(hole.id)).toBe(hole.groupId);
    }
    expect(breadboardGroupIdForHole('Z99')).toBeUndefined();
  });

  it('connects A1-E1 together and F1-J1 together, continuing through column 30', () => {
    for (let c = 1; c <= COLUMN_COUNT; c += 1) {
      expect(model.groups.find((g) => g.id === stripGroupId(c, 'AE'))?.holeIds).toEqual([
        `A${c}`, `B${c}`, `C${c}`, `D${c}`, `E${c}`,
      ]);
      expect(model.groups.find((g) => g.id === stripGroupId(c, 'FJ'))?.holeIds).toEqual([
        `F${c}`, `G${c}`, `H${c}`, `I${c}`, `J${c}`,
      ]);
    }
  });
});

describe('8: nothing crosses the centre gap', () => {
  it('has no group containing both an A-E and an F-J hole', () => {
    for (const g of model.groups) {
      const rows = g.holeIds.map((id) => id[0]);
      const hasAE = rows.some((r) => AE.has(r));
      const hasFJ = rows.some((r) => FJ.has(r));
      expect(`${g.id} AE=${hasAE} FJ=${hasFJ}`).not.toBe(`${g.id} AE=true FJ=true`);
    }
  });

  it('keeps every A-E hole strictly above every F-J hole, with the gap between them', () => {
    const ae = model.holes.filter((h) => h.groupId.endsWith(':AE'));
    const fj = model.holes.filter((h) => h.groupId.endsWith(':FJ'));
    expect(Math.max(...ae.map((h) => h.y))).toBeLessThan(Math.min(...fj.map((h) => h.y)));
  });

  it('leaves no hole inside the gap itself', () => {
    const lowerEdge = -CENTRE_GAP_MM / 2;
    const upperEdge = CENTRE_GAP_MM / 2;
    for (const hole of model.holes) {
      const inside = hole.y > lowerEdge + TOL && hole.y < upperEdge - TOL;
      expect(`${hole.id} inGap=${inside}`).toBe(`${hole.id} inGap=false`);
    }
  });
});

describe('9: rails are mutually isolated', () => {
  const rails = [
    railGroupId('top', 'positive'),
    railGroupId('top', 'negative'),
    railGroupId('bottom', 'positive'),
    railGroupId('bottom', 'negative'),
  ];

  it('shares no hole between any two rails', () => {
    const sets = rails.map((id) => new Set(model.groups.find((g) => g.id === id)!.holeIds));
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        const shared = [...sets[i]].filter((h) => sets[j].has(h));
        expect(`${rails[i]}|${rails[j]} shared=${shared.length}`).toBe(`${rails[i]}|${rails[j]} shared=0`);
      }
    }
  });

  it('shares no hole between any rail and any terminal-strip group', () => {
    const railHoles = new Set(model.groups.filter((g) => g.kind === 'rail').flatMap((g) => g.holeIds));
    const stripHoles = new Set(model.groups.filter((g) => g.kind === 'strip').flatMap((g) => g.holeIds));
    for (const id of railHoles) expect(stripHoles.has(id)).toBe(false);
    expect(railHoles.size + stripHoles.size).toBe(TOTAL_HOLES);
  });

  it('keeps each rail continuous across all 25 of its terminals — one group, not segments', () => {
    for (const id of rails) {
      const g = model.groups.find((x) => x.id === id)!;
      expect(g.holeIds).toHaveLength(25);
      // Every rail hole resolves to this same group: no split, no second segment.
      for (const holeId of g.holeIds) expect(breadboardGroupIdForHole(holeId)).toBe(id);
    }
  });
});

describe('10-13: geometry against the pinned source', () => {
  it('spaces adjacent columns at exactly the documented 2.54 mm pitch', () => {
    for (let c = 1; c < COLUMN_COUNT; c += 1) {
      const a = model.holes.find((h) => h.id === `A${c}`)!;
      const b = model.holes.find((h) => h.id === `A${c + 1}`)!;
      expect(b.x - a.x).toBeCloseTo(HOLE_PITCH_MM, 9);
    }
    expect(HOLE_PITCH_MM).toBe(2.54);
  });

  it('spaces adjacent rows within a bank at the same documented pitch', () => {
    for (const bank of [['A', 'B', 'C', 'D', 'E'], ['F', 'G', 'H', 'I', 'J']]) {
      for (let i = 0; i < bank.length - 1; i += 1) {
        const a = model.holes.find((h) => h.id === `${bank[i]}7`)!;
        const b = model.holes.find((h) => h.id === `${bank[i + 1]}7`)!;
        expect(b.y - a.y).toBeCloseTo(HOLE_PITCH_MM, 9);
      }
    }
  });

  it('measures E-to-F hole-CENTRE spacing separately from any visible trench width', () => {
    const e = model.holes.find((h) => h.id === 'E15')!;
    const f = model.holes.find((h) => h.id === 'F15')!;
    expect(f.y - e.y).toBeCloseTo(CENTRE_GAP_MM, 9);
    expect(CENTRE_GAP_MM).toBeCloseTo(3 * HOLE_PITCH_MM, 9);
    // The centre spacing is an APPROXIMATION, and no visible trench width is modelled at
    // all — so there is nothing here that could be mistaken for a datasheet measurement.
    expect(BREADBOARD_DIMENSION_PROVENANCE.CENTRE_GAP_MM).toBe('approximated');
    expect(Object.keys(BREADBOARD_DIMENSION_PROVENANCE)).not.toContain('TRENCH_WIDTH_MM');
  });

  it('claims no rail offset the source does not confirm', () => {
    // No half-pitch (1.27 mm) offset is asserted: rail holes sit on the plain pitch lattice.
    const rail = model.holes.filter((h) => h.groupId === railGroupId('top', 'positive')).sort((a, b) => a.x - b.x);
    for (let i = 0; i < rail.length - 1; i += 1) {
      expect(rail[i + 1].x - rail[i].x).toBeCloseTo(HOLE_PITCH_MM, 9);
    }
    for (const key of ['RAIL_EDGE_MARGIN_MM', 'RAIL_ROW_SEPARATION_MM']) {
      expect(BREADBOARD_DIMENSION_PROVENANCE[key]).toBe('approximated');
    }
  });

  it('separates the four rail rows and puts two on each side of the circuit area', () => {
    const yOf = (side: 'top' | 'bottom', pol: 'positive' | 'negative') =>
      model.holes.find((h) => h.groupId === railGroupId(side, pol))!.y;
    const circuitTop = Math.min(...model.holes.filter((h) => h.groupId.startsWith('strip:')).map((h) => h.y));
    const circuitBottom = Math.max(...model.holes.filter((h) => h.groupId.startsWith('strip:')).map((h) => h.y));

    expect(yOf('top', 'negative')).toBeLessThan(yOf('top', 'positive'));
    expect(yOf('top', 'positive')).toBeLessThan(circuitTop);
    expect(yOf('bottom', 'positive')).toBeGreaterThan(circuitBottom);
    expect(yOf('bottom', 'negative')).toBeGreaterThan(yOf('bottom', 'positive'));
  });

  it('matches the documented body envelope', () => {
    expect(model.body).toEqual({ lengthMm: 84, depthMm: 54.3, heightMm: 8.5 });
    expect([BODY_LENGTH_MM, BODY_DEPTH_MM, BODY_HEIGHT_MM]).toEqual([84, 54.3, 8.5]);
  });

  it('fits every hole inside that envelope', () => {
    for (const hole of model.holes) {
      expect(Math.abs(hole.x)).toBeLessThan(BODY_LENGTH_MM / 2);
      expect(Math.abs(hole.y)).toBeLessThan(BODY_DEPTH_MM / 2);
    }
  });

  it('derives the spans arithmetically from the documented pitch', () => {
    expect(COLUMN_SPAN_MM).toBeCloseTo(29 * 2.54, 9);
    expect(BANK_SPAN_MM).toBeCloseTo(4 * 2.54, 9);
    expect(BREADBOARD_DIMENSION_PROVENANCE.COLUMN_SPAN_MM).toBe('derived');
    expect(BREADBOARD_DIMENSION_PROVENANCE.HOLE_PITCH_MM).toBe('documented');
  });

  it('centres the circuit area on the body', () => {
    const xs = model.holes.filter((h) => h.groupId.startsWith('strip:')).map((h) => h.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 9);
    const ys = model.holes.filter((h) => h.groupId.startsWith('strip:')).map((h) => h.y);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 9);
  });
});

describe('14-16: determinism and purity', () => {
  it('is byte-identical across repeated construction', () => {
    expect(JSON.stringify(createBreadboardModel())).toBe(JSON.stringify(createBreadboardModel()));
  });

  it('hands out fresh arrays, so one caller cannot corrupt another\'s model', () => {
    const a = createBreadboardModel();
    a.holes.length = 0;
    a.groups[0]?.holeIds.push('TAMPERED');
    const b = createBreadboardModel();
    expect(b.holes).toHaveLength(TOTAL_HOLES);
    expect(b.groups[0].holeIds).not.toContain('TAMPERED');
    expect(breadboardGroupMemberships()[0]).not.toContain('TAMPERED');
  });

  it('does not let generation order change semantic identity or membership', () => {
    // Sorting away the emission order must leave the same holes in the same groups.
    const normalise = (m: ReturnType<typeof createBreadboardModel>) =>
      JSON.stringify({
        holes: [...m.holes].sort((x, y) => x.id.localeCompare(y.id)).map((h) => [h.id, h.groupId, h.x, h.y]),
        groups: [...m.groups]
          .sort((x, y) => x.id.localeCompare(y.id))
          .map((g) => [g.id, g.kind, [...g.holeIds].sort()]),
      });
    expect(normalise(createBreadboardModel())).toBe(normalise(model));
  });

  it('embeds no render context, workspace position or rotation', () => {
    // Comments legitimately discuss three.js, rotation and "documented", so prose is stripped
    // first and only executable code is checked — otherwise this asserts nothing about the
    // module and everything about its wording.
    const code = read('packages/contracts/src/breadboard.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // The strongest available statement of purity: the module imports nothing at all.
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
    for (const forbidden of ['THREE', 'react', 'document', 'window', 'rotation', 'Vector3', 'canvas']) {
      expect(`${forbidden}:${new RegExp(`\\b${forbidden}\\b`, 'i').test(code)}`).toBe(`${forbidden}:false`);
    }

    const keys = new Set(model.holes.flatMap((h) => Object.keys(h)));
    expect([...keys].sort()).toEqual(['groupId', 'id', 'x', 'y']);
    expect(Object.keys(model).sort()).toEqual(['body', 'groups', 'holes']);
  });

  it('exposes the hole-id and membership helpers consistently with the model', () => {
    expect(breadboardHoleIds()).toEqual(model.holes.map((h) => h.id));
    const memberships = breadboardGroupMemberships();
    expect(memberships).toHaveLength(64);
    expect(memberships.flat()).toHaveLength(TOTAL_HOLES);
  });
});

describe('17-20: the rest of the application is untouched', () => {
  it('leaves ComponentKind byte-for-byte unchanged', () => {
    const circuit = read('packages/contracts/src/circuit.ts');
    expect(circuit).toContain(
      "export type ComponentKind =\n  | 'uno-r3'\n  | 'led'\n  | 'resistor'\n  | 'pushbutton'\n  | 'potentiometer'\n  | 'lcd1602'\n  | 'servo';",
    );
    expect(circuit).not.toContain('breadboard');
  });

  it('leaves the project schema at version 1 with no breadboard kind', () => {
    const schema = read('apps/desktop/src/main/projects/project-schema.ts');
    expect(schema).toContain(
      "kind: z.enum(['uno-r3', 'led', 'resistor', 'pushbutton', 'potentiometer', 'lcd1602', 'servo'])",
    );
    expect(schema).toContain('schemaVersion: z.literal(1)');
    expect(schema).not.toContain('breadboard');
  });

  it('is not exported from the contracts barrel, so nothing can reach it by accident', () => {
    const barrel = read('packages/contracts/src/index.ts');
    expect(barrel).not.toContain('breadboard');
  });

  it('is not imported by the simulator or the desktop application', () => {
    for (const rel of [
      'packages/simulator/src/circuit-model/component-registry.ts',
      'packages/simulator/src/netlist-compiler.ts',
      'apps/desktop/src/renderer/app/circuit/component-catalog.tsx',
      'apps/desktop/src/renderer/circuit/CircuitCanvas.tsx',
      'apps/desktop/src/renderer/app/circuit/DynamicNetlist3D.tsx',
      'apps/desktop/src/renderer/app/circuit/hardware/scene-obstacles.ts',
      'apps/desktop/src/renderer/app/circuit/hardware/wire-path.ts',
      'apps/desktop/src/renderer/state/store.ts',
    ]) {
      expect(`${rel}:${read(rel).includes('breadboard')}`).toBe(`${rel}:false`);
    }
  });

  it('adds no breadboard to any bundled example', () => {
    for (const name of ['blink', 'pushbutton', 'potentiometer', 'servo-sweep', 'lcd-hello-world']) {
      expect(read(`resources/examples/${name}/circuit.json`)).not.toContain('breadboard');
    }
  });
});

describe('the documentation tells the truth about what ships', () => {
  it('no longer claims a rendered breadboard or a Breadboard.tsx source file', () => {
    const notice = read('vendor/licenses/app-3d-assets/NOTICE.md');
    expect(notice).not.toContain('hardware/Breadboard.tsx`');
    expect(notice).toContain('parts-3d.tsx');
    expect(notice).not.toContain('hardware/parts.tsx');
    expect(notice).toContain('No breadboard is rendered');
  });

  it('no longer lists a breadboard.glb that does not exist', () => {
    const models = read('apps/desktop/src/renderer/public/assets/models/README.md');
    expect(models).not.toContain('- `breadboard.glb`');
    expect(models).toContain('contains no assets');
  });

  it('records the pinned sources with their revisions', () => {
    const doc = read('vendor/licenses/app-3d-assets/BREADBOARD_GEOMETRY_SOURCES.md');
    expect(doc).toContain('Rev 6');
    expect(doc).toContain('Rev 5');
    expect(doc).toContain('busboard.com/documents/datasheets');
    expect(doc).toContain('84 x 54.3 x 8.5mm');
    for (const heading of ['DOCUMENTED', 'DERIVED', 'APPROXIMATED']) expect(doc).toContain(heading);
  });
});
