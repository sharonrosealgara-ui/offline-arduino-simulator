# 3D Model Assets (offline-bundled)

**This directory contains no assets, and that is the shipped state.** Every 3D object in the
circuit workspace — the Uno R3 board, the LED, resistor, pushbutton, potentiometer, jumper
wires, the 16×2 LCD and the servo — is built at runtime from three.js primitive geometry in
TypeScript. There are no `.glb` files, no textures, and no binary assets of any kind.

An earlier version of this file listed `arduino_uno.glb`, `breadboard.glb` and `led.glb` as
though this directory held them. It did not, and no breadboard has ever been rendered by
this application. The list is removed rather than left to imply assets that do not exist.

## If GLTF/GLB models are ever added

The renderer NEVER fetches models from a CDN or any other network location. Should audited
`.glb` files be placed here in future they would be bundled by Vite and served from the
local dev server or the packaged app resources only, and the procedural geometry would stay
as the fallback so the 3D view keeps working with zero network requests.

Any such file would need its licence and attribution verified and recorded in
`vendor/licenses/app-3d-assets/NOTICE.md` before being committed.
