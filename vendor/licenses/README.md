# `vendor/licenses/`

Redistribution records for every third-party component shipped inside the packaged
application. This whole directory is copied into the installer as `runtime/licenses/`.

## Status

Each component has an **attribution record** (`NOTICE.md`) stating what it is and which
licence governs it, plus the **verbatim licence text** it is obliged to carry.

`scripts/check-licenses.cjs` verifies both, and runs during packaging against the packaged
tree. It currently reports:

```
[check-licenses] OK: attribution + verbatim license text present for all components.
```

**Where those texts came from — including a correction to an earlier claim made in this
repository — is recorded in [`PROVENANCE.md`](./PROVENANCE.md)**, with the source URL,
version, and SHA-256 for every file. In short: the pinned toolchain archive ships no licence
texts at all (it has no `share/` directory), so they were taken from the upstream projects
at the exact versions redistributed — GCC 7.3.0, avr-libc 2.0.0, and the FSF's canonical
LGPL-2.1.

> **Remaining obligation — corresponding source.** Shipping the licence text satisfies only
> part of GPL-3.0. Redistributing the GPL-3.0 `avr-gcc`/binutils **binaries** also obliges
> the distributor to provide the complete corresponding source for that exact build, either
> alongside the binaries or via a written offer valid for three years (GPL-3.0 §6). These
> binaries are Arduino's build, so the practical route is to mirror Arduino's source archive
> in the same release channel as the installer rather than relying on a third-party URL
> staying reachable. Have counsel confirm before wide external distribution.
> See `avr-gcc/NOTICE.md`.

## Components

| Directory | Component | License |
| --- | --- | --- |
| `avr-gcc/` | GCC for AVR + binutils (`avr-gcc`, `avr-g++`, `avr-ar`, `avr-gcc-ar`, `avr-objcopy`, `avr-size`, `avr-as`, `avr-ld`) | GPL-3.0-or-later, with GCC Runtime Library Exception |
| `avr-libc/` | avr-libc C runtime and headers | Modified BSD (3-clause style) |
| `arduino-core-avr/` | ArduinoCore-avr core, variants, and bundled libraries | LGPL-2.1-or-later (per-library variations) |
| `app-3d-assets/` | Original 3D hardware representations authored for this project | MIT (this project's own work) |

JavaScript dependency licenses are recorded separately in `THIRD_PARTY_NOTICES.md` at the
repository root.
