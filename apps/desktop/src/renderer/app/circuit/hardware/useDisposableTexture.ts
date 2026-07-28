/**
 * Texture lifetime helper.
 *
 * R3F auto-disposes geometries and materials it created from declarative JSX elements, but
 * a CanvasTexture built imperatively in useMemo is NOT tracked by anything — without an
 * explicit dispose it leaks GPU memory every time the 3D pane unmounts or a label's text
 * changes. This hook ties a texture's lifetime to the component that made it.
 */
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';

/**
 * Builds a texture from `factory`, rebuilding whenever `deps` change, and disposing the
 * previous texture as well as the final one on unmount.
 */
export function useDisposableTexture<T extends THREE.Texture>(
  factory: () => T,
  deps: React.DependencyList,
): T {
  const previous = useRef<T | null>(null);

  // The dep list is deliberately the caller's contract (this is a generic hook, so the
  // linter cannot verify it) and `factory` is intentionally excluded — callers pass a
  // fresh closure each render, and including it would rebuild the texture every frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const texture = useMemo(() => {
    previous.current?.dispose();
    const created = factory();
    previous.current = created;
    return created;
  }, deps);

  useEffect(
    () => () => {
      previous.current?.dispose();
      previous.current = null;
    },
    [],
  );

  return texture;
}
