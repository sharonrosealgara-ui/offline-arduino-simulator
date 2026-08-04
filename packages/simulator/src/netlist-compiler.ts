/**
 * Pure, deterministic compiler from the persisted visual circuit model to the runtime
 * netlist the worker executes. Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §9.
 *
 * compileNetlist() must be a pure function: same input -> byte-identical output. Moving
 * a component or rerouting a wire without changing endpoints must NOT change
 * topologyHash (§9.4).
 */
import {
  SUPPORTED_CIRCUIT_SCHEMA_VERSIONS,
  type CircuitComponent,
  type CircuitJunction,
  type CircuitWire,
  type ProjectCircuit,
} from '@offline-arduino/contracts/circuit';
import type {
  BoardPinBinding,
  CircuitDiagnostic,
  RuntimeElement,
  RuntimeNet,
  RuntimeNetlist,
} from '@offline-arduino/contracts/simulator';
import { UNO_PIN_MAP, UNO_RAIL_5V, UNO_RAIL_3V3, UNO_RAIL_GND } from './board/uno';
import { getComponentDefinition, terminalKey } from './circuit-model/component-registry';
import { sha256Hex } from './util/sha256';

export const NETLIST_LIMITS = {
  maxComponents: 250,
  maxWires: 500,
  maxTerminals: 1500,
  maxJunctions: 250,
} as const;

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

  keys(): IterableIterator<string> {
    return this.parent.keys();
  }
}

interface Diagnostics {
  items: CircuitDiagnostic[];
  add(item: CircuitDiagnostic): void;
  hasFatal(): boolean;
}

function createDiagnostics(): Diagnostics {
  const items: CircuitDiagnostic[] = [];
  return {
    items,
    add(item) {
      items.push(item);
    },
    hasFatal() {
      return items.some((i) => i.severity === 'fatal');
    },
  };
}

/** Compiles a persisted visual circuit into a deterministic runtime netlist. */
export function compileNetlist(project: ProjectCircuit): RuntimeNetlist {
  const diagnostics = createDiagnostics();

  // ---- Phase A: normalize and validate ---------------------------------------------
  if (!SUPPORTED_CIRCUIT_SCHEMA_VERSIONS.includes(project.schemaVersion as 1 | 2)) {
    diagnostics.add(
      fatal(
        'SCHEMA_VERSION_UNSUPPORTED',
        `This circuit was saved by a newer version of the app (format ${String(project.schemaVersion)}). ` +
          `This version reads formats ${SUPPORTED_CIRCUIT_SCHEMA_VERSIONS.join(' and ')}.`,
      ),
    );
    return emptyResult(diagnostics.items);
  }

  const components = [...project.components].sort((a, b) => a.id.localeCompare(b.id));
  const wires = [...project.wires].sort((a, b) => a.id.localeCompare(b.id));
  const junctions = [...project.junctions].sort((a, b) => a.id.localeCompare(b.id));

  if (components.length > NETLIST_LIMITS.maxComponents) {
    diagnostics.add(fatal('TOO_MANY_COMPONENTS', `Circuit exceeds ${NETLIST_LIMITS.maxComponents} components.`));
  }
  if (wires.length > NETLIST_LIMITS.maxWires) {
    diagnostics.add(fatal('TOO_MANY_WIRES', `Circuit exceeds ${NETLIST_LIMITS.maxWires} wires.`));
  }
  if (junctions.length > NETLIST_LIMITS.maxJunctions) {
    diagnostics.add(fatal('TOO_MANY_JUNCTIONS', `Circuit exceeds ${NETLIST_LIMITS.maxJunctions} junctions.`));
  }

  const seenComponentIds = new Set<string>();
  const validComponents: CircuitComponent[] = [];
  for (const component of components) {
    if (seenComponentIds.has(component.id)) {
      diagnostics.add(fatal('DUPLICATE_COMPONENT_ID', `Duplicate component id: ${component.id}`, [component.id]));
      continue;
    }
    seenComponentIds.add(component.id);
    if (!Number.isFinite(component.x) || !Number.isFinite(component.y)) {
      diagnostics.add(fatal('INVALID_COMPONENT_COORDINATES', `Component ${component.id} has non-finite coordinates.`, [component.id]));
      continue;
    }
    if (![0, 90, 180, 270].includes(component.rotation)) {
      diagnostics.add(fatal('INVALID_ROTATION', `Component ${component.id} has an invalid rotation.`, [component.id]));
      continue;
    }
    const definition = getComponentDefinition(component.kind);
    if (!definition) {
      diagnostics.add(fatal('UNKNOWN_COMPONENT_KIND', `Unknown component kind: ${component.kind}`, [component.id]));
      continue;
    }
    validComponents.push(component);
  }

  const unoCount = validComponents.filter((c) => c.kind === 'uno-r3').length;
  if (unoCount !== 1) {
    diagnostics.add(
      fatal(
        'UNO_COUNT_INVALID',
        unoCount === 0
          ? 'The circuit needs exactly one Arduino Uno to run.'
          : 'The circuit has more than one Arduino Uno.',
      ),
    );
  }

  // Build the full terminal-key universe from the trusted component registry.
  const terminalUniverse = new Set<string>();
  const componentById = new Map(validComponents.map((c) => [c.id, c]));
  for (const component of validComponents) {
    const definition = getComponentDefinition(component.kind)!;
    for (const terminal of definition.terminals) {
      terminalUniverse.add(terminalKey(component.id, terminal.id));
    }
  }
  if (terminalUniverse.size > NETLIST_LIMITS.maxTerminals) {
    diagnostics.add(fatal('TOO_MANY_TERMINALS', `Circuit exceeds ${NETLIST_LIMITS.maxTerminals} terminals.`));
  }

  function isKnownTerminal(ref: { componentId: string; terminalId: string }): boolean {
    const component = componentById.get(ref.componentId);
    if (!component) return false;
    const definition = getComponentDefinition(component.kind);
    if (!definition) return false;
    return definition.terminals.some((t) => t.id === ref.terminalId);
  }

  const seenWireIds = new Set<string>();
  const seenWireSignatures = new Set<string>();
  const validWires: CircuitWire[] = [];
  for (const wire of wires) {
    if (seenWireIds.has(wire.id)) {
      diagnostics.add(fatal('DUPLICATE_WIRE_ID', `Duplicate wire id: ${wire.id}`));
      continue;
    }
    seenWireIds.add(wire.id);

    if (!isKnownTerminal(wire.from) || !isKnownTerminal(wire.to)) {
      diagnostics.add(
        error('DANGLING_WIRE_ENDPOINT', `Wire ${wire.id} references an unknown terminal.`, undefined, undefined, [wire.id]),
      );
      continue;
    }
    const fromKey = terminalKey(wire.from.componentId, wire.from.terminalId);
    const toKey = terminalKey(wire.to.componentId, wire.to.terminalId);
    if (fromKey === toKey) {
      diagnostics.add(error('SELF_LOOP_WIRE', `Wire ${wire.id} connects a terminal to itself.`, undefined, undefined, [wire.id]));
      continue;
    }
    const signature = [fromKey, toKey].sort().join('|');
    if (seenWireSignatures.has(signature)) {
      diagnostics.add(warning('DUPLICATE_WIRE', `Wire ${wire.id} duplicates an existing connection.`, undefined, undefined, [wire.id]));
      continue;
    }
    seenWireSignatures.add(signature);
    validWires.push(wire);
  }

  const seenJunctionIds = new Set<string>();
  const validJunctions: CircuitJunction[] = [];
  for (const junction of junctions) {
    if (seenJunctionIds.has(junction.id)) {
      diagnostics.add(fatal('DUPLICATE_JUNCTION_ID', `Duplicate junction id: ${junction.id}`));
      continue;
    }
    seenJunctionIds.add(junction.id);
    validJunctions.push(junction);
  }

  if (diagnostics.hasFatal()) {
    return emptyResult(diagnostics.items);
  }

  // ---- Phase B: connectivity via union-find -----------------------------------------
  const ds = new DisjointSet();
  for (const key of terminalUniverse) ds.make(key);

  for (const wire of validWires) {
    ds.union(terminalKey(wire.from.componentId, wire.from.terminalId), terminalKey(wire.to.componentId, wire.to.terminalId));
  }

  for (const junction of validJunctions) {
    const refs = junction.wireIds
      .map((wireId) => validWires.find((w) => w.id === wireId))
      .filter((w): w is CircuitWire => Boolean(w));
    const keys = refs.flatMap((w) => [
      terminalKey(w.from.componentId, w.from.terminalId),
      terminalKey(w.to.componentId, w.to.terminalId),
    ]);
    for (let i = 1; i < keys.length; i += 1) ds.union(keys[0], keys[i]);
  }

  // Permanently-common terminals declared by the trusted registry (e.g. the two pins
  // on each physical side of a four-leg pushbutton).
  for (const component of validComponents) {
    const definition = getComponentDefinition(component.kind)!;
    for (const group of definition.permanentlyCommonTerminals ?? []) {
      const keys = group.map((terminalId) => terminalKey(component.id, terminalId));
      for (let i = 1; i < keys.length; i += 1) ds.union(keys[0], keys[i]);
    }
  }

  // ---- Phase C: canonical nets --------------------------------------------------------
  const groups = new Map<string, string[]>();
  for (const key of ds.keys()) {
    const root = ds.find(key);
    const list = groups.get(root);
    if (list) list.push(key);
    else groups.set(root, [key]);
  }

  const netByRoot = new Map<string, RuntimeNet>();
  const netIdByTerminal = new Map<string, string>();

  const railTerminalsByComponent = new Map<string, { fiveV?: string; threeV3?: string; gnd?: string }>();
  for (const component of validComponents) {
    if (component.kind !== 'uno-r3') continue;
    railTerminalsByComponent.set(component.id, {
      fiveV: terminalKey(component.id, UNO_RAIL_5V),
      threeV3: terminalKey(component.id, UNO_RAIL_3V3),
      gnd: terminalKey(component.id, UNO_RAIL_GND),
    });
  }

  for (const [root, keys] of groups) {
    const sortedKeys = [...keys].sort();
    const netId = `n_${sha256Hex(sortedKeys.join('\n')).slice(0, 16)}`;
    let rail: RuntimeNet['rail'] | undefined;
    for (const rails of railTerminalsByComponent.values()) {
      if (rails.fiveV && sortedKeys.includes(rails.fiveV)) rail = mergeRail(rail, 'VCC_5V', netId, diagnostics);
      if (rails.threeV3 && sortedKeys.includes(rails.threeV3)) rail = mergeRail(rail, 'VCC_3V3', netId, diagnostics);
      if (rails.gnd && sortedKeys.includes(rails.gnd)) rail = mergeRail(rail, 'GND', netId, diagnostics);
    }
    const net: RuntimeNet = { id: netId, terminals: sortedKeys, rail };
    netByRoot.set(root, net);
    for (const key of sortedKeys) netIdByTerminal.set(key, netId);
  }

  const netById = new Map<string, RuntimeNet>();
  for (const net of netByRoot.values()) netById.set(net.id, net);

  // Wire color is a visual convention/validation hint only — it never creates or removes
  // connectivity. Flag a mismatch between a wire's color role and the net it landed on
  // (spec §8.2): a red wire on a non-power net, a black wire not on GND, or a
  // power/ground-colored wire used for an ordinary signal.
  for (const wire of validWires) {
    const netId = netIdByTerminal.get(terminalKey(wire.from.componentId, wire.from.terminalId));
    const rail = netId ? netById.get(netId)?.rail : undefined;
    const expectsPower = wire.colorRole === 'vcc-red';
    const expectsGround = wire.colorRole === 'ground-black';
    const isPowerRail = rail === 'VCC_5V' || rail === 'VCC_3V3';
    const isGroundRail = rail === 'GND';
    const mismatched =
      (expectsPower && !isPowerRail) ||
      (expectsGround && !isGroundRail) ||
      (!expectsPower && !expectsGround && (isPowerRail || isGroundRail));
    if (mismatched) {
      diagnostics.add({
        id: `WIRE_COLOR_CONVENTION:${wire.id}`,
        severity: 'warning',
        code: 'WIRE_COLOR_CONVENTION',
        message: 'Use red for power, black for ground, and a signal color for data.',
      });
    }
  }

  if (diagnostics.hasFatal()) {
    return emptyResult(diagnostics.items);
  }

  // ---- Phase D: stamp components and board bindings ----------------------------------
  const elements: RuntimeElement[] = [];
  const boardPins: BoardPinBinding[] = [];

  for (const component of validComponents) {
    const definition = getComponentDefinition(component.kind)!;
    const netFor = (terminalId: string): string => {
      const key = terminalKey(component.id, terminalId);
      const netId = netIdByTerminal.get(key);
      if (!netId) throw new Error(`Internal error: terminal ${key} has no net.`);
      return netId;
    };

    if (component.kind === 'uno-r3') {
      for (const pin of UNO_PIN_MAP) {
        boardPins.push({
          boardPin: pin.boardPin,
          netId: netFor(pin.boardPin),
          port: pin.port,
          bit: pin.bit,
          adcChannel: pin.adcChannel,
        });
      }
      continue;
    }

    const stamped = definition.stamp(component, netFor);
    if (stamped) elements.push(stamped);
  }

  elements.sort((a, b) => a.id.localeCompare(b.id));
  boardPins.sort((a, b) => a.boardPin.localeCompare(b.boardPin));
  const nets = [...netByRoot.values()].sort((a, b) => a.id.localeCompare(b.id));

  const topologyHash = sha256Hex(
    JSON.stringify({
      nets: nets.map((n) => ({ id: n.id, terminals: n.terminals, rail: n.rail })),
      boardPins,
      elements,
    }),
  );

  return {
    schemaVersion: 1,
    topologyHash,
    nets,
    boardPins,
    elements,
    diagnostics: diagnostics.items,
  };
}

function mergeRail(
  current: RuntimeNet['rail'] | undefined,
  incoming: NonNullable<RuntimeNet['rail']>,
  netId: string,
  diagnostics: Diagnostics,
): RuntimeNet['rail'] {
  if (!current) return incoming;
  if (current === incoming) return current;
  const isGndShort = (current === 'GND' && (incoming === 'VCC_5V' || incoming === 'VCC_3V3')) ||
    (incoming === 'GND' && (current === 'VCC_5V' || current === 'VCC_3V3'));
  if (isGndShort) {
    diagnostics.add(fatal('POWER_RAIL_SHORT', 'Disconnect the wire joining a power rail and GND.', undefined, [netId]));
  } else {
    diagnostics.add(fatal('INCOMPATIBLE_POWER_RAILS', 'Do not join the 5V and 3.3V pins.', undefined, [netId]));
  }
  return current;
}

function emptyResult(items: CircuitDiagnostic[]): RuntimeNetlist {
  return { schemaVersion: 1, topologyHash: sha256Hex('empty'), nets: [], boardPins: [], elements: [], diagnostics: items };
}

function fatal(code: string, message: string, componentIds?: string[], netIds?: string[]): CircuitDiagnostic {
  return { id: `${code}:${(componentIds ?? netIds ?? ['-']).join(',')}`, severity: 'fatal', code, message, componentIds, netIds };
}
function error(code: string, message: string, _a?: unknown, _b?: unknown, componentIds?: string[]): CircuitDiagnostic {
  return { id: `${code}:${(componentIds ?? ['-']).join(',')}`, severity: 'error', code, message, componentIds };
}
function warning(code: string, message: string, _a?: unknown, _b?: unknown, componentIds?: string[]): CircuitDiagnostic {
  return { id: `${code}:${(componentIds ?? ['-']).join(',')}`, severity: 'warning', code, message, componentIds };
}
