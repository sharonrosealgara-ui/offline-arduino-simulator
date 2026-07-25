/**
 * Persistent visual circuit model. The renderer persists user INTENT, not derived
 * solver state. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §7.
 *
 * Terminal definitions live in a trusted component registry (see the renderer/worker
 * `circuit-model`), NOT in project files. Project files never persist registers,
 * runtime voltages, frames, compiled HEX, LCD transient state, or terminal output.
 */

export type ComponentKind =
  | 'uno-r3'
  | 'led'
  | 'resistor'
  | 'pushbutton'
  | 'potentiometer'
  | 'lcd1602'
  | 'servo';

export interface Point {
  x: number;
  y: number;
}

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

export type WireColorRole =
  | 'vcc-red'
  | 'ground-black'
  | 'signal-yellow'
  | 'signal-blue'
  | 'signal-green'
  | 'signal-orange'
  | 'signal-purple';

export interface CircuitWire {
  id: string;
  from: TerminalRef;
  to: TerminalRef;
  colorRole: WireColorRole;
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
