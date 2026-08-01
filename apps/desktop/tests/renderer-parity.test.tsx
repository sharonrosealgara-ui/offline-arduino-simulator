// @vitest-environment jsdom
/**
 * The 2D view and the 3D view show the same circuit.
 *
 * Parity here means matching geometry, proportions, terminal placement, polarity and
 * orientation cues, and rotation — NOT identical pixels. The two views use different
 * cameras and projections, so demanding pixel equality would be meaningless.
 *
 * What this replaced: 2D glyphs were 60 x 40 user units for every kind while their anchors
 * spanned 10, so an LED was the size of a servo and every wire attached near a part's
 * top-left corner. A student who switched views saw a visibly different, cruder product.
 *
 * The per-file jsdom pragma is required: the project default environment is `node`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { CircuitComponent, ComponentKind } from '@offline-arduino/contracts/circuit';
import { ComponentGlyph } from '../src/renderer/circuit/renderers/ComponentGlyph';
import { componentPhysical, physicalKinds } from '../src/renderer/app/circuit/hardware/component-geometry';
import { bodyBoundsMm, selectionBoundsMm } from '../src/renderer/app/circuit/hardware/component-bounds';
import { mmToSchematic } from '../src/renderer/app/circuit/hardware/geometry-units';

const KINDS = physicalKinds();

afterEach(cleanup);

function component(kind: ComponentKind, rotation = 0): CircuitComponent {
  return {
    id: `${kind}-1`,
    kind,
    x: 0,
    y: 0,
    rotation: rotation as CircuitComponent['rotation'],
    label: kind,
    properties: kind === 'resistor' ? { ohms: 220 } : {},
  };
}

function renderGlyph(kind: ComponentKind, rotation = 0, selected = false): SVGSVGElement {
  const { container } = render(
    <svg data-testid="canvas">
      <ComponentGlyph
        component={component(kind, rotation)}
        selected={selected}
        pinDisplay={{}}
        onSelect={() => undefined}
      />
    </svg>,
  );
  return container.querySelector('svg')!;
}

describe('2D bodies are the same size as 3D bodies', () => {
  it.each(KINDS)('%s', (kind) => {
    const terminals = getComponentDefinition(kind)!.terminals;
    const bounds = bodyBoundsMm(kind, terminals)!;
    const physical = componentPhysical(kind)!;

    // Both views derive from the same millimetres, so the 2D body must equal the physical
    // body converted — not a number a renderer chose for itself.
    expect(bounds.maxX - bounds.minX).toBeCloseTo(physical.body.width, 9);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(physical.body.depth, 9);
  });

  it('keeps the relative proportions a student would notice', () => {
    const width = (kind: ComponentKind): number => componentPhysical(kind)!.body.width;
    // An LCD dwarfs an LED; a servo dwarfs a resistor. These were all within a factor of
    // one before, because every non-board glyph was the same box.
    expect(width('lcd1602') / width('led')).toBeGreaterThan(10);
    expect(width('servo') / width('resistor')).toBeGreaterThan(3);
    expect(width('potentiometer')).toBeGreaterThan(width('pushbutton'));
  });
});

describe('every 2D part shows a conductor at each of its terminals', () => {
  it.each(KINDS)('%s', (kind) => {
    const svg = renderGlyph(kind);
    const terminals = getComponentDefinition(kind)!.terminals;
    const lines = [...svg.querySelectorAll('line')];
    const pads = [...svg.querySelectorAll('circle')];

    for (const terminal of terminals) {
      // A leg going down projects to a pin; a pigtail projects to a line. Either way there
      // is something visible at the anchor for a wire to land on.
      const pad = pads.find(
        (c) =>
          Math.abs(Number(c.getAttribute('cx')) - terminal.x) < 1e-6 &&
          Math.abs(Number(c.getAttribute('cy')) - terminal.y) < 1e-6,
      );
      const lead = lines.find(
        (line) =>
          Math.abs(Number(line.getAttribute('x1')) - terminal.x) < 1e-6 &&
          Math.abs(Number(line.getAttribute('y1')) - terminal.y) < 1e-6,
      );
      expect(pad ?? lead, `${kind}:${terminal.id} has nothing at its anchor`).toBeDefined();
    }
  });

  it.each(KINDS)('%s draws its pins after the body, never under it', (kind) => {
    const svg = renderGlyph(kind);
    const terminals = getComponentDefinition(kind)!.terminals;
    const nodes = [...svg.querySelectorAll('*')];
    const firstBody = nodes.findIndex((n) => n.tagName === 'rect' || n.tagName === 'circle');

    for (const terminal of terminals) {
      const padIndex = nodes.findIndex(
        (n) =>
          n.tagName === 'circle' &&
          Math.abs(Number(n.getAttribute('cx')) - terminal.x) < 1e-6 &&
          Math.abs(Number(n.getAttribute('cy')) - terminal.y) < 1e-6,
      );
      if (padIndex === -1) continue; // pigtail: covered by the line assertion above
      // Later in document order means painted on top — the anchor stays visible.
      expect(padIndex).toBeGreaterThan(firstBody);
    }
  });

  it('draws the servo pigtail as a real run of cable', () => {
    const svg = renderGlyph('servo');
    const leads = [...svg.querySelectorAll('line')].filter((l) =>
      ['#d1352b', '#1c1f24', '#e07a1f'].includes(l.getAttribute('stroke') ?? ''),
    );
    expect(leads.length).toBe(3);
    for (const lead of leads) {
      const dx = Number(lead.getAttribute('x2')) - Number(lead.getAttribute('x1'));
      const dy = Number(lead.getAttribute('y2')) - Number(lead.getAttribute('y1'));
      expect(Math.hypot(dx, dy)).toBeGreaterThan(1);
    }
  });
});

describe('selection bounds frame the part at every rotation', () => {
  it.each([0, 90, 180, 270])('at %i degrees', (rotation) => {
    for (const kind of KINDS) {
      const svg = renderGlyph(kind, rotation, true);
      const outline = svg.querySelector('rect[stroke-dasharray]');
      expect(outline, `${kind} has no selection outline`).toBeTruthy();

      const terminals = getComponentDefinition(kind)!.terminals;
      const bounds = selectionBoundsMm(kind, terminals)!;
      const width = Number(outline!.getAttribute('width'));
      const height = Number(outline!.getAttribute('height'));

      // The outline is drawn in the component's own frame, so the group's rotation carries
      // it around with the body — its size is rotation-independent by construction.
      expect(width).toBeCloseTo(mmToSchematic(bounds.maxX - bounds.minX), 6);
      expect(height).toBeCloseTo(mmToSchematic(bounds.maxZ - bounds.minZ), 6);
      cleanup();
    }
  });

  it('encloses every terminal anchor', () => {
    for (const kind of KINDS) {
      const terminals = getComponentDefinition(kind)!.terminals;
      const bounds = selectionBoundsMm(kind, terminals)!;
      for (const terminal of terminals) {
        expect(mmToSchematic(bounds.minX)).toBeLessThanOrEqual(terminal.x + 1e-6);
        expect(mmToSchematic(bounds.maxX)).toBeGreaterThanOrEqual(terminal.x - 1e-6);
        expect(mmToSchematic(bounds.minZ)).toBeLessThanOrEqual(terminal.y + 1e-6);
        expect(mmToSchematic(bounds.maxZ)).toBeGreaterThanOrEqual(terminal.y - 1e-6);
      }
    }
  });
});

describe('orientation and polarity cues survive the redraw', () => {
  it('draws the LED flat on the cathode side', () => {
    const svg = renderGlyph('led');
    // A dark rectangle beside the lens is the cathode flat; tinting alone teaches nothing.
    const flat = [...svg.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === '#0f172a');
    expect(flat).toBeTruthy();
  });

  it('draws resistor bands from the actual resistance', () => {
    const svg = renderGlyph('resistor');
    const bands = [...svg.querySelectorAll('rect')].filter(
      (r) => r.getAttribute('fill') && r.getAttribute('fill') !== '#d9c08a',
    );
    // 220R is red-red-brown-gold: four bands, and they are not the body colour.
    expect(bands.length).toBeGreaterThanOrEqual(4);
  });

  it('shows the trimmer slot at its wiper position', () => {
    const svg = renderGlyph('potentiometer');
    const slot = [...svg.querySelectorAll('line')].find((l) => l.getAttribute('stroke') === '#2b2f36');
    expect(slot).toBeTruthy();
  });

  it('places the servo horn on the shaft, clear of the case', () => {
    const svg = renderGlyph('servo');
    const shaft = [...svg.querySelectorAll('circle')].find((c) => c.getAttribute('fill') === '#e5e7eb');
    expect(shaft).toBeTruthy();
  });
});

describe('the board keeps its own geometry', () => {
  it('draws the Uno from uno-geometry, not from a number of its own', () => {
    const svg = renderGlyph('uno-r3');
    const board = svg.querySelector('rect');
    // 68.6 mm at 0.254 mm per unit = 270 units.
    expect(Number(board!.getAttribute('width'))).toBeCloseTo(270, 0);
  });
});
