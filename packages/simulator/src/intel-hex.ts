/**
 * Worker-side Intel HEX loading. This is a SECOND, independent validation pass — the
 * Electron main process already validated compiler output, but the worker treats it as
 * untrusted because malformed program memory must never reach the CPU core.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §4.
 */

const FLASH_BYTES = 32 * 1024;
const FLASH_WORDS = FLASH_BYTES / 2;
export const MAX_HEX_CHARS = 1024 * 1024;

export interface ParsedHex {
  program: Uint16Array;
  flashBytesUsed: number;
}

function parseHexByte(text: string, lineNumber: number): number {
  if (!/^[0-9a-fA-F]{2}$/.test(text)) {
    throw new Error(`Intel HEX line ${lineNumber}: invalid hexadecimal byte.`);
  }
  return Number.parseInt(text, 16);
}

/**
 * Parses and validates an Intel HEX program image for the ATmega328P (32 KiB flash).
 *
 * Rules enforced (spec §4):
 *  - max 1 MiB text; ASCII records starting with ':'
 *  - byte count / char count / hex digits / two's-complement checksum
 *  - record types 00 (data), 01 (EOF), 02 (ext segment addr), 03 (start segment addr,
 *    ignored), 04 (ext linear addr), 05 (start linear addr, ignored — reset uses the
 *    AVR reset vector, not a stored start address)
 *  - exactly one EOF, and no non-blank record after it
 *  - reject data outside the 32 KiB flash range
 *  - reject conflicting overlaps; identical duplicate bytes are allowed
 *  - unused flash initializes to 0xffff words
 */
export function parseIntelHex(hex: string): ParsedHex {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length > MAX_HEX_CHARS) {
    throw new Error('Intel HEX is empty or exceeds the 1 MiB safety limit.');
  }

  const program = new Uint16Array(FLASH_WORDS);
  program.fill(0xffff);
  const written = new Uint8Array(FLASH_BYTES);

  const lines = hex.replace(/\r\n?/g, '\n').split('\n');
  let baseAddress = 0;
  let sawEof = false;
  let flashBytesUsed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;
    if (sawEof) throw new Error(`Intel HEX line ${lineNumber}: data appears after EOF.`);
    if (!line.startsWith(':')) throw new Error(`Intel HEX line ${lineNumber}: missing ':'.`);

    const body = line.slice(1);
    if (body.length % 2 !== 0 || body.length < 10) {
      throw new Error(`Intel HEX line ${lineNumber}: invalid record length.`);
    }

    const bytes: number[] = [];
    for (let offset = 0; offset < body.length; offset += 2) {
      bytes.push(parseHexByte(body.slice(offset, offset + 2), lineNumber));
    }

    const count = bytes[0];
    if (bytes.length !== count + 5) {
      throw new Error(`Intel HEX line ${lineNumber}: byte count does not match record length.`);
    }
    if ((bytes.reduce((sum, byte) => sum + byte, 0) & 0xff) !== 0) {
      throw new Error(`Intel HEX line ${lineNumber}: checksum failed.`);
    }

    const address = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = bytes.slice(4, 4 + count);

    switch (recordType) {
      case 0x00: {
        const absolute = baseAddress + address;
        if (absolute < 0 || absolute + count > FLASH_BYTES) {
          throw new Error(`Intel HEX line ${lineNumber}: data exceeds ATmega328P flash.`);
        }
        for (let i = 0; i < data.length; i += 1) {
          const byteAddress = absolute + i;
          const byte = data[i];
          const wordIndex = byteAddress >>> 1;
          const oldWord = program[wordIndex];
          const oldByte = (byteAddress & 1) === 0 ? oldWord & 0xff : oldWord >>> 8;
          if (written[byteAddress] && oldByte !== byte) {
            throw new Error(`Intel HEX line ${lineNumber}: conflicting overlapping data.`);
          }
          if (!written[byteAddress]) {
            written[byteAddress] = 1;
            flashBytesUsed += 1;
          }
          program[wordIndex] =
            (byteAddress & 1) === 0 ? (oldWord & 0xff00) | byte : (oldWord & 0x00ff) | (byte << 8);
        }
        break;
      }
      case 0x01:
        if (count !== 0 || address !== 0) throw new Error(`Intel HEX line ${lineNumber}: malformed EOF.`);
        sawEof = true;
        break;
      case 0x02:
        if (count !== 2 || address !== 0) {
          throw new Error(`Intel HEX line ${lineNumber}: malformed segment address.`);
        }
        baseAddress = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x03:
        if (count !== 4 || address !== 0) {
          throw new Error(`Intel HEX line ${lineNumber}: malformed start segment address.`);
        }
        break;
      case 0x04:
        if (count !== 2 || address !== 0) {
          throw new Error(`Intel HEX line ${lineNumber}: malformed linear address.`);
        }
        baseAddress = ((data[0] << 8) | data[1]) * 0x1_0000;
        break;
      case 0x05:
        if (count !== 4 || address !== 0) {
          throw new Error(`Intel HEX line ${lineNumber}: malformed start linear address.`);
        }
        break;
      default:
        throw new Error(`Intel HEX line ${lineNumber}: unsupported record type 0x${recordType.toString(16)}.`);
    }
  }

  if (!sawEof) throw new Error('Intel HEX has no EOF record.');
  if (flashBytesUsed === 0) throw new Error('Intel HEX contains no program data.');

  return { program, flashBytesUsed };
}
