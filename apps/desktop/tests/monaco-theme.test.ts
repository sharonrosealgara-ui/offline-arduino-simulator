/**
 * The code editor follows the app's theme.
 *
 * The regression: `monaco.editor.create` was called with no `theme` option and there was no
 * `defineTheme`/`setTheme` anywhere, so Monaco used its built-in `vs` (light) whatever the
 * OS was set to. In dark mode that was a white slab across ~42% of the window.
 *
 * Monaco is not booted here — it needs real layout and canvas measurement. The theme module
 * takes only the slice of the API it uses, so the decision, the registration, and the
 * subscription are all testable directly, which is where the bug actually was.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DARK_THEME,
  LIGHT_THEME,
  defineWorkbenchThemes,
  preferredTheme,
  syncMonacoTheme,
  type MonacoThemeApi,
  type MonacoThemeData,
} from '../src/renderer/editor/monaco-theme';

const globalCss = readFileSync(
  path.resolve(__dirname, '../src/renderer/styles/global.css'),
  'utf8',
);

function fakeApi(): MonacoThemeApi & {
  defined: Map<string, MonacoThemeData>;
  setTheme: ReturnType<typeof vi.fn>;
} {
  const defined = new Map<string, MonacoThemeData>();
  return {
    defined,
    defineTheme: (name, theme) => defined.set(name, theme),
    setTheme: vi.fn(),
  };
}

/** A MediaQueryList stand-in that can be flipped, as an OS theme switch would. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  return {
    matches,
    addEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
    emit(next: boolean) {
      for (const listener of listeners) listener({ matches: next });
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('theme choice', () => {
  it('picks the dark theme when the OS prefers dark', () => {
    expect(preferredTheme(true)).toBe(DARK_THEME);
  });

  it('picks the light theme otherwise', () => {
    expect(preferredTheme(false)).toBe(LIGHT_THEME);
  });

  it('never falls back to Monaco’s built-in themes', () => {
    // 'vs' is exactly what shipped, and it is what made the editor white in dark mode.
    expect([preferredTheme(true), preferredTheme(false)]).not.toContain('vs');
    expect([preferredTheme(true), preferredTheme(false)]).not.toContain('vs-dark');
  });
});

describe('registration', () => {
  it('defines both themes', () => {
    const api = fakeApi();
    defineWorkbenchThemes(api);

    expect([...api.defined.keys()].sort()).toEqual([DARK_THEME, LIGHT_THEME].sort());
  });

  it('gives the dark theme a dark editor background', () => {
    const api = fakeApi();
    defineWorkbenchThemes(api);

    const dark = api.defined.get(DARK_THEME)!;
    expect(dark.base).toBe('vs-dark');
    // The one thing a student would notice instantly if it regressed.
    expect(dark.colors['editor.background']).toBe('#24262c');
  });

  it('matches the workbench panel colours in both themes', () => {
    const api = fakeApi();
    defineWorkbenchThemes(api);

    // The editor background must be the panel colour, or the editor reads as a separate
    // surface floating in the workbench.
    const lightPanel = /--bg-panel:\s*(#[0-9a-f]{6})/i.exec(globalCss)?.[1];
    const darkPanel = /prefers-color-scheme: dark[\s\S]*?--bg-panel:\s*(#[0-9a-f]{6})/i.exec(globalCss)?.[1];

    expect(api.defined.get(LIGHT_THEME)!.colors['editor.background']).toBe(lightPanel);
    expect(api.defined.get(DARK_THEME)!.colors['editor.background']).toBe(darkPanel);
  });

  it('matches the workbench text colours in both themes', () => {
    const api = fakeApi();
    defineWorkbenchThemes(api);

    const lightText = /--text-primary:\s*(#[0-9a-f]{6})/i.exec(globalCss)?.[1];
    const darkText = /prefers-color-scheme: dark[\s\S]*?--text-primary:\s*(#[0-9a-f]{6})/i.exec(globalCss)?.[1];

    expect(api.defined.get(LIGHT_THEME)!.colors['editor.foreground']).toBe(lightText);
    expect(api.defined.get(DARK_THEME)!.colors['editor.foreground']).toBe(darkText);
  });
});

describe('staying in step with the OS', () => {
  it('applies the current preference immediately', () => {
    const api = fakeApi();
    syncMonacoTheme(api, fakeMedia(true));

    // Subscribing alone is not enough: a student who never changes their OS theme would
    // otherwise keep whatever Monaco defaulted to.
    expect(api.setTheme).toHaveBeenCalledWith(DARK_THEME);
  });

  it('follows a switch to dark and back', () => {
    const api = fakeApi();
    const media = fakeMedia(false);
    syncMonacoTheme(api, media);
    expect(api.setTheme).toHaveBeenLastCalledWith(LIGHT_THEME);

    media.emit(true);
    expect(api.setTheme).toHaveBeenLastCalledWith(DARK_THEME);

    media.emit(false);
    expect(api.setTheme).toHaveBeenLastCalledWith(LIGHT_THEME);
  });

  it('unsubscribes when the editor goes away', () => {
    const api = fakeApi();
    const media = fakeMedia(false);
    const stop = syncMonacoTheme(api, media);
    expect(media.listenerCount).toBe(1);

    stop();

    expect(media.listenerCount).toBe(0);
    media.emit(true);
    expect(api.setTheme).toHaveBeenCalledTimes(1); // the initial apply only
  });

  it('survives a media query object with no listener support', () => {
    const api = fakeApi();
    // Defensive: a bare { matches } must still get the initial apply, not throw.
    const stop = syncMonacoTheme(api, { matches: true });

    expect(api.setTheme).toHaveBeenCalledWith(DARK_THEME);
    expect(() => stop()).not.toThrow();
  });
});

describe('the editor asks for a theme at all', () => {
  it('passes one into monaco.editor.create', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/renderer/editor/MonacoSketchEditor.tsx'),
      'utf8',
    );
    // Creating without a theme is the original bug; the first paint would be `vs`.
    expect(source).toMatch(/monaco\.editor\.create\([\s\S]*?theme:\s*preferredTheme\(/);
    expect(source).toMatch(/defineWorkbenchThemes\(monaco\.editor\)/);
  });
});
