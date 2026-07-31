/**
 * Monaco themes that match the workbench.
 *
 * The editor was created with no `theme` option at all, so Monaco used its built-in `vs`
 * (light) theme whatever the OS was set to. In dark mode that left a white slab across
 * roughly 42% of the window — the pane students look at most, and the most visible thing
 * wrong with the product before any detail is examined.
 *
 * Colours are literals rather than `var(--…)` because Monaco's theme API takes resolved
 * hex, not CSS custom properties. They are copied from the tokens in styles/global.css and
 * must be changed together with them — monaco-theme.test.ts pins the pairs that matter.
 *
 * Everything here is local: Monaco and its workers are bundled (see monaco-setup.ts), and a
 * theme is plain data. Nothing is fetched.
 */

export const LIGHT_THEME = 'oas-light';
export const DARK_THEME = 'oas-dark';

/** The subset of `monaco.editor` this module needs, so it can be tested without booting Monaco. */
export interface MonacoThemeApi {
  defineTheme(name: string, theme: MonacoThemeData): void;
  setTheme(name: string): void;
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>;
  colors: Record<string, string>;
}

/** Matches `--bg-panel` / `--text-primary` / `--text-secondary` / `--accent` in global.css. */
const LIGHT: MonacoThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '4a4f58', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0a5fd6' },
    { token: 'number', foreground: '157a3d' },
    { token: 'string', foreground: 'b3261e' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#14161a',
    'editorLineNumber.foreground': '#4a4f58',
    'editorLineNumber.activeForeground': '#14161a',
    'editorCursor.foreground': '#0a5fd6',
    'editor.selectionBackground': '#0a5fd633',
    'editor.lineHighlightBackground': '#eef0f3',
    'editorIndentGuide.background': '#c7ccd4',
  },
};

/** Matches the `prefers-color-scheme: dark` token block in global.css. */
const DARK: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: 'b7bcc6', fontStyle: 'italic' },
    { token: 'keyword', foreground: '6ea8ff' },
    { token: 'number', foreground: '4fd486' },
    { token: 'string', foreground: 'ff8079' },
  ],
  colors: {
    'editor.background': '#24262c',
    'editor.foreground': '#f2f3f5',
    'editorLineNumber.foreground': '#b7bcc6',
    'editorLineNumber.activeForeground': '#f2f3f5',
    'editorCursor.foreground': '#6ea8ff',
    'editor.selectionBackground': '#6ea8ff44',
    'editor.lineHighlightBackground': '#2b2e35',
    'editorIndentGuide.background': '#3c3f47',
  },
};

export function defineWorkbenchThemes(api: MonacoThemeApi): void {
  api.defineTheme(LIGHT_THEME, LIGHT);
  api.defineTheme(DARK_THEME, DARK);
}

export function preferredTheme(prefersDark: boolean): string {
  return prefersDark ? DARK_THEME : LIGHT_THEME;
}

/** The slice of MediaQueryList used here — older Electron/WebKit only has add/removeListener. */
export interface ThemeMediaQuery {
  matches: boolean;
  addEventListener?(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener?(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

/**
 * Applies the theme now and keeps it in step with the OS. Returns an unsubscribe function.
 *
 * Applying immediately matters as much as subscribing: the editor is created before this
 * runs, and a student who never changes their OS theme mid-lesson would otherwise keep
 * whatever Monaco defaulted to.
 */
export function syncMonacoTheme(api: MonacoThemeApi, media: ThemeMediaQuery): () => void {
  api.setTheme(preferredTheme(media.matches));

  const onChange = (event: { matches: boolean }): void => {
    api.setTheme(preferredTheme(event.matches));
  };
  media.addEventListener?.('change', onChange);
  return () => media.removeEventListener?.('change', onChange);
}
