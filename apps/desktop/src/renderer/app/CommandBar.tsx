/**
 * Command bar. Consistent workbench verbs (spec §8): Verify, Run, Pause, Step, Reset,
 * Stop. Lucide-React icons; every action is keyboard reachable.
 */
import {
  CheckCircle2,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Square,
  FolderOpen,
  Save,
  BookOpen,
  HelpCircle,
  Gauge,
  Undo2,
  Redo2,
  PanelLeft,
  PanelRight,
} from 'lucide-react';
import {
  useCompiler,
  useProject,
  useSimulation,
  useLayout,
  useActions,
  useCanUndo,
  useCanRedo,
} from '../state/store';
import { useCompilerStore } from './state/compiler-store';
import { simulationClient } from '../simulation/simulation-client';
import * as controller from './workbench-controller';

interface Props {
  onOpenExamples(): void;
  onOpenDocumentation(): void;
}

export function CommandBar({ onOpenExamples, onOpenDocumentation }: Props): JSX.Element {
  const compiler = useCompiler();
  const project = useProject();
  const simulation = useSimulation();
  const layout = useLayout();
  const actions = useActions();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  // Single source of truth for the Verify pipeline: idle -> compiling -> success | error.
  const verifyStatus = useCompilerStore((s) => s.status);
  const verifyOutput = useCompilerStore((s) => s.output);
  const verifyErrorCount = useCompilerStore((s) => s.errorCount);
  const verifying = verifyStatus === 'compiling';

  const running = simulation.phase === 'running';
  const paused = simulation.phase === 'paused';
  const hasProgram = simulation.phase !== 'empty' && simulation.phase !== 'ready';

  // controller.verify() reads the current sketch source from the app store and passes
  // it into useCompilerStore.verify(source); every failure path resolves (never throws).
  const doVerify = async (): Promise<void> => {
    await controller.verify();
  };

  return (
    <div className="commandBar">
      <div className="commandBar__group">
        <button className="btn" onClick={() => void controller.openProject()} title="Open Project">
          <FolderOpen size={16} /> Open
        </button>
        <button className="btn" onClick={() => void controller.saveProject()} title="Save Project">
          <Save size={16} /> Save
        </button>
        <button className="btn" onClick={onOpenExamples} title="Offline Starter Library">
          <BookOpen size={16} /> Examples
        </button>
        <button className="btn" onClick={onOpenDocumentation} title="Offline User Guide">
          <HelpCircle size={16} /> Documentation
        </button>
      </div>

      <div className="commandBar__group" style={{ marginLeft: 12 }}>
        <button className="btn" onClick={() => void doVerify()} disabled={verifying} aria-busy={verifying}>
          <CheckCircle2 size={16} /> {verifying ? 'Verifying…' : 'Verify'}
        </button>
        {!running ? (
          <button className="btn btn--primary" onClick={() => void controller.run()}>
            <Play size={16} /> Run
          </button>
        ) : (
          <button className="btn" onClick={() => controller.pause()}>
            <Pause size={16} /> Pause
          </button>
        )}
        <button className="btn" onClick={() => controller.step()} disabled={!paused}>
          <StepForward size={16} /> Step
        </button>
        <button className="btn" onClick={() => controller.reset()} disabled={!hasProgram}>
          <RotateCcw size={16} /> Reset
        </button>
        <button className="btn" onClick={() => controller.stop()} disabled={!hasProgram}>
          <Square size={16} /> Stop
        </button>
      </div>

      <div className="commandBar__group" style={{ marginLeft: 12, minWidth: 0 }} role="status" aria-live="polite">
        <VerifyStatusDot status={verifyStatus} />
        <span
          style={{
            fontSize: 12,
            fontFamily: "'Cascadia Code', 'Consolas', monospace",
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 320,
            color:
              verifyStatus === 'error'
                ? 'var(--error, #f87171)'
                : verifyStatus === 'success'
                  ? 'var(--success, #34d399)'
                  : 'var(--text-secondary)',
          }}
          title={verifyOutput}
        >
          {verifyOutput}
          {verifyStatus === 'error' && verifyErrorCount > 0
            ? ` (${verifyErrorCount} error${verifyErrorCount === 1 ? '' : 's'})`
            : ''}
        </span>
      </div>

      <div className="commandBar__spacer" />

      <div className="commandBar__group">
        <button
          className="btn btn--compact"
          onClick={() => actions.undo()}
          disabled={!canUndo}
          title="Undo circuit edit (Ctrl+Z)"
          aria-label="Undo circuit edit"
        >
          <Undo2 size={15} aria-hidden />
        </button>
        <button
          className="btn btn--compact"
          onClick={() => actions.redo()}
          disabled={!canRedo}
          title="Redo circuit edit (Ctrl+Shift+Z)"
          aria-label="Redo circuit edit"
        >
          <Redo2 size={15} aria-hidden />
        </button>

        <button
          className="btn btn--compact"
          onClick={() => actions.setLayout({ trayVisible: !layout.trayVisible })}
          aria-pressed={layout.trayVisible}
          title="Toggle the component library panel"
        >
          <PanelLeft size={15} aria-hidden />
        </button>
        <button
          className="btn btn--compact"
          onClick={() => actions.setLayout({ inspectorVisible: !layout.inspectorVisible })}
          aria-pressed={layout.inspectorVisible}
          title="Toggle the inspector panel"
        >
          <PanelRight size={15} aria-hidden />
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Low-spec mode: 30 FPS simulation, no shadows or antialiasing">
          <Gauge size={16} aria-hidden />
          <input
            type="checkbox"
            checked={layout.lowSpecMode}
            onChange={(e) => simulationClient.setLowSpec(e.target.checked)}
          />
          Low-spec
        </label>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {compiler.flashBytes}/{compiler.flashMaxBytes} B flash · rev {project.sourceRevision}
        </span>
      </div>
    </div>
  );
}

function VerifyStatusDot({ status }: { status: 'idle' | 'compiling' | 'success' | 'error' }): JSX.Element {
  const color = {
    idle: '#71717a',
    compiling: '#38bdf8',
    success: '#34d399',
    error: '#ef4444',
  }[status];
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        height: 10,
        width: 10,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: status === 'success' || status === 'error' ? `0 0 0 3px ${color}33` : undefined,
        animation: status === 'compiling' ? 'pulse 1.2s ease-in-out infinite' : undefined,
      }}
    />
  );
}
