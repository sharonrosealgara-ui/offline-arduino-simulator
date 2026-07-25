# End-to-end offline compile smoke test: builds resources/examples/blink/sketch.ino
# with the vendored avr-gcc toolchain + ArduinoCore-avr, producing a flashable HEX.
# Mirrors the compile pipeline in apps/desktop/src/main/compiler/compiler-service.ts.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$tc   = Join-Path $root 'vendor\toolchains\win32-x64\bin'
$core = Join-Path $root 'vendor\arduino-avr\cores\arduino'
$var  = Join-Path $root 'vendor\arduino-avr\variants\standard'
$out  = Join-Path $root '_smoke'

New-Item -ItemType Directory -Force $out | Out-Null

# 1. Wrap sketch into a translation unit (Arduino.h + sketch body).
$sketch = Get-Content (Join-Path $root 'resources\examples\blink\sketch.ino') -Raw
"#include <Arduino.h>`n$sketch" | Set-Content (Join-Path $out 'sketch.cpp') -Encoding ascii

$cflags = @('-c','-g','-Os','-w','-std=gnu++11','-fpermissive','-fno-exceptions','-ffunction-sections','-fdata-sections','-fno-threadsafe-statics','-mmcu=atmega328p','-DF_CPU=16000000L','-DARDUINO=10819','-DARDUINO_AVR_UNO','-DARDUINO_ARCH_AVR',"-I$core","-I$var")

# 2. Compile the sketch TU.
& "$tc\avr-g++.exe" @cflags (Join-Path $out 'sketch.cpp') -o (Join-Path $out 'sketch.o')
if ($LASTEXITCODE -ne 0) { throw 'sketch compile failed' }

# 3. Compile the Arduino core (C and C++ units) into core.a.
$objs = @()
Get-ChildItem $core -Filter *.c | ForEach-Object {
  $o = Join-Path $out ($_.BaseName + '.c.o')
  & "$tc\avr-gcc.exe" -c -g -Os -w -std=gnu11 -ffunction-sections -fdata-sections -mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10819 -DARDUINO_AVR_UNO -DARDUINO_ARCH_AVR "-I$core" "-I$var" $_.FullName -o $o
  if ($LASTEXITCODE -ne 0) { throw "core C compile failed: $($_.Name)" }
  $objs += $o
}
Get-ChildItem $core -Filter *.cpp | ForEach-Object {
  $o = Join-Path $out ($_.BaseName + '.cpp.o')
  & "$tc\avr-g++.exe" @cflags $_.FullName -o $o
  if ($LASTEXITCODE -ne 0) { throw "core C++ compile failed: $($_.Name)" }
  $objs += $o
}
$coreLib = Join-Path $out 'core.a'
if (Test-Path $coreLib) { Remove-Item $coreLib }
foreach ($o in $objs) {
  & "$tc\avr-ar.exe" rcs $coreLib $o
  if ($LASTEXITCODE -ne 0) { throw 'ar failed' }
}

# 4. Link, then objcopy to HEX.
& "$tc\avr-gcc.exe" -w -Os -g -flto -fuse-linker-plugin '-Wl,--gc-sections' -mmcu=atmega328p -o (Join-Path $out 'sketch.elf') (Join-Path $out 'sketch.o') $coreLib '-lm'
if ($LASTEXITCODE -ne 0) { throw 'link failed' }
& "$tc\avr-objcopy.exe" -O ihex -R .eeprom (Join-Path $out 'sketch.elf') (Join-Path $out 'sketch.hex')
if ($LASTEXITCODE -ne 0) { throw 'objcopy failed' }

# 5. Report size.
& "$tc\avr-size.exe" (Join-Path $out 'sketch.elf')
$hex = Get-Item (Join-Path $out 'sketch.hex')
Write-Host "SMOKE_OK hex=$($hex.FullName) bytes=$($hex.Length)"
