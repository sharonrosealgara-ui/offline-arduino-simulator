/**
 * HD44780-compatible 16x2 LCD controller, 4-bit mode only. Source: spec §11.4.
 *
 * Supported pins: VSS, VDD, VO, RS, RW, E, D4-D7, A, K. D0-D3 may be drawn but are
 * inactive. Requires RW=0 (write-only); RW=1 raises LCD_READ_UNSUPPORTED and does not
 * drive the data bus. Behavior is validated against the datasheet shipped in the
 * project's offline engineering references before release (spec §20).
 *
 * MVP simplification: DDRAM is modeled only over the visible 16x2 window (row 0 =
 * 0x00-0x0F, row 1 = 0x40-0x4F); full 40-byte-per-row scrolling is not implemented.
 * Cursor/display shift commands move the address counter but do not scroll a hidden
 * window. This does not affect the required Hello World / two-line addressing tests.
 */
import type { CircuitDiagnostic } from '@offline-arduino/contracts/simulator';

const F_CPU = 16_000_000;
const DDRAM_SIZE = 0x68; // 0x00..0x67, per the worker-interface comment in spec §5.1/§11.4
const CGRAM_SIZE = 64;
const ROW0_BASE = 0x00;
const ROW1_BASE = 0x40;
const ROW_VISIBLE_WIDTH = 16;
const BUSY_WARNING_COOLDOWN_CYCLES = 16_000; // ~1ms at 16MHz, avoids flooding

function cyclesForMicros(micros: number): number {
  return Math.round((micros / 1_000_000) * F_CPU);
}

const CLEAR_HOME_BUSY_CYCLES = cyclesForMicros(1520);
const ORDINARY_BUSY_CYCLES = cyclesForMicros(37);

export type Hd44780Logic = 0 | 1 | 'X';

export interface Hd44780Frame {
  rows: [string, string];
  cursorAddress: number;
  displayOn: boolean;
  cursorOn: boolean;
  blinkOn: boolean;
}

export class Hd44780Runtime {
  private mode: 'await-init' | 'four-bit' = 'await-init';
  private pendingHighNibble: number | null = null;
  private ddram = new Uint8Array(DDRAM_SIZE).fill(0x20);
  private cgram = new Uint8Array(CGRAM_SIZE);
  private addressCounter = 0;
  private addressSpace: 'ddram' | 'cgram' = 'ddram';
  private displayOn = false;
  private cursorOn = false;
  private blinkOn = false;
  private increment = true;
  private twoLine = true;
  private busyUntilCycle = 0;
  private lastEnable: Hd44780Logic = 'X';
  private lastBusyWarningCycle = -Infinity;

  constructor(private readonly id: string) {}

  /**
   * Call on every settle with the currently solved E/RS/RW/D7..D4 logic values. Only
   * acts on a High->Low transition of E (the falling-edge latch per the datasheet).
   */
  observe(
    rs: Hd44780Logic,
    rw: Hd44780Logic,
    e: Hd44780Logic,
    d7: Hd44780Logic,
    d6: Hd44780Logic,
    d5: Hd44780Logic,
    d4: Hd44780Logic,
    cycle: number,
  ): CircuitDiagnostic[] {
    const diagnostics: CircuitDiagnostic[] = [];
    const wasHigh = this.lastEnable === 1;
    this.lastEnable = e;
    if (!(wasHigh && e === 0)) return diagnostics;

    if (rw === 1) {
      diagnostics.push({
        id: `LCD_READ_UNSUPPORTED:${this.id}`,
        severity: 'warning',
        code: 'LCD_READ_UNSUPPORTED',
        message: 'Tie RW to GND for write-only 4-bit mode.',
        componentIds: [this.id],
      });
      return diagnostics;
    }

    if (cycle < this.busyUntilCycle) {
      if (cycle - this.lastBusyWarningCycle > BUSY_WARNING_COOLDOWN_CYCLES) {
        this.lastBusyWarningCycle = cycle;
        diagnostics.push({
          id: `LCD_BUSY_WRITE:${this.id}`,
          severity: 'warning',
          code: 'LCD_BUSY_WRITE',
          message: 'Wait for the LCD command to finish.',
          componentIds: [this.id],
        });
      }
      return diagnostics;
    }

    const nibble = (bit(d7) << 3) | (bit(d6) << 2) | (bit(d5) << 1) | bit(d4);

    if (this.mode === 'await-init') {
      this.handleInitNibble(nibble);
      return diagnostics;
    }

    if (this.pendingHighNibble === null) {
      this.pendingHighNibble = nibble;
      return diagnostics;
    }
    const byte = (this.pendingHighNibble << 4) | nibble;
    this.pendingHighNibble = null;

    if (rs === 1) this.writeData(byte, cycle);
    else this.executeCommand(byte, cycle);

    return diagnostics;
  }

  private handleInitNibble(nibble: number): void {
    if (nibble === 0x3) return; // still in the 0x3,0x3,0x3 emulation phase (tolerant timing)
    if (nibble === 0x2) {
      this.mode = 'four-bit';
      this.pendingHighNibble = null;
    }
    // Any other stray nibble during init is ignored (classroom-tolerant).
  }

  private executeCommand(byte: number, cycle: number): void {
    if (byte & 0x80) {
      this.addressSpace = 'ddram';
      this.addressCounter = byte & 0x7f;
      this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
      return;
    }
    if (byte & 0x40) {
      this.addressSpace = 'cgram';
      this.addressCounter = byte & 0x3f;
      this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
      return;
    }
    if (byte & 0x20) {
      // Function set: DL(4) N(3) F(2). DL=1 (8-bit) is unsupported in this runtime.
      const eightBit = (byte & 0x10) !== 0;
      this.twoLine = (byte & 0x08) !== 0;
      this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
      if (eightBit) {
        // Surfaced by circuit-runtime as a diagnostic via a dedicated check, since this
        // method only returns edge-triggered command diagnostics for RW/busy above.
        this.unsupportedEightBitRequested = true;
      }
      return;
    }
    if (byte & 0x10) {
      // Cursor/display shift. S/C bit4(0x08), R/L bit2(0x04).
      const direction = byte & 0x04 ? 1 : -1;
      this.addressCounter = this.wrapAddress(this.addressCounter + direction);
      this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
      return;
    }
    if (byte & 0x08) {
      this.displayOn = (byte & 0x04) !== 0;
      this.cursorOn = (byte & 0x02) !== 0;
      this.blinkOn = (byte & 0x01) !== 0;
      this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
      return;
    }
    if (byte & 0x04) {
      this.increment = (byte & 0x02) !== 0;
      this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
      return;
    }
    if ((byte & 0xfe) === 0x02) {
      this.addressCounter = 0;
      this.addressSpace = 'ddram';
      this.busyUntilCycle = cycle + CLEAR_HOME_BUSY_CYCLES;
      return;
    }
    if (byte === 0x01) {
      this.ddram.fill(0x20);
      this.addressCounter = 0;
      this.addressSpace = 'ddram';
      this.increment = true;
      this.busyUntilCycle = cycle + CLEAR_HOME_BUSY_CYCLES;
      return;
    }
    // Unknown/unsupported command byte: ignore (classroom-tolerant).
  }

  private unsupportedEightBitRequested = false;

  /** Consumed by circuit-runtime once per settle to surface LCD_UNSUPPORTED_CONFIGURATION. */
  takeUnsupportedEightBitFlag(): boolean {
    const flagged = this.unsupportedEightBitRequested;
    this.unsupportedEightBitRequested = false;
    return flagged;
  }

  private writeData(byte: number, cycle: number): void {
    if (this.addressSpace === 'cgram') {
      this.cgram[this.addressCounter % CGRAM_SIZE] = byte;
      this.addressCounter = (this.addressCounter + (this.increment ? 1 : -1) + CGRAM_SIZE) % CGRAM_SIZE;
    } else {
      this.ddram[this.addressCounter % DDRAM_SIZE] = byte;
      this.addressCounter = this.wrapAddress(this.addressCounter + (this.increment ? 1 : -1));
    }
    this.busyUntilCycle = cycle + ORDINARY_BUSY_CYCLES;
  }

  private wrapAddress(address: number): number {
    const m = ((address % DDRAM_SIZE) + DDRAM_SIZE) % DDRAM_SIZE;
    return m;
  }

  private renderRow(base: number): string {
    let text = '';
    for (let i = 0; i < ROW_VISIBLE_WIDTH; i += 1) {
      const byte = this.ddram[base + i] ?? 0x20;
      text += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ' ';
    }
    return text;
  }

  takeFrame(): Hd44780Frame {
    return {
      rows: [this.renderRow(ROW0_BASE), this.twoLine ? this.renderRow(ROW1_BASE) : ''],
      cursorAddress: this.addressCounter,
      displayOn: this.displayOn,
      cursorOn: this.cursorOn,
      blinkOn: this.blinkOn,
    };
  }
}

function bit(logic: Hd44780Logic): number {
  return logic === 1 ? 1 : 0;
}
