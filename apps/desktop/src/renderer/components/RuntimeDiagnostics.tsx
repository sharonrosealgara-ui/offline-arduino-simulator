/**
 * Circuit & Runtime tab: cycles, simulated ms, effective speed, worker drift, recent
 * pin/component deltas. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §7.
 */
import { useSimulation } from '../state/store';

const F_CPU = 16_000_000;

export function RuntimeDiagnostics(): JSX.Element {
  const simulation = useSimulation();
  const simulatedMs = (simulation.cycles / F_CPU) * 1000;

  return (
    <div className="scrollArea" style={{ padding: 12, fontSize: 13 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0 }}>
        <dt style={{ color: 'var(--text-secondary)' }}>Phase</dt>
        <dd style={{ margin: 0 }}>{simulation.phase}</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Cycles</dt>
        <dd style={{ margin: 0 }}>{simulation.cycles.toLocaleString()}</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Simulated time</dt>
        <dd style={{ margin: 0 }}>{simulatedMs.toFixed(2)} ms</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Effective speed</dt>
        <dd style={{ margin: 0 }}>
          {simulation.metrics ? `${(simulation.metrics.speedRatio * 100).toFixed(0)}% of real-time` : '—'}
        </dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Target speed</dt>
        <dd style={{ margin: 0 }}>{simulation.metrics ? `${(simulation.metrics.targetRatio * 100).toFixed(0)}%` : '—'}</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Worker drift</dt>
        <dd style={{ margin: 0 }}>{simulation.metrics ? `${simulation.metrics.driftMs.toFixed(1)} ms` : '—'}</dd>
        <dt style={{ color: 'var(--text-secondary)' }}>Frame rate</dt>
        <dd style={{ margin: 0 }}>{simulation.metrics ? `${simulation.metrics.frameRate} FPS` : '—'}</dd>
      </dl>

      {simulation.faultMessage && (
        <div style={{ marginTop: 12, color: 'var(--danger)' }}>
          <strong>Worker fault:</strong> {simulation.faultMessage}
        </div>
      )}

      <h4 style={{ margin: '16px 0 6px' }}>Recent pin states</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.values(simulation.pins).map((pin) => (
          <span
            key={pin.boardPin}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: pin.logic === 1 ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'var(--bg-panel-alt)',
            }}
          >
            {pin.boardPin}={pin.logic}
          </span>
        ))}
      </div>
    </div>
  );
}
