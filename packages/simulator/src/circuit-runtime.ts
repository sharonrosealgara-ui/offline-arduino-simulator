/**
 * Orchestrates the bounded electrical solver and component runtime models against a
 * compiled RuntimeNetlist. This is the CircuitRuntime referenced by the worker in
 * FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §5.1.
 *
 * Design notes (implementation decisions the spec leaves to the implementer):
 *  - `settle()` only re-solves when something is dirty (GPIO driver, control, or a
 *    time-driven observer changed) — cheap no-op otherwise, since it can be invoked
 *    every simulated instruction slice.
 *  - Diagnostics: DIAGNOSTICS messages carry the FULL current set of active circuit
 *    diagnostics whenever that set changes (upsert/remove-by-id on the renderer side).
 *    Component-level "flooding" (e.g. LCD_BUSY_WRITE) is separately rate-limited inside
 *    each component runtime.
 */
import type {
  BoardPinBinding,
  CircuitDiagnostic,
  ComponentDisplayDelta,
  NodeDisplayDelta,
  PinDisplayDelta,
  PinDriveMode,
  PinEdge,
  PortName,
  RuntimeElement,
  RuntimeNetlist,
} from '@offline-arduino/contracts/simulator';
import { solveCircuit, classifyLogic, type SolverBranch, type SolverSource } from './electrical-solver';
import { LedRuntime } from './components/led-runtime';
import { computePotentiometerBranches, clampPosition } from './components/potentiometer-runtime';
import { Hd44780Runtime, type Hd44780Logic } from './components/hd44780-runtime';
import { ServoRuntime, type ServoLogic } from './components/servo-runtime';

export interface CircuitRuntimeAdapter {
  setDigitalInput(port: PortName, bit: number, high: boolean): void;
  setAnalogVoltage(channel: number, volts: number): void;
}

export interface DisplayDelta {
  pinChanges: PinDisplayDelta[];
  nodeChanges: NodeDisplayDelta[];
  componentChanges: ComponentDisplayDelta[];
  /** Cycle-accurate transition log accumulated since the last frame (Logic Analyzer). */
  pinEdges: PinEdge[];
  /** True once the session's bounded edge budget filled and recording stopped. */
  pinEdgeOverflow: boolean;
}

/** Default classroom-safe cap on total logic edges captured PER SESSION. */
const DEFAULT_MAX_EDGES = 200_000;

const OUTPUT_RESISTANCE_OHMS = 25;
const PULLUP_RESISTANCE_OHMS = 30_000;
const VCC_5V = 5;
const VCC_3V3 = 3.3;
const GND = 0;

export class CircuitRuntime {
  private readonly netlist: RuntimeNetlist;
  private readonly adapter: CircuitRuntimeAdapter;

  private readonly railVoltsByNet = new Map<string, number>();
  private readonly boardPinsByPortBit = new Map<string, BoardPinBinding>();
  private readonly boardPinByName = new Map<string, BoardPinBinding>();

  private readonly driveModeByBoardPin = new Map<string, PinDriveMode>();
  private readonly gpioSourceByNet = new Map<string, SolverSource>();

  private readonly leds = new Map<string, { element: Extract<RuntimeElement, { kind: 'led' }>; runtime: LedRuntime }>();
  private readonly switches = new Map<string, { element: Extract<RuntimeElement, { kind: 'switch' }>; pressed: boolean }>();
  private readonly potentiometers = new Map<
    string,
    { element: Extract<RuntimeElement, { kind: 'potentiometer' }>; position: number }
  >();
  private readonly lcds = new Map<string, { element: Extract<RuntimeElement, { kind: 'lcd1602' }>; runtime: Hd44780Runtime }>();
  private readonly servos = new Map<string, { element: Extract<RuntimeElement, { kind: 'servo' }>; runtime: ServoRuntime }>();

  private readonly resistorBranches: SolverBranch[] = [];

  private dirty = true;
  private insideSettle = false;
  private lastCycle = 0;

  private readonly lastNetLogic = new Map<string, 0 | 1 | 'X'>();
  private readonly lastNetVolts = new Map<string, number>();
  private readonly lastPinLogic = new Map<string, 0 | 1 | 'X'>();
  private readonly lastPinVolts = new Map<string, number>();
  private readonly lastPinMode = new Map<string, PinDriveMode>();
  private previousLedState = new Map<string, boolean>();

  private pendingPinChanges = new Map<string, PinDisplayDelta>();
  private pendingNodeChanges = new Map<string, NodeDisplayDelta>();
  private pendingComponentChanges = new Map<string, ComponentDisplayDelta>();
  private pinEdgeLog: PinEdge[] = [];
  private captureEnabled = true;
  private maxEdges = DEFAULT_MAX_EDGES;
  private totalEdgesRecorded = 0;
  private edgeOverflow = false;

  private activeDiagnostics = new Map<string, CircuitDiagnostic>();
  private diagnosticsChanged = false;
  private readonly transientDiagnostics: CircuitDiagnostic[] = [];

  constructor(netlist: RuntimeNetlist, adapter: CircuitRuntimeAdapter) {
    this.netlist = netlist;
    this.adapter = adapter;

    for (const net of netlist.nets) {
      if (net.rail === 'VCC_5V') this.railVoltsByNet.set(net.id, VCC_5V);
      else if (net.rail === 'VCC_3V3') this.railVoltsByNet.set(net.id, VCC_3V3);
      else if (net.rail === 'GND') this.railVoltsByNet.set(net.id, GND);
    }

    for (const binding of netlist.boardPins) {
      this.boardPinByName.set(binding.boardPin, binding);
      if (binding.port !== undefined && binding.bit !== undefined) {
        this.boardPinsByPortBit.set(`${binding.port}:${binding.bit}`, binding);
      }
      // Digital pins default to AVR reset state: input, not pulled up.
      this.driveModeByBoardPin.set(binding.boardPin, 'input');
      this.lastPinLogic.set(binding.boardPin, 'X');
    }

    for (const element of netlist.elements) {
      switch (element.kind) {
        case 'resistor':
          this.resistorBranches.push({ a: element.a, b: element.b, ohms: element.ohms });
          break;
        case 'led':
          this.leds.set(element.id, { element, runtime: new LedRuntime(element.id, element.ratedMilliAmps, 0) });
          break;
        case 'switch':
          this.switches.set(element.id, { element, pressed: false });
          break;
        case 'potentiometer':
          this.potentiometers.set(element.id, { element, position: clampPosition(element.initialPosition) });
          break;
        case 'lcd1602':
          this.lcds.set(element.id, { element, runtime: new Hd44780Runtime(element.id) });
          break;
        case 'servo':
          this.servos.set(element.id, {
            element,
            runtime: new ServoRuntime(element.id, element.minPulseMicros, element.maxPulseMicros, element.minAngle, element.maxAngle),
          });
          break;
      }
    }

    // Netlist-compile-time diagnostics (e.g. POWER_RAIL_SHORT) start active.
    for (const diagnostic of netlist.diagnostics) {
      this.activeDiagnostics.set(diagnostic.id, diagnostic);
    }
    this.diagnosticsChanged = this.activeDiagnostics.size > 0;
  }

  /** Called by the worker whenever a GPIO port publishes pin state (spec §12). */
  onBoardPinDriverChange(port: PortName, bit: number, drive: PinDriveMode, cycle: number): void {
    const binding = this.boardPinsByPortBit.get(`${port}:${bit}`);
    if (!binding) return;
    const previous = this.driveModeByBoardPin.get(binding.boardPin);
    if (previous === drive) return;
    this.driveModeByBoardPin.set(binding.boardPin, drive);
    this.lastCycle = cycle;

    if (drive === 'output-low') {
      this.gpioSourceByNet.set(binding.netId, { netId: binding.netId, voltage: 0, ohms: OUTPUT_RESISTANCE_OHMS });
    } else if (drive === 'output-high') {
      this.gpioSourceByNet.set(binding.netId, { netId: binding.netId, voltage: 5, ohms: OUTPUT_RESISTANCE_OHMS });
    } else if (drive === 'input-pullup') {
      this.gpioSourceByNet.set(binding.netId, { netId: binding.netId, voltage: 5, ohms: PULLUP_RESISTANCE_OHMS });
    } else {
      this.gpioSourceByNet.delete(binding.netId);
    }
    this.dirty = true;
  }

  /** Enables/bounds cycle-accurate edge capture for the Logic Analyzer (worker control). */
  setLogicCaptureConfig(enabled: boolean, maxEdges: number): void {
    this.captureEnabled = enabled;
    if (Number.isFinite(maxEdges) && maxEdges > 0) this.maxEdges = Math.floor(maxEdges);
    this.totalEdgesRecorded = 0;
    this.edgeOverflow = false;
  }

  /** Applies a validated button/potentiometer control event (spec §5.1, §11.2, §11.3). */
  setControl(controlId: string, value: boolean | number, cycle: number): void {
    this.lastCycle = cycle;
    const sw = this.switches.get(controlId);
    if (sw) {
      if (typeof value !== 'boolean') throw new Error(`Control ${controlId} expects a boolean value.`);
      sw.pressed = value;
      this.dirty = true;
      return;
    }
    const pot = this.potentiometers.get(controlId);
    if (pot) {
      if (typeof value !== 'number') throw new Error(`Control ${controlId} expects a numeric value.`);
      pot.position = clampPosition(value);
      this.dirty = true;
      return;
    }
    throw new Error(`Unknown external control identifier: ${controlId}`);
  }

  /** Integrates time-weighted component state (LED PWM luminance) through `cycle`. */
  advanceTo(cycle: number): void {
    this.lastCycle = cycle;
    for (const { runtime, element } of this.leds.values()) {
      const on = this.previousLedState.get(element.id) ?? false;
      // Re-assert the current (possibly unchanged) current to force integration to `cycle`.
      const current = on ? this.lastLedCurrentAmps.get(element.id) ?? 0 : 0;
      runtime.setCurrentAmps(current, cycle);
    }
  }

  private lastLedCurrentAmps = new Map<string, number>();

  /** Solves the dirty subgraphs and pushes changed values to the AVR adapter (spec §10.4). */
  settle(cycle: number): void {
    if (this.insideSettle) return;
    if (!this.dirty) return;
    this.insideSettle = true;
    try {
      this.lastCycle = cycle;
      this.dirty = false;
      this.resolve(cycle);
    } finally {
      this.insideSettle = false;
    }
  }

  private resolve(cycle: number): void {
    const branches: SolverBranch[] = [...this.resistorBranches];
    for (const { element, pressed } of this.switches.values()) {
      if (pressed) branches.push({ a: element.a, b: element.b, ohms: element.closedOhms });
    }
    for (const { element, position } of this.potentiometers.values()) {
      const { aToWiperOhms, wiperToBOhms } = computePotentiometerBranches(element.ohms, element.minimumOhms, position);
      branches.push({ a: element.a, b: element.wiper, ohms: aToWiperOhms });
      branches.push({ a: element.wiper, b: element.b, ohms: wiperToBOhms });
    }

    const sources = [...this.gpioSourceByNet.values()];
    const leds = [...this.leds.values()].map(({ element }) => ({
      id: element.id,
      anode: element.anode,
      cathode: element.cathode,
      forwardV: element.forwardV,
      dynamicOhms: element.dynamicOhms,
    }));

    const result = solveCircuit({
      fixedNets: this.railVoltsByNet,
      branches,
      sources,
      leds,
      allNets: this.netlist.nets.map((n) => n.id),
      previousLedState: this.previousLedState,
    });

    this.previousLedState = result.ledOn;

    // --- LED current + display frame -------------------------------------------------
    for (const [id, current] of result.ledCurrentAmps) {
      this.lastLedCurrentAmps.set(id, current);
      const led = this.leds.get(id);
      if (led) led.runtime.setCurrentAmps(current, cycle);
    }

    // --- Net logic + AVR input feedback ------------------------------------------------
    for (const net of this.netlist.nets) {
      const volts = result.voltages.get(net.id) ?? null;
      const previousLogic = this.lastNetLogic.get(net.id) ?? 'X';
      const logic = net.rail
        ? net.rail === 'GND'
          ? 0
          : 1
        : classifyLogic(volts, previousLogic);
      this.emitNodeChangeIfNeeded(net.id, logic, volts);
    }

    for (const binding of this.netlist.boardPins) {
      const mode = this.driveModeByBoardPin.get(binding.boardPin) ?? 'input';
      const volts = result.voltages.get(binding.netId) ?? null;
      const logic = this.lastNetLogic.get(binding.netId) ?? 'X';
      this.emitPinChangeIfNeeded(binding.boardPin, mode, logic, volts);

      if (mode === 'input' || mode === 'input-pullup') {
        if (binding.port !== undefined && binding.bit !== undefined) {
          this.adapter.setDigitalInput(binding.port, binding.bit, logic === 1);
        }
        if (binding.adcChannel !== undefined) {
          this.adapter.setAnalogVoltage(binding.adcChannel, volts ?? 0);
        }
      }
    }

    // --- LCD observers ------------------------------------------------------------------
    for (const { element, runtime } of this.lcds.values()) {
      const logicFor = (pinId: string): Hd44780Logic => {
        const netId = element.pins[pinId];
        return netId ? this.lastNetLogic.get(netId) ?? 'X' : 'X';
      };
      const diags = runtime.observe(
        logicFor('RS'),
        logicFor('RW'),
        logicFor('E'),
        logicFor('D7'),
        logicFor('D6'),
        logicFor('D5'),
        logicFor('D4'),
        cycle,
      );
      for (const d of diags) this.transientDiagnostics.push(d);
      this.checkLcdPower(element);
      if (runtime.takeUnsupportedEightBitFlag()) {
        this.upsertDiagnostic({
          id: `LCD_UNSUPPORTED_CONFIGURATION:${element.id}`,
          severity: 'warning',
          code: 'LCD_UNSUPPORTED_CONFIGURATION',
          message: 'This runtime only supports HD44780 4-bit mode. Use a 4-bit wiring/init sequence.',
          componentIds: [element.id],
        });
      }
    }

    // --- Servo observers -----------------------------------------------------------------
    for (const { element, runtime } of this.servos.values()) {
      const signalNetId = element.signal;
      const signal: ServoLogic = this.lastNetLogic.get(signalNetId) ?? 'X';
      const diags = runtime.observe(signal, cycle);
      for (const d of diags) this.transientDiagnostics.push(d);
      this.checkServoPower(element);
    }

    // --- Circuit-level diagnostics ---------------------------------------------------------
    this.checkFloatingInputs(result.floatingNets);
    this.checkContention(result.contentionNets);
    this.checkMissingResistor();
  }

  private checkLcdPower(element: Extract<RuntimeElement, { kind: 'lcd1602' }>): void {
    const vssNet = this.netlist.nets.find((n) => n.id === element.pins.VSS);
    const vddNet = this.netlist.nets.find((n) => n.id === element.pins.VDD);
    const powered = vssNet?.rail === 'GND' && vddNet?.rail === 'VCC_5V';
    const id = `LCD_NOT_POWERED:${element.id}`;
    if (!powered) {
      this.upsertDiagnostic({
        id,
        severity: 'error',
        code: 'LCD_NOT_POWERED',
        message: 'Connect LCD VSS to GND and VDD to 5V.',
        componentIds: [element.id],
      });
    } else {
      this.clearDiagnostic(id);
    }
  }

  private checkServoPower(element: Extract<RuntimeElement, { kind: 'servo' }>): void {
    const vccNet = this.netlist.nets.find((n) => n.id === element.vcc);
    const gndNet = this.netlist.nets.find((n) => n.id === element.ground);
    const powered = vccNet?.rail === 'VCC_5V' && gndNet?.rail === 'GND';
    const id = `SERVO_NOT_POWERED:${element.id}`;
    if (!powered) {
      this.upsertDiagnostic({
        id,
        severity: 'error',
        code: 'SERVO_NOT_POWERED',
        message: 'Connect servo VCC and GND.',
        componentIds: [element.id],
      });
    } else {
      this.clearDiagnostic(id);
    }
  }

  private checkFloatingInputs(floatingNets: Set<string>): void {
    for (const binding of this.netlist.boardPins) {
      const mode = this.driveModeByBoardPin.get(binding.boardPin);
      const id = `FLOATING_INPUT:${binding.boardPin}`;
      if (mode === 'input' && floatingNets.has(binding.netId)) {
        this.upsertDiagnostic({
          id,
          severity: 'warning',
          code: 'FLOATING_INPUT',
          message: 'Add a pull-up/pull-down or enable INPUT_PULLUP.',
          componentIds: [],
        });
      } else {
        this.clearDiagnostic(id);
      }
    }
  }

  private checkContention(contentionNets: Set<string>): void {
    for (const net of this.netlist.nets) {
      const id = `GPIO_CONTENTION:${net.id}`;
      if (contentionNets.has(net.id)) {
        this.upsertDiagnostic({
          id,
          severity: 'error',
          code: 'GPIO_CONTENTION',
          message: 'Two output pins are driving different values; change wiring or pin mode.',
          netIds: [net.id],
        });
      } else {
        this.clearDiagnostic(id);
      }
    }
  }

  private checkMissingResistor(): void {
    // Warn when an LED anode/cathode net has no resistor element in its immediate branch set.
    const resistorNets = new Set<string>();
    for (const branch of this.resistorBranches) {
      resistorNets.add(branch.a);
      resistorNets.add(branch.b);
    }
    for (const { element } of this.leds.values()) {
      const id = `LED_MISSING_RESISTOR:${element.id}`;
      const hasResistor = resistorNets.has(element.anode) || resistorNets.has(element.cathode);
      if (!hasResistor) {
        this.upsertDiagnostic({
          id,
          severity: 'warning',
          code: 'LED_MISSING_RESISTOR',
          message: 'Add a 220-330 ohm series resistor.',
          componentIds: [element.id],
        });
      } else {
        this.clearDiagnostic(id);
      }
    }
  }

  private upsertDiagnostic(diagnostic: CircuitDiagnostic): void {
    const existing = this.activeDiagnostics.get(diagnostic.id);
    if (existing && existing.message === diagnostic.message && existing.severity === diagnostic.severity) return;
    this.activeDiagnostics.set(diagnostic.id, diagnostic);
    this.diagnosticsChanged = true;
  }

  private clearDiagnostic(id: string): void {
    if (this.activeDiagnostics.delete(id)) this.diagnosticsChanged = true;
  }

  private emitNodeChangeIfNeeded(netId: string, logic: 0 | 1 | 'X' | 'Z', volts: number | null): void {
    const prevLogic = this.lastNetLogic.get(netId);
    const prevVolts = this.lastNetVolts.get(netId);
    const voltsChanged = volts !== null && (prevVolts === undefined || Math.abs(prevVolts - volts) > 1e-3);
    if (prevLogic === logic && !voltsChanged) return;
    this.lastNetLogic.set(netId, logic as 0 | 1 | 'X');
    if (volts !== null) this.lastNetVolts.set(netId, volts);
    this.pendingNodeChanges.set(netId, { netId, logic, volts });
  }

  private emitPinChangeIfNeeded(boardPin: string, mode: PinDriveMode, logic: 0 | 1 | 'X', volts: number | null): void {
    const prevLogic = this.lastPinLogic.get(boardPin);
    const prevVolts = this.lastPinVolts.get(boardPin);
    const prevMode = this.lastPinMode.get(boardPin);
    const voltsChanged = volts !== null && (prevVolts === undefined || Math.abs(prevVolts - volts) > 1e-3);
    if (prevLogic === logic && !voltsChanged && prevMode === mode) return;
    // Cycle-accurate edge log: record only true 0<->1 logic transitions (not mode/volts-
    // only changes), at the current settle cycle. This is the Logic Analyzer's data source.
    // Bounded capture: once the session budget fills, stop recording deterministically and
    // raise a sticky overflow flag rather than silently dropping arbitrary events.
    if (this.captureEnabled && prevLogic !== logic && (logic === 0 || logic === 1)) {
      if (this.totalEdgesRecorded < this.maxEdges) {
        this.pinEdgeLog.push({ boardPin, cycle: this.lastCycle, logic });
        this.totalEdgesRecorded += 1;
      } else {
        this.edgeOverflow = true;
      }
    }
    this.lastPinLogic.set(boardPin, logic);
    if (volts !== null) this.lastPinVolts.set(boardPin, volts);
    this.lastPinMode.set(boardPin, mode);
    this.pendingPinChanges.set(boardPin, { boardPin, mode, logic, volts });
  }

  /** Returns and clears coalesced UI deltas (spec §5.1). */
  takeDisplayDelta(): DisplayDelta {
    for (const { element, runtime } of this.leds.values()) {
      const frame = runtime.takeFrame(this.lastCycle);
      for (const d of frame.diagnostics) this.transientDiagnostics.push(d);
      this.pendingComponentChanges.set(element.id, {
        id: element.id,
        kind: 'led',
        brightness: frame.brightness,
        milliAmps: frame.milliAmps,
      });
    }
    for (const { element, runtime } of this.lcds.values()) {
      const frame = runtime.takeFrame();
      this.pendingComponentChanges.set(element.id, { id: element.id, kind: 'lcd1602', ...frame });
    }
    for (const { element, runtime } of this.servos.values()) {
      const frame = runtime.takeFrame();
      this.pendingComponentChanges.set(element.id, { id: element.id, kind: 'servo', ...frame });
    }
    for (const { element, pressed } of this.switches.values()) {
      this.pendingComponentChanges.set(element.id, { id: element.id, kind: 'pushbutton', value: pressed });
    }
    for (const { element, position } of this.potentiometers.values()) {
      this.pendingComponentChanges.set(element.id, { id: element.id, kind: 'potentiometer', value: position });
    }

    const delta: DisplayDelta = {
      pinChanges: [...this.pendingPinChanges.values()],
      nodeChanges: [...this.pendingNodeChanges.values()],
      componentChanges: [...this.pendingComponentChanges.values()],
      pinEdges: this.pinEdgeLog,
      pinEdgeOverflow: this.edgeOverflow,
    };
    this.pinEdgeLog = [];
    this.pendingPinChanges.clear();
    this.pendingNodeChanges.clear();
    this.pendingComponentChanges.clear();
    return delta;
  }

  /** Returns and clears newly raised/cleared diagnostics (full active snapshot on change). */
  takeDiagnostics(): CircuitDiagnostic[] {
    const transient = this.transientDiagnostics.splice(0, this.transientDiagnostics.length);
    if (!this.diagnosticsChanged && transient.length === 0) return [];
    this.diagnosticsChanged = false;
    return [...this.activeDiagnostics.values(), ...transient];
  }
}
