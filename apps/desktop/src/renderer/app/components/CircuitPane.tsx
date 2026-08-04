/**
 * Primary circuit container: hosts the 2D SVG/Canvas netlist editor OR the 3D
 * WebGL studio view, switched by the floating <ViewportToggle /> overlay.
 *
 * - Mode '2d'  -> <CircuitCanvas />  (existing schematic editor)
 * - Mode '3d'  -> <CircuitCanvas3D quality={isLowSpec ? 'low' : 'high'} />
 *
 * Low-Spec is two-way bound to the app store's `layout.lowSpecMode` via the
 * simulation client, so the CommandBar checkbox and this toggle stay in sync
 * and the AVR worker throttles together with the GPU load.
 *
 * Mode switching mounts/unmounts each view cleanly (R3F disposes its GL
 * context on unmount; the 2D canvas tears down its own listeners), so rapid
 * toggling cannot leak contexts or crash on re-mount.
 */
import { useEffect } from 'react';
import { CircuitCanvas } from '../../circuit/CircuitCanvas';
import { CircuitCanvas3D } from './CircuitCanvas3D';
import { ViewportToggle, type ViewportMode } from './ViewportToggle';
import { useAppStore } from '../../state/store';
import { simulationClient } from '../../simulation/simulation-client';

/**
 * Why 3D can be unavailable.
 *
 * A breadboard has no production 3D geometry yet (C3) and no wire attachment portals (C4).
 * Rendering one would put an invisible, unreachable component into the workspace and feed
 * 400 terminals to a router with no geometry for them, so the 3D view is withheld while a
 * project contains one. Stated on screen rather than in a tooltip: a disabled control with
 * no visible reason reads as a bug.
 */
export const BREADBOARD_3D_NOTICE =
  'The 3D Workspace is unavailable while this circuit contains a breadboard. ' +
  '3D breadboard support arrives in the next milestone. Everything works normally in 2D.';

export function CircuitPane(): JSX.Element {
  const mode = useAppStore((s) => s.layout.viewportMode);
  const isLowSpec = useAppStore((s) => s.layout.lowSpecMode);
  const setLayout = useAppStore((s) => s.actions.setLayout);
  const hasBreadboard = useAppStore((s) => s.circuit.components.some((c) => c.kind === 'breadboard'));

  // A breadboard can arrive while 3D is showing — by being loaded from a file. Falling back
  // here means the 3D canvas is never mounted with one in the scene.
  useEffect(() => {
    if (hasBreadboard && mode === '3d') setLayout({ viewportMode: '2d' });
  }, [hasBreadboard, mode, setLayout]);

  const effectiveMode: ViewportMode = hasBreadboard ? '2d' : mode;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <ViewportToggle
        mode={effectiveMode}
        onModeChange={(next) => {
          if (next === '3d' && hasBreadboard) return;
          setLayout({ viewportMode: next });
        }}
        lowSpec={isLowSpec}
        onLowSpecChange={(low) => simulationClient.setLowSpec(low)}
        threeDisabledReason={hasBreadboard ? BREADBOARD_3D_NOTICE : null}
      />
      {effectiveMode === '3d' ? <CircuitCanvas3D quality={isLowSpec ? 'low' : 'high'} /> : <CircuitCanvas />}
    </div>
  );
}
