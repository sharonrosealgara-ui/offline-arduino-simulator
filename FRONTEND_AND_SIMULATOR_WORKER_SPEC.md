# Frontend Simulator Worker, Netlist Engine, and Virtual Serial Specification

**Project:** Offline Arduino Simulator  
**Target board:** Arduino Uno R3 / ATmega328P  
**Stack:** Electron + Vite + React + TypeScript + Monaco + AVR8js  
**Companion document:** `OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md`  
**Status:** implementation specification  
**Protocol version:** 1  

---

## 1. Purpose and fixed boundaries

This document specifies the simulation runtime that begins after the secure Electron compiler service returns validated Intel HEX. It covers:

1. the AVR8js Web Worker runner;
2. visual-circuit compilation into a deterministic runtime netlist;
3. educational electrical and component models;
4. GPIO, ADC, PWM, LCD, servo, and pushbutton synchronization;
5. UART TX/RX and the Virtual Serial Monitor/Plotter contract;
6. low-spec laptop controls and runtime limits.

The following boundaries are mandatory:

- The Electron main process owns compilation and local filesystem access.
- The sandboxed renderer owns authoring, SVG presentation, and user interaction.
- A dedicated module Web Worker owns every mutable AVR8js object and every mutable circuit-runtime object.
- The renderer never reads or writes AVR registers, CPU memory, peripheral objects, temporary build paths, or native executable paths.
- Wire color is a visual convention and validation hint. Electrical connectivity comes only from terminal endpoints and explicit junctions.
- AVR8js is the AVR core. The application supplies the external hardware behavior. This is a bounded classroom DC/digital simulator, not SPICE.

Pin AVR8js to an exact tested version. The implementation in this document is written against `avr8js@0.21.0`; upgrades require the worker integration test suite to pass before release.

---

## 2. Runtime module placement

Add the following modules to the structure established by the setup specification:

```text
packages/
├─ contracts/src/
│  ├─ simulator.ts                 # worker message contracts
│  ├─ circuit.ts                   # persistent and runtime netlist contracts
│  └─ serial.ts                    # terminal/plotter contracts
└─ simulator/src/
   ├─ simulator.worker.ts          # complete worker entry point in section 5
   ├─ intel-hex.ts                 # may be split from the worker after tests exist
   ├─ circuit-runtime.ts           # solver and component orchestration
   ├─ netlist-compiler.ts          # pure visual-model to runtime-netlist compiler
   ├─ electrical-solver.ts         # bounded conductance solver
   ├─ board/uno.ts                 # Uno terminal and AVR port mapping
   ├─ components/
   │  ├─ led-runtime.ts
   │  ├─ pushbutton-runtime.ts
   │  ├─ potentiometer-runtime.ts
   │  ├─ hd44780-runtime.ts
   │  └─ servo-runtime.ts
   └─ test/
      ├─ intel-hex.test.ts
      ├─ worker-runner.test.ts
      ├─ netlist-compiler.test.ts
      ├─ electrical-solver.test.ts
      ├─ lcd1602.test.ts
      ├─ servo.test.ts
      └─ serial.test.ts

apps/desktop/src/renderer/
├─ simulation/simulation-client.ts
├─ circuit/CircuitCanvas.tsx
├─ circuit/renderers/
└─ serial/VirtualSerialPane.tsx
```

Recommended Vite construction:

```ts
const worker = new Worker(
  new URL('../../../packages/simulator/src/simulator.worker.ts', import.meta.url),
  { type: 'module', name: 'avr8-simulator' },
);
```

The renderer must terminate and recreate the worker on Stop, fatal worker fault, project replacement, or validated program replacement. Pause and Reset do not require an Electron window reload.

---

## 3. Shared protocol and data contracts

Keep these contracts in dependency-free files so both the renderer and worker can import them without importing React, Electron, Node, or AVR8js.

```ts
export const SIM_PROTOCOL_VERSION = 1 as const;
export type PortName = 'B' | 'C' | 'D';
export type SimulationPhase =
  | 'empty'
  | 'ready'
  | 'paused'
  | 'running'
  | 'faulted'
  | 'disposed';

export interface RuntimeNetlist {
  schemaVersion: 1;
  topologyHash: string;
  nets: RuntimeNet[];
  boardPins: BoardPinBinding[];
  elements: RuntimeElement[];
  diagnostics: CircuitDiagnostic[];
}

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
  | { kind: 'led'; id: string; anode: string; cathode: string;
      forwardV: number; dynamicOhms: number; ratedMilliAmps: number; color: string }
  | { kind: 'switch'; id: string; a: string; b: string;
      controlId: string; closedOhms: number }
  | { kind: 'potentiometer'; id: string; a: string; wiper: string; b: string;
      ohms: number; minimumOhms: number; controlId: string; initialPosition: number }
  | { kind: 'lcd1602'; id: string; pins: Record<string, string> }
  | { kind: 'servo'; id: string; vcc: string; ground: string; signal: string;
      minPulseMicros: number; maxPulseMicros: number; minAngle: number; maxAngle: number };

export interface PerformanceProfile {
  mode: 'standard' | 'low-spec' | 'custom';
  /** Wall-clock rate. 1 keeps simulated cycles aligned to a 16 MHz real-time target. */
  speedMultiplier: number;
  frameRate: 30 | 60;
  maxSliceWallMs: number;
  maxInstructionsPerSlice: number;
  maxCatchUpMs: number;
}

export type RendererToWorker =
  | { v: 1; type: 'INITIALIZE'; sessionId: string; board: 'uno'; netlist: RuntimeNetlist;
      performance: PerformanceProfile }
  | { v: 1; type: 'LOAD_HEX'; sessionId: string; sourceRevision: number; hex: string }
  | { v: 1; type: 'START'; sessionId: string }
  | { v: 1; type: 'PAUSE'; sessionId: string }
  | { v: 1; type: 'STEP_INSTRUCTION'; sessionId: string }
  | { v: 1; type: 'RESET'; sessionId: string }
  | { v: 1; type: 'SET_PERFORMANCE'; sessionId: string; performance: PerformanceProfile }
  | { v: 1; type: 'SET_EXTERNAL_CONTROL'; sessionId: string; controlId: string;
      value: boolean | number; requestedCycle?: number }
  | { v: 1; type: 'SERIAL_RX'; sessionId: string; bytes: Uint8Array }
  | { v: 1; type: 'DISPOSE'; sessionId: string };

export interface PinDisplayDelta {
  boardPin: string;
  mode: 'output-low' | 'output-high' | 'input' | 'input-pullup';
  logic: 0 | 1 | 'X';
  volts: number | null;
}

export interface NodeDisplayDelta {
  netId: string;
  logic: 0 | 1 | 'X' | 'Z';
  volts: number | null;
}

export type ComponentDisplayDelta =
  | { id: string; kind: 'led'; brightness: number; milliAmps: number }
  | { id: string; kind: 'lcd1602'; rows: [string, string]; cursorAddress: number;
      displayOn: boolean; cursorOn: boolean; blinkOn: boolean }
  | { id: string; kind: 'servo'; angle: number; pulseMicros: number | null; signalValid: boolean }
  | { id: string; kind: 'pushbutton' | 'potentiometer'; value: boolean | number };

export interface CircuitDiagnostic {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  code: string;
  message: string;
  componentIds?: string[];
  netIds?: string[];
}

export type WorkerToRenderer =
  | { v: 1; type: 'READY'; sessionId: string }
  | { v: 1; type: 'PROGRAM_LOADED'; sessionId: string; sourceRevision: number; flashBytesUsed: number }
  | { v: 1; type: 'STATE'; sessionId: string; phase: SimulationPhase; cycles: number }
  | { v: 1; type: 'FRAME'; sessionId: string; sequence: number; cycles: number;
      pinChanges: PinDisplayDelta[]; nodeChanges: NodeDisplayDelta[];
      componentChanges: ComponentDisplayDelta[] }
  | { v: 1; type: 'SERIAL_TX'; sessionId: string; firstCycle: number; lastCycle: number;
      baudRate: number; bytes: Uint8Array }
  | { v: 1; type: 'SERIAL_CONFIG'; sessionId: string; baudRate: number;
      bitsPerChar: number; stopBits: number; parity: 'none' | 'even' | 'odd' }
  | { v: 1; type: 'DIAGNOSTICS'; sessionId: string; items: CircuitDiagnostic[] }
  | { v: 1; type: 'METRICS'; sessionId: string; simulatedHz: number;
      speedRatio: number; targetRatio: number; driftMs: number; frameRate: number }
  | { v: 1; type: 'FAULT'; sessionId: string; code: string; message: string };
```

### 3.1 Default performance profiles

```ts
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
```

Low-spec mode must not change `F_CPU` inside AVR8js. It changes how quickly simulated cycles are allowed to advance relative to wall time. A sketch therefore runs at quarter real-time, but every simulated microsecond still equals 16 ATmega cycles. This preserves firmware, timer, UART, PWM, LCD, and servo timing relationships.

---

## 4. Intel HEX loading policy

The main process already validates compiler output. The worker validates it again because it is a trust boundary and because malformed program memory must never be handed to the CPU core.

Requirements:

- maximum HEX text length: 1 MiB;
- ASCII records beginning with `:`;
- validate record byte count, character count, hex digits, and checksum;
- support data (`00`), EOF (`01`), extended segment address (`02`), start segment (`03`), extended linear address (`04`), and start linear address (`05`);
- ignore validated start-address records because reset starts from the AVR reset vector;
- require exactly one effective EOF and no nonblank record after EOF;
- reject data outside the ATmega328P 32 KiB flash range;
- reject conflicting overlaps; identical duplicate bytes are allowed;
- initialize unused flash to `0xffff` words;
- report flash bytes used without counting gaps.

The parser in the worker code below follows these rules.

---

## 5. Complete `simulator.worker.ts` implementation

The worker depends on `CircuitRuntime`, whose exact adapter contract is shown immediately after the worker. The worker is otherwise complete: it parses HEX, creates the ATmega328P peripherals, runs instructions, schedules real-time/low-spec execution, streams GPIO/circuit frames, and handles UART TX/RX.

```ts
/// <reference lib="webworker" />

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
  CircuitDiagnostic,
  PerformanceProfile,
  PortName,
  RendererToWorker,
  RuntimeNetlist,
  SimulationPhase,
  WorkerToRenderer,
} from '@offline-arduino/contracts/simulator';
import { CircuitRuntime } from './circuit-runtime';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const F_CPU = 16_000_000;
const FLASH_BYTES = 32 * 1024;
const FLASH_WORDS = FLASH_BYTES / 2;
const SRAM_BYTES = 2 * 1024;
const EEPROM_BYTES = 1024;
const MAX_HEX_CHARS = 1024 * 1024;
const MAX_SERIAL_RX_MESSAGE = 4 * 1024;
const MAX_SERIAL_RX_QUEUE = 64 * 1024;
const MAX_CONTROL_FUTURE_CYCLES = F_CPU * 10;
const SERIAL_TX_CHUNK = 512;
const SERIAL_TX_LIMIT = 64 * 1024;
const METRICS_INTERVAL_MS = 1000;

type PinDrive = 'output-low' | 'output-high' | 'input' | 'input-pullup';

interface ParsedHex {
  program: Uint16Array;
  flashBytesUsed: number;
}

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
  post({
    v: 1,
    type: 'STATE',
    sessionId,
    phase,
    cycles: machine?.cpu.cycles ?? 0,
  });
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
  if (!Number.isInteger(value.maxInstructionsPerSlice) || value.maxInstructionsPerSlice < 1000 || value.maxInstructionsPerSlice > 100_000) {
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

function parseHexByte(text: string, lineNumber: number): number {
  if (!/^[0-9a-fA-F]{2}$/.test(text)) {
    throw new Error(`Intel HEX line ${lineNumber}: invalid hexadecimal byte.`);
  }
  return Number.parseInt(text, 16);
}

function parseIntelHex(hex: string): ParsedHex {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length > MAX_HEX_CHARS) {
    throw new Error('Intel HEX is empty or exceeds the 1 MiB safety limit.');
  }

  const program = new Uint16Array(FLASH_WORDS);
  program.fill(0xffff);
  const written = new Uint8Array(FLASH_BYTES);
  const lines = hex.replace(/\r\n?/g, '\n').split('\n');
  let baseAddress = 0;
  let sawEof = false;
  let flashBytesUsed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;
    if (sawEof) throw new Error(`Intel HEX line ${lineNumber}: data appears after EOF.`);
    if (!line.startsWith(':')) throw new Error(`Intel HEX line ${lineNumber}: missing ':'.`);

    const body = line.slice(1);
    if (body.length % 2 !== 0 || body.length < 10) {
      throw new Error(`Intel HEX line ${lineNumber}: invalid record length.`);
    }
    const bytes: number[] = [];
    for (let offset = 0; offset < body.length; offset += 2) {
      bytes.push(parseHexByte(body.slice(offset, offset + 2), lineNumber));
    }

    const count = bytes[0];
    if (bytes.length !== count + 5) {
      throw new Error(`Intel HEX line ${lineNumber}: byte count does not match record length.`);
    }
    if ((bytes.reduce((sum, byte) => sum + byte, 0) & 0xff) !== 0) {
      throw new Error(`Intel HEX line ${lineNumber}: checksum failed.`);
    }

    const address = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = bytes.slice(4, 4 + count);

    switch (recordType) {
      case 0x00: {
        const absolute = baseAddress + address;
        if (absolute < 0 || absolute + count > FLASH_BYTES) {
          throw new Error(`Intel HEX line ${lineNumber}: data exceeds ATmega328P flash.`);
        }
        for (let i = 0; i < data.length; i += 1) {
          const byteAddress = absolute + i;
          const byte = data[i];
          const wordIndex = byteAddress >>> 1;
          const oldWord = program[wordIndex];
          const oldByte = (byteAddress & 1) === 0 ? oldWord & 0xff : oldWord >>> 8;
          if (written[byteAddress] && oldByte !== byte) {
            throw new Error(`Intel HEX line ${lineNumber}: conflicting overlapping data.`);
          }
          if (!written[byteAddress]) {
            written[byteAddress] = 1;
            flashBytesUsed += 1;
          }
          program[wordIndex] = (byteAddress & 1) === 0
            ? (oldWord & 0xff00) | byte
            : (oldWord & 0x00ff) | (byte << 8);
        }
        break;
      }
      case 0x01:
        if (count !== 0 || address !== 0) throw new Error(`Intel HEX line ${lineNumber}: malformed EOF.`);
        sawEof = true;
        break;
      case 0x02:
        if (count !== 2 || address !== 0) throw new Error(`Intel HEX line ${lineNumber}: malformed segment address.`);
        baseAddress = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x03:
        if (count !== 4 || address !== 0) throw new Error(`Intel HEX line ${lineNumber}: malformed start segment address.`);
        break;
      case 0x04:
        if (count !== 2 || address !== 0) throw new Error(`Intel HEX line ${lineNumber}: malformed linear address.`);
        baseAddress = ((data[0] << 8) | data[1]) * 0x1_0000;
        break;
      case 0x05:
        if (count !== 4 || address !== 0) throw new Error(`Intel HEX line ${lineNumber}: malformed start linear address.`);
        break;
      default:
        throw new Error(`Intel HEX line ${lineNumber}: unsupported record type 0x${recordType.toString(16)}.`);
    }
  }

  if (!sawEof) throw new Error('Intel HEX has no EOF record.');
  if (flashBytesUsed === 0) throw new Error('Intel HEX contains no program data.');
  return { program, flashBytesUsed };
}

function driveFromState(state: PinState): PinDrive {
  switch (state) {
    case PinState.Low: return 'output-low';
    case PinState.High: return 'output-high';
    case PinState.InputPullUp: return 'input-pullup';
    case PinState.Input:
    default: return 'input';
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
  const hasDelta = delta.pinChanges.length > 0 || delta.nodeChanges.length > 0 || delta.componentChanges.length > 0;
  if (hasDelta || force) {
    post({
      v: 1,
      type: 'FRAME',
      sessionId,
      sequence: ++frameSequence,
      cycles: machine.cpu.cycles,
      ...delta,
    });
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
  const target = anchorCycles + Math.floor(elapsedMs * F_CPU * profile.speedMultiplier / 1000);
  const maxCatchUp = Math.floor(F_CPU * profile.speedMultiplier * profile.maxCatchUpMs / 1000);
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
  const simulatedHz = elapsed > 0 ? cycleDelta * 1000 / elapsed : 0;
  const expectedCycles = anchorCycles + (now - anchorWallMs) * F_CPU * profile.speedMultiplier / 1000;
  const driftMs = (machine.cpu.cycles - expectedCycles) * 1000 / (F_CPU * profile.speedMultiplier);
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
  if (runTimer !== null) clearTimeout(runTimer);
  runTimer = null;
}

function scheduleNextSlice(): void {
  cancelRunTimer();
  if (phase !== 'running' || !machine) return;
  const now = performance.now();
  const dueCycles = targetCycles(now) - machine.cpu.cycles;
  const dueMs = dueCycles >= 0 ? 0 : Math.min(8, -dueCycles * 1000 / (F_CPU * profile.speedMultiplier));
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
  const cycle = requestedCycle === undefined
    ? earliest
    : Math.max(earliest, Math.min(latest, Math.floor(requestedCycle)));
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
        if (message.board !== 'uno' || message.netlist.schemaVersion !== 1) throw new Error('Unsupported board or netlist schema.');
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
```

### 5.1 `CircuitRuntime` adapter required by the worker

```ts
export interface CircuitRuntimeAdapter {
  setDigitalInput(port: PortName, bit: number, high: boolean): void;
  setAnalogVoltage(channel: number, volts: number): void;
}

export interface DisplayDelta {
  pinChanges: PinDisplayDelta[];
  nodeChanges: NodeDisplayDelta[];
  componentChanges: ComponentDisplayDelta[];
}

export class CircuitRuntime {
  constructor(netlist: RuntimeNetlist, adapter: CircuitRuntimeAdapter);

  /** Called whenever PORT/DDR/timer override changes a board pin driver. */
  onBoardPinDriverChange(
    port: PortName,
    bit: number,
    drive: 'output-low' | 'output-high' | 'input' | 'input-pullup',
    cycle: number,
  ): void;

  /** Applies button or potentiometer state after validating the control ID and value. */
  setControl(controlId: string, value: boolean | number, cycle: number): void;

  /** Integrates PWM LED brightness and other time-weighted state through this cycle. */
  advanceTo(cycle: number): void;

  /** Solves dirty connected subgraphs and calls adapter inputs only for changed values. */
  settle(cycle: number): void;

  /** Returns and clears coalesced UI deltas. */
  takeDisplayDelta(): DisplayDelta;

  /** Returns and clears newly raised or cleared runtime diagnostics. */
  takeDiagnostics(): CircuitDiagnostic[];
}
```

Implementation rules:

- `onBoardPinDriverChange()` must first integrate component state to `cycle`, then replace the old GPIO source stamp, mark its net dirty, solve, and observe LCD/servo edges.
- `setControl()` clamps potentiometer position to `[0,1]`; button values must be boolean.
- `settle()` must be reentrancy guarded because applying an input may trigger AVR interrupt bookkeeping.
- Adapter calls are deduplicated. Do not call `setPin()` or rewrite ADC values when a solved input has not changed.
- Display deltas are maps keyed by ID internally, so many transitions inside one frame coalesce to the last visible state while integrators retain the full timing history.
- Diagnostics have stable IDs such as `LED_OVERCURRENT:led-7`; update or clear them instead of appending duplicates forever.

### 5.2 Timing guarantees and limitations

`CPU.cycles` is authoritative simulated time. AVR8js advances it by the cycle cost of each instruction, and `cpu.tick()` delivers scheduled peripheral and interrupt events. The worker targets:

\[
C_{target}=C_{anchor}+\left\lfloor\frac{(t-t_{anchor})F_{CPU}s}{1000}\right\rfloor
\]

where `F_CPU = 16,000,000` and `s` is the profile speed multiplier.

The scheduler is cooperative, not hard real time. On a slow computer it may run behind wall time, but it must never skip AVR instructions or invent cycles to catch up. When lag exceeds `maxCatchUpMs`, it rebases the wall-clock anchor. This prevents a permanent high-CPU catch-up loop.

Frame rate is independent of CPU execution. At 30 FPS, PWM and servo edges are still processed at cycle precision; only visual updates are coalesced.

---

## 6. Uno board mapping

Use one canonical table in `board/uno.ts`:

| Arduino terminal | AVR port | Bit | ADC | Special use |
| --- | ---: | ---: | ---: | --- |
| D0 | D | 0 | — | UART RX |
| D1 | D | 1 | — | UART TX |
| D2–D7 | D | 2–7 | — | GPIO; D3/D5/D6 PWM capable |
| D8–D13 | B | 0–5 | — | GPIO; D9/D10/D11 PWM capable |
| A0–A5 | C | 0–5 | 0–5 | ADC and digital aliases D14–D19 |
| 5V | — | — | — | fixed 5.0 V rail |
| 3.3V | — | — | — | fixed 3.3 V rail, limited educational model |
| GND | — | — | — | fixed 0 V reference |

PB6/PB7 are used by the 16 MHz crystal on an Uno and are not exposed as ordinary classroom GPIO. PC6 is RESET and is not a normal A6 pin. The built-in Uno LED is a board component driven by PB5/D13.

---

## 7. Persistent visual circuit model

The renderer persists user intent, not derived solver state.

```ts
export type ComponentKind =
  | 'uno-r3'
  | 'led'
  | 'resistor'
  | 'pushbutton'
  | 'potentiometer'
  | 'lcd1602'
  | 'servo';

export interface Point { x: number; y: number }

export interface TerminalRef {
  componentId: string;
  terminalId: string;
}

export interface CircuitComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  label: string;
  properties: Record<string, string | number | boolean>;
}

export interface CircuitWire {
  id: string;
  from: TerminalRef;
  to: TerminalRef;
  colorRole:
    | 'vcc-red'
    | 'ground-black'
    | 'signal-yellow'
    | 'signal-blue'
    | 'signal-green'
    | 'signal-orange'
    | 'signal-purple';
  waypoints: Point[];
}

export interface CircuitJunction {
  id: string;
  wireIds: string[];
  point: Point;
}

export interface ProjectCircuit {
  schemaVersion: 1;
  components: CircuitComponent[];
  wires: CircuitWire[];
  junctions: CircuitJunction[];
}
```

Terminal definitions live in a trusted component registry, not in project files. The registry defines terminal IDs, labels, local anchor points, electrical roles, and permanent internal connections.

---

## 8. Wire routing and color rules

### 8.1 Visual routing

Use native SVG for the MVP. A wire is rendered as an orthogonal path, but its stored endpoints—not the SVG geometry—define connectivity.

Routing algorithm:

1. transform terminal anchors to world coordinates;
2. preserve user waypoints as mandatory route points;
3. expand component bounds by 12 px as obstacles;
4. run orthogonal A* on an 8 px grid between consecutive mandatory points;
5. use Manhattan distance as the heuristic;
6. add cost `24` per bend, `40` per component-obstacle crossing, and `8` for a cell adjacent to another parallel wire;
7. remove collinear intermediate points;
8. cache by wire ID, endpoint positions, waypoints, and obstacle revision;
9. show a cheap elbow preview while dragging and calculate the final A* path on drop.

Visible wire strokes may be 2–3 px, but overlay a transparent 12 px hit path for classroom-friendly selection. Terminal snapping uses a 14 px screen-space radius independent of zoom.

### 8.2 Electrical color conventions

| Visual role | Default | Validation meaning |
| --- | --- | --- |
| VCC | red | expected to connect to 5V or 3.3V |
| Ground | black | expected to connect to GND |
| Signal | yellow, blue, green, orange, purple | ordinary GPIO/control/data signal |

Color never creates a voltage. A red wire connected between D2 and a button is still a signal net and receives `WIRE_COLOR_CONVENTION` warning. A black wire connected to 5V remains electrically 5V and receives a warning. This avoids silently changing a student's circuit based on appearance.

Wire crossings do not join. Nets join only through:

- a shared terminal endpoint;
- an explicitly stored `CircuitJunction`; or
- a component registry rule declaring terminals permanently common.

---

## 9. Visual circuit to runtime netlist algorithm

Implement `compileNetlist(project: ProjectCircuit): RuntimeNetlist` as a pure deterministic function.

### 9.1 Phase A — normalize and validate

1. Deep-copy only schema fields and reject unknown executable/asset fields.
2. Sort components, wires, and junctions by stable ID.
3. Require one and only one Uno for a runnable circuit.
4. Validate unique IDs, finite coordinates, allowed rotations, known component kinds, property ranges, known terminal IDs, and valid references.
5. Limit a project to 250 components, 500 wires, 1,500 terminals, and 250 explicit junctions for the first release.
6. Convert every terminal to the stable key `<componentId>:<terminalId>`.
7. Reject self-loop wires and exact duplicate wires; report dangling endpoints as errors.

### 9.2 Phase B — build connectivity with disjoint sets

Create a disjoint-set/union-find entry for every terminal key.

```ts
class DisjointSet {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  make(key: string): void {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
  }

  find(key: string): string {
    const parent = this.parent.get(key);
    if (!parent) throw new Error(`Unknown terminal: ${key}`);
    if (parent !== key) this.parent.set(key, this.find(parent));
    return this.parent.get(key)!;
  }

  union(a: string, b: string): void {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    const rankA = this.rank.get(rootA)!;
    const rankB = this.rank.get(rootB)!;
    if (rankA < rankB) [rootA, rootB] = [rootB, rootA];
    this.parent.set(rootB, rootA);
    if (rankA === rankB) this.rank.set(rootA, rankA + 1);
  }
}
```

Then:

1. union each wire's two endpoints;
2. union all wire endpoints named by the same explicit junction;
3. union permanently common terminals—for example, the two pins on each physical side of a four-leg pushbutton;
4. do not union resistor ends, LED legs, switch sides, potentiometer legs, LCD pins, or servo pins;
5. never inspect rendered path intersections.

Complexity is effectively linear: `O((T + W + J) α(T))`.

### 9.3 Phase C — assign canonical nets

Group terminal keys by root. Sort keys inside every group. Derive a stable ID such as:

```ts
const netId = `n_${sha256(sortedTerminalKeys.join('\n')).slice(0, 16)}`;
```

Annotate nets containing trusted Uno rail terminals. A net containing both GND and either positive rail is fatal `POWER_RAIL_SHORT`. A net containing 5V and 3.3V is fatal `INCOMPATIBLE_POWER_RAILS` in the MVP.

### 9.4 Phase D — stamp components and board bindings

- Resistor: conductance branch between its two nets.
- LED: directional piecewise-linear branch between anode and cathode.
- Pushbutton: runtime-controlled open circuit or `1 Ω` closed branch.
- Potentiometer: two runtime-controlled resistor branches.
- LCD: digital observer with named net bindings.
- Servo: signal-edge observer plus supply validation.
- Uno GPIO/ADC terminal: board binding containing the port/bit and optional ADC channel.

Sort every output collection canonically, serialize it, and compute `topologyHash`. Moving a component or rerouting a wire without changing endpoints must not change the hash.

---

## 10. Bounded electrical solver

### 10.1 Supported model

The MVP supports:

- ideal 0 V, 3.3 V, and 5 V rails;
- GPIO high/low drivers with `Rout = 25 Ω` educational output resistance;
- high-impedance digital/analog inputs;
- internal pull-ups modeled as `30 kΩ` to 5 V;
- resistors, switches, and potentiometers;
- LEDs using a piecewise-linear forward model;
- logic thresholds, ADC voltage, contention, floating inputs, and overcurrent diagnostics.

It does not support AC analysis, capacitors, inductors, transistor bias, oscillators, parasitics, thermal destruction, power-supply transients, servo load/torque, or arbitrary nonlinear circuits.

### 10.2 Nodal equation

For each unknown node `i`, stamp every conductive branch to node `j`:

\[
\sum_j G_{ij}(V_i-V_j)=I_i
\]

with `G = 1/R`. Fixed rail nodes are moved to the right-hand side. GPIO outputs are Thévenin sources: 5 V or 0 V through `25 Ω`. Pull-ups are 5 V through `30 kΩ`.

Solve each dirty connected subgraph using Gaussian elimination with partial pivoting. Bounds:

- maximum 64 unknown voltage nodes per connected subgraph;
- pivot epsilon `1e-9`;
- maximum three LED-state iterations;
- reject non-finite coefficients or outputs;
- clamp display voltages to `[-0.5, 5.5]` while retaining a diagnostic for out-of-range results.

For an LED assumed on:

\[
I_D = \frac{V_A - V_K - V_F}{R_D}
\]

Stamp `1/R_D` between anode and cathode and the forward-voltage offset in the source vector. If the solved current is nonpositive, turn it off and resolve. If an off LED solves above `V_F`, turn it on and resolve. Emit `SOLVER_DID_NOT_CONVERGE` after the fixed iteration limit.

### 10.3 Digital and ADC conversion

For a 5 V Uno domain:

- `V <= 1.5 V` → logic 0;
- `V >= 3.0 V` → logic 1;
- between thresholds → retain the previous stable value and expose display logic `X`;
- no meaningful driver/conductive path → floating `Z`, default input sample 0, plus `FLOATING_INPUT` warning;
- an enabled internal pull-up supplies a valid logic 1 unless another source overrides it.

For ADC channel `k`:

\[
ADC_k=\mathrm{clamp}\left(\left\lfloor\frac{V_k}{V_{REF}}1024\right\rfloor,0,1023\right)
\]

The worker sets `adc.channelValues[k]` in volts and AVR8js performs its conversion timing and quantization. Do not directly write ADCL/ADCH.

### 10.4 Dirty-subgraph sequence

1. integrate time-weighted component state to the current cycle;
2. update the changed source, switch, or potentiometer stamp;
3. find affected connected subgraphs;
4. detect incompatible fixed rails before numeric solving;
5. build and solve the bounded conductance system;
6. iterate LED states;
7. calculate net logic, ADC voltages, currents, and contention;
8. call AVR input adapters only for changed values;
9. feed solved transitions to LCD and servo observers;
10. coalesce display deltas and diagnostics.

---

## 11. Functional component state handlers

### 11.1 LED and PWM brightness

Each LED runtime stores:

```ts
interface LedState {
  on: boolean;
  milliAmps: number;
  accumulatedLuminanceCycles: number;
  lastIntegratedCycle: number;
  frameStartCycle: number;
}
```

Before every LED current change, integrate:

\[
L_{acc} \mathrel{+}= \mathrm{clamp}(I/I_{rated},0,1)(C-C_{last})
\]

At display-frame emission:

\[
duty=L_{acc}/(C_{frameEnd}-C_{frameStart}), \qquad brightness=duty^{1/2.2}
\]

This captures Timer PWM edges even at 30 UI FPS. Below forward voltage or reverse biased means zero current. Warn above the configured rated current and issue a stronger `LED_SEVERE_OVERCURRENT` above 30 mA. Never simulate permanent destruction.

### 11.2 Pushbutton

- Four visual legs; the two legs on each side are permanently common.
- Released: infinite resistance between sides.
- Pressed: `1 Ω` between sides.
- Pointer down and Space/Enter send `true`; pointer up/cancel/blur send `false`.
- A project can enable deterministic teaching bounce. If enabled, expand one press into a seeded fixed edge sequence such as 0, 180, 410, 730, and 1100 microseconds. Bounce is off by default.
- Control events are applied at simulated cycles, never React render timestamps.

### 11.3 Potentiometer and `analogRead()`

For total resistance `R` and clamped position `p`:

\[
R_{A,W}=\max(R_{min},Rp), \qquad R_{W,B}=\max(R_{min},R(1-p))
\]

Use `Rmin = 1 Ω` by default. When A and B connect to 5 V and GND, wiper voltage is approximately `5p` or `5(1-p)` depending on orientation. The general conductance solver, not a special-case formula, remains authoritative. The UI slider may update at pointer frequency, but the renderer should coalesce to at most 60 control messages per second.

### 11.4 HD44780 16×2 LCD, 4-bit mode

Supported pins: `VSS`, `VDD`, `VO`, `RS`, `RW`, `E`, `D4`–`D7`, `A`, `K`. D0–D3 may be drawn but are inactive in the first release.

Controller state:

```ts
interface Hd44780State {
  mode: 'await-init' | 'four-bit';
  pendingHighNibble: number | null;
  ddram: Uint8Array;              // 0x00..0x67 addressable educational subset
  cgram: Uint8Array;              // 64 bytes for 8 custom glyphs
  addressCounter: number;
  addressSpace: 'ddram' | 'cgram';
  displayOn: boolean;
  cursorOn: boolean;
  blinkOn: boolean;
  increment: boolean;
  shiftOnWrite: boolean;
  twoLine: boolean;
  busyUntilCycle: number;
  lastEnable: 0 | 1 | 'X';
}
```

Behavior:

1. Require powered VDD/VSS and valid digital control/data levels.
2. Observe the solved `E` net. Latch `D7..D4` on the falling edge of E.
3. In the initialization phase, recognize the standard `0x3`, `0x3`, `0x3`, `0x2` nibble sequence with tolerant classroom timing.
4. In 4-bit mode, combine high nibble then low nibble.
5. `RS=0` dispatches a command; `RS=1` writes data.
6. MVP write mode requires `RW=0`. `RW=1` raises `LCD_READ_UNSUPPORTED` and does not drive the data bus.
7. Implement clear (`0x01`), home (`0x02`), entry mode (`0x04..0x07`), display control (`0x08..0x0F`), cursor/display shift (`0x10..0x1F`), function set (`0x20..0x3F`), CGRAM address (`0x40..0x7F`), and DDRAM address (`0x80..0xFF`).
8. Clear/home busy duration: approximately `1.52 ms`; ordinary command/data write: approximately `37 µs`, converted with `F_CPU`.
9. If a nibble arrives before `busyUntilCycle`, ignore it and emit a rate-limited `LCD_BUSY_WRITE` warning.
10. Map visible row addresses as row 0 `0x00..0x0F` and row 1 `0x40..0x4F`.
11. Render characters from bundled local 5×8 bitmap glyph data. Never download fonts or images.

Contrast (`VO`) controls visual contrast only in the educational model. Backlight `A/K` controls backlight state with a current-limiting warning if directly shorted to rails in an unsupported way.

### 11.5 Servo motor

The servo model observes the solved signal net; it does not inspect code or Timer registers.

On each rising edge, store `riseCycle`. On the next falling edge:

\[
pulse_{µs}=(C_{fall}-C_{rise})/16
\]

For configured endpoints `Pmin`, `Pmax`, `Amin`, `Amax`:

\[
angle=\mathrm{clamp}\left(A_{min}+\frac{pulse-P_{min}}{P_{max}-P_{min}}(A_{max}-A_{min}),A_{min},A_{max}\right)
\]

Default classroom profile: 1000–2000 µs maps to 0–180°. Accept 500–2500 µs as observable but warn outside configured endpoints. Validate refresh periods in the broad 10–30 ms range; do not make animation depend on an exact 20 ms period. Smooth only the rendered horn, not the measured angle. The model does not simulate torque, load, stall current, inertia, or supply droop.

---

## 12. Real-time GPIO synchronization

The AVR-to-circuit direction uses `AVRIOPort.addListener()`. On every callback, query all eight `pinState()` values because a DDR change can change drive mode without changing the logic byte. Timer compare overrides are included by AVR8js's GPIO port implementation and therefore generate PWM edges through the same boundary.

The circuit-to-AVR direction uses:

- `AVRIOPort.setPin(bit, boolean)` for solved digital external inputs;
- `AVRADC.channelValues[channel] = volts` for analog input voltage.

Never mutate `PINx`, `PORTx`, `DDRx`, `ADCL`, or `ADCH` directly. Do not call `setPin()` to fake an AVR output. Output state comes from `pinState()` and the peripheral model.

The worker observes only board pins present in `RuntimeNetlist.boardPins`, but it may publish all physical port states to `CircuitRuntime`, which deduplicates unused pins.

---

## 13. Virtual Serial Monitor and Plotter

### 13.1 UART worker capture

Instantiate:

```ts
const usart = new AVRUSART(cpu, usart0Config, 16_000_000);
```

- Assign `onByteTransmit` and preserve raw bytes.
- Batch TX at 512 bytes or the next display flush, whichever comes first.
- Transfer the `Uint8Array` buffer to the renderer.
- Include first/last simulated cycle and current baud rate.
- Use `onConfigurationChange` to update baud, data bits, stop bits, and parity display.
- Limit an unsent TX buffer to 64 KiB. If exceeded, drop new bytes and emit one rate-limited `SERIAL_TX_OVERFLOW` diagnostic.

RX path:

1. renderer encodes user input with `TextEncoder` or sends explicitly selected raw bytes;
2. each message is limited to 4 KiB;
3. worker queue is limited to 64 KiB;
4. call `usart.writeByte(byte, false)` only when RX is enabled and not busy;
5. AVR8js schedules arrival using the configured UART character time;
6. keep a byte queued if `writeByte()` returns `false`.

### 13.2 Renderer terminal decoder

Use one streaming decoder per serial epoch:

```ts
const decoder = new TextDecoder('utf-8', { fatal: false });

function receiveSerial(bytes: Uint8Array): void {
  const text = decoder.decode(bytes, { stream: true });
  terminalBuffer.append(text);
  plotterParser.accept(text);
}
```

Reset the decoder on program Reset/Stop. Preserve replacement characters for invalid UTF-8; offer a hex-view toggle for binary output.

Terminal features:

- text input with Send button and Enter-to-send;
- selectable line ending: none, LF, CR, or CRLF;
- UTF-8 text and hexadecimal display modes;
- Clear view without clearing AVR state;
- Copy selected/all text;
- Auto-scroll toggle;
- simulated timestamp toggle using `cycles / 16_000_000`;
- badge showing configured UART settings;
- local-only export through the secure project/export API, never direct renderer filesystem access.

### 13.3 Memory bounds

Do not store an unlimited classroom session in React state.

- raw terminal ring buffer: 2 MiB or 20,000 logical lines, whichever occurs first;
- one logical line: maximum 4096 decoded characters before forced segmentation;
- render only visible rows with virtualization;
- batch React/store commits at no more than 30 per second;
- plotter: maximum 8 series and 2,000 samples per series by default;
- expose “output truncated” clearly when old data is evicted.

### 13.4 Plotter parsing

The plotter consumes complete newline-terminated records. Accepted classroom formats:

```text
12.5
12.5,7.2,3
temperature:24.1 humidity:61.5
temperature=24.1,humidity=61.5
```

Rules:

1. trim CR/LF and ignore blank lines;
2. parse finite decimal numbers only—no `eval`, expressions, JSON prototypes, or code;
3. unlabeled columns become `value`, then `value2`…;
4. labeled tokens use names up to 32 safe display characters;
5. reject more than 8 values on a line or non-finite values;
6. malformed lines remain visible in the terminal but do not enter the plot;
7. x-axis defaults to simulated time from the TX cycle; an explicit first `time:` field may override display x only after validation;
8. decimate for rendering when the viewport has fewer horizontal pixels than samples, while retaining the bounded raw ring.

### 13.5 Main-thread simulation client

The renderer client must:

- create a new UUID session per worker epoch;
- ignore messages from stale session IDs;
- ignore nonmonotonic frame sequences;
- apply one `FRAME` in one store transaction;
- never put Worker, AVR8js, Monaco, DOM, or Electron objects into persisted state;
- transfer RX buffers when the caller no longer needs them;
- expose `run`, `pause`, `step`, `reset`, `setPerformance`, `setControl`, and `sendSerial` methods;
- terminate the worker if it becomes unresponsive, then offer a classroom-friendly Reset action.

---

## 14. Low-spec laptop architecture

Low-spec mode is a first-class user setting, not an error state.

### Worker

- default to 25% wall-clock speed and 30 FPS;
- 4 ms maximum wall slice and 15,000 instructions per slice;
- yield with `setTimeout`, never a blocking infinite loop;
- rebase after 40 ms catch-up lag;
- coalesce pin/node/component changes;
- solve only dirty connected subgraphs;
- avoid `performance.now()` on every instruction—check every 256 instructions;
- transfer serial byte buffers instead of cloning large arrays.

### Renderer

- SVG component memoization and selector-based store subscriptions;
- no full-canvas rerender for pin changes;
- viewport culling for offscreen components/wires;
- pause expensive route recalculation during drag;
- 30 FPS visual scheduler in low-spec mode;
- virtualize terminal and diagnostics lists;
- Monaco minimap off by default, reduced semantic-token work, and one model per open sketch;
- disable decorative animations and shadows in low-spec mode.

### Runtime caps

- project limits from section 9;
- 2 MiB terminal buffer;
- 64 KiB RX/TX worker queues;
- 1 MiB HEX text;
- 64 unknown nodes per solved subgraph;
- stable diagnostic maps rather than unbounded event arrays;
- no historical full-frame retention in worker or React state.

Electron/V8 cannot enforce a safe per-worker hard heap quota. Use the explicit data limits above, monitor renderer/worker health, and recover by terminating the worker. Do not pass unsupported V8 flags as a substitute for bounded application data structures.

---

## 15. Error and diagnostic catalog

Minimum stable codes:

| Code | Severity | Student-facing action |
| --- | --- | --- |
| `POWER_RAIL_SHORT` | fatal | Disconnect the wire joining 5V and GND. |
| `INCOMPATIBLE_POWER_RAILS` | fatal | Do not join the 5V and 3.3V pins. |
| `GPIO_CONTENTION` | error | Two output pins are driving different values; change wiring or pin mode. |
| `FLOATING_INPUT` | warning | Add a pull-up/pull-down or enable `INPUT_PULLUP`. |
| `WIRE_COLOR_CONVENTION` | info/warning | Use red for power, black for ground, and a signal color for data. |
| `LED_MISSING_RESISTOR` | warning | Add a 220–330 Ω series resistor. |
| `LED_OVERCURRENT` | warning | Increase the LED series resistance. |
| `LCD_NOT_POWERED` | error | Connect LCD VSS to GND and VDD to 5V. |
| `LCD_FLOATING_PIN` | warning | Connect every used LCD control/data pin. |
| `LCD_BUSY_WRITE` | warning | Wait for the LCD command to finish. |
| `LCD_READ_UNSUPPORTED` | warning | Tie RW to GND for write-only 4-bit mode. |
| `SERVO_NOT_POWERED` | error | Connect servo VCC and GND. |
| `SERVO_INVALID_PULSE` | warning | Use pulse widths near 1000–2000 µs. |
| `SERIAL_RX_OVERFLOW` | warning | Wait for the sketch to read input before sending more. |
| `SERIAL_TX_OVERFLOW` | warning | Reduce print rate or pause the simulation. |
| `SOLVER_DID_NOT_CONVERGE` | error | Simplify or correct the circuit wiring. |

Rate-limit repeated runtime diagnostics by stable ID and simulated time. The UI may show a count, but must not flood the student with one entry per CPU cycle.

---

## 16. Determinism, lifecycle, and classroom behavior

- Topology edits are locked while running. Stop/recompile/reinitialize after connectivity changes.
- Button/pot controls may change while running through scheduled worker messages.
- Reset recreates CPU and all peripherals, clears serial queues, restores initial controls, clears LCD/servo transient state, and restarts at cycle zero.
- Pause takes effect at an instruction boundary.
- Step executes exactly one AVR instruction followed by one `cpu.tick()`.
- Stop disposes and terminates the worker. It is not merely Pause.
- A worker fault never crashes the Electron main process or reloads the whole window automatically.
- Project files persist source, component placement/properties, wire endpoints/colors/waypoints, and explicit junctions. They do not persist registers, runtime voltages, frames, compiled HEX, LCD transient state, servo pulse history, or terminal output.

---

## 17. Required tests

### 17.1 Intel HEX

- valid Arduino Uno HEX loads with correct byte count;
- CRLF and blank trailing line accepted;
- bad checksum, bad byte count, invalid digit, missing EOF, data after EOF, and out-of-flash address rejected;
- type 02 and 04 address records handled;
- conflicting overlap rejected and identical overlap accepted;
- unused flash remains `0xffff`.

### 17.2 Worker and timing

- Blink toggles PB5/D13 at the expected simulated-cycle cadence;
- timer PWM edges appear through the GPIO listener boundary;
- Pause stops cycle advancement;
- Step advances by the tested instruction's actual cycle cost;
- Reset returns cycle and peripherals to their initial state;
- standard mode targets 1× and low-spec targets 0.25× without changing pulse widths in simulated microseconds;
- a runaway sketch remains pausable because execution slices yield;
- stale-session messages are ignored by the renderer.

### 17.3 Netlist

- wire crossing without junction does not connect;
- explicit junction merges nets;
- component movement leaves `topologyHash` unchanged;
- rail short is fatal before Run;
- red-to-GND remains GND and emits a color warning;
- D0–D13 and A0–A5 mappings match the canonical Uno table.

### 17.4 Components

- LED off/reverse/on cases and PWM duty brightness;
- button input with external pull-down and `INPUT_PULLUP` wiring;
- potentiometer sweep is monotonic and reaches ADC readings near 0 and 1023;
- standard `LiquidCrystal` Hello World initialization and two-line DDRAM addressing;
- clear/home busy timing;
- Servo Sweep measures pulses and maps them to 0–180° without reading source code.

### 17.5 Serial

- TX bytes preserve binary values including NUL and invalid UTF-8;
- RX respects UART enable/busy state and configured character timing;
- CR/LF modes encode correctly;
- decoder handles a multibyte UTF-8 character split across chunks;
- terminal and plotter rings evict oldest data at limits;
- numeric, CSV, and labeled plotter lines parse; malformed lines do not execute or enter plots.

---

## 18. Definition of done

This module is complete when a clean offline classroom computer can:

1. compile a bundled starter sketch through the secure main-process compiler;
2. load the validated HEX into a fresh worker;
3. run AVR instructions and timers without blocking Monaco or the canvas;
4. show digital, PWM, and analog circuit behavior from the runtime netlist;
5. interact with buttons and potentiometers;
6. display a 16×2 LCD and servo position from measured GPIO protocols;
7. send and receive UART data through the Virtual Serial Monitor;
8. switch between 60 FPS standard and 30 FPS low-spec mode;
9. recover cleanly from pause, reset, stop, and worker failure;
10. do all of the above with the network disconnected and no post-install downloads.

---

## 19. Implementation order for Claude Code

1. Add shared contracts and pin exact `avr8js` version.
2. Unit-test Intel HEX parsing.
3. Implement worker CPU/ports/timers and prove D13 Blink.
4. Implement UART TX/RX and terminal bounds.
5. Implement pure union-find netlist compilation.
6. Implement rail/digital/resistor solver and GPIO input feedback.
7. Add button, potentiometer, and LED PWM integrator.
8. Add HD44780 4-bit model.
9. Add servo pulse observer.
10. Add low-spec profile, metrics, diagnostics, and full acceptance suite.

Do not begin LCD or servo work until the Blink, button, potentiometer, serial, and netlist tests are deterministic.

---

## 20. Primary references

- AVR8js repository and architecture: https://github.com/wokwi/avr8js
- AVR8js package API pinned for this specification: https://www.npmjs.com/package/avr8js/v/0.21.0
- ATmega328P product documentation: https://www.microchip.com/en-us/product/atmega328p
- Intel HEX format overview: https://developer.arm.com/documentation/ka003292/latest/
- HD44780-compatible controller behavior must be validated against the datasheet shipped in the project's offline engineering references before release.

