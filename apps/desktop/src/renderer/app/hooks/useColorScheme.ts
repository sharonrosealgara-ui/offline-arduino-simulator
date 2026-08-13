/**
 * The theme the 2D canvas is being drawn against.
 *
 * The app themes itself entirely through `prefers-color-scheme` in global.css — there is no
 * theme store to read. SVG stroke colours are attributes, not CSS custom properties, so the
 * one canvas that has to pick a colour in JavaScript needs the media query directly.
 *
 * The 3D workspace does NOT use this: its bench is dark whatever the OS says.
 */
import { useSyncExternalStore } from 'react';
import type { WireRenderContext } from '../circuit/hardware/wire-colors';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
  // Guarded for environments without matchMedia (jsdom without a stub, older shells).
  const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;
  if (!list) return () => {};
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function readScheme(): WireRenderContext {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(QUERY).matches ? 'dark' : 'light';
}

/** Server snapshot is 'light', matching the CSS default before any media query applies. */
export function useColorScheme(): WireRenderContext {
  return useSyncExternalStore(subscribe, readScheme, () => 'light');
}
