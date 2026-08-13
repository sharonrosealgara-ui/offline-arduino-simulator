// @vitest-environment jsdom
/**
 * The Problems panel says what is actually true.
 *
 * The empty state was derived from the diagnostics list alone: "No problems. Press Verify to
 * compile your sketch." An empty list is also what a *successful* compile produces, so a
 * student who had pressed Verify, watched it succeed and started the simulation was still
 * being told to press Verify — while the header read "Done compiling" and the footer read
 * "Simulation: running". Three parts of one window disagreeing.
 *
 * Presentational only: this reads compiler status and simulation phase that already existed.
 * Nothing about compiling, simulating or diagnostics changes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProblemsView, emptyProblemsMessage } from '../src/renderer/components/ProblemsView';
import { useAppStore } from '../src/renderer/state/store';
import { useCompilerStore } from '../src/renderer/app/state/compiler-store';

function setCompileStatus(status: 'idle' | 'compiling' | 'success' | 'error'): void {
  useCompilerStore.setState({ status });
}

function setSimulationPhase(phase: 'empty' | 'ready' | 'running' | 'paused'): void {
  useAppStore.setState((s) => ({ simulation: { ...s.simulation, phase } }));
}

function clearDiagnostics(): void {
  useAppStore.setState((s) => ({
    compiler: { ...s.compiler, diagnostics: [] },
    simulation: { ...s.simulation, circuitDiagnostics: [] },
  }));
}

beforeEach(() => {
  clearDiagnostics();
  setCompileStatus('idle');
  setSimulationPhase('empty');
});

afterEach(cleanup);

describe('the journey a student actually takes', () => {
  it('before compiling, asks them to press Verify', () => {
    render(<ProblemsView />);
    expect(screen.getByText('No problems. Press Verify to compile your sketch.')).toBeTruthy();
  });

  it('while compiling, says so instead of asking for a compile already underway', () => {
    setCompileStatus('compiling');
    render(<ProblemsView />);
    expect(screen.getByText('Checking your sketch…')).toBeTruthy();
    expect(screen.queryByText(/Press Verify/)).toBeNull();
  });

  it('after a clean compile, reports the success rather than repeating the instruction', () => {
    setCompileStatus('success');
    render(<ProblemsView />);
    expect(screen.getByText('No problems. Compilation succeeded.')).toBeTruthy();
    expect(screen.queryByText(/Press Verify/)).toBeNull();
  });

  it('once the simulation runs, says that too — the exact case that failed acceptance', () => {
    setCompileStatus('success');
    setSimulationPhase('running');
    render(<ProblemsView />);
    expect(screen.getByText('No problems. Compilation succeeded; simulation is running.')).toBeTruthy();
    expect(screen.queryByText(/Press Verify/)).toBeNull();
  });
});

describe('a failed compile is never dressed up as success', () => {
  it('with zero diagnostics, still does not claim compilation succeeded', () => {
    // An error that somehow produced no diagnostics must not read as a clean build.
    setCompileStatus('error');
    render(<ProblemsView />);
    expect(screen.queryByText(/succeeded/i)).toBeNull();
    expect(screen.getByText(/Compilation failed/)).toBeTruthy();
  });

  it('does not claim success while the simulation happens to be running', () => {
    setCompileStatus('error');
    setSimulationPhase('running');
    render(<ProblemsView />);
    expect(screen.queryByText(/succeeded/i)).toBeNull();
  });
});

describe('real diagnostics still take precedence over any empty state', () => {
  it('shows the diagnostic, not a status line', () => {
    setCompileStatus('error');
    useAppStore.setState((s) => ({
      compiler: {
        ...s.compiler,
        diagnostics: [
          {
            id: 'd1',
            severity: 'error',
            title: "expected ';' before '}'",
            explanation: 'A statement is missing its semicolon.',
            suggestedActions: ['Add a semicolon at the end of line 4.'],
            line: 4,
          } as never,
        ],
      },
    }));

    render(<ProblemsView />);
    expect(screen.getByText("expected ';' before '}'")).toBeTruthy();
    expect(screen.queryByText(/Press Verify/)).toBeNull();
    expect(screen.queryByText(/Compilation failed\./)).toBeNull();
  });
});

describe('the message rule on its own', () => {
  it.each([
    ['idle', false, 'No problems. Press Verify to compile your sketch.'],
    ['idle', true, 'No problems. Press Verify to compile your sketch.'],
    ['compiling', false, 'Checking your sketch…'],
    ['success', false, 'No problems. Compilation succeeded.'],
    ['success', true, 'No problems. Compilation succeeded; simulation is running.'],
    ['error', false, 'Compilation failed. See the output above the editor for details.'],
    ['error', true, 'Compilation failed. See the output above the editor for details.'],
  ] as const)('%s + running=%s', (status, running, expected) => {
    expect(emptyProblemsMessage(status, running)).toBe(expected);
  });
});
