# `vendor/licenses/`

Exact license texts for every redistributed component. These are copied into the
installer under `runtime/licenses/` and surfaced in-app. Required entries:

- `avr-gcc/` — GPL-3.0 + GCC Runtime Library Exception
- `avr-libc/` — avr-libc modified-BSD license
- `arduino-core-avr/` — LGPL-2.1 and per-file notices
- `avr8js/` — MIT

For redistributed GPL compiler binaries, the corresponding source must be published in
the same release channel. Have counsel/client review distribution obligations before
release (setup spec §4.2).
