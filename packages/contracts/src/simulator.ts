/**
 * Worker <-> renderer simulation protocol and runtime netlist contracts.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §3.
 *
 * Dependency-free on purpose: both the renderer and the worker import this without
 * pulling in React, Electron, Node, or AVR8js.
 */

export const SIM_PROTOCOL_VERSION = 1 as const;

export type PortName = 'B' | 'C' | 'D';

export type SimulationPhase =
  | 'empty'
  | 'ready'
  | 'paused'
  | 'running'
  | 'faulted'
  | 'disposed';

export interface RuntimeNet {
  id: string;
  terminals: string[];
  rail?: 'VCC_5V' | 'VCC_3V3' | 'GND';
}

export interface BoardPinBinding {
  boardPin: string;
  netId: string;
  port?: PortName;
  bit?: number;
  adcChannel?: number;
}

export type RuntimeElement =
  | { kind: 'resistor'; id: string; a: string; b: string; ohms: number }
  | {
      kind: 'led';
      id: string;
      anode: string;
      cathode: string;
      forwardV: number;
      dynamicOhms: number;
      ratedMilliAmps: number;
      color: string;
    }
  | {
      kind: 'switch';
      id: string;
      a: string;
      b: string;
      controlId: string;
      closedOhms: number;
    }
  | {
      kind: 'potentiometer';
      id: string;
      a: string;
      wiper: string;
      b: string;
      ohms: number;
      minimumOhms: number;
      controlId: string;
      initialPosition: number;
    }
  | { kind: 'lcd1602'; id: string; pins: Record<string, string> }
  | {
      kind: 'servo';
      id: string;
      vcc: string;
      ground: string;
      signal: string;
      minPulseMicros: number;
      maxPulseMicros: number;
      minAngle: number;
      maxAngle: number;
    };

export interface CircuitDiagnostic {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  code: string;
  message: string;
  componentIds?: string[];
  netIds?: string[];
}

export interface RuntimeNetlist {
  schemaVersion: 1;
  topologyHash: string;
  nets: RuntimeNet[];
  boardPins: BoardPinBinding[];
  elements: RuntimeElement[];
  diagnostics: CircuitDiagnostic[];
}

export interface PerformanceProfile {
  mode: 'standard' | 'low-spec' | 'custom';
  /** Wall-clock rate. 1 keeps simulated cycles aligned to a 16 MHz real-time target. */
  speedMultiplier: number;
  frameRate: 30 | 60;
  maxSliceWallMs: number;
  maxInstructionsPerSlice: number;
  maxCatchUpMs: number;
}

export const STANDARD_PROFILE: PerformanceProfile = {
  mode: 'standard',
  speedMultiplier: 1,
  frameRate: 60,
  maxSliceWallMs: 8,
  maxInstructionsPerSlice: 50_000,
  maxCatchUpMs: 100,
};

export const LOW_SPEC_PROFILE: PerformanceProfile = {
  mode: 'low-spec',
  speedMultiplier: 0.25,
  frameRate: 30,
  maxSliceWallMs: 4,
  maxInstructionsPerSlice: 15_000,
  maxCatchUpMs: 40,
};

export type RendererToWorker =
  | {
      v: 1;
      type: 'INITIALIZE';
      sessionId: string;
      board: 'uno';
      netlist: RuntimeNetlist;
      performance: PerformanceProfile;
    }
  | { v: 1; type: 'LOAD_HEX'; sessionId: string; sourceRevision: number; hex: string }
  | { v: 1; type: 'START'; sessionId: string }
  | { v: 1; type: 'PAUSE'; sessionId: string }
  | { v: 1; type: 'STEP_INSTRUCTION'; sessionId: string }
  | { v: 1; type: 'RESET'; sessionId: string }
  | { v: 1; type: 'SET_PERFORMANCE'; sessionId: string; performance: PerformanceProfile }
  | {
      v: 1;
      type: 'SET_LOGIC_CAPTURE_CONFIG';
      sessionId: string;
      /** When false, the worker records no pin edges (near-zero cost — Logic Analyzer inactive). */
      enabled: boolean;
      /** Bounded capture: once this many edges are buffered in a session, recording stops. */
      maxEdges: number;
    }
  | {
      v: 1;
      type: 'SET_EXTERNAL_CONTROL';
      sessionId: string;
      controlId: string;
      value: boolean | number;
      requestedCycle?: number;
    }
  | { v: 1; type: 'SERIAL_RX'; sessionId: string; bytes: Uint8Array }
  | { v: 1; type: 'DISPOSE'; sessionId: string };

export type PinDriveMode = 'output-low' | 'output-high' | 'input' | 'input-pullup';

export interface PinDisplayDelta {
  boardPin: string;
  mode: PinDriveMode;
  logic: 0 | 1 | 'X';
  volts: number | null;
}

/** A single cycle-accurate digital transition on one board pin (Logic Analyzer source). */
export interface PinEdge {
  boardPin: string;
  cycle: number;
  logic: 0 | 1;
}

export interface NodeDisplayDelta {
  netId: string;
  logic: 0 | 1 | 'X' | 'Z';
  volts: number | null;
}

export type ComponentDisplayDelta =
  | { id: string; kind: 'led'; brightness: number; milliAmps: number }
  | {
      id: string;
      kind: 'lcd1602';
      rows: [string, string];
      cursorAddress: number;
      displayOn: boolean;
      cursorOn: boolean;
      blinkOn: boolean;
    }
  | { id: string; kind: 'servo'; angle: number; pulseMicros: number | null; signalValid: boolean }
  | { id: string; kind: 'pushbutton' | 'potentiometer'; value: boolean | number };

export type WorkerToRenderer =
  | { v: 1; type: 'READY'; sessionId: string }
  | {
      v: 1;
      type: 'PROGRAM_LOADED';
      sessionId: string;
      sourceRevision: number;
      flashBytesUsed: number;
    }
  | { v: 1; type: 'STATE'; sessionId: string; phase: SimulationPhase; cycles: number }
  | {
      v: 1;
      type: 'FRAME';
      sessionId: string;
      sequence: number;
      cycles: number;
      pinChanges: PinDisplayDelta[];
      nodeChanges: NodeDisplayDelta[];
      componentChanges: ComponentDisplayDelta[];
      /**
       * Cycle-accurate digital transition log for the Logic Analyzer. Unlike pinChanges
       * (coalesced to the last value per frame), this preserves EVERY 0/1 transition with
       * its exact cycle, so UART/I2C/SPI protocol decoders have real sub-frame timing.
       */
      pinEdges?: PinEdge[];
      /** Sticky flag: the session's bounded edge buffer filled and recording stopped. */
      pinEdgeOverflow?: boolean;
    }
  | {
      v: 1;
      type: 'SERIAL_TX';
      sessionId: string;
      firstCycle: number;
      lastCycle: number;
      baudRate: number;
      bytes: Uint8Array;
    }
  | {
      v: 1;
      type: 'SERIAL_CONFIG';
      sessionId: string;
      baudRate: number;
      bitsPerChar: number;
      stopBits: number;
      parity: 'none' | 'even' | 'odd';
    }
  | { v: 1; type: 'DIAGNOSTICS'; sessionId: string; items: CircuitDiagnostic[] }
  | {
      v: 1;
      type: 'METRICS';
      sessionId: string;
      simulatedHz: number;
      speedRatio: number;
      targetRatio: number;
      driftMs: number;
      frameRate: number;
    }
  | { v: 1; type: 'FAULT'; sessionId: string; code: string; message: string };
