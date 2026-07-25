// Release gate: prove the bundled toolchain performs a REAL end-to-end build on a clean
// machine with no Arduino IDE / system AVR compiler / internet. (Setup spec §12)
//
// This is a full atmega328p pipeline: compile -> LTO link (-flto -fuse-linker-plugin)
// -> objcopy to Intel HEX -> avr-size -> strict HEX validation. It exercises exactly the
// paths a `--multilib` prune could break (avr5 multilib + LTO plugin), so a green run
// after pruning means the shipped compile pipeline still works.
//
// The sketch is a bare-register D13 blink using only <avr/io.h> (avr-libc, part of the
// toolchain) — it deliberately does NOT depend on the Arduino core being populated, so
// the smoke test runs anywhere the toolchain is present.
//
//   node scripts/smoke-compile.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const target = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? '.exe' : '';
const bin = path.resolve('vendor', 'toolchains', target, 'bin');
const tool = (name) => path.join(bin, `${name}${exe}`);

const gcc = tool('avr-gcc');
if (!existsSync(gcc)) {
  console.error(`[smoke-compile] Toolchain not populated for ${target}: ${gcc}`);
  console.error('Run scripts/fetch-toolchain.mjs first, or run this on a packaged build.');
  process.exit(2);
}

function run(label, file, args, cwd) {
  const res = spawnSync(file, args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`[smoke-compile] ${label} FAILED (exit ${res.status})`);
    console.error((res.stderr || res.stdout || res.error || '').toString().trim());
    process.exit(1);
  }
  return res.stdout ?? '';
}

const BLINK_C = `#include <avr/io.h>
/* Bare-register D13 (PB5) blink — exercises compile + LTO link + objcopy for atmega328p. */
static void busy(void) { for (volatile unsigned long i = 0; i < 60000UL; i++) { } }
int main(void) {
  DDRB |= (1 << PB5);
  for (;;) {
    PORTB ^= (1 << PB5);
    busy();
  }
}
`;

const work = mkdtempSync(path.join(tmpdir(), 'oas-smoke-'));
try {
  const c = path.join(work, 'Blink.c');
  const obj = path.join(work, 'Blink.o');
  const elf = path.join(work, 'Blink.elf');
  const hex = path.join(work, 'Blink.hex');
  writeFileSync(c, BLINK_C, 'utf8');

  console.log(`[smoke-compile] toolchain: ${run('version', gcc, ['--version']).split('\n')[0]}`);

  // 1) compile (mirrors build-recipe C flags)
  run('compile', gcc, [
    '-mmcu=atmega328p', '-DF_CPU=16000000L', '-Os', '-std=gnu11',
    '-ffunction-sections', '-fdata-sections', '-flto', '-c', c, '-o', obj,
  ], work);

  // 2) LTO link (mirrors build-recipe link flags — the multilib-sensitive step)
  run('link', gcc, [
    '-Os', '-flto', '-fuse-linker-plugin', '-Wl,--gc-sections',
    '-mmcu=atmega328p', '-o', elf, obj, '-lm',
  ], work);

  // 3) objcopy -> Intel HEX
  run('objcopy', tool('avr-objcopy'), ['-O', 'ihex', '-R', '.eeprom', elf, hex], work);

  // 4) size
  const sizeOut = run('size', tool('avr-size'), ['-A', elf], work);

  // 5) strict Intel HEX validation
  validateIntelHex(readFileSync(hex, 'utf8'));

  const text = /\.text\s+(\d+)/.exec(sizeOut)?.[1] ?? '?';
  const data = /\.data\s+(\d+)/.exec(sizeOut)?.[1] ?? '0';
  console.log(`[smoke-compile] ✓ Blink built & HEX validated  (flash .text=${text} B, .data=${data} B)`);
  console.log('[smoke-compile] Toolchain compile → LTO link → objcopy → HEX pipeline OK.');
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Minimal strict Intel HEX validator for the ATmega328P 32 KiB flash. */
function validateIntelHex(hexText) {
  const lines = hexText.replace(/\r\n?/g, '\n').split('\n');
  let sawEof = false;
  let dataBytes = 0;
  let base = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (sawEof) fail(`record after EOF (line ${i + 1})`);
    if (!line.startsWith(':')) fail(`record does not start with ':' (line ${i + 1})`);
    const b = line.slice(1);
    if (b.length % 2 !== 0 || b.length < 10) fail(`bad record length (line ${i + 1})`);
    const bytes = [];
    for (let j = 0; j < b.length; j += 2) {
      const byte = Number.parseInt(b.slice(j, j + 2), 16);
      if (Number.isNaN(byte)) fail(`invalid hex digit (line ${i + 1})`);
      bytes.push(byte);
    }
    const count = bytes[0];
    if (bytes.length !== count + 5) fail(`byte count mismatch (line ${i + 1})`);
    if ((bytes.reduce((s, x) => s + x, 0) & 0xff) !== 0) fail(`checksum failed (line ${i + 1})`);
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    if (type === 0x00) {
      const absolute = base + addr;
      if (absolute + count > 0x8000) fail(`data outside 32 KiB flash (line ${i + 1})`);
      dataBytes += count;
    } else if (type === 0x01) {
      sawEof = true;
    } else if (type === 0x02) {
      base = ((bytes[4] << 8) | bytes[5]) << 4;
    } else if (type === 0x04) {
      base = ((bytes[4] << 8) | bytes[5]) * 0x10000;
    } else if (type !== 0x03 && type !== 0x05) {
      fail(`unsupported record type 0x${type.toString(16)} (line ${i + 1})`);
    }
  }
  if (!sawEof) fail('missing EOF record');
  if (dataBytes === 0) fail('no program data');
}

function fail(msg) {
  console.error(`[smoke-compile] Intel HEX validation FAILED: ${msg}`);
  process.exit(1);
}
