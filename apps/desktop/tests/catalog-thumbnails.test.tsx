// @vitest-environment jsdom
/**
 * Library thumbnails: recognisable at 32 x 32, in proportion, and inside their box.
 *
 * These are normalised per icon on purpose. Real relative scale across the catalog would
 * make the LED a dot beside the LCD and the resistor a hair — useless in a list you pick
 * from. What each icon must keep is its own aspect ratio, its orientation, and the cues that
 * tell one part from another: the LED's flat, the resistor's bands, the trimmer's screw, the
 * servo's three-wire pigtail, the LCD's header.
 *
 * The per-file jsdom pragma is required: the project default environment is `node`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { COMPONENT_CATALOG, catalogEntry } from '../src/renderer/app/circuit/component-catalog';
import { componentPhysical, physicalKinds } from '../src/renderer/app/circuit/hardware/component-geometry';

afterEach(cleanup);

function renderThumb(kind: (typeof COMPONENT_CATALOG)[number]['kind']): SVGSVGElement {
  const entry = catalogEntry(kind)!;
  const { container } = render(<div>{entry.thumbnail}</div>);
  return container.querySelector('svg')!;
}

const KINDS = physicalKinds();

describe('every catalog part has an icon', () => {
  it('covers the whole catalog', () => {
    expect(COMPONENT_CATALOG.length).toBe(6);
    for (const entry of COMPONENT_CATALOG) {
      expect(entry.thumbnail, `${entry.kind} has no thumbnail`).toBeTruthy();
    }
  });

  it('renders something visible for each', () => {
    for (const entry of COMPONENT_CATALOG) {
      const svg = renderThumb(entry.kind);
      expect(svg.querySelectorAll('*').length, `${entry.kind} icon is empty`).toBeGreaterThan(2);
      cleanup();
    }
  });
});

describe('icons stay inside their 32 x 32 box', () => {
  it.each(KINDS)('%s', (kind) => {
    const svg = renderThumb(kind);
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');

    for (const rect of svg.querySelectorAll('rect')) {
      const x = Number(rect.getAttribute('x') ?? 0);
      const y = Number(rect.getAttribute('y') ?? 0);
      const w = Number(rect.getAttribute('width') ?? 0);
      const h = Number(rect.getAttribute('height') ?? 0);
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(x + w).toBeLessThanOrEqual(32.01);
      expect(y + h).toBeLessThanOrEqual(32.01);
    }
    for (const circle of svg.querySelectorAll('circle')) {
      const cx = Number(circle.getAttribute('cx'));
      const cy = Number(circle.getAttribute('cy'));
      const r = Number(circle.getAttribute('r'));
      expect(cx - r).toBeGreaterThanOrEqual(-0.01);
      expect(cy - r).toBeGreaterThanOrEqual(-0.01);
      expect(cx + r).toBeLessThanOrEqual(32.01);
      expect(cy + r).toBeLessThanOrEqual(32.01);
    }
  });
});

describe('icons keep the shared proportions', () => {
  it.each(KINDS)('%s body aspect follows the physical table', (kind) => {
    const svg = renderThumb(kind);
    const physical = componentPhysical(kind)!;
    const expected = physical.body.width / physical.body.depth;

    // The largest rect is the body; a square part must not be drawn oblong and vice versa.
    const rects = [...svg.querySelectorAll('rect')].map((r) => ({
      w: Number(r.getAttribute('width') ?? 0),
      h: Number(r.getAttribute('height') ?? 0),
    }));
    // The LED is a round part drawn from circles; its only rect is the cathode flat, which
    // is a cue rather than a body.
    if (rects.length === 0 || kind === 'led') return;
    const body = rects.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
    const drawn = body.w / body.h;

    // Within 20%: the icons round to whole units and add a margin, so this checks the
    // proportion is honest rather than pixel-exact.
    expect(Math.abs(drawn - expected) / expected).toBeLessThan(0.2);
  });

  it('does not scale parts against each other', () => {
    // An LCD is 16 times an LED across in the workspace. In the tray they are both legible.
    const lcd = renderThumb('lcd1602');
    cleanup();
    const led = renderThumb('led');
    const lcdBody = [...lcd.querySelectorAll('rect')].reduce((a, b) =>
      Number(a.getAttribute('width')) >= Number(b.getAttribute('width')) ? a : b,
    );
    const ledLens = [...led.querySelectorAll('circle')].reduce((a, b) =>
      Number(a.getAttribute('r')) >= Number(b.getAttribute('r')) ? a : b,
    );
    expect(Number(lcdBody.getAttribute('width'))).toBeGreaterThan(10);
    expect(Number(ledLens.getAttribute('r')) * 2).toBeGreaterThan(10);
  });
});

describe('the cues that tell parts apart survive normalisation', () => {
  it('LED keeps its cathode flat', () => {
    const svg = renderThumb('led');
    expect([...svg.querySelectorAll('rect')].some((r) => r.getAttribute('fill') === '#0f172a')).toBe(true);
  });

  it('resistor keeps four colour bands', () => {
    const svg = renderThumb('resistor');
    const bands = [...svg.querySelectorAll('rect')].filter((r) => r.getAttribute('fill') !== '#d9c08a');
    expect(bands.length).toBe(4);
  });

  it('pushbutton keeps four legs', () => {
    const svg = renderThumb('pushbutton');
    const legs = [...svg.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === '#c9ced6');
    expect(legs.length).toBe(4);
  });

  it('trimmer keeps its adjustment screw and three pins', () => {
    const svg = renderThumb('potentiometer');
    expect([...svg.querySelectorAll('circle')].some((c) => c.getAttribute('fill') === '#d8dde3')).toBe(true);
    expect([...svg.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === '#c9ced6').length).toBe(3);
  });

  it('servo keeps a three-wire pigtail in JR colours', () => {
    const svg = renderThumb('servo');
    const colors = [...svg.querySelectorAll('line')].map((l) => l.getAttribute('stroke'));
    expect(colors).toContain('#d1352b');
    expect(colors).toContain('#1c1f24');
    expect(colors).toContain('#e07a1f');
  });

  it('LCD keeps its viewing area and header', () => {
    const svg = renderThumb('lcd1602');
    const fills = [...svg.querySelectorAll('rect')].map((r) => r.getAttribute('fill'));
    expect(fills).toContain('#7fa63a'); // viewing area
    expect(fills).toContain('#15161a'); // header
  });
});
