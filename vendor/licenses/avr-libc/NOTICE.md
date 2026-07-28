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

**Verbatim text — present in this directory** as `LICENSE.txt`, taken from the
`avr-libc-2_0_0-release` tag to match the bundled 2.0.0 runtime
(SHA-256 `5637a1aea5eb9c3a379611c6380b49653f68f9ffe0e1df0b7f5d6f12ecf278ef`).
Full sourcing detail is in `../PROVENANCE.md`.

**Obligation status.** Satisfied: the Modified BSD licence requires reproducing the
copyright notice, condition list, and disclaimer in the accompanying materials, which
`LICENSE.txt` does. There is no copyleft or corresponding-source requirement.
