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

The 3D canvas renders your board, your components and the wires between them with real-time state: when your sketch drives a pin HIGH, the connected LED glows with physically-inspired emissive lighting. Use the mouse to orbit, zoom, and pan. Enable **Low-spec mode** in the top bar on older hardware to reduce GPU load.

The 3D Workspace does not show breadboards yet. While your circuit contains one, the 3D
button is unavailable and the reason is shown beside it; everything works normally in 2D.
Remove the breadboard and 3D becomes available again.

## 5a. The Breadboard (2D)

Switch to **2D Schematic** and drag the **400-Tie-Point Breadboard** from the component
library. Breadboards can only be added in 2D for now.

**What is joined to what.** Each column of five holes on one side of the centre channel is
joined inside the board. Nothing crosses the channel, so the five holes above it and the five
below it are two separate connections. The four rails along the long edges are four separate
runs — the top positive rail is not joined to the bottom positive rail.

**Choosing a hole with the mouse.** Click a hole to start a wire, then click another hole or
a pin to finish it. Clicking between holes does nothing on purpose: the board never guesses
which hole you meant.

**Choosing a hole with the keyboard.** Tab to the breadboard — it is a single stop, not four
hundred — then press **Enter** or **Space** to start choosing a hole. The arrow keys move
between holes, **Enter** selects the one you are on, and **Escape** cancels a wire you are
drawing or leaves hole-choosing mode if there is no wire in progress. Tab always takes you
out. Each hole is announced with its name, what it is joined to, and whether it is free.

**What the marks mean.** The hole you are on has a square outline. Holes joined to it are
ringed. Holes that already have a wire are crossed out. Each cue is a different shape, so
they can be told apart without relying on colour.

**One wire per hole.** A real hole holds one wire, and so does this one. If you pick a hole
that is already used, nothing changes and the board tells you which nearby holes are free and
joined to the same points, so you can use one of those instead.

**What is not supported yet.** Only jumper wires connect to breadboard holes. Pushing an LED,
resistor, button or potentiometer leg directly into a hole is planned for a later update, as
is showing the breadboard in the 3D Workspace.

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
