# 3D Model Assets (offline-bundled)

This directory holds optional GLTF/GLB models for the 3D circuit canvas:

- `arduino_uno.glb` — Arduino Uno R3 board
- `breadboard.glb` — half-size breadboard
- `led.glb` — 5 mm LED

## Fallback policy

The renderer NEVER fetches models from a CDN. If a `.glb` file listed above is
absent, `CircuitCanvas3D.tsx` renders a **procedural primitive fallback** built
entirely from three.js geometry (BoxGeometry / CylinderGeometry / SphereGeometry),
so the 3D view always works fully offline with zero network requests.

To upgrade visuals, drop audited `.glb` files here; they are bundled by Vite and
served from the local dev server / packaged app resources only.
