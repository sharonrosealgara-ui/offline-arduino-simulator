/**
 * Camera framing for the circuit studio: "Fit to view" and "Reset camera".
 *
 * Deliberately imperative rather than using drei's <Bounds fit>. Bounds re-frames whenever
 * its children change, which fought the user constantly: placing a component or letting an
 * LED's point light change the bounding box would yank the camera away mid-edit. Here the
 * camera only ever moves when the user asks it to.
 *
 * The controls ref type is derived from drei's own component rather than imported from
 * `three-stdlib` by name — that package is only present nested inside drei and does not
 * resolve from application code.
 */
import { forwardRef, useCallback, useImperativeHandle, type ElementRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { OrbitControls } from '@react-three/drei';

type OrbitControlsRef = ElementRef<typeof OrbitControls>;

/** Home position, matching the <Canvas camera> default. */
const HOME_POSITION = new THREE.Vector3(2.6, 3.0, 3.9);
const HOME_TARGET = new THREE.Vector3(0, 0, 0);

/** Leaves ~18% breathing room around the fitted content. */
const FIT_MARGIN = 1.18;

export interface CameraRigHandle {
  /** Frames everything currently in the scene. */
  fit(): void;
  /** Returns the camera to its default position and target. */
  reset(): void;
}

export interface CameraRigProps {
  controls: RefObject<OrbitControlsRef | null>;
}

export const CameraRig = forwardRef<CameraRigHandle, CameraRigProps>(function CameraRig(
  { controls },
  ref,
) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  const apply = useCallback(
    (position: THREE.Vector3, target: THREE.Vector3) => {
      camera.position.copy(position);
      camera.lookAt(target);
      const orbit = controls.current;
      if (orbit) {
        orbit.target.copy(target);
        orbit.update();
      }
    },
    [camera, controls],
  );

  const fit = useCallback(() => {
    // Measure only real hardware. Lights, the grid helper, and the ground plane would
    // dominate the box and make every fit zoom out to the whole 24-unit bench.
    const box = new THREE.Box3();
    let measured = false;
    scene.traverse((object) => {
      const named = object.name === 'uno-r3-board' || object.name === 'dynamic-netlist';
      if (!named) return;
      const objectBox = new THREE.Box3().setFromObject(object);
      if (objectBox.isEmpty()) return;
      box.union(objectBox);
      measured = true;
    });

    if (!measured || box.isEmpty()) {
      apply(HOME_POSITION, HOME_TARGET);
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 * FIT_MARGIN;

    const perspective = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(perspective.isPerspectiveCamera ? perspective.fov : 38);
    // Account for a narrow viewport: a tall thin pane clips horizontally first.
    const aspect = perspective.isPerspectiveCamera ? perspective.aspect : 1;
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const distance = radius / Math.sin(Math.min(fov, horizontalFov) / 2);

    // Keep the user's current viewing direction; only the distance and target change.
    const direction = camera.position.clone().sub(controls.current?.target ?? HOME_TARGET);
    if (direction.lengthSq() < 1e-6) direction.copy(HOME_POSITION);
    direction.normalize().multiplyScalar(Math.max(distance, 0.8));

    apply(center.clone().add(direction), center);
  }, [apply, camera, controls, scene]);

  const reset = useCallback(() => apply(HOME_POSITION, HOME_TARGET), [apply]);

  useImperativeHandle(ref, () => ({ fit, reset }), [fit, reset]);

  return null;
});
