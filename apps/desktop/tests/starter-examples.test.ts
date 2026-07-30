/**
 * Starter Library contents.
 *
 * The library is the only way a student discovers a feature, and it renders a hardcoded
 * STARTER_TEMPLATES array rather than reading resources/examples/. The Pushbutton example
 * shipped in the packaged resources but was absent from that array, so the interactive
 * pushbutton was undiscoverable in the product.
 *
 * These tests keep the two in step: the template must exist, and its sketch and wiring must
 * remain identical to the packaged example so the student-facing copy cannot silently drift
 * from the one on disk.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES, templateToProjectFile } from '../src/renderer/app/dialogs/examples-data';

const EXAMPLES = path.resolve(__dirname, '..', '..', '..', 'resources', 'examples');
const read = (...p: string[]) => readFileSync(path.join(EXAMPLES, ...p), 'utf8').replace(/\r\n/g, '\n');

describe('starter library contents', () => {
  it('offers every expected template, with none dropped', () => {
    expect(STARTER_TEMPLATES.map((t) => t.id)).toEqual([
      'blink',
      'pushbutton',
      'pot-pwm',
      'servo-sweep',
      'lcd-1602',
    ]);
  });

  it('numbers the titles contiguously from 01', () => {
    STARTER_TEMPLATES.forEach((t, i) => {
      expect(t.title, t.id).toMatch(new RegExp(`^0${i + 1}\. `));
    });
  });

  it('gives every template an icon the modal can render', () => {
    for (const t of STARTER_TEMPLATES) {
      expect(['blink', 'analog', 'motion', 'display', 'input'], t.id).toContain(t.icon);
    }
  });
});

describe('pushbutton template matches the packaged example', () => {
  const template = STARTER_TEMPLATES.find((t) => t.id === 'pushbutton')!;

  it('is present in the library', () => {
    expect(template).toBeDefined();
    expect(template.title).toContain('Pushbutton');
  });

  it('reuses the packaged sketch verbatim rather than a divergent copy', () => {
    expect(template.ino.replace(/\r\n/g, '\n')).toBe(read('pushbutton', 'Sketch.ino'));
  });

  it('uses INPUT_PULLUP and active-low reading', () => {
    expect(template.ino).toContain('INPUT_PULLUP');
    // Pressed reads LOW — the whole point of the internal pull-up.
    expect(template.ino).toMatch(/digitalRead\(\s*BUTTON_PIN\s*\)\s*==\s*LOW/);
  });

  it('wires D2 to one leg and the other leg to GND, matching the packaged circuit', () => {
    const packaged = JSON.parse(read('pushbutton', 'circuit.json'));
    const asPairs = (c: { wires: Array<{ from: { componentId: string; terminalId: string }; to: { componentId: string; terminalId: string } }> }) =>
      c.wires
        .map((w) => [`${w.from.componentId}.${w.from.terminalId}`, `${w.to.componentId}.${w.to.terminalId}`].sort().join(' <-> '))
        .sort();

    expect(asPairs(template.circuit)).toEqual(asPairs(packaged));
  });

  it('adds no pull-down resistor, which would contradict INPUT_PULLUP', () => {
    expect(template.circuit.components.some((c) => c.kind === 'resistor')).toBe(false);
  });

  it('loads into a valid project file', () => {
    const project = templateToProjectFile(template);
    expect(project.sources['Sketch.ino']).toBe(template.ino);
    expect(project.circuit.components.map((c) => c.kind)).toEqual(['uno-r3', 'pushbutton']);
    expect(project.boardId).toBe('uno');
  });
});
