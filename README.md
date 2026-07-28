# Offline Arduino Simulator v0.1.0

<!-- Badges are intentionally plain text, not shields.io images: this README ships inside an
     offline product, and remote badge images would be broken placeholders on an air-gapped
     machine while also being the only network request in the repository. -->

`Arduino Uno R3 / ATmega328P` · `Electron 31 + React 18` · `Bundled AVR-GCC 7.3.0` · `No runtime network use`

**3D virtual electronics lab and offline C++ code editor for classrooms, labs, and
restricted-network environments.**

A desktop application that pairs a 3D circuit workspace with a *real* AVR toolchain: sketches
are compiled by a bundled `avr-gcc`, linked against the stock Arduino core, and the resulting
Intel HEX is executed by AVR8js. There is no cloud compiler and no runtime network dependency.

> **Status: v0.1.0, a working demo — not a finished product.** The
> code → compile → circuit → simulate → save → reopen workflow is implemented and verified
> end-to-end. Read [Honest limitations](#honest-limitations) before quoting any capability.

---

## Overview

The Offline Arduino Simulator is designed for **classroom, laboratory, maker, and restricted-network environments** where internet access is unavailable or undesired. This v0.1.0 release focuses on the **Arduino Uno R3 (ATmega328P)** target with a complete offline compilation and simulation pipeline.

**Key characteristics:**
- **Desktop application**: Electron-based, configurable for Windows, macOS, and Linux
- **Offline-first**: All toolchains and libraries bundled; zero cloud dependencies at runtime
- **Development-ready**: Full TypeScript codebase with comprehensive test coverage
- **Active development**: v0.1.0 is the current development release

---

## Core Capabilities

### 1. Interactive 3D Circuit Workspace
- **Three.js + React Three Fiber** rendering engine
- Camera orbit, pan, zoom, plus **Fit to view** and **Reset camera**
- **Arduino-compatible Uno R3 board** built to the real 68.6 × 53.4 mm outline, with the
  correct 0.1″ header pitch (including the 0.16″ gap between the two digital blocks),
  legible silkscreen legends for D0–D13 / A0–A5 / power, DIP-28 ATmega328P, both ICSP
  headers, USB-B, barrel jack, reset button, crystal and regulator
- **Component library**: LED (with real polarity cues), resistor (colour bands computed
  from its actual resistance), pushbutton, potentiometer, 16×2 LCD, servo
- **Direct manipulation**: click to select, drag to move, `R` to rotate, `Delete` to remove,
  click two terminals to wire them; undo/redo throughout
- Live pin state drives the board's `L` LED and placed components
- All geometry is procedural and all labels are canvas textures — **no model, texture, or
  font files, and nothing fetched at runtime**
- Rendering performance depends on hardware; a Low-Spec mode reduces resolution, shadows,
  antialiasing, and geometry detail

### 2. Monaco-Based Arduino C++ Editor
- **Monaco Editor** with syntax highlighting and real-time diagnostics
- Inline error squiggles and warning indicators
- Live compilation feedback (compiling → success/error state transitions)
- Keyboard shortcuts for common actions (Ctrl+S, Ctrl+Enter)
- Integrated help drawer with code snippets and pinout diagrams

### 3. Native AVR-GCC Compilation
- **AVR-GCC 7.3.0-atmel3.6.1** bundled and verified
- Automatic `#include <Arduino.h>` injection when absent
- Standard Arduino core main.cpp lifecycle (setup/loop pattern)
- Prototype generation deferred (functions must be declared before use)
- `#line` directives for accurate error mapping back to source
- Intel HEX firmware generation and validation
- Memory usage reporting (flash and SRAM)

### 4. AVR8js-Based Simulation
- **AVR8js 0.21.0**, running in a Web Worker so the UI thread stays responsive
- Cycle-accurate pin state capture and edge detection
- Logic Analyzer over the captured transitions, with VCD export for external waveform tools
- LED glow, servo rotation, and LCD text driven by simulated state
- Run, pause, step, reset, and stop
- Cycle-accurate, **not** wall-clock-accurate: see
  [Honest limitations](#honest-limitations) for measured speed

### 5. Offline Examples and Help
- Bundled starter sketches: Blink, Potentiometer & PWM, Servo Sweep, LCD 1602 Display
- Integrated USER_GUIDE.md with Arduino reference and keyboard shortcuts
- One-click example loading into the workspace
- Help drawer with common C++ code patterns

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Desktop Runtime** | Electron | 31.7.7 |
| **UI Framework** | React | 18.3.1 |
| **3D Graphics** | Three.js | 0.168.0 |
| **3D Components** | React Three Fiber | 8.17.10 |
| **State Management** | Zustand | 4.5.4 |
| **Code Editor** | Monaco Editor | 0.50.0 |
| **Simulator Engine** | AVR8js | 0.21.0 |
| **Compiler Backend** | AVR-GCC | 7.3.0-atmel3.6.1 |
| **Build Tool** | Vite + electron-vite | 5.3.3 / 2.3.0 |
| **Language** | TypeScript | 5.5.3 |
| **Testing** | Vitest | 2.0.2 |

---

## Supported Target

- **Board**: Arduino Uno R3
- **Microcontroller**: ATmega328P
- **Clock Speed**: 16 MHz
- **Language**: Arduino C++ (with standard Arduino core)
- **Firmware Format**: Intel HEX (.hex)
- **Compiler**: AVR-GCC 7.3.0-atmel3.6.1

---

## Quick Start

### Prerequisites
- **Node.js** 20.0.0 or later
- **npm** or compatible package manager

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/sharonrosealgara-ui/offline-arduino-simulator.git
cd offline-arduino-simulator

# Install dependencies
npm install

# Start the development application
npm run dev
```

The Electron application will launch, displaying the full IDE with Monaco editor, 3D canvas, and simulation controls.

### Packaging for Distribution

The project is configured to build installers for Windows, macOS, and Linux:

```bash
# Build Windows x64 installers (NSIS + Portable)
npm run dist:win

# Build macOS universal binary
npm run dist:mac

# Build Linux x64 AppImage
npm run dist:linux
```

Output artifacts are placed in the `release/` directory. Actual packaged binaries and their availability depend on successful build completion and resource verification.

### Validation Commands

```bash
# Type-check the codebase
npm run typecheck

# Run linting
npm run lint

# Run the full test suite
npm test

# Verify toolchain integrity
npm run verify:toolchains

# Smoke-test the compiler with Blink example
npm run smoke:compile

# Generate third-party license notices
npm run notices
```

---

## Architecture Overview

The Offline Arduino Simulator is built on a modular, secure architecture designed for offline-first execution and extensibility.

### Core Layers

```
┌─────────────────────────────────────────────────────┐
│           Electron Main Process                      │
│  (Compiler Service, IPC Handlers, Security Gates)   │
├─────────────────────────────────────────────────────┤
│           Preload Bridge (contextIsolation)          │
│  (Typed, validated IPC surface)                      │
├─────────────────────────────────────────────────────┤
│           Sandboxed Renderer (React 18)              │
│  (Monaco Editor, 3D Canvas, UI State)               │
├─────────────────────────────────────────────────────┤
│           Web Worker (AVR8js Simulator)              │
│  (Cycle-accurate simulation, pin state)             │
├─────────────────────────────────────────────────────┤
│           Bundled Toolchain & Libraries              │
│  (AVR-GCC, Arduino core, examples)                  │
└─────────────────────────────────────────────────────┘
```

### Directory Structure

```
offline-arduino-simulator/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/                    # Electron main process
│       │   │   ├── compiler/            # AVR compilation service
│       │   │   ├── ipc/                 # IPC channel handlers
│       │   │   ├── security/            # Resource integrity verification
│       │   │   └── help/                # Documentation loaders
│       │   ├── preload/                 # Secure context bridge
│       │   └── renderer/                # React UI (client)
│       │       ├── app/
│       │       │   ├── state/           # Zustand stores
│       │       │   ├── components/      # Reusable UI components
│       │       │   ├── dialogs/         # Modal overlays
│       │       │   ├── circuit/         # 3D canvas & netlist
│       │       │   └── editor/          # Monaco integration
│       │       └── public/
│       │           └── assets/models/   # 3D model placeholders
│       ├── tsconfig.*.json              # TypeScript configs
│       └── package.json
├── packages/
│   ├── contracts/                       # Shared type definitions
│   │   └── src/
│   │       ├── compiler.ts              # Compiler interfaces
│   │       ├── circuit.ts               # Circuit model types
│   │       ├── simulation.ts            # Simulation state types
│   │       └── board-profiles.ts        # Board definitions
│   └── simulator/                       # AVR8js simulation engine
│       ├── src/
│       │   ├── circuit-runtime.ts       # Pin state & edge capture
│       │   ├── compiler-service.ts      # Compilation orchestration
│       │   ├── board/                   # Board definitions (Uno, etc.)
│       │   └── logic-analyzer/          # Cycle-accurate GPIO capture
│       └── test/                        # Unit tests
├── resources/
│   ├── docs/                            # USER_GUIDE.md
│   ├── examples/                        # Bundled sketches
│   │   ├── blink/
│   │   ├── potentiometer/
│   │   ├── servo-sweep/
│   │   └── lcd-hello-world/
│   ├── help/                            # Help drawer content
│   └── schemas/                         # JSON schemas
├── vendor/
│   ├── toolchains/                      # AVR-GCC binaries (platform-specific)
│   │   ├── win32-x64/
│   │   ├── darwin-x64/
│   │   ├── darwin-arm64/
│   │   └── linux-x64/
│   ├── arduino-avr/                     # Arduino core libraries
│   │   ├── cores/
│   │   ├── variants/
│   │   └── libraries/
│   └── licenses/                        # Third-party license notices
├── scripts/
│   ├── fetch-toolchain.mjs              # Download & verify toolchain
│   ├── verify-toolchains.mjs            # Validate manifest hashes
│   ├── fetch-arduino-core.mjs           # Download core library
│   ├── fetch-arduino-libraries.mjs      # Download standard libraries
│   ├── validate-toolchain-target.cjs    # Pre-build gate
│   ├── verify-packaged-resources.cjs    # Post-build verification
│   ├── smoke-compile.mjs                # Compiler smoke test
│   └── generate-third-party-notices.mjs # License aggregation
├── electron-builder.yml                 # Electron Builder config
├── vite.config.ts                       # Vite configuration
├── tsconfig.json                        # Root TypeScript config
├── package.json                         # Root dependencies & scripts
└── README.md                            # This file
```

---

## Compilation Pipeline

The offline compiler follows this sequence:

```
User Sketch (Sketch.ino)
    ↓
[Preprocess]
  • Normalize line endings
  • Inject #include <Arduino.h> (if absent)
  • Insert #line directives for error mapping
    ↓
[Compile Arduino Core] (cached)
  • Compile cores/arduino/main.cpp
  • Compile wiring_digital.c, wiring.c, etc.
  • Create archive with LTO-aware avr-gcc-ar
    ↓
[Compile Sketch]
  • Compile preprocessed sketch to .o
    ↓
[Link]
  • Link sketch.o + core archive
  • Generate firmware.elf
    ↓
[Objcopy]
  • Extract .text, .data, .bootloader sections
  • Generate firmware.hex (Intel HEX format)
    ↓
[Validate]
  • Verify HEX format integrity
  • Check flash and SRAM usage
  • Report memory statistics
    ↓
[Load into Simulator]
  • Parse HEX into program memory
  • Initialize AVR8js runtime
  • Begin cycle-accurate simulation
```

**Key points:**
- No custom `main()` wrapper is injected; the Arduino core provides `main()`, which calls `setup()` once and then repeatedly calls `loop()`.
- Sketch functions must be declared before use (no automatic prototype generation in v0.1.0).
- All compilation stages run in isolated, bounded child processes with no shell access.
- Diagnostics are parsed and mapped back to the original sketch source.

---

## Logic Analyzer

The integrated Logic Analyzer captures GPIO transitions at cycle-accurate granularity:

- **Digital Channels**: 14 dedicated digital pins (D0–D13) plus A0–A5 when configured as digital I/O
- **Capture Mode**: Edge-triggered (rising, falling, or both)
- **Format**: VCD (Value Change Dump) for waveform viewers
- **Timing**: Cycle-accurate relative to the AVR8js simulator clock

The Logic Analyzer is accessible via the UI and can export captured waveforms for external analysis.

---

## Offline & Supply-Chain Model

### Bundled Toolchains
- **AVR-GCC 7.3.0-atmel3.6.1** is downloaded once during development setup and bundled into the packaged application.
- **Arduino core libraries** (LiquidCrystal, Servo, Wire, SPI, etc.) are pre-packaged.
- **Example sketches** are included in the distribution.

### Toolchain Verification
- All vendor binaries are pinned in `toolchain-lock.json` with SHA-256 hashes.
- The `verify-toolchains.mjs` script validates every file against its hash before use.
- Integrity verification occurs at build time.

### Internet Requirements
- **Development setup**: `npm install` requires internet access to download dependencies.
- **Release preparation**: `npm run dist:*` requires internet access only for the pre-build toolchain validation gate (which can be skipped for development builds).
- **Installed application**: Zero internet dependency. The packaged application is fully self-contained and runs entirely offline.

### No Cloud Compiler
- The application does not contact any cloud service for compilation.
- All compilation happens locally using the bundled AVR-GCC toolchain.
- Sketches are compiled on the user's machine only.

---

## Security Posture

### Electron Hardening
- **contextIsolation**: `true` — Renderer process is isolated from Node.js context
- **sandbox**: `true` — Renderer process runs in a restricted sandbox
- **nodeIntegration**: `false` — No direct Node.js access from renderer
- **enableRemoteModule**: `false` — No remote module loading

### IPC Security
- **Typed preload bridge**: All IPC channels are explicitly listed and typed in `electron-api-types.ts`
- **Validated handlers**: Each IPC handler validates request structure and enforces request size limits
- **No shell access**: Compiler execution uses `child_process.execFile()` with `shell: false` and bounded argv arrays
- **No renderer filesystem access**: Renderer cannot directly read/write files; all I/O is mediated through IPC

### Compiler Isolation
- Compilation runs in a temporary, isolated working directory
- Compiler process inherits a minimal, controlled environment (no user shell variables)
- Output and error streams are bounded (2 MB max) and parsed safely
- Compilation timeout: 30 seconds per request

---

## Testing & Verification

### Test Suite

```bash
npm test
```

**As of the last validated run: 13 files, 112 tests, all passing.**

| Area | Covered |
| --- | --- |
| Circuit authoring (add/move/rotate/delete, wiring, undo/redo) | ✅ 22 tests |
| Intel HEX parsing and generation | ✅ 21 tests across two suites |
| Resistor colour-code derivation | ✅ 13 tests |
| Protocol decoders (UART, I²C, SPI) | ✅ 13 tests |
| Toolchain integrity + memoization | ✅ 7 tests |
| Project save → reopen round-trip | ✅ 7 tests |
| VCD export | ✅ 7 tests |
| Netlist compiler | ✅ 7 tests |
| Circuit runtime edge capture | ✅ 6 tests |
| FLOATING_INPUT diagnostic scoping | ✅ 4 tests |
| Logic store state | ✅ 4 tests |
| AVR8js worker integration | ✅ 1 test |

**Not covered by automated tests** (verified manually instead — see below):
React component rendering, Electron IPC wiring, the native file Save/Open dialogs, and
the 3D renderer.

### Manual verification performed on this build

Driven through the Chrome DevTools Protocol against both the development build and the
packaged Portable executable:

| Check | Result |
| --- | --- |
| App launches, all panes render | ✅ library, editor, 3D workspace, inspector, bottom pane, status bar |
| No horizontal overflow | ✅ workbench `scrollWidth === clientWidth` (1426 px) |
| Blink example loads code **and** circuit | ✅ "Blink LED", 2 parts · 3 wires |
| Sketch does not define `main()` | ✅ confirmed in source and in the generated `.cpp` |
| Compile via bundled AVR-GCC | ✅ dev 2.5–9 s; **packaged 2572 ms** |
| Valid Intel HEX produced | ✅ 2615 bytes, `.text` = 924 B, terminated `:00000001FF` |
| Flash usage reported | ✅ 924 / 32256 B (3%) — identical in dev and packaged builds |
| LTO core archive links | ✅ no `undefined reference to 'pinMode'` |
| Firmware loads and runs in AVR8js | ✅ simulation phase `running` |
| Pin 13 transitions detected | ✅ D13 observed toggling 1 → 0 → 1 |
| Cycle counter advances | ✅ 60,751,622 → 81,968,853; simulated time 5233 ms |
| Circuit diagnostics clean on a correct circuit | ✅ Problems = 0 |
| Zero external network connections while running | ✅ measured via `Get-NetTCPConnection` |
| Packaged toolchain integrity | ✅ 1112/1112 files present, SHA-256 matched |

**Not manually verified in this pass:** the native Save/Open *file dialogs* (they require
GUI interaction that cannot be automated headlessly). The persistence logic behind them is
covered by the save → reopen round-trip test, which exercises the real schema and store
bridge.

### Pre-Flight Checks
Before building, the system validates:

1. **TypeScript compilation** (`npm run typecheck`)
2. **Linting** (`npm run lint`)
3. **Test suite** (`npm test`)
4. **Toolchain availability** (AVR-GCC binaries present and verified)
5. **Resource packaging** (examples, docs, core libraries bundled)

---

## Project Status & Roadmap

### v0.1.0 (Current Development)

**Implemented and verified in this build:**
- ✅ Real AVR compilation through a bundled `avr-gcc` 7.3.0 (no cloud compiler)
- ✅ AVR8js simulation of the compiled Intel HEX
- ✅ 3D circuit workspace: Uno R3 board with legible pin legends, plus LED, resistor,
  pushbutton, potentiometer, 16×2 LCD, and servo
- ✅ Circuit authoring — place, move, rotate, delete parts; draw wires terminal-to-terminal;
  undo/redo
- ✅ Component inspector with editable properties (resistance, LED colour, servo range)
- ✅ Project save / open as `.oasproj.json`, restoring both code and circuit
- ✅ Serial Monitor, Problems view, Circuit & Runtime tab, Logic Analyzer with VCD export
- ✅ Offline examples and help; no runtime network use
- ✅ Windows x64 Portable and NSIS installers

### Honest limitations

These are current facts about v0.1.0, not roadmap items:

- **Board support** is Arduino Uno R3 / ATmega328P only.
- **No breadboard.** A full-size breadboard is modelled in the graphics spec but is *not*
  shipped, because making it electrically real requires a tie-point connection model
  (~130 strip terminals) that the current wire-based netlist does not implement. Rather
  than render a breadboard that looks conductive but is not — which would actively mislead
  students — it is omitted. Wire components terminal-to-terminal instead.
- **Simulation speed is well below real time.** Measured at roughly 10–20 % of real time on
  a mid-range Windows laptop under load, so a `delay(500)` takes a few seconds of wall
  clock. The simulation is cycle-accurate, not wall-clock-accurate. **No frame rate or
  speed figure is guaranteed** — none has been benchmarked on a controlled machine.
- **No automatic function prototype generation.** Functions must be declared before first
  use, unlike the Arduino IDE.
- **Single-file sketches only** (`Sketch.ino`).
- **TX / RX / ON board LEDs are rendered unlit** because nothing in the simulator drives
  them. Only the `L` LED (pin 13) reflects real state.
- **GPL corresponding-source obligation is not yet discharged.** The verbatim licence texts
  *are* bundled and the licence check passes without override, but redistributing the
  GPL-3.0 toolchain binaries also requires offering their matching source — see
  [Asset sources and licences](#asset-sources-and-licences).
- **Reduced-quality graphics mode** ("Low-Spec") is implemented and switches DPR, shadows,
  antialiasing, and geometry detail, but has not been benchmarked on low-spec classroom
  hardware.
- **macOS and Linux packaging is configured but unbuilt and untested**; only the Windows
  x64 artifacts have been produced and run.

### Future roadmap

Nothing in this list is implemented. It is a plan, not a feature list.

- **Phase B — measurement:** deeper protocol decoding, breakpoints, step execution,
  register/variable inspection.
- **Phase C — circuit intelligence:** LED polarity warnings, short-circuit and
  missing-resistor detection, student-friendly explanations.
- **Phase D — classroom:** teacher/student modes, guided lessons, progress tracking,
  assignment templates, assessment mode, local reporting.
- **Phase E — hardware:** electrically-real breadboard, more sensors, displays, motors and
  drivers, communication modules, additional boards (Mega, Leonardo).

---

## Client demo script

The shortest path that exercises the whole product. Roughly four minutes.

1. **Launch** `Offline Arduino Simulator-0.1.0-Windows-x64-Portable.exe`. No install, no
   admin rights. The status bar reads *Toolchain: AVR-GCC 7.3.0 bundled (not yet run)*.
2. **Examples → 01. Blink LED.** The editor fills with the sketch and the workspace gets an
   Uno, a 220 Ω resistor, an LED, and three wires. Point out that the sketch has **no
   `main()`** — the bundled Arduino core supplies it.
3. **Verify.** This shells out to the real bundled `avr-gcc`. The status bar flips to
   *AVR-GCC 7.3.0 verified* and shows *Flash 924 / 32256 B (3%)*.
   The first compile is slower — it builds and caches the Arduino core archive.
4. **Run.** The board's `L` LED and the wired LED blink together. Open **Circuit & Runtime**
   to show the cycle counter and live pin table, and **Logic Analyzer** for the D13 waveform.
5. **Build something.** Pick *LED* from the Component Library, click the bench to place it,
   click a board pin then the LED's anode to wire it. Rotate with `R`, undo with `Ctrl+Z`.
   Select it and change its colour in the inspector.
6. **Save** (`Ctrl+S`) to `Documents\Offline Arduino Simulator\Projects`, close the app,
   reopen, and **Open** the project — code and circuit both come back.
7. **Pull the network cable** and repeat steps 3–4. Nothing changes; nothing is fetched.

**Talking points that are true:** the compiler is genuinely `avr-gcc` producing real Intel
HEX; the simulator executes that firmware instruction by instruction; nothing contacts the
internet. **Do not claim:** real-time simulation speed, breadboard support, or boards other
than the Uno.

---

## Asset sources and licences

### 3D and UI assets — all original

Every object in the workspace is **original procedural three.js geometry authored for this
project**, licensed MIT with the rest of the repository. Pin legends and component labels
are drawn into `<canvas>` textures using fonts already present on the OS.

There are **no binary asset files at all** — no models, textures, HDRIs, sprites, or
webfonts — so there is nothing to attribute and nothing to fetch. Source of record:
`apps/desktop/src/renderer/app/circuit/hardware/`.

Deliberately **not** used: Arduino product photography or marketing renders; downloaded or
purchased 3D models; CDN-hosted assets of any kind; copied Arduino silkscreen artwork.

Full record, including the trademark position on the "Arduino" name:
`vendor/licences/app-3d-assets/NOTICE.md` (spelled `vendor/licenses/` in the tree).

### Redistributed third-party components

| Component | Licence | Obligation |
| --- | --- | --- |
| avr-gcc (GCC for AVR) | GPL-3.0-or-later + GCC Runtime Library Exception | Ship licence text **and** provide corresponding source |
| binutils (`avr-ar`, `avr-gcc-ar`, `avr-objcopy`, `avr-size`, …) | GPL-3.0-or-later | Ship licence text + corresponding source |
| avr-libc | Modified BSD | Reproduce copyright notice and disclaimer |
| ArduinoCore-avr (core, variants, libraries) | LGPL-2.1-or-later | Ship licence text; core is used unmodified |
| npm dependencies | MIT / ISC | See `THIRD_PARTY_NOTICES.md` |

Attribution records live in `vendor/licenses/<component>/NOTICE.md` and are packaged to
`runtime/licenses/`. Pinned versions and SHA-256 values are in `toolchain-lock.json` and
each `vendor/toolchains/<target>/manifest.json`.

### Verbatim licence texts — shipped

| File | Component & version | SHA-256 |
| --- | --- | --- |
| `vendor/licenses/avr-gcc/COPYING3` | GPL-3.0, from the GCC 7.3.0 release | `8ceb4b9e…b65b903` |
| `vendor/licenses/avr-gcc/COPYING.RUNTIME` | GCC Runtime Library Exception 3.1, same release | `9d6b43ce…dc90f74` |
| `vendor/licenses/avr-libc/LICENSE.txt` | avr-libc 2.0.0 (Modified BSD) | `5637a1ae…ecf278ef` |
| `vendor/licenses/arduino-core-avr/COPYING.LIB` | LGPL-2.1, FSF canonical | `20e50fe7…3555d95` |

Source URLs, versions, and the full verification method are in
[`vendor/licenses/PROVENANCE.md`](vendor/licenses/PROVENANCE.md). No licence text has been
edited, summarised, or reformatted — each is the upstream file byte-for-byte.
`scripts/check-licenses.cjs` runs during packaging and fails the build if any is missing;
it currently passes with **no override**.

> **Note on an earlier claim.** A previous revision of this file stated that
> `scripts/prune-toolchain.js` had deleted these texts from `share/doc`. That was wrong: the
> pinned toolchain archive was downloaded, checksum-verified, and inspected — it ships **no
> licence texts and no `share/` directory at all**. The prune script's licence-preservation
> guard is retained as defensive hygiene, but it was not the cause.

> ### ⚠ Remaining obligation — GPL corresponding source
>
> Shipping the licence text satisfies only part of GPL-3.0. Redistributing the GPL-3.0
> `avr-gcc`/binutils **binaries** also obliges the distributor to provide the complete
> corresponding source for that exact build — alongside the binaries, or via a written offer
> valid for three years (GPL-3.0 §6). These are Arduino's builds, so the practical route is
> to mirror Arduino's source archive in the same release channel as the installer rather
> than relying on a third-party URL staying reachable. **Have counsel confirm before wide
> external distribution.**

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository** and create a feature branch
2. **Follow the architecture** outlined above
3. **Add tests** for new functionality
4. **Run validation commands** before submitting a PR:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```
5. **Update documentation** if behavior changes

---

## Documentation & License

- **User Guide**: See `resources/docs/USER_GUIDE.md` for comprehensive usage instructions, pinout diagrams, and code snippets.
- **Example Sketches**: Located in `resources/examples/` (Blink, Potentiometer & PWM, Servo Sweep, LCD 1602 Display).
- **License**: MIT License. See the LICENSE file for details.
- **Third-Party Notices**: See `vendor/licenses/` for notices from bundled dependencies and toolchains.

---

## Support & Feedback

For issues, feature requests, or questions:

- **GitHub Issues**: https://github.com/sharonrosealgara-ui/offline-arduino-simulator/issues
- **Discussions**: https://github.com/sharonrosealgara-ui/offline-arduino-simulator/discussions

---

**Built with precision for makers, engineers, and educators.**

*Offline Arduino Simulator — Compile. Simulate. Create. Anywhere.*
