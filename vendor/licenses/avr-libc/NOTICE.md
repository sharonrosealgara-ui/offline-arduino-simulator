# avr-libc — attribution record

**Component.** The AVR C runtime, startup files, and headers redistributed under
`runtime/toolchains/<target>/avr/` (`crt*.o`, `libc.a`, `libm.a`, `libprintf_*.a`, and the
`avr/include` headers such as `avr/io.h`, `avr/interrupt.h`, `avr/pgmspace.h`).

**Version.** Bundled inside the pinned `avr-gcc 7.3.0-atmel3.6.1-arduino7` distribution; the
per-file SHA-256 set is recorded in each `vendor/toolchains/<target>/manifest.json`.

**Upstream.** https://github.com/avrdudes/avr-libc (historically
https://savannah.nongnu.org/projects/avr-libc/).

**License.** Modified BSD, three-clause style. It is a permissive license: redistribution in
binary form requires reproducing the copyright notice, the condition list, and the
disclaimer in the accompanying materials. There is no copyleft obligation and no
corresponding-source requirement.

**Canonical text.** The `LICENSE` file at the root of the avr-libc source distribution, also
shipped under `share/doc/avr-libc*/` in the upstream toolchain archive. See `../README.md`
for how to restore it into this tree — it is currently absent.

**Obligation status.** Attribution is recorded here; the verbatim notice text still needs to
be shipped alongside the binaries. Tracked as a release blocker.
