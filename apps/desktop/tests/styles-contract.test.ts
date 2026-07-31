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
