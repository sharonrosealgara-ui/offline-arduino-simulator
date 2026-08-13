/**
 * Trusted component registry: terminal IDs, permanently-common terminal groups, and the
 * pure "stamp" function that turns a persisted CircuitComponent into a RuntimeElement.
 *
 * Terminal definitions live HERE, not in project files (spec §7). This registry is the
 * only place that may declare permanent internal connections (e.g. the two pins on each
 * physical side of a four-leg pushbutton, spec §9.2).
 */
import type { CircuitComponent, ComponentKind } from '@offline-arduino/contracts/circuit';
import type { RuntimeElement } from '@offline-arduino/contracts/simulator';
import {
  breadboardGroupMemberships,
  breadboardTerminalAnchors,
} from '@offline-arduino/contracts/breadboard';
import { UNO_PIN_MAP, UNO_RAIL_5V, UNO_RAIL_3V3, UNO_RAIL_GND } from '../board/uno';

export function terminalKey(componentId: string, terminalId: string): string {
  return `${componentId}:${terminalId}`;
}

export interface TerminalDefinition {
  id: string;
  label: string;
  /** Local anchor point in the component's own coordinate space, before rotation. */
  x: number;
  y: number;
  role: 'power' | 'ground' | 'signal' | 'passive';
}

export interface ComponentDefinition {
  kind: ComponentKind;
  terminals: TerminalDefinition[];
  /** Groups of terminal IDs that are always electrically identical (e.g. both button sides). */
  permanentlyCommonTerminals?: string[][];
  /** Produces the runtime element for this component, or null for board/non-electrical kinds. */
  stamp(component: CircuitComponent, netFor: (terminalId: string) => string): RuntimeElement | null;
}

function numberProp(component: CircuitComponent, key: string, fallback: number): number {
  const value = component.properties[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringProp(component: CircuitComponent, key: string, fallback: string): string {
  const value = component.properties[key];
  return typeof value === 'string' ? value : fallback;
}

const unoTerminals: TerminalDefinition[] = [
  ...UNO_PIN_MAP.map((pin, index) => ({
    id: pin.boardPin,
    label: pin.boardPin,
    x: index * 10,
    y: 0,
    role: 'signal' as const,
  })),
  { id: UNO_RAIL_5V, label: '5V', x: -10, y: 10, role: 'power' },
  { id: UNO_RAIL_3V3, label: '3.3V', x: -20, y: 10, role: 'power' },
  { id: UNO_RAIL_GND, label: 'GND', x: -30, y: 10, role: 'ground' },
];

const REGISTRY: Record<ComponentKind, ComponentDefinition> = {
  'uno-r3': {
    kind: 'uno-r3',
    terminals: unoTerminals,
    stamp: () => null, // The Uno is stamped as board bindings, not a RuntimeElement.
  },
  led: {
    kind: 'led',
    terminals: [
      { id: 'anode', label: 'Anode (+)', x: 0, y: 0, role: 'passive' },
      { id: 'cathode', label: 'Cathode (-)', x: 10, y: 0, role: 'passive' },
    ],
    stamp: (component, netFor) => ({
      kind: 'led',
      id: component.id,
      anode: netFor('anode'),
      cathode: netFor('cathode'),
      forwardV: numberProp(component, 'forwardV', 2.0),
      dynamicOhms: numberProp(component, 'dynamicOhms', 10),
      ratedMilliAmps: numberProp(component, 'ratedMilliAmps', 20),
      color: stringProp(component, 'color', 'red'),
    }),
  },
  resistor: {
    kind: 'resistor',
    // Anchor x/y are where the leads are DRAWN; they carry no electrical meaning and the
    // netlist never reads them. A 0.4in (40 unit) span is the formed lead spacing a
    // 6.3mm CFR-25 body actually sits on — at 10 units the anchors were under the body.
    terminals: [
      { id: 'a', label: 'Terminal A', x: 0, y: 0, role: 'passive' },
      { id: 'b', label: 'Terminal B', x: 40, y: 0, role: 'passive' },
    ],
    stamp: (component, netFor) => ({
      kind: 'resistor',
      id: component.id,
      a: netFor('a'),
      b: netFor('b'),
      ohms: numberProp(component, 'ohms', 220),
    }),
  },
  pushbutton: {
    kind: 'pushbutton',
    // Omron B3F-1000 PCB pattern: 4.5mm between the legs on one side, 6.5mm between the
    // two sides. At a 10x10 unit square all four legs sat inside a 6mm body.
    terminals: [
      { id: 'a1', label: 'Leg A1', x: 0, y: 0, role: 'passive' },
      { id: 'a2', label: 'Leg A2', x: 18, y: 0, role: 'passive' },
      { id: 'b1', label: 'Leg B1', x: 0, y: 26, role: 'passive' },
      { id: 'b2', label: 'Leg B2', x: 18, y: 26, role: 'passive' },
    ],
    // The two legs on each physical side are permanently common (spec §11.2).
    permanentlyCommonTerminals: [
      ['a1', 'a2'],
      ['b1', 'b2'],
    ],
    stamp: (component, netFor) => ({
      kind: 'switch',
      id: component.id,
      a: netFor('a1'),
      b: netFor('b1'),
      controlId: component.id,
      closedOhms: 1,
    }),
  },
  potentiometer: {
    kind: 'potentiometer',
    // Bourns 3386P: three terminals in line on a 2.54mm grid, the wiper in the middle.
    // The old schematic triangle put the wiper 2.54mm off the line, where no rigid body
    // has a pin.
    terminals: [
      { id: 'a', label: 'Terminal A', x: 0, y: 0, role: 'passive' },
      { id: 'wiper', label: 'Wiper', x: 10, y: 0, role: 'signal' },
      { id: 'b', label: 'Terminal B', x: 20, y: 0, role: 'passive' },
    ],
    stamp: (component, netFor) => ({
      kind: 'potentiometer',
      id: component.id,
      a: netFor('a'),
      wiper: netFor('wiper'),
      b: netFor('b'),
      ohms: numberProp(component, 'ohms', 10_000),
      minimumOhms: numberProp(component, 'minimumOhms', 1),
      controlId: component.id,
      initialPosition: numberProp(component, 'initialPosition', 0.5),
    }),
  },
  lcd1602: {
    kind: 'lcd1602',
    terminals: [
      { id: 'VSS', label: 'VSS', x: 0, y: 0, role: 'ground' },
      { id: 'VDD', label: 'VDD', x: 10, y: 0, role: 'power' },
      { id: 'VO', label: 'VO', x: 20, y: 0, role: 'passive' },
      { id: 'RS', label: 'RS', x: 30, y: 0, role: 'signal' },
      { id: 'RW', label: 'RW', x: 40, y: 0, role: 'signal' },
      { id: 'E', label: 'E', x: 50, y: 0, role: 'signal' },
      { id: 'D0', label: 'D0', x: 60, y: 0, role: 'signal' },
      { id: 'D1', label: 'D1', x: 70, y: 0, role: 'signal' },
      { id: 'D2', label: 'D2', x: 80, y: 0, role: 'signal' },
      { id: 'D3', label: 'D3', x: 90, y: 0, role: 'signal' },
      { id: 'D4', label: 'D4', x: 100, y: 0, role: 'signal' },
      { id: 'D5', label: 'D5', x: 110, y: 0, role: 'signal' },
      { id: 'D6', label: 'D6', x: 120, y: 0, role: 'signal' },
      { id: 'D7', label: 'D7', x: 130, y: 0, role: 'signal' },
      { id: 'A', label: 'Backlight A', x: 140, y: 0, role: 'power' },
      { id: 'K', label: 'Backlight K', x: 150, y: 0, role: 'ground' },
    ],
    stamp: (component, netFor) => {
      const pins: Record<string, string> = {};
      for (const terminal of REGISTRY.lcd1602.terminals) {
        pins[terminal.id] = netFor(terminal.id);
      }
      return { kind: 'lcd1602', id: component.id, pins };
    },
  },
  servo: {
    kind: 'servo',
    terminals: [
      { id: 'vcc', label: 'VCC', x: 0, y: 0, role: 'power' },
      { id: 'gnd', label: 'GND', x: 10, y: 0, role: 'ground' },
      { id: 'signal', label: 'Signal', x: 20, y: 0, role: 'signal' },
    ],
    stamp: (component, netFor) => ({
      kind: 'servo',
      id: component.id,
      vcc: netFor('vcc'),
      ground: netFor('gnd'),
      signal: netFor('signal'),
      minPulseMicros: numberProp(component, 'minPulseMicros', 1000),
      maxPulseMicros: numberProp(component, 'maxPulseMicros', 2000),
      minAngle: numberProp(component, 'minAngle', 0),
      maxAngle: numberProp(component, 'maxAngle', 180),
    }),
  },
  /**
   * A generic 400 tie-point breadboard.
   *
   * Every terminal and every group is READ from the canonical model in
   * `@offline-arduino/contracts/breadboard`. Nothing here restates a coordinate, a hole id
   * or a rail membership — a second copy of a 400-entry table is a second copy that can
   * drift, and the drift would be invisible until a student's circuit behaved differently
   * from the board they can see.
   *
   * `stamp` returns null: a breadboard adds no element to the solver. It is pure
   * connectivity, and the connectivity is entirely expressed by the permanently-common
   * groups the compiler already unions. Every group is kept even when nothing is plugged
   * into it, because pruning would change the topology hash for a cosmetic saving.
   */
  breadboard: {
    kind: 'breadboard',
    terminals: breadboardTerminalAnchors().map((anchor) => ({
      id: anchor.id,
      label: anchor.id,
      x: anchor.x,
      y: anchor.y,
      role: 'passive' as const,
    })),
    permanentlyCommonTerminals: breadboardGroupMemberships(),
    stamp: () => null,
  },
};

export function getComponentDefinition(kind: ComponentKind): ComponentDefinition | undefined {
  return REGISTRY[kind];
}

export function listComponentKinds(): ComponentKind[] {
  return Object.keys(REGISTRY) as ComponentKind[];
}
