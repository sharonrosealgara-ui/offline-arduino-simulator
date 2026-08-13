/**
 * Problems tab: compiler + circuit + runtime findings in plain language, technical
 * detail behind a disclosure. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §7, §16.
 */
import { useCompiler, useSimulation } from '../state/store';
import { useCompilerStore } from '../app/state/compiler-store';

/**
 * What to say when there is nothing to report.
 *
 * "No problems. Press Verify to compile your sketch." used to be the only empty state, shown
 * whenever the diagnostics list was empty — which is also true after a compile succeeds. So
 * a student who had just pressed Verify, watched it succeed and started the simulation was
 * still being told to press Verify. An empty list means two different things and the panel
 * now reads the state that tells them apart.
 *
 * A failed compile is never reported as success, even if it somehow produced no diagnostics:
 * silence after an error is not the same as a clean build.
 */
export function emptyProblemsMessage(
  compileStatus: 'idle' | 'compiling' | 'success' | 'error',
  simulationRunning: boolean,
): string {
  switch (compileStatus) {
    case 'compiling':
      return 'Checking your sketch…';
    case 'error':
      return 'Compilation failed. See the output above the editor for details.';
    case 'success':
      return simulationRunning
        ? 'No problems. Compilation succeeded; simulation is running.'
        : 'No problems. Compilation succeeded.';
    case 'idle':
    default:
      return 'No problems. Press Verify to compile your sketch.';
  }
}

export function ProblemsView(): JSX.Element {
  const compiler = useCompiler();
  const simulation = useSimulation();
  const compileStatus = useCompilerStore((s) => s.status);

  const hasAny = compiler.diagnostics.length > 0 || simulation.circuitDiagnostics.length > 0;
  const running = simulation.phase === 'running';

  return (
    <div className="scrollArea">
      {!hasAny && (
        <div style={{ padding: 16, color: 'var(--text-secondary)' }}>
          {emptyProblemsMessage(compileStatus, running)}
        </div>
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
