/**
 * Programmatic SVG glyph for one circuit component, reflecting live simulation display
 * deltas (LED brightness, servo horn angle, LCD text, pin logic badges). Memoized so a
 * pin change on one component doesn't rerender the whole canvas (spec §6.1, §14).
 */
import { memo } from 'react';
import type { CircuitComponent } from '@offline-arduino/contracts/circuit';
import type { ComponentDisplayDelta, PinDisplayDelta } from '@offline-arduino/contracts/simulator';

interface Props {
  component: CircuitComponent;
  selected: boolean;
  display?: ComponentDisplayDelta;
  pinDisplay: Record<string, PinDisplayDelta>;
  onSelect(additive: boolean): void;
}

function ComponentGlyphImpl({ component, selected, display, pinDisplay, onSelect }: Props): JSX.Element {
  const transform = `translate(${component.x} ${component.y}) rotate(${component.rotation})`;

  return (
    <g
      transform={transform}
      style={{ cursor: 'grab' }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event.shiftKey);
      }}
      tabIndex={0}
      role="button"
      aria-label={`${component.label} (${component.kind})`}
    >
      {selected && <rect x={-6} y={-6} width={glyphWidth(component.kind) + 12} height={glyphHeight(component.kind) + 12} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" rx={4} />}
      {renderGlyph(component, display, pinDisplay)}
      <text x={0} y={glyphHeight(component.kind) + 16} fontSize={11} fill="var(--text-secondary)">
        {component.label}
      </text>
    </g>
  );
}

function glyphWidth(kind: CircuitComponent['kind']): number {
  switch (kind) {
    case 'uno-r3':
      return 220;
    case 'lcd1602':
      return 180;
    default:
      return 60;
  }
}
function glyphHeight(kind: CircuitComponent['kind']): number {
  switch (kind) {
    case 'uno-r3':
      return 150;
    case 'lcd1602':
      return 70;
    default:
      return 40;
  }
}

function renderGlyph(
  component: CircuitComponent,
  display: ComponentDisplayDelta | undefined,
  pinDisplay: Record<string, PinDisplayDelta>,
): JSX.Element {
  switch (component.kind) {
    case 'uno-r3': {
      const d13 = pinDisplay.D13;
      const builtinOn = d13?.logic === 1;
      return (
        <g>
          <rect width={220} height={150} rx={8} fill="#0b7285" stroke="#08525f" />
          <rect x={10} y={10} width={200} height={130} rx={4} fill="#0a6273" opacity={0.5} />
          <circle cx={190} cy={24} r={5} fill={builtinOn ? '#ffd43b' : '#3b4a4d'}>
            {builtinOn && <animate attributeName="opacity" values="1;0.7;1" dur="0.6s" repeatCount="indefinite" />}
          </circle>
          <text x={182} y={40} fontSize={8} fill="#cfe">L</text>
          <text x={12} y={80} fontSize={12} fill="#e6f7fb" fontWeight="bold">ARDUINO UNO</text>
        </g>
      );
    }
    case 'led': {
      const brightness = display?.kind === 'led' ? display.brightness : 0;
      const color = typeof component.properties.color === 'string' ? component.properties.color : 'red';
      return (
        <g>
          <circle cx={20} cy={20} r={14} fill={color} opacity={0.25 + brightness * 0.75} stroke="#333" />
          {brightness > 0.05 && <circle cx={20} cy={20} r={20} fill={color} opacity={brightness * 0.35} />}
          <line x1={6} y1={40} x2={6} y2={54} stroke="#555" strokeWidth={2} />
          <line x1={34} y1={40} x2={34} y2={54} stroke="#555" strokeWidth={2} />
        </g>
      );
    }
    case 'resistor':
      return (
        <g>
          <rect x={8} y={12} width={44} height={16} rx={3} fill="#d9b382" stroke="#8a6d3b" />
          <line x1={0} y1={20} x2={8} y2={20} stroke="#555" strokeWidth={2} />
          <line x1={52} y1={20} x2={60} y2={20} stroke="#555" strokeWidth={2} />
        </g>
      );
    case 'pushbutton': {
      const pressed = display?.kind === 'pushbutton' && display.value === true;
      return (
        <g>
          <rect x={8} y={8} width={44} height={44} rx={4} fill={pressed ? '#adb5bd' : '#ced4da'} stroke="#495057" />
          <circle cx={30} cy={30} r={10} fill={pressed ? '#868e96' : '#e9ecef'} stroke="#495057" />
        </g>
      );
    }
    case 'potentiometer': {
      const value = display?.kind === 'potentiometer' && typeof display.value === 'number' ? display.value : 0.5;
      const angle = -135 + value * 270;
      return (
        <g>
          <circle cx={30} cy={24} r={18} fill="#495057" stroke="#212529" />
          <line x1={30} y1={24} x2={30 + 14 * Math.cos((angle * Math.PI) / 180)} y2={24 + 14 * Math.sin((angle * Math.PI) / 180)} stroke="#ffd43b" strokeWidth={3} />
        </g>
      );
    }
    case 'lcd1602': {
      const rows = display?.kind === 'lcd1602' ? display.rows : ['', ''];
      const on = display?.kind === 'lcd1602' ? display.displayOn : false;
      return (
        <g>
          <rect width={180} height={70} rx={4} fill={on ? '#1b6b3a' : '#123b22'} stroke="#0b2415" />
          <rect x={8} y={10} width={164} height={50} rx={2} fill={on ? '#3fd07f' : '#1f5c38'} />
          <text x={14} y={30} fontFamily="monospace" fontSize={12} fill="#06240f">{(rows[0] ?? '').slice(0, 16)}</text>
          <text x={14} y={50} fontFamily="monospace" fontSize={12} fill="#06240f">{(rows[1] ?? '').slice(0, 16)}</text>
        </g>
      );
    }
    case 'servo': {
      const angle = display?.kind === 'servo' ? display.angle : 90;
      return (
        <g>
          <rect x={4} y={16} width={40} height={28} rx={3} fill="#343a40" stroke="#111" />
          <circle cx={44} cy={30} r={6} fill="#868e96" />
          <line x1={44} y1={30} x2={44 + 22 * Math.cos((-angle * Math.PI) / 180)} y2={30 + 22 * Math.sin((-angle * Math.PI) / 180)} stroke="#ffd43b" strokeWidth={3} />
        </g>
      );
    }
    default:
      return <rect width={60} height={40} fill="#adb5bd" />;
  }
}

export const ComponentGlyph = memo(ComponentGlyphImpl);
