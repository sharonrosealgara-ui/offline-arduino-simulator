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
import { useState } from 'react';
import { CircuitCanvas } from '../../circuit/CircuitCanvas';
import { CircuitCanvas3D } from './CircuitCanvas3D';
import { ViewportToggle, type ViewportMode } from './ViewportToggle';
import { useAppStore } from '../../state/store';
import { simulationClient } from '../../simulation/simulation-client';

export function CircuitPane(): JSX.Element {
  const [mode, setMode] = useState<ViewportMode>('3d');
  const isLowSpec = useAppStore((s) => s.layout.lowSpecMode);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <ViewportToggle
        mode={mode}
        onModeChange={setMode}
        lowSpec={isLowSpec}
        onLowSpecChange={(low) => simulationClient.setLowSpec(low)}
      />
      {mode === '3d' ? <CircuitCanvas3D quality={isLowSpec ? 'low' : 'high'} /> : <CircuitCanvas />}
    </div>
  );
}
