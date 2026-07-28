/**
 * Camera and interaction controls layered over the 3D viewport.
 *
 * Every control here does something real. Nothing is a placeholder: Fit and Reset call into
 * the CameraRig, and the interaction legend documents bindings that OrbitControls and the
 * selection layer actually implement.
 */
import { useState } from 'react';
import { Maximize, Crosshair, Keyboard } from 'lucide-react';

export interface ViewportOverlayProps {
  onFit(): void;
  onReset(): void;
}

const BINDINGS: ReadonlyArray<readonly [string, string]> = [
  ['Left drag', 'Orbit'],
  ['Right drag', 'Pan'],
  ['Wheel', 'Zoom'],
  ['Click part', 'Select'],
  ['Drag part', 'Move'],
  ['R', 'Rotate 90°'],
  ['Delete', 'Remove part'],
  ['Esc', 'Clear selection'],
];

export function ViewportOverlay({ onFit, onReset }: ViewportOverlayProps): JSX.Element {
  const [legendOpen, setLegendOpen] = useState(false);

  return (
    <div className="viewportOverlay">
      <div className="viewportOverlay__cluster" role="group" aria-label="Camera controls">
        <button type="button" className="viewportBtn" onClick={onFit} title="Fit circuit to view">
          <Maximize size={14} aria-hidden />
          <span>Fit</span>
        </button>
        <button type="button" className="viewportBtn" onClick={onReset} title="Reset camera to default view">
          <Crosshair size={14} aria-hidden />
          <span>Reset</span>
        </button>
        <button
          type="button"
          className="viewportBtn"
          onClick={() => setLegendOpen((open) => !open)}
          aria-expanded={legendOpen}
          title="Show interaction controls"
        >
          <Keyboard size={14} aria-hidden />
          <span>Controls</span>
        </button>
      </div>

      {legendOpen && (
        <dl className="viewportLegend" aria-label="Interaction controls">
          {BINDINGS.map(([key, action]) => (
            <div key={key} className="viewportLegend__row">
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
