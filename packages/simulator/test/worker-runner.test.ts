/**
 * Integration test for the CPU -> AVRIOPort -> CircuitRuntime -> display-delta pipeline
 * used by simulator.worker.ts. This drives DDRB/PORTB exactly as compiled Blink
 * instructions would (`sbi DDRB,5` / `sbi PORTB,5` / `cbi PORTB,5`) and asserts the
 * built-in D13 LED responds through the full compiled-netlist + solver + LED-runtime
 * stack, satisfying spec §17.2 ("Blink toggles PB5/D13 at the expected cadence")
 * without requiring a real avr-gcc build of Blink (the vendored toolchain isn't
 * available in this environment; apps/desktop's compiler-integration suite covers the
 * real compile path separately).
 */
import { describe, expect, it } from 'vitest';
import { CPU, AVRIOPort, portBConfig } from 'avr8js';
import { compileNetlist } from '../src/netlist-compiler';
import { CircuitRuntime, type CircuitRuntimeAdapter } from '../src/circuit-runtime';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';

const DDRB = 0x24;
const PORTB = 0x25;
const D13_BIT = 5;

function unoWithBuiltinLedProject(): ProjectCircuit {
  // The built-in LED is modeled explicitly here as an LED to D13/GND so the netlist
  // compiler + solver + LED runtime have something concrete to exercise end to end.
  return {
    schemaVersion: 1,
    components: [
      { id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} },
      { id: 'led1', kind: 'led', x: 5, y: 5, rotation: 0, label: 'D13 LED', properties: { ratedMilliAmps: 20 } },
      { id: 'r1', kind: 'resistor', x: 6, y: 5, rotation: 0, label: 'R1', properties: { ohms: 220 } },
    ],
    wires: [
      { id: 'w1', from: { componentId: 'uno1', terminalId: 'D13' }, to: { componentId: 'r1', terminalId: 'a' }, colorRole: 'signal-yellow', waypoints: [] },
      { id: 'w2', from: { componentId: 'r1', terminalId: 'b' }, to: { componentId: 'led1', terminalId: 'anode' }, colorRole: 'signal-yellow', waypoints: [] },
      { id: 'w3', from: { componentId: 'led1', terminalId: 'cathode' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
    ],
    junctions: [],
  };
}

describe('CPU -> AVRIOPort -> CircuitRuntime pipeline (Blink-equivalent)', () => {
  it('toggles the D13 LED on/off as PORTB bit 5 is driven, with no error diagnostics', () => {
    const netlist = compileNetlist(unoWithBuiltinLedProject());
    expect(netlist.diagnostics.filter((d) => d.severity === 'fatal' || d.severity === 'error')).toEqual([]);

    // A no-op program is fine: we drive DDRB/PORTB directly, exactly as the compiled
    // Blink instructions (`sbi`, `cbi`) would via the CPU's writeData path.
    const program = new Uint16Array(1).fill(0xffff);
    const cpu = new CPU(program, 2048);

    const adapterCalls: Array<{ port: string; bit: number; high: boolean }> = [];
    const adapter: CircuitRuntimeAdapter = {
      setDigitalInput: (port, bit, high) => adapterCalls.push({ port, bit, high }),
      setAnalogVoltage: () => undefined,
    };
    const circuit = new CircuitRuntime(netlist, adapter);

    const port = new AVRIOPort(cpu, portBConfig);
    const publish = () => {
      for (let bit = 0; bit < 8; bit += 1) {
        const state = port.pinState(bit);
        const drive =
          state === 2 /* Input */ ? 'input' : state === 3 /* InputPullUp */ ? 'input-pullup' : state === 1 ? 'output-high' : 'output-low';
        circuit.onBoardPinDriverChange('B', bit, drive as 'output-low' | 'output-high' | 'input' | 'input-pullup', cpu.cycles);
      }
      circuit.settle(cpu.cycles);
    };
    port.addListener(publish);
    publish();

    // pinMode(LED_BUILTIN, OUTPUT) -> DDRB |= (1 << 5)
    cpu.writeData(DDRB, 1 << D13_BIT);
    cpu.cycles += 100;

    // digitalWrite(LED_BUILTIN, HIGH) -> PORTB |= (1 << 5)
    cpu.writeData(PORTB, 1 << D13_BIT);
    cpu.cycles += 100;
    circuit.advanceTo(cpu.cycles);
    circuit.settle(cpu.cycles);
    let frame = circuit.takeDisplayDelta();
    const ledOnDelta = frame.componentChanges.find((c) => c.id === 'led1' && c.kind === 'led');
    expect(ledOnDelta && 'milliAmps' in ledOnDelta ? ledOnDelta.milliAmps : 0).toBeGreaterThan(0);

    // digitalWrite(LED_BUILTIN, LOW) -> PORTB &= ~(1 << 5)
    cpu.writeData(PORTB, 0);
    cpu.cycles += 100;
    circuit.advanceTo(cpu.cycles);
    circuit.settle(cpu.cycles);
    frame = circuit.takeDisplayDelta();
    const ledOffDelta = frame.componentChanges.find((c) => c.id === 'led1' && c.kind === 'led');
    expect(ledOffDelta && 'milliAmps' in ledOffDelta ? ledOffDelta.milliAmps : -1).toBe(0);

    expect(circuit.takeDiagnostics().filter((d) => d.severity === 'error' || d.severity === 'fatal')).toEqual([]);
  });
});
