# `vendor/` — immutable runtime build inputs

Everything here is **build input**, copied into installers via `electron-builder.yml`
`extraResources` (outside `app.asar`). None of it is fetched at runtime. The binary
payloads are **not committed to git** (see the root `.gitignore`); CI populates them
from `toolchain-lock.json` with checksum verification before packaging.

## Expected layout

```
vendor/
├─ toolchains/
│  ├─ win32-x64/
│  │  ├─ bin/            avr-gcc.exe avr-g++.exe avr-ar.exe avr-objcopy.exe avr-size.exe *.dll
│  │  ├─ avr/            include/ lib/   (headers, device specs, linker scripts, avr-libc)
│  │  ├─ lib/            lib/gcc/avr/<version>/   (libgcc, internal libs)
│  │  ├─ libexec/
│  │  └─ manifest.json   every runtime file + SHA-256
│  ├─ darwin-x64/        (same shape; Mach-O, no .exe/.dll)
│  ├─ darwin-arm64/
│  └─ linux-x64/         (built against the oldest supported glibc baseline)
├─ arduino-avr/
│  ├─ cores/arduino/     Arduino AVR core source
│  ├─ variants/standard/ pins_arduino.h for the Uno
│  ├─ libraries/         ONLY explicitly supported libs (EEPROM, SPI, Wire, LiquidCrystal, Servo)
│  ├─ boards.txt
│  ├─ platform.txt
│  └─ manifest.json
└─ licenses/             exact license texts for every redistributed component
```

## Rules (from the setup spec §4.3)

- **Preserve the complete tested toolchain layout.** GCC discovers its internal
  executables, specs, headers, startup objects, and libraries relative to its install
  prefix. Copying only `bin/avr-gcc` is invalid.
- Windows builds must include the DLLs the executables need.
- Linux builds must be tested on the oldest supported distribution.
- macOS executables/libraries need valid permissions before signing; never modify a
  bundled executable after signing.
- Populate with `node scripts/fetch-toolchain.mjs` (checksum-locked). Verify with
  `node scripts/verify-toolchains.mjs`.

Until the toolchain is populated, the app still launches; the Compile action fails
cleanly with `TOOLCHAIN_MISSING`.
