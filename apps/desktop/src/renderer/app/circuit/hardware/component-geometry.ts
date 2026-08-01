/**
 * The one place a component's physical size is written down.
 *
 * Every dimension here is in **millimetres**, sourced from the manufacturer references
 * recorded in vendor/licenses/app-3d-assets/COMPONENT_FOOTPRINTS.md. The 3D meshes, the 2D
 * glyphs, the catalog thumbnails, the selection bounds and the label placement are all
 * *derived* from this — none of them stores a size of its own. Before this module those
 * were three independent sets of numbers that had drifted apart: a 2D LED the same size as
 * a 2D servo, a 3D LCD a third of its real width, and thumbnails unrelated to either.
 *
 * WHAT THIS MODULE MUST NEVER CONTAIN
 * -----------------------------------
 * Terminal anchor coordinates. `component-registry.ts` in the simulator package is the sole
 * authority for terminal identity, anchor x/y, role and grouping. Conductors here are keyed
 * by terminal id and carry only *shape* — radius, exit style, colour role. Every conductor
 * endpoint is derived from the registry anchor through the canonical transform; a second
 * coordinate source, however convenient, is how the drawing and the wiring drift apart.
 *
 * The body is positioned *relative to* the anchors, not the other way round.
 */
import type { ComponentKind } from '@offline-arduino/contracts/circuit';
import type { WireColorRole } from '@offline-arduino/contracts/circuit';

/** A physical body, in millimetres. The single source for every derived bound. */
export interface PhysicalBody {
  /** Along the component's local X. */
  width: number;
  /** Along the component's local Y in schematic space / local Z in the 3D scene. */
  depth: number;
  /** Vertical, in the 3D scene only. */
  height: number;
}

/**
 * How a terminal's conductor is drawn. Shape only — never a position.
 *
 * `exit` says where the conductor meets the body:
 *  - 'down'    a lead or leg dropping from the underside (LED, resistor, button, trimmer)
 *  - 'pigtail' a flying lead leaving a side face (servo)
 */
export interface ConductorStyle {
  /** Conductor radius in mm. Square leads are drawn round at their half-width. */
  radius: number;
  exit: 'down' | 'pigtail';
  /** Fixed colour for parts whose leads are colour-coded in the real world. */
  colorRole?: WireColorRole;
}

export interface ComponentPhysical {
  kind: ComponentKind;
  /** THE body size. Nothing else may restate it. */
  body: PhysicalBody;
  /**
   * Where the body sits relative to the TERMINAL GROUP CENTROID, in mm.
   *
   * Deliberately a displacement from the centroid rather than an absolute position: an
   * absolute one would encode where the anchors are, which is the registry's business and
   * would quietly become a second copy of it. Expressed this way the body follows its own
   * pins when B6 moves them.
   *
   * `null` means no displacement — the body centres on its terminals, which is right for
   * every part whose pins are under it. The LCD is the exception: its header runs along one
   * edge, so the board is displaced back from the pin row.
   */
  bodyOffset: { x: number; z: number } | null;
  /**
   * Gap between the bench and the body's underside, mm — the length of leg the part stands
   * on. Conductors span it, which is what makes a pin or lead visible between the wire and
   * the part rather than the two meeting at a hidden point.
   */
  standoff: number;
  /** Named landmarks, mm. Purely for drawing detail; never a substitute for `body`. */
  features: Readonly<Record<string, number>>;
  /** Keyed by registry terminal id. */
  conductors: Readonly<Record<string, ConductorStyle>>;
  /** Selection may add padding and enforce a minimum, but never restates the body size. */
  selection: { paddingMm: number; minSizeMm: number };
  /** Distance from the footprint edge to the label baseline, mm. */
  label: { gapMm: number };
}

const LEAD = (radius: number): ConductorStyle => ({ radius, exit: 'down' });

/**
 * Kingbright WP7113ID. Lens ⌀5.0, flange ⌀5.9 × 1.0, package length 8.6, lead pitch 2.54,
 * 0.5 mm square leads drawn round at 0.25 radius.
 */
const LED: ComponentPhysical = {
  kind: 'led',
  body: { width: 5.0, depth: 5.0, height: 8.6 },
  bodyOffset: null,
  standoff: 3.0,
  features: { lensDiameter: 5.0, flangeDiameter: 5.9, flangeThickness: 1.0, domeRadius: 2.5 },
  conductors: { anode: LEAD(0.25), cathode: LEAD(0.25) },
  selection: { paddingMm: 1.5, minSizeMm: 6.0 },
  label: { gapMm: 1.6 },
};

/** Yageo CFR-25. Body 6.3 × ⌀2.4, leads ⌀0.55, formed to a 0.4 in span (project convention). */
const RESISTOR: ComponentPhysical = {
  kind: 'resistor',
  body: { width: 6.3, depth: 2.4, height: 2.4 },
  bodyOffset: null,
  standoff: 1.6,
  features: { bodyDiameter: 2.4, bandWidth: 0.6, formedSpan: 10.16 },
  conductors: { a: LEAD(0.275), b: LEAD(0.275) },
  selection: { paddingMm: 1.5, minSizeMm: 6.0 },
  label: { gapMm: 1.6 },
};

/** Omron B3F-1000. Body 6 × 6 × 4.3, plunger ⌀3.5, legs on the 6.5 × 4.5 hole pattern. */
const PUSHBUTTON: ComponentPhysical = {
  kind: 'pushbutton',
  body: { width: 6.0, depth: 6.0, height: 4.3 },
  bodyOffset: null,
  standoff: 3.0,
  features: { plungerDiameter: 3.5, plungerProjection: 0.8, legWidth: 0.5 },
  conductors: { a1: LEAD(0.25), a2: LEAD(0.25), b1: LEAD(0.25), b2: LEAD(0.25) },
  selection: { paddingMm: 1.5, minSizeMm: 7.0 },
  label: { gapMm: 1.6 },
};

/** Bourns 3386P-1-103LF. 9.53 mm square top-adjust trimmer, terminals ⌀0.51 on a 2.54 grid. */
const POTENTIOMETER: ComponentPhysical = {
  kind: 'potentiometer',
  body: { width: 9.53, depth: 9.53, height: 4.8 },
  bodyOffset: null,
  standoff: 3.0,
  features: { screwDiameter: 3.0, screwSlotWidth: 0.8, screwInset: 1.6 },
  conductors: { a: LEAD(0.255), wiper: LEAD(0.255), b: LEAD(0.255) },
  selection: { paddingMm: 1.5, minSizeMm: 10.0 },
  label: { gapMm: 1.8 },
};

/**
 * TowerPro SG90: 23 × 12.2 × 29 overall.
 *
 * The three terminals are a flying JR lead, not pins in the case, so their conductors exit
 * a side face as a pigtail. Colours are the JR convention and are keyed by terminal id —
 * brown to ground, red to VCC, orange to signal — never by array position.
 */
const SERVO: ComponentPhysical = {
  kind: 'servo',
  body: { width: 23.0, depth: 12.2, height: 29.0 },
  // The plug is on the end of a cable, so the case sits back from the terminal group.
  bodyOffset: { x: 0, z: -14.0 },
  standoff: 0,
  features: {
    tabSpan: 32.3,
    tabThickness: 2.5,
    caseHeight: 22.5,
    hornDiameter: 6.0,
    hornArmLength: 16.0,
    connectorWidth: 7.9,
    connectorDepth: 5.0,
    connectorHeight: 3.4,
  },
  conductors: {
    vcc: { radius: 0.6, exit: 'pigtail', colorRole: 'vcc-red' },
    gnd: { radius: 0.6, exit: 'pigtail', colorRole: 'ground-black' },
    signal: { radius: 0.6, exit: 'pigtail', colorRole: 'signal-orange' },
  },
  selection: { paddingMm: 2.0, minSizeMm: 14.0 },
  label: { gapMm: 2.0 },
};

/**
 * Newhaven NHD-0216K1Z-FL-YBW, mechanical drawing Rev 1A (2022-11-09).
 * PCB 80.0 × 36.0, bezel 71.2 × 25.2, viewing area 66.0 × 16.0, 1×16 header at 2.54.
 */
const LCD1602: ComponentPhysical = {
  kind: 'lcd1602',
  body: { width: 80.0, depth: 36.0, height: 1.6 },
  // Header along the top edge, inset from it: 36/2 - 2.0.
  bodyOffset: { x: 0, z: 16.0 },
  // The module stands on its 16-way header, as it does in a breadboard.
  standoff: 8.5,
  features: {
    bezelWidth: 71.2,
    bezelDepth: 25.2,
    viewWidth: 66.0,
    viewDepth: 16.0,
    bezelHeight: 7.9,
    headerInset: 2.0,
  },
  conductors: Object.fromEntries(
    ['VSS', 'VDD', 'VO', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'].map(
      (id) => [id, LEAD(0.32)],
    ),
  ),
  selection: { paddingMm: 2.0, minSizeMm: 20.0 },
  label: { gapMm: 2.4 },
};

/** The Uno's geometry lives in uno-geometry.ts and is deliberately not restated here. */
const PHYSICAL: Partial<Record<ComponentKind, ComponentPhysical>> = {
  led: LED,
  resistor: RESISTOR,
  pushbutton: PUSHBUTTON,
  potentiometer: POTENTIOMETER,
  servo: SERVO,
  lcd1602: LCD1602,
};

export function componentPhysical(kind: ComponentKind): ComponentPhysical | undefined {
  return PHYSICAL[kind];
}

export function physicalKinds(): ComponentKind[] {
  return Object.keys(PHYSICAL) as ComponentKind[];
}
