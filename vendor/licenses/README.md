# `vendor/licenses/`

Redistribution records for every third-party component shipped inside the packaged
application. This whole directory is copied into the installer as `runtime/licenses/`.

## Status

Each component below has an accurate **attribution record** (`NOTICE.md`) stating what it
is, which license governs it, and where the canonical text and corresponding source live.

**Verbatim license texts are NOT yet present in this tree.** They ship inside the upstream
toolchain archive under `share/doc/**` (`COPYING`, `COPYING3`, `COPYING.RUNTIME`,
`COPYING.LIB`). An earlier revision of `scripts/prune-toolchain.js` deleted `share/doc`
wholesale and removed them; that bug is fixed (the prune step now preserves any file named
`COPYING*`, `LICEN[CS]E*`, `NOTICE*`, `AUTHORS*`, `COPYRIGHT*`), but the texts only return
once the toolchain is re-fetched on a network-enabled build machine:

```
node scripts/fetch-toolchain.mjs win32-x64   # build pipeline only — never at runtime
npm run prune:toolchain
npm run manifest:win
```

`scripts/check-licenses.cjs` reports exactly which texts are missing and runs during
packaging.

> **Distribution gate.** Shipping the GPL-3.0 `avr-gcc`/binutils binaries to a third party
> without the accompanying license text — and without satisfying the corresponding-source
> obligation — is a licence violation. Complete the step above and have the client's counsel
> review the obligations before any external distribution. See `avr-gcc/NOTICE.md`.

## Components

| Directory | Component | License |
| --- | --- | --- |
| `avr-gcc/` | GCC for AVR + binutils (`avr-gcc`, `avr-g++`, `avr-ar`, `avr-gcc-ar`, `avr-objcopy`, `avr-size`, `avr-as`, `avr-ld`) | GPL-3.0-or-later, with GCC Runtime Library Exception |
| `avr-libc/` | avr-libc C runtime and headers | Modified BSD (3-clause style) |
| `arduino-core-avr/` | ArduinoCore-avr core, variants, and bundled libraries | LGPL-2.1-or-later (per-library variations) |
| `app-3d-assets/` | Original 3D hardware representations authored for this project | MIT (this project's own work) |

JavaScript dependency licenses are recorded separately in `THIRD_PARTY_NOTICES.md` at the
repository root.
