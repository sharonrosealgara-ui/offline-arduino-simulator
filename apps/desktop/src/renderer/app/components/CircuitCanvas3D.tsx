/**
 * 3D WebGL circuit studio (three.js via @react-three/fiber).
 *
 * Offline-first guarantees:
 *  - NO network assets of any kind. Every mesh is procedural geometry and every label is a
 *    canvas texture drawn with OS fonts, so there is nothing to fetch, bundle, or license.
 *    The previous optional-GLB path (useGLTF + MeshoptDecoder) has been removed: no .glb
 *    ever shipped, the loader pulled a WASM decoder into the bundle for nothing, and its
 *    error boundary silently swallowed real failures.
 *  - Renders inside the existing CSP; R3F needs no extra workers or remote fonts.
 *
 * Live simulation wiring:
 *  - The board's `L` LED and every placed component read the AVR worker's display deltas
 *    from the app store. Per-frame reads happen inside useFrame via getState(), so frame
 *    updates never re-render React.
 *
 * Performance / leak hygiene:
 *  - Header pins, MCU leads, and ICSP pins are instanced (2-3 draw calls, not 80 meshes).
 *  - `dpr` capped at 1.5; low-spec drops shadows, antialiasing, and the contact light.
 *  - Canvas textures are owned by useDisposableTexture and released on unmount; R3F
 *    disposes declarative geometries/materials itself.
 */
import { Suspense, useCallback, useRef, type ElementRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

/** Schematic units → world inches. Must match DynamicNetlist3D's SCALE. */
const SCHEMATIC_SCALE = 0.012;

// Derived from drei's own component: `three-stdlib` exists only nested inside drei and
// does not resolve by name from application code.
type OrbitControlsImpl = ElementRef<typeof OrbitControls>;
import { UnoR3Board } from '../circuit/hardware/UnoR3Board';
import { DynamicNetlist3D } from '../circuit/DynamicNetlist3D';
import { CameraRig, type CameraRigHandle } from '../circuit/CameraRig';
import { ViewportOverlay } from '../circuit/ViewportOverlay';
import { EmptyWorkspaceHint } from '../circuit/EmptyWorkspaceHint';
import { useAppStore, useCircuit } from '../../state/store';

function SceneLighting({ high }: { high: boolean }): JSX.Element {
  return (
    <>
      {/* Studio three-point-ish rig: enough contrast for silkscreen and pin headers to
          read against the dark backdrop without blowing out the solder mask. */}
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#cdd8ff', '#191b21', 0.6]} />
      <directionalLight
        position={[3.2, 5.4, 2.6]}
        intensity={1.35}
        castShadow={high}
        shadow-mapSize-width={high ? 1024 : 512}
        shadow-mapSize-height={high ? 1024 : 512}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <directionalLight position={[-4.5, 2.8, -2]} intensity={0.42} color="#8ea2c8" />
      {high && <pointLight position={[0, 2.2, 2.4]} intensity={0.25} color="#ffffff" />}
    </>
  );
}

/**
 * The bench surface. Doubles as the placement target: when a component kind is armed in
 * the library, clicking here drops it at that point.
 *
 * The 3D world is centred on the board, so a world hit is converted back into the 2D
 * schematic coordinates the circuit model persists using the same SCALE the netlist
 * renderer uses.
 */
function Bench({ high }: { high: boolean }): JSX.Element {
  const armed = useAppStore((s) => s.circuit.placementKind);

  const drop = (point: THREE.Vector3): void => {
    const state = useAppStore.getState();
    const kind = state.circuit.placementKind;
    if (!kind) return;
    const uno = state.circuit.components.find((c) => c.kind === 'uno-r3');
    const originX = uno?.x ?? 300;
    const originY = uno?.y ?? 250;
    state.actions.addComponent(kind, originX + point.x / SCHEMATIC_SCALE, originY + point.z / SCHEMATIC_SCALE);
  };

  return (
    <>
      <gridHelper args={[24, 48, '#39404a', '#252930']} position={[0, -0.09, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.095, 0]}
        receiveShadow={high}
        onClick={(event) => {
          if (!armed) return;
          event.stopPropagation();
          drop(event.point);
        }}
        onPointerOver={() => {
          if (armed) document.body.style.cursor = 'copy';
        }}
        onPointerOut={() => {
          // Only clear what this plane set. It spans the whole workspace (24 x 24) and lies
          // under everything, so an unconditional reset here wiped the 'crosshair' a terminal
          // anchor had just set on pointer-over: moving onto a pin cleared its own affordance
          // in the same gesture. Now the crosshair survives.
          if (armed) document.body.style.cursor = '';
        }}
      >
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#171a1f" roughness={0.95} metalness={0.02} />
      </mesh>
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
  const high = !lowSpec;

  const circuit = useCircuit();
  const boardSelected = circuit.selectedIds.includes(
    circuit.components.find((c) => c.kind === 'uno-r3')?.id ?? '__none__',
  );
  const placedParts = circuit.components.filter((c) => c.kind !== 'uno-r3');

  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const rigRef = useRef<CameraRigHandle | null>(null);

  const handleFit = useCallback(() => rigRef.current?.fit(), []);
  const handleReset = useCallback(() => rigRef.current?.reset(), []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'radial-gradient(ellipse at 50% 36%, #1f2027 0%, #0c0d10 100%)',
      }}
      data-testid="circuit-canvas-3d"
    >
      <Canvas
        shadows={high}
        dpr={lowSpec ? 1 : [1, 1.5]}
        camera={{ position: [2.6, 3.0, 3.9], fov: 38, near: 0.05, far: 60 }}
        gl={{ antialias: high, powerPreference: 'high-performance', alpha: true }}
        frameloop="always"
        // Clicking empty space clears the selection, matching the 2D canvas.
        onPointerMissed={() => useAppStore.getState().actions.selectIds([])}
      >
        <SceneLighting high={high} />
        <Bench high={high} />

        <Suspense fallback={null}>
          <UnoR3Board selected={boardSelected} quality={lowSpec ? 'low' : 'high'} />
          <DynamicNetlist3D quality={lowSpec ? 'low' : 'high'} />
        </Suspense>

        <CameraRig ref={rigRef} controls={controlsRef} />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          minDistance={1.2}
          maxDistance={14}
          maxPolarAngle={Math.PI / 2.05}
          makeDefault
        />
      </Canvas>

      <ViewportOverlay onFit={handleFit} onReset={handleReset} />
      {placedParts.length === 0 && <EmptyWorkspaceHint />}
    </div>
  );
}
