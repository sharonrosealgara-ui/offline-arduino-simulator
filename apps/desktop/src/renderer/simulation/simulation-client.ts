/**
 * Main-thread simulation client. Owns the single Worker instance, enforces session/
 * revision safety (stale messages are dropped), and publishes results into the
 * Zustand store. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §2, §13.5.
 */
import type {
  PerformanceProfile,
  RendererToWorker,
  RuntimeNetlist,
  WorkerToRenderer,
} from '@offline-arduino/contracts/simulator';
import { STANDARD_PROFILE, LOW_SPEC_PROFILE } from '@offline-arduino/contracts/simulator';
import type { SerialRecord } from '@offline-arduino/contracts/serial';
import { useAppStore } from '../state/store';

const decoder = new TextDecoder('utf-8', { fatal: false });
let serialSeq = 0;

function uuid(): string {
  return crypto.randomUUID();
}

export class SimulationClient {
  private worker: Worker | null = null;
  private sessionId: string | null = null;
  private lastFrameSequence = -1;
  /** Desired Logic Analyzer capture config, re-sent to each fresh worker session. */
  private logicCaptureEnabled = true;
  private logicMaxEdges = 200_000;

  get isRunning(): boolean {
    return useAppStore.getState().simulation.phase === 'running';
  }

  /** (Re)creates the worker, disposing any prior one first, and initializes a fresh session. */
  async initialize(netlist: RuntimeNetlist, performance: PerformanceProfile = STANDARD_PROFILE): Promise<void> {
    this.terminate();
    decoder.decode(); // reset any pending multi-byte state from a previous epoch
    serialSeq = 0;
    useAppStore.getState().actions.clearLogic(); // fresh logic-analyzer capture per epoch

    const worker = new Worker(new URL('../../../../../packages/simulator/src/simulator.worker.ts', import.meta.url), {
      type: 'module',
      name: 'avr8-simulator',
    });
    this.worker = worker;
    this.sessionId = uuid();
    this.lastFrameSequence = -1;

    worker.onmessage = (event: MessageEvent<WorkerToRenderer>) => this.handleMessage(event.data);
    worker.onmessageerror = () => useAppStore.getState().actions.setSimulationFault('The simulator worker sent an unreadable message.');
    worker.onerror = (event) => useAppStore.getState().actions.setSimulationFault(event.message ?? 'The simulator worker crashed.');

    this.post({ v: 1, type: 'INITIALIZE', sessionId: this.sessionId, board: 'uno', netlist, performance });
    // Re-assert the current capture config on the fresh session.
    this.post({
      v: 1,
      type: 'SET_LOGIC_CAPTURE_CONFIG',
      sessionId: this.sessionId,
      enabled: this.logicCaptureEnabled,
      maxEdges: this.logicMaxEdges,
    });
  }

  /** Enables/disables cycle-accurate Logic Analyzer capture (also updates the store intent). */
  setLogicCapture(enabled: boolean, maxEdges?: number): void {
    this.logicCaptureEnabled = enabled;
    if (typeof maxEdges === 'number' && Number.isFinite(maxEdges) && maxEdges > 0) this.logicMaxEdges = Math.floor(maxEdges);
    useAppStore.getState().actions.setLogicCapturing(enabled);
    if (this.sessionId) {
      this.post({
        v: 1,
        type: 'SET_LOGIC_CAPTURE_CONFIG',
        sessionId: this.sessionId,
        enabled: this.logicCaptureEnabled,
        maxEdges: this.logicMaxEdges,
      });
    }
  }

  loadHex(hex: string, sourceRevision: number): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'LOAD_HEX', sessionId: this.sessionId, sourceRevision, hex });
  }

  start(): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'START', sessionId: this.sessionId });
  }

  pause(): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'PAUSE', sessionId: this.sessionId });
  }

  step(): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'STEP_INSTRUCTION', sessionId: this.sessionId });
  }

  reset(): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'RESET', sessionId: this.sessionId });
  }

  setPerformance(profile: PerformanceProfile): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'SET_PERFORMANCE', sessionId: this.sessionId, performance: profile });
  }

  setLowSpec(enabled: boolean): void {
    this.setPerformance(enabled ? LOW_SPEC_PROFILE : STANDARD_PROFILE);
    useAppStore.getState().actions.setLowSpec(enabled);
  }

  setControl(controlId: string, value: boolean | number): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'SET_EXTERNAL_CONTROL', sessionId: this.sessionId, controlId, value });
  }

  sendSerial(bytes: Uint8Array): void {
    if (!this.sessionId) return;
    this.post({ v: 1, type: 'SERIAL_RX', sessionId: this.sessionId, bytes }, [bytes.buffer]);
  }

  /** Stop is a full dispose, not merely pause (spec §16). */
  terminate(): void {
    if (this.worker && this.sessionId) {
      try {
        this.post({ v: 1, type: 'DISPOSE', sessionId: this.sessionId });
      } catch {
        /* worker may already be gone */
      }
    }
    this.worker?.terminate();
    this.worker = null;
    this.sessionId = null;
  }

  private post(message: RendererToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private handleMessage(message: WorkerToRenderer): void {
    if (message.v !== 1) return;
    if (message.sessionId !== this.sessionId) return; // stale/disposed session

    const { actions } = useAppStore.getState();

    switch (message.type) {
      case 'READY':
        break;
      case 'PROGRAM_LOADED':
        break;
      case 'STATE':
        actions.setSimulationPhase(message.sessionId, message.phase, message.cycles);
        break;
      case 'FRAME':
        if (message.sequence <= this.lastFrameSequence) return; // out-of-order, drop
        this.lastFrameSequence = message.sequence;
        actions.applySimulationFrame(message);
        if (message.pinEdges && message.pinEdges.length > 0) actions.recordLogicEdges(message.pinEdges);
        if (message.pinEdgeOverflow) actions.markLogicTruncated();
        break;
      case 'SERIAL_TX': {
        const text = decoder.decode(message.bytes, { stream: true });
        if (text.length > 0) {
          const record: SerialRecord = { seq: serialSeq++, cycle: message.firstCycle, text, segmented: false };
          actions.appendSerialRecord(record);
        }
        break;
      }
      case 'SERIAL_CONFIG':
        useAppStore.setState((state) => ({ serial: { ...state.serial, baudRate: message.baudRate } }));
        break;
      case 'DIAGNOSTICS':
        actions.setCircuitDiagnostics(message.items);
        break;
      case 'METRICS':
        actions.setMetrics({
          simulatedHz: message.simulatedHz,
          speedRatio: message.speedRatio,
          targetRatio: message.targetRatio,
          driftMs: message.driftMs,
          frameRate: message.frameRate,
        });
        break;
      case 'FAULT':
        actions.setSimulationFault(message.message);
        break;
    }
  }
}

export const simulationClient = new SimulationClient();
