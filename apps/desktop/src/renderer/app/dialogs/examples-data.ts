/**
 * Bundled-in-TS starter templates. Each carries the .ino sketch AND a ProjectCircuit
 * netlist (shared by the 2D SVG canvas and the 3D DynamicNetlist3D). Terminal ids match
 * the component registry so compileNetlist() and both renderers accept them as-is.
 */
import type { CircuitComponent, ProjectCircuit } from '@offline-arduino/contracts/circuit';
import type { ProjectFileDTO } from '../../../preload/electron-api-types';

export interface StarterTemplate {
  id: string;
  title: string;
  description: string;
  concepts: string[];
  /** Icon key for the card. Resolved to a lucide icon by the modal — no emoji, no image assets. */
  icon: 'blink' | 'analog' | 'motion' | 'display' | 'input';
  ino: string;
  circuit: ProjectCircuit;
}

const uno = (x = 120, y = 140): CircuitComponent => ({
  id: 'uno1',
  kind: 'uno-r3',
  x,
  y,
  rotation: 0,
  label: 'Arduino Uno',
  properties: {},
});

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'blink',
    title: '01. Blink LED',
    description: 'Toggle the built-in Pin 13 LED once per second — the canonical “hello world” of hardware.',
    concepts: ['pinMode', 'digitalWrite', 'delay'],
    icon: 'blink',
    ino: `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`,
    // D13 drives the board's built-in L LED, and this template also wires an external
    // LED through a 220 Ω series resistor to the same pin — so the example demonstrates a
    // complete circuit path, not just the on-board indicator.
    circuit: {
      schemaVersion: 1,
      components: [
        uno(),
        { id: 'r1', kind: 'resistor', x: 470, y: 300, rotation: 0, label: '220 Ω', properties: { ohms: 220 } },
        {
          id: 'led1',
          kind: 'led',
          x: 600,
          y: 300,
          rotation: 0,
          label: 'LED',
          properties: { color: 'red', forwardV: 2.0, dynamicOhms: 10, ratedMilliAmps: 20 },
        },
      ],
      wires: [
        {
          id: 'w1',
          from: { componentId: 'uno1', terminalId: 'D13' },
          to: { componentId: 'r1', terminalId: 'a' },
          colorRole: 'signal-yellow',
          waypoints: [],
        },
        {
          id: 'w2',
          from: { componentId: 'r1', terminalId: 'b' },
          to: { componentId: 'led1', terminalId: 'anode' },
          colorRole: 'signal-yellow',
          waypoints: [],
        },
        {
          id: 'w3',
          from: { componentId: 'led1', terminalId: 'cathode' },
          to: { componentId: 'uno1', terminalId: 'GND' },
          colorRole: 'ground-black',
          waypoints: [],
        },
      ],
      junctions: [],
    },
  },

  {
    id: 'pushbutton',
    title: '02. Pushbutton (INPUT_PULLUP)',
    description:
      'Light the built-in LED while a button is pressed, using the internal pull-up. Pressed reads LOW.',
    concepts: ['digitalRead', 'INPUT_PULLUP', 'active-low input'],
    icon: 'input',
    // Verbatim copy of resources/examples/pushbutton/Sketch.ino. starter-examples.test.ts
    // asserts the two stay identical so the student-facing template can never drift from
    // the packaged example.
    ino: `const byte BUTTON_PIN = 2;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  const bool pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_BUILTIN, pressed ? HIGH : LOW);
}
`,
    circuit: {
      schemaVersion: 1,
      components: [
        uno(120, 140),
        { id: 'btn1', kind: 'pushbutton', x: 470, y: 220, rotation: 0, label: 'Pushbutton', properties: {} },
      ],
      // Mirrors resources/examples/pushbutton/circuit.json: D2 -> leg A, leg B -> GND.
      // No external pull-down, which would contradict INPUT_PULLUP.
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'D2' }, to: { componentId: 'btn1', terminalId: 'a1' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w2', from: { componentId: 'btn1', terminalId: 'b1' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
      ],
      junctions: [],
    },
  },
  {
    id: 'pot-pwm',
    title: '03. Potentiometer & PWM',
    description: 'Read a 10k pot on A0 and dim an LED on PWM pin 9 with analogWrite().',
    concepts: ['analogRead', 'analogWrite', 'scaling'],
    icon: 'analog',
    ino: `const int POT_PIN = A0;
const int LED_PIN = 9;   // PWM-capable

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int raw = analogRead(POT_PIN);   // 0..1023
  analogWrite(LED_PIN, raw / 4);   // 0..255
  delay(10);
}
`,
    circuit: {
      schemaVersion: 1,
      components: [
        uno(),
        { id: 'pot1', kind: 'potentiometer', x: 520, y: 90, rotation: 0, label: '10k Pot', properties: { ohms: 10000, initialPosition: 0.5 } },
        { id: 'r1', kind: 'resistor', x: 470, y: 300, rotation: 0, label: '220Ω', properties: { ohms: 220 } },
        { id: 'led1', kind: 'led', x: 600, y: 300, rotation: 0, label: 'LED', properties: { color: 'yellow' } },
      ],
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: '5V' }, to: { componentId: 'pot1', terminalId: 'a' }, colorRole: 'vcc-red', waypoints: [] },
        { id: 'w2', from: { componentId: 'pot1', terminalId: 'b' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
        { id: 'w3', from: { componentId: 'pot1', terminalId: 'wiper' }, to: { componentId: 'uno1', terminalId: 'A0' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w4', from: { componentId: 'uno1', terminalId: 'D9' }, to: { componentId: 'r1', terminalId: 'a' }, colorRole: 'signal-green', waypoints: [] },
        { id: 'w5', from: { componentId: 'r1', terminalId: 'b' }, to: { componentId: 'led1', terminalId: 'anode' }, colorRole: 'signal-green', waypoints: [] },
        { id: 'w6', from: { componentId: 'led1', terminalId: 'cathode' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
      ],
      junctions: [],
    },
  },

  {
    id: 'servo-sweep',
    title: '04. Servo Motor Sweep',
    description: 'Sweep a servo on Pin 9 from 0° to 180° and back using the Servo library.',
    concepts: ['Servo library', 'for loops', 'pulse timing'],
    icon: 'motion',
    ino: `#include <Servo.h>

Servo classroomServo;

void setup() {
  classroomServo.attach(9);
}

void loop() {
  for (int a = 0; a <= 180; a++) { classroomServo.write(a); delay(15); }
  for (int a = 180; a >= 0; a--) { classroomServo.write(a); delay(15); }
}
`,
    circuit: {
      schemaVersion: 1,
      components: [
        uno(),
        { id: 'servo1', kind: 'servo', x: 560, y: 200, rotation: 0, label: 'Servo', properties: {} },
      ],
      wires: [
        { id: 'w1', from: { componentId: 'uno1', terminalId: 'D9' }, to: { componentId: 'servo1', terminalId: 'signal' }, colorRole: 'signal-orange', waypoints: [] },
        { id: 'w2', from: { componentId: 'uno1', terminalId: '5V' }, to: { componentId: 'servo1', terminalId: 'vcc' }, colorRole: 'vcc-red', waypoints: [] },
        { id: 'w3', from: { componentId: 'servo1', terminalId: 'gnd' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
      ],
      junctions: [],
    },
  },

  {
    id: 'lcd-1602',
    title: '05. LCD 1602 Display',
    description: 'Print two lines to a 16×2 HD44780 LCD in 4-bit mode with the LiquidCrystal library.',
    concepts: ['LiquidCrystal', 'HD44780 4-bit', 'lcd.print'],
    icon: 'display',
    ino: `#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

void setup() {
  lcd.begin(16, 2);
  lcd.print("Hello, World!");
  lcd.setCursor(0, 1);
  lcd.print("Arduino Uno");
}

void loop() {}
`,
    circuit: {
      schemaVersion: 1,
      components: [
        uno(100, 340),
        { id: 'lcd1', kind: 'lcd1602', x: 470, y: 80, rotation: 0, label: 'LCD 16x2', properties: {} },
      ],
      wires: [
        { id: 'w_rs', from: { componentId: 'uno1', terminalId: 'D12' }, to: { componentId: 'lcd1', terminalId: 'RS' }, colorRole: 'signal-green', waypoints: [] },
        { id: 'w_e', from: { componentId: 'uno1', terminalId: 'D11' }, to: { componentId: 'lcd1', terminalId: 'E' }, colorRole: 'signal-green', waypoints: [] },
        { id: 'w_d4', from: { componentId: 'uno1', terminalId: 'D5' }, to: { componentId: 'lcd1', terminalId: 'D4' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w_d5', from: { componentId: 'uno1', terminalId: 'D4' }, to: { componentId: 'lcd1', terminalId: 'D5' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w_d6', from: { componentId: 'uno1', terminalId: 'D3' }, to: { componentId: 'lcd1', terminalId: 'D6' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w_d7', from: { componentId: 'uno1', terminalId: 'D2' }, to: { componentId: 'lcd1', terminalId: 'D7' }, colorRole: 'signal-yellow', waypoints: [] },
        { id: 'w_vss', from: { componentId: 'lcd1', terminalId: 'VSS' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
        { id: 'w_rw', from: { componentId: 'lcd1', terminalId: 'RW' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
        { id: 'w_k', from: { componentId: 'lcd1', terminalId: 'K' }, to: { componentId: 'uno1', terminalId: 'GND' }, colorRole: 'ground-black', waypoints: [] },
        { id: 'w_vdd', from: { componentId: 'lcd1', terminalId: 'VDD' }, to: { componentId: 'uno1', terminalId: '5V' }, colorRole: 'vcc-red', waypoints: [] },
        { id: 'w_a', from: { componentId: 'lcd1', terminalId: 'A' }, to: { componentId: 'uno1', terminalId: '5V' }, colorRole: 'vcc-red', waypoints: [] },
      ],
      junctions: [
        { id: 'j_gnd', wireIds: ['w_vss', 'w_rw', 'w_k'], point: { x: 300, y: 520 } },
        { id: 'j_5v', wireIds: ['w_vdd', 'w_a'], point: { x: 300, y: 120 } },
      ],
    },
  },
];

/** Pure: turn a template into a ProjectFileDTO that loadProjectIntoStore() accepts. */
export function templateToProjectFile(t: StarterTemplate): ProjectFileDTO {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: crypto.randomUUID(),
    name: t.title.replace(/^\d+\.\s*/, ''),
    createdAt: now,
    updatedAt: now,
    boardId: 'uno',
    sources: { 'Sketch.ino': t.ino },
    circuit: t.circuit,
  };
}
