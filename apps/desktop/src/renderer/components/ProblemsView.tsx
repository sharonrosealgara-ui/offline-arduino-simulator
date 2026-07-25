/**
 * Problems tab: compiler + circuit + runtime findings in plain language, technical
 * detail behind a disclosure. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §7, §16.
 */
import { useCompiler, useSimulation } from '../state/store';

export function ProblemsView(): JSX.Element {
  const compiler = useCompiler();
  const simulation = useSimulation();

  const hasAny = compiler.diagnostics.length > 0 || simulation.circuitDiagnostics.length > 0;

  return (
    <div className="scrollArea">
      {!hasAny && (
        <div style={{ padding: 16, color: 'var(--text-secondary)' }}>No problems. Press Verify to compile your sketch.</div>
      )}

      {compiler.diagnostics.map((d) => (
        <details key={d.id} className="diagnosticRow" style={{ display: 'block' }}>
          <summary style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: 'pointer' }}>
            <span className={`diagnosticRow__badge diagnosticRow__badge--${d.severity}`}>{d.severity}</span>
            <span>
              <strong>{d.title}</strong>
              {d.line ? <span style={{ color: 'var(--text-secondary)' }}> — line {d.line}</span> : null}
              <div style={{ color: 'var(--text-secondary)' }}>{d.explanation}</div>
              {d.suggestedActions.length > 0 && (
                <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {d.suggestedActions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ol>
              )}
            </span>
          </summary>
          {d.technicalDetail && (
            <pre style={{ margin: '6px 0 0 40px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {d.technicalDetail}
            </pre>
          )}
        </details>
      ))}

      {simulation.circuitDiagnostics.map((d) => (
        <div key={d.id} className="diagnosticRow">
          <span className={`diagnosticRow__badge diagnosticRow__badge--${d.severity}`}>{d.severity}</span>
          <span>
            <strong>{d.code}</strong>
            <div style={{ color: 'var(--text-secondary)' }}>{d.message}</div>
          </span>
        </div>
      ))}
    </div>
  );
}
