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
import { checkTerminalBudget } from '@offline-arduino/simulator';
import type {
  CircuitComponent,
  CircuitJunction,
  CircuitWire,
  ComponentKind,
  TerminalRef,
  WireColorRole,
} from '@offline-arduino/contracts/circuit';
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
  /**
   * A save that genuinely failed, as a message fit to show a student, or null.
   *
   * Never holds an Error, a stack, or a path: a failed save is something the student has to
   * act on, not a diagnostic. Cancelling a dialog leaves this null — that is not a failure.
   */
  saveError: string | null;
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
  /** Terminal the user picked first while drawing a wire, or null when not wiring. */
  pendingWireFrom: TerminalRef | null;
  /** Component kind armed in the library, placed on the next workspace click. */
  placementKind: ComponentKind | null;
}

/**
 * Undo history.
 *
 * Snapshots the *topology* only (components/wires/junctions) — never the selection or the
 * transient wiring/placement intent, so undo can't resurrect a half-drawn wire or fight the
 * user's current selection. Snapshot-based rather than command-based because the circuit is
 * small, plain, and serializable: correctness matters far more here than history size.
 */
export interface CircuitSnapshot {
  components: CircuitComponent[];
  wires: CircuitWire[];
  junctions: CircuitJunction[];
}

export interface HistoryState {
  past: CircuitSnapshot[];
  future: CircuitSnapshot[];
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
  /**
   * Records that the project now genuinely exists on disk at `path`.
   *
   * Only call this after a save or open has actually succeeded — the status bar treats
   * `sourcePath !== null` as proof a file exists, so a cancelled or failed save must never
   * reach here.
   */
  markProjectSaved(path: string): void;
  /**
   * Shows (message) or dismisses (null) the save-failure notice.
   *
   * Only genuine write/serialization failures set this. A cancelled dialog must not.
   */
  setSaveError(message: string | null): void;
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

  // --- Circuit authoring ---------------------------------------------------------------
  /** Arms a component kind for placement, or clears it with null. */
  armPlacement(kind: ComponentKind | null): void;
  /** Places the armed (or given) kind at a workspace position. Returns the new id. */
  /** Returns the new id, or null when the terminal budget refused the addition. */
  addComponent(kind: ComponentKind, x: number, y: number): string | null;
  /** Moves a component. Called continuously during a drag — coalesced into one undo step. */
  moveComponent(id: string, x: number, y: number, options?: { coalesce?: boolean }): void;
  /** Rotates a component by a quarter turn. */
  rotateComponent(id: string, quarterTurns?: number): void;
  /** Updates one editable property of a component. */
  setComponentProperty(id: string, key: string, value: string | number | boolean): void;
  /** Renames a component's display label. */
  setComponentLabel(id: string, label: string): void;
  /** Deletes components (and every wire attached to them). The board cannot be deleted. */
  deleteComponents(ids: string[]): void;
  /** Begins/continues wire drawing from a terminal; a second call completes the wire. */
  pickTerminal(terminal: TerminalRef, colorRole?: WireColorRole): void;
  /** Abandons an in-progress wire. */
  cancelWire(): void;
  /** Removes wires by id. */
  deleteWires(ids: string[]): void;
  undo(): void;
  redo(): void;
  applySimulationFrame(frame: {
    pinChanges: PinDisplayDelta[];
    nodeChanges: NodeDisplayDelta[];
    componentChanges: ComponentDisplayDelta[];
    /** CPU cycle count at the end of this frame, when the worker reported one. */
    cycles?: number;
  }): void;
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
  history: HistoryState;
  simulation: SimulationMirrorState;
  serial: SerialState;
  logic: LogicState;
  layout: LayoutState;
  actions: StoreActions;
}

const MAX_SERIAL_RECORDS = 20_000;
/** Cap per channel so a long capture can't grow renderer memory without bound. */
const MAX_LOGIC_EDGES_PER_PIN = 100_000;
/** Undo depth. Snapshots are small (plain JSON), so this costs very little. */
const MAX_HISTORY = 100;

/** Authoring grid, in the 2D schematic units the circuit model persists. */
const AUTHORING_GRID = 5;

const snap = (value: number): number => Math.round(value / AUTHORING_GRID) * AUTHORING_GRID;

function normalizeRotation(degrees: number): 0 | 90 | 180 | 270 {
  const wrapped = ((degrees % 360) + 360) % 360;
  return (Math.round(wrapped / 90) * 90) % 360 as 0 | 90 | 180 | 270;
}

const sameTerminal = (a: TerminalRef, b: TerminalRef): boolean =>
  a.componentId === b.componentId && a.terminalId === b.terminalId;

/** Sensible starting values so a freshly placed part is immediately usable. */
const DEFAULT_PROPERTIES: Record<ComponentKind, Record<string, string | number | boolean>> = {
  'uno-r3': {},
  led: { color: 'red', forwardV: 2.0, dynamicOhms: 10, ratedMilliAmps: 20 },
  resistor: { ohms: 220 },
  pushbutton: {},
  potentiometer: { ohms: 10_000, initialPosition: 0.5 },
  lcd1602: {},
  breadboard: {},
  servo: { minPulseMicros: 1000, maxPulseMicros: 2000, minAngle: 0, maxAngle: 180 },
};

const KIND_LABELS: Record<ComponentKind, string> = {
  'uno-r3': 'Arduino Uno',
  led: 'LED',
  resistor: 'Resistor',
  pushbutton: 'Pushbutton',
  potentiometer: 'Potentiometer',
  lcd1602: 'LCD 16x2',
  servo: 'Servo',
  breadboard: 'Breadboard',
};

/** Stable, human-meaningful ids — `led-1`, `led-2` — rather than opaque UUIDs. */
function nextComponentId(kind: ComponentKind, existing: CircuitComponent[]): string {
  let index = 1;
  const taken = new Set(existing.map((c) => c.id));
  while (taken.has(`${kind}-${index}`)) index += 1;
  return `${kind}-${index}`;
}

function defaultLabelFor(kind: ComponentKind, existing: CircuitComponent[]): string {
  const sameKind = existing.filter((c) => c.kind === kind).length;
  return sameKind === 0 ? KIND_LABELS[kind] : `${KIND_LABELS[kind]} ${sameKind + 1}`;
}

function nextWireId(existing: CircuitWire[]): string {
  let index = 1;
  const taken = new Set(existing.map((w) => w.id));
  while (taken.has(`wire-${index}`)) index += 1;
  return `wire-${index}`;
}

const snapshotOf = (circuit: CircuitAuthoringState): CircuitSnapshot => ({
  components: circuit.components,
  wires: circuit.wires,
  junctions: circuit.junctions,
});

const markDirty = (state: RootState): ProjectState =>
  state.project.dirty ? state.project : { ...state.project, dirty: true };

/**
 * Applies a circuit edit: pushes the pre-edit topology onto the undo stack, clears redo,
 * and marks the project dirty. Every mutating authoring action goes through this so undo
 * coverage can't drift out of sync with the actions.
 */
function commitCircuit(
  state: RootState,
  next: CircuitAuthoringState,
): Pick<RootState, 'circuit' | 'history' | 'project'> {
  return {
    circuit: next,
    history: {
      past: [...state.history.past, snapshotOf(state.circuit)].slice(-MAX_HISTORY),
      future: [],
    },
    project: markDirty(state),
  };
}

export const useAppStore = create<RootState>((set) => ({
  project: {
    projectId: 'draft',
    name: 'Untitled Sketch',
    sourcePath: null,
    sketch: 'void setup() {\n\n}\n\nvoid loop() {\n\n}\n',
    sourceRevision: 0,
    dirty: false,
    saveError: null,
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
    pendingWireFrom: null,
    placementKind: null,
  },
  history: { past: [], future: [] },
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
    // Matches the workbench's --editor-width default and the splitter's restore value.
    editorWidthPercent: 42,
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

    markProjectSaved: (path) =>
      // A successful save answers the failure notice, so it clears with the same set.
      set((state) => ({ project: { ...state.project, sourcePath: path, dirty: false, saveError: null } })),

    setSaveError: (message) => set((state) => ({ project: { ...state.project, saveError: message } })),

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

    setCircuit: (components, wires, junctions) =>
      set(() => ({
        circuit: { components, wires, junctions, selectedIds: [], pendingWireFrom: null, placementKind: null },
        // Loading a project or example is a new document, not an undoable edit.
        history: { past: [], future: [] },
      })),

    selectIds: (ids) => set((state) => ({ circuit: { ...state.circuit, selectedIds: ids } })),

    // --- Circuit authoring -------------------------------------------------------------
    armPlacement: (kind) =>
      set((state) => ({
        // Arming placement cancels any half-drawn wire so the two modes can't interleave.
        circuit: { ...state.circuit, placementKind: kind, pendingWireFrom: null },
      })),

    addComponent: (kind, x, y) => {
      // Checked before anything is created. A breadboard contributes 400 terminals, so a
      // circuit can go from fine to uncompilable in one drop; finding that out only at
      // compile time would leave a component on the bench that can never be simulated.
      const existing = useAppStore.getState().circuit.components;
      const budget = checkTerminalBudget(existing, kind);
      if (!budget.withinLimit) {
        // Refused before anything is created: no component, no id, no history entry. The
        // reason is available from `checkTerminalBudget` for whatever surfaces it.
        set((state) => ({ circuit: { ...state.circuit, placementKind: null } }));
        return null;
      }
      const id = nextComponentId(kind, existing);
      set((state) =>
        commitCircuit(state, {
          ...state.circuit,
          components: [
            ...state.circuit.components,
            {
              id,
              kind,
              x: snap(x),
              y: snap(y),
              rotation: 0,
              label: defaultLabelFor(kind, state.circuit.components),
              properties: { ...DEFAULT_PROPERTIES[kind] },
            },
          ],
          selectedIds: [id],
          placementKind: null,
        }),
      );
      return id;
    },

    moveComponent: (id, x, y, options) =>
      set((state) => {
        const components = state.circuit.components.map((c) =>
          c.id === id ? { ...c, x: snap(x), y: snap(y) } : c,
        );
        const next = { ...state.circuit, components };
        // A drag fires this every pointermove; coalescing keeps one undo entry per drag
        // instead of one per frame. The drag's start state is pushed by the first
        // non-coalesced call the drag handler makes on pointerdown.
        return options?.coalesce ? { circuit: next, project: markDirty(state) } : commitCircuit(state, next);
      }),

    rotateComponent: (id, quarterTurns = 1) =>
      set((state) =>
        commitCircuit(state, {
          ...state.circuit,
          components: state.circuit.components.map((c) =>
            c.id === id ? { ...c, rotation: normalizeRotation(c.rotation + quarterTurns * 90) } : c,
          ),
        }),
      ),

    setComponentProperty: (id, key, value) =>
      set((state) =>
        commitCircuit(state, {
          ...state.circuit,
          components: state.circuit.components.map((c) =>
            c.id === id ? { ...c, properties: { ...c.properties, [key]: value } } : c,
          ),
        }),
      ),

    setComponentLabel: (id, label) =>
      set((state) =>
        commitCircuit(state, {
          ...state.circuit,
          components: state.circuit.components.map((c) => (c.id === id ? { ...c, label } : c)),
        }),
      ),

    deleteComponents: (ids) =>
      set((state) => {
        // The board is the simulation target; deleting it would leave a circuit that can
        // never run, so it is not removable.
        const removable = new Set(
          ids.filter((id) => state.circuit.components.find((c) => c.id === id)?.kind !== 'uno-r3'),
        );
        if (removable.size === 0) return state;

        return commitCircuit(state, {
          ...state.circuit,
          components: state.circuit.components.filter((c) => !removable.has(c.id)),
          // A wire to a deleted terminal would dangle and break netlist compilation.
          wires: state.circuit.wires.filter(
            (w) => !removable.has(w.from.componentId) && !removable.has(w.to.componentId),
          ),
          selectedIds: state.circuit.selectedIds.filter((id) => !removable.has(id)),
          pendingWireFrom: removable.has(state.circuit.pendingWireFrom?.componentId ?? '')
            ? null
            : state.circuit.pendingWireFrom,
        });
      }),

    pickTerminal: (terminal, colorRole = 'signal-yellow') =>
      set((state) => {
        const pending = state.circuit.pendingWireFrom;

        // First pick: remember it and wait for the other end.
        if (!pending) {
          return { circuit: { ...state.circuit, pendingWireFrom: terminal, placementKind: null } };
        }

        // Clicking the same terminal twice cancels, which is the obvious way out.
        if (pending.componentId === terminal.componentId && pending.terminalId === terminal.terminalId) {
          return { circuit: { ...state.circuit, pendingWireFrom: null } };
        }

        // A duplicate wire between the same two terminals adds nothing electrically and
        // only creates a second thing to delete later.
        const duplicate = state.circuit.wires.some(
          (w) => sameTerminal(w.from, pending) && sameTerminal(w.to, terminal),
        ) || state.circuit.wires.some(
          (w) => sameTerminal(w.from, terminal) && sameTerminal(w.to, pending),
        );
        if (duplicate) return { circuit: { ...state.circuit, pendingWireFrom: null } };

        const wire: CircuitWire = {
          id: nextWireId(state.circuit.wires),
          from: pending,
          to: terminal,
          colorRole,
          waypoints: [],
        };
        return commitCircuit(state, {
          ...state.circuit,
          wires: [...state.circuit.wires, wire],
          pendingWireFrom: null,
          selectedIds: [wire.id],
        });
      }),

    cancelWire: () => set((state) => ({ circuit: { ...state.circuit, pendingWireFrom: null } })),

    deleteWires: (ids) =>
      set((state) => {
        const removable = new Set(ids);
        if (!state.circuit.wires.some((w) => removable.has(w.id))) return state;
        return commitCircuit(state, {
          ...state.circuit,
          wires: state.circuit.wires.filter((w) => !removable.has(w.id)),
          selectedIds: state.circuit.selectedIds.filter((id) => !removable.has(id)),
        });
      }),

    undo: () =>
      set((state) => {
        const previous = state.history.past[state.history.past.length - 1];
        if (!previous) return state;
        return {
          circuit: {
            ...state.circuit,
            ...previous,
            // Selections and in-flight intent are not part of history; drop anything that
            // now points at something the undo removed.
            selectedIds: state.circuit.selectedIds.filter(
              (id) => previous.components.some((c) => c.id === id) || previous.wires.some((w) => w.id === id),
            ),
            pendingWireFrom: null,
          },
          history: {
            past: state.history.past.slice(0, -1),
            future: [snapshotOf(state.circuit), ...state.history.future].slice(0, MAX_HISTORY),
          },
          project: markDirty(state),
        };
      }),

    redo: () =>
      set((state) => {
        const next = state.history.future[0];
        if (!next) return state;
        return {
          circuit: {
            ...state.circuit,
            ...next,
            selectedIds: state.circuit.selectedIds.filter(
              (id) => next.components.some((c) => c.id === id) || next.wires.some((w) => w.id === id),
            ),
            pendingWireFrom: null,
          },
          history: {
            past: [...state.history.past, snapshotOf(state.circuit)].slice(-MAX_HISTORY),
            future: state.history.future.slice(1),
          },
          project: markDirty(state),
        };
      }),

    applySimulationFrame: (frame) =>
      set((state) => {
        const pins = { ...state.simulation.pins };
        for (const p of frame.pinChanges) pins[p.boardPin] = p;
        const nodes = { ...state.simulation.nodes };
        for (const n of frame.nodeChanges) nodes[n.netId] = n;
        const components = { ...state.simulation.components };
        for (const c of frame.componentChanges) components[c.id] = c;
        return {
          simulation: {
            ...state.simulation,
            pins,
            nodes,
            components,
            // The worker stamps every FRAME with its cycle count. Previously only STATE
            // messages updated this, and STATE is only sent on phase transitions — so the
            // Circuit & Runtime tab sat at "Cycles 0 / 0.00 ms" for the whole run while
            // pins were visibly toggling.
            cycles: frame.cycles ?? state.simulation.cycles,
          },
        };
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
export const useCanUndo = () => useAppStore((s) => s.history.past.length > 0);
export const useCanRedo = () => useAppStore((s) => s.history.future.length > 0);
