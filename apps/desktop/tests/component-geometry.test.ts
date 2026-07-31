/**
 * The physical geometry table is the single source of component size.
 *
 * These tests guard two things that are easy to lose: the numbers themselves matching the
 * manufacturer references recorded in COMPONENT_FOOTPRINTS.md, and the module staying free
 * of terminal coordinates. The second matters more. `component-registry.ts` is the only
 * authority for where a terminal is; the moment a convenient x/y appears here, the drawing
 * and the wiring have two sources of truth and will drift.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { componentPhysical, physicalKinds } from '../src/renderer/app/circuit/hardware/component-geometry';
import { getComponentDefinition } from '@offline-arduino/simulator';

const geometrySource = readFileSync(
  path.resolve(__dirname, '../src/renderer/app/circuit/hardware/component-geometry.ts'),
  'utf8',
);
const footprintDoc = readFileSync(
  path.resolve(__dirname, '../../../vendor/licenses/app-3d-assets/COMPONENT_FOOTPRINTS.md'),
  'utf8',
);

describe('sourced dimensions', () => {
  it('LED matches the Kingbright WP7113ID package figures', () => {
    const led = componentPhysical('led')!;
    expect(led.body.width).toBe(5.0); // lens diameter
    expect(led.body.height).toBe(8.6); // package length
    expect(led.features.flangeDiameter).toBe(5.9);
    expect(led.features.flangeThickness).toBe(1.0);
  });

  it('resistor matches the Yageo CFR-25 dimension table', () => {
    const r = componentPhysical('resistor')!;
    expect(r.body.width).toBe(6.3); // L
    expect(r.body.depth).toBe(2.4); // D
    expect(r.conductors.a.radius).toBeCloseTo(0.55 / 2, 5); // d
  });

  it('pushbutton matches the Omron B3F-1000 drawing', () => {
    const b = componentPhysical('pushbutton')!;
    expect(b.body.width).toBe(6.0);
    expect(b.body.depth).toBe(6.0);
    expect(b.body.height).toBe(4.3);
    expect(b.features.plungerDiameter).toBe(3.5);
  });

  it('potentiometer matches the Bourns 3386P square body', () => {
    const p = componentPhysical('potentiometer')!;
    expect(p.body.width).toBe(9.53);
    expect(p.body.depth).toBe(9.53);
    expect(p.conductors.wiper.radius).toBeCloseTo(0.51 / 2, 5);
  });

  it('servo matches the TowerPro SG90 overall dimensions', () => {
    const s = componentPhysical('servo')!;
    expect(s.body.width).toBe(23.0);
    expect(s.body.depth).toBe(12.2);
    expect(s.body.height).toBe(29.0);
    // Not rigid pins: the SG90 has a flying JR lead.
    expect(Object.values(s.conductors).every((c) => c.exit === 'pigtail')).toBe(true);
  });

  it('LCD matches the Newhaven NHD-0216K1Z-FL-YBW mechanical drawing', () => {
    const lcd = componentPhysical('lcd1602')!;
    expect(lcd.body.width).toBe(80.0);
    expect(lcd.body.depth).toBe(36.0);
    expect(lcd.features.bezelWidth).toBe(71.2);
    expect(lcd.features.bezelDepth).toBe(25.2);
    expect(lcd.features.viewWidth).toBe(66.0);
    expect(lcd.features.viewDepth).toBe(16.0);
  });
});

describe('single source of size', () => {
  it('covers every electrical component kind the registry knows', () => {
    for (const kind of physicalKinds()) {
      expect(getComponentDefinition(kind)).toBeDefined();
    }
    // The board is deliberately absent: uno-geometry.ts owns it and must not be restated.
    expect(physicalKinds()).not.toContain('uno-r3');
  });

  it('names a conductor for every registry terminal, and no others', () => {
    for (const kind of physicalKinds()) {
      const registry = getComponentDefinition(kind)!;
      const declared = Object.keys(componentPhysical(kind)!.conductors).sort();
      const expected = registry.terminals.map((t) => t.id).sort();
      expect(declared).toEqual(expected);
    }
  });

  it('stores no terminal coordinate of any kind', () => {
    // A conductor entry carries shape only. Coordinates come from the registry, through the
    // canonical transform, every time.
    const conductorBlocks = geometrySource.match(/conductors:\s*\{[\s\S]*?\n\s*\}/g) ?? [];
    expect(conductorBlocks.length).toBeGreaterThan(0);
    for (const block of conductorBlocks) {
      expect(block).not.toMatch(/\b[xyz]\s*:/);
    }
  });

  it('does not restate the body size in the selection metadata', () => {
    for (const kind of physicalKinds()) {
      const p = componentPhysical(kind)!;
      const keys = Object.keys(p.selection);
      expect(keys).toEqual(['paddingMm', 'minSizeMm']);
      // A minimum is a floor, not a copy of the body.
      expect(p.selection.minSizeMm).not.toBe(p.body.width);
    }
  });
});

describe('provenance is recorded', () => {
  it('documents every component with a reference part', () => {
    for (const part of [
      'WP7113ID',
      'CFR-25',
      'B3F-1000',
      '3386P-1-103LF',
      'SG90',
      'NHD-0216K1Z-FL-YBW',
    ]) {
      expect(footprintDoc).toContain(part);
    }
  });

  it('separates what was read from a document from what was authorised', () => {
    expect(footprintDoc).toMatch(/read from the (table|drawing|page|document)/i);
    expect(footprintDoc).toMatch(/authorised figure/i);
    // The two figures that rest on inference say so.
    expect(footprintDoc).toMatch(/HTTP 403/);
    expect(footprintDoc).toMatch(/inference/i);
  });

  it('flags the educational rendering conventions rather than passing them off as sourced', () => {
    expect(footprintDoc).toMatch(/Educational rendering convention/);
    expect(footprintDoc).toMatch(/27 min/); // the unformed lead length we deliberately do not draw
  });

  it('vendors no datasheet PDF', () => {
    expect(footprintDoc).toMatch(/No datasheet PDF is vendored/i);
  });
});
