/**
 * Main-process Intel HEX acceptance policy. Treats the freshly-compiled `firmware.hex`
 * as UNTRUSTED compiler output before it crosses IPC. Source: setup spec §5.5.
 *
 * This is intentionally a SEPARATE implementation from the worker's
 * packages/simulator/src/intel-hex.ts (which does its own second, independent
 * validation pass as a trust boundary in its own right, per the worker spec §4). The
 * two modules are allowed to diverge slightly in bookkeeping (this one enforces a
 * 512 KiB text-payload cap and the board's flashMaxBytes; it also renormalizes text
 * formatting), but the core Intel HEX rules are the same.
 */
import type { BoardProfile } from '@offline-arduino/contracts/board-profiles';

const FLASH_BYTES = 32 * 1024; // physical ATmega328P flash; board.flashMaxBytes is the usable subset
const MAX_TEXT_PAYLOAD_BYTES = 512 * 1024;

export interface ValidatedHex {
  normalizedHex: string;
  programBytes: Uint8Array;
  flashBytesUsed: number;
}

export class IntelHexValidationError extends Error {}

function assertAsciiOnly(hex: string): void {
  for (let i = 0; i < hex.length; i += 1) {
    const code = hex.charCodeAt(i);
    if (code === 0x0a || code === 0x0d) continue; // LF / CR
    if (code < 0x20 || code === 0x7f || code > 0x7e) {
      throw new IntelHexValidationError('Compiler output contains a NUL or non-ASCII control character.');
    }
  }
}

function parseHexByte(text: string): number {
  if (!/^[0-9a-fA-F]{2}$/.test(text)) {
    throw new IntelHexValidationError('Invalid hexadecimal byte in compiler output.');
  }
  return Number.parseInt(text, 16);
}

export function validateIntelHex(hex: string, profile: BoardProfile): ValidatedHex {
  if (Buffer.byteLength(hex, 'utf8') > MAX_TEXT_PAYLOAD_BYTES) {
    throw new IntelHexValidationError('Compiler output exceeds the 512 KiB HEX text limit.');
  }
  assertAsciiOnly(hex);

  const program = new Uint8Array(FLASH_BYTES).fill(0xff);
  const written = new Uint8Array(FLASH_BYTES);
  const normalizedLines: string[] = [];

  const lines = hex.replace(/\r\n?/g, '\n').split('\n');
  let baseAddress = 0;
  let sawEof = false;
  let flashBytesUsed = 0;
  let lastNonEmptyWasEof = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (sawEof) {
      throw new IntelHexValidationError('Compiler output has data after the EOF record.');
    }
    if (!line.startsWith(':')) {
      throw new IntelHexValidationError("Compiler output has a record not starting with ':'.");
    }
    const body = line.slice(1);
    if (body.length % 2 !== 0 || body.length < 10) {
      throw new IntelHexValidationError('Compiler output has an invalid record length.');
    }
    const bytes: number[] = [];
    for (let offset = 0; offset < body.length; offset += 2) {
      bytes.push(parseHexByte(body.slice(offset, offset + 2)));
    }
    const count = bytes[0];
    if (bytes.length !== count + 5) {
      throw new IntelHexValidationError('Compiler output byte count does not match record length.');
    }
    if ((bytes.reduce((sum, b) => sum + b, 0) & 0xff) !== 0) {
      throw new IntelHexValidationError('Compiler output failed a checksum check.');
    }

    const address = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = bytes.slice(4, 4 + count);
    lastNonEmptyWasEof = false;

    switch (recordType) {
      case 0x00: {
        const absolute = baseAddress + address;
        if (absolute < 0 || absolute + count > profile.flashMaxBytes) {
          throw new IntelHexValidationError('Compiler output places data outside the Uno flash range.');
        }
        for (let i = 0; i < data.length; i += 1) {
          const byteAddress = absolute + i;
          const byte = data[i];
          if (written[byteAddress] && program[byteAddress] !== byte) {
            throw new IntelHexValidationError('Compiler output has conflicting overlapping data.');
          }
          if (!written[byteAddress]) {
            written[byteAddress] = 1;
            flashBytesUsed += 1;
          }
          program[byteAddress] = byte;
        }
        break;
      }
      case 0x01:
        if (count !== 0 || address !== 0) throw new IntelHexValidationError('Compiler output has a malformed EOF record.');
        sawEof = true;
        lastNonEmptyWasEof = true;
        break;
      case 0x02:
        if (count !== 2 || address !== 0) throw new IntelHexValidationError('Compiler output has a malformed segment address record.');
        baseAddress = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x03:
        if (count !== 4 || address !== 0) throw new IntelHexValidationError('Compiler output has a malformed start segment address record.');
        break;
      case 0x04:
        if (count !== 2 || address !== 0) throw new IntelHexValidationError('Compiler output has a malformed linear address record.');
        baseAddress = ((data[0] << 8) | data[1]) * 0x1_0000;
        break;
      case 0x05:
        if (count !== 4 || address !== 0) throw new IntelHexValidationError('Compiler output has a malformed start linear address record.');
        break;
      default:
        throw new IntelHexValidationError(`Compiler output has an unsupported record type 0x${recordType.toString(16)}.`);
    }

    // Normalized form: uppercase hex, recomputed from the parsed bytes (not a copy of input).
    normalizedLines.push(`:${bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
  }

  if (!sawEof || !lastNonEmptyWasEof) {
    throw new IntelHexValidationError('Compiler output is missing a terminal EOF record.');
  }
  if (flashBytesUsed === 0) {
    throw new IntelHexValidationError('Compiler output contains no program data.');
  }

  return {
    normalizedHex: normalizedLines.join('\n') + '\n',
    programBytes: program.slice(0, flashBytesUsed > 0 ? FLASH_BYTES : 0),
    flashBytesUsed,
  };
}
