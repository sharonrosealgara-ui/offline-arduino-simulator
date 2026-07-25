/**
 * Servo pulse-width observer. Watches the solved signal net; never inspects source
 * code or Timer registers. Source: spec §11.5.
 *
 * No torque/load/stall/inertia/supply-droop modeling. Angle is derived purely from the
 * measured rising-to-falling pulse width in simulated microseconds.
 */
import type { CircuitDiagnostic } from '@offline-arduino/contracts/simulator';

const F_CPU = 16_000_000;
const OBSERVABLE_MIN_MICROS = 500;
const OBSERVABLE_MAX_MICROS = 2500;
/** Refresh period sanity window; servo animation must not depend on an exact 20ms period. */
const REFRESH_PERIOD_MIN_MICROS = 10_000;
const REFRESH_PERIOD_MAX_MICROS = 30_000;

export type ServoLogic = 0 | 1 | 'X';

export interface ServoFrame {
  angle: number;
  pulseMicros: number | null;
  signalValid: boolean;
}

export class ServoRuntime {
  private lastSignal: ServoLogic = 'X';
  private riseCycle: number | null = null;
  private lastFallCycle: number | null = null;
  private lastPulseMicros: number | null = null;
  private lastAngle = 0;

  constructor(
    private readonly id: string,
    private readonly minPulseMicros: number,
    private readonly maxPulseMicros: number,
    private readonly minAngle: number,
    private readonly maxAngle: number,
  ) {}

  observe(signal: ServoLogic, cycle: number): CircuitDiagnostic[] {
    const diagnostics: CircuitDiagnostic[] = [];
    const previous = this.lastSignal;
    this.lastSignal = signal;

    if (previous !== 1 && signal === 1) {
      this.riseCycle = cycle;
    } else if (previous === 1 && signal === 0 && this.riseCycle !== null) {
      const pulseMicros = ((cycle - this.riseCycle) / F_CPU) * 1_000_000;
      if (this.lastFallCycle !== null) {
        const periodMicros = ((cycle - this.lastFallCycle) / F_CPU) * 1_000_000;
        if (periodMicros < REFRESH_PERIOD_MIN_MICROS || periodMicros > REFRESH_PERIOD_MAX_MICROS) {
          // Outside the broad sanity window — informational only, not fatal.
          diagnostics.push({
            id: `SERVO_REFRESH_PERIOD:${this.id}`,
            severity: 'info',
            code: 'SERVO_REFRESH_PERIOD',
            message: 'Servo refresh period is outside the typical 10-30 ms range.',
            componentIds: [this.id],
          });
        }
      }
      this.lastFallCycle = cycle;
      this.lastPulseMicros = pulseMicros;
      this.riseCycle = null;

      if (pulseMicros < OBSERVABLE_MIN_MICROS || pulseMicros > OBSERVABLE_MAX_MICROS) {
        diagnostics.push({
          id: `SERVO_INVALID_PULSE:${this.id}`,
          severity: 'warning',
          code: 'SERVO_INVALID_PULSE',
          message: 'Use pulse widths near 1000-2000 microseconds.',
          componentIds: [this.id],
        });
      } else {
        const clampedPulse = Math.max(this.minPulseMicros, Math.min(this.maxPulseMicros, pulseMicros));
        const span = this.maxPulseMicros - this.minPulseMicros || 1;
        const angle =
          this.minAngle + ((clampedPulse - this.minPulseMicros) / span) * (this.maxAngle - this.minAngle);
        this.lastAngle = Math.max(this.minAngle, Math.min(this.maxAngle, angle));
      }
    }

    return diagnostics;
  }

  takeFrame(): ServoFrame {
    return {
      angle: this.lastAngle,
      pulseMicros: this.lastPulseMicros,
      signalValid: this.lastPulseMicros !== null,
    };
  }
}
