# ArduinoCore-avr — attribution record

**Component.** The Arduino AVR core compiled into `core.a` and linked into every sketch,
redistributed under `runtime/arduino-avr/`:

- `cores/arduino/**` — `main.cpp`, `wiring*.c`, `HardwareSerial*`, `Print`, `Stream`,
  `WString`, `Tone`, `WMath`, `abi`, `new`, `hooks`
- `variants/standard/**` — `pins_arduino.h` for the Uno pin mapping
- `libraries/**` — `EEPROM`, `SPI`, `Wire`, `LiquidCrystal`, `Servo`

**Upstream.** https://github.com/arduino/ArduinoCore-avr

**License.** LGPL-2.1-or-later for the core. Bundled libraries vary: `Servo` carries its own
notice (preserved verbatim at `runtime/arduino-avr/libraries/Servo/LICENSE.txt`);
`LiquidCrystal`, `SPI`, `Wire`, and `EEPROM` are LGPL-2.1-or-later or more permissive
per-file. Individual files carry their own copyright headers, which are preserved intact —
this project does not modify the core sources.

**How this project uses it.** The core is compiled unmodified with the bundled avr-gcc and
archived into `core.a` with the LTO-aware `avr-gcc-ar`. The user's sketch is linked against
it. No core source is patched, and no custom `main()` is substituted for the core's own
`main.cpp`.

**Verbatim text — present in this directory** as `COPYING.LIB` (LGPL-2.1, FSF canonical,
SHA-256 `20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95`).

ArduinoCore-avr 1.8.3 has **no repository-root `LICENSE` file**; it declares its licence in
per-file headers, which direct the recipient to a copy of the LGPL — the copy supplied here.
The bundled Servo 1.2.2 library additionally carries its own verbatim LGPL-2.1 at
`runtime/arduino-avr/libraries/Servo/LICENSE.txt`. See `../PROVENANCE.md`.

**Obligation status.** Satisfied: the LGPL-2.1 text ships with the application, and the
core is used entirely unmodified at the pinned version 1.8.3, whose sources remain available
upstream.
