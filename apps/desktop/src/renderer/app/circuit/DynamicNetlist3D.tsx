/**
 * Maps the authoring netlist (useCircuit) into 3D and overlays live simulation state
 * (simulation.components display deltas). Renders INSIDE <CircuitCanvas3D>'s <Canvas>.
 *
 * - Terminal anchor points come from the trusted component registry (same source the
 *   2D canvas and the netlist compiler use), so wires attach exactly where the 2D
 *   schematic says the terminals are.
 * - Live state (LED brightness, servo angle, pot value, button press, LCD rows) is
 *   read per-component via narrow Zustand selectors; per-frame smoothing happens in
 *   useFrame with THREE.MathUtils.damp so React never re-renders at frame rate.
 * - 100% procedural geometry — zero external assets, zero network requests.
 */
import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  getComponentDefinition,
  terminalKey,
} from '@offline-arduino/simulator/circuit-model/component-registry';
import type { CircuitComponent, Point, WireColorRole } from '@offline-arduino/contracts/circuit';
import type { ComponentDisplayDelta } from '@offline-arduino/contracts/simulator';
import { useAppStore, useCircuit } from '../../state/store';

const SCALE = 0.012;
const WIRE_LIFT = 0.14;

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

export function DynamicNetlist3D(): JSX.Element {
  const { components, wires } = useCircuit();

  // Center the 3D world on the Uno so the board sits at the origin.
  const origin = useMemo(() => {
    const uno = components.find((c) => c.kind === 'uno-r3');
    return { x: uno?.x ?? 300, y: uno?.y ?? 250 };
  }, [components]);

  const to3D = useCallback(
    (p: Point, y = 0): THREE.Vector3 => new THREE.Vector3((p.x - origin.x) * SCALE, y, (p.y - origin.y) * SCALE),
    [origin],
  );

  // Every terminal's 3D anchor, keyed identically to the electrical netlist.
  const terminalPos = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const c of components) {
      const def = getComponentDefinition(c.kind);
      if (!def) continue;
      for (const t of def.terminals) {
        const p2 = terminal2D(c, t.x, t.y);
        map.set(terminalKey(c.id, t.id), to3D(p2, WIRE_LIFT));
      }
    }
    return map;
  }, [components, to3D]);

  return (
    <group name="dynamic-netlist">
      {wires.map((w) => {
        const a = terminalPos.get(terminalKey(w.from.componentId, w.from.terminalId));
        const b = terminalPos.get(terminalKey(w.to.componentId, w.to.terminalId));
        if (!a || !b) return null;
        const mids = w.waypoints.map((wp) => to3D(wp, WIRE_LIFT));
        return <NetWire key={w.id} points={[a, ...mids, b]} color={WIRE_HEX[w.colorRole]} />;
      })}

      {components.map((c) =>
        c.kind === 'uno-r3' ? null : (
          <ComponentNode key={c.id} component={c} position={to3D(c, 0).toArray() as [number, number, number]} />
        ),
      )}
    </group>
  );
}

function NetWire({
  points,
  color,
  radius = 0.02,
}: {
  points: THREE.Vector3[];
  color: string;
  radius?: number;
}): JSX.Element {
  const curve = useMemo(() => {
    if (points.length < 2) return null;
    const dense: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const p = points[i];
      const q = points[i + 1];
      dense.push(p);
      const mid = p.clone().add(q).multiplyScalar(0.5);
      // Slight sag between anchor points so wires read as physical jumpers.
      mid.y -= Math.min(0.45, p.distanceTo(q) * 0.18);
      dense.push(mid);
    }
    dense.push(points[points.length - 1]);
    return new THREE.CatmullRomCurve3(dense, false, 'catmullrom', 0.5);
  }, [points]);

  if (!curve) return <group />;
  return (
    <mesh castShadow receiveShadow>
      <tubeGeometry args={[curve, 48, radius, 10, false]} />
      <meshPhysicalMaterial
        color={color}
        roughness={0.85}
        metalness={0}
        clearcoat={0.3}
        clearcoatRoughness={0.6}
        sheen={0.4}
      />
    </mesh>
  );
}

function useComponentDelta(id: string): ComponentDisplayDelta | undefined {
  return useAppStore((s) => s.simulation.components[id]);
}

interface NodeProps {
  component: CircuitComponent;
  position: [number, number, number];
}

function ComponentNode({ component, position }: NodeProps): JSX.Element {
  const yaw = -(component.rotation * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {renderKind(component)}
    </group>
  );
}

function renderKind(c: CircuitComponent): JSX.Element {
  switch (c.kind) {
    case 'led':
      return <Led3D id={c.id} color={typeof c.properties.color === 'string' ? c.properties.color : 'red'} />;
    case 'resistor':
      return <Resistor3D />;
    case 'potentiometer':
      return <Potentiometer3D id={c.id} />;
    case 'servo':
      return <Servo3D id={c.id} />;
    case 'lcd1602':
      return <Lcd3D id={c.id} />;
    case 'pushbutton':
      return <Pushbutton3D id={c.id} />;
    default:
      return <UnknownPart />;
  }
}

const LED_COLOR_HEX: Record<string, string> = {
  red: '#ff3b30',
  green: '#34d058',
  blue: '#3b82f6',
  yellow: '#fbbf24',
  white: '#f4f4f5',
};

function Led3D({ id, color }: { id: string; color: string }): JSX.Element {
  const delta = useComponentDelta(id);
  const brightness = delta?.kind === 'led' ? delta.brightness : 0;
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const hex = LED_COLOR_HEX[color] ?? color;
  const emissive = useMemo(() => new THREE.Color(hex), [hex]);

  useFrame((_, dt) => {
    const target = brightness * 3.4;
    if (matRef.current) {
      matRef.current.emissiveIntensity = THREE.MathUtils.damp(matRef.current.emissiveIntensity, target, 14, dt);
    }
    if (lightRef.current) {
      lightRef.current.intensity = THREE.MathUtils.damp(lightRef.current.intensity, brightness * 1.6, 14, dt);
    }
  });

  return (
    <group>
      <mesh castShadow position={[0, 0.09, 0]}>
        <sphereGeometry args={[0.08, 24, 24]} />
        <meshStandardMaterial
          ref={matRef}
          color={hex}
          emissive={emissive}
          emissiveIntensity={0}
          roughness={0.15}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh position={[-0.03, 0, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.12, 8]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0.03, 0, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.12, 8]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
      </mesh>
      <pointLight ref={lightRef} color={hex} intensity={0} distance={1.2} decay={2} position={[0, 0.12, 0]} />
    </group>
  );
}

function Resistor3D(): JSX.Element {
  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.22, 16]} />
        <meshStandardMaterial color="#d9b382" roughness={0.6} />
      </mesh>
      {[-0.06, -0.02, 0.02].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <cylinderGeometry args={[0.051, 0.051, 0.015, 16]} />
          <meshStandardMaterial color={['#8a3324', '#111111', '#c62828'][i]} />
        </mesh>
      ))}
    </group>
  );
}

function Potentiometer3D({ id }: { id: string }): JSX.Element {
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
      <mesh castShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[0.24, 0.1, 0.24]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} />
      </mesh>
      <group ref={knob} position={[0, 0.12, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.06, 24]} />
          <meshStandardMaterial color="#374151" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.031, 0.06]}>
          <boxGeometry args={[0.02, 0.01, 0.09]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function Servo3D({ id }: { id: string }): JSX.Element {
  const delta = useComponentDelta(id);
  const angle = delta?.kind === 'servo' ? delta.angle : 90;
  const horn = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (!horn.current) return;
    const target = THREE.MathUtils.degToRad(angle);
    horn.current.rotation.y = THREE.MathUtils.damp(horn.current.rotation.y, target, 10, dt);
  });

  return (
    <group>
      <mesh castShadow position={[0, 0.1, 0]}>
        <boxGeometry args={[0.5, 0.2, 0.24]} />
        <meshStandardMaterial color="#1e3a8a" roughness={0.5} />
      </mesh>
      <group ref={horn} position={[0.16, 0.22, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.06, 16]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0.12, 0, 0]}>
          <boxGeometry args={[0.28, 0.02, 0.04]} />
          <meshStandardMaterial color="#f3f4f6" />
        </mesh>
      </group>
    </group>
  );
}

function Lcd3D({ id }: { id: string }): JSX.Element {
  const delta = useComponentDelta(id);
  const rows = delta?.kind === 'lcd1602' ? delta.rows : (['', ''] as [string, string]);
  const on = delta?.kind === 'lcd1602' ? delta.displayOn : false;

  return (
    <group>
      <mesh castShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[0.9, 0.16, 0.4]} />
        <meshStandardMaterial color={on ? '#134e2a' : '#0b2415'} roughness={0.6} />
      </mesh>
      <Html
        position={[0, 0.17, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        transform
        occlude
        distanceFactor={1.2}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            width: 150,
            padding: '4px 8px',
            background: on ? '#3fd07f' : '#1f5c38',
            color: '#06240f',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: '16px',
            borderRadius: 2,
            whiteSpace: 'pre',
          }}
        >
          {(rows[0] ?? '').padEnd(16).slice(0, 16)}
          {'\n'}
          {(rows[1] ?? '').padEnd(16).slice(0, 16)}
        </div>
      </Html>
    </group>
  );
}

function Pushbutton3D({ id }: { id: string }): JSX.Element {
  const delta = useComponentDelta(id);
  const pressed = delta?.kind === 'pushbutton' && delta.value === true;
  const cap = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    if (!cap.current) return;
    cap.current.position.y = THREE.MathUtils.damp(cap.current.position.y, pressed ? 0.11 : 0.15, 20, dt);
  });

  return (
    <group>
      <mesh castShadow position={[0, 0.06, 0]}>
        <boxGeometry args={[0.24, 0.12, 0.24]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.6} />
      </mesh>
      <mesh ref={cap} castShadow position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.06, 20]} />
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
