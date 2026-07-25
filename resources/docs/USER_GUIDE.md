# Offline Arduino Simulator — User Guide

Welcome to the **Offline Arduino Simulator**, a photorealistic 3D virtual electronics lab and offline C++ code editor for makers, engineers, and creators. Everything in this application — the code editor, compiler, simulator, examples, and this documentation — works **100% offline**. No account, no internet connection, and no external services are ever required.

## 1. The Workbench

The main window is divided into three areas:

| Area | Purpose |
| --- | --- |
| **Code Editor** (left) | Write Arduino C++ sketches with syntax highlighting and inline error squiggles. |
| **Circuit Canvas** (right) | View your circuit in 2D schematic or photorealistic 3D mode. Toggle with the 2D/3D buttons in the pane header. |
| **Bottom Panel** | Serial Monitor, Problems (compiler diagnostics), and Circuit & Runtime information. |

## 2. Core Actions

- **Verify** — Compiles your sketch with the bundled AVR-GCC toolchain. The status indicator shows blue while compiling, green on success ("Done compiling in XX ms"), and red with an error count if compilation fails. Errors appear as red squiggles in the editor and as entries in the Problems panel.
- **Run** — Compiles (if needed) and starts the simulation. Watch LEDs light up in the 3D canvas and serial output stream into the Serial Monitor.
- **Pause / Step / Reset / Stop** — Fine-grained simulation control for debugging.

## 3. Examples

Open **Examples** in the top bar to browse the built-in starter library, including:

- **Blink** — the classic LED blink on pin 13
- **Servo Sweep** — drive a servo motor through its range
- **Push Button** — digital input with a pull-up resistor
- **Potentiometer** — analog input and PWM output
- **LCD Hello World** — drive a 16x2 character LCD

Opening an example creates an editable copy, so the originals are never modified.

## 4. Working with Projects

- **Open / Save** — Projects are stored as portable `.oasim` JSON files containing your sketch and circuit.
- Your work never leaves your machine.

## 5. The 3D Lab View

The 3D canvas renders your board, breadboard, and components with real-time state: when your sketch drives a pin HIGH, the connected LED glows with physically-inspired emissive lighting. Use the mouse to orbit, zoom, and pan. Enable **Low-spec mode** in the top bar on older hardware to reduce GPU load.

## 6. Offline & Security Notes

- The compiler toolchain, Arduino core, editor, fonts, and all documentation are bundled inside the installation. The application makes **zero network requests** at runtime.
- All compilation runs in a sandboxed local process with strict resource limits.
- See the **Installation Guide** (Help menu) for artifact checksums and verification steps.

## 7. Troubleshooting

| Symptom | Resolution |
| --- | --- |
| "Compiler toolchain is missing" | The bundled toolchain was not installed correctly. Re-install the application, or in development run `node scripts/fetch-toolchain.mjs <target>` followed by `node scripts/verify-toolchains.mjs`. |
| Slow 3D rendering | Enable Low-spec mode (top bar) to cap frame rate and disable shadows. |
| Serial Monitor empty | Ensure your sketch calls `Serial.begin(9600)` and the simulation is running. |
