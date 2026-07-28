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

**Canonical text.** `LICENSE` at the root of the ArduinoCore-avr repository. See
`../README.md` for how to restore it into this tree — it is currently absent, apart from the
`Servo` notice noted above.

**Obligation status.** Attribution is recorded here. Because the core is dynamically
relinkable-in-principle static code under LGPL-2.1, distribution should ship the LGPL text
and note that the core sources are available unmodified upstream at the pinned version.
Tracked as a release blocker.
