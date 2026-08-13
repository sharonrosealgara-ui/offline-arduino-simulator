/**
 * TEMPORARY — post-C4 routing smoke harness. Not committed, not shipped, not reachable from
 * the application.
 *
 * NO TRACKED FILE IS MODIFIED. An earlier review needed a `probe` prop on `CircuitCanvas3D`
 * to reach the R3F store from outside its Canvas. That is unnecessary here: this harness owns
 * its own `<Canvas>` and mounts the REAL `DynamicNetlist3D` inside it, so a probe is simply a
 * child of a Canvas this file controls. `CircuitCanvas3D` is untouched.
 *
 * WHAT IS PRODUCTION AND WHAT IS NOT
 *   production: DynamicNetlist3D, BreadboardNode, Breadboard3D, UnoR3Board, the store and its
 *               commands, buildWireCurve, sceneWireClearance, the portals, the obstacles and
 *               every canonical contract.
 *   harness   : the Canvas element, the lighting rig and bench (values copied from
 *               CircuitCanvas3D so the look matches), OrbitControls, the camera presets, the
 *               scenario fixtures and this HUD.
 *
 * The distinction matters: geometry and routing on screen are production; the room they are
 * lit in is not. Nothing about the routing algorithm is reimplemented anywhere in this
 * directory — see route-diagnostics.ts.
 *
 * The production 3D gate in CircuitPane is untouched and still blocks breadboard projects in
 * the real application. This mounts the layer beneath it, which is the only way to look at
 * work that is deliberately not user-reachable yet.
 */
import { Profiler, StrictMode, useCallback, useEffect, useMemo, useRef, useState, type ProfilerOnRenderCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Canvas, useStore } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { DynamicNetlist3D } from '../src/renderer/app/circuit/DynamicNetlist3D';
import { useAppStore } from '../src/renderer/state/store';
import { BENCH_SURFACE_Y, GRID_SURFACE_Y } from '../src/renderer/app/circuit/hardware/scene-layout';
import { breadboardPlacements } from '../src/renderer/app/circuit/hardware/breadboard-scene';
import { breadboardObstacleVolumes } from '../src/renderer/app/circuit/hardware/breadboard-obstacles';
import { diagnoseWire, reversalDifference, TOLERANCES, type RouteDiag } from './route-diagnostics';

// =========================================================================================
// Fixtures — in-memory only. No project file, no schema, no persistence.
// =========================================================================================
const uno = (): CircuitComponent =>
  ({ id: 'uno1', kind: 'uno-r3', x: 300, y: 250, rotation: 0, label: 'Arduino Uno', properties: {} }) as CircuitComponent;
const bb = (id: string, x: number, y: number, rotation = 0): CircuitComponent =>
  ({ id, kind: 'breadboard', x, y, rotation, label: id, properties: {} }) as CircuitComponent;
const w = (id: string, from: [string, string], to: [string, string]): CircuitWire =>
  ({
    id,
    from: { componentId: from[0], terminalId: from[1] },
    to: { componentId: to[0], terminalId: to[1] },
    colorRole: 'signal-yellow',
    waypoints: [],
  }) as CircuitWire;

interface Scenario {
  id: string;
  title: string;
  expect: string;
  components: CircuitComponent[];
  wires: CircuitWire[];
  active: string;
  reversal?: boolean;
}

const SCENARIOS: Scenario[] = [
  { id: 's1', title: '1. Uno to breadboard hole E10', expect: 'Endpoint terminates in E10; route clear of the body.', components: [uno(), bb('bb1', 620, 250)], wires: [w('w1', ['uno1', 'D13'], ['bb1', 'E10'])], active: 'bb1' },
  { id: 's2', title: '2. Reversed endpoint order', expect: 'Geometry equivalent to scenario 1; reversal difference ~0.', components: [uno(), bb('bb1', 620, 250)], wires: [w('w1', ['bb1', 'E10'], ['uno1', 'D13'])], active: 'bb1', reversal: true },
  { id: 's3', title: '3. Same board across the channel', expect: 'E7 to F7 does not dive through the channel or body.', components: [uno(), bb('bb1', 620, 250)], wires: [w('w1', ['bb1', 'E7'], ['bb1', 'F7'])], active: 'bb1' },
  { id: 's4', title: '4. Rail to bank', expect: 'TP7 and E7 are per-hole anchors, not group centres.', components: [uno(), bb('bb1', 620, 250)], wires: [w('w1', ['bb1', 'TP7'], ['bb1', 'E7'])], active: 'bb1' },
  { id: 's5', title: '5. Corner to corner', expect: 'A1 to J30 rises over its own board.', components: [uno(), bb('bb1', 620, 250)], wires: [w('w1', ['bb1', 'A1'], ['bb1', 'J30'])], active: 'bb1' },
  { id: 's6', title: '6. Breadboard to breadboard', expect: 'Exemptions isolated by board id.', components: [uno(), bb('bb1', 560, 120), bb('bb2', 560, 430)], wires: [w('w1', ['bb1', 'J15'], ['bb2', 'A15'])], active: 'bb1' },
  // Board pitch must exceed the board's own width. An un-rotated breadboard is 3.3071 in
  // across, which is 330.71 px at this scale, so the original 280 px pitch buried each
  // adjacent pair 0.5071 in inside the next — genuine intersecting solids, correctly caught
  // by the fixture guard. 360 px leaves a 0.2929 in gap and keeps bb2 between the endpoints.
  { id: 's7', title: '7. Three boards, one between', expect: 'bb1 to bb3 clears bb2; all obstacle ids listed; no bodies intersect.', components: [uno(), bb('bb1', 480, 250), bb('bb2', 840, 250), bb('bb3', 1200, 250)], wires: [w('w1', ['bb1', 'E15'], ['bb3', 'E15'])], active: 'bb2' },
  { id: 's8', title: '8. Move and rotate connected', expect: 'Identities unchanged; positions and signature change.', components: [uno(), bb('bb1', 620, 250)], wires: [w('w1', ['uno1', 'D13'], ['bb1', 'E10']), w('w2', ['bb1', 'TP3'], ['uno1', '5V'])], active: 'bb1' },
  { id: 's9', title: '9. Rotated crossing boards', expect: 'Bounds and exemptions follow each world transform; bodies must not intersect.', components: [uno(), bb('bb1', 560, 60, 90), bb('bb2', 680, 480, 270)], wires: [w('w1', ['bb1', 'E5'], ['bb2', 'E25'])], active: 'bb1' },
  { id: 's10', title: '10. Long span, low angle', expect: 'Uniform vertical lift (MINOR-2) judged visually.', components: [uno(), bb('bb1', 380, 250), bb('bb2', 1180, 250)], wires: [w('w1', ['bb1', 'A1'], ['bb2', 'J30'])], active: 'bb1' },
];


/**
 * Do the breadboard bodies in a scenario intersect?
 *
 * Scenario 9 originally placed a 90-degree and a 270-degree board so their bodies overlapped
 * by 0.94 x 0.71 in. The router then reported a clearance violation at a fixed endpoint that
 * sat inside the OTHER board — correct behaviour on an impossible scene, but it read as a
 * routing defect. A fixture that cannot be built must never be presented as a valid result,
 * so every scenario is checked against the real production obstacle volumes.
 *
 * One board's owned exemption is never applied to another board here: this asks only whether
 * two solids share space, which no exemption can change.
 */
function bodyOverlaps(components: CircuitComponent[]): string[] {
  const origin = (() => {
    const u = components.find((c) => c.kind === 'uno-r3');
    return { x: u?.x ?? 300, y: u?.y ?? 250 };
  })();
  const placements = breadboardPlacements(components, origin);
  const problems: string[] = [];

  const worldBox = (p: { componentId: string; x: number; z: number; rotationDegrees: number }) => {
    const [volume] = breadboardObstacleVolumes(p.componentId);
    // Corners of the local footprint, turned by the board's own rotation.
    const a = (p.rotationDegrees * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const xs: number[] = [];
    const zs: number[] = [];
    for (const [lx, lz] of [
      [volume.minX, volume.minZ], [volume.maxX, volume.minZ],
      [volume.minX, volume.maxZ], [volume.maxX, volume.maxZ],
    ]) {
      xs.push(p.x + lx * cos - lz * sin);
      zs.push(p.z + lx * sin + lz * cos);
    }
    return { id: p.componentId, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top: volume.top };
  };

  const boxes = placements.map(worldBox);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      // Positive on BOTH axes is a real shared volume; touching edges are not.
      if (ox > 0 && oz > 0) {
        problems.push(`${a.id} & ${b.id} intersect: x overlap ${ox.toFixed(4)} in, z overlap ${oz.toFixed(4)} in`);
      }
    }
  }
  return problems;
}

/** World AABBs of every board, reported so the fitted input is auditable. */
function boardBoxes(components: CircuitComponent[]): string[] {
  const u = components.find((c) => c.kind === 'uno-r3');
  const origin = { x: u?.x ?? 300, y: u?.y ?? 250 };
  return breadboardPlacements(components, origin).map((p) => {
    const [volume] = breadboardObstacleVolumes(p.componentId);
    const a = (p.rotationDegrees * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const xs: number[] = [];
    const zs: number[] = [];
    for (const [lx, lz] of [
      [volume.minX, volume.minZ], [volume.maxX, volume.minZ],
      [volume.minX, volume.maxZ], [volume.maxX, volume.maxZ],
    ]) {
      xs.push(p.x + lx * cos - lz * sin);
      zs.push(p.z + lx * sin + lz * cos);
    }
    return `${p.componentId} @ (${p.x.toFixed(4)}, ${p.z.toFixed(4)}) rot ${p.rotationDegrees}deg  ` +
      `x [${Math.min(...xs).toFixed(4)}, ${Math.max(...xs).toFixed(4)}]  ` +
      `z [${Math.min(...zs).toFixed(4)}, ${Math.max(...zs).toFixed(4)}]  top ${volume.top.toFixed(4)}`;
  });
}

const FIXED_MOVE = { dx: 180, dy: -90 };

function applyScenario(s: Scenario): void {
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  useAppStore.setState((state) => ({
    circuit: {
      ...state.circuit,
      components: clone(s.components) as never,
      wires: clone(s.wires) as never,
      junctions: [],
      selectedIds: [],
      pendingWireFrom: null,
      placementKind: null,
    },
    history: { past: [], future: [] },
    simulation: { ...state.simulation, circuitDiagnostics: [] },
  }));
}

// =========================================================================================
// Scene — harness Canvas, production contents.
// =========================================================================================
type R3FStore = ReturnType<typeof useStore>;

function StoreProbe({ onStore }: { onStore(s: R3FStore): void }): null {
  const store = useStore();
  useEffect(() => onStore(store), [store, onStore]);
  return null;
}

/** Lighting and bench values copied from CircuitCanvas3D so the look matches production. */
function HarnessScene(): JSX.Element {
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#cdd8ff', '#191b21', 0.6]} />
      <directionalLight position={[3.2, 5.4, 2.6]} intensity={1.35} />
      <directionalLight position={[-4.5, 2.8, -2]} intensity={0.42} color="#8ea2c8" />
      <pointLight position={[0, 2.2, 2.4]} intensity={0.25} />
      <gridHelper args={[24, 48, '#39404a', '#252930']} position={[0, GRID_SURFACE_Y, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, BENCH_SURFACE_Y, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#171a1f" roughness={0.95} metalness={0.02} />
      </mesh>
    </>
  );
}

// =========================================================================================
// Harness
// =========================================================================================
function Review(): JSX.Element {
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[index];
  const circuit = useAppStore((s) => s.circuit);
  const storeRef = useRef<R3FStore | null>(null);
  const [preset, setPreset] = useState('(default)');
  const [baseline, setBaseline] = useState<Record<string, string> | null>(null);

  // ---- performance observation (MAJOR-1 evidence, not a fix) ----------------------------
  //
  // A run finishes when ten commits have COMPLETED, never when ten frames have elapsed.
  //
  // The previous version issued one `forceRender` per animation frame for ten frames and
  // published on the eleventh. Frames arrive every ~17 ms; a measured commit here takes
  // hundreds. React batched the ten requests into a handful of commits, and the summary read
  // the sample array while commits were still in flight — with measurement already switched
  // off, so every late sample was discarded. How many landed inside that window depended on
  // machine load, which is why one run reported n=7 and another n=4. Frames were being
  // counted as though a frame were a commit.
  //
  // Each controlled render is tagged as awaited; `onRender` clears the tag as it records the
  // sample; nothing new is requested until the tag is clear. So ten requests yield exactly
  // ten observations.
  //
  // What the tag CANNOT be checked from is a passive effect. The Profiler sits inside the
  // <Canvas>, so the tree it measures belongs to react-three-fiber's own reconciler root —
  // created with ConcurrentRoot, and fed from the Canvas's layout effect via updateContainer,
  // which schedules rather than flushes. The r3f commit therefore lands AFTER the DOM root's
  // passive effects. A driver effect that read the tag always read it still set, returned, and
  // left nothing scheduled; when the observation finally arrived it had no way to wake anyone.
  // That deadlock is what held the HUD on `measuring…` indefinitely.
  //
  // So the progression is driven by a self-re-arming frame watcher that polls for the
  // acknowledgement instead. Frames only ask "has it landed yet"; they are never counted as
  // progress. Only a recorded Profiler observation advances the run, and only ten of them
  // finish it.
  const MEASURED_RENDERS = 10;

  /**
   * How long ONE awaited observation may go missing before the run is declared stalled.
   *
   * Failure reporting only, and deliberately far beyond any plausible commit: at 60 Hz this is
   * fifteen seconds, where a measured commit here takes a few hundred milliseconds. It cannot
   * produce a successful result — reaching it publishes a stall, never an `n=10`. It is not a
   * performance threshold, and nothing about MAJOR-1 is judged by it.
   */
  const MAX_OBSERVATION_WAIT_FRAMES = 900;

  const samples = useRef<number[]>([]);
  const measuring = useRef(false);
  const commitCount = useRef(0);
  /** Set when a controlled render is requested, cleared by the commit that answers it. */
  const awaitingCommit = useRef(false);
  /** Invalidates callbacks still held by an abandoned run. */
  const runId = useRef(0);
  /** The single outstanding frame request, so a restart or unmount can cancel it. */
  const pendingFrame = useRef<number | null>(null);
  /** Consecutive frames the current observation has been outstanding. Diagnostic only. */
  const waitFrames = useRef(0);
  /** The scene as it stood when the run began, to prove the run did not disturb it. */
  const runContext = useRef<{ scenario: string; transforms: string; wires: string } | null>(null);

  const [commits, setCommits] = useState(0);
  const [perf, setPerf] = useState<string>('no controlled run yet');
  const [perfContext, setPerfContext] = useState<string>('');
  /** Bumping this is the controlled render; the value itself is never read. */
  const [, setTick] = useState(0);

  const onRender = useCallback<ProfilerOnRenderCallback>((_id, _phase, actualDuration) => {
    commitCount.current += 1;
    // Refs only, never a state setter: a setter here re-renders the subtree, which fires this
    // callback again — the self-sustaining loop that ran the counter past 68 while idle.
    // The awaited tag admits at most one sample per requested render, and the ten-sample cap
    // means the summary's own commit can never become sample 11.
    if (measuring.current && awaitingCommit.current && samples.current.length < MEASURED_RENDERS) {
      awaitingCommit.current = false;
      samples.current.push(actualDuration);
    }
  }, []);

  const cancelPendingFrame = useCallback(() => {
    if (pendingFrame.current !== null) {
      cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
    }
  }, []);

  /**
   * Abandons any measurement in progress and leaves nothing scheduled behind it.
   *
   * Refs only — no state setter — so it is safe as unmount cleanup.
   */
  const abortMeasurement = useCallback(() => {
    runId.current += 1; // every callback the old chain holds now fails its identity check
    measuring.current = false;
    awaitingCommit.current = false;
    waitFrames.current = 0;
    cancelPendingFrame();
  }, [cancelPendingFrame]);

  /**
   * Abort, and say so on screen.
   *
   * `abortMeasurement` deliberately touches no state, which on its own would leave the HUD
   * reading `measuring…` for a run that had already been called off. Reset and scenario change
   * go through here instead so an abandoned run is visibly abandoned. An aborted run never
   * publishes statistics.
   */
  const abortActiveRun = useCallback((label: string) => {
    const wasMeasuring = measuring.current;
    abortMeasurement();
    if (wasMeasuring) {
      setPerf(label);
      setPerfContext('');
    }
  }, [abortMeasurement]);

  /** Nothing may still be scheduled once this panel goes away. Cleanup runs on unmount only. */
  useEffect(() => abortMeasurement, [abortMeasurement]);

  useEffect(() => {
    abortActiveRun('run aborted — scenario changed');
    applyScenario(scenario);
    setBaseline(null);
    setPreset('(default)');
  }, [scenario, abortActiveRun]);

  const handleStore = useCallback((s: R3FStore) => { storeRef.current = s; }, []);

  const camera = useCallback((label: string, spec: 'close' | 'low') => {
    const store = storeRef.current;
    if (!store) { setPreset(`${label} — no renderer store`); return; }
    const state = store.getState();
    const cam = state.camera as THREE.PerspectiveCamera;
    const orbit = state.controls as unknown as { target?: THREE.Vector3; update?(): void } | null;

    const box = new THREE.Box3();
    const scratch = new THREE.Box3();
    state.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = mesh.geometry.boundingBox;
      if (!local) return;
      const size = local.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) > 12) return; // bench / grid backdrop
      scratch.setFromObject(mesh);
      if (!scratch.isEmpty()) box.union(scratch);
    });
    if (box.isEmpty()) return;

    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    const halfV = (cam.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
    const fill = spec === 'close' ? 1.35 : 0.85;
    const distance = (radius / Math.sin(Math.min(halfV, halfH))) / fill;
    // Low angle sits near the bench so the vertical lift is judged edge-on.
    const dir = spec === 'close'
      ? new THREE.Vector3(0.55, 0.62, 0.56).normalize()
      : new THREE.Vector3(0.72, 0.12, 0.68).normalize();

    cam.position.copy(centre).add(dir.multiplyScalar(distance));
    cam.lookAt(centre);
    orbit?.target?.copy(centre);
    orbit?.update?.();
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    setPreset(label);
  }, []);

  const move = () => {
    const c = circuit.components.find((x) => x.id === scenario.active);
    if (c) useAppStore.getState().actions.moveComponent(scenario.active, c.x + FIXED_MOVE.dx, c.y + FIXED_MOVE.dy);
  };
  const rotate = () => useAppStore.getState().actions.rotateComponent(scenario.active, 1);

  // ---- diagnostics ----------------------------------------------------------------------
  const diags: RouteDiag[] = useMemo(
    () => circuit.wires.map((wire) => diagnoseWire(circuit.components, wire)).filter((d): d is RouteDiag => d !== null),
    [circuit.components, circuit.wires],
  );
  const reversal = useMemo(
    () => (scenario.reversal && circuit.wires[0] ? reversalDifference(circuit.components, circuit.wires[0]) : null),
    [scenario.reversal, circuit.components, circuit.wires],
  );

  const signatures = useMemo(() => Object.fromEntries(diags.map((d) => [d.wireId, d.signature])), [diags]);
  const identitiesNow = useMemo(() => diags.map((d) => `${d.fromId}->${d.toId}`).join(' | '), [diags]);

  const overlapProblems = useMemo(() => bodyOverlaps(circuit.components as CircuitComponent[]), [circuit.components]);
  const verdict =
    overlapProblems.length === 0 &&
    diags.length > 0 &&
    diags.every((d) => d.pass) &&
    (reversal === null || reversal <= 1e-6);

  /** Ends the run successfully. Only ten recorded observations may bring us here. */
  const finalizeMeasurement = () => {
    // Measurement off BEFORE any setter, so the summary's own commit cannot be sample 11.
    measuring.current = false;
    awaitingCommit.current = false;
    waitFrames.current = 0;
    cancelPendingFrame();

    const run = samples.current.slice(0, MEASURED_RENDERS);
    const sorted = [...run].sort((a, b) => a - b);
    const before = runContext.current;
    const after = {
      scenario: scenario.id,
      transforms: JSON.stringify(useAppStore.getState().circuit.components),
      wires: JSON.stringify(useAppStore.getState().circuit.wires),
    };
    setCommits(commitCount.current);
    setPerf(
      `n=${run.length}  latest ${run[run.length - 1].toFixed(2)}ms  min ${sorted[0].toFixed(2)}ms  ` +
      `median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}ms  max ${sorted[sorted.length - 1].toFixed(2)}ms`,
    );
    setPerfContext(
      before
        ? `scenario ${before.scenario === after.scenario ? 'unchanged' : 'CHANGED'}; ` +
          `transforms ${before.transforms === after.transforms ? 'unchanged' : 'CHANGED'}; ` +
          `wires ${before.wires === after.wires ? 'unchanged' : 'CHANGED'}`
        : '',
    );
  };

  /** Ends the run as a failure. Reports what was collected; never reports a result. */
  const reportStall = () => {
    measuring.current = false;
    awaitingCommit.current = false;
    cancelPendingFrame();
    const collected = samples.current.length;
    waitFrames.current = 0;
    setCommits(commitCount.current);
    setPerf(`stalled after ${collected} of ${MEASURED_RENDERS} samples`);
    setPerfContext(
      `no Profiler observation for ${MAX_OBSERVATION_WAIT_FRAMES} consecutive frames; ` +
      `observed commits ${commitCount.current}. Diagnostic only — this is not a measurement.`,
    );
  };

  /**
   * Polls for the awaited observation, one frame at a time, until the run ends.
   *
   * A frame is only an opportunity to ask whether the acknowledgement has landed. It never
   * counts as progress: the run advances solely when `awaitingCommit` has been cleared by a
   * recorded Profiler observation, and ends solely when ten of them exist.
   */
  const startObservationWatcher = (myRun: number) => {
    const step = (): void => {
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = null;
        if (runId.current !== myRun || !measuring.current) return; // stale chain, or aborted

        if (awaitingCommit.current) {
          // The controlled render is still in flight in the r3f root. Keep watching.
          waitFrames.current += 1;
          if (waitFrames.current >= MAX_OBSERVATION_WAIT_FRAMES) {
            reportStall();
            return;
          }
          step();
          return;
        }

        waitFrames.current = 0;
        if (samples.current.length >= MEASURED_RENDERS) {
          finalizeMeasurement();
          return;
        }
        // Exactly one controlled render may be outstanding: the tag is set before the tick is
        // requested, and no tick is ever requested while it is set.
        awaitingCommit.current = true;
        setTick((v) => v + 1);
        step();
      });
    };
    step();
  };

  /**
   * Starts a run of exactly ten measured commits, requests the first, and starts one watcher.
   *
   * Clicking twice cannot produce two chains: the pending frame is cancelled and the run token
   * bumped before anything else, so every callback the previous watcher still holds fails its
   * identity check and returns without rescheduling itself.
   */
  const runTenRenders = () => {
    cancelPendingFrame();
    runId.current += 1;
    const myRun = runId.current;
    samples.current = [];
    commitCount.current = 0;
    waitFrames.current = 0;
    runContext.current = {
      scenario: scenario.id,
      transforms: JSON.stringify(useAppStore.getState().circuit.components),
      wires: JSON.stringify(useAppStore.getState().circuit.wires),
    };
    setCommits(0);
    setPerf('measuring…');
    setPerfContext('');
    measuring.current = true;
    awaitingCommit.current = true;
    setTick((v) => v + 1);
    startObservationWatcher(myRun);
  };

  const btn: React.CSSProperties = { padding: '3px 7px', margin: 2, fontSize: 12, cursor: 'pointer' };
  const dt: React.CSSProperties = { opacity: 0.7 };
  const boards = circuit.components.filter((c) => c.kind === 'breadboard');

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#0c0d10' }}>
      <aside style={{ width: 400, flex: '0 0 400px', height: '100vh', overflowY: 'auto', padding: 10, background: '#15171b', color: '#e6e8ec', fontFamily: 'system-ui, sans-serif', fontSize: 12, lineHeight: 1.45 }}>
        <strong style={{ color: '#facc15' }}>Post-C4 routing smoke harness (temporary)</strong>
        <p style={{ opacity: 0.75 }}>Real production routing and renderer. The application 3D gate is untouched.</p>

        <label htmlFor="scenario-select" style={{ display: 'block', marginTop: 6 }}>Scenario</label>
        <select id="scenario-select" name="scenario" value={index} onChange={(e) => setIndex(Number(e.target.value))} style={{ width: '100%', padding: 4 }}>
          {SCENARIOS.map((s, i) => <option key={s.id} value={i}>{s.title}</option>)}
        </select>
        <p style={{ minHeight: 30, opacity: 0.85 }}>{scenario.expect}</p>

        <div
          style={{
            margin: '6px 0', padding: '5px 7px', borderRadius: 4,
            border: `1px solid ${verdict ? '#2f6b46' : '#7a2b2b'}`,
            background: verdict ? '#12301f' : '#2c1414',
            color: verdict ? '#4fd486' : '#ff6b6b', fontWeight: 700,
          }}
        >
          SCENARIO VERDICT: {verdict ? 'PASS' : 'FAIL'}
        </div>

        <div>
          <button style={btn} aria-label="Previous scenario" onClick={() => setIndex((i) => Math.max(0, i - 1))}>Prev</button>
          <button style={btn} aria-label="Next scenario" onClick={() => setIndex((i) => Math.min(SCENARIOS.length - 1, i + 1))}>Next</button>
          <button style={btn} aria-label="Reset scenario" onClick={() => { abortActiveRun('run aborted by Reset'); applyScenario(scenario); }}>Reset</button>
        </div>
        <div>
          <button style={btn} aria-label="Close camera" onClick={() => camera('Close', 'close')}>Close camera</button>
          <button style={btn} aria-label="Low angle camera" onClick={() => camera('Low angle', 'low')}>Low angle</button>
        </div>
        <div>
          <button style={btn} aria-label="Move connected board" onClick={move}>Move board (+180,-90)</button>
          <button style={btn} aria-label="Rotate connected board 90 degrees" onClick={rotate}>Rotate 90&deg;</button>
        </div>
        <div>
          <button style={btn} aria-label="Reset board transform" onClick={() => { abortActiveRun('run aborted by Reset transform'); applyScenario(scenario); }}>Reset transform</button>
          <button style={btn} aria-label="Capture baseline route" onClick={() => setBaseline({ ...signatures, __ids: identitiesNow } as never)}>Capture baseline</button>
        </div>
        <div>Active preset: <b style={{ color: '#facc15' }}>{preset}</b></div>

        <hr style={{ opacity: 0.2, margin: '8px 0' }} />
        <strong>Scene</strong>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1px 8px', margin: '4px 0' }}>
          <dt style={dt}>Boards</dt><dd>{boards.length} — {boards.map((b) => `${b.id}@(${b.x},${b.y})/${b.rotation}deg`).join(', ') || 'none'}</dd>
          <dt style={dt}>Wires</dt><dd>{circuit.wires.length}</dd>
        </dl>

        {baseline && (
          <div style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid #3a3f46', margin: '4px 0' }}>
            <b>Baseline captured</b><br />
            identities: {String(baseline.__ids)}<br />
            identities now: <span style={{ color: String(baseline.__ids) === identitiesNow ? '#4fd486' : '#ff6b6b' }}>{identitiesNow}</span><br />
            {diags.map((d) => (
              <div key={d.wireId}>
                {d.wireId} signature {baseline[d.wireId]} &rarr; {d.signature}{' '}
                <b style={{ color: baseline[d.wireId] !== d.signature ? '#4fd486' : '#facc15' }}>
                  {baseline[d.wireId] !== d.signature ? 'CHANGED' : 'identical'}
                </b>
              </div>
            ))}
          </div>
        )}

        {(() => {
          const problems = bodyOverlaps(circuit.components as CircuitComponent[]);
          return (
            <div
              style={{
                margin: '6px 0', padding: '4px 6px', borderRadius: 4,
                border: `1px solid ${problems.length === 0 ? '#2f6b46' : '#7a2b2b'}`,
                background: problems.length === 0 ? '#12301f' : '#2c1414',
                color: problems.length === 0 ? '#4fd486' : '#ff6b6b',
              }}
            >
              <b>FIXTURE GUARD: {problems.length === 0 ? 'no board bodies intersect' : 'INTERSECTING BODIES'}</b>
              {problems.map((line) => <div key={line}>{line}</div>)}
            </div>
          );
        })()}
        {boardBoxes(circuit.components as CircuitComponent[]).map((line) => (
          <div key={line} style={{ opacity: 0.85 }}>{line}</div>
        ))}

        <hr style={{ opacity: 0.2, margin: '8px 0' }} />
        <strong>Routes</strong>
        {diags.length === 0 && <div style={{ opacity: 0.6 }}>(no routable wires)</div>}
        {diags.map((d) => (
          <div key={d.wireId} style={{ margin: '6px 0', padding: '4px 6px', borderRadius: 4, border: `1px solid ${d.pass ? '#2f6b46' : '#7a2b2b'}` }}>
            <b>{d.wireId}: {d.fromId} &rarr; {d.toId}</b> <b style={{ color: d.pass ? '#4fd486' : '#ff6b6b' }}>{d.pass ? 'PASS' : 'FAIL'}</b>
            <div>from {d.fromWorld} to {d.toWorld}</div>
            <div>signature {d.signature} · samples {d.samples} · iterations {d.iterations}/{TOLERANCES.maxIterations}</div>
            <div>fallback: {d.usedFallback ? `YES — ${d.fallbackReason}` : 'no'}</div>
            <div style={{ color: d.clearanceOk ? '#4fd486' : '#ff6b6b' }}>clearance worst margin {d.worstMargin.toExponential(3)} in ({d.clearanceOk ? 'clear' : 'VIOLATION'})</div>
            <div style={{ color: d.endpointOk ? '#4fd486' : '#ff6b6b' }}>endpoint error {d.endpointError.toExponential(3)} in</div>
            <div>min segment {d.minSegment.toExponential(3)} in · zero-length: {d.zeroLength}</div>
            <div style={{ color: d.nonFinite === 'none' ? '#4fd486' : '#ff6b6b' }}>non-finite: {d.nonFinite}</div>
            <div>electrical identity: {d.identityOk ? 'resolved' : 'UNRESOLVED'}</div>
            <div style={{ opacity: 0.8 }}>obstacles ({d.obstacleIds.length}): {d.obstacleIds.join(', ')}</div>
          </div>
        ))}

        {reversal !== null && (
          <div style={{ padding: '4px 6px', borderRadius: 4, border: `1px solid ${reversal <= 1e-6 ? '#2f6b46' : '#7a2b2b'}`, color: reversal <= 1e-6 ? '#4fd486' : '#ff6b6b' }}>
            reversal max positional difference: {reversal.toExponential(3)} in (reverse-normalised, 129 samples)
          </div>
        )}

        <hr style={{ opacity: 0.2, margin: '8px 0' }} />
        <strong>Performance (MAJOR-1 evidence only)</strong>
        <div><button style={btn} aria-label="Run ten controlled renders" onClick={runTenRenders}>Run 10 measured renders</button></div>
        <div>commits observed: {commits}</div>
        <div>{perf}</div>
        <div style={{ opacity: 0.85 }}>{perfContext}</div>
        <div style={{ opacity: 0.7 }}>No pass threshold is defined. This collects evidence; it does not resolve MAJOR-1.</div>

        <hr style={{ opacity: 0.2, margin: '8px 0' }} />
        <strong>Tolerances (from production)</strong>
        <div>clearance {TOLERANCES.clearance} — {TOLERANCES.clearanceUnits}</div>
        <div>endpoint {TOLERANCES.endpoint} — {TOLERANCES.endpointUnits}</div>
        <div>wire radius {TOLERANCES.wireRadius} in · epsilon {TOLERANCES.epsilon} in · max iterations {TOLERANCES.maxIterations}</div>
        <p style={{ opacity: 0.7 }}>Drag empty background to orbit; scroll to zoom.</p>
      </aside>

      <main style={{ flex: '1 1 auto', minWidth: 0, height: '100vh', position: 'relative' }}>
        <Canvas
          shadows={false}
          dpr={[1, 1.5]}
          camera={{ position: [2.6, 3.0, 3.9], fov: 38, near: 0.05, far: 60 }}
          gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
          frameloop="always"
        >
          <HarnessScene />
          <StoreProbe onStore={handleStore} />
          {/* The production renderer, profiled. */}
          <Profiler id="routing" onRender={onRender}>
            <DynamicNetlist3D quality="high" />
          </Profiler>
          <OrbitControls enableDamping dampingFactor={0.08} minDistance={0.4} maxDistance={40} makeDefault />
        </Canvas>
      </main>
    </div>
  );
}

createRoot(document.getElementById('review-root')!).render(
  <StrictMode>
    <Review />
  </StrictMode>,
);
