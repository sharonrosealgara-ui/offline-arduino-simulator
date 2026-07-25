/// <reference lib="webworker" />
/**
 * Complete AVR8js Web Worker runner. Owns every mutable AVR8js object and every mutable
 * circuit-runtime object; the renderer never touches AVR registers or peripheral state
 * directly. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §5.
 *
 * Pinned against avr8js@0.21.0 (see package.json). Upgrades require the worker
 * integration test suite (packages/simulator/test) to pass before release.
 */
import {
  AVRADC,
  AVRClock,
  AVREEPROM,
  EEPROMMemoryBackend,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  AVRWatchdog,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  clockConfig,
  eepromConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  watchdogConfig,
} from 'avr8js';
import type {
  PerformanceProfile,
  PortName,
  RendererToWorker,
  RuntimeNetlist,
  SimulationPhase,
  WorkerToRenderer,
} from '@offline-arduino/contracts/simulator';
import { CircuitRuntime } from './circuit-runtime';
import { parseIntelHex } from './intel-hex';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const F_CPU = 16_000_000;
const SRAM_BYTES = 2 * 1024;
const EEPROM_BYTES = 1024;
const MAX_SERIAL_RX_MESSAGE = 4 * 1024;
const MAX_SERIAL_RX_QUEUE = 64 * 1024;
const MAX_CONTROL_FUTURE_CYCLES = F_CPU * 10;
const SERIAL_TX_CHUNK = 512;
const SERIAL_TX_LIMIT = 64 * 1024;
const METRICS_INTERVAL_MS = 1000;

type PinDrive = 'output-low' | 'output-high' | 'input' | 'input-pullup';

interface ScheduledControl {
  cycle: number;
  controlId: string;
  value: boolean | number;
}

interface Machine {
  cpu: CPU;
  clock: AVRClock;
  ports: Record<PortName, AVRIOPort>;
  timers: [AVRTimer, AVRTimer, AVRTimer];
  adc: AVRADC;
  usart: AVRUSART;
  eeprom: AVREEPROM;
  watchdog: AVRWatchdog;
  circuit: CircuitRuntime;
}

const DEFAULT_PROFILE: PerformanceProfile = {
  mode: 'standard',
  speedMultiplier: 1,
  frameRate: 60,
  maxSliceWallMs: 8,
  maxInstructionsPerSlice: 50_000,
  maxCatchUpMs: 100,
};

let sessionId = '';
let sourceRevision = -1;
let phase: SimulationPhase = 'empty';
let netlist: RuntimeNetlist | null = null;
let loadedHex: string | null = null;
let machine: Machine | null = null;
let profile = DEFAULT_PROFILE;
// Logic Analyzer capture config (applied to each fresh machine; default on so Blink etc.
// show up immediately, but the renderer can Stop capture to make it near-zero cost).
let logicCaptureEnabled = true;
let logicCaptureMaxEdges = 200_000;
let runTimer: number | null = null;
let frameSequence = 0;
let nextFrameWallMs = 0;
let anchorWallMs = 0;
let anchorCycles = 0;
let metricsWallMs = 0;
let metricsCycles = 0;
let controls: ScheduledControl[] = [];
let serialRx: number[] = [];
let serialRxHead = 0;
let serialTx: number[] = [];
let serialTxFirstCycle = 0;
let serialTxLastCycle = 0;

function post(message: WorkerToRenderer, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}

function postState(): void {
  post({ v: 1, type: 'STATE', sessionId, phase, cycles: machine?.cpu.cycles ?? 0 });
}

function fault(code: string, error: unknown): void {
  cancelRunTimer();
  phase = 'faulted';
  const message = error instanceof Error ? error.message : String(error);
  post({ v: 1, type: 'FAULT', sessionId, code, message: message.slice(0, 1000) });
  postState();
}

function validateProfile(value: PerformanceProfile): PerformanceProfile {
  const validMode = value?.mode === 'standard' || value?.mode === 'low-spec' || value?.mode === 'custom';
  if (!validMode || !Number.isFinite(value.speedMultiplier) || value.speedMultiplier < 0.05 || value.speedMultiplier > 4) {
    throw new Error('Invalid simulation speed. Expected a value from 0.05 to 4.');
  }
  if (value.frameRate !== 30 && value.frameRate !== 60) {
    throw new Error('Frame rate must be 30 or 60 FPS.');
  }
  if (
    !Number.isInteger(value.maxInstructionsPerSlice) ||
    value.maxInstructionsPerSlice < 1000 ||
    value.maxInstructionsPerSlice > 100_000
  ) {
    throw new Error('Invalid instruction slice limit.');
  }
  if (!Number.isFinite(value.maxSliceWallMs) || value.maxSliceWallMs < 1 || value.maxSliceWallMs > 12) {
    throw new Error('Invalid wall-time slice limit.');
  }
  if (!Number.isFinite(value.maxCatchUpMs) || value.maxCatchUpMs < 10 || value.maxCatchUpMs > 250) {
    throw new Error('Invalid catch-up limit.');
  }
  return { ...value };
}

function driveFromState(state: PinState): PinDrive {
  switch (state) {
    case PinState.Low:
      return 'output-low';
    case PinState.High:
      return 'output-high';
    case PinState.InputPullUp:
      return 'input-pullup';
    case PinState.Input:
    default:
      return 'input';
  }
}

function createMachine(hex: string, runtimeNetlist: RuntimeNetlist): { machine: Machine; flashBytesUsed: number } {
  const parsed = parseIntelHex(hex);
  const cpu = new CPU(parsed.program, SRAM_BYTES);
  const clock = new AVRClock(cpu, F_CPU, clockConfig);
  const ports: Record<PortName, AVRIOPort> = {
    B: new AVRIOPort(cpu, portBConfig),
    C: new AVRIOPort(cpu, portCConfig),
    D: new AVRIOPort(cpu, portDConfig),
  };
  const timers: [AVRTimer, AVRTimer, AVRTimer] = [
    new AVRTimer(cpu, timer0Config),
    new AVRTimer(cpu, timer1Config),
    new AVRTimer(cpu, timer2Config),
  ];
  const adc = new AVRADC(cpu, adcConfig);
  adc.avcc = 5;
  adc.aref = 5;
  const usart = new AVRUSART(cpu, usart0Config, F_CPU);
  const eepromBackend = new EEPROMMemoryBackend(EEPROM_BYTES);
  const eeprom = new AVREEPROM(cpu, eepromBackend, eepromConfig);
  const watchdog = new AVRWatchdog(cpu, watchdogConfig, clock);

  const circuit = new CircuitRuntime(runtimeNetlist, {
    setDigitalInput(port: PortName, bit: number, high: boolean): void {
      ports[port].setPin(bit, high);
    },
    setAnalogVoltage(channel: number, volts: number): void {
      if (channel >= 0 && channel < adc.channelValues.length) {
        adc.channelValues[channel] = Math.max(0, Math.min(5, volts));
      }
    },
  });

  const publishPort = (portName: PortName): void => {
    const port = ports[portName];
    for (let bit = 0; bit < 8; bit += 1) {
      circuit.onBoardPinDriverChange(portName, bit, driveFromState(port.pinState(bit)), cpu.cycles);
    }
    circuit.settle(cpu.cycles);
  };
  (Object.keys(ports) as PortName[]).forEach((portName) => {
    ports[portName].addListener(() => publishPort(portName));
    publishPort(portName);
  });

  usart.onByteTransmit = (value) => {
    if (serialTx.length === 0) serialTxFirstCycle = cpu.cycles;
    serialTxLastCycle = cpu.cycles;
    if (serialTx.length < SERIAL_TX_LIMIT) serialTx.push(value & 0xff);
    if (serialTx.length >= SERIAL_TX_CHUNK) flushSerialTx();
  };
  usart.onConfigurationChange = () => postSerialConfig(usart);

  // Apply the current Logic Analyzer capture config to the fresh runtime.
  circuit.setLogicCaptureConfig(logicCaptureEnabled, logicCaptureMaxEdges);

  circuit.settle(cpu.cycles);

  return {
    machine: { cpu, clock, ports, timers, adc, usart, eeprom, watchdog, circuit },
    flashBytesUsed: parsed.flashBytesUsed,
  };
}

function postSerialConfig(usart: AVRUSART): void {
  post({
    v: 1,
    type: 'SERIAL_CONFIG',
    sessionId,
    baudRate: usart.baudRate,
    bitsPerChar: usart.bitsPerChar,
    stopBits: usart.stopBits,
    parity: !usart.parityEnabled ? 'none' : usart.parityOdd ? 'odd' : 'even',
  });
}

function flushSerialTx(): void {
  if (!machine || serialTx.length === 0) return;
  const bytes = Uint8Array.from(serialTx);
  const message: WorkerToRenderer = {
    v: 1,
    type: 'SERIAL_TX',
    sessionId,
    firstCycle: serialTxFirstCycle,
    lastCycle: serialTxLastCycle,
    baudRate: machine.usart.baudRate,
    bytes,
  };
  serialTx = [];
  post(message, [bytes.buffer]);
}

function flushCircuitFrame(force = false): void {
  if (!machine) return;
  const now = performance.now();
  if (!force && now < nextFrameWallMs) return;
  machine.circuit.advanceTo(machine.cpu.cycles);
  const delta = machine.circuit.takeDisplayDelta();
  const hasDelta =
    delta.pinChanges.length > 0 ||
    delta.nodeChanges.length > 0 ||
    delta.componentChanges.length > 0 ||
    delta.pinEdges.length > 0;
  if (hasDelta || force) {
    post({ v: 1, type: 'FRAME', sessionId, sequence: ++frameSequence, cycles: machine.cpu.cycles, ...delta });
  }
  const diagnostics = machine.circuit.takeDiagnostics();
  if (diagnostics.length > 0) {
    post({ v: 1, type: 'DIAGNOSTICS', sessionId, items: diagnostics });
  }
  flushSerialTx();
  nextFrameWallMs = now + 1000 / profile.frameRate;
}

function applyDueControls(): void {
  if (!machine) return;
  while (controls.length > 0 && controls[0].cycle <= machine.cpu.cycles) {
    const event = controls.shift()!;
    machine.circuit.setControl(event.controlId, event.value, machine.cpu.cycles);
  }
  machine.circuit.settle(machine.cpu.cycles);
}

function pumpSerialRx(): void {
  if (!machine || serialRxHead >= serialRx.length) return;
  if (!machine.usart.rxEnable || machine.usart.rxBusy) return;
  const accepted = machine.usart.writeByte(serialRx[serialRxHead], false);
  if (accepted !== false) serialRxHead += 1;
  if (serialRxHead > 4096 && serialRxHead * 2 > serialRx.length) {
    serialRx = serialRx.slice(serialRxHead);
    serialRxHead = 0;
  }
}

function reanchor(): void {
  anchorWallMs = performance.now();
  anchorCycles = machine?.cpu.cycles ?? 0;
}

function targetCycles(now: number): number {
  if (!machine) return 0;
  const elapsedMs = Math.max(0, now - anchorWallMs);
  const target = anchorCycles + Math.floor((elapsedMs * F_CPU * profile.speedMultiplier) / 1000);
  const maxCatchUp = Math.floor((F_CPU * profile.speedMultiplier * profile.maxCatchUpMs) / 1000);
  if (target - machine.cpu.cycles > maxCatchUp) {
    reanchor();
    return machine.cpu.cycles + maxCatchUp;
  }
  return target;
}

function postMetrics(now: number): void {
  if (!machine || now - metricsWallMs < METRICS_INTERVAL_MS) return;
  const elapsed = now - metricsWallMs;
  const cycleDelta = machine.cpu.cycles - metricsCycles;
  const simulatedHz = elapsed > 0 ? (cycleDelta * 1000) / elapsed : 0;
  const expectedCycles = anchorCycles + ((now - anchorWallMs) * F_CPU * profile.speedMultiplier) / 1000;
  const driftMs = ((machine.cpu.cycles - expectedCycles) * 1000) / (F_CPU * profile.speedMultiplier);
  post({
    v: 1,
    type: 'METRICS',
    sessionId,
    simulatedHz,
    speedRatio: simulatedHz / F_CPU,
    targetRatio: profile.speedMultiplier,
    driftMs,
    frameRate: profile.frameRate,
  });
  metricsWallMs = now;
  metricsCycles = machine.cpu.cycles;
}

function cancelRunTimer(): void {
  if (runTimer !== null) ctx.clearTimeout(runTimer);
  runTimer = null;
}

function scheduleNextSlice(): void {
  cancelRunTimer();
  if (phase !== 'running' || !machine) return;
  const now = performance.now();
  const dueCycles = targetCycles(now) - machine.cpu.cycles;
  const dueMs = dueCycles >= 0 ? 0 : Math.min(8, (-dueCycles * 1000) / (F_CPU * profile.speedMultiplier));
  runTimer = ctx.setTimeout(runSlice, Math.max(0, dueMs));
}

function runSlice(): void {
  runTimer = null;
  if (phase !== 'running' || !machine) return;
  try {
    const started = performance.now();
    const target = targetCycles(started);
    let instructions = 0;
    while (phase === 'running' && machine.cpu.cycles < target && instructions < profile.maxInstructionsPerSlice) {
      applyDueControls();
      avrInstruction(machine.cpu);
      machine.cpu.tick();
      instructions += 1;
      if ((instructions & 0xff) === 0) {
        pumpSerialRx();
        if (performance.now() - started >= profile.maxSliceWallMs) break;
      }
    }
    machine.circuit.advanceTo(machine.cpu.cycles);
    machine.circuit.settle(machine.cpu.cycles);
    pumpSerialRx();
    flushCircuitFrame(false);
    postMetrics(performance.now());
    scheduleNextSlice();
  } catch (error) {
    fault('SIMULATION_RUNTIME_ERROR', error);
  }
}

function enqueueControl(controlId: string, value: boolean | number, requestedCycle?: number): void {
  if (!machine || typeof controlId !== 'string' || controlId.length < 1 || controlId.length > 128) {
    throw new Error('Invalid external control identifier.');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Control value must be finite.');
  const earliest = machine.cpu.cycles;
  const latest = earliest + MAX_CONTROL_FUTURE_CYCLES;
  const cycle = requestedCycle === undefined ? earliest : Math.max(earliest, Math.min(latest, Math.floor(requestedCycle)));
  controls.push({ cycle, controlId, value });
  controls.sort((a, b) => a.cycle - b.cycle || a.controlId.localeCompare(b.controlId));
}

function resetRuntime(): void {
  if (!loadedHex || !netlist) throw new Error('Load a program before Reset.');
  cancelRunTimer();
  controls = [];
  serialRx = [];
  serialRxHead = 0;
  serialTx = [];
  frameSequence = 0;
  const created = createMachine(loadedHex, netlist);
  machine = created.machine;
  phase = 'paused';
  const now = performance.now();
  nextFrameWallMs = now;
  metricsWallMs = now;
  metricsCycles = 0;
  reanchor();
  postSerialConfig(machine.usart);
  flushCircuitFrame(true);
  postState();
}

function assertSession(message: RendererToWorker): void {
  if (message.v !== 1) throw new Error('Unsupported worker protocol version.');
  if (message.type === 'INITIALIZE') return;
  if (!sessionId || message.sessionId !== sessionId) throw new Error('Stale or invalid simulation session.');
}

ctx.onmessage = (event: MessageEvent<RendererToWorker>) => {
  const message = event.data;
  try {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      throw new Error('Malformed worker message.');
    }
    assertSession(message);
    switch (message.type) {
      case 'INITIALIZE':
        if (message.board !== 'uno' || message.netlist.schemaVersion !== 1) {
          throw new Error('Unsupported board or netlist schema.');
        }
        sessionId = message.sessionId;
        netlist = structuredClone(message.netlist);
        profile = validateProfile(message.performance);
        phase = 'ready';
        post({ v: 1, type: 'READY', sessionId });
        postState();
        break;

      case 'LOAD_HEX': {
        if (!netlist || phase === 'running') throw new Error('Initialize and pause before loading HEX.');
        loadedHex = message.hex;
        sourceRevision = message.sourceRevision;
        const created = createMachine(loadedHex, netlist);
        machine = created.machine;
        phase = 'paused';
        frameSequence = 0;
        const now = performance.now();
        nextFrameWallMs = now;
        metricsWallMs = now;
        metricsCycles = 0;
        reanchor();
        post({ v: 1, type: 'PROGRAM_LOADED', sessionId, sourceRevision, flashBytesUsed: created.flashBytesUsed });
        postSerialConfig(machine.usart);
        flushCircuitFrame(true);
        postState();
        break;
      }

      case 'START':
        if (!machine || phase === 'faulted') throw new Error('Load a valid program before Run.');
        if (phase !== 'running') {
          phase = 'running';
          reanchor();
          const now = performance.now();
          metricsWallMs = now;
          metricsCycles = machine.cpu.cycles;
          postState();
          scheduleNextSlice();
        }
        break;

      case 'PAUSE':
        cancelRunTimer();
        if (machine) machine.circuit.advanceTo(machine.cpu.cycles);
        phase = machine ? 'paused' : 'ready';
        flushCircuitFrame(true);
        postState();
        break;

      case 'STEP_INSTRUCTION':
        if (!machine || phase === 'running' || phase === 'faulted') throw new Error('Step requires a paused program.');
        applyDueControls();
        avrInstruction(machine.cpu);
        machine.cpu.tick();
        machine.circuit.advanceTo(machine.cpu.cycles);
        machine.circuit.settle(machine.cpu.cycles);
        pumpSerialRx();
        flushCircuitFrame(true);
        postState();
        break;

      case 'RESET':
        resetRuntime();
        break;

      case 'SET_PERFORMANCE':
        profile = validateProfile(message.performance);
        nextFrameWallMs = performance.now();
        reanchor();
        if (phase === 'running') scheduleNextSlice();
        break;

      case 'SET_LOGIC_CAPTURE_CONFIG':
        logicCaptureEnabled = message.enabled === true;
        if (Number.isFinite(message.maxEdges) && message.maxEdges > 0) {
          logicCaptureMaxEdges = Math.floor(message.maxEdges);
        }
        machine?.circuit.setLogicCaptureConfig(logicCaptureEnabled, logicCaptureMaxEdges);
        break;

      case 'SET_EXTERNAL_CONTROL':
        enqueueControl(message.controlId, message.value, message.requestedCycle);
        if (phase !== 'running') {
          applyDueControls();
          flushCircuitFrame(true);
        }
        break;

      case 'SERIAL_RX': {
        if (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength > MAX_SERIAL_RX_MESSAGE) {
          throw new Error('Serial RX must be a Uint8Array no larger than 4 KiB.');
        }
        const pending = serialRx.length - serialRxHead;
        if (pending + message.bytes.byteLength > MAX_SERIAL_RX_QUEUE) {
          throw new Error('Serial RX queue is full. Wait for the sketch to read existing input.');
        }
        serialRx.push(...message.bytes);
        pumpSerialRx();
        break;
      }

      case 'DISPOSE':
        cancelRunTimer();
        // Preserve the final pending batch (edges + serial) before tearing down.
        flushCircuitFrame(true);
        flushSerialTx();
        machine = null;
        netlist = null;
        loadedHex = null;
        controls = [];
        phase = 'disposed';
        postState();
        ctx.close();
        break;

      default: {
        const exhaustive: never = message;
        throw new Error(`Unknown worker command: ${String((exhaustive as RendererToWorker).type)}`);
      }
    }
  } catch (error) {
    fault('INVALID_WORKER_COMMAND', error);
  }
};

ctx.onmessageerror = () => fault('WORKER_MESSAGE_DESERIALIZATION_FAILED', 'Unable to deserialize worker message.');
