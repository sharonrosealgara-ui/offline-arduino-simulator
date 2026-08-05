/**
 * The breadboard in 3D: one body, one instanced mesh of 400 openings, four rail stripes.
 *
 * WHY INSTANCING
 * Four hundred separate meshes would be four hundred draw calls and four hundred objects for
 * the scene graph to traverse, on a part a student may place three of. One InstancedMesh
 * draws all the openings in a single call, and the transform that positions the board is
 * applied once to the parent group — so moving or turning the board never rebuilds a single
 * matrix, let alone 400 of them.
 *
 * The cost of instancing is that a click hands back an integer and nothing else. That is why
 * `breadboard-3d-geometry.ts` fixes instance *i* to canonical hole *i*: the integer is only
 * meaningful because the order is a contract rather than an accident of construction.
 *
 * INTERNAL FOR NOW. This renders and picks correctly, but a breadboard project still cannot
 * reach the production 3D canvas: C4 has not built the obstacle volumes or the hole
 * attachment portals, so a wire ending in a hole would have nothing to route around and
 * nowhere legitimate to enter. The application gate in `CircuitPane` stays until it does.
 *
 * VISUAL APPROXIMATIONS — body thickness, opening size and depth, bevels, channel
 * appearance, rail stripes and every colour and material property here are design choices,
 * not manufacturer measurements. See `BREADBOARD_GEOMETRY_SOURCES.md`.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import {
  CHANNEL_VISIBLE_WIDTH,
  HOLE_OPENING_DEPTH,
  HOLE_OPENING_SIZE,
  breadboardBody3D,
  breadboardHoleInstances,
  breadboardInstanceCount,
  holeVisualState,
  resolveInstanceTerminal,
  type BreadboardHoleState,
} from './breadboard-3d-geometry';
import { holesInSameGroup, occupiedHoles } from '../breadboard-connections';

/** APPROXIMATION — generic off-white ABS, and the two rail colours by convention. */
const BODY_COLOR = '#eef0ec';
const CHANNEL_COLOR = '#d6d9d4';
const OPENING_COLOR = '#2b2f36';
const POSITIVE_COLOR = '#d1352b';
const NEGATIVE_COLOR = '#2b74d1';
const SELECTED_COLOR = '#38bdf8';
const CURRENT_COLOR = '#facc15';
const CONNECTED_COLOR = '#5cc8ff';
const OCCUPIED_COLOR = '#111418';

/** One colour per state. The state itself is decided by the pure helper, not here. */
const STATE_COLORS: Record<BreadboardHoleState, string> = {
  current: CURRENT_COLOR,
  occupied: OCCUPIED_COLOR,
  connected: CONNECTED_COLOR,
  idle: OPENING_COLOR,
};

interface Props {
  component: CircuitComponent;
  selected?: boolean;
  /** Wires in the project — the only source occupancy is derived from. */
  wires?: readonly CircuitWire[];
  /** Hole under the pointer or keyboard cursor, if any. */
  currentHoleId?: string | null;
  /** Called with the qualified terminal a click resolved to. */
  onPickTerminal?(ref: { componentId: string; terminalId: string }): void;
  onSelect?(additive: boolean): void;
}

function Breadboard3DImpl({
  component,
  selected = false,
  wires = [],
  currentHoleId = null,
  onPickTerminal,
  onSelect,
}: Props): JSX.Element {
  const body = breadboardBody3D();
  const holes = breadboardHoleInstances();
  const openingsRef = useRef<THREE.InstancedMesh>(null);

  const occupied = useMemo(() => occupiedHoles(wires, component.id), [wires, component.id]);
  const connected = useMemo(
    () => new Set(currentHoleId ? holesInSameGroup(currentHoleId) : []),
    [currentHoleId],
  );

  // Shared across every instance and every board — one geometry, one material.
  const openingGeometry = useMemo(
    () => new THREE.BoxGeometry(HOLE_OPENING_SIZE, HOLE_OPENING_DEPTH, HOLE_OPENING_SIZE),
    [],
  );

  useEffect(() => () => openingGeometry.dispose(), [openingGeometry]);

  /**
   * Instance matrices, written once per placement change rather than per frame.
   *
   * The board's own position and rotation live on the parent group, so these are pure local
   * offsets: turning the board does not touch them at all.
   */
  useEffect(() => {
    const mesh = openingsRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    for (const hole of holes) {
      matrix.makeTranslation(hole.x, body.height - HOLE_OPENING_DEPTH / 2, hole.z);
      mesh.setMatrixAt(hole.index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = holes.length;
  }, [holes, body.height]);

  /** Per-instance colour carries the state cues; the matrices never change for them. */
  useEffect(() => {
    const mesh = openingsRef.current;
    if (!mesh) return;
    const colour = new THREE.Color();
    for (const hole of holes) {
      mesh.setColorAt(hole.index, colour.set(STATE_COLORS[holeVisualState(hole.id, { currentHoleId, occupied, connected })]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [holes, currentHoleId, occupied, connected]);

  const railStripes = useMemo(() => {
    const rails = new Map<string, { z: number; positive: boolean }>();
    for (const hole of holes) {
      if (!hole.groupId.startsWith('rail:')) continue;
      if (!rails.has(hole.groupId)) {
        rails.set(hole.groupId, { z: hole.z, positive: hole.groupId.endsWith('positive') });
      }
    }
    return [...rails.entries()].map(([id, rail]) => ({ id, ...rail }));
  }, [holes]);

  return (
    <group
      position={[0, 0, 0]}
      name={`breadboard-${component.id}`}
      userData={{ kind: 'breadboard', componentId: component.id }}
    >
      {/* ---- body ------------------------------------------------------------------- */}
      <mesh
        position={[0, body.height / 2, 0]}
        name="breadboard-body"
        onClick={(event: ThreeEvent<MouseEvent>) => {
          // The body is not a terminal. Selecting the board is the existing component
          // gesture; it must never silently stand in for choosing a hole.
          event.stopPropagation();
          onSelect?.(event.nativeEvent.shiftKey);
        }}
      >
        <boxGeometry args={[body.width, body.height, body.depth]} />
        <meshStandardMaterial
          color={selected ? SELECTED_COLOR : BODY_COLOR}
          roughness={0.75}
          metalness={0.02}
        />
      </mesh>

      {/* ---- centre channel: a visible recess, width is an approximation ------------- */}
      <mesh position={[0, body.height, 0]} name="breadboard-channel">
        <boxGeometry args={[body.width * 0.94, HOLE_OPENING_DEPTH, CHANNEL_VISIBLE_WIDTH]} />
        <meshStandardMaterial color={CHANNEL_COLOR} roughness={0.85} />
      </mesh>

      {/* ---- four separate rail stripes --------------------------------------------- */}
      {railStripes.map((rail) => (
        <mesh
          key={rail.id}
          name={`breadboard-rail-${rail.id}`}
          position={[0, body.height + 0.001, rail.z + (rail.positive ? -0.035 : 0.035)]}
        >
          <boxGeometry args={[body.width * 0.9, 0.002, 0.012]} />
          <meshStandardMaterial color={rail.positive ? POSITIVE_COLOR : NEGATIVE_COLOR} roughness={0.7} />
        </mesh>
      ))}

      {/* ---- 400 openings in ONE instanced mesh -------------------------------------- */}
      <instancedMesh
        ref={openingsRef}
        name="breadboard-openings"
        args={[openingGeometry, undefined, breadboardInstanceCount()]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          const ref = resolveInstanceTerminal(component.id, event.instanceId);
          // Only claim the event when this board actually owns the interaction. A miss falls
          // through to whatever is behind it rather than being swallowed.
          if (!ref) return;
          event.stopPropagation();
          onPickTerminal?.(ref);
        }}
      >
        <meshStandardMaterial vertexColors roughness={0.6} />
      </instancedMesh>
    </group>
  );
}

export const Breadboard3D = memo(Breadboard3DImpl);
