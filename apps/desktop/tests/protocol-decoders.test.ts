import { describe, expect, it } from 'vitest';
import { decodeUART, decodeI2C, decodeSPI } from '../src/renderer/app/logic/protocolDecoders';
import type { LogicEdge } from '../src/renderer/app/logic/logic-types';

const F_CPU = 16_000_000;

/** Build UART TX edges for one 8N1 byte (LSB-first, idle high). */
function uartByte(byte: number, startCycle: number, baud = 9600): LogicEdge[] {
  const bit = Math.round(F_CPU / baud);
  const data = Array.from({ length: 8 }, (_, i) => (byte >> i) & 1);
  const slots = [0, ...data, 1]; // start, d0..d7 (LSB first), stop
  const edges: LogicEdge[] = [];
  let prev: 0 | 1 = 1;
  slots.forEach((lvl, k) => {
    const level = lvl as 0 | 1;
    if (level !== prev) {
      edges.push({ cycle: startCycle + k * bit, level });
      prev = level;
    }
  });
  return edges;
}

/** Build a UART byte with a broken (low) stop bit → framing error. */
function uartByteBadStop(byte: number, startCycle: number, baud = 9600): LogicEdge[] {
  const bit = Math.round(F_CPU / baud);
  const data = Array.from({ length: 8 }, (_, i) => (byte >> i) & 1);
  const slots = [0, ...data, 0]; // stop forced LOW
  const edges: LogicEdge[] = [];
  let prev: 0 | 1 = 1;
  slots.forEach((lvl, k) => {
    const level = lvl as 0 | 1;
    if (level !== prev) {
      edges.push({ cycle: startCycle + k * bit, level });
      prev = level;
    }
  });
  return edges;
}

describe('decodeUART', () => {
  it('decodes a valid 9600 8N1 byte to hex + ASCII', () => {
    const out = decodeUART(uartByte(0x41, 0), { baud: 9600, fCpu: F_CPU });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('data');
    expect(out[0].text).toContain('0x41');
    expect(out[0].text).toContain("'A'");
  });

  it('decodes multiple consecutive bytes', () => {
    const bit = Math.round(F_CPU / 9600);
    const frame = 10 * bit;
    const edges = [...uartByte(0x48, 0), ...uartByte(0x69, frame)]; // 'H', 'i'
    const out = decodeUART(edges, { baud: 9600, fCpu: F_CPU });
    expect(out).toHaveLength(2);
    expect(out[0].text).toContain("'H'");
    expect(out[1].text).toContain("'i'");
  });

  it('flags a framing error when the stop bit is low', () => {
    const out = decodeUART(uartByteBadStop(0x41, 0), { baud: 9600, fCpu: F_CPU });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('error');
  });

  it('tolerates an empty / partial capture without throwing', () => {
    expect(() => decodeUART([], { baud: 9600, fCpu: F_CPU })).not.toThrow();
    expect(decodeUART([], { baud: 9600, fCpu: F_CPU })).toEqual([]);
    // A lone start edge (partial) must not throw.
    expect(() => decodeUART([{ cycle: 0, level: 0 }], { baud: 9600, fCpu: F_CPU })).not.toThrow();
  });
});

// ---- I2C ------------------------------------------------------------------------------
function i2cTransaction(
  addr7: number,
  rw: 0 | 1,
  dataBytes: number[],
  opts: { ackData?: boolean } = {},
): { sda: LogicEdge[]; scl: LogicEdge[] } {
  const sda: LogicEdge[] = [];
  const scl: LogicEdge[] = [];
  let t = 0;
  const S = 50;
  let curSda: 0 | 1 = 1;
  let curScl: 0 | 1 = 1;
  const setSda = (v: 0 | 1): void => {
    if (v !== curSda) {
      sda.push({ cycle: t, level: v });
      curSda = v;
    }
  };
  const setScl = (v: 0 | 1): void => {
    if (v !== curScl) {
      scl.push({ cycle: t, level: v });
      curScl = v;
    }
  };
  t += S;
  setSda(0); // START (SDA falls while SCL high)
  t += S;
  const sendBit = (bit: 0 | 1): void => {
    setScl(0);
    t += S;
    setSda(bit);
    t += S;
    setScl(1); // sample edge
    t += S;
    t += S;
  };
  const sendByte = (byte: number, ackBit: 0 | 1): void => {
    for (let i = 7; i >= 0; i -= 1) sendBit(((byte >> i) & 1) as 0 | 1);
    sendBit(ackBit);
  };
  sendByte(((addr7 << 1) | rw) & 0xff, 0); // address + ACK
  const ack: 0 | 1 = opts.ackData === false ? 1 : 0;
  for (const d of dataBytes) sendByte(d, ack);
  // STOP: SCL low, SDA low, SCL high, SDA rises while SCL high
  setScl(0);
  t += S;
  setSda(0);
  t += S;
  setScl(1);
  t += S;
  setSda(1);
  t += S;
  return { sda, scl };
}

describe('decodeI2C', () => {
  it('decodes START, 7-bit address + W, ACK, and STOP', () => {
    const { sda, scl } = i2cTransaction(0x50, 0, []);
    const out = decodeI2C(sda, scl);
    const texts = out.map((a) => a.text);
    expect(texts).toContain('START');
    expect(out.some((a) => a.text.includes('0x50') && a.text.includes('W'))).toBe(true);
    expect(texts).toContain('ACK');
    expect(texts).toContain('STOP');
  });

  it('decodes a data byte and a read direction', () => {
    const { sda, scl } = i2cTransaction(0x3c, 1, [0xab]);
    const out = decodeI2C(sda, scl);
    expect(out.some((a) => a.text.includes('0x3C') && a.text.includes('R'))).toBe(true);
    expect(out.some((a) => a.text.includes('0xAB'))).toBe(true);
  });

  it('flags NACK when the data byte is not acknowledged', () => {
    const { sda, scl } = i2cTransaction(0x50, 0, [0x00], { ackData: false });
    const out = decodeI2C(sda, scl);
    expect(out.some((a) => a.text === 'NACK')).toBe(true);
  });

  it('tolerates an empty capture', () => {
    expect(() => decodeI2C([], [])).not.toThrow();
    expect(decodeI2C([], [])).toEqual([]);
  });

  it('handles an incomplete transaction (START with no STOP) without throwing', () => {
    const { sda, scl } = i2cTransaction(0x50, 0, [0xab]);
    // Drop the trailing STOP edges: keep everything before the last SDA rise.
    const lastSda = sda[sda.length - 1].cycle;
    const out = decodeI2C(
      sda.filter((e) => e.cycle < lastSda),
      scl.filter((e) => e.cycle < lastSda),
    );
    expect(out.some((a) => a.text === 'START')).toBe(true);
    expect(out.some((a) => a.text === 'STOP')).toBe(false);
  });
});

// ---- SPI ------------------------------------------------------------------------------
function spiTransaction(
  bytes: number[],
  opts: { cpol?: 0 | 1 } = {},
): { sck: LogicEdge[]; mosi: LogicEdge[]; cs: LogicEdge[] } {
  const cpol = opts.cpol ?? 0;
  const sck: LogicEdge[] = [];
  const mosi: LogicEdge[] = [];
  const cs: LogicEdge[] = [];
  let t = 0;
  const S = 50;
  let curSck: 0 | 1 = cpol;
  let curMosi: 0 | 1 = 0;
  let curCs: 0 | 1 = 1;
  const setSck = (v: 0 | 1): void => {
    if (v !== curSck) {
      sck.push({ cycle: t, level: v });
      curSck = v;
    }
  };
  const setMosi = (v: 0 | 1): void => {
    if (v !== curMosi) {
      mosi.push({ cycle: t, level: v });
      curMosi = v;
    }
  };
  const setCs = (v: 0 | 1): void => {
    if (v !== curCs) {
      cs.push({ cycle: t, level: v });
      curCs = v;
    }
  };
  t += S;
  setCs(0);
  t += S;
  const leading: 0 | 1 = cpol === 0 ? 1 : 0;
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) {
      setMosi(((byte >> i) & 1) as 0 | 1);
      t += S;
      setSck(leading); // sampling edge for CPHA=0
      t += S;
      setSck(cpol); // trailing edge
      t += S;
    }
  }
  setCs(1);
  t += S;
  return { sck, mosi, cs };
}

describe('decodeSPI', () => {
  it('decodes an MSB-first byte in mode 0 with chip-select', () => {
    const { sck, mosi, cs } = spiTransaction([0xa5], { cpol: 0 });
    const out = decodeSPI(sck, mosi, null, cs, { cpol: 0, cpha: 0, bitOrder: 'msb' });
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('0xA5');
  });

  it('decodes in mode 3 (CPOL=1, CPHA=1)', () => {
    const { sck, mosi, cs } = spiTransaction([0xa5], { cpol: 1 });
    const out = decodeSPI(sck, mosi, null, cs, { cpol: 1, cpha: 1, bitOrder: 'msb' });
    expect(out.some((a) => a.text.includes('0xA5'))).toBe(true);
  });

  it('does not emit a byte for an incomplete (7-clock) transfer', () => {
    const { sck, mosi, cs } = spiTransaction([0xa5], { cpol: 0 });
    // Drop the last sampling edge → only 7 bits clocked.
    const rises = sck.filter((e) => e.level === 1);
    const lastRise = rises[rises.length - 1].cycle;
    const truncatedSck = sck.filter((e) => e.cycle < lastRise);
    const out = decodeSPI(truncatedSck, mosi, null, cs, { cpol: 0, cpha: 0, bitOrder: 'msb' });
    expect(out).toHaveLength(0);
  });

  it('tolerates an empty capture', () => {
    expect(() => decodeSPI([], [], null, null, {})).not.toThrow();
  });
});
