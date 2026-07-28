# avr-gcc / AVR binutils — attribution record

**Component.** The AVR GNU toolchain redistributed under `runtime/toolchains/<target>/`:
`avr-gcc`, `avr-g++`, `avr-cpp`, `avr-gcc-ar`, `avr-ar`, `avr-as`, `avr-ld`, `avr-objcopy`,
`avr-ranlib`, `avr-nm`, `avr-strip`, `avr-size`, plus their support libraries
(`cc1`, `cc1plus`, `lto1`, `lto-wrapper`, `liblto_plugin`, `collect2`, `libgcc`).

**Version.** `7.3.0-atmel3.6.1-arduino7`, pinned in `toolchain-lock.json` with a SHA-256 for
each per-platform archive, verified before extraction by `scripts/fetch-toolchain.mjs`.

**Upstream.** https://github.com/arduino/toolchain-avr — binaries distributed by Arduino at
`https://downloads.arduino.cc/tools/`. The exact URL and checksum per platform are recorded
in `toolchain-lock.json`.

**License.** GNU General Public License, version 3 or later (GPL-3.0-or-later). Code that
GCC emits into your compiled sketch is additionally covered by the **GCC Runtime Library
Exception**, which is why compiling a sketch with this toolchain does not impose GPL terms
on the sketch.

**Canonical text.** `COPYING3` (GPL-3.0) and `COPYING.RUNTIME` (Runtime Library Exception),
shipped in the upstream archive under `share/doc/`. See `../README.md` for how to restore
them into this tree — they are currently absent.

## Obligations this project must satisfy before external distribution

1. **Ship the license text.** The verbatim GPL-3.0 text must accompany the binaries.
2. **Corresponding source.** Redistributing GPL-3.0 binaries obliges the distributor to
   provide the complete corresponding source for that exact build, either alongside the
   binaries or via a written offer valid for three years (GPL-3.0 §6). The matching source
   is published at the upstream repository above; the specific build is Arduino's, so the
   practical route is to mirror Arduino's source archive in the same release channel as
   the installer rather than relying on a third-party URL remaining available.
3. **No added restrictions.** The installer's EULA must not restrict the rights GPL-3.0
   grants over these binaries.

Neither obligation 1 nor 2 is satisfied by the current tree. This is tracked as a release
blocker, not a completed item.
