/**
 * LED runtime: cycle-accurate PWM luminance integrator + overcurrent diagnostics.
 * Source: FRONTEND_AND_SIMULATOR_WORKER_SPEC.md §11.1.
 *
 * Integrating on every current change (not just at frame boundaries) captures Timer
 * PWM edges even when the UI only samples at 30 FPS.
 */
import type { CircuitDiagnostic } from '@offline-arduino/contracts/simulator';

const F_CPU = 16_000_000;
const SEVERE_OVERCURRENT_MA = 30;

export class LedRuntime {
  private accumulatedLuminanceCycles = 0;
  private lastIntegratedCycle: number;
  private frameStartCycle: number;
  private currentAmps = 0;
  private ratedAmps: number;

  constructor(
    public readonly id: string,
    ratedMilliAmps: number,
    startCycle: number,
  ) {
    this.ratedAmps = ratedMilliAmps / 1000;
    this.lastIntegratedCycle = startCycle;
    this.frameStartCycle = startCycle;
  }

  /** Call whenever the solved current through this LED changes, before applying the new value. */
  setCurrentAmps(amps: number, cycle: number): void {
    this.integrateTo(cycle);
    this.currentAmps = Math.max(0, amps);
  }

  private integrateTo(cycle: number): void {
    if (cycle <= this.lastIntegratedCycle) return;
    const duty = Math.max(0, Math.min(1, this.currentAmps / Math.max(this.ratedAmps, 1e-9)));
    this.accumulatedLuminanceCycles += duty * (cycle - this.lastIntegratedCycle);
    this.lastIntegratedCycle = cycle;
  }

  /** Emits a display frame: gamma-corrected brightness averaged since the last frame. */
  takeFrame(cycle: number): { brightness: number; milliAmps: number; diagnostics: CircuitDiagnostic[] } {
    this.integrateTo(cycle);
    const span = Math.max(1, cycle - this.frameStartCycle);
    const duty = this.accumulatedLuminanceCycles / span;
    const brightness = Math.pow(Math.max(0, Math.min(1, duty)), 1 / 2.2);
    this.accumulatedLuminanceCycles = 0;
    this.frameStartCycle = cycle;

    const milliAmps = this.currentAmps * 1000;
    const diagnostics: CircuitDiagnostic[] = [];
    if (milliAmps > SEVERE_OVERCURRENT_MA) {
      diagnostics.push({
        id: `LED_SEVERE_OVERCURRENT:${this.id}`,
        severity: 'warning',
        code: 'LED_SEVERE_OVERCURRENT',
        message: `LED ${this.id} is drawing ${milliAmps.toFixed(1)} mA. Increase the series resistance.`,
        componentIds: [this.id],
      });
    } else if (milliAmps > (this.ratedAmps * 1000)) {
      diagnostics.push({
        id: `LED_OVERCURRENT:${this.id}`,
        severity: 'warning',
        code: 'LED_OVERCURRENT',
        message: `LED ${this.id} exceeds its rated current. Increase the series resistance.`,
        componentIds: [this.id],
      });
    }

    return { brightness, milliAmps, diagnostics };
  }
}

export function cyclesToMillis(cycles: number): number {
  return (cycles / F_CPU) * 1000;
}
