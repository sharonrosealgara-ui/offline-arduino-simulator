/**
 * How the workbench divides its width at the resolutions this ships to.
 *
 * The regression these guard: `--editor-width: 42%` resolved against the WHOLE grid, so the
 * fixed side panels came out of the 3D workspace instead of being shared. The circuit — the
 * thing the product exists to show — ended up the narrowest pane on exactly the classroom
 * laptops it targets.
 *
 * jsdom does not run a grid layout engine, so these test the two things that are actually
 * testable and that together determine the result: the arithmetic the CSS mirrors
 * (workbench-region.ts), and the shipped CSS itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_PERCENT,
  MAX_EDITOR_PERCENT,
  MIN_EDITOR_PERCENT,
  SPLITTER_SIZE,
  clampEditorPercent,
  editorTrackWidth,
  flexibleRegionWidth,
  pointerDeltaToEditorPercent,
  workspaceTrackWidth,
} from '../src/renderer/app/layout/workbench-region';

const globalCss = readFileSync(
  path.resolve(__dirname, '../src/renderer/styles/global.css'),
  'utf8',
);

/** Panel widths per the media queries in global.css. */
function panelsFor(containerWidth: number): { libraryWidth: number; inspectorWidth: number } {
  if (containerWidth <= 1240) return { libraryWidth: 168, inspectorWidth: 208 };
  if (containerWidth <= 1500) return { libraryWidth: 188, inspectorWidth: 232 };
  return { libraryWidth: 212, inspectorWidth: 268 };
}

function widthsAt(containerWidth: number): {
  containerWidth: number;
  libraryWidth: number;
  inspectorWidth: number;
} {
  return { containerWidth, ...panelsFor(containerWidth) };
}

const SUPPORTED = [1280, 1366, 1440, 1920];

describe('the supported resolutions keep a usable workspace', () => {
  it.each(SUPPORTED)('gives the workspace at least as much room as the editor at %ipx', (width) => {
    const widths = widthsAt(width);
    const editor = editorTrackWidth(widths, DEFAULT_EDITOR_PERCENT);
    const workspace = workspaceTrackWidth(widths, DEFAULT_EDITOR_PERCENT);

    // 42% to the editor means 58% to the workspace. Under the old model the workspace got
    // 316px at 1280 while the editor got 538 — the ratio said one thing and the layout did
    // the opposite.
    expect(workspace).toBeGreaterThan(editor);
  });

  it.each(SUPPORTED)('leaves the workspace wide enough to read a board at %ipx', (width) => {
    // 480px is about where an Uno plus a wired part stops being legible at default zoom.
    expect(workspaceTrackWidth(widthsAt(width), DEFAULT_EDITOR_PERCENT)).toBeGreaterThanOrEqual(480);
  });

  it.each(SUPPORTED)('never over-subscribes the row at %ipx', (width) => {
    const widths = widthsAt(width);
    const total =
      widths.libraryWidth +
      editorTrackWidth(widths, DEFAULT_EDITOR_PERCENT) +
      SPLITTER_SIZE +
      workspaceTrackWidth(widths, DEFAULT_EDITOR_PERCENT) +
      widths.inspectorWidth;

    // Over-subscription is what pushed the inspector off-screen and produced page-level
    // horizontal scrolling.
    expect(total).toBeCloseTo(width, 5);
  });

  it('still gives the editor a workable share at the narrowest supported width', () => {
    expect(editorTrackWidth(widthsAt(1280), DEFAULT_EDITOR_PERCENT)).toBeGreaterThanOrEqual(340);
  });
});

describe('flexible region', () => {
  it('is what is left after both panels and the splitter', () => {
    expect(flexibleRegionWidth({ containerWidth: 1000, libraryWidth: 200, inspectorWidth: 250 })).toBe(
      1000 - 200 - 250 - SPLITTER_SIZE,
    );
  });

  it('grows when a panel is toggled off', () => {
    const both = flexibleRegionWidth({ containerWidth: 1366, libraryWidth: 188, inspectorWidth: 232 });
    const neither = flexibleRegionWidth({ containerWidth: 1366, libraryWidth: 0, inspectorWidth: 0 });
    expect(neither - both).toBe(188 + 232);
  });

  it('never goes negative when the panels over-subscribe a narrow window', () => {
    expect(flexibleRegionWidth({ containerWidth: 300, libraryWidth: 200, inspectorWidth: 250 })).toBe(0);
  });
});

describe('splitter gearing', () => {
  it('moves the boundary by the distance the pointer moved', () => {
    const widths = widthsAt(1366);
    const flexible = flexibleRegionWidth(widths);
    const percentDelta = pointerDeltaToEditorPercent(widths, 100);

    // A 100px drag must move the track 100px. Measured against the window instead of the
    // flexible region, the same drag moved it by ~100 * flexible/window — geared wrong, and
    // wrong by a different amount depending on whether the panels were open.
    expect((flexible * percentDelta) / 100).toBeCloseTo(100, 6);
  });

  it('is unitless-safe when there is no room to divide', () => {
    expect(pointerDeltaToEditorPercent({ containerWidth: 0, libraryWidth: 0, inspectorWidth: 0 }, 50)).toBe(0);
  });

  it('clamps to the same range the splitter advertises', () => {
    expect(clampEditorPercent(5)).toBe(MIN_EDITOR_PERCENT);
    expect(clampEditorPercent(99)).toBe(MAX_EDITOR_PERCENT);
    expect(clampEditorPercent(DEFAULT_EDITOR_PERCENT)).toBe(DEFAULT_EDITOR_PERCENT);
  });

  it('keeps both panes usable at either extreme of the clamp', () => {
    const widths = widthsAt(1280);
    expect(workspaceTrackWidth(widths, MAX_EDITOR_PERCENT)).toBeGreaterThan(200);
    expect(editorTrackWidth(widths, MIN_EDITOR_PERCENT)).toBeGreaterThan(200);
  });
});

describe('the stylesheet mirrors this arithmetic', () => {
  it('sizes the editor track from the flexible region, not the window', () => {
    expect(globalCss).toMatch(/--editor-ratio:\s*0\.42/);
    expect(globalCss).toMatch(
      /calc\(\s*\(100%\s*-\s*var\(--library-width\)\s*-\s*var\(--inspector-width\)\s*-\s*var\(--splitter-size\)\)\s*\*\s*var\(--editor-ratio\)\s*\)/,
    );
  });

  it('no longer resolves a raw percentage against the whole grid', () => {
    // Anchored to a real declaration: the rule's comment quotes the old value on purpose,
    // so a bare substring search would match the explanation of the fix.
    expect(globalCss).not.toMatch(/^\s*--editor-width:\s*\d+%\s*;/m);
  });

  it('agrees with the splitter width used in the arithmetic', () => {
    expect(globalCss).toMatch(new RegExp(`--splitter-size:\\s*${SPLITTER_SIZE}px`));
  });
});
