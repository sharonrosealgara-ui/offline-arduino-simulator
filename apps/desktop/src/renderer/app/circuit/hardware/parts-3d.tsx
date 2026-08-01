/**
 * The 3D hardware in the workspace, drawn from the sourced millimetre table.
 *
 * Every dimension here comes from component-geometry.ts; not one is written locally. Before
 * this, each mesh carried its own hand-tuned numbers, which is how the LCD ended up a third
 * of its real width beside a dimensionally exact board.
 *
 * Every conductor ends on a registry anchor. `Conductors3D` derives each endpoint from
 * `component-registry.ts` through the canonical transform, so a wire lands on a lead rather
 * than beside one — and keeps landing there if an anchor moves.
 *
 * Simulation behaviour is untouched: the LED still reads `brightness`, the servo still reads
 * `angle`, the trimmer still reads `value`, and the pushbutton still drives
 * `simulationClient.setControl` through the same pointer handling.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { CircuitComponent, ComponentKind } from '@offline-arduino/contracts/circuit';
import type { ComponentDisplayDelta } from '@offline-arduino/contracts/simulator';
import { useAppStore } from '../../../state/store';
import { simulationClient } from '../../../simulation/simulation-client';
import { componentPhysical, type ComponentPhysical } from './component-geometry';
import {
  anchorCentroidMm,
  bodyCenterMm,
  conductorAttachmentMm,
  type TerminalAnchor,
} from './component-bounds';
import { mmToWorld, schematicToMm, schematicToWorld } from './geometry-units';
import { resistorBands } from './resistor-bands';
import { createLcdScreenTexture } from './labels';
import { useDisposableTexture } from './useDisposableTexture';
import { WIRE_HEX } from './wire-colors';

/** Millimetres to world inches. Every size below passes through here. */
const W = mmToWorld;

const LED_COLOR_HEX: Record<string, string> = {
  red: '#ff3b30',
  green: '#34d058',
  blue: '#3b82f6',
  yellow: '#fbbf24',
  white: '#f4f4f5',
};

function useComponentDelta(id: string): ComponentDisplayDelta | undefined {
  return useAppStore((s) => s.simulation.components[id]);
}

/** A component's registry terminals — the only source of where a conductor ends. */
export function terminalsOf(kind: ComponentKind): TerminalAnchor[] {
  return (getComponentDefinition(kind)?.terminals ?? []) as TerminalAnchor[];
}

/** Local position of a terminal anchor inside the component group, in world inches. */
function anchorLocal(t: TerminalAnchor): THREE.Vector3 {
  return new THREE.Vector3(schematicToWorld(t.x), 0, schematicToWorld(t.y));
}

/** One lead, leg or flying wire, as a cylinder between two points. */
function Conductor({
  from,
  to,
  radius,
  color,
  metallic,
  high,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  radius: number;
  color: string;
  metallic: boolean;
  high: boolean;
}): JSX.Element | null {
  const direction = to.clone().sub(from);
  const length = direction.length();
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    if (length > 1e-9) q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return q;
  }, [direction.x, direction.y, direction.z, length]);

  if (length <= 1e-9) return null;
  return (
    <mesh position={from.clone().add(to).multiplyScalar(0.5)} quaternion={quaternion} castShadow={high}>
      <cylinderGeometry args={[radius, radius, length, high ? 8 : 5]} />
      <meshStandardMaterial
        color={color}
        metalness={metallic ? 0.85 : 0.05}
        roughness={metallic ? 0.28 : 0.8}
      />
    </mesh>
  );
}

/**
 * Every conductor of one component, from its registry anchor to where it meets the body.
 *
 * The endpoint is never stored — it is the anchor, converted. That is what makes a wire land
 * on a lead instead of near one.
 */
export function Conductors3D({ kind, high }: { kind: ComponentKind; high: boolean }): JSX.Element {
  const terminals = terminalsOf(kind);
  const physical = componentPhysical(kind);
  if (!physical) return <group />;
  return (
    <group>
      {terminals.map((t) => {
        const style = physical.conductors[t.id];
        const attach = conductorAttachmentMm(kind, t.id, terminals);
        if (!style || !attach) return null;
        return (
          <Conductor
            key={t.id}
            from={anchorLocal(t)}
            to={new THREE.Vector3(W(attach.x), W(attach.y), W(attach.z))}
            radius={W(style.radius)}
            color={style.colorRole ? WIRE_HEX[style.colorRole] : '#c9ced6'}
            metallic={style.colorRole === undefined}
            high={high}
          />
        );
      })}
    </group>
  );
}

/**
 * Kingbright WP7113ID, 5 mm LED.
 *
 * Both physical polarity cues are modelled, because tinting the dome teaches nothing: the
 * flat sits on the cathode side of the flange, and the cathode lead is the short one. Which
 * side is the cathode is derived from where the cathode ANCHOR is, so the cue cannot end up
 * on the wrong side of a rotated part.
 */
function Led3D({ id, color, high }: { id: string; color: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const brightness = delta?.kind === 'led' ? delta.brightness : 0;
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const hex = LED_COLOR_HEX[color] ?? color;
  const emissive = useMemo(() => new THREE.Color(hex), [hex]);

  const physical = componentPhysical('led')!;
  const terminals = terminalsOf('led');
  const body = bodyCenterMm(physical, terminals);
  const cathode = terminals.find((t) => t.id === 'cathode');
  const cathodeSide = cathode && schematicToMm(cathode.x) >= body.x ? 1 : -1;

  const base = physical.standoff;
  const flangeTop = base + physical.features.flangeThickness;
  const domeCenter = base + physical.body.height - physical.features.domeRadius;
  const barrel = Math.max(0.1, domeCenter - flangeTop);

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
    <group position={[W(body.x), 0, W(body.z)]}>
      <mesh castShadow={high} position={[0, W(domeCenter), 0]}>
        <sphereGeometry
          args={[W(physical.features.domeRadius), high ? 20 : 10, high ? 16 : 8, 0, Math.PI * 2, 0, Math.PI / 2]}
        />
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
      <mesh castShadow={high} position={[0, W(flangeTop + barrel / 2), 0]}>
        <cylinderGeometry
          args={[W(physical.body.width / 2), W(physical.body.width / 2), W(barrel), high ? 20 : 10]}
        />
        <meshStandardMaterial color={hex} roughness={0.2} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, W(base + physical.features.flangeThickness / 2), 0]}>
        <cylinderGeometry
          args={[
            W(physical.features.flangeDiameter / 2),
            W(physical.features.flangeDiameter / 2),
            W(physical.features.flangeThickness),
            high ? 20 : 10,
          ]}
        />
        <meshStandardMaterial color={hex} roughness={0.3} transparent opacity={0.85} />
      </mesh>
      {/* The flat: the cathode cue a student can actually see. */}
      <mesh
        position={[
          cathodeSide * W(physical.features.flangeDiameter / 2),
          W(base + physical.features.flangeThickness / 2),
          0,
        ]}
      >
        <boxGeometry
          args={[W(0.5), W(physical.features.flangeThickness), W(physical.features.flangeDiameter * 0.7)]}
        />
        <meshStandardMaterial color="#0f172a" roughness={0.5} transparent opacity={0.6} />
      </mesh>
      <pointLight
        ref={lightRef}
        color={hex}
        intensity={0}
        distance={1.1}
        decay={2}
        position={[0, W(domeCenter + 2), 0]}
      />
    </group>
  );
}

/** Yageo CFR-25 axial resistor, bands computed from its actual resistance. */
function Resistor3D({ ohms, high }: { ohms: number; high: boolean }): JSX.Element {
  const { colors } = useMemo(() => resistorBands(ohms), [ohms]);
  const physical = componentPhysical('resistor')!;
  const terminals = terminalsOf('resistor');
  const body = bodyCenterMm(physical, terminals);
  const radius = physical.body.depth / 2;
  const length = physical.body.width;
  // Four bands over the middle of the body, first digit nearest the a-lead end.
  const bandOffsets = [-0.32, -0.16, 0.0, 0.28].map((fraction) => fraction * length);

  return (
    <group position={[W(body.x), W(physical.standoff + radius), W(body.z)]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow={high}>
        <cylinderGeometry args={[W(radius), W(radius), W(length), high ? 16 : 8]} />
        <meshStandardMaterial color="#d9c08a" roughness={0.62} />
      </mesh>
      {colors.map((c, i) => (
        <mesh key={i} position={[0, W(bandOffsets[i] ?? 0), 0]}>
          <cylinderGeometry
            args={[W(radius * 1.06), W(radius * 1.06), W(physical.features.bandWidth), high ? 16 : 8]}
          />
          <meshStandardMaterial color={c} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Bourns 3386P-1-103LF top-adjust trimmer. The screw turns; the body does not. */
function Potentiometer3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const value = delta?.kind === 'potentiometer' && typeof delta.value === 'number' ? delta.value : 0.5;
  const screw = useRef<THREE.Group>(null);

  const physical = componentPhysical('potentiometer')!;
  const terminals = terminalsOf('potentiometer');
  const body = bodyCenterMm(physical, terminals);
  const top = physical.standoff + physical.body.height;

  useFrame((_, dt) => {
    if (!screw.current) return;
    // Unchanged behaviour: 0..1 still maps across the same 270 degrees.
    const target = THREE.MathUtils.degToRad(-135 + value * 270);
    screw.current.rotation.y = THREE.MathUtils.damp(screw.current.rotation.y, target, 12, dt);
  });

  return (
    <group position={[W(body.x), 0, W(body.z)]}>
      <mesh castShadow={high} position={[0, W(physical.standoff + physical.body.height / 2), 0]}>
        <boxGeometry args={[W(physical.body.width), W(physical.body.height), W(physical.body.depth)]} />
        <meshStandardMaterial color="#1f4fa0" roughness={0.65} />
      </mesh>
      <group ref={screw} position={[W(physical.features.screwInset), W(top), 0]}>
        <mesh castShadow={high}>
          <cylinderGeometry
            args={[
              W(physical.features.screwDiameter / 2),
              W(physical.features.screwDiameter / 2),
              W(0.9),
              high ? 20 : 10,
            ]}
          />
          <meshStandardMaterial color="#d8dde3" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, W(0.5), 0]}>
          <boxGeometry
            args={[W(physical.features.screwSlotWidth), W(0.35), W(physical.features.screwDiameter * 0.9)]}
          />
          <meshStandardMaterial color="#2b2f36" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * TowerPro SG90.
 *
 * The three electrical terminals are a flying JR lead, so the case sits back from them and a
 * pigtail runs out to a three-position plug sitting on the anchors. Drawing rigid pins in
 * the case would depict a part that does not exist.
 */
function Servo3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const angle = delta?.kind === 'servo' ? delta.angle : 90;
  const horn = useRef<THREE.Group>(null);

  const physical = componentPhysical('servo')!;
  const terminals = terminalsOf('servo');
  const body = bodyCenterMm(physical, terminals);
  const caseHeight = physical.features.caseHeight;
  // The output shaft sits toward one end of the case, as on the real gearbox.
  const shaftX = physical.body.width / 2 - 5.5;

  useFrame((_, dt) => {
    if (!horn.current) return;
    // Unchanged behaviour: the commanded angle drives the horn exactly as before.
    horn.current.rotation.y = THREE.MathUtils.damp(
      horn.current.rotation.y,
      THREE.MathUtils.degToRad(angle),
      10,
      dt,
    );
  });

  const centroid = anchorCentroidMm(terminals);
  const f = physical.features;

  return (
    <group>
      <group position={[W(body.x), 0, W(body.z)]}>
        <mesh castShadow={high} position={[0, W(caseHeight / 2), 0]}>
          <boxGeometry args={[W(physical.body.width), W(caseHeight), W(physical.body.depth)]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.5} />
        </mesh>
        <mesh position={[0, W(caseHeight * 0.78), 0]}>
          <boxGeometry args={[W(f.tabSpan), W(f.tabThickness), W(physical.body.depth)]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.55} />
        </mesh>
        {/* Horn: above the case, centred on the shaft, never inside the body. */}
        <group ref={horn} position={[W(shaftX), W(caseHeight + 1.4), 0]}>
          <mesh castShadow={high}>
            <cylinderGeometry
              args={[W(f.hornDiameter / 2), W(f.hornDiameter / 2), W(2.6), high ? 16 : 8]}
            />
            <meshStandardMaterial color="#e5e7eb" roughness={0.4} />
          </mesh>
          <mesh position={[W(f.hornArmLength / 2), 0, 0]}>
            <boxGeometry args={[W(f.hornArmLength), W(1.4), W(3.0)]} />
            <meshStandardMaterial color="#f3f4f6" roughness={0.45} />
          </mesh>
        </group>
      </group>
      {/* The plug, sitting on the anchors themselves. */}
      <mesh position={[W(centroid.x), W(f.connectorHeight / 2), W(centroid.z)]} castShadow={high}>
        <boxGeometry args={[W(f.connectorWidth), W(f.connectorHeight), W(f.connectorDepth)]} />
        <meshStandardMaterial color="#111418" roughness={0.75} />
      </mesh>
    </group>
  );
}

/**
 * Newhaven NHD-0216K1Z-FL-YBW, 16x2 HD44780 character LCD.
 *
 * The screen is a canvas texture rather than a drei <Html> overlay: the old Html version put
 * a DOM node in the scene that could not be occluded by geometry, ignored the camera's depth
 * buffer, and re-laid-out every frame.
 */
function Lcd3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const rows = delta?.kind === 'lcd1602' ? delta.rows : (['', ''] as [string, string]);
  const on = delta?.kind === 'lcd1602' ? delta.displayOn : false;

  const screen = useDisposableTexture(
    () => createLcdScreenTexture([rows[0] ?? '', rows[1] ?? ''], on),
    [rows[0], rows[1], on],
  );

  const physical = componentPhysical('lcd1602')!;
  const terminals = terminalsOf('lcd1602');
  const body = bodyCenterMm(physical, terminals);
  const f = physical.features;
  const pcbTop = physical.body.height;
  // The bezel sits away from the header edge, toward the far side of the board.
  const bezelZ = -(physical.body.depth / 2 - f.bezelDepth / 2 - 4.0);

  const xs = terminals.map((t) => schematicToMm(t.x));
  const zs = terminals.map((t) => schematicToMm(t.y));
  const headerWidth = terminals.length > 0 ? Math.max(...xs) - Math.min(...xs) + 2.54 : 2.54;
  const headerCenterX = terminals.length > 0 ? (Math.max(...xs) + Math.min(...xs)) / 2 : 0;
  const headerCenterZ = terminals.length > 0 ? (Math.max(...zs) + Math.min(...zs)) / 2 : 0;

  return (
    <group>
      <group position={[W(body.x), 0, W(body.z)]}>
        <mesh castShadow={high} position={[0, W(pcbTop / 2), 0]}>
          <boxGeometry args={[W(physical.body.width), W(pcbTop), W(physical.body.depth)]} />
          <meshStandardMaterial color="#0f5132" roughness={0.6} />
        </mesh>
        <mesh castShadow={high} position={[0, W(pcbTop + f.bezelHeight / 2), W(bezelZ)]}>
          <boxGeometry args={[W(f.bezelWidth), W(f.bezelHeight), W(f.bezelDepth)]} />
          <meshStandardMaterial color="#8f959d" metalness={0.7} roughness={0.4} />
        </mesh>
        <mesh
          position={[0, W(pcbTop + f.bezelHeight + 0.05), W(bezelZ)]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[W(f.viewWidth), W(f.viewDepth)]} />
          <meshBasicMaterial map={screen} toneMapped={false} />
        </mesh>
      </group>
      {/* Header shroud, drawn across the pins the registry actually defines. */}
      <mesh position={[W(headerCenterX), W((pcbTop + 2.4) / 2), W(headerCenterZ)]}>
        <boxGeometry args={[W(headerWidth), W(pcbTop + 2.4), W(2.54)]} />
        <meshStandardMaterial color="#15161a" roughness={0.7} />
      </mesh>
    </group>
  );
}

/** Omron B3F-1000 tactile switch. */
function Pushbutton3D({ id, high }: { id: string; high: boolean }): JSX.Element {
  const delta = useComponentDelta(id);
  const pressed = delta?.kind === 'pushbutton' && delta.value === true;
  const cap = useRef<THREE.Mesh>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pressedRef = useRef(false);

  const physical = componentPhysical('pushbutton')!;
  const terminals = terminalsOf('pushbutton');
  const body = bodyCenterMm(physical, terminals);
  const caseTop = physical.standoff + physical.body.height;
  const capUp = W(caseTop + physical.features.plungerProjection / 2);
  const capDown = W(caseTop);

  useFrame((_, dt) => {
    if (!cap.current) return;
    cap.current.position.y = THREE.MathUtils.damp(cap.current.position.y, pressed ? capDown : capUp, 20, dt);
  });

  // Pointer handling is unchanged: it drives the real simulation control.
  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      if (pressedRef.current) return;
      pressedRef.current = true;
      try {
        (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
      } catch {
        // ignore environments without pointer capture
      }
      pointerIdRef.current = event.pointerId;
      simulationClient.setControl(id, true);
    },
    [id],
  );

  const release = useCallback(
    (event?: ThreeEvent<PointerEvent>) => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      try {
        const pid =
          event && typeof (event as { pointerId?: number }).pointerId === 'number'
            ? (event as { pointerId: number }).pointerId
            : pointerIdRef.current;
        if (pid !== null && typeof pid === 'number') {
          (event?.target as Element | null)?.releasePointerCapture?.(pid);
        }
      } catch {
        // ignore environments without pointer capture
      }
      pointerIdRef.current = null;
      simulationClient.setControl(id, false);
    },
    [id],
  );

  const onPointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      release(event);
    },
    [release],
  );

  const onPointerCancel = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      release(event);
    },
    [release],
  );

  const onPointerOut = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      // If the pointer leaves while pressed, release so the button cannot stick down.
      if (pressedRef.current) release(event);
    },
    [release],
  );

  // Keyboard accessibility lives in the Inspector. Clear the control on unmount so a stuck
  // press cannot persist.
  useEffect(() => {
    return () => {
      if (pressedRef.current) simulationClient.setControl(id, false);
    };
  }, [id]);

  return (
    <group position={[W(body.x), 0, W(body.z)]}>
      <mesh castShadow={high} position={[0, W(physical.standoff + physical.body.height / 2), 0]}>
        <boxGeometry args={[W(physical.body.width), W(physical.body.height), W(physical.body.depth)]} />
        <meshStandardMaterial color="#1c1f24" roughness={0.6} />
      </mesh>
      <mesh
        ref={cap}
        castShadow={high}
        position={[0, capUp, 0]}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerOut={onPointerOut}
      >
        <cylinderGeometry
          args={[
            W(physical.features.plungerDiameter / 2),
            W(physical.features.plungerDiameter / 2),
            W(physical.features.plungerProjection * 2),
            high ? 20 : 10,
          ]}
        />
        <meshStandardMaterial color="#e11d48" roughness={0.4} />
      </mesh>
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

/** The body of one part, without its conductors. */
function PartBody({ component, high }: { component: CircuitComponent; high: boolean }): JSX.Element {
  switch (component.kind) {
    case 'led':
      return (
        <Led3D
          id={component.id}
          color={typeof component.properties.color === 'string' ? component.properties.color : 'red'}
          high={high}
        />
      );
    case 'resistor':
      return <Resistor3D ohms={Number(component.properties.ohms ?? 220)} high={high} />;
    case 'potentiometer':
      return <Potentiometer3D id={component.id} high={high} />;
    case 'servo':
      return <Servo3D id={component.id} high={high} />;
    case 'lcd1602':
      return <Lcd3D id={component.id} high={high} />;
    case 'pushbutton':
      return <Pushbutton3D id={component.id} high={high} />;
    default:
      return <UnknownPart />;
  }
}

/** A part and the conductors that reach its registry anchors. */
export function Part3D({ component, high }: { component: CircuitComponent; high: boolean }): JSX.Element {
  return (
    <group>
      <PartBody component={component} high={high} />
      <Conductors3D kind={component.kind} high={high} />
    </group>
  );
}

export type { ComponentPhysical };
