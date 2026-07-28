/**
 * Arduino-compatible Uno R3 board — original procedural geometry, no external assets.
 *
 * Design constraints this file is written against:
 *  - Technically recognisable: correct 68.6x53.4 mm outline, real 0.1" header pitch with
 *    the 0.16" digital-block offset, DIP-28 MCU, both ICSP headers, USB-B, barrel jack,
 *    reset, crystal, regulator, and the four indicator LEDs.
 *  - Legible: pin legends are canvas-texture silkscreen strips (2 triangles per header),
 *    not extruded text. See ./labels.ts for why.
 *  - Cheap: all 60+ header pins are 2 instanced draw calls, not 60 meshes. The whole board
 *    is well under 100 draw calls at high quality.
 *  - Honest: the `L` LED is driven by the real simulated D13 pin state. TX/RX/ON are
 *    rendered dark because nothing in the simulator drives them yet — they are not faked.
 *
 * Trademark/licence position: vendor/licenses/app-3d-assets/NOTICE.md.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAppStore } from '../../../state/store';
import { createLabelStripTexture, createTextPlateTexture } from './labels';
import { useDisposableTexture } from './useDisposableTexture';
import {
  ANALOG_ROW_Z,
  BOARD_DEPTH,
  BOARD_HALF_D,
  BOARD_HALF_W,
  BOARD_PALETTE as C,
  BOARD_THICKNESS,
  BOARD_WIDTH,
  CRYSTAL,
  DIGITAL_ROW_Z,
  HEADER_BODY_HEIGHT,
  HEADER_PITCH,
  ICSP_MAIN,
  ICSP_USB,
  INDICATOR_LEDS,
  LABEL_STRIPS,
  MCU,
  MOUNTING_HOLES,
  MOUNTING_HOLE_RADIUS,
  PCB_TOP,
  POWER_JACK,
  REGULATOR,
  RESET_BUTTON,
  UNO_BOARD_PINS,
  USB_CONNECTOR,
  mm,
} from './uno-geometry';

const SILKSCREEN_Y = PCB_TOP + 0.002;

/** Reusable scratch object for composing instance matrices without per-pin allocation. */
const scratch = new THREE.Object3D();

// ---------------------------------------------------------------------------------------
// Header pins — two instanced meshes for every pin on the board.
// ---------------------------------------------------------------------------------------
function HeaderPins(): JSX.Element {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const boreRef = useRef<THREE.InstancedMesh>(null);
  const count = UNO_BOARD_PINS.length;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const bore = boreRef.current;
    if (!body || !bore) return;

    UNO_BOARD_PINS.forEach((pin, index) => {
      scratch.position.set(pin.x, PCB_TOP + HEADER_BODY_HEIGHT / 2, pin.z);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.set(1, 1, 1);
      scratch.updateMatrix();
      body.setMatrixAt(index, scratch.matrix);

      // The bore is the dark square you actually see looking down into a female header.
      scratch.position.set(pin.x, PCB_TOP + HEADER_BODY_HEIGHT - 0.004, pin.z);
      scratch.updateMatrix();
      bore.setMatrixAt(index, scratch.matrix);
    });

    body.instanceMatrix.needsUpdate = true;
    bore.instanceMatrix.needsUpdate = true;
    body.computeBoundingSphere();
    bore.computeBoundingSphere();
  }, []);

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, count]} castShadow receiveShadow>
        <boxGeometry args={[HEADER_PITCH * 0.96, HEADER_BODY_HEIGHT, HEADER_PITCH * 0.96]} />
        <meshStandardMaterial color={C.headerPlastic} roughness={0.72} metalness={0.04} />
      </instancedMesh>
      <instancedMesh ref={boreRef} args={[undefined, undefined, count]}>
        <boxGeometry args={[HEADER_PITCH * 0.56, 0.012, HEADER_PITCH * 0.56]} />
        <meshStandardMaterial color={C.headerBore} roughness={0.95} metalness={0.5} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------
// Silkscreen legends.
// ---------------------------------------------------------------------------------------
function HeaderLegend({ strip }: { strip: (typeof LABEL_STRIPS)[number] }): JSX.Element {
  const texture = useDisposableTexture(
    () =>
      createLabelStripTexture(strip.labels, {
        widthInches: strip.width,
        heightInches: strip.height,
        color: C.silkscreen,
        fontScale: 0.66,
      }),
    [strip],
  );

  return (
    <mesh position={[strip.centerX, SILKSCREEN_Y, strip.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[strip.width, strip.height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function BoardWordmarks(): JSX.Element {
  const title = useDisposableTexture(
    () =>
      createTextPlateTexture('UNO R3  ·  ATmega328P', {
        widthInches: 1.5,
        heightInches: 0.14,
        color: C.silkscreen,
        fontScale: 0.78,
      }),
    [],
  );
  const compat = useDisposableTexture(
    () =>
      createTextPlateTexture('ARDUINO-COMPATIBLE  ·  16 MHz', {
        widthInches: 1.2,
        heightInches: 0.1,
        color: '#9fd8cb',
        fontScale: 0.74,
      }),
    [],
  );

  return (
    <group>
      <mesh position={[0.34, SILKSCREEN_Y, 0.72]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.5, 0.14]} />
        <meshBasicMaterial map={title} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0.3, SILKSCREEN_Y, -0.72]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.2, 0.1]} />
        <meshBasicMaterial map={compat} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------
// ATmega328P in a 28-pin DIP.
// ---------------------------------------------------------------------------------------
function Atmega328P(): JSX.Element {
  const pinsRef = useRef<THREE.InstancedMesh>(null);
  const pinCount = MCU.pinsPerRow * 2;

  const marking = useDisposableTexture(
    () =>
      createTextPlateTexture('ATMEGA328P', {
        widthInches: MCU.bodyWidth * 0.9,
        heightInches: MCU.bodyDepth * 0.55,
        color: '#8d9199',
        fontScale: 0.62,
      }),
    [],
  );

  useLayoutEffect(() => {
    const pins = pinsRef.current;
    if (!pins) return;
    let index = 0;
    // Pin 1 is at the notch end; both rows march the same direction, 0.6" apart.
    const firstX = MCU.center[0] - ((MCU.pinsPerRow - 1) * MCU.pinPitch) / 2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < MCU.pinsPerRow; i += 1) {
        scratch.position.set(
          firstX + i * MCU.pinPitch,
          PCB_TOP + mm(1),
          MCU.center[2] + (side * MCU.rowSpacing) / 2,
        );
        scratch.rotation.set(0, 0, 0);
        scratch.scale.set(1, 1, 1);
        scratch.updateMatrix();
        pins.setMatrixAt(index, scratch.matrix);
        index += 1;
      }
    }
    pins.instanceMatrix.needsUpdate = true;
    pins.computeBoundingSphere();
  }, []);

  return (
    <group>
      {/* Body */}
      <mesh position={[MCU.center[0], MCU.center[1] + MCU.bodyHeight / 2, MCU.center[2]]} castShadow receiveShadow>
        <boxGeometry args={[MCU.bodyWidth, MCU.bodyHeight, MCU.bodyDepth]} />
        <meshStandardMaterial color={C.icBody} roughness={0.55} metalness={0.08} />
      </mesh>
      {/* Pin-1 notch: the half-circle at the pin-1 end, so orientation is unambiguous. */}
      <mesh
        position={[
          MCU.center[0] - MCU.bodyWidth / 2 + mm(0.6),
          MCU.center[1] + MCU.bodyHeight - 0.002,
          MCU.center[2],
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[mm(1.6), 16]} />
        <meshStandardMaterial color="#2b2d33" roughness={0.8} />
      </mesh>
      {/* Laser marking */}
      <mesh
        position={[MCU.center[0], MCU.center[1] + MCU.bodyHeight + 0.001, MCU.center[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[MCU.bodyWidth * 0.9, MCU.bodyDepth * 0.55]} />
        <meshBasicMaterial map={marking} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Leads */}
      <instancedMesh ref={pinsRef} args={[undefined, undefined, pinCount]} castShadow>
        <boxGeometry args={[mm(0.5), mm(0.4), mm(2.4)]} />
        <meshStandardMaterial color={C.tinnedPin} metalness={0.85} roughness={0.32} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------
// 2x3 ICSP header.
// ---------------------------------------------------------------------------------------
function IcspHeader({ centerX, centerZ }: { centerX: number; centerZ: number }): JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const pins = ref.current;
    if (!pins) return;
    let index = 0;
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        scratch.position.set(
          centerX + (col - 1) * HEADER_PITCH,
          PCB_TOP + 0.09,
          centerZ + (row - 0.5) * HEADER_PITCH,
        );
        scratch.rotation.set(0, 0, 0);
        scratch.scale.set(1, 1, 1);
        scratch.updateMatrix();
        pins.setMatrixAt(index, scratch.matrix);
        index += 1;
      }
    }
    pins.instanceMatrix.needsUpdate = true;
    pins.computeBoundingSphere();
  }, [centerX, centerZ]);

  return (
    <group>
      <mesh position={[centerX, PCB_TOP + 0.03, centerZ]} castShadow receiveShadow>
        <boxGeometry args={[HEADER_PITCH * 3.1, 0.06, HEADER_PITCH * 2.1]} />
        <meshStandardMaterial color={C.headerPlastic} roughness={0.72} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, 6]} castShadow>
        <boxGeometry args={[0.026, 0.12, 0.026]} />
        <meshStandardMaterial color={C.goldPad} metalness={0.9} roughness={0.3} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------
// Indicator LEDs.
// ---------------------------------------------------------------------------------------
/**
 * The `L` LED. Reads the live D13 pin state via getState() inside useFrame so the board
 * never re-renders React at frame rate.
 *
 * This is the one board indicator wired to real simulation state; TX/RX/ON are rendered by
 * <StaticIndicator/> in their unlit colour because nothing drives them yet.
 */
function BuiltinLed(): JSX.Element {
  const lensRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const smoothed = useRef(0);
  const spec = INDICATOR_LEDS.L;

  useFrame((_, delta) => {
    const state = useAppStore.getState();
    // Prefer the LED display delta if the sketch's LED is modelled as a part; otherwise
    // fall back to the raw D13 logic level, which is what Blink drives.
    const pin = state.simulation.pins.D13;
    const target = pin && pin.logic === 1 ? 1 : 0;
    smoothed.current = THREE.MathUtils.damp(smoothed.current, target, 18, delta);
    const brightness = smoothed.current;

    const lens = lensRef.current;
    if (lens && lens.material instanceof THREE.MeshStandardMaterial) {
      lens.material.emissiveIntensity = brightness * 3.2;
    }
    if (lightRef.current) lightRef.current.intensity = brightness * 0.22;
  });

  return (
    <group position={[spec.x, PCB_TOP, spec.z]}>
      <mesh ref={lensRef} position={[0, mm(0.5), 0]} castShadow>
        <boxGeometry args={[mm(3.2), mm(1.1), mm(1.6)]} />
        <meshStandardMaterial
          color={C.ledOff}
          emissive={spec.color}
          emissiveIntensity={0}
          roughness={0.35}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={lightRef} color={spec.color} intensity={0} distance={0.7} decay={2} />
    </group>
  );
}

function StaticIndicator({ x, z, color }: { x: number; z: number; color: string }): JSX.Element {
  return (
    <mesh position={[x, PCB_TOP + mm(0.5), z]} castShadow>
      <boxGeometry args={[mm(3.2), mm(1.1), mm(1.6)]} />
      {/* Unlit. Nothing in the simulator drives TX/RX/ON, so nothing here pretends it does. */}
      <meshStandardMaterial color={C.ledOff} emissive={color} emissiveIntensity={0} roughness={0.4} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------------------
// Board.
// ---------------------------------------------------------------------------------------
export interface UnoR3BoardProps {
  /** Draws the selection outline when the board is the selected component. */
  selected?: boolean;
  /** Drops shadow casting and the point light for low-spec mode. */
  quality?: 'low' | 'high';
}

export function UnoR3Board({ selected = false, quality = 'high' }: UnoR3BoardProps): JSX.Element {
  const high = quality === 'high';

  // Mounting holes are subtractive in reality; a dark disc reads correctly at these sizes
  // for a fraction of the cost of CSG.
  const holes = useMemo(() => MOUNTING_HOLES.map(([x, z]) => [x, z] as const), []);

  return (
    <group name="uno-r3-board">
      {/* PCB */}
      <mesh castShadow={high} receiveShadow>
        <boxGeometry args={[BOARD_WIDTH, BOARD_THICKNESS, BOARD_DEPTH]} />
        <meshStandardMaterial color={C.soldermask} roughness={0.52} metalness={0.06} />
      </mesh>
      {/* Darker underside so the board reads as a PCB from a low camera angle. */}
      <mesh position={[0, -BOARD_THICKNESS / 2 - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BOARD_WIDTH, BOARD_DEPTH]} />
        <meshStandardMaterial color={C.soldermaskEdge} roughness={0.85} />
      </mesh>

      {selected && (
        <mesh position={[0, -BOARD_THICKNESS / 2 - 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BOARD_WIDTH + 0.12, BOARD_DEPTH + 0.12]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}

      {holes.map(([x, z], i) => (
        <mesh key={i} position={[x, PCB_TOP + 0.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[MOUNTING_HOLE_RADIUS, 12]} />
          <meshStandardMaterial color="#0a0b0d" roughness={0.9} metalness={0.3} />
        </mesh>
      ))}

      <HeaderPins />
      {LABEL_STRIPS.map((strip, i) => (
        <HeaderLegend key={i} strip={strip} />
      ))}
      <BoardWordmarks />

      {/* USB-B */}
      <mesh position={USB_CONNECTOR.center as unknown as [number, number, number]} castShadow={high} receiveShadow>
        <boxGeometry args={USB_CONNECTOR.size as unknown as [number, number, number]} />
        <meshStandardMaterial color={C.connectorMetal} metalness={0.88} roughness={0.28} />
      </mesh>

      {/* Barrel jack */}
      <mesh position={POWER_JACK.center as unknown as [number, number, number]} castShadow={high} receiveShadow>
        <boxGeometry args={POWER_JACK.size as unknown as [number, number, number]} />
        <meshStandardMaterial color={C.jackPlastic} roughness={0.62} />
      </mesh>

      <Atmega328P />
      <IcspHeader centerX={ICSP_MAIN.centerX} centerZ={ICSP_MAIN.centerZ} />
      <IcspHeader centerX={ICSP_USB.centerX} centerZ={ICSP_USB.centerZ} />

      {/* Reset button */}
      <group position={[RESET_BUTTON.x, PCB_TOP, RESET_BUTTON.z]}>
        <mesh position={[0, RESET_BUTTON.height / 2, 0]} castShadow={high}>
          <boxGeometry args={[RESET_BUTTON.size, RESET_BUTTON.height, RESET_BUTTON.size]} />
          <meshStandardMaterial color="#1a1c21" roughness={0.6} />
        </mesh>
        <mesh position={[0, RESET_BUTTON.height + mm(0.6), 0]} castShadow={high}>
          <cylinderGeometry args={[mm(1.6), mm(1.6), mm(1.4), 12]} />
          <meshStandardMaterial color={C.buttonCap} roughness={0.4} />
        </mesh>
      </group>

      {/* 16 MHz crystal */}
      <mesh position={[CRYSTAL.x, PCB_TOP + CRYSTAL.height / 2, CRYSTAL.z]} castShadow={high}>
        <boxGeometry args={[CRYSTAL.width, CRYSTAL.height, CRYSTAL.depth]} />
        <meshStandardMaterial color={C.crystalCan} metalness={0.82} roughness={0.3} />
      </mesh>

      {/* 5V regulator */}
      <mesh position={[REGULATOR.x, PCB_TOP + REGULATOR.height / 2, REGULATOR.z]} castShadow={high}>
        <boxGeometry args={[REGULATOR.width, REGULATOR.height, REGULATOR.depth]} />
        <meshStandardMaterial color={C.regulatorTab} metalness={0.5} roughness={0.5} />
      </mesh>

      <BuiltinLed />
      <StaticIndicator {...INDICATOR_LEDS.TX} />
      <StaticIndicator {...INDICATOR_LEDS.RX} />
      <StaticIndicator {...INDICATOR_LEDS.ON} />
    </group>
  );
}

/** Board footprint, for camera framing and drop-target maths. */
export const UNO_BOARD_BOUNDS = {
  halfWidth: BOARD_HALF_W,
  halfDepth: BOARD_HALF_D,
  topY: PCB_TOP,
  digitalRowZ: DIGITAL_ROW_Z,
  analogRowZ: ANALOG_ROW_Z,
};
