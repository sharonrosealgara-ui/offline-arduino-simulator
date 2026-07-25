/**
 * Interactive circuit canvas — programmatic native SVG (no remote images/CDN).
 * Source: UI_CANVAS_AND_PACKAGING_SPEC.md §6.
 *
 * Layer order per spec §6.1: grid, guide, wire, junction, component, label, selection,
 * interaction. Stores components + user waypoints (never generated SVG path strings);
 * connectivity comes from terminal endpoints + explicit junctions, never rendered
 * crossings. During simulation only affected display attributes update (LED opacity,
 * pin badges) — driven by selector-scoped store subscriptions.
 */
import { useMemo } from 'react';
import { useCircuit, useSimulation, useActions } from '../state/store';
import { getComponentDefinition } from '@offline-arduino/simulator';
import type { CircuitComponent, CircuitWire } from '@offline-arduino/contracts/circuit';
import { ComponentGlyph } from './renderers/ComponentGlyph';

const GRID = 8;

function terminalWorldPosition(component: CircuitComponent, terminalX: number, terminalY: number): { x: number; y: number } {
  const rad = (component.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: component.x + terminalX * cos - terminalY * sin,
    y: component.y + terminalX * sin + terminalY * cos,
  };
}

export function CircuitCanvas(): JSX.Element {
  const circuit = useCircuit();
  const simulation = useSimulation();
  const actions = useActions();

  const terminalPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const component of circuit.components) {
      const definition = getComponentDefinition(component.kind);
      if (!definition) continue;
      for (const terminal of definition.terminals) {
        map.set(`${component.id}:${terminal.id}`, terminalWorldPosition(component, terminal.x, terminal.y));
      }
    }
    return map;
  }, [circuit.components]);

  const wirePath = (wire: CircuitWire): string => {
    const from = terminalPositions.get(`${wire.from.componentId}:${wire.from.terminalId}`);
    const to = terminalPositions.get(`${wire.to.componentId}:${wire.to.terminalId}`);
    if (!from || !to) return '';
    // Cheap orthogonal elbow through the stored waypoints (A* routing is a later
    // enhancement per spec §8.1; connectivity does not depend on the rendered geometry).
    const points = [from, ...wire.waypoints, to];
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  };

  return (
    <svg
      role="img"
      aria-label="Circuit canvas"
      width="100%"
      height="100%"
      viewBox="0 0 900 620"
      style={{ display: 'block', background: 'var(--bg-panel-alt)' }}
      onClick={() => actions.selectIds([])}
    >
      <defs>
        <pattern id="gridPattern" width={GRID * 4} height={GRID * 4} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID * 4} 0 L 0 0 0 ${GRID * 4}`} fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
        </pattern>
      </defs>

      {/* gridLayer */}
      <rect width="100%" height="100%" fill="url(#gridPattern)" />

      {/* wireVisibleLayer + transparent hit paths */}
      <g className="wireVisibleLayer">
        {circuit.wires.map((wire) => (
          <g key={wire.id}>
            <path d={wirePath(wire)} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
            <path d={wirePath(wire)} fill="none" stroke={wireStroke(wire.colorRole)} strokeWidth={2.5} strokeLinejoin="round" />
          </g>
        ))}
      </g>

      {/* junctionLayer */}
      <g className="junctionLayer">
        {circuit.junctions.map((junction) => (
          <circle key={junction.id} cx={junction.point.x} cy={junction.point.y} r={4} fill="var(--text-primary)" />
        ))}
      </g>

      {/* componentLayer + labelLayer + selectionLayer */}
      <g className="componentLayer">
        {circuit.components.map((component) => (
          <ComponentGlyph
            key={component.id}
            component={component}
            selected={circuit.selectedIds.includes(component.id)}
            display={simulation.components[component.id]}
            pinDisplay={simulation.pins}
            onSelect={(additive) =>
              actions.selectIds(additive ? [...circuit.selectedIds, component.id] : [component.id])
            }
          />
        ))}
      </g>
    </svg>
  );
}

function wireStroke(role: CircuitWire['colorRole']): string {
  switch (role) {
    case 'vcc-red':
      return '#d1352b';
    case 'ground-black':
      return '#1c1f24';
    case 'signal-yellow':
      return '#e0b400';
    case 'signal-blue':
      return '#2b74d1';
    case 'signal-green':
      return '#1f9d55';
    case 'signal-orange':
      return '#e07a1f';
    case 'signal-purple':
      return '#8a4fd1';
    default:
      return '#888';
  }
}
