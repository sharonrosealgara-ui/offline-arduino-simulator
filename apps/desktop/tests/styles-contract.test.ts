/**
 * Rules the stylesheets must keep, checked against the real CSS rather than a model of it.
 *
 * These are invariants Phase A of the visual-fidelity plan established. They are easy to
 * undo by accident — a "just this once" 10px chip, a compact button that shrinks below the
 * touch floor — and none of them fails a typecheck, a lint, or any behavioural test. So
 * they are pinned here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = path.resolve(__dirname, '../src/renderer');
const globalCss = readFileSync(path.join(rendererRoot, 'styles/global.css'), 'utf8');
const workbenchCss = readFileSync(path.join(rendererRoot, 'styles/workbench.css'), 'utf8');
const allCss = `${globalCss}\n${workbenchCss}`;

/** Every `font-size: <n>px` literal in the sheets, with the line it came from. */
function fontSizeLiterals(css: string): Array<{ value: number; line: number }> {
  return css
    .split('\n')
    .map((line, index) => ({ line: index + 1, match: /font-size:\s*([\d.]+)px/.exec(line) }))
    .filter((entry): entry is { line: number; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ value: Number(entry.match[1]), line: entry.line }));
}

function tokenValue(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(globalCss);
  if (!match) throw new Error(`token ${name} not found in global.css`);
  return match[1].trim();
}

describe('text is never smaller than the readable floor', () => {
  it('declares a 12px floor token', () => {
    expect(tokenValue('--font-size-xs')).toBe('12px');
  });

  it('has no font-size literal below the floor anywhere in the stylesheets', () => {
    // What this replaced: 10px state chips (WIRED/OPEN) and severity labels, 10.5px kbd
    // hints, 11px card summaries and panel headings — all carrying meaning, all below the
    // size the project's own stylesheet header promised.
    const tooSmall = fontSizeLiterals(allCss).filter((entry) => entry.value < 12);
    expect(tooSmall).toEqual([]);
  });

  it('uses no fractional font sizes', () => {
    // 10.5 / 11.5 / 12.5 / 13.5px round inconsistently at 100% on low-DPI panels.
    const fractional = fontSizeLiterals(allCss).filter((entry) => !Number.isInteger(entry.value));
    expect(fractional).toEqual([]);
  });

  it('keeps 14px body text', () => {
    expect(tokenValue('--font-size-md')).toBe('14px');
    expect(globalCss).toMatch(/body\s*\{[^}]*font-size:\s*(?:14px|var\(--font-size-md\))/s);
  });
});

describe('interactive targets meet one standard', () => {
  it('declares a single 32px minimum token', () => {
    expect(tokenValue('--hit-target-min')).toBe('32px');
  });

  it('has no interactive rule declaring a smaller minimum', () => {
    // .iconBtn was 26, .btn--compact 26, .viewportBtn 28, .placedRow__select and .textInput
    // 30 — each overriding the global rule simply by being more specific. The rotate and
    // delete buttons on a placed part were the smallest targets in the app.
    //
    // Scoped to controls on purpose: a non-interactive strip like .statusBar is entitled to
    // be 26px tall, and a rule that flagged it would be noise the next person switches off.
    const INTERACTIVE = [
      '.btn',
      '.btn--compact',
      '.iconBtn',
      '.viewportBtn',
      '.placedRow__select',
      '.textInput',
      '.selectInput',
      '.linkBtn',
      '.modalHeader__close',
      '.tabBar__tab',
    ];
    const violations: string[] = [];
    for (const [, selector, body] of allCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const names = selector.trim();
      if (!INTERACTIVE.some((name) => new RegExp(`\\${name}(?![\\w-])`).test(names))) continue;
      for (const [, value] of body.matchAll(/min-(?:height|width):\s*(\d+)px/g)) {
        if (Number(value) > 0 && Number(value) < 32) violations.push(`${names.replace(/\s+/g, ' ')} -> ${value}px`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('covers dropdowns, which the button-only rule missed', () => {
    expect(globalCss).toMatch(/button,\s*\n?select\s*\{[^}]*min-height:\s*var\(--hit-target-min\)/s);
  });

  it('states one standard, in both stylesheets', () => {
    // The two files used to document different numbers (36x36 vs >= 26px), which is why
    // neither was kept.
    expect(globalCss).toMatch(/32x32/);
    expect(workbenchCss).toMatch(/32x32/);
    expect(globalCss).not.toMatch(/minimum interactive target 36x36 \(prefer 40x40\)\.\n \*\//);
    expect(workbenchCss).not.toMatch(/Interactive targets are >= 26px/);
  });
});
