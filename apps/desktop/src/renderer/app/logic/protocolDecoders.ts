/**
 * Real-time protocol decoders operating on cycle-accurate LogicEdge lists.
 *
 * These are pure functions (no UI, no store) so they are trivially testable and can run
 * over a windowed or full capture. Each returns annotation spans the canvas overlays.
 *
 * Assumptions are classroom-standard and documented per decoder; they cover the bundled
 * Serial / Wire / SPI examples.
 */
import { F_CPU, levelAtCycle, type LogicEdge } from './logic-types';

export interface Annotation {
  startCycle: number;
  endCycle: number;
  /** Short label drawn in the span (e.g. "0x41 'A'", "START", "ACK"). */
  text: string;
  /** Rough class for coloring. */
  kind: 'frame' | 'data' | 'control' | 'error';
}

export type ProtocolKind = 'uart' | 'i2c' | 'spi';

// ---------------------------------------------------------------------------------------
// UART — async, LSB-first, idle-high. Start bit (low), N data bits, optional parity, stop.
// ---------------------------------------------------------------------------------------
export interface UartOptions {
  baud: number;
  dataBits?: 5 | 6 | 7 | 8 | 9;
  parity?: 'none' | 'even' | 'odd';
  stopBits?: 1 | 2;
  fCpu?: number;
}

function asciiLabel(value: number): string {
  const hex = `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  return value >= 0x20 && value <= 0x7e ? `${hex} '${String.fromCharCode(value)}'` : hex;
}

export function decodeUART(txEdges: LogicEdge[], opts: UartOptions): Annotation[] {
  const fCpu = opts.fCpu ?? F_CPU;
  const dataBits = opts.dataBits ?? 8;
  const parity = opts.parity ?? 'none';
  const stopBits = opts.stopBits ?? 1;
  const bit = fCpu / opts.baud; // cycles per bit
  if (!Number.isFinite(bit) || bit <= 0 || txEdges.length === 0) return [];

  const out: Annotation[] = [];

  // Edge-driven: every falling edge (line -> low) is a candidate start bit. Edges that
  // fall inside an already-decoded frame are skipped. This handles captures that begin
  // exactly at a start bit and back-to-back frames with no idle gap.
  let lastFrameEnd = -Infinity;
  for (const edge of txEdges) {
    if (edge.level !== 0) continue;
    if (edge.cycle < lastFrameEnd) continue;
    const frameStart = edge.cycle;

    // Sample data bits at bit centers (data bit 0 center = start + 1.5 bit).
    let value = 0;
    let ones = 0;
    for (let i = 0; i < dataBits; i += 1) {
      const b = levelAtCycle(txEdges, frameStart + bit * (1.5 + i), 1);
      if (b) {
        value |= 1 << i; // LSB-first
        ones += 1;
      }
    }

    let framingOk = true;
    let bitsConsumed = 1 + dataBits;
    if (parity !== 'none') {
      const p = levelAtCycle(txEdges, frameStart + bit * (1.5 + dataBits), 1);
      const expectEven = ones % 2 === 0;
      const ok = parity === 'even' ? p === (expectEven ? 0 : 1) : p === (expectEven ? 1 : 0);
      if (!ok) framingOk = false;
      bitsConsumed += 1;
    }
    // Stop bit(s) must be high.
    const stopSample = frameStart + bit * (1.5 + dataBits + (parity !== 'none' ? 1 : 0));
    if (levelAtCycle(txEdges, stopSample, 1) !== 1) framingOk = false;
    bitsConsumed += stopBits;

    const frameEnd = frameStart + bit * bitsConsumed;
    out.push({
      startCycle: frameStart,
      endCycle: frameEnd,
      text: framingOk ? asciiLabel(value) : `${asciiLabel(value)} !`,
      kind: framingOk ? 'data' : 'error',
    });
    lastFrameEnd = frameEnd;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// I2C — SDA falling while SCL high = START; SDA rising while SCL high = STOP. Bits sampled
// on SCL rising edges, MSB-first, 8 bits + ACK. First byte after START = addr(7)+R/W(1).
// ---------------------------------------------------------------------------------------
export function decodeI2C(sdaEdges: LogicEdge[], sclEdges: LogicEdge[]): Annotation[] {
  if (sclEdges.length === 0 && sdaEdges.length === 0) return [];
  const out: Annotation[] = [];

  // Merge both lines into one time-ordered event stream. At an identical cycle process
  // SCL before SDA so a same-cycle sample sees the settled clock (defensive; our model
  // never changes both lines on the same cycle).
  type Ev = { cycle: number; line: 'scl' | 'sda'; level: 0 | 1 };
  const events: Ev[] = [
    ...sclEdges.map((e) => ({ cycle: e.cycle, line: 'scl' as const, level: e.level })),
    ...sdaEdges.map((e) => ({ cycle: e.cycle, line: 'sda' as const, level: e.level })),
  ].sort((a, b) => a.cycle - b.cycle || (a.line === b.line ? 0 : a.line === 'scl' ? -1 : 1));

  // Idle levels just before the first event (both lines pulled high).
  let scl = levelAtCycle(sclEdges, (events[0]?.cycle ?? 0) - 1, 1);
  let sda = levelAtCycle(sdaEdges, (events[0]?.cycle ?? 0) - 1, 1);

  let inFrame = false;
  let bitCount = 0;
  let value = 0;
  let byteStart = 0;
  let expectAddress = false;

  for (const ev of events) {
    if (ev.line === 'scl') {
      const rising = scl === 0 && ev.level === 1;
      scl = ev.level;
      if (!rising || !inFrame) continue;
      // Sample SDA on the SCL rising edge (data is stable while SCL is high).
      if (bitCount === 0) byteStart = ev.cycle;
      if (bitCount < 8) {
        value = (value << 1) | sda; // MSB-first
        bitCount += 1;
      } else {
        const isAck = sda === 0;
        if (expectAddress) {
          out.push({
            startCycle: byteStart,
            endCycle: ev.cycle,
            text: `ADDR 0x${(value >> 1).toString(16).toUpperCase()} ${value & 1 ? 'R' : 'W'}`,
            kind: 'frame',
          });
          expectAddress = false;
        } else {
          out.push({
            startCycle: byteStart,
            endCycle: ev.cycle,
            text: `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
            kind: 'data',
          });
        }
        out.push({ startCycle: ev.cycle, endCycle: ev.cycle, text: isAck ? 'ACK' : 'NACK', kind: isAck ? 'control' : 'error' });
        bitCount = 0;
        value = 0;
      }
    } else {
      const prev = sda;
      sda = ev.level;
      if (scl !== 1) continue; // START/STOP only occur while SCL is high
      if (prev === 1 && ev.level === 0) {
        // SDA falling while SCL high = (repeated) START
        out.push({ startCycle: ev.cycle, endCycle: ev.cycle, text: inFrame ? 'REPEATED START' : 'START', kind: 'control' });
        inFrame = true;
        bitCount = 0;
        value = 0;
        expectAddress = true;
      } else if (prev === 0 && ev.level === 1) {
        // SDA rising while SCL high = STOP
        out.push({ startCycle: ev.cycle, endCycle: ev.cycle, text: 'STOP', kind: 'control' });
        inFrame = false;
        bitCount = 0;
        value = 0;
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------------------
// SPI — sample MOSI/MISO on the SCK sampling edge, MSB-first, framed by CS (active-low).
// Defaults to mode 0 (CPOL=0, CPHA=0 → sample on rising SCK).
// ---------------------------------------------------------------------------------------
export interface SpiOptions {
  cpol?: 0 | 1;
  cpha?: 0 | 1;
  bitOrder?: 'msb' | 'lsb';
}

export function decodeSPI(
  sckEdges: LogicEdge[],
  mosiEdges: LogicEdge[],
  misoEdges: LogicEdge[] | null,
  csEdges: LogicEdge[] | null,
  opts: SpiOptions = {},
): Annotation[] {
  const cpol = opts.cpol ?? 0;
  const cpha = opts.cpha ?? 0;
  const msb = (opts.bitOrder ?? 'msb') === 'msb';
  // Sampling edge: mode0/mode3 sample on the "leading" edge for CPHA=0.
  const sampleLevel: 0 | 1 = cpha === 0 ? (cpol === 0 ? 1 : 0) : cpol === 0 ? 0 : 1;

  const samplePoints = sckEdges.filter((e) => e.level === sampleLevel).map((e) => e.cycle);
  if (samplePoints.length === 0) return [];

  const out: Annotation[] = [];
  let mosi = 0;
  let miso = 0;
  let bit = 0;
  let byteStart = 0;

  const csActive = (cycle: number): boolean => (csEdges ? levelAtCycle(csEdges, cycle, 1) === 0 : true);

  for (const cycle of samplePoints) {
    if (!csActive(cycle)) {
      bit = 0;
      mosi = 0;
      miso = 0;
      continue;
    }
    if (bit === 0) byteStart = cycle;
    const mo = levelAtCycle(mosiEdges, cycle, 0);
    const mi = misoEdges ? levelAtCycle(misoEdges, cycle, 0) : 0;
    if (msb) {
      mosi = (mosi << 1) | mo;
      miso = (miso << 1) | mi;
    } else {
      mosi |= mo << bit;
      miso |= mi << bit;
    }
    bit += 1;
    if (bit === 8) {
      const mosiHex = `0x${mosi.toString(16).toUpperCase().padStart(2, '0')}`;
      const misoHex = misoEdges ? ` / ${`0x${miso.toString(16).toUpperCase().padStart(2, '0')}`}` : '';
      out.push({ startCycle: byteStart, endCycle: cycle, text: `${mosiHex}${misoHex}`, kind: 'data' });
      bit = 0;
      mosi = 0;
      miso = 0;
    }
  }
  return out;
}
