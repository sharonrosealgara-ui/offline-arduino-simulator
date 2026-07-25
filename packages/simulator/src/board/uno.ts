/**
 * Canonical Arduino Uno terminal <-> AVR port/bit/ADC-channel table.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §6.
 *
 * PB6/PB7 drive the 16 MHz crystal and are not exposed as ordinary classroom GPIO.
 * PC6 is RESET, not a normal A6 pin. The built-in Uno LED is a board component driven
 * by PB5/D13, not a separate net.
 */
import type { PortName } from '@offline-arduino/contracts/simulator';

export interface UnoPinMapping {
  boardPin: string;
  port: PortName;
  bit: number;
  adcChannel?: number;
  pwmCapable?: boolean;
}

export const UNO_DIGITAL_PINS: readonly UnoPinMapping[] = [
  { boardPin: 'D0', port: 'D', bit: 0 }, // UART RX
  { boardPin: 'D1', port: 'D', bit: 1 }, // UART TX
  { boardPin: 'D2', port: 'D', bit: 2 },
  { boardPin: 'D3', port: 'D', bit: 3, pwmCapable: true },
  { boardPin: 'D4', port: 'D', bit: 4 },
  { boardPin: 'D5', port: 'D', bit: 5, pwmCapable: true },
  { boardPin: 'D6', port: 'D', bit: 6, pwmCapable: true },
  { boardPin: 'D7', port: 'D', bit: 7 },
  { boardPin: 'D8', port: 'B', bit: 0 },
  { boardPin: 'D9', port: 'B', bit: 1, pwmCapable: true },
  { boardPin: 'D10', port: 'B', bit: 2, pwmCapable: true },
  { boardPin: 'D11', port: 'B', bit: 3, pwmCapable: true },
  { boardPin: 'D12', port: 'B', bit: 4 },
  { boardPin: 'D13', port: 'B', bit: 5 }, // built-in LED
] as const;

export const UNO_ANALOG_PINS: readonly UnoPinMapping[] = [
  { boardPin: 'A0', port: 'C', bit: 0, adcChannel: 0 },
  { boardPin: 'A1', port: 'C', bit: 1, adcChannel: 1 },
  { boardPin: 'A2', port: 'C', bit: 2, adcChannel: 2 },
  { boardPin: 'A3', port: 'C', bit: 3, adcChannel: 3 },
  { boardPin: 'A4', port: 'C', bit: 4, adcChannel: 4 },
  { boardPin: 'A5', port: 'C', bit: 5, adcChannel: 5 },
] as const;

export const UNO_PIN_MAP: readonly UnoPinMapping[] = [...UNO_DIGITAL_PINS, ...UNO_ANALOG_PINS];

const byBoardPin = new Map(UNO_PIN_MAP.map((entry) => [entry.boardPin, entry]));

export function resolveUnoPin(boardPin: string): UnoPinMapping | undefined {
  return byBoardPin.get(boardPin);
}

export const UNO_BUILTIN_LED_PIN = 'D13';
export const UNO_RAIL_5V = '5V';
export const UNO_RAIL_3V3 = '3.3V';
export const UNO_RAIL_GND = 'GND';
