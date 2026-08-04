/**
 * Persistent visual circuit model. The renderer persists user INTENT, not derived
 * solver state. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §7.
 *
 * Terminal definitions live in a trusted component registry (see the renderer/worker
 * `circuit-model`), NOT in project files. Project files never persist registers,
 * runtime voltages, frames, compiled HEX, LCD transient state, or terminal output.
 */

/**
 * Kinds a circuit may contain.
 *
 * `breadboard` is persistable only from project schemaVersion 2 onward; the v1 reader in
 * `project-schema.ts` still rejects it, which is what makes the version bump honest rather
 * than decorative. See PROJECT_KINDS_V1 / PROJECT_KINDS_V2 below.
 */
export type ComponentKind =
  | 'uno-r3'
  | 'led'
  | 'resistor'
  | 'pushbutton'
  | 'potentiometer'
  | 'lcd1602'
  | 'servo'
  | 'breadboard';

/** Exactly what a schemaVersion 1 project file may contain. Frozen: v1 files never change. */
export const PROJECT_KINDS_V1 = [
  'uno-r3',
  'led',
  'resistor',
  'pushbutton',
  'potentiometer',
  'lcd1602',
  'servo',
] as const;

/** The v1 set plus `breadboard` — the only difference the version bump introduces. */
export const PROJECT_KINDS_V2 = [...PROJECT_KINDS_V1, 'breadboard'] as const;

/** Project-circuit schema versions this application understands. */
export const SUPPORTED_CIRCUIT_SCHEMA_VERSIONS = [1, 2] as const;
export const CURRENT_CIRCUIT_SCHEMA_VERSION = 2;

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
  /** 1 for legacy files; 2 once a breadboard can be present. Both are read. */
  schemaVersion: 1 | 2;
  components: CircuitComponent[];
  wires: CircuitWire[];
  junctions: CircuitJunction[];
}
