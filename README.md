# Offline Arduino Simulator

A **100% offline, cross-platform** Arduino Uno classroom simulator for Windows, macOS,
and Linux. After the installer or portable package reaches a computer, compilation,
simulation, examples, help, saving, and reopening all work with every network
interface disabled.

- **Shell:** Electron + Vite + React + TypeScript
- **Editor:** Monaco
- **Simulation core:** [AVR8js](https://github.com/wokwi/avr8js) `@0.21.0` (pinned)
- **Compiler:** bundled native AVR-GNU toolchain (`avr-gcc`, `avr-g++`, `avr-ar`, `avr-objcopy`, `avr-size`)
- **Board (MVP):** Arduino Uno R3 / ATmega328P / 16 MHz

> Built to three architectural specs kept in the repo root:
> `OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md`,
> `FRONTEND_AND_SIMULATOR_WORKER_SPEC.md`,
> `UI_CANVAS_AND_PACKAGING_SPEC.md`.

## Trust & workload zones

| Zone | Owns | Never touches |
| --- | --- | --- |
| **Renderer** (sandboxed) | React, Monaco, SVG canvas, controls, console | Node, filesystem, child_process, AVR registers |
| **Preload bridge** | tiny typed `window.electronAPI` (compile / cancel) | raw `ipcRenderer`, generic invoke |
| **Main process** | filesystem, temp build dirs, native compiler, raw output | rendering |
| **Simulation worker** | all mutable AVR8js + circuit-runtime + simulated time | DOM, Electron, filesystem |

## Repository layout

```
offline-arduino-simulator/
├─ apps/desktop/            # Electron app (main + preload + renderer)
│  └─ src/{main,preload,renderer}/
├─ packages/
│  ├─ contracts/           # dependency-free shared DTOs + Zod schemas
│  └─ simulator/           # AVR8js worker, netlist compiler, solver, components
├─ vendor/                 # build inputs (native toolchain, Arduino core) — NOT committed
├─ resources/              # examples, help, schemas, app assets
├─ scripts/                # build-time toolchain fetch/verify + release helpers
├─ electron-builder.yml
└─ toolchain-lock.json     # supply-chain source of truth (URL + SHA-256 per target)
```

## Getting started (development)

```bash
npm install
npm run dev
```

> The bundled toolchain lives under `vendor/toolchains/<os>-<arch>/` and is **not**
> checked into git (see `.gitignore`). Populate it with `scripts/fetch-toolchain.mjs`
> (checksum-locked against `toolchain-lock.json`) before compiling real sketches.
> Until then the app runs, but the Compile action reports `TOOLCHAIN_MISSING`.

## Common scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Launch the Electron app with HMR |
| `npm run build` | Type-check + bundle main/preload/renderer to `apps/desktop/dist/` |
| `npm test` | Run the Vitest suite (Intel HEX, netlist, solver, serial, …) |
| `npm run typecheck` | Project-wide `tsc -b` |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Build a signed-layout installer per target (needs the vendored toolchain) |

## Packaging note (monorepo path)

`electron-builder.yml` is transcribed verbatim from the packaging spec, which assumes a
flat single-package repo (`dist/` beside the config). In this **monorepo** the desktop
app builds to `apps/desktop/dist/{main,preload,renderer}`. Before running
`electron-builder`, either point it at the app directory (`--projectDir apps/desktop`)
or adjust the `files` globs to `apps/desktop/dist/**`, and keep the `vendor/` +
`resources/` `extraResources` paths relative to the repo root. This step is un-exercised
in the dev environment (electron-builder downloads platform binaries and needs the
vendored native toolchain), so validate it on each target per the spec's release gates.

## Security posture

`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, restrictive CSP,
allowlisted IPC senders, `shell: false` compiler spawns, Intel HEX validated as
untrusted before crossing IPC, and **no fallback to a system compiler**. See the setup
spec §9 for the full checklist.

## License

See [`LICENSE`](./LICENSE) and [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
Redistributed GPL toolchain binaries carry corresponding-source obligations fulfilled
in the release channel.
