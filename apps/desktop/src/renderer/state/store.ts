/**
 * Central Zustand store. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §4.
 *
 * NEVER put Monaco, Worker, Electron, DOM, or AVR8js instances in this store — only
 * plain serializable data. The simulation Worker/Monaco model objects live in
 * dedicated singletons (simulation-client.ts, editor/monaco-setup.ts) that publish
 * their state INTO this store.
 */
import { create } from 'zustand';
import type { CircuitDiagnostic, ComponentDisplayDelta, NodeDisplayDelta, PinDisplayDelta, PinEdge, PerformanceProfile, SimulationPhase } from '@offline-arduino/contracts/simulator';
import type { CompilerDiagnostic } from '@offline-arduino/contracts/compiler';
import type { CircuitComponent, CircuitJunction, CircuitWire } from '@offline-arduino/contracts/circuit';
import { STANDARD_PROFILE, LOW_SPEC_PROFILE } from '@offline-arduino/contracts/simulator';
import type { SerialRecord } from '@offline-arduino/contracts/serial';
import type { LogicEdge } from '../app/logic/logic-types';

// ---------------------------------------------------------------------------------------
// Project slice
// ---------------------------------------------------------------------------------------
export interface ProjectState {
  projectId: string;
  name: string;
  sourcePath: string | null;
  sketch: string;
  sourceRevision: number;
  dirty: boolean;
}

// ---------------------------------------------------------------------------------------
// Compiler slice
// ---------------------------------------------------------------------------------------
export type CompilerPhase = 'idle' | 'queued' | 'preprocess' | 'compile' | 'link' | 'hex' | 'done' | 'error';

export interface CompilerState {
  phase: CompilerPhase;
  requestId: string | null;
  lastValidHex: string | null;
  lastValidRevision: number | null;
  flashBytes: number;
  flashMaxBytes: number;
  sramBytes: number;
  sramMaxBytes: number;
  diagnostics: CompilerDiagnostic[];
}

// ---------------------------------------------------------------------------------------
// Circuit authoring slice
// ---------------------------------------------------------------------------------------
export interface CircuitAuthoringState {
  components: CircuitComponent[];
  wires: CircuitWire[];
  junctions: CircuitJunction[];
  selectedIds: string[];
}

// ---------------------------------------------------------------------------------------
// Simulation mirror slice (immutable display deltas from the latest valid worker frame)
// ---------------------------------------------------------------------------------------
export interface SimulationMirrorState {
  sessionId: string | null;
  phase: SimulationPhase;
  cycles: number;
  performance: PerformanceProfile;
  pins: Record<string, PinDisplayDelta>;
  nodes: Record<string, NodeDisplayDelta>;
  components: Record<string, ComponentDisplayDelta>;
  circuitDiagnostics: CircuitDiagnostic[];
  metrics: { simulatedHz: number; speedRatio: number; targetRatio: number; driftMs: number; frameRate: number } | null;
  faultMessage: string | null;
}

// ---------------------------------------------------------------------------------------
// Serial slice
// ---------------------------------------------------------------------------------------
export interface SerialState {
  records: SerialRecord[];
  truncatedCount: number;
  lineEnding: 'none' | 'lf' | 'cr' | 'crlf';
  viewMode: 'utf8' | 'hex';
  autoScroll: boolean;
  baudRate: number;
}

// ---------------------------------------------------------------------------------------
// Layout slice
// ---------------------------------------------------------------------------------------
export interface LayoutState {
  editorWidthPercent: number;
  bottomHeightPx: number;
  selectedBottomTab: 'serial' | 'problems' | 'runtime' | 'logic';
  trayVisible: boolean;
  inspectorVisible: boolean;
  lowSpecMode: boolean;
}

// ---------------------------------------------------------------------------------------
// Logic Analyzer slice — cycle-accurate pin transition capture (from FRAME.pinEdges)
// ---------------------------------------------------------------------------------------
export interface LogicState {
  /** Per-board-pin ascending edge lists. */
  edgesByPin: Record<string, LogicEdge[]>;
  /** Earliest / latest recorded cycle across all channels (0 when empty). */
  firstCycle: number;
  lastCycle: number;
  /** Sticky: the session's bounded capture filled and recording stopped. */
  truncated: boolean;
  /** UI intent: whether the Logic Analyzer is actively capturing. */
  capturing: boolean;
}

interface StoreActions {
  setSketch(text: string): void;
  markCompileQueued(requestId: string): void;
  applyCompileResult(result: {
    ok: boolean;
    requestId: string;
    sourceRevision: number;
    diagnostics: CompilerDiagnostic[];
    hex?: string;
    flashBytes?: number;
    flashMaxBytes?: number;
    sramBytes?: number;
    sramMaxBytes?: number;
  }): void;
  setCircuit(components: CircuitComponent[], wires: CircuitWire[], junctions: CircuitJunction[]): void;
  selectIds(ids: string[]): void;
  applySimulationFrame(frame: { pinChanges: PinDisplayDelta[]; nodeChanges: NodeDisplayDelta[]; componentChanges: ComponentDisplayDelta[] }): void;
  setSimulationPhase(sessionId: string | null, phase: SimulationPhase, cycles: number): void;
  setSimulationFault(message: string | null): void;
  setCircuitDiagnostics(items: CircuitDiagnostic[]): void;
  setMetrics(metrics: SimulationMirrorState['metrics']): void;
  appendSerialRecord(record: SerialRecord): void;
  clearSerial(): void;
  recordLogicEdges(edges: PinEdge[]): void;
  markLogicTruncated(): void;
  setLogicCapturing(enabled: boolean): void;
  clearLogic(): void;
  setLayout(partial: Partial<LayoutState>): void;
  setLowSpec(enabled: boolean): void;
}

export interface RootState {
  project: ProjectState;
  compiler: CompilerState;
  circuit: CircuitAuthoringState;
  simulation: SimulationMirrorState;
  serial: SerialState;
  logic: LogicState;
  layout: LayoutState;
  actions: StoreActions;
}

const MAX_SERIAL_RECORDS = 20_000;
/** Cap per channel so a long capture can't grow renderer memory without bound. */
const MAX_LOGIC_EDGES_PER_PIN = 100_000;

export const useAppStore = create<RootState>((set) => ({
  project: {
    projectId: 'draft',
    name: 'Untitled Sketch',
    sourcePath: null,
    sketch: 'void setup() {\n\n}\n\nvoid loop() {\n\n}\n',
    sourceRevision: 0,
    dirty: false,
  },
  compiler: {
    phase: 'idle',
    requestId: null,
    lastValidHex: null,
    lastValidRevision: null,
    flashBytes: 0,
    flashMaxBytes: 32_256,
    sramBytes: 0,
    sramMaxBytes: 2048,
    diagnostics: [],
  },
  circuit: {
    components: [{ id: 'uno1', kind: 'uno-r3', x: 60, y: 60, rotation: 0, label: 'Arduino Uno', properties: {} }],
    wires: [],
    junctions: [],
    selectedIds: [],
  },
  simulation: {
    sessionId: null,
    phase: 'empty',
    cycles: 0,
    performance: STANDARD_PROFILE,
    pins: {},
    nodes: {},
    components: {},
    circuitDiagnostics: [],
    metrics: null,
    faultMessage: null,
  },
  serial: {
    records: [],
    truncatedCount: 0,
    lineEnding: 'lf',
    viewMode: 'utf8',
    autoScroll: true,
    baudRate: 9600,
  },
  logic: {
    edgesByPin: {},
    firstCycle: 0,
    lastCycle: 0,
    truncated: false,
    capturing: true,
  },
  layout: {
    editorWidthPercent: 46,
    bottomHeightPx: 240,
    selectedBottomTab: 'problems',
    trayVisible: true,
    inspectorVisible: true,
    lowSpecMode: false,
  },

  actions: {
    setSketch: (text) =>
      set((state) => ({
        project: { ...state.project, sketch: text, sourceRevision: state.project.sourceRevision + 1, dirty: true },
      })),

    markCompileQueued: (requestId) =>
      set((state) => ({ compiler: { ...state.compiler, phase: 'queued', requestId } })),

    applyCompileResult: (result) =>
      set((state) => {
        if (result.requestId !== state.compiler.requestId) return state; // stale result, ignore
        if (result.ok) {
          return {
            compiler: {
              ...state.compiler,
              phase: 'done',
              lastValidHex: result.hex ?? state.compiler.lastValidHex,
              lastValidRevision: result.sourceRevision,
              flashBytes: result.flashBytes ?? state.compiler.flashBytes,
              flashMaxBytes: result.flashMaxBytes ?? state.compiler.flashMaxBytes,
              sramBytes: result.sramBytes ?? state.compiler.sramBytes,
              sramMaxBytes: result.sramMaxBytes ?? state.compiler.sramMaxBytes,
              diagnostics: result.diagnostics,
            },
          };
        }
        return { compiler: { ...state.compiler, phase: 'error', diagnostics: result.diagnostics } };
      }),

    setCircuit: (components, wires, junctions) => set(() => ({ circuit: { components, wires, junctions, selectedIds: [] } })),

    selectIds: (ids) => set((state) => ({ circuit: { ...state.circuit, selectedIds: ids } })),

    applySimulationFrame: (frame) =>
      set((state) => {
        const pins = { ...state.simulation.pins };
        for (const p of frame.pinChanges) pins[p.boardPin] = p;
        const nodes = { ...state.simulation.nodes };
        for (const n of frame.nodeChanges) nodes[n.netId] = n;
        const components = { ...state.simulation.components };
        for (const c of frame.componentChanges) components[c.id] = c;
        return { simulation: { ...state.simulation, pins, nodes, components } };
      }),

    setSimulationPhase: (sessionId, phase, cycles) =>
      set((state) => ({ simulation: { ...state.simulation, sessionId, phase, cycles } })),

    setSimulationFault: (message) => set((state) => ({ simulation: { ...state.simulation, faultMessage: message } })),

    setCircuitDiagnostics: (items) => set((state) => ({ simulation: { ...state.simulation, circuitDiagnostics: items } })),

    setMetrics: (metrics) => set((state) => ({ simulation: { ...state.simulation, metrics } })),

    appendSerialRecord: (record) =>
      set((state) => {
        const records = [...state.serial.records, record];
        let truncatedCount = state.serial.truncatedCount;
        while (records.length > MAX_SERIAL_RECORDS) {
          records.shift();
          truncatedCount += 1;
        }
        return { serial: { ...state.serial, records, truncatedCount } };
      }),

    clearSerial: () => set((state) => ({ serial: { ...state.serial, records: [], truncatedCount: 0 } })),

    recordLogicEdges: (edges) =>
      set((state) => {
        if (edges.length === 0) return state;
        const edgesByPin: Record<string, LogicEdge[]> = { ...state.logic.edgesByPin };
        let firstCycle = state.logic.firstCycle;
        let lastCycle = state.logic.lastCycle;
        let truncated = state.logic.truncated;
        const empty = Object.keys(state.logic.edgesByPin).length === 0;
        for (const e of edges) {
          const list = edgesByPin[e.boardPin] ? edgesByPin[e.boardPin].slice() : [];
          list.push({ cycle: e.cycle, level: e.logic });
          // Defensive renderer-side bound; the worker capture-stops first, so this is a
          // secondary guard that also flips the truncated indicator if it ever trips.
          if (list.length > MAX_LOGIC_EDGES_PER_PIN) {
            list.splice(0, list.length - MAX_LOGIC_EDGES_PER_PIN);
            truncated = true;
          }
          edgesByPin[e.boardPin] = list;
          if (empty && firstCycle === 0 && lastCycle === 0) firstCycle = e.cycle;
          if (e.cycle < firstCycle) firstCycle = e.cycle;
          if (e.cycle > lastCycle) lastCycle = e.cycle;
        }
        return { logic: { ...state.logic, edgesByPin, firstCycle, lastCycle, truncated } };
      }),

    markLogicTruncated: () =>
      set((state) => (state.logic.truncated ? state : { logic: { ...state.logic, truncated: true } })),

    setLogicCapturing: (enabled) => set((state) => ({ logic: { ...state.logic, capturing: enabled } })),

    clearLogic: () =>
      set((state) => ({
        logic: { edgesByPin: {}, firstCycle: 0, lastCycle: 0, truncated: false, capturing: state.logic.capturing },
      })),

    setLayout: (partial) => set((state) => ({ layout: { ...state.layout, ...partial } })),

    setLowSpec: (enabled) =>
      set((state) => ({
        layout: { ...state.layout, lowSpecMode: enabled },
        simulation: { ...state.simulation, performance: enabled ? LOW_SPEC_PROFILE : STANDARD_PROFILE },
      })),
  },
}));

export const useProject = () => useAppStore((s) => s.project);
export const useCompiler = () => useAppStore((s) => s.compiler);
export const useCircuit = () => useAppStore((s) => s.circuit);
export const useSimulation = () => useAppStore((s) => s.simulation);
export const useSerial = () => useAppStore((s) => s.serial);
export const useLogic = () => useAppStore((s) => s.logic);
export const useLayout = () => useAppStore((s) => s.layout);
export const useActions = () => useAppStore((s) => s.actions);
