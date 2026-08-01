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
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { simulationClient } from '../../simulation/simulation-client';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  getComponentDefinition,
  terminalKey,
} from '@offline-arduino/simulator/circuit-model/component-registry';
import type { CircuitComponent, Point, TerminalRef, WireColorRole } from '@offline-arduino/contracts/circuit';
import type { ComponentDisplayDelta } from '@offline-arduino/contracts/simulator';
import { useAppStore, useCircuit } from '../../state/store';
import { shouldShowTerminals, terminalAnchorAppearance } from './terminal-anchor-style';
import { createLcdScreenTexture, createTextPlateTexture } from './hardware/labels';
import { useDisposableTexture } from './hardware/useDisposableTexture';
import { resistorBands, formatOhms } from './hardware/resistor-bands';
import { PCB_TOP, unoPinPosition } from './hardware/uno-geometry';
import { SCHEMATIC_UNIT_INCHES } from './hardware/geometry-units';

/** Schematic units → world inches. One shared constant; see geometry-units.ts. */
const SCALE = SCHEMATIC_UNIT_INCHES;
/** Height wires float above the bench. */
const WIRE_LIFT = 0.14;
/** Radius of the clickable terminal anchor. */
const TERMINAL_RADIUS = 0.028;

const SELECTED_COLOR = '#38bdf8';
const HOVER_COLOR = '#7dd3fc';
const WIRE_PENDING_COLOR = '#facc15';

const WIRE_HEX: Record<WireColorRole, string> = {
  'vcc-red': '#d1352b',
  'ground-black': '#1c1f24',
  'signal-yellow': '#e0b400',
  'signal-blue': '#2b74d1',
  'signal-green': '#1f9d55',
  'signal-orange': '#e07a1f',
  'signal-purple': '#8a4fd1',
};

/** Rotates a terminal's local anchor by the component rotation and offsets by position. */
function terminal2D(c: CircuitComponent, tx: number, ty: number): Point {
  const rad = (c.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: c.x + tx * cos - ty * sin, y: c.y + tx * sin + ty * cos };
}

function useComponentDelta(id: string): ComponentDisplayDelta | undefined {
  return useAppStore((s) => s.simulation.components[id]);
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
        map.set(terminalKey(c.id, t.id), to3D(terminal2D(c, t.x, t.y), WIRE_LIFT));
      }
    }
    return map;
  }, [components, to3D]);

  const wiring = pendingWireFrom !== null;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <group name="dynamic-netlist">
      {wires.map((w) => {
        const a = terminalPos.get(terminalKey(w.from.componentId, w.from.terminalId));
        const b = terminalPos.get(terminalKey(w.to.componentId, w.to.terminalId));
        if (!a || !b) return null;
        const mids = w.waypoints.map((wp) => to3D(wp, WIRE_LIFT));
        return (
          <NetWire
            key={w.id}
            id={w.id}
            points={[a, ...mids, b]}
            color={selected.has(w.id) ? SELECTED_COLOR : WIRE_HEX[w.colorRole]}
            selected={selected.has(w.id)}
            high={high}
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
}: {
  id: string;
  points: THREE.Vector3[];
  color: string;
  selected: boolean;
  high: boolean;
}): JSX.Element {
  const curve = useMemo(() => {
    if (points.length < 2) return null;
    const dense: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const p = points[i];
      const q = points[i + 1];
      dense.push(p);
      const mid = p.clone().add(q).multiplyScalar(0.5);
      // Slight sag between anchors so wires read as physical jumpers, not laser beams.
      mid.y -= Math.min(0.45, p.distanceTo(q) * 0.18);
      dense.push(mid);
    }
    dense.push(points[points.length - 1]);
    return new THREE.CatmullRomCurve3(dense, false, 'catmullrom', 0.5);
  }, [points]);

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
      <tubeGeometry args={[curve, high ? 40 : 20, selected ? 0.026 : 0.02, high ? 8 : 5, false]} />
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
  const yaw = -(component.rotation * Math.PI) / 180;

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
      {(selected || hovered) && <SelectionRing selected={selected} />}
      {(selected || hovered) && (
        <FloatingLabel text={describe(component)} y={0.42} width={0.92} />
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

function SelectionRing({ selected }: { selected: boolean }): JSX.Element {
  return (
    <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.15, 0.19, 32]} />
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
  switch (c.kind) {
    case 'led':
      return <Led3D id={c.id} color={typeof c.properties.color === 'string' ? c.properties.color : 'red'} high={high} />;
    case 'resistor':
      return <Resistor3D ohms={Number(c.properties.ohms ?? 220)} high={high} />;
    case 'potentiometer':
      return <Potentiometer3D id={c.id} high={high} />;
    case 'servo':
      return <Servo3D id={c.id} high={high} />;
    case 'lcd1602':
      return <Lcd3D id={c.id} high={high} />;
    case 'pushbutton':
      return <Pushbutton3D id={c.id} high={high} />;
    default:
      return <UnknownPart />;
  }
}

// =======================================================================================
// Parts
// =======================================================================================
const LED_COLOR_HEX: Record<string, string> = {
  red: '#ff3b30',
  green: '#34d058',
  blue: '#3b82f6',
  yellow: '#fbbf24',
  white: '#f4f4f5',
};

/**
 * 5 mm through-hole LED with a real polarity indicator: the flat on the rim and the short
 * lead are both on the cathode side, exactly as on the physical part. Getting this wrong
 * teaches the wrong thing, so both cues are modelled rather than just tinting the dome.
 */
function Led3D({ id, color, high }: { id: string; color: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const brightness = delta?.kind === 'led' ? delta.brightness : 0;
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const hex = LED_COLOR_HEX[color] ?? color;
  const emissive = useMemo(() => new THREE.Color(hex), [hex]);

  useFrame((_, dt) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = THREE.MathUtils.damp(
        matRef.current.emissiveIntensity,
        brightness * 3.4,
        14,
        dt,
      );
    }
    if (lightRef.current) {
      lightRef.current.intensity = THREE.MathUtils.damp(lightRef.current.intensity, brightness * 1.4, 14, dt);
    }
  });

  return (
    <group>
      {/* Dome */}
      <mesh castShadow={high} position={[0, 0.13, 0]}>
        <sphereGeometry args={[0.055, high ? 20 : 10, high ? 16 : 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={matRef}
          color={hex}
          emissive={emissive}
          emissiveIntensity={0}
          roughness={0.16}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Body */}
      <mesh castShadow={high} position={[0, 0.085, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.09, high ? 20 : 10]} />
        <meshStandardMaterial color={hex} roughness={0.2} transparent opacity={0.9} />
      </mesh>
      {/* Cathode flat + wider base rim: the two physical polarity cues. */}
      <mesh position={[0.052, 0.06, 0]}>
        <boxGeometry args={[0.012, 0.05, 0.08]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0.042, 0]}>
        <cylinderGeometry args={[0.066, 0.066, 0.012, high ? 20 : 10]} />
        <meshStandardMaterial color={hex} roughness={0.3} transparent opacity={0.85} />
      </mesh>
      {/* Anode lead (long, -x) and cathode lead (short, +x). */}
      <mesh position={[-0.03, -0.015, 0]}>
        <cylinderGeometry args={[0.007, 0.007, 0.15, 6]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.28} />
      </mesh>
      <mesh position={[0.03, 0.005, 0]}>
        <cylinderGeometry args={[0.007, 0.007, 0.11, 6]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.28} />
      </mesh>
      <pointLight ref={lightRef} color={hex} intensity={0} distance={1.1} decay={2} position={[0, 0.16, 0]} />
    </group>
  );
}

/** Axial resistor whose bands are computed from its actual resistance. */
function Resistor3D({ ohms, high }: { ohms: number; high: boolean }): JSX.Element {
  const { colors } = useMemo(() => resistorBands(ohms), [ohms]);
  // Band positions along the body, first digit nearest the left lead.
  const bandX = [-0.05, -0.025, 0.0, 0.05];

  return (
    <group position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow={high}>
        <cylinderGeometry args={[0.04, 0.04, 0.17, high ? 16 : 8]} />
        <meshStandardMaterial color="#d9c08a" roughness={0.62} />
      </mesh>
      {colors.map((c, i) => (
        <mesh key={i} position={[0, bandX[i], 0]}>
          <cylinderGeometry args={[0.042, 0.042, 0.016, high ? 16 : 8]} />
          <meshStandardMaterial color={c} roughness={0.5} />
        </mesh>
      ))}
      {/* Axial leads */}
      <mesh position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.007, 0.007, 0.1, 6]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.28} />
      </mesh>
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.007, 0.007, 0.1, 6]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.28} />
      </mesh>
    </group>
  );
}

function Potentiometer3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const value = delta?.kind === 'potentiometer' && typeof delta.value === 'number' ? delta.value : 0.5;
  const knob = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (!knob.current) return;
    const target = THREE.MathUtils.degToRad(-135 + value * 270);
    knob.current.rotation.y = THREE.MathUtils.damp(knob.current.rotation.y, target, 12, dt);
  });

  return (
    <group>
      <mesh castShadow={high} position={[0, 0.05, 0]}>
        <boxGeometry args={[0.24, 0.1, 0.24]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} />
      </mesh>
      <group ref={knob} position={[0, 0.12, 0]}>
        <mesh castShadow={high}>
          <cylinderGeometry args={[0.09, 0.09, 0.06, high ? 24 : 10]} />
          <meshStandardMaterial color="#374151" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.031, 0.06]}>
          <boxGeometry args={[0.02, 0.01, 0.09]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.4} />
        </mesh>
      </group>
      {/* Three leads: A, wiper, B. */}
      {[-0.08, 0, 0.08].map((x, i) => (
        <mesh key={i} position={[x, -0.02, 0.1]}>
          <cylinderGeometry args={[0.007, 0.007, 0.12, 6]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.28} />
        </mesh>
      ))}
    </group>
  );
}

function Servo3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const angle = delta?.kind === 'servo' ? delta.angle : 90;
  const horn = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (!horn.current) return;
    horn.current.rotation.y = THREE.MathUtils.damp(
      horn.current.rotation.y,
      THREE.MathUtils.degToRad(angle),
      10,
      dt,
    );
  });

  return (
    <group>
      <mesh castShadow={high} position={[0, 0.1, 0]}>
        <boxGeometry args={[0.5, 0.2, 0.24]} />
        <meshStandardMaterial color="#1e3a8a" roughness={0.5} />
      </mesh>
      {/* Mounting tabs */}
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[0.66, 0.03, 0.2]} />
        <meshStandardMaterial color="#1e3a8a" roughness={0.55} />
      </mesh>
      <group ref={horn} position={[0.16, 0.22, 0]}>
        <mesh castShadow={high}>
          <cylinderGeometry args={[0.05, 0.05, 0.06, high ? 16 : 8]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0.12, 0, 0]}>
          <boxGeometry args={[0.28, 0.02, 0.04]} />
          <meshStandardMaterial color="#f3f4f6" />
        </mesh>
      </group>
      {/* Three-wire pigtail stub, in the standard brown/red/orange order. */}
      {['#5b3a1e', '#d1352b', '#e07a1f'].map((c, i) => (
        <mesh key={c} position={[-0.27, 0.07 + i * 0.028, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.08, 6]} />
          <meshStandardMaterial color={c} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 16x2 HD44780 character LCD.
 *
 * The screen is a canvas texture rather than a drei <Html> overlay: the old Html version
 * put a DOM node in the scene that could not be occluded by geometry, ignored the camera's
 * depth buffer, and re-laid-out every frame.
 */
function Lcd3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const rows = delta?.kind === 'lcd1602' ? delta.rows : (['', ''] as [string, string]);
  const on = delta?.kind === 'lcd1602' ? delta.displayOn : false;

  const screen = useDisposableTexture(
    () => createLcdScreenTexture([rows[0] ?? '', rows[1] ?? ''], on),
    [rows[0], rows[1], on],
  );

  return (
    <group>
      {/* PCB */}
      <mesh castShadow={high} position={[0, 0.04, 0]}>
        <boxGeometry args={[1.0, 0.05, 0.44]} />
        <meshStandardMaterial color="#0f5132" roughness={0.6} />
      </mesh>
      {/* Metal bezel */}
      <mesh castShadow={high} position={[0, 0.09, -0.02]}>
        <boxGeometry args={[0.86, 0.06, 0.32]} />
        <meshStandardMaterial color="#8f959d" metalness={0.7} roughness={0.4} />
      </mesh>
      {/* Viewport */}
      <mesh position={[0, 0.121, -0.02]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.74, 0.24]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      {/* 16-pin header along the back edge */}
      <mesh position={[0, 0.08, 0.2]}>
        <boxGeometry args={[0.84, 0.05, 0.04]} />
        <meshStandardMaterial color="#15161a" roughness={0.7} />
      </mesh>
    </group>
  );
}

function Pushbutton3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const pressed = delta?.kind === 'pushbutton' && delta.value === true;
  const cap = useRef<THREE.Mesh>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pressedRef = useRef(false);

  useFrame((_, dt) => {
    if (!cap.current) return;
    cap.current.position.y = THREE.MathUtils.damp(cap.current.position.y, pressed ? 0.11 : 0.15, 20, dt);
  });

  // Pointer handlers update the real simulation control through the SimulationClient.
  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    // Guard against duplicate down events
    if (pressedRef.current) return;
    pressedRef.current = true;
    try {
      (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore environments without pointer capture
    }
    pointerIdRef.current = event.pointerId;
    simulationClient.setControl(id, true);
  }, [id]);

  const release = useCallback((event?: ThreeEvent<PointerEvent>) => {
    // Only release once
    if (!pressedRef.current) return;
    pressedRef.current = false;
    try {
      const pid = (event && typeof (event as any).pointerId === 'number') ? (event as any).pointerId : pointerIdRef.current;
      if (pid !== null && typeof pid === 'number') {
        (event?.target as Element | null)?.releasePointerCapture?.(pid);
      }
    } catch {}
    pointerIdRef.current = null;
    simulationClient.setControl(id, false);
  }, [id]);

  const onPointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    release(event);
  }, [release]);

  const onPointerCancel = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    release(event);
  }, [release]);

  const onPointerOut = useCallback((event: ThreeEvent<PointerEvent>) => {
    // If the pointer leaves while pressed, release so the button cannot stick down.
    if (pressedRef.current) release(event);
  }, [release]);

  // Avoid attaching global keyboard handlers that would interfere with editors and forms.
  // Keyboard accessibility is provided in the Inspector (focusable button). Ensure the
  // worker control is cleared on unmount/selection change so a stuck press cannot persist.
  useEffect(() => {
    return () => {
      if (pressedRef.current) simulationClient.setControl(id, false);
    };
  }, [id]);

  return (
    <group>
      <mesh castShadow={high} position={[0, 0.06, 0]}>
        <boxGeometry args={[0.24, 0.12, 0.24]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.6} />
      </mesh>
      <mesh
        ref={cap}
        castShadow={high}
        position={[0, 0.15, 0]}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerUp={(e) => onPointerUp(e)}
        onPointerCancel={(e) => onPointerCancel(e)}
        onPointerOut={(e) => onPointerOut(e)}
>
        <cylinderGeometry args={[0.06, 0.06, 0.06, high ? 20 : 10]} />
        <meshStandardMaterial color="#e11d48" roughness={0.4} />
      </mesh>
      {/* Four legs, matching the four registry terminals (a1/a2/b1/b2). */}
      {[
        [-0.1, -0.1],
        [0.1, -0.1],
        [-0.1, 0.1],
        [0.1, 0.1],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, -0.01, z]}>
          <cylinderGeometry args={[0.008, 0.008, 0.13, 6]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.85} roughness={0.28} />
        </mesh>
      ))}
    </group>
  );
}

function UnknownPart(): JSX.Element {
  return (
    <mesh position={[0, 0.05, 0]}>
      <boxGeometry args={[0.15, 0.1, 0.15]} />
      <meshStandardMaterial color="#64748b" wireframe />
    </mesh>
  );
}
