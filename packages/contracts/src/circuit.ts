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

/**
 * v3 adds no kinds. Its only difference from v2 is `terminalAttachments`.
 *
 * Frozen separately anyway, following the same rule as V1 and V2: a version's kind list is
 * fixed at the moment that version ships, so a later addition to one list cannot silently
 * change what an older reader accepts.
 */
export const PROJECT_KINDS_V3 = [...PROJECT_KINDS_V2] as const;

/**
 * Project-circuit schema versions this application can COMPILE.
 *
 * Deliberately still 1 and 2, and the reason is no longer the one first written here.
 *
 * Four capabilities have to be distinguished, because three of them now exist and the fourth
 * is what this constant is really waiting for:
 *
 *  - the SHAPE is defined: `TerminalAttachment` and `componentSchemaV3` describe an
 *    attachment and validate its structure (see project-schema.ts);
 *  - VALIDITY is decided: `validateBreadboardAttachments` answers whether a given attachment
 *    is referentially and physically legal;
 *  - ELECTRICAL MEANING exists: the netlist compiler unions valid attachments into nets and
 *    reports invalid ones as diagnostics. The earlier note here saying the compiler "does not
 *    yet understand attachments" was true when written and is not any more;
 *  - ACTIVATION does not: no path authors an attachment, the project reader and writer, the
 *    IPC DTO and the save path all still speak v2 only, and a v2 write would silently strip
 *    the field.
 *
 * So admitting 3 here would not claim a missing electrical capability — it would invite a
 * file this build can compile but cannot load, author or save without losing data. The
 * constant moves when the whole activation boundary is implemented and validated together,
 * not when one more layer of it is ready. See BREADBOARD_C5_ROADMAP.md.
 */
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

/**
 * One of this component's terminals, plugged into one breadboard hole.
 *
 * A jumper wire already reaches a hole by naming it as a `TerminalRef` endpoint. This is the
 * other way a hole gets a conductor: the part's own lead sits in it, with no wire involved.
 *
 * `kind` is a discriminant rather than decoration. A lead can only enter a hole today, but
 * screw terminals and header sockets are the same relationship to a different receptacle, and
 * a reader that meets one must be able to refuse it by name rather than misread it.
 *
 * Deliberately records identity only — which board, which hole. Where the lead is drawn,
 * whether the hole is free, whether the spacing is physically possible and what the netlist
 * should do about it are all separate questions, answered by later checkpoints. Storing a
 * position here would be storing derived state, which project files do not do.
 */
export interface TerminalAttachment {
  kind: 'breadboard-hole';
  breadboardId: string;
  holeId: string;
}

export interface CircuitComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  label: string;
  properties: Record<string, string | number | boolean>;
  /**
   * Terminal id -> the hole that terminal is plugged into. Absent when nothing is plugged in,
   * which is every project that exists today.
   *
   * Optional rather than defaulted to `{}`: an empty record and a missing field would mean the
   * same thing, and writing one into every migrated project would be fabricating data.
   *
   * Persisted only from project schemaVersion 3. The v1 and v2 readers do not carry it.
   */
  terminalAttachments?: Record<string, TerminalAttachment>;
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
  /**
   * 1 for legacy files; 2 once a breadboard can be present; 3 once a terminal can be plugged
   * into a hole. 1 and 2 are read and compiled. 3 is a shape the type system can express and
   * the schema can validate, but no build writes one yet and the compiler still refuses it —
   * see SUPPORTED_CIRCUIT_SCHEMA_VERSIONS.
   */
  schemaVersion: 1 | 2 | 3;
  components: CircuitComponent[];
  wires: CircuitWire[];
  junctions: CircuitJunction[];
}
