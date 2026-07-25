/**
 * 3D WebGL circuit canvas (three.js via @react-three/fiber).
 *
 * Offline-first guarantees:
 *  - NO CDN/network assets. Optional GLB models under public/assets/models/ are
 *    bundled locally; when absent we render procedural primitives (below).
 *  - Renders inside the existing CSP (`worker-src 'self' blob:`); R3F needs no
 *    extra workers or remote fonts.
 *
 * Live simulation wiring:
 *  - LED glow derives from the central app store's simulation mirror
 *    (`simulation.components[id]` -> ComponentDisplayDelta{kind:'led', brightness}
 *    with a fallback to digital pin logic in `simulation.pins`), which the
 *    AVR8js Web Worker publishes via simulation-client. Zustand subscription is
 *    read inside useFrame via getState() so per-frame updates never re-render React.
 *
 * Performance / leak hygiene:
 *  - `frameloop="always"` with `dpr` capped at 1.5; low-spec mode drops effects.
 *  - R3F disposes GL context + geometries automatically on unmount; the parent
 *    grid cell resize is handled by R3F's built-in resize observer (no manual
 *    listeners to leak).
 */
import { Component, Suspense, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Bounds } from '@react-three/drei';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as THREE from 'three';
import { useAppStore } from '../../state/store';
import { DynamicNetlist3D } from '../circuit/DynamicNetlist3D';

/**
 * Optional Meshopt-compressed board model. The decoder is a self-contained WASM module
 * (embedded, no CDN fetch) so it stays within `connect-src 'self'`. Compress the asset
 * with:
 *   npx @gltf-transform/cli optimize <in.glb> <out.glb> --compress meshopt --texture-compress webp
 */
const BOARD_MODEL_URL = '/assets/models/arduino_uno.glb';

const BOARD_GREEN = '#1a6b3c';
const PCB_EDGE = '#14522e';
const HEADER_BLACK = '#1c1c1e';
const BREADBOARD_WHITE = '#e8e6e0';
const LED_RED_OFF = '#5a1010';
const LED_RED_ON = '#ff3b30';

/** The LED component id / pin this canvas visualizes by default (Blink wiring). */
const DEFAULT_LED_COMPONENT_KIND = 'led';
const DEFAULT_DIGITAL_PIN = 'D13';

/** Reads live LED brightness (0..1) from the store without re-rendering React. */
function readLedBrightness(): number {
  const state = useAppStore.getState();
  // Preferred source: the simulator's LED display delta (accounts for PWM etc).
  for (const delta of Object.values(state.simulation.components)) {
    if (delta.kind === DEFAULT_LED_COMPONENT_KIND) {
      return Math.min(1, Math.max(0, (delta as { brightness: number }).brightness));
    }
  }
  // Fallback: raw digital pin logic (Blink on D13 without an explicit LED part).
  const pin = state.simulation.pins[DEFAULT_DIGITAL_PIN];
  if (pin && pin.logic === 1) return 1;
  return 0;
}

function ArduinoUnoModel(): JSX.Element {
  return (
    <group position={[-1.6, 0, 0]}>
      {/* PCB */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.7, 0.08, 2.1]} />
        <meshStandardMaterial color={BOARD_GREEN} roughness={0.6} metalness={0.1} />
      </mesh>
      {/* USB port */}
      <mesh position={[-1.15, 0.14, -0.6]} castShadow>
        <boxGeometry args={[0.5, 0.22, 0.45]} />
        <meshStandardMaterial color="#9ea3a8" roughness={0.35} metalness={0.8} />
      </mesh>
      {/* Power jack */}
      <mesh position={[-1.1, 0.12, 0.65]} castShadow>
        <boxGeometry args={[0.45, 0.2, 0.4]} />
        <meshStandardMaterial color={HEADER_BLACK} roughness={0.5} />
      </mesh>
      {/* ATmega328P DIP */}
      <mesh position={[0.45, 0.09, 0.35]} castShadow>
        <boxGeometry args={[0.9, 0.1, 0.32]} />
        <meshStandardMaterial color="#111114" roughness={0.45} />
      </mesh>
      {/* Header rails */}
      <mesh position={[0.25, 0.12, -0.92]} castShadow>
        <boxGeometry args={[1.9, 0.16, 0.14]} />
        <meshStandardMaterial color={HEADER_BLACK} roughness={0.5} />
      </mesh>
      <mesh position={[0.35, 0.12, 0.92]} castShadow>
        <boxGeometry args={[1.7, 0.16, 0.14]} />
        <meshStandardMaterial color={HEADER_BLACK} roughness={0.5} />
      </mesh>
      {/* PCB edge accent */}
      <mesh position={[0, -0.045, 0]}>
        <boxGeometry args={[2.72, 0.012, 2.12]} />
        <meshStandardMaterial color={PCB_EDGE} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Meshopt-decoded GLB board. Throws (caught by BoardModelBoundary) if the asset is absent. */
function ArduinoUnoGltf(): JSX.Element {
  // useGLTF(path, useDraco=false, useMeshopt=true, extendLoader) — wire MeshoptDecoder explicitly.
  const { scene } = useGLTF(BOARD_MODEL_URL, false, true, (loader) => loader.setMeshoptDecoder(MeshoptDecoder));
  useMemo(() => {
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);
  return <primitive object={scene} position={[-1.6, 0, 0]} dispose={null} />;
}

/** Renders the compressed GLB when present, else falls back to the procedural board. */
class BoardModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    // Expected until public/assets/models/arduino_uno.glb ships — procedural board is used.
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function BreadboardModel(): JSX.Element {
  const holes = useMemo(() => {
    const list: Array<[number, number]> = [];
    for (let x = 0; x < 12; x += 1) {
      for (let z = 0; z < 5; z += 1) {
        list.push([-0.66 + x * 0.12, -0.28 + z * 0.14]);
      }
    }
    return list;
  }, []);

  return (
    <group position={[1.7, 0, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.16, 1.1]} />
        <meshStandardMaterial color={BREADBOARD_WHITE} roughness={0.85} />
      </mesh>
      {/* center channel */}
      <mesh position={[0, 0.081, 0]}>
        <boxGeometry args={[1.8, 0.004, 0.08]} />
        <meshStandardMaterial color="#c9c6bd" roughness={0.9} />
      </mesh>
      {/* tie-point holes (instanced-ish cheap boxes) */}
      {holes.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.084, z]}>
          <boxGeometry args={[0.03, 0.004, 0.03]} />
          <meshStandardMaterial color="#3a3a3a" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** LED whose emissive intensity tracks the live simulated pin/LED state. */
function LedModel(): JSX.Element {
  const bodyRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  // Smoothed brightness so PWM fades look natural at 60 FPS.
  const smoothed = useRef(0);

  useFrame((_, delta) => {
    const target = readLedBrightness();
    smoothed.current += (target - smoothed.current) * Math.min(1, delta * 14);
    const b = smoothed.current;

    const body = bodyRef.current;
    if (body && body.material instanceof THREE.MeshStandardMaterial) {
      body.material.emissiveIntensity = b * 2.2;
      body.material.color.set(b > 0.05 ? LED_RED_ON : LED_RED_OFF);
    }
    const halo = haloRef.current;
    if (halo && halo.material instanceof THREE.MeshBasicMaterial) {
      halo.material.opacity = b * 0.35;
      halo.scale.setScalar(1 + b * 0.4);
    }
    if (lightRef.current) lightRef.current.intensity = b * 1.6;
  });

  return (
    <group position={[1.7, 0.28, 0]}>
      {/* dome */}
      <mesh ref={bodyRef} castShadow>
        <sphereGeometry args={[0.13, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={LED_RED_OFF}
          emissive={LED_RED_ON}
          emissiveIntensity={0}
          roughness={0.25}
          transparent
          opacity={0.92}
        />
      </mesh>
      {/* cylindrical base */}
      <mesh position={[0, -0.05, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.13, 0.1, 24]} />
        <meshStandardMaterial color={LED_RED_OFF} roughness={0.3} transparent opacity={0.92} />
      </mesh>
      {/* legs */}
      <mesh position={[-0.04, -0.22, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.26, 8]} />
        <meshStandardMaterial color="#b9bec4" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0.04, -0.19, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.2, 8]} />
        <meshStandardMaterial color="#b9bec4" metalness={0.9} roughness={0.25} />
      </mesh>
      {/* glow halo (cheap emissive billboard-ish sphere) */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshBasicMaterial color={LED_RED_ON} transparent opacity={0} depthWrite={false} />
      </mesh>
      <pointLight ref={lightRef} color={LED_RED_ON} intensity={0} distance={2.5} decay={2} />
    </group>
  );
}

function SceneContents(): JSX.Element {
  return (
    <>
      {/* Lower ambient + hemisphere gradient + a cool fill = crisper contrast so LEDs,
          pin headers, and IC chips read against the dark slate backdrop. */}
      <ambientLight intensity={0.4} />
      <hemisphereLight args={['#cdd8ff', '#191b21', 0.55]} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-5, 3, -2]} intensity={0.45} color="#8ea2c8" />

      {/* Auto-frame the board + live circuit to ~65% of the viewport on load (margin 1.5
          ≈ content fills 1/1.5). Lights, grid, ground, and controls stay OUTSIDE Bounds
          so they don't inflate the fit box. */}
      <Bounds fit clip margin={1.5}>
        {/* Prefer the Meshopt-compressed GLB; fall back to the procedural board offline. */}
        <Suspense fallback={<ArduinoUnoModel />}>
          <BoardModelBoundary fallback={<ArduinoUnoModel />}>
            <ArduinoUnoGltf />
          </BoardModelBoundary>
        </Suspense>
        {/* Live circuit: components + wires mirrored from the 2D authoring netlist,
            with real-time LED glow / servo rotation / LCD text from the AVR worker. */}
        <Suspense fallback={null}>
          <DynamicNetlist3D />
        </Suspense>
      </Bounds>

      {/* Subtle grid + ground plane for spatial depth (grid sits just above the floor). */}
      <gridHelper args={[24, 24, '#3a3f47', '#26292f']} position={[0, -0.085, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#1a1d22" roughness={0.95} />
      </mesh>

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={2.5}
        maxDistance={12}
        maxPolarAngle={Math.PI / 2.05}
        makeDefault
      />
    </>
  );
}

export interface CircuitCanvas3DProps {
  /** Rendering quality. 'low' caps DPR at 1 and disables shadows/antialiasing. */
  quality?: 'low' | 'high';
}

export function CircuitCanvas3D({ quality }: CircuitCanvas3DProps = {}): JSX.Element {
  const storeLowSpec = useAppStore((s) => s.layout.lowSpecMode);
  const lowSpec = quality != null ? quality === 'low' : storeLowSpec;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        // Sleek dark slate radial gradient (shows through the transparent canvas).
        background: 'radial-gradient(ellipse at 50% 38%, #1e1e24 0%, #0d0d11 100%)',
      }}
      data-testid="circuit-canvas-3d"
    >
      <Canvas
        shadows={!lowSpec}
        dpr={lowSpec ? 1 : [1, 1.5]}
        camera={{ position: [3.4, 3.2, 4.8], fov: 40 }}
        // alpha:true → transparent canvas so the CSS radial gradient is the backdrop.
        gl={{ antialias: !lowSpec, powerPreference: 'high-performance', alpha: true }}
        frameloop="always"
      >
        <SceneContents />
      </Canvas>
    </div>
  );
}
