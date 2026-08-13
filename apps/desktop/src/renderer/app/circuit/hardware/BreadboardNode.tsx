/**
 * A breadboard placed in the production scene.
 *
 * Thin on purpose. It applies the component transform exactly once — position and yaw on one
 * group — and hands the C3 renderer the state it needs. The 400 hole matrices inside
 * `Breadboard3D` stay local, so moving or turning a board rebuilds nothing.
 *
 * Picking goes straight to `actions.pickTerminal`, the same command the 2D canvas and the
 * Uno's pins use. There is no 3D-only pending-wire state and no breadboard-only wire path:
 * one-conductor-per-hole, same-terminal cancellation and the occupancy refusal are all
 * decided in the store, which is the only place that can enforce them for every entry point.
 *
 * STILL GATED. This is registered in the production scene, but `CircuitPane` will not mount
 * the 3D canvas while a project contains a breadboard, pending rasterized visual review.
 */
import { memo, useMemo } from 'react';
import type { CircuitComponent } from '@offline-arduino/contracts/circuit';
import { useAppStore, useCircuit } from '../../../state/store';
import { Breadboard3D } from './Breadboard3D';
import { breadboardGroupTransform } from './breadboard-3d-geometry';

interface Props {
  component: CircuitComponent;
  origin: { x: number; y: number };
  selected: boolean;
}

function BreadboardNodeImpl({ component, origin, selected }: Props): JSX.Element {
  const { wires, pendingWireFrom } = useCircuit();

  // One transform, applied once, on the group that owns everything below it.
  const transform = useMemo(
    () => breadboardGroupTransform({ x: component.x, y: component.y, rotation: component.rotation }, origin),
    [component.x, component.y, component.rotation, origin],
  );

  /** The hole a half-drawn wire started from, so it reads as current while wiring. */
  const currentHoleId =
    pendingWireFrom?.componentId === component.id ? pendingWireFrom.terminalId : null;

  return (
    <group position={transform.position} rotation={[0, transform.rotationY, 0]}>
      <Breadboard3D
        component={component}
        selected={selected}
        wires={wires}
        currentHoleId={currentHoleId}
        onPickTerminal={(ref) => useAppStore.getState().actions.pickTerminal(ref)}
        onSelect={(additive) => {
          const state = useAppStore.getState();
          state.actions.selectIds(
            additive ? [...state.circuit.selectedIds, component.id] : [component.id],
          );
        }}
      />
    </group>
  );
}

export const BreadboardNode = memo(BreadboardNodeImpl);
