/**
 * Renders the authoring netlist in 3D and overlays live simulation state, and is where all
 * direct manipulation of the circuit happens.
 *
 * ARCHITECTURE
 *  - Terminal anchors come from the trusted component registry — the same source the 2D
 *    canvas and the netlist compiler use — so a wire drawn here is electrically the wire
 *    the solver sees. Board terminals additionally resolve through ./hardware/uno-geometry
 *    so they land on the physical header pin rather than the schematic's abstract row.
 *  - Live state (LED brightness, servo angle, pot wiper, button press, LCD rows) is read
 *    per component through narrow Zustand selectors; per-frame smoothing runs in useFrame
 *    with THREE.MathUtils.damp so React never re-renders at frame rate.
 *  - 100% procedural geometry. No external assets, no network requests.
 *
 * CAMERA VS DRAG
 *  OrbitControls and component dragging both want the left mouse button. Dragging disables
 *  `controls.enabled` for the duration and restores it on pointerup (including when the
 *  pointer is released outside the canvas), so the two never fight.
 */
import {useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  getComponentDefinition,
  terminalKey,
} from '@offline-arduino/simulator/circuit-model/component-registry';
import type {
  CircuitComponent,
  ComponentKind,
  Point,
  TerminalRef,
  WireColorRole,
} from '@offline-arduino/contracts/circuit';
import { useAppStore, useCircuit } from '../../state/store';
import { shouldShowTerminals, terminalAnchorAppearance } from './terminal-anchor-style';
import { createTextPlateTexture } from './hardware/labels';
import { useDisposableTexture } from './hardware/useDisposableTexture';
import { formatOhms } from './hardware/resistor-bands';
import { PCB_TOP, unoPinPosition } from './hardware/uno-geometry';
import { SCHEMATIC_UNIT_INCHES, mmToWorld } from './hardware/geometry-units';
import { componentPhysical } from './hardware/component-geometry';
import {
  boundsCenter,
  componentYawRadians,
  selectionBoundsMm,
  terminalScenePosition,
} from './hardware/component-bounds';
import { Part3D, terminalsOf } from './hardware/parts-3d';
import { WIRE_HEX } from './hardware/wire-colors';
import { buildWireCurve, wireRadius, type WireClearanceContext } from './hardware/wire-path';
import {
  BOARD_AT_SCENE_ORIGIN,
  headerVolumeIdForPin,
  unoWireClearance,
  type AttachmentExemption,
  type UnoPlacement,
} from './hardware/scene-obstacles';

/** Schematic units → world inches. One shared constant; see geometry-units.ts. */
const SCALE = SCHEMATIC_UNIT_INCHES;
/** Height wires float above the bench. */
const WIRE_LIFT = 0.14;
/** Radius of the clickable terminal anchor. */
const TERMINAL_RADIUS = 0.028;

const SELECTED_COLOR = '#38bdf8';
const HOVER_COLOR = '#7dd3fc';
const WIRE_PENDING_COLOR = '#facc15';

/** Rotates a terminal's local anchor by the component rotation and offsets by position. */
function terminal2D(c: CircuitComponent, tx: number, ty: number): Point {
  const rad = (c.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: c.x + tx * cos - ty * sin, y: c.y + tx * sin + ty * cos };
}

// =======================================================================================
// Root
// =======================================================================================
export interface DynamicNetlist3DProps {
  quality?: 'low' | 'high';
}

export function DynamicNetlist3D({ quality = 'high' }: DynamicNetlist3DProps): JSX.Element {
  const { components, wires, selectedIds, pendingWireFrom } = useCircuit();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const high = quality === 'high';

  // Centre the world on the board so it sits at the origin, matching <UnoR3Board/>.
  const origin = useMemo(() => {
    const uno = components.find((c) => c.kind === 'uno-r3');
    return { x: uno?.x ?? 300, y: uno?.y ?? 250 };
  }, [components]);

  const to3D = useCallback(
    (p: Point, y = 0): THREE.Vector3 => new THREE.Vector3((p.x - origin.x) * SCALE, y, (p.y - origin.y) * SCALE),
    [origin],
  );

  /**
   * Every terminal's 3D anchor, keyed exactly as the electrical netlist keys it.
   *
   * Board terminals are special-cased to their real header-pin coordinates; without this a
   * wire to D13 would attach to the schematic's abstract pin row, floating in space beside
   * the board instead of touching the pin a student can see.
   */
  const terminalPos = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const c of components) {
      const def = getComponentDefinition(c.kind);
      if (!def) continue;
      for (const t of def.terminals) {
        if (c.kind === 'uno-r3') {
          const physical = unoPinPosition(t.id);
          if (physical) {
            map.set(terminalKey(c.id, t.id), new THREE.Vector3(physical.x, PCB_TOP + 0.3, physical.z));
            continue;
          }
        }
        // Where the wire meets this part's own conductor. Derived from the part, not from
        // a fixed height: a constant lift left every wire ending 3.56 mm above its lead.
        const scene = terminalScenePosition(c, t.id, def.terminals, origin);
        if (scene) {
          map.set(terminalKey(c.id, t.id), new THREE.Vector3(scene.x, scene.y, scene.z));
          continue;
        }
        map.set(terminalKey(c.id, t.id), to3D(terminal2D(c, t.x, t.y), WIRE_LIFT));
      }
    }
    return map;
    // `origin` is read directly now that terminal heights come from each part, not only
    // through to3D — so it has to be declared, or a board moved without any other change
    // could leave endpoints behind.
  }, [components, to3D, origin]);

  /**
   * Where the board sits in the scene. The renderer centres the world on the Uno today, so
   * this resolves to the origin — but it is read from the component rather than assumed, so
   * a moved or rotated board routes correctly without further work.
   */
  const unoPlacement = useMemo<UnoPlacement>(() => {
    const uno = components.find((c) => c.kind === 'uno-r3');
    if (!uno) return BOARD_AT_SCENE_ORIGIN;
    return {
      x: (uno.x - origin.x) * SCALE,
      z: (uno.y - origin.y) * SCALE,
      rotationDegrees: uno.rotation,
    };
  }, [components, origin]);

  const wiring = pendingWireFrom !== null;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <group name="dynamic-netlist">
      {wires.map((w) => {
        const a = terminalPos.get(terminalKey(w.from.componentId, w.from.terminalId));
        const b = terminalPos.get(terminalKey(w.to.componentId, w.to.terminalId));
        if (!a || !b) return null;
        const mids = w.waypoints.map((wp) => to3D(wp, WIRE_LIFT));
        // A wire end plugged into a board header legitimately starts inside that connector —
        // and inside nothing else. Exempt exactly the header holding its own pin.
        const exemptions: AttachmentExemption[] = [];
        for (const [end, at] of [
          [w.from, a],
          [w.to, b],
        ] as const) {
          const component = components.find((c) => c.id === end.componentId);
          if (component?.kind !== 'uno-r3') continue;
          const volumeId = headerVolumeIdForPin(end.terminalId);
          if (volumeId) exemptions.push({ point: at, volumeId });
        }
        return (
          <NetWire
            key={w.id}
            id={w.id}
            points={[a, ...mids, b]}
            color={selected.has(w.id) ? SELECTED_COLOR : WIRE_HEX[w.colorRole]}
            selected={selected.has(w.id)}
            high={high}
            clearance={unoWireClearance(unoPlacement, exemptions)}
          />
        );
      })}

      {/* Preview of the wire currently being drawn, anchored to the first terminal. */}
      {pendingWireFrom && (
        <PendingWirePreview
          anchor={terminalPos.get(terminalKey(pendingWireFrom.componentId, pendingWireFrom.terminalId))}
        />
      )}

      {/* Terminal anchors. Shown while wiring (so every legal target is visible), when
          hovering a part (so its pins can be discovered without entering wiring mode), and
          always for the board — see shouldShowTerminals for why the board must not be
          gated on hover or selection. */}
      {components.map((c) => {
        const def = getComponentDefinition(c.kind);
        if (!def) return null;
        const show = shouldShowTerminals({
          isBoard: c.kind === 'uno-r3',
          wiring,
          hovered: hoveredId === c.id,
          selected: selected.has(c.id),
        });
        if (!show) return null;
        return def.terminals.map((t) => {
          const position = terminalPos.get(terminalKey(c.id, t.id));
          if (!position) return null;
          const isPending =
            pendingWireFrom?.componentId === c.id && pendingWireFrom?.terminalId === t.id;
          return (
            <TerminalAnchor
              key={`${c.id}:${t.id}`}
              componentId={c.id}
              terminalId={t.id}
              label={t.label}
              role={t.role}
              position={position}
              pending={isPending}
            />
          );
        });
      })}

      {components.map((c) =>
        c.kind === 'uno-r3' ? null : (
          <ComponentNode
            key={c.id}
            component={c}
            origin={origin}
            selected={selected.has(c.id)}
            hovered={hoveredId === c.id}
            onHoverChange={setHoveredId}
            high={high}
          />
        ),
      )}
    </group>
  );
}

// =======================================================================================
// Wires
// =======================================================================================
function NetWire({
  id,
  points,
  color,
  selected,
  high,
  clearance,
}: {
  id: string;
  points: THREE.Vector3[];
  color: string;
  selected: boolean;
  high: boolean;
  clearance: WireClearanceContext;
}): JSX.Element {
  const curve = useMemo(() => buildWireCurve(points, clearance), [points, clearance]);

  if (!curve) return <group />;

  return (
    <mesh
      castShadow={high}
      receiveShadow={high}
      onClick={(event) => {
        event.stopPropagation();
        useAppStore.getState().actions.selectIds([id]);
      }}
    >
      {/* Fewer tubular segments in low-spec: a jumper reads fine at 24. */}
      <tubeGeometry args={[curve, high ? 40 : 20, wireRadius(selected), high ? 8 : 5, false]} />
      <meshPhysicalMaterial
        color={color}
        roughness={0.85}
        metalness={0}
        clearcoat={high ? 0.3 : 0}
        clearcoatRoughness={0.6}
        emissive={selected ? SELECTED_COLOR : '#000000'}
        emissiveIntensity={selected ? 0.35 : 0}
      />
    </mesh>
  );
}

/** Dashed marker at the first-picked terminal, so an in-progress wire is unmistakable. */
function PendingWirePreview({ anchor }: { anchor: THREE.Vector3 | undefined }): JSX.Element | null {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 6) * 0.18;
      ref.current.scale.setScalar(pulse);
    }
  });
  if (!anchor) return null;
  return (
    <mesh ref={ref} position={anchor}>
      <sphereGeometry args={[TERMINAL_RADIUS * 1.8, 16, 12]} />
      <meshBasicMaterial color={WIRE_PENDING_COLOR} transparent opacity={0.75} depthTest={false} />
    </mesh>
  );
}

// =======================================================================================
// Terminals
// =======================================================================================
// Sizes and per-role colours now live in ./terminal-anchor-style, where they are covered
// by tests that pin the hit-target-to-dot ratio and the ON/OFF contrast.

function TerminalAnchor({
  componentId,
  terminalId,
  label,
  role,
  position,
  pending,
}: {
  componentId: string;
  terminalId: string;
  label: string;
  role: string;
  position: THREE.Vector3;
  pending: boolean;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);

  const pick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      const terminal: TerminalRef = { componentId, terminalId };
      // Colour the wire by what it connects: power red, ground black, everything else
      // yellow. Students read wire colour as meaning, so it should mean something.
      const colorRole: WireColorRole =
        role === 'power' ? 'vcc-red' : role === 'ground' ? 'ground-black' : 'signal-yellow';
      useAppStore.getState().actions.pickTerminal(terminal, colorRole);
    },
    [componentId, terminalId, role],
  );

  const look = terminalAnchorAppearance({ role, hovered, pending });

  return (
    <group position={position}>
      {/*
        Pointer target, deliberately much larger than the drawn dot and invisible. Packaged
        acceptance could not reliably hit the header pins when the clickable area was the dot
        itself; since a terminal's name only appears on hover, a pin you cannot hover is a pin
        you cannot identify. Transparent rather than `visible={false}`, because three.js skips
        invisible objects when raycasting.
      */}
      <mesh
        onClick={pick}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'crosshair';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = '';
        }}
      >
        <sphereGeometry args={[look.hitRadius, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/*
        Dark outline so the dot reads against the dark grid AND the green PCB it sits on.

        BackSide is essential. Drawn as an ordinary front-facing sphere this larger mesh
        enclosed the core and, being transparent, rendered after it and painted over it —
        the anchors came out as dark blobs with the bright core completely hidden. Rendering
        only the back faces leaves the core untouched and shows the outline just around the
        silhouette, which is what gives contrast on both backgrounds.
      */}
      <mesh raycast={() => null}>
        <sphereGeometry args={[look.rimRadius, 12, 10]} />
        <meshBasicMaterial color={look.rimColor} side={THREE.BackSide} toneMapped={false} />
      </mesh>

      <mesh raycast={() => null}>
        <sphereGeometry args={[look.coreRadius, 12, 10]} />
        <meshBasicMaterial color={look.color} toneMapped={false} />
      </mesh>

      {look.showLabel && <FloatingLabel text={label} y={0.11} width={0.5} />}
    </group>
  );
}

// =======================================================================================
// Floating text
// =======================================================================================
/**
 * A camera-facing text plate. Used for terminal names and component labels.
 *
 * Canvas texture rather than drei's <Html>: Html injects real DOM nodes that are laid out
 * every frame and cannot be occluded correctly by geometry. For a scene that may show
 * dozens of pin labels at once, a billboarded plane is dramatically cheaper.
 */
function FloatingLabel({
  text,
  y,
  width,
  color = '#e8edf4',
  background = 'rgba(9,12,17,0.86)',
}: {
  text: string;
  y: number;
  width: number;
  color?: string;
  background?: string;
}): JSX.Element {
  const ref = useRef<THREE.Mesh>(null);
  const height = width * 0.28;

  const texture = useDisposableTexture(
    () =>
      createTextPlateTexture(text, {
        widthInches: width,
        heightInches: height,
        color,
        background,
        fontScale: 0.62,
      }),
    [text, width, height, color, background],
  );

  useFrame(({ camera }) => {
    if (ref.current) ref.current.quaternion.copy(camera.quaternion);
  });

  return (
    <mesh ref={ref} position={[0, y, 0]} renderOrder={999}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthTest={false} toneMapped={false} />
    </mesh>
  );
}

// =======================================================================================
// Component node — selection, hover, and dragging
// =======================================================================================
interface NodeProps {
  component: CircuitComponent;
  origin: { x: number; y: number };
  selected: boolean;
  hovered: boolean;
  onHoverChange(id: string | null): void;
  high: boolean;
}

/** Plane the drag is projected onto — the bench surface. */
const DRAG_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function ComponentNode({ component, origin, selected, hovered, onHoverChange, high }: NodeProps): JSX.Element {
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const dragging = useRef(false);
  const movedThisDrag = useRef(false);
  const grabOffset = useRef(new THREE.Vector3());

  // Memoized: this array feeds the drag callbacks' dependency lists, so a fresh array on
  // every render would rebuild them (and re-bind the pointer handlers) each frame.
  const position = useMemo<[number, number, number]>(
    () => [(component.x - origin.x) * SCALE, 0, (component.y - origin.y) * SCALE],
    [component.x, component.y, origin.x, origin.y],
  );
  const yaw = componentYawRadians(component.rotation);

  const pointerToWorld = useCallback(
    (event: ThreeEvent<PointerEvent>): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(DRAG_PLANE, hit) ? hit : null;
    },
    [camera, gl],
  );

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const actions = useAppStore.getState().actions;
      actions.selectIds([component.id]);

      const world = pointerToWorld(event);
      if (!world) return;

      dragging.current = true;
      movedThisDrag.current = false;
      grabOffset.current.set(world.x - position[0], 0, world.z - position[2]);

      // Hand the camera back its button only after this drag ends.
      if (controls) controls.enabled = false;
      (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    },
    [component.id, controls, pointerToWorld, position],
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      event.stopPropagation();
      const world = pointerToWorld(event);
      if (!world) return;

      const x = origin.x + (world.x - grabOffset.current.x) / SCALE;
      const y = origin.y + (world.z - grabOffset.current.z) / SCALE;

      // The first move of a drag is the undoable one: it pushes the pre-drag topology.
      // Every later move coalesces into it, so one drag is one undo step.
      useAppStore
        .getState()
        .actions.moveComponent(component.id, x, y, { coalesce: movedThisDrag.current });
      movedThisDrag.current = true;
    },
    [component.id, origin, pointerToWorld],
  );

  const endDrag = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (controls) controls.enabled = true;
      (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
    },
    [controls],
  );

  return (
    <group
      position={position}
      rotation={[0, yaw, 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHoverChange(component.id);
        document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        onHoverChange(null);
        document.body.style.cursor = '';
      }}
    >
      {renderKind(component, high)}
      {(selected || hovered) && <SelectionRing kind={component.kind} selected={selected} />}
      {(selected || hovered) && (
        <FloatingLabel
          text={describe(component)}
          y={labelHeightFor(component.kind)}
          width={0.92}
        />
      )}
    </group>
  );
}

/** Human-readable summary shown on hover/selection: name plus the value that matters. */
function describe(c: CircuitComponent): string {
  switch (c.kind) {
    case 'resistor':
      return `${c.label} · ${formatOhms(Number(c.properties.ohms ?? 220))}`;
    case 'led':
      return `${c.label} · ${String(c.properties.color ?? 'red')}`;
    case 'potentiometer':
      return `${c.label} · ${formatOhms(Number(c.properties.ohms ?? 10000))}`;
    default:
      return c.label;
  }
}

/**
 * The footprint outline under a selected or hovered part.
 *
 * This was a fixed 0.15-0.19 inch ring for every kind, which is meaningless once parts are
 * their real size: on an 80 mm LCD it read as a dot near one corner, and inside a servo it
 * disappeared under the case. It is now derived from the same footprint the wiring uses, so
 * it frames whatever it is drawn around.
 */
/** Label height: above the part, so it never sits across the body or its terminals. */
function labelHeightFor(kind: ComponentKind): number {
  const physical = componentPhysical(kind);
  if (!physical) return 0.42;
  return mmToWorld(physical.standoff + physical.body.height) + 0.18;
}

function SelectionRing({ kind, selected }: { kind: ComponentKind; selected: boolean }): JSX.Element {
  const bounds = selectionBoundsMm(kind, terminalsOf(kind));
  const center = bounds ? boundsCenter(bounds) : { x: 0, z: 0 };
  const width = bounds ? mmToWorld(bounds.maxX - bounds.minX) : 0.34;
  const depth = bounds ? mmToWorld(bounds.maxZ - bounds.minZ) : 0.34;
  return (
    <mesh
      position={[mmToWorld(center.x), 0.005, mmToWorld(center.z)]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[Math.max(width, depth) / 2, Math.max(width, depth) / 2 + 0.04, 48]} />
      <meshBasicMaterial
        color={selected ? SELECTED_COLOR : HOVER_COLOR}
        transparent
        opacity={selected ? 0.95 : 0.5}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function renderKind(c: CircuitComponent, high: boolean): JSX.Element {
  // Bodies and conductors both live in parts-3d.tsx, drawn from the sourced millimetre
  // table and the registry's own anchors.
  return <Part3D component={c} high={high} />;
}
