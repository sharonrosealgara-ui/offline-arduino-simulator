import { describe, expect, it } from 'vitest';
import { buildVCD, captureFileName, type VcdChannel } from '../src/renderer/app/logic/exportVCD';

const F_CPU = 16_000_000;

const channels: VcdChannel[] = [
  { id: 'D13', edges: [{ cycle: 0, level: 0 }, { cycle: 16_000, level: 1 }, { cycle: 32_000, level: 0 }], initialLevel: 1 },
  { id: 'D1 TX', edges: [{ cycle: 16_000, level: 0 }], initialLevel: 1 },
];

describe('buildVCD', () => {
  it('emits a valid header with timescale and one $var per channel', () => {
    const vcd = buildVCD(channels, { fCpu: F_CPU });
    expect(vcd).toContain('$timescale 1ps $end');
    expect(vcd).toContain('$enddefinitions $end');
    expect((vcd.match(/\$var wire 1/g) ?? []).length).toBe(2);
  });

  it('sanitizes signal names (no whitespace in $var)', () => {
    const vcd = buildVCD(channels, { fCpu: F_CPU });
    expect(vcd).toContain('D1_TX');
    expect(vcd).not.toMatch(/\$var wire 1 . D1 TX/);
  });

  it('writes initial values in $dumpvars', () => {
    const vcd = buildVCD(channels, { fCpu: F_CPU });
    const dump = vcd.slice(vcd.indexOf('$dumpvars'), vcd.indexOf('$end', vcd.indexOf('$dumpvars')));
    expect(dump).toMatch(/1!/); // first channel initial high
  });

  it('produces monotonically increasing timestamps (16 MHz → 62500 ps/cycle)', () => {
    const vcd = buildVCD(channels, { fCpu: F_CPU });
    const times = [...vcd.matchAll(/^#(\d+)$/gm)].map((m) => Number(m[1]));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // 16_000 cycles * 62_500 ps = 1_000_000_000 ps.
    expect(times).toContain(1_000_000_000);
  });

  it('is deterministic for identical input', () => {
    const a = buildVCD(channels, { fCpu: F_CPU });
    const b = buildVCD(channels, { fCpu: F_CPU });
    // Ignore the $date line which is wall-clock.
    const strip = (s: string) => s.replace(/\$date.*\$end/, '');
    expect(strip(a)).toBe(strip(b));
  });

  it('marks a truncated capture', () => {
    const vcd = buildVCD(channels, { fCpu: F_CPU, truncated: true });
    expect(vcd).toMatch(/TRUNCATED/);
  });

  it('captureFileName follows offline-arduino-capture-YYYYMMDD-HHMMSS.vcd', () => {
    const name = captureFileName(new Date('2026-07-25T09:08:07'));
    expect(name).toBe('offline-arduino-capture-20260725-090807.vcd');
  });
});
