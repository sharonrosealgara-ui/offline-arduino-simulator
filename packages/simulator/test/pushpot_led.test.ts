import { describe, expect, it } from 'vitest';
import { compileNetlist } from '../src/netlist-compiler';
import { CircuitRuntime } from '../src/circuit-runtime';
import type { ProjectCircuit } from '@offline-arduino/contracts/circuit';

// Minimal Uno base
const baseUno = (components: ProjectCircuit['components'], wires: ProjectCircuit['wires']): ProjectCircuit => ({
  schemaVersion: 1,
  components: [{ id: 'uno1', kind: 'uno-r3', x: 0, y: 0, rotation: 0, label: 'Uno', properties: {} }, ...components],
  wires,
  junctions: [],
});

function makeRuntime(circuit: ProjectCircuit, adapter?: { setDigitalInput?: (port: string, bit: number, value: boolean) => void; setAnalogVoltage?: (channel: number, volts: number) => void }) {
  const netlist = compileNetlist(circuit);
  return new CircuitRuntime(netlist, {
    setDigitalInput: adapter?.setDigitalInput ? (p: any, b: any, v: any) => adapter.setDigitalInput(p, b, v) : () => undefined,
    setAnalogVoltage: adapter?.setAnalogVoltage ? (ch: any, volts: any) => adapter.setAnalogVoltage(ch, volts) : () => undefined,
  });
}

describe('Pushbutton and potentiometer integration', () => {
  it('pushbutton press updates component and drives the board pin', () => {
    // Pushbutton between 5V and D2 (via a1->5V, b1->D2)
    const circuit = baseUno(
      [
        { id: 'pb1', kind: 'pushbutton', x: 10, y: 10, rotation: 0, label: 'PB', properties: {} },
      ],
      [
        { id: 'w1', from: { componentId: 'uno1', terminalId: '5V' }, to: { componentId: 'pb1', terminalId: 'a1' }, colorRole: 'vcc-red', waypoints: [] },
        { id: 'w2', from: { componentId: 'pb1', terminalId: 'b1' }, to: { componentId: 'uno1', terminalId: 'D2' }, colorRole: 'signal-yellow', waypoints: [] },
      ],
    );

    const rt = makeRuntime(circuit);
    // initial settle
    rt.settle(0);
    rt.takeDisplayDelta();

    // Apply a press at cycle 100
    rt.setControl('pb1', true, 100);
    rt.settle(100);
    const delta = rt.takeDisplayDelta();

    // Component delta should report pressed
    const comp = delta.componentChanges.find((c) => c.id === 'pb1');
    expect(comp).toBeDefined();
    expect(comp?.kind).toBe('pushbutton');
    expect((comp as any).value).toBe(true);

    // The board pin D2 should now show logic 1 (driven high through the button)
    const d2 = delta.pinChanges.find((p) => p.boardPin === 'D2');
    expect(d2).toBeDefined();
    expect(d2?.logic === 1 || d2?.logic === '1' || d2?.logic === 1).toBeTruthy();
  });

  it('potentiometer maps to analog voltage and ADC range correctly', () => {
    // Pot between 5V (a) and GND (b), wiper to A0
    const circuit = baseUno(
      [
        { id: 'pot1', kind: 'potentiometer', x: 20, y: 20, rotation: 0, label: 'POT', properties: { initialPosition: 0.5 } },
      ],
      [
        { id: 'w1', from: { componentId: 'uno1', terminalId: '5V' }, to: { componentId: 'pot1', terminalId: 'a' }, colorRole: 'vcc-red', waypoints: [] },
        { id: 'w2', from: { componentId: 'uno1', terminalId: 'GND' }, to: { componentId: 'pot1', terminalId: 'b' }, colorRole: 'ground-black', waypoints: [] },
        { id: 'w3', from: { componentId: 'pot1', terminalId: 'wiper' }, to: { componentId: 'uno1', terminalId: 'A0' }, colorRole: 'signal-yellow', waypoints: [] },
      ],
    );

    const analogs: Record<number, number[]> = {};
    const rt = makeRuntime(circuit, {
      setAnalogVoltage: (ch: number, volts: number) => {
        if (!analogs[ch]) analogs[ch] = [];
        analogs[ch].push(Number(volts));
      },
    });

    rt.settle(0);
    rt.takeDisplayDelta();

    // Min
    rt.setControl('pot1', 0.0, 100);
    rt.settle(100);
    rt.takeDisplayDelta();
    const a0Ch = 0; // A0 -> adcChannel 0
    const vmin = analogs[a0Ch]?.[analogs[a0Ch].length - 1] ?? null;
    expect(typeof vmin === 'number').toBeTruthy();
    const v0 = vmin ?? 0;

    // Mid
    rt.setControl('pot1', 0.5, 200);
    rt.settle(200);
    rt.takeDisplayDelta();
    const vmid = analogs[a0Ch]?.[analogs[a0Ch].length - 1] ?? null;
    expect(typeof vmid === 'number').toBeTruthy();
    const adcMid = Math.round(((vmid ?? 0) / 5) * 1023);
    expect(Math.abs(adcMid - 512) <= 2).toBeTruthy();

    // Max
    rt.setControl('pot1', 1.0, 300);
    rt.settle(300);
    rt.takeDisplayDelta();
    const vmax = analogs[a0Ch]?.[analogs[a0Ch].length - 1] ?? null;
    expect(typeof vmax === 'number').toBeTruthy();
    const adcMax = Math.round(((vmax ?? 0) / 5) * 1023);
    // The potentiometer may be wired in either direction; ensure mono-tonicity and that
    // the full-scale swing covers most of the ADC range.
    const adc0 = Math.round(((v0 ?? 0) / 5) * 1023);
    const adcMidVal = Math.round(((vmid ?? 0) / 5) * 1023);
    const adcMaxVal = Math.round(((vmax ?? 0) / 5) * 1023);

    const increasing = adc0 <= adcMidVal && adcMidVal <= adcMaxVal;
    const decreasing = adc0 >= adcMidVal && adcMidVal >= adcMaxVal;
    expect(increasing || decreasing).toBeTruthy();
    // Ensure the swing covers most of 0..1023 (tolerant): at least 800 counts.
    expect(Math.abs(adcMaxVal - adc0) > 800).toBeTruthy();
    // Midpoint roughly halfway between extremes.
    expect(Math.abs(adcMidVal - Math.round((adc0 + adcMaxVal) / 2)) <= 25).toBeTruthy();

    // Values must be monotonic
    expect(v0 <= (vmid ?? v0) && (vmid ?? v0) <= (vmax ?? vmid ?? v0) || v0 >= (vmid ?? v0) && (vmid ?? v0) >= (vmax ?? vmid ?? v0)).toBeTruthy();
  });

  it('detects reversed LED when voltages make orientation clear', () => {
    // LED anode connected to GND, cathode to 5V (clearly reversed)
    const circuit = baseUno(
      [
        { id: 'led1', kind: 'led', x: 30, y: 30, rotation: 0, label: 'LED', properties: {} },
      ],
      [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'GND' }, to: { componentId: 'led1', terminalId: 'anode' }, colorRole: 'ground-black', waypoints: [] },
        { id: 'w2', from: { componentId: 'uno1', terminalId: '5V' }, to: { componentId: 'led1', terminalId: 'cathode' }, colorRole: 'vcc-red', waypoints: [] },
      ],
    );

    const rt = makeRuntime(circuit);
    rt.settle(0);
    const diags = rt.takeDiagnostics();
    // Should include LED_REVERSED for led1
    const found = diags.some((d) => d.id === 'LED_REVERSED:led1' || d.code === 'LED_REVERSED');
    expect(found).toBeTruthy();
  });

  it('does not warn when LED polarity cannot be determined', () => {
    // LED floating on both sides (no clear rails)
    const circuit = baseUno(
      [
        { id: 'led2', kind: 'led', x: 40, y: 40, rotation: 0, label: 'LED2', properties: {} },
      ],
      [
        // No wires: LED isolated; voltages unknown
      ],
    );

    const rt = makeRuntime(circuit);
    rt.settle(0);
    const diags = rt.takeDiagnostics();
    const found = diags.some((d) => d.id === 'LED_REVERSED:led2' || d.code === 'LED_REVERSED');
    expect(found).toBeFalsy();
  });
});
