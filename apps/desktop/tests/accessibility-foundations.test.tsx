// @vitest-environment jsdom
/**
 * Accessibility foundations from Phase A of the visual-fidelity plan.
 *
 * Two state signals had no accessible text at all: the unsaved-changes dot, which carried
 * its meaning in a `title` on a non-interactive span, and the serial send box, which had a
 * placeholder and nothing else. Both are things a student acts on.
 *
 * The per-file jsdom pragma is required: the project default environment is `node`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ComponentLibrary } from '../src/renderer/app/panels/ComponentLibrary';
import { VirtualSerialMonitor } from '../src/renderer/serial/VirtualSerialMonitor';
import { useAppStore } from '../src/renderer/state/store';

const globalCss = readFileSync(
  path.resolve(__dirname, '../src/renderer/styles/global.css'),
  'utf8',
);

beforeEach(() => {
  vi.stubGlobal('electronAPI', {});
  useAppStore.setState((s) => ({ project: { ...s.project, dirty: false } }));
});

afterEach(cleanup);

describe('the unsaved-changes indicator', () => {
  it('is announced in words, not just drawn as a dot', () => {
    useAppStore.setState((s) => ({ project: { ...s.project, dirty: true } }));

    render(<ComponentLibrary />);

    // `title` on a span is not reliably announced and never shows on keyboard focus.
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('says nothing when there is nothing to say', () => {
    render(<ComponentLibrary />);

    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('hides the decorative glyph from assistive technology', () => {
    useAppStore.setState((s) => ({ project: { ...s.project, dirty: true } }));

    render(<ComponentLibrary />);

    const dot = screen.getByText('●');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the serial monitor controls', () => {
  it('names the send box', () => {
    render(<VirtualSerialMonitor />);

    // A placeholder is a hint, not a name, and it disappears the moment they type.
    expect(screen.getByLabelText(/send text to the running sketch/i)).toBeTruthy();
  });

  it('names the line-ending dropdown', () => {
    render(<VirtualSerialMonitor />);

    expect(screen.getByLabelText(/line ending/i)).toBeTruthy();
  });

  it('keeps the visible placeholder for sighted users', () => {
    render(<VirtualSerialMonitor />);

    expect(screen.getByPlaceholderText('Send to sketch…')).toBeTruthy();
  });
});

describe('focus stays visible', () => {
  it('keeps the global focus ring', () => {
    expect(globalCss).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/);
  });

  it('never switches an outline off', () => {
    expect(globalCss).not.toMatch(/outline:\s*none/);
  });

  it('draws the ring inside controls that sit against a clipping edge', () => {
    // Panes and tab strips set overflow: hidden, which would clip a ring drawn 2px outside
    // the first or last control in them.
    expect(globalCss).toMatch(/\.tabBar__tab:focus-visible[\s\S]*?outline-offset:\s*-2px/);
  });

  it('provides a screen-reader-only text utility', () => {
    expect(globalCss).toMatch(/\.visuallyHidden\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
  });
});
