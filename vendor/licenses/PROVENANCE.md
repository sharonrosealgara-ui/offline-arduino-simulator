# Licence text provenance

Every verbatim licence text in this tree, where it came from, and how to re-verify it.

Regenerate/verify at any time with:

```bash
node scripts/check-licenses.cjs      # presence check, runs during packaging
sha256sum vendor/licenses/*/COPYING* vendor/licenses/*/LICENSE*
```

## Where these texts actually came from

The pinned Arduino AVR toolchain archive
(`avr-gcc-7.3.0-atmel3.6.1-arduino7-i686-w64-mingw32.zip`, SHA-256
`a54f6475…cf39800e`, verified against `toolchain-lock.json`) **ships no licence texts at
all** — it contains only `avr/{bin,lib,include,libexec,avr,i686-w64-mingw32}` and has no
`share/` directory. This was confirmed by downloading the archive, verifying its checksum,
and listing its contents.

> An earlier revision of this repository stated that `scripts/prune-toolchain.js` had
> deleted the licence texts from `share/doc`. **That was wrong** — the texts were never in
> the archive. The prune script's licence-preservation guard is still correct defensive
> hygiene (and is retained), but it was not the cause. This note exists so the incorrect
> explanation is not repeated.

The texts below were therefore taken from the upstream projects, pinned to the exact
versions of the software actually redistributed.

## Files

| File | Component & version | Source | SHA-256 | Bytes |
| --- | --- | --- | --- | --- |
| `avr-gcc/COPYING3` | GPL-3.0, as shipped with **GCC 7.3.0** | `https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-7.3.0/COPYING3` | `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903` | 35147 |
| `avr-gcc/COPYING.RUNTIME` | GCC Runtime Library Exception 3.1, as shipped with **GCC 7.3.0** | `https://raw.githubusercontent.com/gcc-mirror/gcc/releases/gcc-7.3.0/COPYING.RUNTIME` | `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74` | 3324 |
| `avr-libc/LICENSE.txt` | avr-libc **2.0.0** (Modified BSD) | `https://raw.githubusercontent.com/avrdudes/avr-libc/avr-libc-2_0_0-release/LICENSE` | `5637a1aea5eb9c3a379611c6380b49653f68f9ffe0e1df0b7f5d6f12ecf278ef` | 2481 |
| `arduino-core-avr/COPYING.LIB` | LGPL-2.1 (FSF canonical) | `https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt` | `20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95` | 26419 |

All four were downloaded as plain text and checked for HTML contamination before being
committed. **No licence text in this tree has been edited, summarised, reformatted, or
regenerated** — each is the upstream file byte-for-byte.

## Why these particular sources

**avr-gcc / binutils — GCC 7.3.0's own `COPYING3` and `COPYING.RUNTIME`.** These are the
licence files distributed with the exact compiler release whose binaries we redistribute,
which is stronger provenance than a generic copy. `COPYING3` hashes to
`8ceb4b9e…b65b903`, the well-known canonical GPL-3.0 digest. It differs from the copy
currently published at `gnu.org/licenses/gpl-3.0.txt` only in that the FSF has since
changed two embedded URLs from `http://` to `https://`; the licence terms are identical.
The bundled binutils tools (`avr-ar`, `avr-gcc-ar`, `avr-objcopy`, `avr-size`, `avr-as`,
`avr-ld`, `avr-nm`, `avr-ranlib`, `avr-strip`) are GPL-3.0-or-later and are covered by the
same `COPYING3` text.

**avr-libc — the `avr-libc-2_0_0-release` tag.** `avr/include/avr/version.h` in the bundled
toolchain declares `__AVR_LIBC_VERSION_STRING__ "2.0.0"`, so the licence is taken from that
exact release tag rather than from `main`.

**ArduinoCore-avr — FSF canonical LGPL-2.1.** ArduinoCore-avr 1.8.3 has **no repository-root
`LICENSE` file** (verified against the GitHub API for tag `1.8.3`: the root contains only
`boards.txt`, `bootloaders`, `cores`, `extras`, `firmwares`, `libraries`, `platform.txt`,
`programmers.txt`, `variants`). The core declares its licence in per-file headers instead —
e.g. `cores/arduino/wiring.c` states "version 2.1 of the License, or (at your option) any
later version" and "You should have received a copy of the GNU Lesser General Public
License along with this library". Supplying that copy is precisely the obligation this file
satisfies, so the FSF's canonical LGPL-2.1 text is used.

Independently, the bundled **Servo 1.2.2** library carries its own verbatim LGPL-2.1 copy at
`vendor/arduino-avr/libraries/Servo/LICENSE.txt` (SHA-256 `20c17d8b…c96e331`, matching
`vendor/arduino-avr/manifest.json`). It is also packaged. It differs from the FSF copy above
only in the FSF's postal address line, which the FSF has since replaced with a URL.

## Packaging

`electron-builder.yml` copies `vendor/licenses` to `runtime/licenses` via `extraResources`,
so all of the above ship inside the installed application, outside `app.asar`.
`scripts/verify-packaged-resources.cjs` (the `afterPack` hook) calls
`scripts/check-licenses.cjs` against the **packaged** tree and fails the build if any
attribution record or verbatim text is missing.
