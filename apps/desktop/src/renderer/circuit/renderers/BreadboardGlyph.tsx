/**
 * The 2D breadboard: 400 holes drawn, one thing to click, one thing to focus.
 *
 * WHY IT IS SHAPED LIKE THIS
 * The obvious approach — a focusable button per hole — produces 400 tab stops and 400
 * overlapping hit targets on a part that is 84 mm wide. Tabbing across it would take four
 * hundred presses. So the holes are painted marks with no interactivity at all, hidden from
 * the accessibility tree, and every interaction goes through ONE composite surface: one
 * pointer target that resolves which hole was meant, and one focusable element that owns a
 * roving logical cursor.
 *
 * Geometry, hit resolution and navigation are pure functions in `breadboard-geometry.ts`;
 * group membership and occupancy are pure functions in `breadboard-connections.ts`. This
 * file is presentation and event plumbing, so the parts worth testing can be tested without
 * a DOM.
 *
 * C2A SCOPE. Selecting a hole reports it through `onHoleActivate` and nothing else. It is
 * not wired to the wire workflow, the breadboard is not in the catalog, and the project load
 * guard still refuses to open a file containing one. C2B connects it.
 *
 * VISUAL APPROXIMATIONS — none of these are manufacturer measurements. The datasheets give
 * the pitch, the hole style, the material, the tie-point counts and the body envelope, and
 * nothing else. The trench opening width, the drawn hole diameter, the body corner radius,
 * the edge margins, every stroke width and the whole palette are this project's design
 * choices. See `vendor/licenses/app-3d-assets/BREADBOARD_GEOMETRY_SOURCES.md`.
 */
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { mmToSchematicUnits } from '@offline-arduino/contracts/units';
import {
  HOLE_CAPTURE_RADIUS_UNITS,
  breadboardBodyRect,
  breadboardHolePoints,
  firstNavigableHole,
  moveHole,
  resolveHoleAt,
  type BreadboardArrow,
} from '../../app/circuit/breadboard-geometry';
import {
  holeAnnouncement,
  holesInSameGroup,
  isHoleOccupied,
  occupiedHoles,
} from '../../app/circuit/breadboard-connections';

interface Props {
  component: CircuitComponent;
  selected: boolean;
  /** Wires in the project — the only source occupancy is derived from. */
  wires: readonly CircuitWire[];
  /** Reports the hole a pointer or Enter chose. C2A observes; C2B will wire it up. */
  onHoleActivate?(holeId: string): void;
  onSelect?(additive: boolean): void;
}

/** APPROXIMATION — drawn radius of a hole mark, in schematic units. */
const HOLE_MARK_RADIUS = 1.6;
/** APPROXIMATION — the visible plastic opening down the middle, NOT the E-to-F centre gap. */
const TRENCH_VISIBLE_DEPTH = mmToSchematicUnits(3.6);
/** APPROXIMATION — body corner rounding. */
const BODY_RADIUS = 4;

const ARROW_KEYS: Record<string, BreadboardArrow> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

function BreadboardGlyphImpl({ component, selected, wires, onHoleActivate, onSelect }: Props): JSX.Element {
  const body = breadboardBodyRect();
  const holes = breadboardHolePoints();
  const liveId = useId();
  const surfaceRef = useRef<SVGRectElement>(null);

  // Interaction state is local on purpose: a roving cursor is a property of this control
  // while it is being used, not of the document, and putting it in the project store would
  // add a field nothing else reads.
  const [navigating, setNavigating] = useState(false);
  const [cursor, setCursor] = useState<string>(() => firstNavigableHole());
  const [hovered, setHovered] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const current = navigating ? cursor : hovered;
  const taken = occupiedHoles(wires, component.id);
  const connected = new Set(current ? holesInSameGroup(current) : []);

  const announce = useCallback(
    (holeId: string) => {
      setAnnouncement(holeAnnouncement(wires, { componentId: component.id, terminalId: holeId }));
    },
    [wires, component.id],
  );

  useEffect(() => {
    if (!navigating) setAnnouncement('');
  }, [navigating]);

  /** Canvas coordinates of a pointer event, in the SVG's own user space. */
  const pointerToCanvas = (event: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null => {
    const svg = surfaceRef.current?.ownerSVGElement;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };

  const handlePointer = (event: React.MouseEvent, activate: boolean): void => {
    const canvas = pointerToCanvas(event);
    if (!canvas) return;
    const holeId = resolveHoleAt(canvas, component);
    if (activate) {
      event.stopPropagation();
      onSelect?.(event.shiftKey);
      // A miss is a miss. Snapping to whatever was nearest would attach a wire to a hole
      // the student never aimed at, with no way to say "I missed".
      if (holeId) {
        setCursor(holeId);
        announce(holeId);
        onHoleActivate?.(holeId);
      }
    } else {
      setHovered(holeId);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    // Tab is never intercepted: trapping it would strand a keyboard user inside the board.
    if (event.key === 'Tab') return;

    if (!navigating) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        setNavigating(true);
        announce(cursor);
      }
      return;
    }

    const arrow = ARROW_KEYS[event.key];
    if (arrow) {
      // Stopped here so an arrow that moved the cursor cannot also reach a global shortcut.
      event.preventDefault();
      event.stopPropagation();
      const next = moveHole(cursor, arrow);
      setCursor(next);
      announce(next);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      announce(cursor);
      onHoleActivate?.(cursor);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setNavigating(false);
    }
  };

  const transform = `translate(${component.x} ${component.y}) rotate(${component.rotation})`;
  const railRows = holes.filter((h) => h.groupId.startsWith('rail:'));
  const railYs = [...new Set(railRows.map((h) => h.y.toFixed(4)))].map(Number).sort((a, b) => a - b);

  return (
    <g
      transform={transform}
      className="breadboardGlyph"
      data-testid={`breadboard-${component.id}`}
      data-navigating={navigating ? 'true' : 'false'}
    >
      {/* ---- body -------------------------------------------------------------------- */}
      <rect
        x={body.x}
        y={body.y}
        width={body.w}
        height={body.h}
        rx={BODY_RADIUS}
        className="breadboardGlyph__body"
        fill="var(--bg-panel)"
        stroke={selected ? 'var(--accent)' : 'var(--border)'}
        strokeWidth={selected ? 2 : 1}
        data-selected={selected ? 'true' : 'false'}
      />

      {/* ---- centre separation: the visible trench, not the E-to-F centre distance ---- */}
      <rect
        x={body.x + 6}
        y={-TRENCH_VISIBLE_DEPTH / 2}
        width={body.w - 12}
        height={TRENCH_VISIBLE_DEPTH}
        className="breadboardGlyph__trench"
        fill="var(--bg-panel-alt)"
        stroke="var(--border)"
        strokeWidth={0.5}
      />

      {/* ---- rail marking lines ------------------------------------------------------ */}
      {railYs.map((y, index) => {
        const polarity = index === 1 || index === 2 ? 'positive' : 'negative';
        const offset = index < 2 ? -3.5 : 3.5;
        return (
          <g key={`rail-${y}`} className={`breadboardGlyph__rail breadboardGlyph__rail--${polarity}`}>
            <line
              x1={body.x + 6}
              y1={y + offset}
              x2={body.x + body.w - 6}
              y2={y + offset}
              stroke={polarity === 'positive' ? 'var(--danger)' : 'var(--accent)'}
              strokeWidth={0.8}
            />
            <text
              x={body.x + 3}
              y={y + offset + 1.5}
              fontSize={4}
              textAnchor="middle"
              fill="var(--text-secondary)"
              aria-hidden="true"
            >
              {polarity === 'positive' ? '+' : '−'}
            </text>
          </g>
        );
      })}

      {/* ---- hole marks: painted only, never focusable, never pointer targets --------- */}
      <g className="breadboardGlyph__holes" aria-hidden="true" pointerEvents="none">
        {holes.map((hole) => {
          const isCurrent = current === hole.id;
          const isConnected = connected.has(hole.id) && !isCurrent;
          const isOccupied = taken.has(hole.id);
          return (
            <g key={hole.id} data-hole={hole.id} data-occupied={isOccupied ? 'true' : 'false'}>
              <rect
                x={hole.x - HOLE_MARK_RADIUS}
                y={hole.y - HOLE_MARK_RADIUS}
                width={HOLE_MARK_RADIUS * 2}
                height={HOLE_MARK_RADIUS * 2}
                fill="var(--bg-app)"
                stroke="var(--text-secondary)"
                strokeWidth={0.3}
              />
              {/* Connected: a ring. A shape, so it survives greyscale and colour blindness. */}
              {isConnected && (
                <circle
                  cx={hole.x}
                  cy={hole.y}
                  r={HOLE_CAPTURE_RADIUS_UNITS - 0.8}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={0.7}
                  data-state="connected"
                />
              )}
              {/* Occupied: a cross through the hole — distinct in shape from the ring. */}
              {isOccupied && (
                <g data-state="occupied" stroke="var(--text-primary)" strokeWidth={0.6}>
                  <line x1={hole.x - 1.4} y1={hole.y - 1.4} x2={hole.x + 1.4} y2={hole.y + 1.4} />
                  <line x1={hole.x - 1.4} y1={hole.y + 1.4} x2={hole.x + 1.4} y2={hole.y - 1.4} />
                </g>
              )}
              {/* Current: a square bracket outline, distinct again from ring and cross. */}
              {isCurrent && (
                <rect
                  x={hole.x - HOLE_CAPTURE_RADIUS_UNITS}
                  y={hole.y - HOLE_CAPTURE_RADIUS_UNITS}
                  width={HOLE_CAPTURE_RADIUS_UNITS * 2}
                  height={HOLE_CAPTURE_RADIUS_UNITS * 2}
                  fill="none"
                  stroke="var(--focus-ring)"
                  strokeWidth={1}
                  data-state="current"
                />
              )}
            </g>
          );
        })}
      </g>

      {/* ---- legend: row letters and column numbers, as the real board prints them ---- */}
      <g className="breadboardGlyph__legend" aria-hidden="true" pointerEvents="none" fill="var(--text-secondary)" fontSize={3.4}>
        {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((row) => {
          const hole = holes.find((h) => h.id === `${row}1`);
          if (!hole) return null;
          return (
            <text key={`row-${row}`} x={hole.x - 6} y={hole.y + 1.2} textAnchor="middle" data-row-label={row}>
              {row}
            </text>
          );
        })}
        {Array.from({ length: 30 }, (_, i) => i + 1)
          .filter((column) => column === 1 || column % 5 === 0)
          .map((column) => {
            const hole = holes.find((h) => h.id === `A${column}`);
            if (!hole) return null;
            return (
              <text key={`col-${column}`} x={hole.x} y={hole.y - 5} textAnchor="middle" data-column-label={column}>
                {column}
              </text>
            );
          })}
      </g>

      {/* ---- ONE pointer surface and ONE focus target ------------------------------- */}
      <rect
        ref={surfaceRef}
        x={body.x}
        y={body.y}
        width={body.w}
        height={body.h}
        rx={BODY_RADIUS}
        fill="transparent"
        className="breadboardGlyph__surface"
        data-testid={`breadboard-surface-${component.id}`}
        role="application"
        tabIndex={0}
        aria-label={`${component.label || 'Breadboard'}. Press Enter to choose a hole, then use the arrow keys.`}
        aria-describedby={liveId}
        style={{ cursor: 'crosshair' }}
        onClick={(event) => handlePointer(event, true)}
        onMouseMove={(event) => handlePointer(event, false)}
        onMouseLeave={() => setHovered(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setNavigating(false)}
      />

      {/* SVG cannot host a live region, so it rides in a foreignObject sized to nothing. */}
      <foreignObject x={body.x} y={body.y} width={1} height={1} aria-hidden="false">
        <div
          id={liveId}
          role="status"
          aria-live="polite"
          data-testid={`breadboard-live-${component.id}`}
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
        >
          {announcement}
        </div>
      </foreignObject>
    </g>
  );
}

export const BreadboardGlyph = memo(BreadboardGlyphImpl);

/** Exported for tests: whether a hole currently holds a conductor on this instance. */
export { isHoleOccupied };
