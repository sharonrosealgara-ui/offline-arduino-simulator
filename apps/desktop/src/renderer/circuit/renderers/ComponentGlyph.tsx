/**
 * Programmatic SVG glyph for one circuit component, reflecting live simulation display
 * deltas (LED brightness, servo horn angle, LCD text, trimmer position). Memoized so a pin
 * change on one component doesn't rerender the whole canvas (spec §6.1, §14).
 *
 * Everything here is drawn from the same sourced millimetre table the 3D scene uses, at the
 * same scale as the terminal anchors. Before that, glyphs were 60 x 40 user units for every
 * kind while their anchors spanned 10 — so an LED was the same size as a servo, and every
 * wire attached near the top-left corner of a part instead of to a lead. The Uno's outline
 * comes from uno-geometry.ts, which this module reads and never modifies.
 */
import { memo } from 'react';
import type { CircuitComponent, ComponentKind } from '@offline-arduino/contracts/circuit';
import type { ComponentDisplayDelta, PinDisplayDelta } from '@offline-arduino/contracts/simulator';
import { getComponentDefinition } from '@offline-arduino/simulator';
import { componentPhysical } from '../../app/circuit/hardware/component-geometry';
import {
  bodyBoundsMm,
  boundsCenter,
  labelOffsetSchematic,
  selectionBoundsMm,
  type BoundsMm,
} from '../../app/circuit/hardware/component-bounds';
import { mmToSchematic, schematicToMm } from '../../app/circuit/hardware/geometry-units';
import { BOARD_WIDTH, BOARD_DEPTH } from '../../app/circuit/hardware/uno-geometry';
import { resistorBands } from '../../app/circuit/hardware/resistor-bands';

interface Props {
  component: CircuitComponent;
  selected: boolean;
  display?: ComponentDisplayDelta;
  pinDisplay: Record<string, PinDisplayDelta>;
  onSelect(additive: boolean): void;
}

/** Schematic units from millimetres — the same conversion the 3D scene uses. */
const U = mmToSchematic;

function terminalsOf(kind: ComponentKind) {
  return getComponentDefinition(kind)?.terminals ?? [];
}

/** A body rectangle in schematic units, derived — never stored per renderer. */
function bodyRect(kind: ComponentKind): { x: number; y: number; w: number; h: number } | null {
  const terminals = terminalsOf(kind);
  const bounds = bodyBoundsMm(kind, terminals);
  if (!bounds) return null;
  return {
    x: U(bounds.minX),
    y: U(bounds.minZ),
    w: U(bounds.maxX - bounds.minX),
    h: U(bounds.maxZ - bounds.minZ),
  };
}

function ComponentGlyphImpl({ component, selected, display, pinDisplay, onSelect }: Props): JSX.Element {
  const transform = `translate(${component.x} ${component.y}) rotate(${component.rotation})`;
  const label = labelOffsetSchematic(component.kind, terminalsOf(component.kind));

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
      {selected && <SelectionOutline kind={component.kind} />}
      {/* Flying leads run behind the body; pins sit on top of it, so no anchor is ever
          hidden under an opaque part. */}
      <Conductors2D kind={component.kind} />
      {renderGlyph(component, display, pinDisplay)}
      <TerminalPads2D kind={component.kind} />
      <text
        x={label?.x ?? 0}
        y={label?.y ?? 24}
        fontSize={12}
        textAnchor="middle"
        fill="var(--text-secondary)"
      >
        {component.label}
      </text>
    </g>
  );
}

/** Selection outline, derived from the footprint so it frames the part at any rotation. */
function SelectionOutline({ kind }: { kind: ComponentKind }): JSX.Element | null {
  const bounds = selectionBoundsMm(kind, terminalsOf(kind)) ?? unoSelectionBounds(kind);
  if (!bounds) return null;
  return (
    <rect
      x={U(bounds.minX)}
      y={U(bounds.minZ)}
      width={U(bounds.maxX - bounds.minX)}
      height={U(bounds.maxZ - bounds.minZ)}
      fill="none"
      stroke="var(--accent)"
      strokeWidth={1.5}
      strokeDasharray="4 3"
      rx={4}
    />
  );
}

/** The board has no entry in the physical table; its outline comes from uno-geometry.ts. */
function unoSelectionBounds(kind: ComponentKind): BoundsMm | null {
  if (kind !== 'uno-r3') return null;
  const w = BOARD_WIDTH * 25.4;
  const d = BOARD_DEPTH * 25.4;
  return { minX: -3, maxX: w + 3, minZ: -3, maxZ: d + 3 };
}

/**
 * Flying leads — the ones that travel across the board to reach their part.
 *
 * Only pigtails appear here. A through-hole leg goes straight *down* into the bench, and
 * this is a top-down view, so it projects to a point rather than a line; those are drawn as
 * pins by `TerminalPads2D` instead. Drawing them as zero-length lines would leave the wire
 * meeting the part at an invisible spot.
 */
function Conductors2D({ kind }: { kind: ComponentKind }): JSX.Element {
  const terminals = terminalsOf(kind);
  const physical = componentPhysical(kind);
  const body = bodyBoundsMm(kind, terminals);
  if (!physical || !body) return <g />;
  const center = boundsCenter(body);

  return (
    <g>
      {terminals.map((t) => {
        const style = physical.conductors[t.id];
        if (!style || style.exit !== 'pigtail') return null;
        const ax = schematicToMm(t.x);
        const az = schematicToMm(t.y);
        // The cable leaves the face nearest its plug.
        const target = { x: clamp(ax, body.minX, body.maxX), z: az >= center.z ? body.maxZ : body.minZ };
        return (
          <line
            key={t.id}
            x1={t.x}
            y1={t.y}
            x2={U(target.x)}
            y2={U(target.z)}
            stroke={style.colorRole ? CONDUCTOR_HEX[style.colorRole] : '#9ca3af'}
            strokeWidth={Math.max(1.2, U(style.radius * 2))}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

/**
 * The pin or lead at each terminal, drawn on top of the body.
 *
 * This is what a wire actually lands on in the 2D view, and it is drawn after the body so an
 * anchor can never disappear under an opaque part. Position comes from the registry anchor —
 * the same point the wiring layer uses — so the two cannot disagree.
 */
function TerminalPads2D({ kind }: { kind: ComponentKind }): JSX.Element {
  const terminals = terminalsOf(kind);
  const physical = componentPhysical(kind);
  if (!physical) return <g />;

  return (
    <g>
      {terminals.map((t) => {
        const style = physical.conductors[t.id];
        if (!style) return null;
        const radius = Math.max(1.6, U(style.radius * 2));
        return (
          <circle
            key={t.id}
            cx={t.x}
            cy={t.y}
            r={radius}
            fill={style.colorRole ? CONDUCTOR_HEX[style.colorRole] : '#c9ced6'}
            stroke="#4b5563"
            strokeWidth={0.6}
          />
        );
      })}
    </g>
  );
}

const CONDUCTOR_HEX: Record<string, string> = {
  'vcc-red': '#d1352b',
  'ground-black': '#1c1f24',
  'signal-orange': '#e07a1f',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function renderGlyph(
  component: CircuitComponent,
  display: ComponentDisplayDelta | undefined,
  pinDisplay: Record<string, PinDisplayDelta>,
): JSX.Element {
  const rect = bodyRect(component.kind);

  switch (component.kind) {
    case 'uno-r3': {
      // Outline from uno-geometry.ts, so the 2D board is the same shape as the 3D one.
      const w = U(BOARD_WIDTH * 25.4);
      const h = U(BOARD_DEPTH * 25.4);
      const d13 = pinDisplay.D13;
      const builtinOn = d13?.logic === 1;
      return (
        <g>
          <rect width={w} height={h} rx={8} fill="#0f6b5c" stroke="#0a4d42" />
          <rect x={10} y={10} width={w - 20} height={h - 20} rx={4} fill="#0a4d42" opacity={0.4} />
          <circle cx={w - 30} cy={24} r={5} fill={builtinOn ? '#ffd43b' : '#3b4a4d'}>
            {builtinOn && <animate attributeName="opacity" values="1;0.7;1" dur="0.6s" repeatCount="indefinite" />}
          </circle>
          <text x={w - 38} y={40} fontSize={12} fill="#cfe">
            L
          </text>
          <text x={12} y={h / 2} fontSize={13} fill="#e6f7fb" fontWeight="bold">
            ARDUINO UNO
          </text>
        </g>
      );
    }

    case 'led': {
      if (!rect) return <g />;
      const brightness = display?.kind === 'led' ? display.brightness : 0;
      const color = typeof component.properties.color === 'string' ? component.properties.color : 'red';
      const physical = componentPhysical('led')!;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const r = rect.w / 2;
      // The cathode side carries the flat, derived from where the cathode anchor is.
      const cathode = terminalsOf('led').find((t) => t.id === 'cathode');
      const flatOnRight = cathode ? cathode.x >= U(schematicToMm(0)) : true;
      return (
        <g>
          {brightness > 0.05 && (
            <circle cx={cx} cy={cy} r={r * 1.6} fill={color} opacity={brightness * 0.35} />
          )}
          <circle cx={cx} cy={cy} r={U(physical.features.flangeDiameter / 2)} fill={color} opacity={0.35} stroke="#333" />
          <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.3 + brightness * 0.7} stroke="#333" />
          {/* The flat: the polarity cue a student can read off the drawing. */}
          <rect
            x={flatOnRight ? cx + r * 0.72 : cx - r * 1.02}
            y={cy - r * 0.7}
            width={r * 0.3}
            height={r * 1.4}
            fill="#0f172a"
            opacity={0.75}
          />
        </g>
      );
    }

    case 'resistor': {
      if (!rect) return <g />;
      const ohms = Number(component.properties.ohms ?? 220);
      const { colors } = resistorBands(ohms);
      const bandW = U(componentPhysical('resistor')!.features.bandWidth);
      return (
        <g>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={rect.h * 0.35} fill="#d9c08a" stroke="#8a6d3b" />
          {colors.map((c, i) => (
            <rect
              key={i}
              x={rect.x + rect.w * (0.18 + i * 0.16)}
              y={rect.y}
              width={bandW}
              height={rect.h}
              fill={c}
            />
          ))}
        </g>
      );
    }

    case 'pushbutton': {
      if (!rect) return <g />;
      const pressed = display?.kind === 'pushbutton' && display.value === true;
      const physical = componentPhysical('pushbutton')!;
      return (
        <g>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={2} fill="#1c1f24" stroke="#495057" />
          <circle
            cx={rect.x + rect.w / 2}
            cy={rect.y + rect.h / 2}
            r={U(physical.features.plungerDiameter / 2)}
            fill={pressed ? '#9f1239' : '#e11d48'}
            stroke="#495057"
          />
        </g>
      );
    }

    case 'potentiometer': {
      if (!rect) return <g />;
      const value = display?.kind === 'potentiometer' && typeof display.value === 'number' ? display.value : 0.5;
      const angle = -135 + value * 270;
      const physical = componentPhysical('potentiometer')!;
      const cx = rect.x + U(physical.features.screwInset) + rect.w / 2 - U(physical.body.width / 2);
      const cy = rect.y + rect.h / 2;
      const sr = U(physical.features.screwDiameter / 2);
      return (
        <g>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={2} fill="#1f4fa0" stroke="#173a75" />
          <circle cx={cx} cy={cy} r={sr} fill="#d8dde3" stroke="#8b939c" />
          {/* Slot shows the wiper position — the same 270 degrees the 3D screw turns. */}
          <line
            x1={cx - sr * Math.cos((angle * Math.PI) / 180)}
            y1={cy - sr * Math.sin((angle * Math.PI) / 180)}
            x2={cx + sr * Math.cos((angle * Math.PI) / 180)}
            y2={cy + sr * Math.sin((angle * Math.PI) / 180)}
            stroke="#2b2f36"
            strokeWidth={Math.max(1, U(physical.features.screwSlotWidth))}
          />
        </g>
      );
    }

    case 'lcd1602': {
      if (!rect) return <g />;
      const rows = display?.kind === 'lcd1602' ? display.rows : ['', ''];
      const on = display?.kind === 'lcd1602' ? display.displayOn : false;
      const physical = componentPhysical('lcd1602')!;
      const viewW = U(physical.features.viewWidth);
      const viewH = U(physical.features.viewDepth);
      const viewX = rect.x + (rect.w - viewW) / 2;
      const viewY = rect.y + rect.h - viewH - U(6);
      return (
        <g>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={3} fill="#0f5132" stroke="#0b2415" />
          <rect
            x={viewX - U(2.6)}
            y={viewY - U(2.6)}
            width={viewW + U(5.2)}
            height={viewH + U(5.2)}
            rx={2}
            fill="#8f959d"
          />
          <rect x={viewX} y={viewY} width={viewW} height={viewH} fill={on ? '#3fd07f' : '#1f5c38'} />
          <text x={viewX + U(2)} y={viewY + viewH * 0.42} fontFamily="monospace" fontSize={12} fill="#06240f">
            {(rows[0] ?? '').slice(0, 16)}
          </text>
          <text x={viewX + U(2)} y={viewY + viewH * 0.86} fontFamily="monospace" fontSize={12} fill="#06240f">
            {(rows[1] ?? '').slice(0, 16)}
          </text>
        </g>
      );
    }

    case 'servo': {
      if (!rect) return <g />;
      const angle = display?.kind === 'servo' ? display.angle : 90;
      const physical = componentPhysical('servo')!;
      const shaftX = rect.x + rect.w - U(5.5);
      const shaftY = rect.y + rect.h / 2;
      const arm = U(physical.features.hornArmLength);
      return (
        <g>
          {/* Mounting tabs, then the case, then the horn on top of both. */}
          <rect
            x={rect.x - U((physical.features.tabSpan - physical.body.width) / 2)}
            y={rect.y + rect.h * 0.3}
            width={U(physical.features.tabSpan)}
            height={rect.h * 0.4}
            rx={1}
            fill="#1e40af"
          />
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={2} fill="#1e3a8a" stroke="#172554" />
          <circle cx={shaftX} cy={shaftY} r={U(physical.features.hornDiameter / 2)} fill="#e5e7eb" stroke="#9ca3af" />
          <line
            x1={shaftX}
            y1={shaftY}
            x2={shaftX + arm * Math.cos((-angle * Math.PI) / 180)}
            y2={shaftY + arm * Math.sin((-angle * Math.PI) / 180)}
            stroke="#f3f4f6"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </g>
      );
    }

    default:
      return <rect width={20} height={20} fill="#adb5bd" />;
  }
}

export const ComponentGlyph = memo(ComponentGlyphImpl);
