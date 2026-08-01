/**
 * The opaque volumes a wire must not pass through, derived from the board's own geometry.
 *
 * Bench clearance alone was not enough. It kept wires above the floor at −0.095 in while the
 * Uno stands on that floor: its PCB spans −0.0315 to +0.0315 and its headers reach +0.3515.
 * A wire crossing the board sagged to the bench-clearance height and went straight through
 * the board — measured on Blink's D13 route, 0.0575 in inside a PCB only 0.063 in thick. The
 * buried middle is why the wire read as two disconnected segments.
 *
 * Everything here is READ from uno-geometry.ts. Nothing is restated and nothing is modified:
 * if the board changes shape, these volumes follow.
 *
 * A note on units and meaning, because the two are easy to conflate: a volume's `top` is a
 * PHYSICAL SURFACE height. `requiredWireCentreYAt` returns a REQUIRED MINIMUM WIRE-CENTRE
 * height — the surface plus the tube's radius plus clearance. They are never interchangeable
 * and the names say which is which.
 */
import * as THREE from 'three';
import {
  ANALOG_PINS,
  BOARD_HALF_D,
  BOARD_HALF_W,
  CRYSTAL,
  DIGITAL_PINS,
  HEADER_BODY_HEIGHT,
  HEADER_PITCH,
  ICSP_MAIN,
  ICSP_USB,
  MCU,
  PCB_TOP,
  POWER_JACK,
  POWER_PINS,
  REGULATOR,
  RESET_BUTTON,
  USB_CONNECTOR,
} from './uno-geometry';
import { BENCH_SURFACE_Y } from './scene-layout';
import { WIRE_CLEARANCE_EPSILON, WIRE_MIN_CENTRE_Y, WIRE_RADIUS_SELECTED } from './wire-path';

/** An opaque box on the board, in the BOARD'S LOCAL frame, world inches. */
export interface ObstacleVolume {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Physical top surface height. NOT a wire height. */
  top: number;
}

function boxAround(
  id: string,
  centreX: number,
  centreZ: number,
  width: number,
  depth: number,
  top: number,
): ObstacleVolume {
  return {
    id,
    minX: centreX - width / 2,
    maxX: centreX + width / 2,
    minZ: centreZ - depth / 2,
    maxZ: centreZ + depth / 2,
    top,
  };
}

/** A header row's footprint, taken from the pins the board actually places. */
function headerVolume(id: string, pins: readonly { x: number; z: number }[]): ObstacleVolume {
  const xs = pins.map((p) => p.x);
  const zs = pins.map((p) => p.z);
  return {
    id,
    minX: Math.min(...xs) - HEADER_PITCH / 2,
    maxX: Math.max(...xs) + HEADER_PITCH / 2,
    minZ: Math.min(...zs) - HEADER_PITCH / 2,
    maxZ: Math.max(...zs) + HEADER_PITCH / 2,
    top: PCB_TOP + HEADER_BODY_HEIGHT,
  };
}

export const OBSTACLE_PCB = 'pcb';
export const OBSTACLE_HEADER_DIGITAL = 'header-digital';
export const OBSTACLE_HEADER_ANALOG = 'header-analog';
export const OBSTACLE_HEADER_POWER = 'header-power';

const VOLUMES: readonly ObstacleVolume[] = [
  boxAround(OBSTACLE_PCB, 0, 0, BOARD_HALF_W * 2, BOARD_HALF_D * 2, PCB_TOP),
  headerVolume(OBSTACLE_HEADER_DIGITAL, DIGITAL_PINS),
  headerVolume(OBSTACLE_HEADER_ANALOG, ANALOG_PINS),
  headerVolume(OBSTACLE_HEADER_POWER, POWER_PINS),
  boxAround('mcu', MCU.center[0], MCU.center[2], MCU.bodyWidth, MCU.bodyDepth, MCU.center[1] + MCU.bodyHeight / 2),
  boxAround(
    'usb',
    USB_CONNECTOR.center[0],
    USB_CONNECTOR.center[2],
    USB_CONNECTOR.size[0],
    USB_CONNECTOR.size[2],
    USB_CONNECTOR.center[1] + USB_CONNECTOR.size[1] / 2,
  ),
  boxAround(
    'power-jack',
    POWER_JACK.center[0],
    POWER_JACK.center[2],
    POWER_JACK.size[0],
    POWER_JACK.size[2],
    POWER_JACK.center[1] + POWER_JACK.size[1] / 2,
  ),
  boxAround('crystal', CRYSTAL.x, CRYSTAL.z, CRYSTAL.width, CRYSTAL.depth, PCB_TOP + CRYSTAL.height),
  boxAround('regulator', REGULATOR.x, REGULATOR.z, REGULATOR.width, REGULATOR.depth, PCB_TOP + REGULATOR.height),
  boxAround(
    'reset-button',
    RESET_BUTTON.x,
    RESET_BUTTON.z,
    RESET_BUTTON.size,
    RESET_BUTTON.size,
    PCB_TOP + RESET_BUTTON.height,
  ),
  // The two 2x3 ICSP headers, at the pitch the board builds them on.
  boxAround('icsp-main', ICSP_MAIN.centerX, ICSP_MAIN.centerZ, HEADER_PITCH * 3, HEADER_PITCH * 2, PCB_TOP + HEADER_BODY_HEIGHT),
  boxAround('icsp-usb', ICSP_USB.centerX, ICSP_USB.centerZ, HEADER_PITCH * 3, HEADER_PITCH * 2, PCB_TOP + HEADER_BODY_HEIGHT),
];

export function unoObstacleVolumes(): readonly ObstacleVolume[] {
  return VOLUMES;
}

/**
 * Which header a board pin lives in, or undefined for anything that is not a board pin.
 *
 * Used to exempt exactly the connector a wire legitimately plugs into — and nothing else.
 */
export function headerVolumeIdForPin(terminalId: string): string | undefined {
  if (DIGITAL_PINS.some((p) => p.id === terminalId)) return OBSTACLE_HEADER_DIGITAL;
  if (ANALOG_PINS.some((p) => p.id === terminalId)) return OBSTACLE_HEADER_ANALOG;
  if (POWER_PINS.some((p) => p.id === terminalId)) return OBSTACLE_HEADER_POWER;
  return undefined;
}

/** Where a board sits in the scene: the centre of its PCB, and how far it is turned. */
export interface UnoPlacement {
  x: number;
  z: number;
  rotationDegrees: number;
}

export const BOARD_AT_SCENE_ORIGIN: UnoPlacement = { x: 0, z: 0, rotationDegrees: 0 };

/**
 * A wire end that is allowed to start inside one specific connector.
 *
 * Deliberately narrow. A jumper plugged into the digital header genuinely occupies that
 * header, so refusing to allow it would make every board connection unroutable — but it
 * grants nothing against the PCB, and nothing against a header it is not plugged into.
 */
export interface AttachmentExemption {
  /** Scene position of the connected terminal. */
  point: THREE.Vector3;
  /** The one volume this end may begin inside. */
  volumeId: string;
}

/**
 * Extra reach beyond a connector's own footprint before the exemption lapses.
 *
 * One header body deep — the vertical distance a wire needs to rise out of the socket it is
 * plugged into.
 */
export const ATTACHMENT_ESCAPE_MARGIN = HEADER_BODY_HEIGHT;

/**
 * How far from its pin a wire may still count as being in its own connector.
 *
 * Bounded by that connector's own extent, not by a fixed number: a header row is 0.8 in long,
 * so a wire leaving a power pin is still over its own header a good way along it. A flat
 * one-header-height allowance cut the exemption off mid-connector and reported a wire as
 * colliding with the very socket it is plugged into.
 *
 * It stays bounded — the wire gets no licence once it is past its own connector — and it
 * stays specific to that one volume.
 */
export function attachmentExemptionDistance(volume: ObstacleVolume, pin: { x: number; z: number }): number {
  const corners = [
    [volume.minX, volume.minZ],
    [volume.maxX, volume.minZ],
    [volume.minX, volume.maxZ],
    [volume.maxX, volume.maxZ],
  ];
  const furthest = Math.max(...corners.map(([cx, cz]) => Math.hypot(cx - pin.x, cz - pin.z)));
  return furthest + ATTACHMENT_ESCAPE_MARGIN;
}

/** How far an obstacle's footprint grows so the tube's flank clears it, not just its centre. */
export const OBSTACLE_FOOTPRINT_INFLATION = WIRE_RADIUS_SELECTED + WIRE_CLEARANCE_EPSILON;

/** Turns a scene point into the board's local frame. */
function toBoardLocal(point: THREE.Vector3, placement: UnoPlacement): { x: number; z: number } {
  const dx = point.x - placement.x;
  const dz = point.z - placement.z;
  // Inverse of the board's own yaw.
  const radians = (placement.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos };
}

/**
 * The minimum WIRE-CENTRE height allowed at a scene point.
 *
 * Never a surface height: the tube's radius and the clearance epsilon are already included,
 * so a curve whose centreline sits at or above this value has its whole thickness clear.
 * Off the board this is the bench minimum, so a wire nowhere near the Uno is unaffected and
 * keeps its ordinary sag — the correction is local to the obstacle, not a blanket arch.
 */
export function requiredWireCentreYAt(
  point: THREE.Vector3,
  placement: UnoPlacement = BOARD_AT_SCENE_ORIGIN,
  exemptions: readonly AttachmentExemption[] = [],
): number {
  let required = WIRE_MIN_CENTRE_Y;
  const local = toBoardLocal(point, placement);

  for (const volume of VOLUMES) {
    if (
      local.x < volume.minX - OBSTACLE_FOOTPRINT_INFLATION ||
      local.x > volume.maxX + OBSTACLE_FOOTPRINT_INFLATION ||
      local.z < volume.minZ - OBSTACLE_FOOTPRINT_INFLATION ||
      local.z > volume.maxZ + OBSTACLE_FOOTPRINT_INFLATION
    ) {
      continue;
    }

    const exempt = exemptions.some((e) => {
      if (e.volumeId !== volume.id) return false;
      const pinLocal = toBoardLocal(e.point, placement);
      return point.distanceTo(e.point) <= attachmentExemptionDistance(volume, pinLocal);
    });
    if (exempt) continue;

    required = Math.max(required, volume.top + WIRE_RADIUS_SELECTED + WIRE_CLEARANCE_EPSILON);
  }

  return required;
}

/** The clearance rule for a wire near a board, ready to hand to `buildWireCurve`. */
export function unoWireClearance(
  placement: UnoPlacement = BOARD_AT_SCENE_ORIGIN,
  exemptions: readonly AttachmentExemption[] = [],
): { requiredCentreYAt(point: THREE.Vector3): number } {
  return { requiredCentreYAt: (point) => requiredWireCentreYAt(point, placement, exemptions) };
}

/** Exported for tests and diagnostics: the bench-only rule, with no board in play. */
export const BENCH_ONLY_CLEARANCE = { requiredCentreYAt: (): number => WIRE_MIN_CENTRE_Y };

export { BENCH_SURFACE_Y };
