import { describe, expect, it } from 'vitest';
import { parseIntelHex } from '../src/intel-hex';

/** A minimal, valid two-line Intel HEX program (LDI r16,1 style bytes aren't required — any valid data works). */
function checksum(bytesExcludingChecksum: number[]): number {
  const sum = bytesExcludingChecksum.reduce((a, b) => a + b, 0);
  return (0x100 - (sum & 0xff)) & 0xff;
}

function dataRecord(address: number, data: number[]): string {
  const count = data.length;
  const bytes = [count, (address >> 8) & 0xff, address & 0xff, 0x00, ...data];
  return `:${bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}${checksum(bytes)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`;
}

const EOF_RECORD = ':00000001FF';

describe('parseIntelHex', () => {
  it('parses a valid Uno HEX with correct byte count', () => {
    const hex = [dataRecord(0, [0x0c, 0x94, 0x34, 0x00]), EOF_RECORD].join('\n');
    const result = parseIntelHex(hex);
    expect(result.flashBytesUsed).toBe(4);
    expect(result.program[0]).toBe(0x940c);
    expect(result.program[1]).toBe(0x0034);
  });

  it('accepts CRLF and a blank trailing line', () => {
    const hex = [dataRecord(0, [0x01, 0x02]), EOF_RECORD, ''].join('\r\n');
    expect(() => parseIntelHex(hex)).not.toThrow();
  });

  it('rejects a bad checksum', () => {
    const bad = dataRecord(0, [0x01, 0x02]).slice(0, -2) + '00';
    expect(() => parseIntelHex([bad, EOF_RECORD].join('\n'))).toThrow(/checksum/i);
  });

  it('rejects a bad byte count', () => {
    const line = ':03000000010203FF'; // declares 3 bytes, only supplies matching-but-wrong checksum context is fine; corrupt count instead
    const corrupted = ':05000000010203FF00'; // count=5 but only 3 data bytes present structurally invalid length
    expect(() => parseIntelHex([corrupted, EOF_RECORD].join('\n'))).toThrow();
    void line;
  });

  it('rejects an invalid hex digit', () => {
    const line = ':02000000ZZ' + '00';
    expect(() => parseIntelHex([line, EOF_RECORD].join('\n'))).toThrow(/invalid hexadecimal/i);
  });

  it('rejects missing EOF', () => {
    const hex = dataRecord(0, [0x01, 0x02]);
    expect(() => parseIntelHex(hex)).toThrow(/no EOF/i);
  });

  it('rejects data after EOF', () => {
    const hex = [dataRecord(0, [0x01, 0x02]), EOF_RECORD, dataRecord(2, [0x03])].join('\n');
    expect(() => parseIntelHex(hex)).toThrow(/after EOF/i);
  });

  it('rejects an out-of-flash address', () => {
    // 32 KiB flash = 0x8000. Address 0x7ffe + 4 bytes = 0x8002, which overflows.
    const hex = [dataRecord(0x7ffe, [0x01, 0x02, 0x03, 0x04]), EOF_RECORD].join('\n');
    expect(() => parseIntelHex(hex)).toThrow(/exceeds ATmega328P flash/i);
  });

  it('handles type 02 (extended segment address) records', () => {
    // Segment 0x0010 -> base address 0x0010 << 4 = 0x100
    const segBytes = [2, 0, 0, 0x02, 0x00, 0x10];
    const segRecord = `:${segBytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}${checksum(segBytes)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()}`;
    const hex = [segRecord, dataRecord(0, [0xaa, 0xbb]), EOF_RECORD].join('\n');
    const result = parseIntelHex(hex);
    // absolute address = 0x100 + 0 = 0x100 -> word index 0x80
    expect(result.program[0x80]).toBe(0xbbaa);
  });

  it('handles type 04 (extended linear address) records', () => {
    const linBytes = [2, 0, 0, 0x04, 0x00, 0x00]; // upper 16 bits = 0 -> base 0
    const linRecord = `:${linBytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}${checksum(linBytes)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()}`;
    const hex = [linRecord, dataRecord(0, [0x11, 0x22]), EOF_RECORD].join('\n');
    const result = parseIntelHex(hex);
    expect(result.program[0]).toBe(0x2211);
  });

  it('rejects conflicting overlapping data', () => {
    const hex = [dataRecord(0, [0x01, 0x02]), dataRecord(0, [0x99, 0x02]), EOF_RECORD].join('\n');
    expect(() => parseIntelHex(hex)).toThrow(/conflicting/i);
  });

  it('allows identical overlapping data', () => {
    const hex = [dataRecord(0, [0x01, 0x02]), dataRecord(0, [0x01, 0x02]), EOF_RECORD].join('\n');
    expect(() => parseIntelHex(hex)).not.toThrow();
  });

  it('leaves unused flash as 0xffff', () => {
    const hex = [dataRecord(0, [0x01, 0x02]), EOF_RECORD].join('\n');
    const result = parseIntelHex(hex);
    expect(result.program[1000]).toBe(0xffff);
  });

  it('rejects empty input', () => {
    expect(() => parseIntelHex('')).toThrow();
  });

  it('rejects input exceeding the 1 MiB safety limit', () => {
    const huge = 'A'.repeat(1024 * 1024 + 1);
    expect(() => parseIntelHex(huge)).toThrow(/1 MiB/);
  });
});
