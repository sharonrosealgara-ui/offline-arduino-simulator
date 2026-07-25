/**
 * Board scope for the MVP: exactly one profile (Arduino Uno / ATmega328P / 16 MHz).
 * Source: OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md §3.
 *
 * Do not advertise Mega/Nano/Leonardo/ESP32 or arbitrary third-party libraries until
 * BOTH compilation and the simulation models support them.
 */
export const BOARD_PROFILES = {
  uno: {
    id: 'uno',
    fqbn: 'arduino:avr:uno',
    mcu: 'atmega328p',
    fCpu: '16000000L',
    boardMacro: 'ARDUINO_AVR_UNO',
    architectureMacro: 'ARDUINO_ARCH_AVR',
    core: 'arduino',
    variant: 'standard',
    flashMaxBytes: 32_256,
    sramMaxBytes: 2_048,
    eepromBytes: 1_024,
  },
} as const;

export type BoardId = keyof typeof BOARD_PROFILES;
export type BoardProfile = (typeof BOARD_PROFILES)[BoardId];
